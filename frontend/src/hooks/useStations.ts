import { useEffect, useState } from 'react'
import type { StationsData } from '../types'

export function useStations() {
  const [data, setData] = useState<StationsData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/stations.json')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d: StationsData) => {
        if (!cancelled) setData(d)
      })
      .catch((e) => {
        if (!cancelled) setError('站点字典加载失败：' + e.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const stations = data?.stations ?? []
  const cityCount = data ? new Set(stations.map((s) => s.city)).size : 0
  return { stations, count: data?.count ?? 0, cityCount, loading: !data && !error, error }
}
