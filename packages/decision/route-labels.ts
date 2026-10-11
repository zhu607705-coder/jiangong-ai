/** Display labels shared without importing server-side evidence construction. */
export const DECISION_ACTIONS = {investigate:'先补证据', resolve_blocker:'先核查阻点', compare:'进入路径比较', review:'复核判断'} as const
export function decisionErrorMessage(code?:string|null):string {
  const messages:Record<string,string>={
    DECISION_TIMEOUT:'决策接口等待超时，已取得的简报与依据仍保留，可重试评分。',
    DECISION_HTTP_429:'决策接口正在限流，请稍后重试，避免连续提交。',
    DECISION_HTTP_401:'决策接口拒绝了密钥，请检查配置。',
    DECISION_HTTP_403:'当前密钥没有这项决策接口的访问权限。',
    DECISION_HTTP_404:'当前地址未提供决策接口，请检查配置。',
    DECISION_KEY_MISSING:'尚未配置决策模型密钥。',
    DECISION_ENDPOINT_MISSING:'尚未配置决策模型地址。',
    DECISION_ENDPOINT_INVALID:'决策模型地址配置不正确。',
    DECISION_MODEL_INVALID:'决策模型名称配置不正确。',
    DECISION_TIMEOUT_INVALID:'决策接口等待上限配置不正确。',
    DECISION_INVALID_RESPONSE:'接口返回的结构化结果未通过校验，已取得的简报仍保留。',
    DECISION_INPUT_LIMIT:'本次判断资料超出请求上限，请缩小研究范围。',
    DECISION_RESPONSE_LIMIT:'接口返回内容超出读取上限，当前结果未用于判断。',
  }
  return messages[code||'']||'决策接口暂未取得可验证结果，已取得的简报与资料仍保留。'
}
