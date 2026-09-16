/** Página do equipamento: dados de placa (origem dos indicadores intrínsecos), IDEs,
 *  séries das tags que alimentam os cálculos e eventos operacionais. */
import { Activity, CalendarClock, Cpu, Database, Wrench } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'

import { ChartCard, TimeSeriesChart } from '../components/charts'
import { KpiTile, StatRow } from '../components/common/Kpi'
import { IndicatorTable } from '../components/indicators/IndicatorTable'
import { Page, PageHeader } from '../components/layout/AppShell'
import { Badge, Card, CardHeader, EmptyState, ErrorState, Select, Skeleton, Tooltip } from '../components/ui/primitives'
import { seriesColor } from '../lib/colors'
import {
  AGGREGATION_LABEL,
  EMPTY,
  METHOD_LABEL,
  VARIABLE_TYPE_LABEL,
  fmtAuto,
  fmtDateFull,
  fmtNum,
} from '../lib/format'
import { useApi, useFilters } from '../lib/hooks'
import type { Equipment, IndicatorRow, PeriodInfo, StatusCounts, Use, Variable } from '../lib/types'

interface EquipmentDetailResponse {
  equipment: Equipment
  use: Use
  period: PeriodInfo
  comparison_period: PeriodInfo
  energy_mwh: number | null
  previous_mwh: number | null
  indicators: IndicatorRow[]
  status_counts: StatusCounts
}

interface VariableSeriesResponse {
  variable: Variable
  grain: string
  start: string
  end: string
  points: { start: string; end?: string; label: string; value: number | null; days: number }[]
}

interface EventRow {
  id: number
  event_type: string
  ts_start: string
  ts_end: string | null
  description: string | null
  equipment: string | null
}

const ATTR_LABEL: Record<string, string> = {
  tensao_nominal_v: 'Tensão nominal (V)',
  corrente_nominal_a: 'Corrente nominal (A)',
  fator_potencia_nominal: 'Fator de potência nominal',
  polos: 'Polos',
  capacidade_t_h: 'Capacidade (t/h)',
  pressao_bar: 'Pressão (bar)',
  pressao_vapor_bar: 'Pressão do vapor (bar)',
  area_troca_m2: 'Área de troca (m²)',
  combustivel: 'Combustível',
  rendimento_projeto_pct: 'Rendimento de projeto (%)',
  vazao_nm3_min: 'Vazão (Nm³/min)',
}

const EVENT_LABEL: Record<string, string> = {
  parada: 'Parada',
  manutencao: 'Manutenção',
  setup: 'Setup',
  sem_produto: 'Sem produto',
  intervencao: 'Intervenção',
  falha_dados: 'Falha de dados',
}

function findIndicator(rows: IndicatorRow[], test: (r: IndicatorRow) => boolean) {
  return rows.find(test)
}

