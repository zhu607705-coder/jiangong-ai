/** Shared by dispatch, topic compilation and status; zero explicitly disables calls. */
export function intelligenceDailyModelBudget(env:Record<string,string|undefined>=process.env){
  const value=Number(env.INTELLIGENCE_DAILY_MODEL_CALLS??100)
  if(!Number.isSafeInteger(value)||value<0||value>1000)throw Error('INVALID_MODEL_BUDGET')
  return value
}
