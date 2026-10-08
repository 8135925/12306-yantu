import type { QueryParams, QueryResult, ResultRow, TrainItem } from './types'

/** 放票时间信息（预售期推算 + 出发站起售时刻） */
export interface SaleInfo {
  /** 乘车日期 */
  targetDate: string
  /** 起售日期 yyyy-MM-dd */
  saleDate: string
  /** 起售时刻 HH:mm（出发站） */
  saleTime: string | null
  /** 预售期（含乘车日） */
  presaleDays: number
  /** 起售时间表中是否查到该站 */
  found: boolean
}

/**
 * 查询放票时间。
 * 例：今天 2026-09-22 查 2026-10-08 的票 → 起售日 2026-09-24，时刻为出发站起售时刻。
 */
export async function querySaleInfo(date: string, telecode: string): Promise<SaleInfo> {
  const json = (await fetchJson(
    `/api/sale-info?date=${date}&telecode=${encodeURIComponent(telecode)}`,
    15000,
  )) as { status: string; data?: SaleInfo | string }
  if (json.status !== 'success' || !json.data || typeof json.data === 'string') {
    throw new Error(typeof json.data === 'string' ? json.data : '放票时间查询失败')
  }
  return json.data
}

/** 带超时的 JSON 请求（前端侧超时控制，避免后端/网络挂起时页面一直转圈） */
async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ac.signal })
    return await res.json()
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error('请求超时，请稍后再试')
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** 格式化放票提示：已开售 / 今日起售 / 某日起售 */
export function formatSaleNotice(info: SaleInfo, now: Date): string {
  if (!info.found || !info.saleTime) {
    return `「${info.targetDate}」的票 · 起售日 ${info.saleDate}（未查到出发站起售时刻，以 12306 公告为准）`
  }
  const [y, m, d] = info.saleDate.split('-').map(Number)
  const [hh, mm] = info.saleTime.split(':').map(Number)
  const saleAt = new Date(y, m - 1, d, hh, mm)
  if (now >= saleAt) {
    return `「${info.targetDate}」的票 · 已开售（${info.saleDate} ${info.saleTime} 起售）`
  }
  if (now.toDateString() === saleAt.toDateString()) {
    return `「${info.targetDate}」的票 · 今日 ${info.saleTime} 起售`
  }
  return `「${info.targetDate}」的票 · ${m}月${d}日 ${info.saleTime} 起售`
}

/** "8:00-12:00" → "08:00 - 12:00"（后端 suanya 链路要求的时间范围格式） */
function normalizeTimeRange(input: string): string {
  const m = input.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/)
  if (!m) return ''
  const pad = (h: string, mm: string) => `${h.padStart(2, '0')}:${mm}`
  return `${pad(m[1], m[2])} - ${pad(m[3], m[4])}`
}

/**
 * 查询沿途放票方案。
 * 后端：server/index.mjs（suanya 公开接口，不查询 12306）。
 * 车次为空时返回该区间可选项 type=trains；指定车次返回补票方案 type=rows。
 */
export async function queryTickets(p: QueryParams): Promise<QueryResult> {
  const start = performance.now()
  const params = new URLSearchParams({
    station_start: p.from.name,
    station_end: p.to.name,
    date: p.date,
    filter_train_name: p.train.trim().toUpperCase(),
    time_range: normalizeTimeRange(p.timeRange ?? ''),
  })
  // 补票方案涉及 20+ 区间并发查询，给前端留足超时时间
  const json = (await fetchJson(`/api/query?${params}`, 60000)) as {
    status: string
    type?: 'rows' | 'trains'
    data?: unknown
    stops?: string[]
    directPrices?: Record<string, number | null>
    onSale?: boolean
    cached?: boolean
    error?: string
  }
  if (json.status !== 'success') {
    throw new Error((json.data as string) || json.error || '查询失败，请稍后再试')
  }
  const isRows = json.type === 'rows'
  return {
    type: json.type!,
    rows: isRows ? (json.data as ResultRow[]) : [],
    trains: isRows ? [] : (json.data as TrainItem[]),
    stops: isRows ? (json.stops ?? []) : [],
    directPrices: isRows ? (json.directPrices ?? {}) : {},
    date: p.date,
    onSale: !!json.onSale,
    cached: !!json.cached,
    queriedAt: new Date(),
    elapsed: Math.round(performance.now() - start),
  }
}