export function EquipmentPage() {
  const { equipmentId } = useParams()
  const filters = useFilters()
  const query = useApi<EquipmentDetailResponse>(equipmentId ? `/equipment/${equipmentId}` : null, filters.params)
  const data = query.data
  const equipment = data?.equipment
  const variables = useMemo(() => equipment?.variables ?? [], [equipment])

  const [variableId, setVariableId] = useState<string>('')
  useEffect(() => {
    if (!variableId && variables.length) {
      const energy = variables.find((v) => v.variable_type === 'energy') ?? variables[0]
      setVariableId(String(energy.id))
    }
  }, [variables, variableId])

  const series = useApi<VariableSeriesResponse>(variableId ? `/variables/${variableId}/series` : null, {
    period: filters.period,
  })
  const nodeId = equipment?.node?.id
  const events = useApi<EventRow[]>(nodeId ? `/nodes/${nodeId}/events` : null)

  const kpis = useMemo(() => {
    const rows = data?.indicators ?? []
    return {
      hours: findIndicator(rows, (r) => r.unit === 'h'),
      idle: findIndicator(rows, (r) => r.unit === '%' && /vazio|alívio/i.test(r.name)),
      load: findIndicator(rows, (r) => /fator de carga/i.test(r.name)),
      power: findIndicator(rows, (r) => /fator de potência/i.test(r.name)),
    }
  }, [data])

  const equipmentEvents = useMemo(
    () => (events.data ?? []).filter((e) => !equipment || e.equipment === equipment.tag),
    [events.data, equipment],
  )

  if (query.error) return <ErrorState error={query.error} />
  if (!data || !equipment) return <Skeleton className="m-5 h-64" />

  const breadcrumb = [
    ...(equipment.path ?? []).map((n) => ({
      label: n.name,
      to:
        n.level === 'area'
          ? `/areas/${n.id}`
          : n.level === 'process' || n.level === 'subprocess'
            ? `/processos/${n.id}`
            : undefined,
    })),
    { label: data.use.name, to: `/uses/${data.use.id}` },
  ]

  const attributes = Object.entries(equipment.attributes ?? {})

  return (
    <>
      <PageHeader
        breadcrumb={breadcrumb}
        title={equipment.name}
        subtitle={`${equipment.tag} · ${equipment.equipment_type}`}
        badges={
          <>
            {equipment.efficiency_class && <Badge>{equipment.efficiency_class}</Badge>}
            {equipment.has_vfd && <Badge color="var(--accent)">Inversor de frequência</Badge>}
            {data.use.category && <Badge color={seriesColor(data.use.category.color_slot)}>{data.use.category.name}</Badge>}
          </>
        }
        actions={
          <Link className="btn" to={filters.link(`/uses/${data.use.id}`)}>
            <Cpu size={14} /> Abrir USE
          </Link>
        }
      />
      <Page>
        <StatRow cols={5}>
          <KpiTile
            label={`Consumo · ${data.period.short_label}`}
            value={data.energy_mwh}
            unit="MWh"
            decimals={2}
            delta={
              data.energy_mwh != null && data.previous_mwh
                ? ((data.energy_mwh - data.previous_mwh) / Math.abs(data.previous_mwh)) * 100
                : null
            }
            deltaLabel={`vs ${data.comparison_period.label}`}
          />
          <KpiTile
            label="Horas de operação"
            value={kpis.hours?.current.value ?? null}
            unit={kpis.hours?.unit}
            decimals={0}
            status={kpis.hours?.current.status}
            hint={kpis.hours ? undefined : 'Sem indicador de horas cadastrado'}
          />
          <KpiTile
            label="Tempo em vazio"
            value={kpis.idle?.current.value ?? null}
            unit={kpis.idle?.unit}
            decimals={1}
            delta={kpis.idle?.delta_pct}
            changeClass={kpis.idle?.change_class}
            status={kpis.idle?.current.status}
          />
          <KpiTile
            label="Fator de carga"
            value={kpis.load?.current.value ?? null}
            unit={kpis.load?.unit}
            decimals={1}
            status={kpis.load?.current.status}
            hint={
              kpis.load?.current.target_min != null
                ? `Faixa ${fmtAuto(kpis.load.current.target_min, 0)}–${fmtAuto(kpis.load.current.target_max, 0)}%`
                : undefined
            }
          />
          <KpiTile
            label="Fator de potência"
            value={kpis.power?.current.value ?? null}
            unit={kpis.power?.unit}
            decimals={3}
            status={kpis.power?.current.status}
            hint={kpis.power?.current.target != null ? `Meta ${fmtAuto(kpis.power.current.target, 2)}` : undefined}
          />
        </StatRow>

        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Card>
            <CardHeader
              title="Dados de placa"
              subtitle="Base dos indicadores intrínsecos (fator de carga, rendimento)"
              icon={<Wrench size={15} />}
            />
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 p-4 text-xs">
              <div>
                <dt className="text-muted">Potência nominal</dt>
                <dd className="num font-medium">{fmtAuto(equipment.rated_power_kw, 1)} kW</dd>
              </div>
              <div>
                <dt className="text-muted">Rendimento nominal</dt>
                <dd className="num font-medium">{fmtAuto(equipment.rated_efficiency_pct, 1)} %</dd>
              </div>
              <div>
                <dt className="text-muted">Classe</dt>
                <dd className="font-medium">{equipment.efficiency_class ?? EMPTY}</dd>
              </div>
              <div>
                <dt className="text-muted">Inversor</dt>
                <dd className="font-medium">{equipment.has_vfd ? 'Sim' : 'Não'}</dd>
              </div>
              <div>
                <dt className="text-muted">Fabricante</dt>
                <dd className="font-medium">{equipment.manufacturer ?? EMPTY}</dd>
              </div>
              <div>
                <dt className="text-muted">Modelo</dt>
                <dd className="font-medium">{equipment.model ?? EMPTY}</dd>
              </div>
              <div>
                <dt className="text-muted">Ano</dt>
                <dd className="num font-medium">{equipment.commissioning_year ?? EMPTY}</dd>
              </div>
              {attributes.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted">{ATTR_LABEL[k] ?? k}</dt>
                  <dd className="num font-medium">{typeof v === 'number' ? fmtAuto(v) : String(v)}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <ChartCard
            title="Histórico da variável medida"
            subtitle={series.data ? `${series.data.variable.name} · granularidade ${series.data.grain}` : 'Selecione uma tag'}
            icon={<Activity size={15} />}
            actions={
              <Select
                className="w-56"
                aria-label="Variável"
                value={variableId}
                onChange={(e) => setVariableId(e.target.value)}
                options={variables.map((v) => ({ value: String(v.id), label: `${v.name} (${v.unit})` }))}
              />
            }
            table={
              series.data
                ? {
                    columns: ['Período', `${series.data.variable.name} (${series.data.variable.unit})`, 'Dias com dado'],
                    rows: series.data.points.map((p) => [p.label, p.value, p.days]),
                  }
                : undefined
            }
          >
            {series.error ? (
              <ErrorState error={series.error} />
            ) : !series.data ? (
              <Skeleton className="h-56" />
            ) : (
              <TimeSeriesChart
                x={series.data.points.map((p) => p.label)}
                series={[
                  {
                    name: series.data.variable.name,
                    values: series.data.points.map((p) => p.value),
                    color: seriesColor(1),
                    type: series.data.variable.variable_type === 'energy' ? 'bar' : 'line',
                  },
                ]}
                unit={series.data.variable.unit}
                height={260}
                zeroBased={series.data.variable.aggregation === 'sum'}
              />
            )}
          </ChartCard>
        </div>

        <Card>
          <CardHeader
            title="Indicadores do equipamento"
            subtitle="Intrínsecos (placa e forma de operar) e extrínsecos (uso dentro do processo)"
          />
          <IndicatorTable rows={data.indicators} showFilters={false} emptyMessage="Nenhum indicador cadastrado para este equipamento." />
        </Card>

        <Card>
          <CardHeader
            title="Variáveis / tags"
            subtitle="Origem do dado, frequência de coleta e forma de agregação usada nos cálculos"
            icon={<Database size={15} />}
          />
          <div className="overflow-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Variável</th>
                  <th>Tipo</th>
                  <th>Unidade</th>
                  <th>Origem</th>
                  <th>Tag no historiador</th>
                  <th>Frequência</th>
                  <th>Coleta</th>
                  <th>Método</th>
                  <th>Agregação</th>
                  <th>Total do nó</th>
                </tr>
              </thead>
              <tbody>
                {variables.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <span className="block font-medium text-ink">{v.name}</span>
                      <span className="block text-[11px] text-muted">{v.code}</span>
                    </td>
                    <td className="text-[12px]">{VARIABLE_TYPE_LABEL[v.variable_type] ?? v.variable_type}</td>
                    <td className="text-[12px]">{v.unit}</td>
                    <td className="text-[12px]">
                      <Tooltip content={v.data_source?.protocol ?? undefined}>
                        <span>{v.data_source?.name ?? EMPTY}</span>
                      </Tooltip>
                    </td>
                    <td className="text-[11px] text-muted">{v.source_tag ?? EMPTY}</td>
                    <td className="text-[12px]">{v.collection_frequency}</td>
                    <td className="text-[12px]">{v.is_automatic ? 'Automática' : 'Manual'}</td>
                    <td className="text-[12px]">{METHOD_LABEL[v.measurement_method] ?? v.measurement_method}</td>
                    <td className="text-[12px]">{AGGREGATION_LABEL[v.aggregation] ?? v.aggregation}</td>
                    <td className="text-[12px]">{v.counts_toward_total ? 'Sim' : 'Submedição'}</td>
                  </tr>
                ))}
                {variables.length === 0 && (
                  <tr>
                    <td colSpan={10}>
                      <EmptyState title="Nenhuma variável associada a este equipamento" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Eventos operacionais"
            subtitle="Paradas, manutenções e intervenções que explicam saltos nos indicadores"
            icon={<CalendarClock size={15} />}
          />
          {equipmentEvents.length === 0 ? (
            <EmptyState title="Sem eventos registrados para este equipamento" />
          ) : (
            <ol className="divide-y divide-[var(--edge)]">
              {equipmentEvents.map((e) => (
                <li key={e.id} className="flex gap-3 px-4 py-2.5">
                  <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium text-ink">
                      {EVENT_LABEL[e.event_type] ?? e.event_type}
                      <span className="ml-2 font-normal text-muted">
                        {fmtDateFull(e.ts_start)}
                        {e.ts_end ? ` – ${fmtDateFull(e.ts_end)}` : ''}
                      </span>
                    </p>
                    <p className="text-[11px] leading-snug text-ink-2">{e.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <p className="text-[11px] text-muted">
          Consumo do USE no período: {fmtNum(data.energy_mwh, 2)} MWh · {data.indicators.length} indicadores ·{' '}
          {variables.length} tags monitoradas.
        </p>
      </Page>
    </>
  )
}
