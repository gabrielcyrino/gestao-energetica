/** Página do USE: equipamentos, indicadores intrínsecos × extrínsecos e variáveis que explicam o consumo. */
import { Cpu, Gauge, ListChecks, Workflow } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useParams } from 'react-router'

import { CategoryBars, ChartCard } from '../components/charts'
import { KpiTile, StatRow } from '../components/common/Kpi'
import { IndicatorTable } from '../components/indicators/IndicatorTable'
import { Page, PageHeader } from '../components/layout/AppShell'
import { Badge, Card, CardHeader, EmptyState, ErrorState, Skeleton, Tooltip } from '../components/ui/primitives'
import { DeltaBadge, StatusBar } from '../components/ui/status'
import { seriesColor } from '../lib/colors'
import {
  EMPTY,
  METHOD_LABEL,
  REGIME_LABEL,
  VARIABLE_TYPE_LABEL,
  fmtAuto,
  fmtNum,
  fmtPct,
} from '../lib/format'
import { useApi, useFilters } from '../lib/hooks'
import type { EnergySummary, Equipment, IndicatorRow, PeriodInfo, StatusCounts, Use } from '../lib/types'

interface UseDetailResponse {
  use: Use
  period: PeriodInfo
  comparison_period: PeriodInfo
  energy_mwh: number | null
  previous_mwh: number | null
  share_of_node_pct: number | null
  node_energy: EnergySummary
  indicators: IndicatorRow[]
  status_counts: StatusCounts
}

