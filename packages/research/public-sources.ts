export type PublicSourceTier = 'primary_database' | 'official_publication' | 'supplementary'

export type PublicSourceCatalogItem = {
  id: string
  name: string
  domains: readonly string[]
  tier: Exclude<PublicSourceTier, 'supplementary'>
  uses: readonly string[]
}

export const PUBLIC_SOURCE_CATALOG: readonly PublicSourceCatalogItem[] = [
  { id: 'landchina', name: '中国土地市场网', domains: ['landchina.com'], tier: 'primary_database', uses: ['土地出让', '供地结果', '地块公示', '供地计划'] },
  { id: 'investment', name: '全国投资项目在线审批监管平台', domains: ['tzxm.gov.cn'], tier: 'primary_database', uses: ['项目代码', '审批核准备案', '项目办理结果'] },
  { id: 'public_resource', name: '全国公共资源交易平台', domains: ['ggzy.gov.cn'], tier: 'primary_database', uses: ['工程建设交易', '土地使用权交易', '政府采购', '国有产权'] },
  { id: 'construction', name: '全国建筑市场监管公共服务平台', domains: ['jzsc.mohurd.gov.cn'], tier: 'primary_database', uses: ['工程项目', '参建单位', '建设规模', '企业业绩'] },
  { id: 'enterprise', name: '国家企业信用信息公示系统', domains: ['gsxt.gov.cn'], tier: 'primary_database', uses: ['企业主体', '经营异常', '严重违法失信'] },
  { id: 'credit', name: '信用中国', domains: ['creditchina.gov.cn'], tier: 'primary_database', uses: ['行政许可', '行政处罚', '信用记录'] },
  { id: 'statistics', name: '国家统计局数据发布库', domains: ['data.stats.gov.cn'], tier: 'primary_database', uses: ['人口', '就业', '固定资产投资', '房地产', '消费'] },
  { id: 'public_data_registry', name: '国家公共数据资源登记平台', domains: ['sjdj.nda.gov.cn'], tier: 'primary_database', uses: ['公共数据目录', '数据资源发现'] },
  { id: 'hangzhou_open_data', name: '杭州市数据开放平台', domains: ['data.hangzhou.gov.cn'], tier: 'primary_database', uses: ['杭州公共数据', '数据集', 'API'] },
  { id: 'tianditu', name: '天地图', domains: ['webmap.cn', 'tianditu.gov.cn'], tier: 'primary_database', uses: ['基础地理信息', '影像', '自然资源专题'] },
] as const

const hostMatches = (hostname: string, domain: string) => hostname === domain || hostname.endsWith('.' + domain)

export function classifyPublicSource(url: string): { tier: PublicSourceTier; catalog_id: string | null; label: string } {
  let hostname = ''
  try { hostname = new URL(url).hostname.toLowerCase() } catch { return { tier: 'supplementary', catalog_id: null, label: '补充来源' } }
  for (const item of PUBLIC_SOURCE_CATALOG) {
    if (item.domains.some(domain => hostMatches(hostname, domain))) return { tier: item.tier, catalog_id: item.id, label: item.name }
  }
  if (hostname.startsWith('data.') && hostname.endsWith('.gov.cn')) return { tier: 'primary_database', catalog_id: null, label: '地方公共数据开放平台' }
  if (hostname === 'gov.cn' || hostname.endsWith('.gov.cn')) return { tier: 'official_publication', catalog_id: null, label: '政府公开来源' }
  return { tier: 'supplementary', catalog_id: null, label: '补充来源' }
}

export type PublicSearchNeed = {
  id: string
  purpose: string
  queries: readonly string[]
}

export function publicSearchPlan(region: string): readonly PublicSearchNeed[] {
  const place = region.replace(/[\r\n<>]/g, ' ').trim().slice(0, 100)
  return [
    {
      id: 'land_planning',
      purpose: '核对土地、供地与规划实施前提',
      queries: [
        `${place} 土地 出让 供地结果 地块公示 site:landchina.com`,
        `${place} 国土空间规划 控制性详细规划 用地 site:gov.cn`,
      ],
    },
    {
      id: 'project_approval',
      purpose: '核对项目身份、审批备案与建设进展',
      queries: [
        `${place} 项目代码 审批 备案 site:tzxm.gov.cn`,
        `${place} 施工许可 竣工验收 工程项目 site:mohurd.gov.cn`,
      ],
    },
    {
      id: 'transactions',
      purpose: '核对公开交易与实施主体',
      queries: [
        `${place} 工程建设 土地使用权 成交 site:ggzy.gov.cn`,
        `${place} 招标 中标 项目 建设单位`,
      ],
    },
    {
      id: 'enterprise',
      purpose: '核对企业主体、信用与项目经验',
      queries: [
        `${place} 企业 统一社会信用代码 site:gsxt.gov.cn`,
        `${place} 建设 企业 项目 业绩 site:jzsc.mohurd.gov.cn`,
      ],
    },
    {
      id: 'demand',
      purpose: '核对人口、就业、产业与实际需求背景',
      queries: [
        `${place} 人口 就业 固定资产投资 统计`,
        `${place} 开放数据 企业 就业 商务楼宇`,
      ],
    },
    {
      id: 'current_context',
      purpose: '补充最新政策、公告、运营与案例资料',
      queries: [
        `${place} 城市更新 产业 园区 运营 项目 公告`,
        `${place} 存量建筑 改造 招商 运营`,
      ],
    },
  ]
}

export const PUBLIC_SOURCE_POLICY = [
  'primary_database：可作为结构化事实的首选来源。',
  'official_publication：用于政策、规划、公告和项目正文。',
  'supplementary：用于发现线索、市场解释和反证，重要事实需回查公开数据库或政府原文。',
  '商业地图POI只做对象发现与空间线索，不直接生成需求、权属、审批或投资结论。',
] as const
