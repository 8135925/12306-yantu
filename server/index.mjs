/**
 * yantu 本地开发服务（生产部署使用 Vercel Serverless Functions，见 api/）
 *
 * 复用 api/_lib.mjs 的共享查询逻辑，仅提供本地 http 入口：
 *   - GET /api/query      补票方案 / 车次列表
 *   - GET /api/sale-info  放票时间（预售期推算 + 起售时刻）
 *   - GET /api/health     健康检查
 * 端口 3000（frontend/vite.config.ts 已将 /api 代理至此）。
 * 启动：node server/index.mjs
 */
import http from 'node:http'
import {
  queryAnySeat,
  handleSaleInfo,
  isDateOnSale,
  cacheGet,
  cacheValue,
  cacheSet,
  checkRateLimit,
  getClientIp,
  sendJson,
} from '../api/_lib.mjs'

const PORT = process.env.PORT || 3000

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {})
    return
  }
  const url = new URL(req.url, `http://localhost:${PORT}`)

  // IP 限流：每 IP 每分钟 10 次
  if (url.pathname === '/api/query' && !checkRateLimit(getClientIp(req))) {
    sendJson(res, 429, { status: 'fail', data: '查询过于频繁，请 1 分钟后再试' })
    return
  }

  if (url.pathname === '/api/health') {
    sendJson(res, 200, { status: 'ok' })
    return
  }

  if (url.pathname === '/api/query') {
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
    return
  }

  if (url.pathname === '/api/sale-info') {
    try {
      const data = await handleSaleInfo(url.searchParams)
      sendJson(res, 200, { status: 'success', data })
    } catch (e) {
      sendJson(res, 200, { status: 'fail', data: e.message })
    }
    return
  }

  sendJson(res, 404, { status: 'fail', data: 'not found' })
})

server.listen(PORT, () => {
  console.log(`yantu 查询服务已启动: http://localhost:${PORT}`)
})
