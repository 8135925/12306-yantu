/**
 * Vercel Serverless Function：GET /api/sale-info
 * 参数：date(yyyy-MM-dd), telecode(出发站电报码)
 */
import { handleSaleInfo, sendJson } from './_lib.mjs'

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host ?? 'localhost'}`)
  try {
    const data = await handleSaleInfo(url.searchParams)
    sendJson(res, 200, { status: 'success', data })
  } catch (e) {
    sendJson(res, 200, { status: 'fail', data: e.message })
  }
}
