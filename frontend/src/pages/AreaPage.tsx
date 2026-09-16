/** Visão geral de uma área: fluxograma resumido, consumo por processo, USEs e diagnóstico. */
import { ArrowRight, GitCompareArrows, Workflow } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'

import { CategoryBars, ChartCard, SankeyChart, TimeSeriesChart, seriesTable } from '../components/charts'
import { KpiTile, StatRow } from '../components/common/Kpi'
import { ProcessFlow } from '../components/flow/ProcessFlow'
import { DiagnosticsList } from '../components/indicators/Diagnostics'
import { Page, PageHeader } from '../components/layout/AppShell'
import { Card, CardHeader, ErrorState, Skeleton } from '../components/ui/primitives'
import { DeltaBadge, StatusBar } from '../components/ui/status'
import { seriesColor } from '../lib/colors'
import { REGIME_LABEL, fmtAuto, fmtNum, fmtPct } from '../lib/format'
import { useApi, useFilters } from '../lib/hooks'
import type {
  Diagnostic,
  EnergyCompare,
  EnergySeries,
  FlowResponse,
  NodeBrief,
  SankeyData,
  StatusCounts,
  UseEnergyRow,
} from '../lib/types'

interface NodeSummary {
  node: NodeBrief & { description?: string | null; operating_regime?: string | null; owner?: { name: string } | null }
  period: { label: string; short_label: string; partial: boolean }
  comparison_period: { label: string; short_label: string }
  energy: EnergyCompare
  status_counts: StatusCounts
  indicator_count: number
}

