/** Página do processo (ou subprocesso): posição no fluxo, USEs, indicadores, histórico e diagnóstico. */
import { ArrowRight, GitCompareArrows, Workflow } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { CategoryBars, ChartCard, TimeSeriesChart } from '../components/charts'
import { KpiTile, StatRow } from '../components/common/Kpi'
import { ProcessFlow } from '../components/flow/ProcessFlow'
import { DiagnosticsList } from '../components/indicators/Diagnostics'
import { IndicatorTable } from '../components/indicators/IndicatorTable'
import { Page, PageHeader } from '../components/layout/AppShell'
import { Badge, Card, CardHeader, ErrorState, Select, Skeleton } from '../components/ui/primitives'
import { DeltaBadge, StatusBar } from '../components/ui/status'
import { seriesColor } from '../lib/colors'
import { REGIME_LABEL, fmtNum, fmtPct } from '../lib/format'
import { useApi, useFilters } from '../lib/hooks'
import type {
  Diagnostic,
  EnergyCompare,
  EnergySeries,
  FlowResponse,
  History,
  IndicatorRow,
  NodeBrief,
  StatusCounts,
  UseEnergyRow,
} from '../lib/types'

interface NodeDetail extends NodeBrief {
  description: string | null
  operating_regime: string | null
  path_nodes: NodeBrief[]
  owner: { id: number; name: string; role_title: string | null } | null
  children: (NodeBrief & { uses: number })[]
  production_variable: { name: string; unit: string; code: string } | null
}

interface NodeSummary {
  node: NodeDetail
  period: { label: string; short_label: string; partial: boolean }
  comparison_period: { label: string; short_label: string }
  energy: EnergyCompare
  status_counts: StatusCounts
  indicator_count: number
}

