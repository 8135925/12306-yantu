/** 站点字典条目（来自 public/stations.json，由 scripts/gen_stations.py 生成） */
export interface Station {
  /** 站名，如：上海虹桥 */
  name: string
  /** 三字电报码，如：AOH */
  code: string
  /** 全拼，如：shanghaihongqiao */
  pinyin: string
  /** 拼音缩写，如：shhq */
  abbr: string
  /** 城市归属，如：上海 */
  city: string
}

export interface StationsData {
  source: string
  count: number
  stations: Station[]
}

/** 查询入参 */
export interface QueryParams {
  /** 验证日期 yyyy-MM-dd */
  date: string
  /** 车次，如 G1914；为空时返回车次列表 */
  train: string
  /** 出发站 */
  from: Station
  /** 目标站 */
  to: Station
  /** 时间范围（可选），如 08:00-12:00 */
  timeRange?: string
}

/**
 * 补票/买长乘短区间方案行（由后端 suanya 链路计算，参考 cankao2/12306spy）
 */
export interface ResultRow {
  /** 上车站车次（原始车次） */
  originTrain: string
  /** 起点站（实际上车点，可能比目标出发站提前） */
  startStation: string
  /** 目的站（下车/补票站） */
  transferStation: string
  /** 上车时刻 HH:MM */
  startTime: string
  /** 下车时刻 HH:MM */
  endTime: string
  /** 下车跨天标识：0=当天，1=次日(+1)… */
  endDay: number
  /** 车次 */
  train: string
  /** 多买（站数）：上车点早于出发站 + 目的站超过目标站 */
  buyMore: number
  /** 少买（站数，需补票） */
  lessBuy: number
  /** 多买+少买 */
  total: number
  /** 是否为与查询区间一致的直达方案（重点标注行） */
  isDirect: boolean
  /** 该区间是否支持候补 */
  isCanHB: boolean
  /** 是否已开售（false=未开售，全部席别显示「未开售」） */
  isBookable: boolean
  /** 分席别可订状态（inv=0 时：false=售罄/不可订，true=可候补） */
  seatBookable: Record<string, boolean>
  /** 全部席别余票（99=充足，0=无票，其他=具体数量） */
  seats: Record<string, number | null>
  /** 全部席别票价（分席别真实价格） */
  seatPrices: Record<string, number | null>
  /** 车次链接 */
  url: string
}

/** 未指定车次时返回的可选车次（12306 风格余票列表） */
export interface TrainItem {
  train: string
  startStation: string
  endStation: string
  startTime: string
  endTime: string
  /** 历时 HH:MM */
  duration: string
  /** 席别 → 余票（99=充足，0=无票/未开售，其他=具体数量，缺失=该车无此席别） */
  seats: Record<string, number | null>
  /** 是否支持候补 */
  isCanHB: boolean
  /** 车次级：任一席别可订 */
  bookable: boolean
  /** 分席别可订状态 */
  seatBookable: Record<string, boolean>
}

export interface QueryResult {
  /** rows=区间方案；trains=车次列表 */
  type: 'rows' | 'trains'
  rows: ResultRow[]
  trains: TrainItem[]
  /** 补票方案视图附带：当前车次的全部经停站（按顺序），用于线路图展示 */
  stops: string[]
  /** 直达（起点→目标站）分席别基准价，用于「相比直达」差价 */
  directPrices: Record<string, number | null>
  /** 本次查询使用的乘车日期 */
  date: string
  /** 乘车日是否已开售（超出预售期=false） */
  onSale: boolean
  /** 是否命中 60s 查询缓存 */
  cached: boolean
  queriedAt: Date
  elapsed: number
}
