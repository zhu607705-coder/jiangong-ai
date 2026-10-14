export type CostNetwork = {
  model_version:string; architecture:{input_features:number;hidden:number[];activation:string;target_transform:string};
  x_scaler:{mean:number[];std:number[]}; log_y_scaler:{mean:number;std:number};
  layers:{weights:number[][];bias:number[]}[];
}
/** Forward pass of persisted NumPy weights; no fitting and no project writes. */
export function predictCostNetwork(model:CostNetwork, inputs:number[]) {
  if (model.model_version !== 'cost-bp-numpy-1' || model.layers.length !== 3 || model.architecture.activation !== 'tanh' || model.architecture.target_transform !== 'log'
    || inputs.length !== model.architecture.input_features || inputs.some(value=>!Number.isFinite(value))) throw new Error('COST_MODEL_INPUT_INVALID')
  let values=inputs.map((value,index)=>{
    const mean=model.x_scaler.mean[index], scale=model.x_scaler.std[index]
    if (!Number.isFinite(mean) || !Number.isFinite(scale) || scale<=0) throw new Error('COST_MODEL_SCALER_INVALID')
    return (value-mean)/scale
  })
  for (const [index,layer] of model.layers.entries()) {
    if (layer.weights.length!==values.length || !layer.bias.length || layer.weights.some(row=>row.length!==layer.bias.length)) throw new Error('COST_MODEL_SHAPE_INVALID')
    values=layer.bias.map((bias,column)=>{
      const linear=values.reduce((sum,value,row)=>sum+value*layer.weights[row][column],bias)
      if (!Number.isFinite(linear)) throw new Error('COST_MODEL_NONFINITE')
      return index<2?Math.tanh(linear):linear
    })
  }
  const price=Math.exp(values[0]*model.log_y_scaler.std+model.log_y_scaler.mean)
  if (values.length!==1 || !Number.isFinite(price) || price<=0) throw new Error('COST_MODEL_NONFINITE')
  return price
}
export const costScopeChoices=[
 ['roof_and_related_facilities','屋面及相关设施'],['exterior_wall_finishes','外墙整治'],['sanitary_facilities_upgrade','卫生设施改善'],['comprehensive_renovation','综合整治'],['unknown','范围待明确'],
] as const
export function workbookCostFeatures(area:number,scope:string) {
  if (!Number.isFinite(area) || area<=0 || !costScopeChoices.some(([key])=>key===scope)) throw new Error('COST_MODEL_INPUT_INVALID')
  return [Math.log(area),...costScopeChoices.map(([key])=>key===scope?1:0)]
}