function pctChange(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

export function UsePage() {
  const { useId } = useParams()
  const filters = useFilters()
  const query = useApi<UseDetailResponse>(useId ? `/uses/${useId}` : null, filters.params)
  const data = query.data
  const use = data?.use

  const equipment: Equipment[] = useMemo(() => use?.equipment ?? [], [use])
  const intrinsic = useMemo(() => (data?.indicators ?? []).filter((i) => i.kind === 'intrinsic'), [data])
  const extrinsic = useMemo(() => (data?.indicators ?? []).filter((i) => i.kind === 'extrinsic'), [data])
  const hoursIndicator = useMemo(() => (data?.indicators ?? []).find((i) => i.unit === 'h'), [data])
  const idleIndicator = useMemo(
    () => (data?.indicators ?? []).find((i) => i.unit === '%' && /vazio|alívio/i.test(i.name)),
    [data],
  )

  const bars = useMemo(() => {
    const withEnergy = equipment.filter((e) => (e.mwh ?? 0) > 0).sort((a, b) => (b.mwh ?? 0) - (a.mwh ?? 0))
    return {
      categories: withEnergy.map((e) => e.name),
      current: withEnergy.map((e) => e.mwh ?? null),
      previous: withEnergy.map((e) => e.previous_mwh ?? null),
    }
  }, [equipment])

  if (query.error) return <ErrorState error={query.error} />
  if (!data || !use) return <Skeleton className="m-5 h-64" />

  const breadcrumb = (use.path ?? []).map((n) => ({
    label: n.name,
    to: n.level === 'area' ? `/areas/${n.id}` : n.level === 'process' || n.level === 'subprocess' ? `/processos/${n.id}` : undefined,
  }))

  return (
    <>
      <PageHeader
        breadcrumb={breadcrumb}
        title={use.name}
        subtitle={use.significance_reason ?? use.description ?? undefined}
        badges={
          <>
            {use.category && (
              <Badge color={seriesColor(use.category.color_slot)}>{use.category.name}</Badge>
            )}
            <Badge>{REGIME_LABEL[use.operating_regime] ?? use.operating_regime}</Badge>
            {use.carrier && <Badge>{use.carrier.name}</Badge>}
          </>
        }
        actions={
          <>
            {use.area && (
              <Link
                className="btn"
                to={filters.link(`/areas/${use.area.id}/fluxograma`, { sel: use.node?.id })}
              >
                <Workflow size={14} /> Ver no fluxograma
              </Link>
            )}
            {use.node && (
              <Link className="btn" to={filters.link(`/processos/${use.node.id}`)}>
                Abrir etapa
              </Link>
            )}
          </>
        }
      />
      <Page>
        <StatRow cols={5}>
          <KpiTile
            label={`Consumo · ${data.period.short_label}`}
            value={data.energy_mwh}
            unit="MWh"
            decimals={1}
            delta={pctChange(data.energy_mwh, data.previous_mwh)}
            deltaLabel={`vs ${data.comparison_period.label}`}
            hint={use.carrier?.kind === 'internal' ? 'Vetor secundário gerado internamente' : undefined}
          />
          <KpiTile
            label="Participação na etapa"
            value={data.share_of_node_pct}
            unit="%"
            decimals={1}
            hint={`Sobre ${fmtNum(data.node_energy.energy_mwh, 1)} MWh da etapa`}
          />
          <KpiTile label="Potência instalada" value={use.installed_power_kw} unit="kW" decimals={0} />
          <KpiTile label="Equipamentos" value={use.equipment_count} />
          <KpiTile
            label={hoursIndicator ? 'Horas de operação' : 'Tempo em vazio'}
            value={hoursIndicator?.current.value ?? idleIndicator?.current.value ?? null}
            unit={hoursIndicator?.unit ?? idleIndicator?.unit ?? undefined}
            decimals={hoursIndicator ? 0 : 1}
            status={(hoursIndicator ?? idleIndicator)?.current.status}
            hint={hoursIndicator ? 'Soma das horas no período' : 'Parcela do tempo ligado sem produto'}
          />
        </StatRow>

        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader
              title="Equipamentos do USE"
              subtitle="Dados de placa e consumo medido no período"
              icon={<Cpu size={15} />}
            />
            <div className="overflow-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>TAG</th>
                    <th>Equipamento</th>
                    <th className="right">Pot. (kW)</th>
                    <th className="right">Rend. (%)</th>
                    <th>Classe</th>
                    <th>Inversor</th>
                    <th className="right">Consumo (MWh)</th>
                    <th className="right">Δ período</th>
                  </tr>
                </thead>
                <tbody>
                  {equipment.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <Link to={filters.link(`/equipamentos/${e.id}`)} className="font-medium text-ink hover:underline">
                          {e.tag}
                        </Link>
                      </td>
                      <td className="max-w-[260px]">
                        <span className="block truncate">{e.name}</span>
                        <span className="block truncate text-[11px] text-muted">{e.equipment_type}</span>
                      </td>
                      <td className="right">{fmtAuto(e.rated_power_kw, 1)}</td>
                      <td className="right">{fmtAuto(e.rated_efficiency_pct, 1)}</td>
                      <td>{e.efficiency_class ?? EMPTY}</td>
                      <td>{e.has_vfd ? 'Sim' : 'Não'}</td>
                      <td className="right font-medium">{e.mwh != null ? fmtNum(e.mwh, 2) : EMPTY}</td>
                      <td className="right">
                        <DeltaBadge pct={e.delta_pct ?? null} compact />
                      </td>
                    </tr>
                  ))}
                  {equipment.length === 0 && (
                    <tr>
                      <td colSpan={8}>
                        <EmptyState title="Nenhum equipamento cadastrado neste USE" />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="space-y-4">
            <Card className="card-pad space-y-3">
              <div>
                <p className="label">Por que é significativo</p>
                <p className="mt-1 text-xs leading-snug text-ink-2">{use.significance_reason ?? EMPTY}</p>
              </div>
              <div>
                <p className="label">Período de operação</p>
                <p className="mt-1 text-xs leading-snug text-ink-2">{use.operating_period ?? EMPTY}</p>
              </div>
              <div>
                <p className="label">Responsável</p>
                <p className="mt-1 text-xs text-ink-2">
                  {use.responsible ? `${use.responsible.name} — ${use.responsible.role_title ?? ''}` : EMPTY}
                </p>
              </div>
              <div>
                <p className="label">Status dos indicadores</p>
                <div className="mt-2">
                  <StatusBar counts={data.status_counts} />
                </div>
              </div>
            </Card>
          </div>
        </div>

        {bars.categories.length > 0 && (
          <ChartCard
            title="Consumo por equipamento"
            subtitle={`${data.period.label} × ${data.comparison_period.label}`}
            icon={<Gauge size={15} />}
            table={{
              columns: ['Equipamento', `${data.period.short_label} (MWh)`, `${data.comparison_period.short_label} (MWh)`],
              rows: bars.categories.map((c, i) => [c, bars.current[i], bars.previous[i]]),
            }}
          >
            <CategoryBars
              categories={bars.categories}
              series={[
                { name: data.period.short_label, values: bars.current, color: seriesColor(1) },
                { name: data.comparison_period.short_label, values: bars.previous, color: 'var(--muted)' },
              ]}
              unit="MWh"
              decimals={2}
              height={Math.max(180, bars.categories.length * 46)}
            />
          </ChartCard>
        )}

        <Card>
          <CardHeader
            title="Indicadores intrínsecos"
            subtitle="Dependem das características técnicas do equipamento/USE (placa, eficiência, forma de operar)"
            icon={<ListChecks size={15} />}
          />
          <IndicatorTable rows={intrinsic} showFilters={false} hideColumns={['kind']} emptyMessage="Nenhum indicador intrínseco cadastrado." />
        </Card>

        <Card>
          <CardHeader
            title="Indicadores extrínsecos"
            subtitle="Dependem de como o USE é usado no processo (produção, horas, vazio, partidas)"
            icon={<ListChecks size={15} />}
          />
          <IndicatorTable rows={extrinsic} showFilters={false} hideColumns={['kind']} emptyMessage="Nenhum indicador extrínseco cadastrado." />
        </Card>

        <Card>
          <CardHeader
            title="Variáveis relevantes"
            subtitle="O que explica a variação do consumo deste USE — base para normalização e linha de base"
          />
          {use.relevant_variables && use.relevant_variables.length > 0 ? (
            <div className="overflow-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Variável</th>
                    <th>Tipo</th>
                    <th>Unidade</th>
                    <th>Origem</th>
                    <th>Frequência</th>
                    <th>Por que é relevante</th>
                  </tr>
                </thead>
                <tbody>
                  {use.relevant_variables.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <span className="block font-medium text-ink">{v.name}</span>
                        <span className="block text-[11px] text-muted">{v.code}</span>
                      </td>
                      <td className="text-[12px]">{VARIABLE_TYPE_LABEL[v.variable_type] ?? v.variable_type}</td>
                      <td className="text-[12px]">{v.unit}</td>
                      <td className="text-[12px]">
                        <Tooltip content={v.source_tag ?? undefined}>
                          <span>
                            {v.data_source?.name ?? EMPTY}
                            <span className="ml-1 text-[11px] text-muted">({METHOD_LABEL[v.measurement_method] ?? v.measurement_method})</span>
                          </span>
                        </Tooltip>
                      </td>
                      <td className="text-[12px]">{v.collection_frequency}</td>
                      <td className="max-w-[320px] text-[12px] text-ink-2">{v.rationale ?? EMPTY}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Nenhuma variável relevante associada"
              description="Associe variáveis de produção e condições de processo para permitir normalização do consumo."
            />
          )}
        </Card>

        <p className="text-[11px] text-muted">
          Consumo da etapa no período: {fmtNum(data.node_energy.energy_mwh, 1)} MWh · intensidade{' '}
          {data.node_energy.intensity_kwh_per_unit != null
            ? `${fmtAuto(data.node_energy.intensity_kwh_per_unit)} ${data.node_energy.intensity_unit}`
            : EMPTY}
          {data.node_energy.completeness_pct != null && ` · completude ${fmtPct(data.node_energy.completeness_pct, 0)}`}
        </p>
      </Page>
    </>
  )
}