export function ProcessPage() {
  const { nodeId } = useParams()
  const filters = useFilters()
  const navigate = useNavigate()
  const [chartIndicator, setChartIndicator] = useState<string>('')

  const summary = useApi<NodeSummary>(`/nodes/${nodeId}/summary`, filters.params)
  const node = useApi<NodeDetail>(`/nodes/${nodeId}`)
  const uses = useApi<{ uses: UseEnergyRow[]; unallocated: { name: string; unallocated_mwh: number; measured_mwh: number }[] }>(
    `/nodes/${nodeId}/energy/uses`,
    filters.params,
  )
  const indicators = useApi<{ items: IndicatorRow[] }>(`/nodes/${nodeId}/indicators`, { ...filters.params, spark: true })
  const diagnostics = useApi<{ items: Diagnostic[] }>(`/nodes/${nodeId}/diagnostics`, filters.params)
  const series = useApi<EnergySeries>(`/nodes/${nodeId}/energy/series`, {
    ...filters.params,
    window: 13,
    grain: 'month',
    group: 'carrier',
  })

  const area = node.data?.path_nodes.find((n) => n.level === 'area')
  const areaFlow = useApi<FlowResponse>(area ? `/nodes/${area.id}/flow` : null, { ...filters.params, metrics: false })

  const processIndicators = useMemo(
    () => (indicators.data?.items ?? []).filter((i) => i.level === 'process' && i.direction !== 'none'),
    [indicators.data],
  )
  const selectedIndicatorId = chartIndicator || (processIndicators[0]?.id ? String(processIndicators[0].id) : '')
  const history = useApi<History>(selectedIndicatorId ? `/indicators/${selectedIndicatorId}/history` : null, {
    ...filters.params,
    grain: 'week',
    window: 26,
  })

  if (summary.error) return <ErrorState error={summary.error} />
  if (!summary.data || !node.data) {
    return (
      <Page>
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </Page>
    )
  }

  const s = summary.data
  const e = s.energy.current
  const selected = processIndicators.find((i) => String(i.id) === selectedIndicatorId)

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: 'Dashboard', to: '/' },
          ...node.data.path_nodes
            .filter((n) => n.level === 'area' || (n.level === 'process' && n.id !== node.data!.id))
            .map((n) => ({ label: n.name, to: n.level === 'area' ? `/areas/${n.id}` : `/processos/${n.id}` })),
          { label: node.data.name },
        ]}
        title={node.data.name}
        badges={
          <>
            {node.data.operating_regime && <Badge>{REGIME_LABEL[node.data.operating_regime] ?? node.data.operating_regime}</Badge>}
            {node.data.owner && <Badge title="Dono do processo">{node.data.owner.name}</Badge>}
          </>
        }
        subtitle={
          <>
            {node.data.description} · {s.period.label} vs {s.comparison_period.label}
            {s.period.partial && ' · período em andamento'}
          </>
        }
        actions={
          <>
            {area && (
              <Link to={filters.link(`/areas/${area.id}/fluxograma`, { sel: String(node.data.id) })} className="btn">
                <Workflow size={14} /> Ver no fluxograma
              </Link>
            )}
            <Link to={filters.link('/comparacoes', { node: String(nodeId) })} className="btn">
              <GitCompareArrows size={14} /> Comparar períodos
            </Link>
          </>
        }
      />
      <Page>
        <StatRow cols={5}>
          <KpiTile
            label={e.production_name ?? 'Produção'}
            value={e.production}
            unit={e.production_unit ?? ''}
            decimals={0}
            delta={s.energy.production_delta_pct}
            hero
          />
          <KpiTile
            label="Consumo de energia"
            value={e.energy_mwh}
            unit="MWh"
            delta={s.energy.energy_delta_pct}
            hint={e.by_carrier.map((c) => `${c.name}: ${fmtNum(c.native, 1)} ${c.unit}`).join(' · ')}
          />
          <KpiTile
            label="Intensidade energética"
            value={e.intensity_kwh_per_unit}
            unit={e.intensity_unit ?? ''}
            delta={s.energy.intensity_delta_pct}
            changeClass={s.energy.intensity_delta_pct == null ? 'indefinido' : s.energy.intensity_delta_pct > 0 ? 'piora' : 'melhoria'}
          />
          <KpiTile
            label="Indicadores"
            value={s.indicator_count}
            hint={`${(s.status_counts.critico ?? 0) + (s.status_counts.atencao ?? 0)} exigem atenção`}
            footer={
              <div className="mt-2">
                <StatusBar counts={s.status_counts} />
              </div>
            }
          />
          <KpiTile label="Completude dos dados" value={e.completeness_pct} unit="%" hint={`Medição: ${e.metering}`} />
        </StatRow>

        {s.energy.decomposition && (
          <Card className="px-4 py-3">
            <p className="text-xs leading-relaxed text-ink-2">
              <b className="text-ink">Leitura da variação:</b> o consumo variou {fmtPct(s.energy.energy_delta_pct, 1, true)} enquanto a
              produção variou {fmtPct(s.energy.production_delta_pct, 1, true)}. Decompondo (LMDI): efeito da produção{' '}
              <b className="num text-ink">{fmtNum(s.energy.decomposition.production_effect, 1)} MWh</b> e efeito da intensidade{' '}
              <b className="num text-ink">{fmtNum(s.energy.decomposition.intensity_effect, 1)} MWh</b>. Aumento de consumo acompanhado de
              queda de intensidade indica mais produção, não perda de eficiência.
            </p>
          </Card>
        )}

        <div className="grid gap-4 xl:grid-cols-[1fr_1.25fr]">
          <Card className="flex flex-col">
            <CardHeader
              title="Posição no processo produtivo"
              subtitle={area ? `Área ${area.name}` : undefined}
              icon={<Workflow size={14} />}
              actions={
                area && (
                  <Link to={filters.link(`/areas/${area.id}/fluxograma`, { sel: String(node.data!.id) })} className="btn btn-ghost text-xs">
                    Abrir <ArrowRight size={13} />
                  </Link>
                )
              }
            />
            {areaFlow.data ? (
              <ProcessFlow
                flow={areaFlow.data}
                compact
                height={230}
                highlightNodeId={node.data.id}
                onSelect={(dto) => {
                  if (dto.hierarchy_node_id && dto.hierarchy_node_id !== node.data!.id)
                    navigate(filters.link(`/processos/${dto.hierarchy_node_id}`))
                }}
              />
            ) : (
              <Skeleton className="m-4 h-48" />
            )}
            {node.data.children.length > 0 && (
              <div className="border-t border-edge p-4">
                <p className="label mb-2">Subprocessos</p>
                <div className="flex flex-wrap gap-2">
                  {node.data.children.map((c) => (
                    <Link key={c.id} to={filters.link(`/processos/${c.id}`)} className="btn text-xs">
                      {c.name} <span className="text-muted">· {c.uses} USEs</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Card className="flex flex-col">
            <CardHeader
              title="Usos significativos de energia nesta etapa"
              subtitle="Consumo, participação e status dos indicadores de cada USE"
            />
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              {(uses.data?.uses ?? []).map((u) => (
                <Link
                  key={u.use_id}
                  to={filters.link(`/uses/${u.use_id}`)}
                  className="rounded-lg border border-edge p-3 transition-colors hover:border-accent hover:bg-surface-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[13px] font-medium leading-tight">{u.name}</p>
                    <DeltaBadge pct={u.delta_pct ?? null} compact />
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {u.category} · {REGIME_LABEL[u.operating_regime] ?? u.operating_regime}
                  </p>
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <span className="num text-[16px] font-semibold">
                      {fmtNum(u.mwh, 1)} <span className="text-[11px] font-normal text-muted">MWh</span>
                    </span>
                    <span className="num text-[11px] text-muted">{u.share_pct != null ? fmtPct(u.share_pct, 1) : ''} da etapa</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, u.share_pct ?? 0)}%`, background: seriesColor(u.color_slot) }} />
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted">
                    {u.equipment_count} equipamentos · {u.indicator_count ?? 0} indicadores
                  </p>
                </Link>
              ))}
              {!uses.data?.uses.length && <p className="text-xs text-muted">Nenhum USE cadastrado nesta etapa.</p>}
            </div>
            {uses.data?.unallocated?.some((u) => u.unallocated_mwh > 0.01) && (
              <p className="border-t border-edge px-4 py-2 text-[11px] text-muted">
                Não alocado a USEs:{' '}
                {uses.data.unallocated
                  .filter((u) => u.unallocated_mwh > 0.01)
                  .map((u) => `${fmtNum(u.unallocated_mwh, 1)} MWh (${u.name})`)
                  .join(' · ')}{' '}
                — diferença entre o medidor do CCM e a soma das submedições.
              </p>
            )}
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard
            title="Histórico do indicador"
            subtitle={selected ? `${selected.name} (${selected.unit})` : 'Selecione um indicador'}
            actions={
              processIndicators.length > 0 && (
                <Select
                  value={selectedIndicatorId}
                  onChange={(ev) => setChartIndicator(ev.target.value)}
                  className="max-w-[240px]"
                  options={processIndicators.map((i) => ({ value: String(i.id), label: i.name }))}
                />
              )
            }
            table={
              history.data
                ? {
                    columns: ['Semana', `Valor (${history.data.indicator.unit})`, 'Média móvel', 'Meta'],
                    rows: history.data.points.map((p) => [p.label, p.value, p.moving_avg, p.target]),
                  }
                : undefined
            }
            note={
              history.data
                ? `Tendência na janela: ${history.data.trend.classification} (${fmtPct(history.data.trend.relative_change_pct, 1, true)}).${
                    history.data.control.shift_detected_at ? ' Mudança de comportamento detectada pela regra de sequência.' : ''
                  }`
                : undefined
            }
          >
            {history.data ? (
              <TimeSeriesChart
                x={history.data.points.map((p) => p.label)}
                series={[
                  { name: history.data.indicator.name, values: history.data.points.map((p) => p.value) },
                  {
                    name: `Média móvel (${history.data.moving_average_window})`,
                    values: history.data.points.map((p) => p.moving_avg),
                    color: 'var(--s7)',
                    dashed: true,
                    hideSymbol: true,
                  },
                ]}
                refLines={[
                  ...(history.data.points.at(-1)?.target != null
                    ? [{ name: 'Meta', value: history.data.points.at(-1)!.target as number, color: 'var(--good)' }]
                    : []),
                  ...(history.data.points.at(-1)?.baseline != null
                    ? [{ name: 'Baseline', value: history.data.points.at(-1)!.baseline as number, color: 'var(--muted)' }]
                    : []),
                ]}
                markers={history.data.points.map((p, i) => (p.out_of_control ? { index: i, name: 'Fora de controle' } : null)).filter(Boolean) as { index: number; name: string }[]}
                unit={history.data.indicator.unit}
                decimals={history.data.indicator.decimals}
                zeroBased={false}
                height={260}
              />
            ) : (
              <Skeleton className="h-64" />
            )}
          </ChartCard>

          <ChartCard
            title="Consumo e produção mês a mês"
            subtitle="Duas escalas diferentes em gráficos separados (sem eixo duplo)"
            table={
              series.data
                ? {
                    columns: ['Mês', 'Energia (MWh)', `Produção (${series.data.production_unit ?? ''})`, 'Intensidade'],
                    rows: series.data.buckets.map((b, i) => [
                      b.label,
                      series.data!.total[i],
                      series.data!.production?.[i] ?? null,
                      series.data!.intensity?.[i] ?? null,
                    ]),
                  }
                : undefined
            }
          >
            {series.data ? (
              <div className="space-y-1">
                <TimeSeriesChart
                  x={series.data.buckets.map((b) => b.label)}
                  series={series.data.groups.map((g) => ({ name: g.name, values: g.values, type: 'bar', stack: 'e' }))}
                  unit="MWh"
                  height={130}
                />
                <TimeSeriesChart
                  x={series.data.buckets.map((b) => b.label)}
                  series={[
                    { name: 'Intensidade', values: series.data.intensity ?? [], color: 'var(--s3)', area: true },
                  ]}
                  unit={e.intensity_unit ?? ''}
                  height={130}
                  zeroBased={false}
                />
              </div>
            ) : (
              <Skeleton className="h-64" />
            )}
          </ChartCard>
        </div>

        <Card className="flex flex-col">
          <CardHeader
            title="Indicadores da etapa"
            subtitle="Intrínsecos (características do equipamento) e extrínsecos (uso dentro do processo)"
            actions={
              <Link to={filters.link('/indicadores', { node: String(nodeId) })} className="btn btn-ghost text-xs">
                Matriz completa <ArrowRight size={13} />
              </Link>
            }
          />
          {indicators.data ? (
            <IndicatorTable rows={indicators.data.items} maxHeight={520} />
          ) : (
            <Skeleton className="m-4 h-64" />
          )}
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard
            title="Comparação por USE"
            subtitle={`${s.period.short_label} × ${s.comparison_period.short_label}`}
            table={{
              columns: ['USE', 'Atual (MWh)', 'Anterior (MWh)', 'Δ %'],
              rows: (uses.data?.uses ?? []).map((u) => [u.name, u.mwh, u.previous_mwh ?? null, u.delta_pct != null ? fmtPct(u.delta_pct, 1, true) : null]),
            }}
          >
            {uses.data ? (
              <CategoryBars
                categories={uses.data.uses.map((u) => u.name)}
                series={[
                  { name: s.period.short_label, values: uses.data.uses.map((u) => u.mwh), color: 'var(--s1)' },
                  { name: s.comparison_period.short_label, values: uses.data.uses.map((u) => u.previous_mwh ?? null), color: 'var(--seq-250)' },
                ]}
                unit="MWh"
                height={Math.max(220, uses.data.uses.length * 46)}
              />
            ) : (
              <Skeleton className="h-56" />
            )}
          </ChartCard>

          <Card className="flex flex-col">
            <CardHeader title="Diagnóstico do período" subtitle="Desvios, deteriorações e alertas de dados" />
            {diagnostics.data ? <DiagnosticsList items={diagnostics.data.items} limit={10} /> : <Skeleton className="m-4 h-40" />}
          </Card>
        </div>
      </Page>
    </>
  )
}

