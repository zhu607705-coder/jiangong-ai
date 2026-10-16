export type StrategyDirection = 'comprehensive' | 'rebuild'

/** Keep original comparisons in the direction page; later pages use this route's own sentences. */
export function currentDirectionText(text: string, direction: StrategyDirection): string {
  const other = direction === 'comprehensive' ? /原拆原建|整体拆建|拆除重建/ : /综合整治/
  return (text.match(/[^。！？；\n]+[。！？；\n]*/gu) || []).filter(sentence => !other.test(sentence)).join('').trim()
}
