import { useEffect, useMemo, useRef, useState } from 'react'
import type { Station } from '../types'

interface Props {
  label: string
  value: Station | null
  stations: Station[]
  placeholder?: string
  disabled?: boolean
  onChange: (s: Station | null) => void
}

interface Matched {
  station: Station
  groupFirst: boolean
}

/** 站名 / 全拼 / 拼音缩写匹配，上限 30 条 */
function match(stations: Station[], keyword: string): Station[] {
  const k = keyword.trim().toLowerCase()
  if (!k) return []
  return stations
    .filter((s) => s.name.includes(k) || s.pinyin.startsWith(k) || s.abbr.startsWith(k))
    .slice(0, 30)
}

/**
 * 可搜索站点选择器（combobox）
 * 交互与 cankao/index.html 对齐：站名/拼音/缩写匹配、按城市分组、
 * ↑↓ 移动高亮、Enter 选中、Esc 关闭、失焦收起。
 */
export default function StationPicker({ label, value, stations, placeholder, disabled, onChange }: Props) {
  const [text, setText] = useState(value?.name ?? '')
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const blurTimer = useRef<number | undefined>(undefined)

  // 外部值变化（如出发/到达互换）时同步输入框
  useEffect(() => {
    setText(value?.name ?? '')
  }, [value])

  const items = useMemo(() => match(stations, text), [stations, text])

  const openList = (list: Station[]) => {
    setActiveIdx(list.length ? 0 : -1)
    setOpen(true)
  }

  const pick = (s: Station) => {
    onChange(s)
    setText(s.name)
    setOpen(false)
  }

  const handleInput = (v: string) => {
    onChange(null)
    setText(v)
    openList(match(stations, v))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!items.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIdx >= 0) pick(items[activeIdx])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  // 渲染分组：城市变化处插入分组标题
  const rendered: Matched[] = []
  let lastCity: string | null = null
  for (const s of items) {
    const groupFirst = s.city !== lastCity
    if (groupFirst) lastCity = s.city
    rendered.push({ station: s, groupFirst })
  }

  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <div className="combo">
        <input
          type="text"
          value={text}
          disabled={disabled}
          placeholder={placeholder ?? '站名 / 拼音 / 缩写'}
          title="支持三种输入：站名（如 上海）、全拼（如 shanghai）、拼音缩写（如 sh）；从联想列表中选择后生效"
          autoComplete="off"
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => openList(items)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            blurTimer.current = window.setTimeout(() => setOpen(false), 150)
          }}
        />
        {open && rendered.length > 0 && (
          <div className="suggestions">
            {rendered.map(({ station, groupFirst }, i) => (
              <div key={station.code + i}>
                {groupFirst && <div className="group-title">{station.city}</div>}
                <div
                  className={'item' + (i === activeIdx ? ' active' : '')}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    window.clearTimeout(blurTimer.current)
                    pick(station)
                  }}
                >
                  <span className="n">{station.name}</span>
                  <span className="c">{station.code}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
