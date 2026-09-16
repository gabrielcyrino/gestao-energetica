/** Radar de tendências: classificação (melhoria/deterioração/estável), outliers de controle estatístico
 *  e mudança de comportamento, com small multiples e mapa de desvio por período. */
import { Activity, LineChart } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'

import { ChartCard, HeatmapChart, TimeSeriesChart, seriesTable } from '../components/charts'
import { KpiTile, StatRow } from '../components/common/Kpi'
import { Page, PageHeader } from '../components/layout/AppShell'
import { Card, CardHeader, EmptyState, ErrorState, Segmented, Select, Skeleton, Tooltip, cn } from '../components/ui/primitives'
import { StatusPill, TrendBadge } from '../components/ui/status'
import { EMPTY, LEVEL_LABEL, fmtAuto, fmtDateFull, fmtPct } from '../lib/format'
import { useApi, useFilters } from '../lib/hooks'
import type { PeriodInfo, TreeNode, TrendItem } from '../lib/types'

interface TrendsResponse {
  period: PeriodInfo
  comparison_period: PeriodInfo
  grain: string
  window: number
  start: string
  end: string
  items: TrendItem[]
  counts: Record<string, number>
}

function flatten(tree: TreeNode[] | undefined): { id: number; name: string; depth: number }[] {
  const out: { id: number; name: string; depth: number }[] = []
  const walk = (nodes: TreeNode[], depth: number) => {
    nodes.forEach((n) => {
      if (n.level !== 'company') out.push({ id: n.id, name: n.name, depth })
      walk(n.children, n.level === 'company' ? depth : depth + 1)
    })
  }
  walk(tree ?? [], 0)
  return out
}

/** Desvio desfavorável em % — positivo sempre significa "pior que a meta". */
function unfavorablePct(value: number | null, target: number | null, direction: string): number | null {
  if (value === null || target === null || !target) return null
  const raw = ((value - target) / Math.abs(target)) * 100
  return direction === 'higher_better' ? -raw : raw
}

