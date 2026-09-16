/** Fluxograma do processo produtivo com os indicadores energéticos ancorados em cada etapa.
 *  Clicar em uma etapa abre o painel com USEs, equipamentos, IDEs, desvios e histórico. */
import { ArrowRight, ExternalLink, Info, Workflow } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { TimeSeriesChart } from '../components/charts'
import { MiniStat } from '../components/common/Kpi'
import { FlowLegend, ProcessFlow, flowMetricOptions, summarizeFlow, type FlowMetric } from '../components/flow/ProcessFlow'
import { DiagnosticsList } from '../components/indicators/Diagnostics'
import { IndicatorTable } from '../components/indicators/IndicatorTable'
import { Page, PageHeader } from '../components/layout/AppShell'
import { EmptyState, ErrorState, Segmented, Skeleton, Tabs } from '../components/ui/primitives'
import { DeltaBadge, StatusBar } from '../components/ui/status'
import { REGIME_LABEL, fmtAuto, fmtNum, fmtPct } from '../lib/format'
import { useApi, useFilters } from '../lib/hooks'
import type {
  Diagnostic,
  EnergySeries,
  FlowNodeDto,
  FlowResponse,
  IndicatorRow,
  NodeBrief,
  StatusCounts,
  UseEnergyRow,
} from '../lib/types'

