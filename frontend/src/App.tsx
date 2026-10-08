import { useEffect, useMemo, useRef, useState } from 'react'
import type { QueryResult, ResultRow, Station } from './types'
import { useStations } from './hooks/useStations'
import { formatSaleNotice, querySaleInfo, queryTickets } from './api'
import type { SaleInfo } from './api'
import StationPicker from './components/StationPicker'
import ResultTable from './components/ResultTable'
import TrainTable from './components/TrainTable'

/** 默认日期 */
const DEFAULT_DATE = '2026-09-23'

/** 日期平移 N 天，返回 yyyy-MM-dd（日期左右按钮用） */
function shiftDate(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + delta)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

/** 时间范围下拉选项（默认全天） */
const TIME_RANGE_OPTIONS = ['00:00-24:00', '00:00-06:00', '06:00-12:00', '12:00-18:00', '18:00-24:00']

/** 车次类型筛选项（按车次首字母分类） */
type TrainType = 'all' | 'gd' | 'ktz'
const TRAIN_TYPE_OPTIONS: Array<{ value: TrainType; label: string }> = [
  { value: 'all', label: '全部车型' },
  { value: 'gd', label: '高铁动车(G/D/C)' },
  { value: 'ktz', label: '普速(K/T/Z等)' },
]

/** 席别余票列排序状态：col=席别名，dir=1 票数多在前 / -1 反向 */
type SeatSort = { col: string; dir: 1 | -1 } | null

/** 余票排序键：数字票数多优先 → 有(99) → 候补(0可候补) → 无(0) → 未开售 → --(null) */
function seatSortKey(row: ResultRow, col: string, onSale: boolean): number {
  const v = row.seats[col]
  if (v == null) return 1e9 + 4
  if (v === 99) return 1e9
  if (v > 0) return -v
  // v === 0
  if (!onSale) return 1e9 + 3 // 未开售排在无之后
  return row.isCanHB ? 1e9 + 1 : 1e9 + 2
}