export function TrendsPage() {
  const filters = useFilters()
  const tree = useApi<TreeNode[]>('/hierarchy/tree')
  const [scope, setScope] = useState('')
  const [grain, setGrain] = useState<'week' | 'month'>('week')
  const [window, setWindow] = useState(26)
  const [selected, setSelected] = useState<number[]>([])

  const trends = useApi<TrendsResponse>('/trends', {
    ...filters.params,
    node_id: scope || undefined,
    grain,
    window,
    limit: 60,
  })
  const items = trends.data?.items ?? []
  const counts = trends.data?.counts ?? {}
  const flat = useMemo(() => flatten(tree.data), [tree.data])
  const picked = useMemo(() => items.filter((i) => selected.includes(i.id)).slice(0, 4), [items, selected])

  const heat = useMemo(() => {
    const top = items.slice(0, 15)
    if (!top.length) return null
    const labels = top[0].series.map((s) => s.label)
    const values: { row: number; col: number; value: number | null }[] = []
    top.forEach((item, row) => {
      item.series.forEach((p, col) => {
        values.push({ row, col, value: unfavorablePct(p.value, p.target, item.direction) })
      })
    })
    return { rows: top.map((i) => i.name), columns: labels, values, top }
  }, [items])

  const toggle = (id: number) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 4 ? cur : [...cur, id]))

  return (
    <>
      <PageHeader
        title="Tendências"
        subtitle="Comportamento dos indicadores ao longo do tempo: melhoria, deterioração, estabilidade, pontos fora de controle e mudanças de patamar."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-ink-2">
              Escopo
              <Select
                className="w-56"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                options={[
                  { value: '', label: 'Planta inteira' },
                  ...flat.map((n) => ({ value: String(n.id), label: `${'  '.repeat(n.depth)}${n.name}` })),
                ]}
              />
            </label>
            <Segmented
              value={grain}
              onChange={(v) => setGrain(v)}
              options={[
                { value: 'week', label: 'Semanal' },
                { value: 'month', label: 'Mensal' },
              ]}
            />
            <Segmented
              value={String(window)}
              onChange={(v) => setWindow(Number(v))}
              options={[
                { value: '12', label: '12' },
                { value: '26', label: '26' },
                { value: '52', label: '52' },
              ]}
            />
          </div>
        }
      />
      <Page>
        <StatRow cols={5}>
          <KpiTile label="Em melhoria" value={counts.melhoria ?? 0} status="normal" hint="Tendência favorável na janela" />
          <KpiTile label="Em deterioração" value={counts.deterioracao ?? 0} status={(counts.deterioracao ?? 0) > 0 ? 'critico' : 'normal'} hint="Exigem investigação" />
          <KpiTile label="Estáveis" value={counts.estavel ?? 0} hint="Dentro da banda de estabilidade do indicador" />
          <KpiTile label="Sem tendência" value={(counts.insuficiente ?? 0) + (counts.aumento ?? 0) + (counts.reducao ?? 0)} hint="Informativos ou com poucos pontos válidos" />
          <KpiTile
            label="Janela analisada"
            value={`${trends.data?.window ?? window} ${grain === 'week' ? 'semanas' : 'meses'}`}
            hint={trends.data ? `${fmtDateFull(trends.data.start)} a ${fmtDateFull(trends.data.end)}` : undefined}
          />
        </StatRow>

        {picked.length > 0 && (
          <div className="grid gap-4 xl:grid-cols-2">
            {picked.map((item) => {
              const values = item.series.map((s) => s.value)
              const ma = item.series.map((s) => s.moving_avg)
              const target = [...item.series].reverse().find((s) => s.target !== null)?.target ?? null
              const markers = item.series
                .map((s, i) => (s.out_of_control ? { index: i, name: 'Fora de controle' } : null))
                .filter((m): m is { index: number; name: string } => m !== null)
              return (
                <ChartCard
                  key={item.id}
                  icon={<LineChart size={14} />}
                  title={
                    <Link to={filters.link(`/indicadores/${item.id}`)} className="hover:underline">
                      {item.name}
                    </Link>
                  }
                  subtitle={
                    <span className="flex flex-wrap items-center gap-2">
                      <TrendBadge trend={item.trend.classification} relative={item.trend.relative_change_pct} />
                      <span className="text-muted">
                        {[item.process?.name, item.use?.name, item.equipment?.tag].filter(Boolean).join(' › ')}
                      </span>
                    </span>
                  }
                  table={seriesTable(
                    item.series.map((s) => s.label),
                    [
                      { name: item.name, values },
                      { name: 'Média móvel', values: ma },
                    ],
                    item.unit,
                  )}
                  note={
                    item.control.applicable
                      ? `Limites de controle (I-MR): ${fmtAuto(item.control.lcl)} a ${fmtAuto(item.control.ucl)} · ${item.control.out_of_control_count} ponto(s) fora.`
                      : `Gráfico de controle não aplicável: ${item.control.reason ?? 'poucos pontos'}.`
                  }
                >
                  <TimeSeriesChart
                    x={item.series.map((s) => s.label)}
                    unit={item.unit}
                    decimals={item.decimals}
                    zeroBased={false}
                    height={230}
                    series={[
                      { name: item.name, values, color: 'var(--s1)' },
                      { name: 'Média móvel', values: ma, color: 'var(--ink-2)', dashed: true, hideSymbol: true, width: 1.5 },
                    ]}
                    refLines={[
                      ...(target !== null ? [{ name: 'Meta', value: target, color: 'var(--good)' }] : []),
                      ...(item.control.applicable && item.control.ucl !== null
                        ? [{ name: 'LSC', value: item.control.ucl, color: 'var(--muted)' }]
                        : []),
                    ]}
                    markers={markers}
                  />
                </ChartCard>
              )
            })}
          </div>
        )}

        <Card>
          <CardHeader
            title="Radar de tendências"
            subtitle="Ordenado por severidade. Marque até 4 indicadores para comparar as séries (cada gráfico com seu próprio eixo)."
            icon={<Activity size={14} />}
            actions={
              <div className="flex items-center gap-3">
                <span className="max-w-[420px] text-right text-[11px] leading-snug text-muted">
                  Em operação sazonal, a inclinação da janela acompanha a curva da safra: use o status (meta da
                  janela) e o gráfico observado × esperado para separar sazonalidade de perda de eficiência.
                </span>
                <span className="num shrink-0 text-[11px] text-muted">{items.length} indicadores</span>
              </div>
            }
          />
          {trends.error ? (
            <ErrorState error={trends.error} />
          ) : trends.isPending ? (
            <Skeleton className="m-4" style={{ height: 380 }} />
          ) : items.length === 0 ? (
            <EmptyState title="Nenhum indicador no escopo selecionado." />
          ) : (
            <div className="max-h-[520px] overflow-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-8"> </th>
                    <th>Indicador</th>
                    <th>Tendência</th>
                    <th className="right">Variação na janela</th>
                    <th className="right">R²</th>
                    <th className="right">Fora de controle</th>
                    <th>Mudança de patamar</th>
                    <th className="right">Valor atual</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className={cn(selected.includes(item.id) && 'bg-accent-soft/40')}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Selecionar ${item.name}`}
                          checked={selected.includes(item.id)}
                          disabled={!selected.includes(item.id) && selected.length >= 4}
                          onChange={() => toggle(item.id)}
                        />
                      </td>
                      <td className="max-w-[320px]">
                        <Link to={filters.link(`/indicadores/${item.id}`)} className="block truncate font-medium hover:underline">
                          {item.name}
                        </Link>
                        <span className="block truncate text-[11px] text-muted">
                          {[item.area?.name, item.process?.name, item.equipment?.tag].filter(Boolean).join(' › ')} ·{' '}
                          {LEVEL_LABEL[item.level]}
                        </span>
                      </td>
                      <td>
                        <TrendBadge trend={item.trend.classification} relative={item.trend.relative_change_pct} />
                      </td>
                      <td className="right">
                        {item.trend.relative_change_pct === null ? (
                          EMPTY
                        ) : (
                          <span
                            className="num"
                            style={{
                              color:
                                item.trend.classification === 'deterioracao'
                                  ? 'var(--critical-text)'
                                  : item.trend.classification === 'melhoria'
                                    ? 'var(--good-text)'
                                    : 'var(--ink-2)',
                            }}
                          >
                            {fmtPct(item.trend.relative_change_pct, 1, true)}
                          </span>
                        )}
                      </td>
                      <td className="right text-ink-2">{item.trend.r2 === null ? EMPTY : fmtAuto(item.trend.r2, 2)}</td>
                      <td className="right text-ink-2">
                        {item.control.applicable ? (
                          <Tooltip content={`Centro ${fmtAuto(item.control.center)} · LSC ${fmtAuto(item.control.ucl)} · LIC ${fmtAuto(item.control.lcl)}`}>
                            <span className="num">{item.control.out_of_control_count}</span>
                          </Tooltip>
                        ) : (
                          <Tooltip content={item.control.reason ?? ''}>
                            <span className="text-muted">n/a</span>
                          </Tooltip>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-[11px]">
                        {item.control.shift_detected_at ? (
                          <span className="rounded border border-[var(--warning)] px-1 py-0.5">
                            desde {fmtDateFull(item.control.shift_detected_at)}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="right font-medium">
                        {item.current.value === null ? (
                          <Tooltip content={item.current.reason ?? ''}>
                            <span className="text-muted">{EMPTY}</span>
                          </Tooltip>
                        ) : (
                          <>
                            {fmtAuto(item.current.value, item.decimals)}
                            <span className="ml-1 text-[11px] font-normal text-muted">{item.unit}</span>
                          </>
                        )}
                      </td>
                      <td>
                        <StatusPill status={item.current.status} explanation={item.current.status_explanation} compact />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {heat && (
          <ChartCard
            title="Desvio em relação à meta por período"
            subtitle="Vermelho = pior que a meta; azul = melhor. Cada linha é um indicador; cada coluna, um período da janela."
            table={{
              columns: ['Indicador', ...heat.columns],
              rows: heat.top.map((item, row) => [
                item.name,
                ...heat.columns.map((_, col) => heat.values.find((v) => v.row === row && v.col === col)?.value ?? null),
              ]),
            }}
            note="Indicadores sem meta no período aparecem em cinza (sem desvio calculável)."
          >
            <HeatmapChart
              rows={heat.rows}
              columns={heat.columns}
              values={heat.values}
              unit="%"
              diverging
              max={30}
              height={Math.max(220, heat.rows.length * 26 + 60)}
              valueLabel={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`}
            />
          </ChartCard>
        )}
      </Page>
    </>
  )
}
