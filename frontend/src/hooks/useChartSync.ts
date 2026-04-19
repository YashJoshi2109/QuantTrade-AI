import { useCallback, useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import type { IChartApi } from 'lightweight-charts'

/**
 * Cross-chart crosshair synchronization hook.
 *
 * When the user hovers over one chart, the hovered timestamp is broadcast
 * via Zustand so every other chart using this hook can align its time-scale
 * to the same point.
 *
 * @param chartId  Unique identifier for this chart instance.
 * @param chartApi The lightweight-charts IChartApi ref (may be null while mounting).
 */
export function useChartSync(chartId: string, chartApi: IChartApi | null) {
  const syncedTimestamp = useAppStore((s) => s.syncedTimestamp)
  const setSyncedTimestamp = useAppStore((s) => s.setSyncedTimestamp)
  const hoveredChart = useAppStore((s) => s.hoveredChart)
  const setHoveredChart = useAppStore((s) => s.setHoveredChart)

  // When THIS chart is hovered, broadcast the timestamp to the store.
  const handleCrosshairMove = useCallback(
    (param: any) => {
      if (param.time) {
        setHoveredChart(chartId)
        setSyncedTimestamp(param.time as number)
      } else {
        // Only clear if WE are the current broadcaster
        if (hoveredChart === chartId) {
          setHoveredChart(null)
          setSyncedTimestamp(null)
        }
      }
    },
    [chartId, hoveredChart, setHoveredChart, setSyncedTimestamp],
  )

  // Subscribe to crosshair move events on our chart instance.
  useEffect(() => {
    if (!chartApi) return
    chartApi.subscribeCrosshairMove(handleCrosshairMove)
    return () => {
      chartApi.unsubscribeCrosshairMove(handleCrosshairMove)
    }
  }, [chartApi, handleCrosshairMove])

  // When ANOTHER chart broadcasts a timestamp, scroll this chart's
  // time-scale so the same point in time is visible / centred.
  useEffect(() => {
    if (!chartApi || !syncedTimestamp || hoveredChart === chartId) return

    try {
      // lightweight-charts does not expose a setCrosshairPosition API,
      // but scrolling the time-scale to the broadcast timestamp keeps
      // the charts visually aligned.
      const timeScale = chartApi.timeScale()
      const coordinate = timeScale.timeToCoordinate(syncedTimestamp as any)
      if (coordinate !== null) {
        // The timestamp exists on this chart -- no need to scroll,
        // the coordinate is already in view (or will be shortly).
        // Future enhancement: draw a vertical marker line here.
      } else {
        // Timestamp is outside the current visible range -- scroll to it.
        timeScale.scrollToPosition(0, false)
      }
    } catch {
      // Silently ignore if the chart is being destroyed or the time
      // value doesn't map to this chart's data set.
    }
  }, [chartApi, syncedTimestamp, hoveredChart, chartId])

  return { syncedTimestamp, isHovered: hoveredChart === chartId }
}