export default function App() {
  const { stations, loading, error } = useStations()

  const [from, setFrom] = useState<Station | null>(null)
  const [to, setTo] = useState<Station | null>(null)
  const [date, setDate] = useState(DEFAULT_DATE)
  const [timeRange, setTimeRange] = useState('00:00-24:00')
  const [train, setTrain] = useState('')

  const [result, setResult] = useState<QueryResult | null>(null)
  /** 补票方案表中当前选中的行（联动线路图高亮区间） */
  const [selectedIdx, setSelectedIdx] = useState(0)
  /** 席别余票列排序 */
  const [seatSort, setSeatSort] = useState<SeatSort>(null)
  const [querying, setQuerying] = useState(false)
  const [queryError, setQueryError] = useState('')

  // 补票方案展示行：按席别列表头排序（默认保持后端查询顺序）
  const displayRows = useMemo<ResultRow[]>(() => {
    if (!result || result.type !== 'rows' || !seatSort) return result?.rows ?? []
    const { col, dir } = seatSort
    const onSale = result.onSale
    return [...result.rows].sort(
      (a, b) => (seatSortKey(a, col, onSale) - seatSortKey(b, col, onSale)) * dir,
    )
  }, [result, seatSort])

  // 车次列表：按车次类型过滤（纯前端，零额外请求）
  const [trainType, setTrainType] = useState<TrainType>('all')
  /** 车次列表「只看有票」：任一席别余票 > 0 才显示 */
  const [onlyAvailable, setOnlyAvailable] = useState(false)
  const displayTrains = useMemo(() => {
    if (!result || result.type !== 'trains') return []
    let trains = result.trains
    if (trainType !== 'all') {
      const isHsr = (code: string) => ['G', 'D', 'C'].includes(code.toUpperCase())
      trains = trains.filter((t) => isHsr(t.train[0] ?? '') === (trainType === 'gd'))
    }
    if (onlyAvailable) {
      trains = trains.filter((t) => Object.values(t.seats).some((v) => Number(v) > 0))
    }
    return trains
  }, [result, trainType, onlyAvailable])

  // 默认站点：出发站=上海，目标站=民权（字典加载完成后回填）
  useEffect(() => {
    if (!stations.length) return
    setFrom((prev) => prev ?? stations.find((s) => s.name === '上海') ?? null)
    setTo((prev) => prev ?? stations.find((s) => s.name === '民权') ?? null)
  }, [stations])

  // 放票时间：选定出发站 + 乘车日期后自动查询（预售期推算 + 出发站起售时刻）
  const [saleNotice, setSaleNotice] = useState('')

  useEffect(() => {
    if (!from || !date) {
      setSaleNotice('')
      return
    }
    let cancelled = false
    querySaleInfo(date, from.code)
      .then((info: SaleInfo) => {
        if (!cancelled) setSaleNotice(formatSaleNotice(info, new Date()))
      })
      .catch(() => {
        if (!cancelled) setSaleNotice('')
      })
    return () => {
      cancelled = true
    }
  }, [from, date])

  const swap = () => {
    setFrom(to)
    setTo(from)
    setTrain('') // 交换后原车次大概率不再适用，清空以便重新选择
  }

  /** 执行查询；train 为空时后端返回车次列表供选择（进行中直接忽略，请求去重） */
  const doQuery = async (trainOverride?: string) => {
    if (querying) return
    const f = from
    const t = to
    if (!f || !t) {
      setQueryError('请先从字典中选择出发站与目标站')
      return
    }
    setQueryError('')
    setQuerying(true)
    try {
      const r = await queryTickets({
        date,
        train: (trainOverride ?? train).trim(),
        from: f,
        to: t,
        timeRange,
      })
      setResult(r)
      setSelectedIdx(0)
      setSeatSort(null)
    } catch (e) {
      setQueryError(e instanceof Error ? e.message : '查询失败，请稍后再试')
      setResult(null)
    } finally {
      setQuerying(false)
    }
  }

  /** 车次列表中点击某车次 → 填入车次并直接查询补票方案 */
  const pickTrain = (t: string) => {
    setTrain(t)
    doQuery(t)
  }

  /** 返回车次列表：清空车次并重新查询，可另选车次 */
  const backToTrains = () => {
    setTrain('')
    doQuery('')
  }

  // 首次进入页面：默认站点（民权→上海）回填后自动查询一次
  const autoQueried = useRef(false)
  useEffect(() => {
    if (autoQueried.current || !from || !to) return
    autoQueried.current = true
    doQuery()
    // 仅在默认站点首次回填时触发一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  // 补票方案列表：键盘 ↑↓ 切换选中行（输入框内操作时忽略）
  useEffect(() => {
    if (result?.type !== 'rows' || !result.rows.length) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIdx((i) => Math.min(i + 1, result.rows.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIdx((i) => Math.max(i - 1, 0))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [result])

  return (
    <>
      <header className="topbar" />
      <div className="page">
        <section className="card">
          <div className="query-row">
            <div className="query-item grow">
              <StationPicker
                label="出发站"
                value={from}
                stations={stations}
                disabled={loading}
                onChange={setFrom}
              />
            </div>
            <button className="swap-btn" onClick={swap} title="交换出发站与目的站" disabled={loading}>
              ⇄
            </button>
            <div className="query-item grow">
              <StationPicker
                label="目的站"
                value={to}
                stations={stations}
                disabled={loading}
                onChange={setTo}
              />
            </div>
            <div className="query-item">
              <div className="field">
                <label className="field-label">日期</label>
                <div className="date-group">
                  <button
                    type="button"
                    className="day-btn"
                    title="前一天"
                    onClick={() => setDate(shiftDate(date, -1))}
                  >
                    ◀
                  </button>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  <button
                    type="button"
                    className="day-btn"
                    title="后一天"
                    onClick={() => setDate(shiftDate(date, 1))}
                  >
                    ▶
                  </button>
                </div>
              </div>
            </div>
            <div className="query-item">
              <div className="field">
                <label className="field-label">时间范围</label>
                <select value={timeRange} onChange={(e) => setTimeRange(e.target.value)}>
                  {TIME_RANGE_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="query-item">
              <div className="field">
                <label className="field-label">车次</label>
                <input
                  type="text"
                  value={train}
                  placeholder="如 G1914（留空列出全部）"
                  onChange={(e) => setTrain(e.target.value)}
                />
              </div>
            </div>
            <div className="query-item">
              <div className="field">
                <label className="field-label">车次类型</label>
                <select value={trainType} onChange={(e) => setTrainType(e.target.value as TrainType)}>
                  {TRAIN_TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button className="btn primary query-btn" onClick={() => doQuery()} disabled={querying}>
              {querying ? '查询中…' : '查询'}
            </button>
          </div>

          {(queryError || error) && <div className="msg error">{queryError || error}</div>}
          {saleNotice && <div className="msg sale">🕒 {saleNotice}（预售期 15 天，按出发站起售时刻）</div>}
        </section>

        {result && (
          <section className="card">
            <div className="query-meta">
              {result.type === 'rows' && (
                <button className="btn back-btn" onClick={backToTrains} disabled={querying}>
                  ← 返回车次列表
                </button>
              )}
              查询时间: {result.queriedAt.toLocaleString('zh-CN')}　耗时: {result.elapsed}ms
              {result.cached && (
                <span className="mock-tag" title="相同参数 60s 内直接返回缓存结果">
                  缓存命中(60s)
                </span>
              )}
              {result.type === 'rows' && (
                <span className="mock-tag">共 {displayRows.length} 个补票方案 · 键盘 ↑↓ 切换行</span>
              )}
              {result.type === 'trains' && (
                <>
                  <span className="mock-tag">
                    共 {displayTrains.length} 个车次，请选择车次查询补票方案
                  </span>
                  <label className="toggle-item" title="只显示任一席别有余票的车次">
                    <input
                      type="checkbox"
                      checked={onlyAvailable}
                      onChange={(e) => setOnlyAvailable(e.target.checked)}
                    />
                    只看有票
                  </label>
                </>
              )}
            </div>
            {result.type === 'rows' ? (
              <ResultTable
                rows={displayRows}
                stops={result.stops}
                directPrices={result.directPrices}
                date={result.date}
                onSale={result.onSale}
                selectedIdx={selectedIdx}
                onSelect={setSelectedIdx}
                seatSort={seatSort}
                onSortSeat={(col) =>
                  setSeatSort((prev) =>
                    !prev || prev.col !== col
                      ? { col, dir: 1 }
                      : prev.dir === 1
                        ? { col, dir: -1 }
                        : null,
                  )
                }
              />
            ) : (
              <TrainTable trains={displayTrains} onSale={result.onSale} onPick={pickTrain} />
            )}
          </section>
        )}

        <footer className="footer">
          yantu · 数据源 同程旅行公开查询接口 · 仅查询，不代购 · 仅供学习研究
        </footer>
      </div>
    </>
  )
}
