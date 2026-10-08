/**
 * Vercel Serverless Function：GET /api/query
 * 参数：station_start, station_end, date, filter_train_name, time_range
 */
import { queryAnySeat, isDateOnSale, cacheGet, cacheValue, cacheSet, checkRateLimit, getClientIp, sendJson } from './_lib.mjs'

export default async function handler(req, res) {
  // IP 限流：每 IP 每分钟 10 次
  if (!checkRateLimit(getClientIp(req))) {
    sendJson(res, 429, { status: 'fail', data: '查询过于频繁，请 1 分钟后再试' })
    return
  }
  const url = new URL(req.url, `https://${req.headers.host ?? 'localhost'}`)
  const q = url.searchParams
  const params = {
    stationStart: q.get('station_start') ?? '',
    stationEnd: q.get('station_end') ?? '',
    date: q.get('date') ?? '',
    filterTrainName: q.get('filter_train_name') ?? '',
    timeRange: q.get('time_range') ?? '',
  }
  if (!params.stationStart || !params.stationEnd || !params.date) {
    sendJson(res, 400, { status: 'fail', data: '缺少参数 station_start / station_end / date' })
    return
  }

  // 查询缓存：相同参数 60s 内直接返回（防风控 + 提速）
  const cacheKey = JSON.stringify(params)
  if (cacheGet(cacheKey)) {
    sendJson(res, 200, { ...cacheValue(cacheKey), cached: true })
    return
  }

  try {
    const { type, data, stops, directPrices } = await queryAnySeat(params)
    const value = { status: 'success', type, data, stops, directPrices, onSale: isDateOnSale(params.date) }
    cacheSet(cacheKey, value)
    sendJson(res, 200, value)
  } catch (e) {
    // 失败结果不缓存，便于立即重试
    sendJson(res, 200, { status: 'fail', data: e.message })
  }
}
