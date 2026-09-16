/** Base ECharts: tema (claro/escuro) lido dos tokens CSS, redimensionamento e opções comuns.
 *  Regras aplicadas em todos os gráficos: marcas finas, grade discreta em linha sólida,
 *  eixo único (nunca dois eixos Y), legenda presente a partir de 2 séries e tooltip com crosshair. */
import { BarChart, CustomChart, HeatmapChart, LineChart, SankeyChart, ScatterChart } from 'echarts/charts'
import {
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef, useState } from 'react'

import { resolveColor } from '../../lib/colors'

echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  HeatmapChart,
  SankeyChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  MarkAreaComponent,
  MarkPointComponent,
  VisualMapComponent,
  DatasetComponent,
  CanvasRenderer,
])

export interface ChartTheme {
  ink: string
  ink2: string
  muted: string
  grid: string
  surface: string
  axis: string
}

/** Recalcula as cores quando o tema muda (toggle do usuário ou preferência do sistema). */
export function useChartTheme(): ChartTheme {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const onChange = () => setVersion((v) => v + 1)
    window.addEventListener('ee-theme', onChange)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', onChange)
    return () => {
      window.removeEventListener('ee-theme', onChange)
      mq.removeEventListener('change', onChange)
    }
  }, [])
  void version
  return {
    ink: resolveColor('var(--ink)'),
    ink2: resolveColor('var(--ink-2)'),
    muted: resolveColor('var(--muted)'),
    grid: resolveColor('var(--line)'),
    surface: resolveColor('var(--surface)'),
    axis: resolveColor('var(--line)'),
  }
}

export function baseOption(theme: ChartTheme) {
  return {
    animationDuration: 300,
    textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: theme.ink2 },
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    tooltip: {
      backgroundColor: theme.surface,
      borderColor: resolveColor('var(--edge)'),
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: theme.ink, fontSize: 12 },
      extraCssText: 'box-shadow: 0 8px 24px rgba(0,0,0,.14); border-radius: 8px;',
      confine: true,
    },
    legend: {
      type: 'scroll',
      top: 0,
      left: 0,
      itemGap: 14,
      itemWidth: 12,
      itemHeight: 8,
      icon: 'roundRect',
      textStyle: { color: theme.ink2, fontSize: 11 },
      pageIconColor: theme.ink2,
      pageTextStyle: { color: theme.ink2 },
    },
  }
}

export function axisStyle(theme: ChartTheme, opts: { grid?: boolean } = {}) {
  return {
    axisLine: { show: true, lineStyle: { color: theme.axis, width: 1 } },
    axisTick: { show: false },
    axisLabel: { color: theme.muted, fontSize: 11, hideOverlap: true },
    splitLine: { show: opts.grid ?? false, lineStyle: { color: theme.grid, width: 1, type: 'solid' } },
  }
}

export function EChart({
  option,
  height = 260,
  onEvent,
  className,
}: {
  option: Record<string, unknown>
  height?: number | string
  onEvent?: Record<string, (params: unknown) => void>
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    chart.current = echarts.init(ref.current, undefined, { renderer: 'canvas' })
    const observer = new ResizeObserver(() => chart.current?.resize())
    observer.observe(ref.current)
    return () => {
      observer.disconnect()
      chart.current?.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true })
  }, [option])

  useEffect(() => {
    const c = chart.current
    if (!c || !onEvent) return
    Object.entries(onEvent).forEach(([evt, handler]) => c.on(evt, handler))
    return () => {
      Object.keys(onEvent).forEach((evt) => c.off(evt))
    }
  }, [onEvent])

  return <div ref={ref} className={className} style={{ height, width: '100%' }} />
}
