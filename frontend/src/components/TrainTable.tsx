import type { TrainItem } from '../types'

/** 席别列（顺序与 12306 余票列表一致；商务/特等座合并为一列） */
const SEAT_COLS: Array<{ key: string; title: string; alt?: string }> = [
  { key: '商务座', title: '商务/特等座', alt: '特等座' },
  { key: '优选一等座', title: '优选一等座' },
  { key: '一等座', title: '一等座' },
  { key: '二等座', title: '二等座' },
  { key: '高级软卧', title: '高级软卧' },
  { key: '软卧', title: '软卧' },
  { key: '硬卧', title: '硬卧' },
  { key: '软座', title: '软座' },
  { key: '硬座', title: '硬座' },
  { key: '无座', title: '无座' },
]

interface Cell {
  text: string
  cls?: string
}

/** 席别余票渲染：-- 灰 / 未开售 紫 / 候补 橙 / 无票 灰 / 有 绿 / 数字 蓝 */
function seatCell(
  t: TrainItem,
  col: (typeof SEAT_COLS)[number],
  onSale: boolean,
): Cell & { tip?: string } {
  let v = t.seats[col.key]
  if (v == null && col.alt) v = t.seats[col.alt]
  if (v == null) return { text: '--', cls: 'seat-na' }
  if (v === 99) return { text: '有', cls: 'seat-many' }
  if (v > 0) return { text: String(v), cls: 'seat-num' }
  // v === 0
  if (!onSale) {
    return { text: '未开售', cls: 'seat-pre', tip: '乘车日超出预售期（15 天），尚未开始出售' }
  }
  const seatOk = t.seatBookable?.[col.key]
  if (seatOk && t.isCanHB) {
    return { text: '候补', cls: 'seat-hb', tip: '已售完，但可提交候补订单排队' }
  }
  return {
    text: '无票',
    cls: 'seat-none',
    tip: '已售罄或票额尚未投放（12306 分时段放票，后续可能放出）；不支持候补',
  }
}

/** 12306 风格余票列表：点击行选择该车次查询补票方案 */
export default function TrainTable({
  trains,
  onSale,
  onPick,
}: {
  trains: TrainItem[]
  /** 乘车日是否已开售（未开售时席别显示「未开售」） */
  onSale: boolean
  onPick: (train: string) => void
}) {
  if (!trains.length) {
    return <div className="empty">未查询到车次</div>
  }
  return (
    <div className="table-wrap">
      <table className="result-table train-table">
        <thead>
          <tr>
            <th>车次</th>
            <th>出发地</th>
            <th>目的地</th>
            <th>历时</th>
            {SEAT_COLS.map((c) => (
              <th key={c.title}>{c.title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trains.map((t, i) => (
            <tr
              key={t.train + i}
              className="train-row"
              title={`点击查询 ${t.train} 的补票方案`}
              onClick={() => onPick(t.train)}
            >
              <td className="train-code">{t.train}</td>
              <td>
                {t.startStation}
                <span className="train-time">{t.startTime}</span>
              </td>
              <td>
                {t.endStation}
                <span className="train-time">{t.endTime}</span>
              </td>
              <td>{t.duration}</td>
              {SEAT_COLS.map((c) => {
                const cell = seatCell(t, c, onSale)
                return (
                  <td key={c.title} className={cell.cls} title={cell.tip}>
                    {cell.text}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
