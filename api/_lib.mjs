/**
 * yantu 共享查询逻辑（本地 http 服务与 Vercel Serverless Functions 共用）
 *
 * 数据源：同程旅行（suanya.com）公开查询接口，不查询 12306 余票接口。
 * 算法：查询 A→B 车次 → 取该车次经停站 → 「提前上车点 × 补票下车点」区间叉乘
 *       → 并发查询各区间余票 → 计算 多买/少买/票价等派生列。
 * 依赖：无（Node 18+ 内置 fetch）。
 */
import { readFileSync } from 'node:fs'

const SUANYA_BASE = 'https://m.suanya.com/restapi/soa2/14666/json'

// 与 12306spy utils.py 一致的请求头
const HEADERS = {
  authority: 'm.suanya.com',
  accept: '*/*',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'cache-control': 'max-age=0',
  'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'if-modified-since': 'Thu, 01 Jan 1970 00:00:00 GMT',
  origin: 'https://www.suanya.com',
  referer: 'https://www.suanya.com/',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
}

/** 带超时的 POST：上游挂起时按 timeoutMs 中断，避免拖垮整个函数 */
async function postRequest(path, data, timeoutMs = 10000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const resp = await fetch(`${SUANYA_BASE}/${path}`, {
      method: 'POST',
      headers: HEADERS,
      body: new URLSearchParams(data),
      signal: ac.signal,
    })
    if (!resp.ok) throw new Error(`请求失败,状态码:${resp.status}, url=${path}`)
    return await resp.json()
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('上游请求超时，请稍后再试')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** 两站间所有车次 */
async function queryBookingByStation(stationStart, stationEnd, date) {
  const data = await postRequest('GetBookingByStationV3ForPC', {
    ArriveStation: stationEnd,
    ChannelName: 'ctrip.pc',
    DepartDate: date,
    DepartStation: stationStart,
  })
  return data?.ResponseBody?.TrainItems ?? []
}

/** 车次经停站列表 */
async function queryStopList(trainName, date, startStation, endStation) {
  const data = await postRequest('GetTrainStopListV3', {
    TrainName: trainName,
    DepartStation: startStation,
    ArrStation: endStation,
    DepartureDate: date,
  })
  return data?.TrainStopList ?? []
}

/** 提取车次条目的关键信息 */
function extractTrainItem(item) {
  const tickets = item?.TicketResult?.TicketItems ?? []
  const find = (name) => tickets.find((t) => t.SeatTypeName === name) ?? null
  const first = find('一等座')
  const second = find('二等座')
  // 全部席别 → 余票（99=充足，0=无票，其他=具体数量）
  const seats = {}
  const priced = tickets.filter((t) => typeof t.Price === 'number' && t.Price > 0)
  for (const t of tickets) seats[t.SeatTypeName] = t.Inventory ?? null
  return {
    train: item.TrainName,
    startStation: item.StartStationName,
    endStation: item.EndStationName,
    startTime: item.StartTime,
    endTime: item.EndTime,
    useTime: item.UseTime,
    firstPrice: first?.Price ?? null,
    secondPrice: second?.Price ?? null,
    // 计费基准价：优先二等座，无二等座（普速车）时取最低有价席别
    basePrice: second?.Price ?? (priced.length ? Math.min(...priced.map((t) => t.Price)) : 0),
    isCanHB: !!item.IsCanHB, // 该区间是否支持候补
    // 车次级 Bookable = 任一席别可订（不能用于判断未开售）
    isBookable: !!item.Bookable,
    // 分席别可订状态（inv=0 时：席别 Bookable=false → 售罄/不可订，true → 可候补）
    seatBookable: Object.fromEntries(tickets.map((t) => [t.SeatTypeName, !!t.Bookable])),
    seats,
    // 分席别票价（二等座/硬座/硬卧/软卧…）
    seatPrices: Object.fromEntries(tickets.map((t) => [t.SeatTypeName, t.Price ?? null])),
  }
}

const toMin = (t) => {
  const [h, m] = String(t).split(':').map(Number)
  return h * 60 + m
}

/** 在经停站列表中定位站名索引（兼容“站名包含”的情况，与 12306spy 一致） */
function findStopIndex(stopNames, name) {
  const i = stopNames.findIndex((s) => s === name)
  if (i >= 0) return i
  return stopNames.findIndex((s) => s.includes(name) || name.includes(s))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 简易并发池：limit 个 worker 消费任务队列，单个失败不中断整体。
 *  jitter=[min,max] 时，每个任务派发前随机延迟，模拟真人操作节奏、降低被风控概率 */
async function runPool(tasks, limit, jitter) {
  const results = new Array(tasks.length).fill(null)
  let cursor = 0
  const randDelay = jitter
    ? () => jitter[0] + Math.floor(Math.random() * (jitter[1] - jitter[0] + 1))
    : null
  async function worker() {
    while (cursor < tasks.length) {
      const idx = cursor++
      try {
        if (randDelay) await sleep(randDelay())
        results[idx] = await tasks[idx]()
      } catch {
        results[idx] = null
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, worker))
  return results
}

/**
 * 核心查询：指定车次时返回各「提前买/补票」区间方案（type=rows），
 * 未指定车次时返回可选车次列表（type=trains）。
 */
async function queryAnySeat({ stationStart, stationEnd, date, filterTrainName, timeRange }) {
  // 1. 查询两站间所有车次
  let trainItems = await queryBookingByStation(stationStart, stationEnd, date)
  if (!trainItems.length) throw new Error('没有找到车次')

  // 2. 按时间范围过滤
  if (timeRange) {
    const [startTime, endTime] = timeRange.split(' - ')
    trainItems = trainItems.filter((it) => startTime <= it.StartTime && it.StartTime <= endTime)
    if (!trainItems.length) throw new Error('时间范围内没有找到车次')
  }

  // 3. 未指定车次 → 返回车次列表（12306 风格：全部席别余票）
  const trainNames = (filterTrainName ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (!trainNames.length) {
    return {
      type: 'trains',
      data: trainItems.map((it) => {
        // 席别 → 余票（99=充足，0=无票，其他=具体数量）
        const seats = {}
        for (const t of it?.TicketResult?.TicketItems ?? []) {
          seats[t.SeatTypeName] = t.Inventory ?? null
        }
        const useTime = it.UseTime ?? 0
        return {
          train: it.TrainName,
          startStation: it.StartStationName,
          endStation: it.EndStationName,
          startTime: it.StartTime,
          endTime: it.EndTime,
          // 历时 HH:MM
          duration: `${String(Math.floor(useTime / 60)).padStart(2, '0')}:${String(useTime % 60).padStart(2, '0')}`,
          seats,
          isCanHB: !!it.IsCanHB, // 是否支持候补
          bookable: !!it.Bookable, // 车次级：任一席别可订
          seatBookable: Object.fromEntries(
            (it?.TicketResult?.TicketItems ?? []).map((t) => [t.SeatTypeName, !!t.Bookable]),
          ),
        }
      }),
    }
  }

  // 4. 指定车次 → 取第一个匹配项
  const trainItem = trainItems.find((it) => trainNames.includes(it.TrainName))
  if (!trainItem) throw new Error('没有找到符合条件的车次')

  const startName = trainItem.StartStationName // 实际始发站名（同城多站）
  const endName = trainItem.EndStationName
  // 直达（起点→目标站）分席别基准价，用于计算「相比直达」差价
  const directPrices = {}
  for (const t of trainItem?.TicketResult?.TicketItems ?? []) {
    directPrices[t.SeatTypeName] = t.Price ?? null
  }

  // 5. 经停站列表
  const stopList = await queryStopList(trainItem.TrainName, date, startName, endName)
  if (!stopList.length) throw new Error('没有找到经停站信息')
  const stopNames = stopList.map((s) => s.StationName)
  // 站名 → 出发时间（用于匹配区间车次的发车时刻）
  const departureDict = Object.fromEntries(stopList.map((s) => [s.StationName, s.DepartureTime]))

  const middleIdx = findStopIndex(stopNames, startName)
  const endIdx = findStopIndex(stopNames, endName)
  if (middleIdx < 0 || endIdx < 0) throw new Error('经停站中未找到出发/到达站')

  // 6. 叉乘（默认查询顺序，总组合数不变）：
  //    上车点从出发站开始（再逐站往前），下车点从上车点的下一站一直往后查到最后一站。
  //    即：出发站→下一站、出发站→下下站…直到终点；然后出发站前一站→其后各站；依此类推
  const pairs = []
  for (let i = middleIdx; i >= 0; i--) {
    for (let j = i + 1; j < stopNames.length; j++) {
      pairs.push([stopNames[i], stopNames[j]])
    }
  }
  if (!pairs.length) throw new Error('没有找到车次')

  // 7. 并发查询每个区间（10 并发，与 12306spy 一致；派发时加 50~200ms 随机抖动）
  const tasks = pairs.map(([s, e]) => async () => {
    const items = await queryBookingByStation(s, e, date)
    const departTime = departureDict[s]
    const matched = items.filter(
      (it) =>
        it.TrainName === trainItem.TrainName && // 校验车次号，避免误匹配同分钟发车的其他车次
        String(it.StartTime).slice(0, 5) === String(departTime).slice(0, 5) &&
        it.EndStationName === e &&
        it.StartStationName === s,
    )
    return matched.map(extractTrainItem)
  })
  const grouped = await runPool(tasks, 10, [50, 200])

  // 8. 保留任一席别有余票的区间（硬座/无座等普速席别同样计入）；
  //    未开售的区间（Bookable=false，全部席别为 0）也保留，前端显示「未开售」
  let rows = grouped.flat().filter(
    (t) => t && (Object.values(t.seats).some((v) => Number(v) > 0) || !t.isBookable),
  )
  if (!rows.length) throw new Error('所有区间均无余票')

  // 9. 计算派生列
  rows = rows.map((t) => {
    const startMin = toMin(t.startTime)
    let endMin = toMin(t.endTime)
    if (endMin <= startMin) endMin += 1440
    // 跨天天数（相对乘车日）：用行驶时长精确推算，跨 1 个午夜=+1
    const endDay = Math.floor((startMin + (t.useTime ?? 0)) / 1440)

    const startIdx = findStopIndex(stopNames, t.startStation)
    const transferIdx = findStopIndex(stopNames, t.endStation)
    // 多买（站数）：上车点早于出发站 + 目的站超过目标站（多买到目标站之后）
    const beyondTarget = Math.max(0, transferIdx - endIdx)
    const buyMore = Math.max(0, middleIdx - startIdx) + beyondTarget
    const lessBuy = Math.max(0, endIdx - transferIdx) // 少买（站数，需补票）
    // 与查询区间完全等价的方案（两端都无多买/少买；兼容 上海/上海虹桥、民权/民权北 等模糊站名）
    const isDirect = buyMore === 0 && lessBuy === 0

    // 展示分组：
    //   0 = 上车点=出发站（目的站遍历到终点）
    //   1 = 上车点在出发站之前，且下车点=终点（各上车点的「直达终点」行）
    //   2 = 其余组合（提前上车 + 中途下车）
    const group = startIdx === middleIdx ? 0 : transferIdx === stopNames.length - 1 ? 1 : 2

    return {
      originTrain: trainItem.TrainName, // 上车站车次
      startStation: t.startStation, // 起点站（实际上车点）
      transferStation: t.endStation, // 目的站（下车/补票站）
      startTime: t.startTime, // 上车时刻
      endTime: t.endTime, // 下车时刻
      endDay, // 下车跨天标识：0=当天，1=次日(+1)…
      train: t.train,
      buyMore,
      lessBuy,
      total: buyMore + lessBuy,
      isDirect, // 是否为与查询区间一致的直达方案
      isCanHB: t.isCanHB, // 是否支持候补
      isBookable: t.isBookable, // 车次级：任一席别可订
      seatBookable: t.seatBookable, // 分席别可订状态
      seats: t.seats, // 全部席别余票
      seatPrices: t.seatPrices, // 全部席别票价
      url: `https://www.suanya.com/pages/trainList?fromCn=${encodeURIComponent(t.startStation)}&toCn=${encodeURIComponent(t.endStation)}&fromDate=${date}#:~:text=${t.train}`,
      _group: group, // 内部排序用，返回前剔除
    }
  })

  // 10. 分组排序（稳定排序，组内保持查询顺序）：
  //     ① 上车点=出发站，目的站遍历到终点
  //     ② 各前一站的「直达终点」行：兰考→上海、开封→上海、…、银川→上海
  //     ③ 其余「提前上车 + 中途下车」组合
  rows.sort((a, b) => a._group - b._group)
  for (const r of rows) delete r._group
  return { type: 'rows', data: rows, stops: stopNames, directPrices }
}

// ==================== 放票时间（起售时间）查询 ====================
// 规则：
// 1) 火车票预售期为 15 天（含乘车日），如 2026-10-08 的票在 2026-09-24 起售；
// 2) 每个车站有固定起售时刻（8:00~18:00 半小时一档），按【出发站】查询；
// 3) 数据源：12306 官方「起售时间」查询接口（公开信息查询，非余票接口），
//    即官方页面 https://kyfw.12306.cn/index/view/infos/sale_time.html 背后使用的接口。
const PRESALE_DAYS = 15 // 预售期（含乘车日）。12306 公告调整时改这里即可
const SALE_TIME_URL = 'https://www.12306.cn/index/otn/index12306/queryAllCacheSaleTime'
const SALE_TIME_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'User-Agent': HEADERS['user-agent'],
  Referer: 'https://kyfw.12306.cn/index/view/infos/sale_time.html',
}
let saleTimeCache = { table: null, fetchedAt: 0 }
const SALE_TIME_TTL = 60 * 60 * 1000 // 全站表缓存 1 小时

/** 拉取 12306 全站起售时间表（[{station_telecode, sale_time:"HHmm", start_date, stop_date}]） */
async function getSaleTimeTable() {
  if (saleTimeCache.table && Date.now() - saleTimeCache.fetchedAt < SALE_TIME_TTL) {
    return saleTimeCache.table
  }
  const r = await fetch(SALE_TIME_URL, {
    method: 'POST',
    headers: SALE_TIME_HEADERS,
    signal: AbortSignal.timeout(15000), // 起售时间表 15s 超时
  })
  if (!r.ok) throw new Error(`起售时间表请求失败:${r.status}`)
  const j = await r.json()
  if (!j.status || !Array.isArray(j.data)) throw new Error('起售时间表数据异常')
  saleTimeCache = { table: j.data, fetchedAt: Date.now() }
  return saleTimeCache.table
}

/** 日期加减天数，返回 yyyy-MM-dd */
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  const p = (n) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

/** 乘车日是否已开售：乘车日 ≤ 今天 + (预售期-1) 天 */
function isDateOnSale(dateStr) {
  const now = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const lastSaleDate = addDays(
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`,
    PRESALE_DAYS - 1,
  )
  return dateStr <= lastSaleDate
}

/**
 * 放票时间查询：GET /api/sale-info?date=2026-10-08&telecode=AOH
 * 返回 { targetDate, saleDate, saleTime, presaleDays, found }
 */
async function handleSaleInfo(query) {
  const targetDate = query.get('date') ?? ''
  const telecode = (query.get('telecode') ?? '').trim().toUpperCase()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || !telecode) {
    throw new Error('缺少参数 date(yyyy-MM-dd) 或 telecode')
  }
  // 预售期推算：乘车日 - (预售期-1) 天 = 起售日
  const saleDate = addDays(targetDate, -(PRESALE_DAYS - 1))
  const saleDateCmp = saleDate.replace(/-/g, '')

  // 查表：优先取起售日当天生效的记录，其次任意生效记录
  const table = await getSaleTimeTable()
  const rows = table.filter((d) => d.station_telecode === telecode)
  if (!rows.length) {
    return { targetDate, saleDate, saleTime: null, presaleDays: PRESALE_DAYS, found: false }
  }
  const valid = rows.filter(
    (d) => d.start_date <= saleDateCmp && saleDateCmp <= d.stop_date,
  )
  const hit = (valid.length ? valid : rows).sort((a, b) =>
    (b.start_date ?? '').localeCompare(a.start_date ?? ''),
  )[0]
  const st = String(hit.sale_time)
  const saleTime = `${st.slice(0, 2)}:${st.slice(2, 4)}`
  return { targetDate, saleDate, saleTime, presaleDays: PRESALE_DAYS, found: true }
}

// ==================== 查询缓存（相同参数 60s 内直接返回，防风控 + 提速） ====================
const QUERY_CACHE_TTL = 60 * 1000 // 缓存时长：60 秒
const QUERY_CACHE_MAX = 200 // 最大缓存条目数
const queryCache = new Map() // key=参数JSON, value={expires, value}

/** 查缓存：命中且未过期返回 true */
function cacheGet(key) {
  const cached = queryCache.get(key)
  return !!(cached && cached.expires > Date.now())
}

/** 写缓存：超出上限时淘汰最早的条目 */
function cacheSet(key, value) {
  queryCache.set(key, { expires: Date.now() + QUERY_CACHE_TTL, value })
  if (queryCache.size > QUERY_CACHE_MAX) {
    const oldest = queryCache.keys().next().value
    if (oldest !== undefined) queryCache.delete(oldest)
  }
}

/** 查缓存取值 */
function cacheValue(key) {
  return queryCache.get(key)?.value
}

// ==================== 配置文件（项目根目录 config.json，可选；默认关闭限流） ====================
const CONFIG_DEFAULTS = {
  rateLimit: { enabled: false, perMinute: 10 },
}

function loadConfig() {
  try {
    const raw = readFileSync(new URL('../config.json', import.meta.url), 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      rateLimit: { ...CONFIG_DEFAULTS.rateLimit, ...(parsed.rateLimit ?? {}) },
    }
  } catch {
    // 配置文件缺失/解析失败时使用默认值（限流关闭）
    return CONFIG_DEFAULTS
  }
}

export const APP_CONFIG = loadConfig()

// ==================== IP 限流（config.json rateLimit.enabled 控制，默认关闭） ====================
const rateMap = new Map() // ip -> { count, resetAt }

/** 计数并判断是否放行；开关关闭时始终放行 */
function checkRateLimit(ip) {
  const rl = APP_CONFIG.rateLimit
  if (!rl.enabled) return true
  const now = Date.now()
  let entry = rateMap.get(ip)
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + 60000 }
    rateMap.set(ip, entry)
  }
  entry.count += 1
  return entry.count <= (rl.perMinute ?? 10)
}

/** 从请求头/连接信息提取客户端 IP */
function getClientIp(req) {
  const xff = String(req.headers?.['x-forwarded-for'] ?? '')
  return xff.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown'
}

/** JSON 响应（本地 http 与 Vercel Node 函数的 res 均兼容） */
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': '*',
    'Access-Control-Allow-Headers': '*',
  })
  res.end(body)
}

export {
  HEADERS,
  queryAnySeat,
  handleSaleInfo,
  isDateOnSale,
  queryCache,
  cacheGet,
  cacheSet,
  cacheValue,
  QUERY_CACHE_TTL,
  QUERY_CACHE_MAX,
  checkRateLimit,
  getClientIp,
  sendJson,
}
