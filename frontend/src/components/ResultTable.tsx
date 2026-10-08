import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ResultRow } from '../types'

type ColKey = keyof Omit<ResultRow, 'seats' | 'seatPrices' | 'seatBookable'> | '__index'

const COLUMNS: Array<{ key: ColKey; title: string; red?: boolean; tip?: string }> = [
  { key: '__index', title: '#' },
  { key: 'originTrain', title: '上车站车次' },
  { key: 'startStation', title: '起点站' },
  { key: 'transferStation', title: '目的站' },
  { key: 'train', title: '车次' },
  { key: 'buyMore', title: '多买' },
  { key: 'lessBuy', title: '少买' },
  { key: 'total', title: '多买+少买' },
]

/** 票价三列：高铁看二等座，普速车看硬座/卧铺；值右侧括号内为相比直达的差价 */
const PRICE_COLS: Array<{ title: string; seats: string[]; tip: string }> = [
  {
    title: '二等座票价(元)',
    seats: ['二等座'],
    tip: '高铁按二等座票价；括号内为相比直达二等座票价的差价',
  },
  {
    title: '硬座票价(元)',
    seats: ['硬座'],
    tip: '普速列车硬座票价；括号内为相比直达硬座票价的差价',
  },
  {
    title: '卧铺票价(元)',
    seats: ['硬卧', '软卧', '一等卧', '二等卧', '动卧', '高级软卧'],
    tip: '普速列车卧铺票价（硬卧优先，无硬卧依次取软卧/一等卧/二等卧/动卧）；括号内为相比直达同席别的差价',
  },
]

/** 补票方案界面固定显示的席位列（商务/特等座合并为一列；无该席别显示 --） */
const SEAT_COLS: Array<{ key: string; title: string; alt?: string; sortable?: boolean }> = [
  { key: '商务座', title: '商务/特等座', alt: '特等座' },
  { key: '优选一等座', title: '优选一等座' },
  { key: '一等座', title: '一等座', sortable: true },
  { key: '二等座', title: '二等座', sortable: true },
  { key: '高级软卧', title: '高级软卧' },
  { key: '软卧', title: '软卧' },
  { key: '硬卧', title: '硬卧', sortable: true },
  { key: '软座', title: '软座' },
  { key: '硬座', title: '硬座', sortable: true },
  { key: '无座', title: '无座' },
]

/** 席别余票单元格：99=有 / 数字 / 0=候补|无票|未开售 / -- */
function seatCellText(
  v: number | null | undefined,
  canHB: boolean,
  seatBookable: boolean | undefined,
  onSale: boolean,
): { text: string; cls?: string; tip?: string } {
  if (v == null) return { text: '--', cls: 'seat-na' }
  if (v === 99) return { text: '有', cls: 'seat-many' }
  if (v > 0) return { text: String(v), cls: 'seat-num' }
  // v === 0
  if (!onSale) {
    return {
      text: '未开售',
      cls: 'seat-pre',
      tip: '乘车日超出预售期（15 天），尚未开始出售',
    }
  }
  if (seatBookable && canHB) {
    return {
      text: '候补',
      cls: 'seat-hb',
      tip: '已售完，但可提交候补订单排队',
    }
  }
  return {
    text: '无票',
    cls: 'seat-none',
    tip: '已售罄或票额尚未投放（12306 分时段放票，后续可能放出）；不支持候补',
  }
}

/** 站名 + 时刻单元格；跨天时刻右上角显示 +1/+2 标识 */
function stationCell(name: string, time: string, day: number) {
  return (
    <>
      {name} <span className="stop-time">
        {time}
        {day > 0 && <sup className="day-badge">+{day}</sup>}
      </span>
    </>
  )
}

/** 在经停站列表中定位站名（兼容站名互相包含的情况） */
function findStopIdx(stops: string[], name: string): number {
  const i = stops.indexOf(name)
  if (i >= 0) return i
  return stops.findIndex((s) => s.includes(name) || name.includes(s))
}

/**
 * 地铁线式经停图：一条横线串起全部车站，
 * 高亮选中方案的「起点站 → 补票站」区间。
 */