export function AreaPage() {
  const { nodeId } = useParams()
  const filters = useFilters()
  const navigate = useNavigate()

  const summary = useApi<NodeSummary>(`/nodes/${nodeId}/summary`, filters.params)
  const children = useApi<{ items: ({ node: NodeBrief; status_counts: StatusCounts; indicator_count: number } & EnergyCompare)[] }>(
    `/nodes/${nodeId}/energy/children`,
    filters.params,
  )
  const flow = useApi<FlowResponse>(`/nodes/${nodeId}/flow`, filters.params)
  const uses = useApi<{ uses: UseEnergyRow[]; categories: { name: string; mwh: number; share_pct: number | null; color_slot: number }[] }>(
    `/nodes/${nodeId}/energy/uses`,
    filters.params,
  )
  const series = useApi<EnergySeries>(`/nodes/${nodeId}/energy/series`, { ...filters.params, window: 13, grain: 'month', group: 'child' })
  const diagnostics = useApi<{ items: Diagnostic[] }>(`/nodes/${nodeId}/diagnostics`, filters.params)
  const sankey = useApi<SankeyData>(`/nodes/${nodeId}/sankey`, { period: filters.period })

  if (summary.error) return <ErrorState error={summary.error} />
  if (!summary.data) return <Page><Skeleton className="h-36" /><Skeleton className="h-72" /></Page>

  const s = summary.data
  const e = s.energy.current
  const months = series.data?.buckets.map((b) => b.label) ?? []

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Dashboard', to: '/' }, { label: s.node.name }]}
        title={s.node.name}
        subtitle={
          <>
            {s.node.description} · {s.period.label} vs {s.comparison_period.label}
            {s.node.owner ? ` · Responsável: ${s.node.owner.name}` : ''}
          </>
        }
        actions={
          <>
            <Link to={filters.link(`/areas/${nodeId}/fluxograma`)} className="btn btn-primary">
              <Workflow size={14} /> Fluxograma
            </Link>
            <Link to={filters.link('/comparacoes', { node: String(nodeId) })} className="btn">
              <GitCompareArrows size={14} /> Comparar
            </Link>
          </>
        }
      />
      <Page>
        <StatRow cols={5}>
          <KpiTile
            label="Consumo de energia"
            value={e.energy_mwh}
            unit="MWh"
            delta={s.energy.energy_delta_pct}
            deltaLabel={`vs ${s.comparison_period.short_label}`}
            hint={e.by_carrier.map((c) => `${c.name}: ${fmtNum(c.native, 1)} ${c.unit}`).join(' · ')}
            hero
          />
          <KpiTile
            label={e.production_name ?? 'Produção'}
            value={e.production}
            unit={e.production_unit ?? ''}
            decimals={0}
            delta={s.energy.production_delta_pct}
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
            hint={`${(s.status_counts.critico ?? 0) + (s.status_counts.atencao ?? 0)} fora da meta`}
            footer={<div className="mt-2"><StatusBar counts={s.status_counts} /></div>}
          />
          <KpiTile
            label="Completude dos dados"
            value={e.completeness_pct}
            unit="%"
            hint={`Medição: ${e.metering}`}
          />
        </StatRow>

        <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
          <Card className="flex flex-col">
            <CardHeader
              title="Fluxo do processo"
              subtitle="Clique em uma etapa para abrir seu detalhe"
              icon={<Workflow size={14} />}
              actions={
                <Link to={filters.link(`/areas/${nodeId}/fluxograma`)} className="btn btn-ghost text-xs">
                  Abrir fluxograma completo <ArrowRight size={13} />
                </Link>
              }
            />
            {flow.data ? (
              <ProcessFlow
                flow={flow.data}
                metric="energy"
                height={320}
                onSelect={(dto) => {
                  if (dto.hierarchy_node_id) navigate(filters.link(`/processos/${dto.hierarchy_node_id}`))
                  else if (dto.linked_node_id) navigate(filters.link(`/areas/${dto.linked_node_id}/fluxograma`))
                }}
              />
            ) : (
              <Skeleton className="m-4 h-72" />
            )}
          </Card>

          <ChartCard
            title="Consumo por etapa"
            subtitle={`${s.period.short_label} × ${s.comparison_period.short_label}`}
            table={{
              columns: ['Etapa', 'Atual (MWh)', 'Anterior (MWh)', 'Δ %', 'Intensidade'],
              rows: (children.data?.items ?? []).map((c) => [
                c.node.name,
                c.current.energy_mwh,
                c.previous.energy_mwh,
                c.energy_delta_pct != null ? fmtPct(c.energy_delta_pct, 1, true) : null,
                c.current.intensity_kwh_per_unit != null ? `${fmtAuto(c.current.intensity_kwh_per_unit)} ${c.current.intensity_unit}` : null,
              ]),
            }}
          >
            {children.data ? (
              <CategoryBars
                categories={children.data.items.map((c) => c.node.name)}
                series={[
                  { name: s.period.short_label, values: children.data.items.map((c) => c.current.energy_mwh), color: 'var(--s1)' },
                  { name: s.comparison_period.short_label, values: children.data.items.map((c) => c.previous.energy_mwh), color: 'var(--seq-250)' },
                ]}
                unit="MWh"
                height={300}
              />
            ) : (
              <Skeleton className="h-72" />
            )}
          </ChartCard>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard
            title="Consumo mensal por etapa"
            subtitle="Últimos 13 meses — revela a sazonalidade da operação"
            table={series.data ? seriesTable(months, series.data.groups.map((g) => ({ name: g.name, values: g.values })), 'MWh') : undefined}
          >
            {series.data ? (
              <TimeSeriesChart
                x={months}
                series={series.data.groups.map((g) => ({ name: g.name, values: g.values, type: 'bar', stack: 'e', color: seriesColor(g.color_slot ?? 1) }))}
                unit="MWh"
                height={260}
              />
            ) : (
              <Skeleton className="h-64" />
            )}
          </ChartCard>

          <ChartCard
            title="Fluxo de energia da área"
            subtitle="Fontes, etapas e categorias de uso"
            table={sankey.data ? { columns: ['Origem', 'Destino', 'MWh'], rows: sankey.data.links.map((l) => [l.source, l.target, l.value]) } : undefined}
          >
            {sankey.data ? <SankeyChart data={{ ...sankey.data, unit: 'MWh' }} height={320} /> : <Skeleton className="h-72" />}
          </ChartCard>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
          <Card>
            <CardHeader title="Etapas do processo" subtitle="Desempenho por processo da área" />
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              {(children.data?.items ?? []).map((c) => (
                <Link
                  key={c.node.id}
                  to={filters.link(`/processos/${c.node.id}`)}
                  className="rounded-lg border border-edge p-3 transition-colors hover:border-accent hover:bg-surface-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[13px] font-semibold">{c.node.name}</p>
                    <DeltaBadge pct={c.energy_delta_pct} compact />
                  </div>
                  <p className="num mt-1 text-[17px] font-semibold">
                    {fmtNum(c.current.energy_mwh, 1)} <span className="text-[11px] font-normal text-muted">MWh</span>
                  </p>
                  <p className="text-[11px] text-muted">
                    {c.current.intensity_kwh_per_unit != null
                      ? `${fmtAuto(c.current.intensity_kwh_per_unit)} ${c.current.intensity_unit}`
                      : 'sem produção no período'}
                  </p>
                  <div className="mt-2">
                    <StatusBar counts={c.status_counts} />
                  </div>
                </Link>
              ))}
            </div>
          </Card>

          <Card className="flex flex-col">
            <CardHeader
              title="Usos significativos de energia (USEs)"
              subtitle="Onde a energia da área é consumida"
              actions={
                <Link to={filters.link('/uses', { node: String(nodeId) })} className="btn btn-ghost text-xs">
                  Ver todos <ArrowRight size={13} />
                </Link>
              }
            />
            <div className="max-h-[420px] overflow-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>USE</th>
                    <th>Etapa</th>
                    <th className="right">MWh</th>
                    <th className="right">%</th>
                    <th className="right">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {(uses.data?.uses ?? []).map((u) => (
                    <tr key={u.use_id} className="cursor-pointer" onClick={() => navigate(filters.link(`/uses/${u.use_id}`))}>
                      <td>
                        <span className="block truncate font-medium">{u.name}</span>
                        <span className="block truncate text-[11px] text-muted">
                          {u.category} · {REGIME_LABEL[u.operating_regime] ?? u.operating_regime}
                        </span>
                      </td>
                      <td className="text-[11px] text-ink-2">{u.node_name}</td>
                      <td className="right">{fmtNum(u.mwh, 1)}</td>
                      <td className="right">{u.share_pct != null ? fmtPct(u.share_pct, 1) : '—'}</td>
                      <td className="right">
                        <DeltaBadge pct={u.delta_pct ?? null} compact />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader title="Diagnóstico do período" subtitle="Principais desvios, deteriorações e alertas de qualidade de dado" />
          {diagnostics.data ? <DiagnosticsList items={diagnostics.data.items} limit={10} /> : <Skeleton className="m-4 h-40" />}
        </Card>
      </Page>
    </>
  )
}
