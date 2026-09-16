/** Biblioteca de gráficos do dashboard.
 *  Forma escolhida pelo trabalho do dado: linha (tendência), barra (comparação), empilhada (composição),
 *  Sankey (fluxo de energia), heatmap (matriz), dispersão (energia × produção), Pareto (concentração),
 *  bullet (meta × realizado). Nenhum gráfico usa dois eixos Y. */
import { Table2, LineChart as LineIcon } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

import { DIVERGING, SEQUENTIAL, resolveColor, seriesColor } from '../../lib/colors'
import { EMPTY, fmtAuto, fmtAxis, fmtNum, fmtPct } from '../../lib/format'
import { Card, CardHeader, Segmented, cn } from '../ui/primitives'
import { EChart, axisStyle, baseOption, useChartTheme } from './EChart'

/* ------------------------------------------------------------------ container */

export interface TableView {
  columns: string[]
  rows: (string | number | null)[][]
}

export function ChartCard({
  title,
  subtitle,
  actions,
  note,
  table,
  children,
  className,
  icon,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  note?: ReactNode
  table?: TableView
  children: ReactNode
  className?: string
  icon?: ReactNode
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        actions={
          <div className="flex items-center gap-2">
            {actions}
            {table && (
              <Segmented
                size="sm"
                value={view}
                onChange={(v) => setView(v)}
                options={[
                  { value: 'chart', label: <LineIcon size={13} />, title: 'Gráfico' },
                  { value: 'table', label: <Table2 size={13} />, title: 'Tabela (acessível)' },
                ]}
              />
            )}
          </div>
        }
      />
      <div className="min-w-0 flex-1 p-2">
        {view === 'chart' || !table ? (
          children
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <table className="table">
              <thead>
                <tr>
                  {table.columns.map((c) => (
                    <th key={c} className={c === table.columns[0] ? '' : 'right'}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className={j === 0 ? '' : 'right'}>
                        {cell === null || cell === undefined ? EMPTY : typeof cell === 'number' ? fmtAuto(cell) : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {note && <p className="border-t border-edge px-4 py-2 text-[11px] text-muted">{note}</p>}
    </Card>
  )
}

/* ------------------------------------------------------------------ séries temporais */

export interface Serie {
  name: string
  values: (number | null)[]
  color?: string
  type?: 'line' | 'bar'
  stack?: string
  area?: boolean
  dashed?: boolean
  width?: number
  hideSymbol?: boolean
}

export interface RefLine {
  name: string
  value: number
  color?: string
  dashed?: boolean
}

export function TimeSeriesChart({
  x,
  series,
  refLines = [],
  band,
  markers = [],
  unit,
  decimals,
  height = 260,
  showLegend,
  zeroBased = true,
}: {
  x: string[]
  series: Serie[]
  refLines?: RefLine[]
  band?: { from: number; to: number; name?: string; color?: string }
  markers?: { index: number; name: string }[]
  unit?: string
  decimals?: number
  height?: number
  showLegend?: boolean
  zeroBased?: boolean
}) {
  const theme = useChartTheme()
  const option = useMemo(() => {
    const legend = showLegend ?? series.length > 1
    const hasBars = series.some((s) => s.type === 'bar')
    const echartsSeries = series.map((s, i) => {
      const color = resolveColor(s.color ?? seriesColor(i + 1))
      if (s.type === 'bar') {
        return {
          name: s.name,
          type: 'bar',
          stack: s.stack,
          data: s.values,
          barMaxWidth: 24,
          itemStyle: { color, borderColor: theme.surface, borderWidth: s.stack ? 2 : 0, borderRadius: s.stack ? 0 : [3, 3, 0, 0] },
          emphasis: { focus: 'series' },
        }
      }
      return {
        name: s.name,
        type: 'line',
        data: s.values,
        connectNulls: false,
        showSymbol: !s.hideSymbol && x.length <= 40,
        symbolSize: 7,
        smooth: false,
        lineStyle: { width: s.width ?? 2, color, type: s.dashed ? 'dashed' : 'solid' },
        itemStyle: { color, borderColor: theme.surface, borderWidth: 2 },
        areaStyle: s.area ? { color, opacity: 0.1 } : undefined,
        z: s.dashed ? 2 : 3,
        emphasis: { focus: 'series' },
        markLine:
          i === 0 && (refLines.length || markers.length)
            ? {
                symbol: 'none',
                silent: true,
                data: refLines.map((r) => ({
                  yAxis: r.value,
                  lineStyle: { color: resolveColor(r.color ?? 'var(--muted)'), type: r.dashed === false ? 'solid' : 'dashed', width: 1.5 },
                  label: {
                    formatter: `${r.name}: ${fmtAuto(r.value, decimals)}`,
                    position: 'insideEndTop',
                    color: theme.ink2,
                    fontSize: 10,
                    backgroundColor: theme.surface,
                    padding: [2, 4],
                    borderRadius: 3,
                  },
                })),
              }
            : undefined,
        markArea:
          i === 0 && band
            ? {
                silent: true,
                itemStyle: { color: resolveColor(band.color ?? 'var(--accent)'), opacity: 0.07 },
                data: [[{ yAxis: band.from, name: band.name }, { yAxis: band.to }]],
              }
            : undefined,
        markPoint:
          i === 0 && markers.length
            ? {
                symbol: 'circle',
                symbolSize: 10,
                data: markers.map((m) => ({
                  name: m.name,
                  xAxis: m.index,
                  yAxis: series[0].values[m.index] ?? 0,
                  itemStyle: { color: resolveColor('var(--critical)'), borderColor: theme.surface, borderWidth: 2 },
                })),
                label: { show: false },
              }
            : undefined,
      }
    })
    return {
      ...baseOption(theme),
      grid: { left: 8, right: refLines.length ? 70 : 16, top: legend ? 30 : 14, bottom: 4, containLabel: true },
      legend: { ...baseOption(theme).legend, show: legend },
      tooltip: {
        ...baseOption(theme).tooltip,
        trigger: 'axis',
        axisPointer: { type: hasBars ? 'shadow' : 'line', lineStyle: { color: theme.muted, width: 1 } },
        valueFormatter: (v: number) => (v === null || v === undefined ? EMPTY : `${fmtAuto(v, decimals)}${unit ? ` ${unit}` : ''}`),
      },
      xAxis: { type: 'category', data: x, boundaryGap: hasBars, ...axisStyle(theme) },
      yAxis: {
        type: 'value',
        scale: !zeroBased,
        // A unidade fica no subtítulo do card quando há legenda, para não colidir com ela.
        name: legend ? undefined : unit,
        nameTextStyle: { color: theme.muted, fontSize: 10, align: 'left' },
        nameGap: 10,
        ...axisStyle(theme, { grid: true }),
        axisLine: { show: false },
        axisLabel: { color: theme.muted, fontSize: 11, formatter: fmtAxis },
      },
      series: echartsSeries,
    }
  }, [x, series, refLines, band, markers, unit, decimals, theme, showLegend, zeroBased])

  return <EChart option={option} height={height} />
}

export function seriesTable(x: string[], series: Serie[], unit?: string): TableView {
  return {
    columns: ['Período', ...series.map((s) => `${s.name}${unit ? ` (${unit})` : ''}`)],
    rows: x.map((label, i) => [label, ...series.map((s) => s.values[i] ?? null)]),
  }
}

/* ------------------------------------------------------------------ barras por categoria */

export function CategoryBars({
  categories,
  series,
  unit,
  decimals,
  height = 260,
  horizontal = true,
  showValues = true,
  colorByCategory,
}: {
  categories: string[]
  series: { name: string; values: (number | null)[]; color?: string }[]
  unit?: string
  decimals?: number
  height?: number
  horizontal?: boolean
  showValues?: boolean
  colorByCategory?: (string | undefined)[]
}) {
  const theme = useChartTheme()
  const option = useMemo(() => {
    const valueAxis = {
      type: 'value',
      ...axisStyle(theme, { grid: true }),
      axisLine: { show: false },
      axisLabel: { color: theme.muted, fontSize: 11, formatter: fmtAxis },
    }
    const catAxis = { type: 'category', data: categories, ...axisStyle(theme), axisLabel: { color: theme.ink2, fontSize: 11, width: 150, overflow: 'truncate' } }
    return {
      ...baseOption(theme),
      grid: { left: 8, right: showValues ? 56 : 16, top: series.length > 1 ? 26 : 8, bottom: 4, containLabel: true },
      legend: { ...baseOption(theme).legend, show: series.length > 1 },
      tooltip: {
        ...baseOption(theme).tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v: number) => (v == null ? EMPTY : `${fmtAuto(v, decimals)}${unit ? ` ${unit}` : ''}`),
      },
      xAxis: horizontal ? valueAxis : catAxis,
      yAxis: horizontal ? { ...catAxis, inverse: true } : valueAxis,
      series: series.map((s, i) => ({
        name: s.name,
        type: 'bar',
        data: s.values.map((v, idx) => ({
          value: v,
          itemStyle: colorByCategory?.[idx] ? { color: resolveColor(colorByCategory[idx] as string) } : undefined,
        })),
        barMaxWidth: 22,
        barGap: '12%',
        barCategoryGap: '38%',
        itemStyle: {
          color: resolveColor(s.color ?? seriesColor(i + 1)),
          borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
        },
        label:
          showValues && i === 0
            ? {
                show: true,
                position: horizontal ? 'right' : 'top',
                color: theme.ink2,
                fontSize: 11,
                formatter: (p: { value: number }) => (p.value == null ? '' : fmtAuto(p.value, decimals)),
              }
            : { show: false },
        emphasis: { focus: 'series' },
      })),
    }
  }, [categories, series, unit, decimals, theme, horizontal, showValues, colorByCategory])
  return <EChart option={option} height={height} />
}

/* ------------------------------------------------------------------ Sankey */

export interface SankeyData {
  nodes: { name: string; kind: string; color_slot?: number | null }[]
  links: { source: string; target: string; value: number; carrier?: string | null }[]
  unit?: string
}

export function SankeyChart({ data, height = 420 }: { data: SankeyData; height?: number }) {
  const theme = useChartTheme()
  const option = useMemo(() => {
    const colorOf = (kind: string, slot?: number | null) => {
      if (kind === 'carrier') return resolveColor(seriesColor(slot ?? 1))
      if (kind === 'area') return resolveColor(seriesColor(slot ?? 1))
      if (kind === 'loss') return resolveColor('var(--muted)')
      if (kind === 'unallocated') return resolveColor('var(--neutral)')
      if (kind === 'internal') return resolveColor('var(--s4)')
      if (kind === 'category') return resolveColor(seriesColor(slot ?? 3))
      return resolveColor('var(--accent)')
    }
    return {
      ...baseOption(theme),
      tooltip: {
        ...baseOption(theme).tooltip,
        trigger: 'item',
        formatter: (p: { dataType: string; data: { source?: string; target?: string; name?: string; value?: number }; value?: number }) =>
          p.dataType === 'edge'
            ? `${p.data.source} → ${p.data.target}<br/><b>${fmtNum(p.data.value ?? 0, 1)} ${data.unit ?? 'MWh'}</b>`
            : `${p.data.name}<br/><b>${fmtNum((p.value as number) ?? 0, 1)} ${data.unit ?? 'MWh'}</b>`,
      },
      legend: { show: false },
      series: [
        {
          type: 'sankey',
          left: 8,
          right: 130,
          top: 10,
          bottom: 10,
          nodeGap: 14,
          nodeWidth: 12,
          draggable: false,
          emphasis: { focus: 'adjacency' },
          data: data.nodes.map((n) => ({
            name: n.name,
            itemStyle: { color: colorOf(n.kind, n.color_slot), borderWidth: 0 },
            label: { color: theme.ink2, fontSize: 11 },
          })),
          links: data.links.map((l) => ({
            source: l.source,
            target: l.target,
            value: l.value,
            lineStyle: { color: 'gradient', opacity: 0.35, curveness: 0.5 },
          })),
          label: { color: theme.ink2, fontSize: 11, formatter: '{b}' },
          lineStyle: { color: 'gradient', opacity: 0.32 },
        },
      ],
    }
  }, [data, theme])
  return <EChart option={option} height={height} />
}

/* ------------------------------------------------------------------ heatmap */

export function HeatmapChart({
  rows,
  columns,
  values,
  unit,
  diverging = true,
  max,
  height = 280,
  onCellClick,
  valueLabel,
}: {
  rows: string[]
  columns: string[]
  values: { row: number; col: number; value: number | null; label?: string }[]
  unit?: string
  diverging?: boolean
  max?: number
  height?: number
  onCellClick?: (row: number, col: number) => void
  valueLabel?: (v: number) => string
}) {
  const theme = useChartTheme()
  const option = useMemo(() => {
    const nums = values.map((v) => v.value).filter((v): v is number => v !== null)
    const bound = max ?? Math.max(10, ...nums.map((v) => Math.abs(v)))
    return {
      ...baseOption(theme),
      grid: { left: 8, right: 8, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        ...baseOption(theme).tooltip,
        formatter: (p: { data: [number, number, number | null]; marker: string }) => {
          const [col, row, v] = p.data
          return `${rows[row]} · ${columns[col]}<br/><b>${v === null ? EMPTY : (valueLabel?.(v) ?? `${fmtAuto(v)}${unit ? ` ${unit}` : ''}`)}</b>`
        },
      },
      xAxis: { type: 'category', data: columns, ...axisStyle(theme), splitArea: { show: false } },
      yAxis: { type: 'category', data: rows, ...axisStyle(theme), axisLabel: { color: theme.ink2, fontSize: 11 } },
      visualMap: {
        show: false,
        min: diverging ? -bound : 0,
        max: bound,
        inRange: {
          color: diverging
            ? [...DIVERGING.negative.slice().reverse(), resolveColor(DIVERGING.neutral), ...DIVERGING.positive]
            : SEQUENTIAL.map(resolveColor),
        },
      },
      series: [
        {
          type: 'heatmap',
          data: values.map((v) => [v.col, v.row, v.value]),
          itemStyle: { borderColor: theme.surface, borderWidth: 2, borderRadius: 3 },
          label: {
            show: columns.length <= 14,
            fontSize: 10,
            color: theme.ink,
            formatter: (p: { data: [number, number, number | null] }) =>
              p.data[2] === null ? '' : valueLabel ? valueLabel(p.data[2]) : fmtNum(p.data[2], 0),
          },
          emphasis: { itemStyle: { borderColor: theme.ink, borderWidth: 2 } },
        },
      ],
    }
  }, [rows, columns, values, unit, diverging, max, theme, valueLabel])

  return (
    <EChart
      option={option}
      height={height}
      onEvent={
        onCellClick
          ? {
              click: (params) => {
                const p = params as { data?: [number, number, number] }
                if (p.data) onCellClick(p.data[1], p.data[0])
              },
            }
          : undefined
      }
    />
  )
}

/* ------------------------------------------------------------------ dispersão energia × produção */

export function ScatterChart({
  series,
  xName,
  yName,
  xUnit,
  yUnit,
  height = 300,
  regression = true,
}: {
  series: { name: string; points: [number, number][]; color?: string }[]
  xName: string
  yName: string
  xUnit?: string
  yUnit?: string
  height?: number
  regression?: boolean
}) {
  const theme = useChartTheme()
  const option = useMemo(() => {
    const regressions = regression
      ? series.map((s, i) => {
          const pts = s.points
          if (pts.length < 3) return null
          const n = pts.length
          const sx = pts.reduce((a, p) => a + p[0], 0)
          const sy = pts.reduce((a, p) => a + p[1], 0)
          const sxy = pts.reduce((a, p) => a + p[0] * p[1], 0)
          const sxx = pts.reduce((a, p) => a + p[0] * p[0], 0)
          const den = n * sxx - sx * sx
          if (!den) return null
          const slope = (n * sxy - sx * sy) / den
          const intercept = (sy - slope * sx) / n
          const xs = pts.map((p) => p[0])
          const x0 = Math.min(...xs)
          const x1 = Math.max(...xs)
          return {
            name: `${s.name} — ajuste`,
            type: 'line',
            data: [
              [x0, slope * x0 + intercept],
              [x1, slope * x1 + intercept],
            ],
            showSymbol: false,
            lineStyle: { color: resolveColor(s.color ?? seriesColor(i + 1)), width: 1.5, type: 'dashed' },
            tooltip: { show: false },
            silent: true,
            z: 1,
          }
        })
      : []
    return {
      ...baseOption(theme),
      grid: { left: 8, right: 16, top: 26, bottom: 24, containLabel: true },
      legend: { ...baseOption(theme).legend, show: series.length > 1 },
      tooltip: {
        ...baseOption(theme).tooltip,
        trigger: 'item',
        formatter: (p: { seriesName: string; value: [number, number] }) =>
          `${p.seriesName}<br/>${xName}: <b>${fmtAuto(p.value[0])} ${xUnit ?? ''}</b><br/>${yName}: <b>${fmtAuto(p.value[1])} ${yUnit ?? ''}</b>`,
      },
      xAxis: {
        type: 'value',
        name: xUnit ? `${xName} (${xUnit})` : xName,
        nameLocation: 'middle',
        nameGap: 26,
        nameTextStyle: { color: theme.muted, fontSize: 11 },
        ...axisStyle(theme, { grid: true }),
        axisLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: yUnit ? `${yName} (${yUnit})` : yName,
        nameTextStyle: { color: theme.muted, fontSize: 11, align: 'left' },
        nameGap: 8,
        ...axisStyle(theme, { grid: true }),
        axisLine: { show: false },
      },
      series: [
        ...series.map((s, i) => ({
          name: s.name,
          type: 'scatter',
          data: s.points,
          symbolSize: 9,
          itemStyle: { color: resolveColor(s.color ?? seriesColor(i + 1)), opacity: 0.75, borderColor: theme.surface, borderWidth: 1.5 },
          emphasis: { itemStyle: { opacity: 1, borderWidth: 2 } },
          z: 3,
        })),
        ...regressions.filter(Boolean),
      ],
    }
  }, [series, xName, yName, xUnit, yUnit, theme, regression])
  return <EChart option={option} height={height} />
}

/* ------------------------------------------------------------------ Pareto (barras % + acumulado no mesmo eixo) */

export function ParetoChart({
  categories,
  shares,
  height = 280,
  colorSlots,
}: {
  categories: string[]
  shares: number[]
  height?: number
  colorSlots?: (number | null)[]
}) {
  const theme = useChartTheme()
  const option = useMemo(() => {
    let acc = 0
    const cumulative = shares.map((s) => (acc += s))
    return {
      ...baseOption(theme),
      grid: { left: 8, right: 16, top: 26, bottom: 4, containLabel: true },
      legend: { ...baseOption(theme).legend, show: true, data: ['Participação', 'Acumulado'] },
      tooltip: {
        ...baseOption(theme).tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v: number) => fmtPct(v, 1),
      },
      xAxis: { type: 'category', data: categories, ...axisStyle(theme), axisLabel: { color: theme.muted, fontSize: 10, rotate: categories.length > 6 ? 28 : 0, width: 110, overflow: 'truncate' } },
      yAxis: {
        type: 'value',
        max: 100,
        name: '%',
        nameTextStyle: { color: theme.muted, fontSize: 10 },
        ...axisStyle(theme, { grid: true }),
        axisLine: { show: false },
        axisLabel: { color: theme.muted, fontSize: 11, formatter: (v: number) => `${v}%` },
      },
      series: [
        {
          name: 'Participação',
          type: 'bar',
          data: shares.map((v, i) => ({ value: v, itemStyle: { color: resolveColor(seriesColor(colorSlots?.[i] ?? 1)) } })),
          barMaxWidth: 26,
          itemStyle: { borderRadius: [4, 4, 0, 0] },
        },
        {
          name: 'Acumulado',
          type: 'line',
          data: cumulative,
          symbolSize: 7,
          lineStyle: { color: resolveColor('var(--ink-2)'), width: 2 },
          itemStyle: { color: resolveColor('var(--ink-2)'), borderColor: theme.surface, borderWidth: 2 },
          label: { show: true, position: 'top', fontSize: 10, color: theme.muted, formatter: (p: { value: number }) => fmtPct(p.value, 0) },
        },
      ],
    }
  }, [categories, shares, theme, colorSlots])
  return <EChart option={option} height={height} />
}

/* ------------------------------------------------------------------ bullet (meta × realizado) */

export function BulletChart({
  value,
  target,
  baseline,
  min,
  max,
  unit,
  decimals,
  lowerIsBetter = true,
  label,
}: {
  value: number | null
  target?: number | null
  baseline?: number | null
  min?: number
  max?: number
  unit?: string
  decimals?: number
  lowerIsBetter?: boolean
  label?: string
}) {
  const refs = [value, target, baseline].filter((v): v is number => v !== null && v !== undefined)
  if (!refs.length) return <span className="text-xs text-muted">{EMPTY}</span>
  const lo = min ?? 0
  const hi = max ?? Math.max(...refs) * 1.15
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo || 1)) * 100))}%`
  const good = target !== null && target !== undefined && value !== null && (lowerIsBetter ? value <= target : value >= target)
  return (
    <div className="w-full">
      {label && <div className="mb-1 text-[11px] text-ink-2">{label}</div>}
      <div className="relative h-4 w-full rounded-sm bg-surface-3">
        {baseline !== null && baseline !== undefined && (
          <div className="absolute inset-y-0 w-px bg-[var(--muted)]" style={{ left: pos(baseline) }} title={`Baseline: ${fmtAuto(baseline, decimals)}`} />
        )}
        {value !== null && (
          <div
            className="absolute inset-y-1 rounded-sm"
            style={{ width: pos(value), background: good ? 'var(--good)' : 'var(--warning)' }}
          />
        )}
        {target !== null && target !== undefined && (
          <div className="absolute inset-y-0 w-0.5 bg-[var(--ink)]" style={{ left: pos(target) }} title={`Meta: ${fmtAuto(target, decimals)}`} />
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted num">
        <span>
          Realizado <b className="text-ink">{fmtAuto(value, decimals)}</b> {unit}
        </span>
        <span>
          Meta <b className="text-ink">{fmtAuto(target, decimals)}</b>
        </span>
      </div>
    </div>
  )
}