function LineMap({
  stops,
  startIdx,
  endIdx,
  wrapRef,
}: {
  stops: string[]
  startIdx: number
  endIdx: number
  wrapRef: React.MutableRefObject<HTMLDivElement | null>
}) {
  const n = stops.length
  // 等宽槽位布局：第 i 个站点的圆心位于 ((i+0.5)/n)*100% 处，百分比条与圆点严格对齐
  // 高亮条用 transform（合成器动画）代替 left/width（布局动画），避免切换行时整页重排
  const translateX = ((startIdx + 0.5) / n) * 100
  const scaleX = (endIdx - startIdx) / n
  return (
    <div className="line-map-wrap" ref={wrapRef}>
      <div className="line-map" style={{ width: `max(100%, ${n * 52}px)` }}>
        <div className="line-bar" style={{ left: `${50 / n}%`, right: `${50 / n}%` }} />
        <div
          className="line-bar-active"
          style={{
            width: '100%',
            transform: `translateX(${translateX}%) scaleX(${scaleX})`,
            transformOrigin: 'left center',
          }}
        />
        {stops.map((name, i) => {
          const inRange = i >= startIdx && i <= endIdx
          const endpoint = i === startIdx || i === endIdx
          return (
            <div
              key={i}
              className={'line-stop' + (inRange ? ' in-range' : '') + (endpoint ? ' endpoint' : '')}
            >
              <div className="line-dot" />
              <div className="line-name">{name}</div>
            </div>
          )
        })}
      </div>
      <div className="line-legend">
        乘车区间：<b>{stops[startIdx]}</b>（上车） → <b>{stops[endIdx]}</b>（目的站）
      </div>
    </div>
  )
}

interface Props {
  rows: ResultRow[]
  /** 当前车次全部经停站（按顺序）；为空时不渲染线路图 */
  stops: string[]
  /** 直达（起点→目标站）分席别基准价 */
  directPrices: Record<string, number | null>
  /** 查询乘车日期，用于链接显示（如 2026.09.23） */
  date: string
  /** 乘车日是否已开售（未开售时席别显示「未开售」） */
  onSale: boolean
  /** 当前选中的方案行 */
  selectedIdx: number
  onSelect: (idx: number) => void
  /** 席别余票列排序状态（由父组件持有，保证键盘导航与显示顺序一致） */
  seatSort: { col: string; dir: 1 | -1 } | null
  /** 点击可排序席别表头 */
  onSortSeat: (col: string) => void
}

/** 票价单元格数据：价格 + 右侧括号内相比直达同席别的差价（+红 / -绿 / 0 不显示） */
function priceCellData(
  row: ResultRow,
  seatKeys: string[],
  directPrices: Record<string, number | null>,
): { cls?: string; content: React.ReactNode } {
  let price: number | null = null
  let direct: number | null = null
  for (const k of seatKeys) {
    const p = row.seatPrices[k]
    if (p != null) {
      price = p
      direct = directPrices[k] ?? null
      break
    }
  }
  if (price == null) return { cls: 'seat-na', content: '--' }
  const diff = direct != null ? Math.round(price - direct) : null
  return {
    content: (
      <>
        {price}
        {diff != null && diff !== 0 && (
          <span className={'seat-diff ' + (diff > 0 ? 'diff-up' : 'diff-down')}>
            {diff > 0 ? `(+${diff})` : `(${diff})`}
          </span>
        )}
      </>
    ),
  }
}

/** 单行组件（memo 化：点击换行时仅新旧两行重渲染，避免整表重建导致卡顿） */
const Row = memo(function Row({
  row,
  index,
  isSelected,
  isExact,
  directPrices,
  date,
  onSale,
  onSelect,
}: {
  row: ResultRow
  index: number
  isSelected: boolean
  isExact: boolean
  directPrices: Record<string, number | null>
  date: string
  onSale: boolean
  onSelect: (idx: number) => void
}) {
  return (
    <tr
      className={[isSelected && 'selected', isExact && 'exact'].filter(Boolean).join(' ') || undefined}
      title="点击选中，在线路图上查看区间"
      onClick={() => onSelect(index)}
    >
      {COLUMNS.map((c) => {
        // 起点/目的站：站名 + 时刻（跨天显示 +N）
        if (c.key === 'startStation') {
          return <td key={c.title}>{stationCell(row.startStation, row.startTime, 0)}</td>
        }
        if (c.key === 'transferStation') {
          return <td key={c.title}>{stationCell(row.transferStation, row.endTime, row.endDay)}</td>
        }
        const v = c.key === '__index' ? index + 1 : row[c.key as Exclude<ColKey, '__index'>]
        const red = c.red && typeof v === 'number' && v > 0
        return (
          <td key={c.title} className={red ? 'red' : undefined}>
            {v}
            {c.key === '__index' && isExact && <span className="direct-tag">直达</span>}
          </td>
        )
      })}
      {PRICE_COLS.map((c) => {
        const cell = priceCellData(row, c.seats, directPrices)
        return (
          <td key={c.title} className={cell.cls}>
            {cell.content}
          </td>
        )
      })}
      {SEAT_COLS.map((c) => {
        let v = row.seats[c.key]
        if (v == null && c.alt) v = row.seats[c.alt]
        const cell = seatCellText(v, row.isCanHB, row.seatBookable?.[c.key], onSale)
        return (
          <td key={c.title} className={cell.cls} title={cell.tip}>
            {cell.text}
          </td>
        )
      })}
      <td>{date.replace(/-/g, '.')}</td>
    </tr>
  )
})