export function FlowPage() {
  const { nodeId } = useParams()
  const filters = useFilters()
  const navigate = useNavigate()
  const [metric, setMetric] = useState<FlowMetric>('energy')
  const [tab, setTab] = useState('resumo')

  const flow = useApi<FlowResponse>(`/nodes/${nodeId}/flow`, filters.params)
  const selParam = filters.get('sel')
  const selectedFlowNode = useMemo(() => {
    if (!flow.data) return null
    const byId = flow.data.nodes.find((n) => String(n.id) === selParam)
    const byHierarchy = flow.data.nodes.find((n) => String(n.hierarchy_node_id) === selParam)
    return byId ?? byHierarchy ?? flow.data.nodes.find((n) => n.kind === 'process') ?? null
  }, [flow.data, selParam])

  useEffect(() => {
    if (selectedFlowNode && !selParam) filters.set('sel', String(selectedFlowNode.id))
  }, [selectedFlowNode, selParam, filters])

  const targetNodeId = selectedFlowNode?.hierarchy_node_id ?? null
  const summary = useApi<{ node: NodeBrief & { description?: string; operating_regime?: string }; energy: { current: { energy_mwh: number | null; production: number | null; production_unit: string | null; intensity_kwh_per_unit: number | null; intensity_unit: string | null; by_carrier: { name: string; mwh: number; native: number; unit: string; kind: string }[] }; energy_delta_pct: number | null; production_delta_pct: number | null; intensity_delta_pct: number | null; decomposition: { production_effect: number; intensity_effect: number } | null }; status_counts: StatusCounts; indicator_count: number }>(
    targetNodeId ? `/nodes/${targetNodeId}/summary` : null,
    filters.params,
  )
  const uses = useApi<{ uses: UseEnergyRow[] }>(targetNodeId ? `/nodes/${targetNodeId}/energy/uses` : null, filters.params)
  const indicators = useApi<{ items: IndicatorRow[] }>(
    targetNodeId && tab === 'indicadores' ? `/nodes/${targetNodeId}/indicators` : null,
    { ...filters.params, spark: true },
  )
  const diagnostics = useApi<{ items: Diagnostic[] }>(
    targetNodeId && tab === 'desvios' ? `/nodes/${targetNodeId}/diagnostics` : null,
    filters.params,
  )
  const series = useApi<EnergySeries>(targetNodeId && tab === 'resumo' ? `/nodes/${targetNodeId}/energy/series` : null, {
    ...filters.params,
    window: 13,
    grain: 'month',
    group: 'carrier',
  })

  if (flow.error) return <ErrorState error={flow.error} />

  const onOpen = (dto: FlowNodeDto) => {
    if (dto.kind === 'link' && dto.linked_node_id) {
      navigate(filters.link(`/areas/${dto.linked_node_id}/fluxograma`))
    } else if (dto.hierarchy_node_id) {
      navigate(filters.link(`/processos/${dto.hierarchy_node_id}`))
    }
  }

  const overview = flow.data ? summarizeFlow(flow.data) : null

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: 'Dashboard', to: '/' },
          { label: flow.data?.node.name ?? 'Área', to: `/areas/${nodeId}` },
          { label: 'Fluxograma' },
        ]}
        title={
          <>
            <Workflow size={18} className="text-accent" /> Fluxograma · {flow.data?.node.name ?? ''}
          </>
        }
        subtitle="Cada etapa física mostra o consumo, a intensidade e o status dos seus indicadores. Clique para abrir os detalhes; duplo clique abre a página do processo."
        actions={
          <>
            <Segmented value={metric} onChange={(v) => setMetric(v as FlowMetric)} options={flowMetricOptions()} />
            <Link to={filters.link(`/areas/${nodeId}`)} className="btn">
              Visão geral da área
            </Link>
          </>
        }
      />
      <Page className="p-0">
        <div className="grid min-h-[calc(100vh-190px)] grid-cols-1 gap-0 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex min-w-0 flex-col border-b border-edge xl:border-b-0 xl:border-r">
            {flow.data ? (
              <>
                <ProcessFlow
                  flow={flow.data}
                  metric={metric}
                  selectedId={selectedFlowNode?.id ?? null}
                  onSelect={(dto) => {
                    filters.set('sel', String(dto.id))
                    if (dto.kind === 'link' && dto.linked_node_id) onOpen(dto)
                  }}
                  onOpen={onOpen}
                  height="min(54vh, 500px)"
                />
                <FlowLegend metric={metric} />
                {overview && (
                  <div className="border-t border-edge px-4 py-3">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Resumo das etapas</p>
                    <div className="overflow-x-auto">
                      <table className="table">
                        <thead>
                          <tr>
                            {overview.table.columns.map((c, i) => (
                              <th key={c} className={i === 0 ? '' : 'right'}>
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {overview.processes.map((p) => (
                            <tr
                              key={p.id}
                              className="cursor-pointer"
                              onClick={() => filters.set('sel', String(p.id))}
                            >
                              <td className="font-medium">{p.label}</td>
                              <td className="right">{fmtNum(p.metrics?.energy.energy_mwh ?? null, 1)}</td>
                              <td className="right">
                                <DeltaBadge pct={p.metrics?.energy_delta_pct ?? null} compact />
                              </td>
                              <td className="right">
                                {fmtNum(p.metrics?.energy.production ?? null, 0)}{' '}
                                <span className="text-[10px] text-muted">{p.metrics?.energy.production_unit}</span>
                              </td>
                              <td className="right">
                                {fmtAuto(p.metrics?.energy.intensity_kwh_per_unit ?? null)}{' '}
                                <span className="text-[10px] text-muted">{p.metrics?.energy.intensity_unit}</span>
                              </td>
                              <td className="right">
                                {(p.metrics?.status_counts.critico ?? 0) + (p.metrics?.status_counts.atencao ?? 0)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <Skeleton className="m-4 h-[560px]" />
            )}
          </div>

          <aside className="flex min-w-0 flex-col bg-surface">
            {!selectedFlowNode ? (
              <EmptyState title="Selecione uma etapa" description="Clique em uma etapa do fluxograma para ver seus USEs e indicadores." />
            ) : !targetNodeId ? (
              <EmptyState
                title={selectedFlowNode.label}
                description={
                  selectedFlowNode.kind === 'link'
                    ? 'Conexão com outra área — clique duas vezes no fluxograma para navegar.'
                    : 'Entrada/saída de material: não possui indicadores próprios.'
                }
                icon={<Info size={18} />}
                action={
                  selectedFlowNode.linked_node_id ? (
                    <Link to={filters.link(`/areas/${selectedFlowNode.linked_node_id}/fluxograma`)} className="btn">
                      Abrir área ligada <ArrowRight size={13} />
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <>
                <header className="border-b border-edge px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold">{selectedFlowNode.label}</h2>
                      <p className="text-[11px] text-muted">
                        {summary.data?.node.operating_regime ? REGIME_LABEL[summary.data.node.operating_regime] ?? summary.data.node.operating_regime : 'Etapa do processo'}
                        {summary.data ? ` · ${summary.data.indicator_count} indicadores` : ''}
                      </p>
                    </div>
                    <Link to={filters.link(`/processos/${targetNodeId}`)} className="btn btn-primary text-xs">
                      Abrir processo <ExternalLink size={12} />
                    </Link>
                  </div>
                  {summary.data && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <MiniStat label="Consumo" value={summary.data.energy.current.energy_mwh} unit="MWh" />
                      <MiniStat
                        label="Produção"
                        value={summary.data.energy.current.production}
                        unit={summary.data.energy.current.production_unit ?? ''}
                        decimals={0}
                      />
                      <MiniStat
                        label="Intensidade"
                        value={summary.data.energy.current.intensity_kwh_per_unit}
                        unit={summary.data.energy.current.intensity_unit ?? ''}
                      />
                    </div>
                  )}
                  {summary.data && (
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
                      <span className="text-muted">vs {filters.compare === 'yoy' ? 'ano anterior' : 'período anterior'}:</span>
                      <DeltaBadge pct={summary.data.energy.energy_delta_pct} label="Consumo" compact />
                      <DeltaBadge pct={summary.data.energy.production_delta_pct} label="Produção" compact />
                      <DeltaBadge
                        pct={summary.data.energy.intensity_delta_pct}
                        changeClass={
                          summary.data.energy.intensity_delta_pct == null
                            ? 'indefinido'
                            : summary.data.energy.intensity_delta_pct > 0
                              ? 'piora'
                              : 'melhoria'
                        }
                        label="Intensidade"
                        compact
                      />
                    </div>
                  )}
                </header>

                <Tabs
                  value={tab}
                  onChange={setTab}
                  tabs={[
                    { value: 'resumo', label: 'Resumo' },
                    { value: 'uses', label: 'USEs', count: uses.data?.uses.length },
                    { value: 'indicadores', label: 'Indicadores', count: summary.data?.indicator_count },
                    { value: 'desvios', label: 'Desvios' },
                  ]}
                />

                <div className="min-h-0 flex-1 overflow-auto">
                  {tab === 'resumo' && summary.data && (
                    <div className="space-y-4 p-4">
                      <div>
                        <p className="label mb-1">Status dos indicadores</p>
                        <StatusBar counts={summary.data.status_counts} />
                      </div>
                      <div>
                        <p className="label mb-1">Energia por fonte</p>
                        <ul className="space-y-1 text-xs">
                          {summary.data.energy.current.by_carrier.map((c) => (
                            <li key={c.name} className="flex items-center justify-between gap-2">
                              <span className="truncate">
                                {c.name}
                                {c.kind === 'internal' && <span className="ml-1 text-[10px] text-muted">(secundária)</span>}
                              </span>
                              <span className="num shrink-0 text-ink-2">
                                {fmtNum(c.mwh, 1)} MWh
                                {c.unit !== 'kWh' && c.unit !== 'MWh' ? ` · ${fmtNum(c.native, 1)} ${c.unit}` : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      {summary.data.energy.decomposition && (
                        <div className="rounded-lg border border-edge bg-surface-2 p-3 text-[11px] leading-snug text-ink-2">
                          <b className="text-ink">Por que o consumo mudou?</b> Efeito da produção{' '}
                          {fmtNum(summary.data.energy.decomposition.production_effect, 1)} MWh · efeito da intensidade{' '}
                          {fmtNum(summary.data.energy.decomposition.intensity_effect, 1)} MWh (decomposição LMDI).
                        </div>
                      )}
                      {series.data && (
                        <div>
                          <p className="label mb-1">Consumo mensal por fonte</p>
                          <TimeSeriesChart
                            x={series.data.buckets.map((b) => b.label)}
                            series={series.data.groups.map((g) => ({
                              name: g.name,
                              values: g.values,
                              type: 'bar',
                              stack: 'e',
                            }))}
                            unit="MWh"
                            height={180}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {tab === 'uses' && (
                    <ul className="divide-y divide-[var(--edge)]">
                      {(uses.data?.uses ?? []).map((u) => (
                        <li key={u.use_id} className="px-4 py-2.5">
                          <Link to={filters.link(`/uses/${u.use_id}`)} className="flex items-start justify-between gap-2 hover:underline">
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-medium">{u.name}</p>
                              <p className="truncate text-[11px] text-muted">
                                {u.category} · {u.equipment_count} equipamentos · {REGIME_LABEL[u.operating_regime] ?? u.operating_regime}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="num text-[13px] font-semibold">{fmtNum(u.mwh, 1)} MWh</p>
                              <p className="num text-[11px] text-muted">{u.share_pct != null ? fmtPct(u.share_pct, 1) : ''}</p>
                            </div>
                          </Link>
                        </li>
                      ))}
                      {!uses.data?.uses.length && <li className="p-4 text-xs text-muted">Nenhum USE cadastrado nesta etapa.</li>}
                    </ul>
                  )}

                  {tab === 'indicadores' &&
                    (indicators.data ? (
                      <IndicatorTable
                        rows={indicators.data.items}
                        dense
                        showFilters={false}
                        hideColumns={['baseline', 'previous', 'level']}
                      />
                    ) : (
                      <Skeleton className="m-4 h-40" />
                    ))}

                  {tab === 'desvios' &&
                    (diagnostics.data ? (
                      <DiagnosticsList items={diagnostics.data.items} limit={12} />
                    ) : (
                      <Skeleton className="m-4 h-40" />
                    ))}
                </div>
              </>
            )}
          </aside>
        </div>
      </Page>
    </>
  )
}

