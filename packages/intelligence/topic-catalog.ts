/** Shared, data-backed research questions. Topic grouping does not merge project/event identity. */
export const TOPICS=[
  {id:'water',title:'二次供水与管网更新',question:'改哪些对象、如何分期，工程与维护责任怎样衔接？',terms:['二次供水','供水改造','供水管网','雨污分流']},
  {id:'elevator',title:'加装电梯与适老更新',question:'哪些楼栋适用、怎样协商出资，后续利用与维护如何核实？',terms:['加装电梯','加梯','电梯更新','既有住宅增设电梯']},
  {id:'dining',title:'社区食堂与助餐运营',question:'怎样确定服务规模、用餐需求、补贴与持续运营条件？',terms:['社区食堂','老年食堂','助餐','幸福食堂','长者饭堂']},
  {id:'renewal-mode',title:'改造模式与自主更新',question:'综合整治与原拆原建分别需要哪些条件，哪些证据会改变方向？',terms:['原拆原建','自主更新','拆除重建','综合整治','危旧房改造']},
  {id:'planning',title:'权属规划与实施审批',question:'产权、用地、保护和规划许可如何影响方案边界与实施程序？',terms:['产权登记','不动产权','规划许可','历史建筑保护','用地性质']},
  {id:'structure',title:'房屋安全与抗震加固',question:'鉴定与检测如何对应具体楼栋，修缮、加固和重建怎样比选？',terms:['房屋安全','结构鉴定','安全鉴定','抗震加固','危房治理']},
  {id:'drainage',title:'排水防涝与雨污分流',question:'积水、错混接与管网容量怎样识别，如何确定改造顺序和效果？',terms:['雨污分流','排水管网','易涝点','海绵化改造','错混接']},
  {id:'envelope',title:'屋面外墙与节能修缮',question:'渗漏、脱落和能耗问题对应哪些做法，工程量与验收如何核实？',terms:['屋面防水','外墙修缮','外立面改造','建筑节能','外墙保温']},
  {id:'fire',title:'消防设施与疏散安全',question:'消防通道、设备和电气隐患如何排查，整改与验收怎样闭环？',terms:['消防通道','消防设施','消防改造','电气火灾','生命通道']},
  {id:'utilities',title:'燃气电力与管线整治',question:'老化管线怎样统筹改造，停供安排、产权和移交责任如何协调？',terms:['燃气管道','燃气改造','强弱电','架空线','管线入地','供电改造']},
  {id:'parking',title:'停车充电与慢行交通',question:'停车缺口、充电需求和人车冲突怎样测量，空间与运营如何平衡？',terms:['停车泊位','停车难','充电桩','充电设施','慢行交通']},
  {id:'accessibility',title:'无障碍与适老环境',question:'哪些通行节点和家庭需要优先改善，设计与实际使用怎样对应？',terms:['无障碍','适老化','轮椅通行','适老设施','坡道改造']},
  {id:'care',title:'社区养老与健康服务',question:'照护、助医和活动需求怎样转化为服务容量、人员与维护安排？',terms:['居家养老','养老服务','社区卫生','长者照护','颐康中心']},
  {id:'childcare',title:'托育与儿童友好空间',question:'儿童与家庭需求如何核实，托育供给和活动空间怎样配置？',terms:['托育服务','托育机构','儿童友好','儿童活动','普惠托育']},
  {id:'public-space',title:'公共空间与便民设施',question:'绿地、活动场所与便民服务如何补缺，建设与使用效果怎样评价？',terms:['公共空间','口袋公园','活动场地','党群服务','便民市场']},
  {id:'residents',title:'居民需求与协商共治',question:'居民诉求、分层满意度、议事和表决怎样支撑方案调整与实施？',terms:['居民意愿','居民协商','民意调查','业主表决','居民满意度']},
  {id:'delivery',title:'改造招采与工程交付',question:'标段、施工组织和分期怎样衔接，质量、扰民与验收如何管理？',terms:['改造工程总承包','老旧小区改造项目','施工组织','竣工验收','改造招标']},
  {id:'funding',title:'出资机制与资金平衡',question:'政府、居民和社会资本如何分担，已落实资金与缺口怎样核算？',terms:['专项债','资金平衡','财政补助','居民出资','维修资金','社会资本']},
  {id:'cost',title:'工程造价与成本参考',question:'预算、招标和结算如何分阶段同口径比较，哪些参数适合迁移？',terms:['工程造价','最高投标限价','竣工结算','单方造价','预算审核']},
  {id:'property',title:'物业治理与长效管护',question:'改造后由谁管、如何收费和履约，费用及维护责任怎样持续落实？',terms:['物业服务','物业费','长效管理','管护机制','业主委员会']},
  {id:'operations',title:'运营收益与绩效评价',question:'财务与社会效果如何分别计量，服务人次、利用率和运维如何跟踪？',terms:['运营收益','绩效评价','服务人次','运维成本','资产运营']},
] as const
export type TopicId=typeof TOPICS[number]['id']
export const TOPIC_GROUPS=[
  {id:'direction',label:'方向与条件',topics:['renewal-mode','planning']},
  {id:'engineering',label:'安全与工程',topics:['structure','water','drainage','envelope','fire','utilities','elevator','parking','accessibility']},
  {id:'services',label:'公共服务',topics:['dining','care','childcare','public-space']},
  {id:'implementation',label:'协商与交付',topics:['residents','delivery']},
  {id:'finance',label:'资金与运营',topics:['funding','cost','property','operations']},
] as const
export const topicGroup=(id:TopicId)=>TOPIC_GROUPS.find(group=>(group.topics as readonly string[]).includes(id))!
export function topicOf(id:string){const topic=TOPICS.find(t=>t.id===id);if(!topic)throw Error('WIKI_TOPIC_NOT_FOUND');return topic}