export default function ResultTable({
  rows,
  stops,
  directPrices,
  date,
  onSale,
  selectedIdx,
  onSelect,
  seatSort,
  onSortSeat,
}: Props) {
  // 选中行变化时（含键盘切换）：仅当目标行不在可视区时才滚动
  // （无条件 scrollIntoView 会强制同步布局整张宽表，是切换卡顿的主因之一）
  const tbodyRef = useRef<HTMLTableSectionElement>(null)
  useEffect(() => {
    const tbody = tbodyRef.current
    if (!tbody) return
    const tr = tbody.children[Math.min(Math.max(selectedIdx, 0), tbody.children.length - 1)] as
      | HTMLElement
      | undefined
    if (!tr) return
    const rect = tr.getBoundingClientRect()
    const topLimit = lineRef.current?.offsetHeight ?? 0
    const inView = rect.top >= topLimit && rect.bottom <= window.innerHeight
    if (!inView) tr.scrollIntoView({ block: 'nearest' })
  }, [selectedIdx])

  // 测量线路图高度，供表头 sticky 偏移使用（表头吸附在线路图下方）
  const lineRef = useRef<HTMLDivElement | null>(null)
  const [lineH, setLineH] = useState(0)
  const showLine = rows.length > 1 && stops.length > 1
  useLayoutEffect(() => {
    const el = lineRef.current
    if (!el || !showLine) return
    const update = () => setLineH(el.offsetHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [showLine, stops])

  if (!rows.length) {
    return <div className="empty">未查询到可补票区间</div>
  }
  const sel = Math.min(Math.max(selectedIdx, 0), rows.length - 1)
  const selRow = rows[sel]
  const startIdx = stops.length ? Math.max(0, findStopIdx(stops, selRow.startStation)) : -1
  const endIdx = stops.length ? Math.max(0, findStopIdx(stops, selRow.transferStation)) : -1
  const showLineNow = showLine && startIdx >= 0 && endIdx > startIdx

  return (
    <>
      {showLineNow && (
        <LineMap stops={stops} startIdx={startIdx} endIdx={endIdx} wrapRef={lineRef} />
      )}
      <div
        className="table-wrap"
        style={{ ['--linemap-h' as never]: showLineNow ? `${lineH}px` : '0px' }}
      >
        <table className="result-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.title} title={c.tip}>
                  {c.title}
                </th>
              ))}
              {PRICE_COLS.map((c) => (
                <th key={c.title} title={c.tip}>
                  {c.title}
                </th>
              ))}
              {SEAT_COLS.map((c) =>
                c.sortable ? (
                  <th
                    key={c.title}
                    className="th-sort"
                    title="点击排序：票数多 → 有 → 候补 → 无"
                    onClick={() => onSortSeat(c.key)}
                  >
                    {c.title}余票
                    {seatSort?.col === c.key && (
                      <span className="sort-arrow">{seatSort.dir === 1 ? '▼' : '▲'}</span>
                    )}
                  </th>
                ) : (
                  <th key={c.title}>{c.title}余票</th>
                ),
              )}
              <th>日期</th>
            </tr>
          </thead>
          <tbody ref={tbodyRef}>
            {rows.map((row, i) => (
              <Row
                key={i}
                row={row}
                index={i}
                isSelected={i === sel}
                isExact={row.isDirect}
                directPrices={directPrices}
                date={date}
                onSale={onSale}
                onSelect={onSelect}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
