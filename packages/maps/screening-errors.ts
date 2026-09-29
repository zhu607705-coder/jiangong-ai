/** Never surface provider URLs, secrets or arbitrary exception text. */
export function screeningError(error:unknown, signal?:AbortSignal):{code:string;message:string} {
  const raw=error instanceof Error?error.message:''
  if(signal?.aborted)return signal.reason?.name==='TimeoutError'
    ? {code:'MAP_SCAN_TIMEOUT',message:'本轮达到时间上限，已取得的结果保留。请缩小范围后重试。'}
    : {code:'MAP_SCAN_CANCELLED',message:'本轮标色已停止，已取得的结果保留。'}
  const messages:Record<string,string>={
    REGION_INPUT_REJECTED:'边界输入未通过校验，请重新框选；已有项目资料不会被删除。',
    REGION_PROVIDER_UNAVAILABLE:'街区边界服务未返回，请检查专业能力服务；也可框选区域直接研究。',
    INVALID_REGION_TOPOLOGY:'该对象边界无效，已保留其余筛选结果。',
    INVALID_REGIONS:'边界响应格式发生变化，请查看服务日志中的请求编号。',
    INVALID_AMAP_COUNTS:'场所接口返回格式异常，当前数量不可用于标色。',
  }
  return {code:raw in messages?raw:'MAP_SCAN_FAILED',message:messages[raw]||'筛选中断，已有结果保留。请检查服务日志中的请求编号。'}
}
