/** Página do indicador: valor, meta, baseline, histórico, controle estatístico, componentes da fórmula,
 *  consumo esperado (linha de base) e qualidade do dado — tudo ligado à etapa física que ele representa. */
import { Calculator, Database, GitCompareArrows, Lightbulb, Settings2, Workflow } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'

import { BulletChart, ChartCard, ScatterChart, TimeSeriesChart } from '../components/charts'
import { KpiTile, StatRow } from '../components/common/Kpi'
import { OpportunityDialog } from '../components/ops/OpportunityDialog'
import { Page, PageHeader } from '../components/layout/AppShell'
import { Badge, Button, Card, CardHeader, ErrorState, Segmented, Skeleton, Tabs, Tooltip } from '../components/ui/primitives'
import { DeltaBadge, StatusPill, TrendBadge } from '../components/ui/status'
import { AGGREGATION_LABEL, KIND_LABEL, METHOD_LABEL, fmtAuto, fmtDateFull, fmtDateTime, fmtNum, fmtPct } from '../lib/format'
import { useApi, useFilters } from '../lib/hooks'
import type {
  BaselineEvaluation,
  Component,
  Evaluation,
  History,
  IndicatorDetail,
  Opportunity,
  PeriodInfo,
  Variable,
} from '../lib/types'

interface IndicatorResponse {
  indicator: IndicatorDetail
  period: PeriodInfo
  comparison_period: PeriodInfo
  current: Evaluation
  previous: Evaluation
  delta: number | null
  delta_pct: number | null
  change_class: 'melhoria' | 'piora' | 'estavel' | 'aumento' | 'reducao' | 'indefinido'
  opportunities: Pick<Opportunity, 'id' | 'code' | 'title' | 'status' | 'priority'>[]
}

interface ComponentsResponse {
  symbols: Record<string, { variable: Variable | null; source_type: string; aggregation: string | null }>
  current: { period: PeriodInfo; points: { label: string; start: string; value: number | null; components: Record<string, number | null> }[] }
  previous: { period: PeriodInfo; points: { label: string; start: string; value: number | null; components: Record<string, number | null> }[] }
}

export function IndicatorPage() {
  const { indicatorId } = useParams()
  const filters = useFilters()
  const [tab, setTab] = useState('historico')
  const [grain, setGrain] = useState<'day' | 'week' | 'month'>('week')
  const [window, setWindow] = useState(26)
  const [openOpportunity, setOpenOpportunity] = useState(false)

  const q = useApi<IndicatorResponse>(`/indicators/${indicatorId}`, filters.params)
  const history = useApi<History>(`/indicators/${indicatorId}/history`, { ...filters.params, grain, window })
  const components = useApi<ComponentsResponse>(
    tab === 'componentes' ? `/indicators/${indicatorId}/components` : null,
    { ...filters.params, grain: 'day' },
  )
  const quality = useApi<{ items: (Component & Variable & { days_with_data: number; expected_days: number; completeness_pct: number; quality_breakdown: Record<string, number>; suspect_or_bad_pct: number; last_value_at: string | null })[]; min_completeness_pct: number; note: string }>(
    tab === 'qualidade' ? `/indicators/${indicatorId}/quality` : null,
    filters.params,
  )
  const baselineId = q.data?.indicator.baseline_model_id
  const baseline = useApi<BaselineEvaluation>(
    tab === 'esperado' && baselineId ? `/baselines/${baselineId}/evaluate` : null,
    { ...filters.params, grain: 'week', window: 52 },
  )

  if (q.error) return <ErrorState error={q.error} />
  if (!q.data) {
    return (
      <Page>
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </Page>
    )
  }

  const ind = q.data.indicator
  const cur = q.data.current
  const prev = q.data.previous
  const area = ind.path.find((n) => n.level === 'area')
  const lowerIsBetter = ind.direction !== 'higher_better'

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: 'Dashboard', to: '/' },
          ...ind.path
            .filter((n) => ['area', 'process', 'subprocess'].includes(n.level))
            .map((n) => ({ label: n.name, to: n.level === 'area' ? `/areas/${n.id}` : `/processos/${n.id}` })),
          ...(ind.use ? [{ label: ind.use.name, to: `/uses/${ind.use.id}` }] : []),
          ...(ind.equipment ? [{ label: ind.equipment.tag, to: `/equipamentos/${ind.equipment.id}` }] : []),
          { label: ind.name },
        ]}
        title={ind.name}
        badges={
          <>
            <Badge>{KIND_LABEL[ind.kind]}</Badge>
            <Badge>{ind.category}</Badge>
            <Badge title="Código do indicador">{ind.code}</Badge>
            <StatusPill status={cur.status} explanation={cur.status_explanation} />
          </>
        }
        subtitle={
          <>
            {ind.description} · {q.data.period.label} vs {q.data.comparison_period.label} · coleta {ind.collection} (
            {ind.frequency})
          </>
        }
        actions={
          <>
            {area && (
              <Link to={filters.link(`/areas/${area.id}/fluxograma`, { sel: String(ind.node?.id ?? '') })} className="btn">
                <Workflow size={14} /> Ver no fluxograma
              </Link>
            )}
            <Link to={filters.link('/comparacoes', { node: String(ind.node?.id ?? '') })} className="btn">
              <GitCompareArrows size={14} /> Comparar
            </Link>
            <Button variant="primary" onClick={() => setOpenOpportunity(true)}>
              <Lightbulb size={14} /> Registrar oportunidade
            </Button>
          </>
        }
      />
      <Page>
        <StatRow cols={5}>
          <KpiTile
            label={`Valor no período (${ind.unit})`}
            value={cur.value}
            decimals={ind.decimals}
            delta={q.data.delta_pct}
            changeClass={q.data.change_class}
            deltaLabel={`vs ${q.data.comparison_period.short_label}`}
            status={cur.status}
            hero
            hint={cur.value === null ? (cur.reason ?? undefined) : cur.status_explanation}
          />
          <KpiTile label={`Período anterior (${q.data.comparison_period.short_label})`} value={prev.value} decimals={ind.decimals} unit={ind.unit} />
          <KpiTile
            label="Meta vigente"
            value={cur.target ?? (cur.target_min !== null ? `${fmtAuto(cur.target_min, ind.decimals)} – ${fmtAuto(cur.target_max, ind.decimals)}` : null)}
            unit={ind.unit}
            decimals={ind.decimals}
            hint={
              cur.deviation_target_pct != null
                ? `Desvio da meta: ${fmtPct(cur.deviation_target_pct, 1, true)}`
                : cur.target_min != null
                  ? `Faixa alvo · ${cur.deviation_pct != null && cur.deviation_pct > 0 ? `fora da faixa (${fmtPct(cur.deviation_pct, 1)} da largura)` : 'dentro da faixa'}`
                  : 'Indicador informativo (sem meta)'
            }
            footer={
              cur.target != null ? (
                <div className="mt-2">
                  <BulletChart value={cur.value} target={cur.target} baseline={cur.baseline} unit={ind.unit} decimals={ind.decimals} lowerIsBetter={lowerIsBetter} />
                </div>
              ) : undefined
            }
          />
          <KpiTile
            label="Baseline"
            value={cur.baseline}
            unit={ind.unit}
            decimals={ind.decimals}
            hint={cur.deviation_baseline_pct != null ? `Desvio da baseline: ${fmtPct(cur.deviation_baseline_pct, 1, true)}` : undefined}
          />
          <KpiTile
            label="Completude dos dados"
            value={cur.completeness_pct}
            unit="%"
            hint={`Mínimo exigido: ${fmtNum(ind.min_completeness_pct, 0)}% · ${cur.operating_days != null ? `${cur.operating_days} dias de operação` : `${cur.expected_days} dias no período`}`}
          />
        </StatRow>

        <Card>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'historico', label: 'Histórico e tendência' },
              { value: 'componentes', label: 'Energia × produção' },
              ...(baselineId ? [{ value: 'esperado', label: 'Observado × esperado' }] : []),
              { value: 'definicao', label: 'Definição e fórmula' },
              { value: 'qualidade', label: 'Qualidade do dado' },
            ]}
          />

          {tab === 'historico' && (
            <div className="space-y-4 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Segmented
                  value={grain}
                  onChange={(v) => setGrain(v as typeof grain)}
                  options={[
                    { value: 'day', label: 'Diário' },
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
                <span className="text-xs text-muted">períodos exibidos</span>
                {history.data && (
                  <div className="ml-auto flex flex-wrap items-center gap-3">
                    <TrendBadge trend={history.data.trend.classification} relative={history.data.trend.relative_change_pct} />
                    {history.data.control.applicable && (
                      <Tooltip
                        content={`Carta de controle de valores individuais (I-MR): centro ${fmtAuto(history.data.control.center, ind.decimals)}, limites ${fmtAuto(history.data.control.lcl, ind.decimals)} a ${fmtAuto(history.data.control.ucl, ind.decimals)}.`}
                      >
                        <span className="text-xs text-ink-2">
                          {history.data.control.out_of_control_count} ponto(s) fora de controle
                        </span>
                      </Tooltip>
                    )}
                    {history.data.control.shift_detected_at && (
                      <Badge color="var(--warning)">
                        Mudança de comportamento desde {fmtDateFull(history.data.control.shift_detected_at)}
                      </Badge>
                    )}
                  </div>
                )}
              </div>

              {history.data ? (
                <ChartCard
                  title={`${ind.name} (${ind.unit})`}
                  subtitle={`${fmtDateFull(history.data.start)} a ${fmtDateFull(history.data.end)} · média móvel de ${history.data.moving_average_window} períodos`}
                  table={{
                    columns: ['Período', `Valor (${ind.unit})`, 'Média móvel', 'Meta', 'Completude %', 'Status'],
                    rows: history.data.points.map((p) => [p.label, p.value, p.moving_avg, p.target, p.completeness_pct, p.status]),
                  }}
                  note="Pontos vermelhos indicam valores fora dos limites de controle estatístico (I-MR). Buckets sem operação ou sem dados não são plotados."
                >
                  <TimeSeriesChart
                    x={history.data.points.map((p) => p.label)}
                    series={[
                      { name: ind.name, values: history.data.points.map((p) => p.value) },
                      {
                        name: `Média móvel (${history.data.moving_average_window})`,
                        values: history.data.points.map((p) => p.moving_avg),
                        color: 'var(--s7)',
                        dashed: true,
                        hideSymbol: true,
                      },
                      {
                        name: 'Tendência',
                        values: history.data.points.map((p) => p.trend),
                        color: 'var(--muted)',
                        dashed: true,
                        width: 1.5,
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
                      ...(history.data.control.applicable
                        ? [
                            { name: 'LSC', value: history.data.control.ucl as number, color: 'var(--critical)' },
                            { name: 'LIC', value: history.data.control.lcl as number, color: 'var(--critical)' },
                          ]
                        : []),
                    ]}
                    markers={
                      history.data.points
                        .map((p, i) => (p.out_of_control ? { index: i, name: 'Fora de controle' } : null))
                        .filter(Boolean) as { index: number; name: string }[]
                    }
                    unit={ind.unit}
                    decimals={ind.decimals}
                    zeroBased={false}
                    height={320}
                  />
                </ChartCard>
              ) : (
                <Skeleton className="h-72" />
              )}
            </div>
          )}

          {tab === 'componentes' && (
            <div className="space-y-4 p-4">
              <p className="text-xs text-ink-2">
                O valor do período é calculado sobre os agregados: <b>{ind.formula}</b>. Abaixo, os valores diários de cada símbolo —
                é assim que se separa efeito de volume de efeito de eficiência.
              </p>
              {components.data ? (
                <>
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Símbolo</th>
                          <th>Variável</th>
                          <th>Agregação</th>
                          <th className="right">{q.data.period.short_label}</th>
                          <th className="right">{q.data.comparison_period.short_label}</th>
                          <th className="right">Δ %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(cur.components ?? []).map((c) => {
                          const p = (prev.components ?? []).find((x) => x.symbol === c.symbol)
                          const delta = c.value != null && p?.value ? ((c.value - p.value) / Math.abs(p.value)) * 100 : null
                          return (
                            <tr key={c.symbol}>
                              <td className="font-semibold">{c.symbol}</td>
                              <td>
                                <span className="block">{c.variable_name ?? c.source_type}</span>
                                <span className="block text-[11px] text-muted">{c.variable_code ?? ''}</span>
                              </td>
                              <td className="text-[11px] text-ink-2">{c.aggregation ? AGGREGATION_LABEL[c.aggregation] : '—'}</td>
                              <td className="right">
                                {fmtAuto(c.value)} <span className="text-[11px] text-muted">{c.unit}</span>
                              </td>
                              <td className="right">{fmtAuto(p?.value ?? null)}</td>
                              <td className="right">
                                <DeltaBadge pct={delta} compact />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <ScatterPanel data={components.data} periodA={q.data.period.short_label} periodB={q.data.comparison_period.short_label} />
                </>
              ) : (
                <Skeleton className="h-64" />
              )}
            </div>
          )}

          {tab === 'esperado' && (
            <div className="space-y-3 p-4">
              {baseline.data ? (
                <>
                  <p className="text-xs text-ink-2">
                    Linha de base <b>{baseline.data.baseline.name}</b> ajustada em {fmtDateFull(baseline.data.baseline.period_start)} a{' '}
                    {fmtDateFull(baseline.data.baseline.period_end)} — R² {fmtNum(baseline.data.baseline.model.r2! * 100, 1)}%, CV(RMSE){' '}
                    {fmtNum(baseline.data.baseline.model.cv_rmse_pct, 1)}%, {baseline.data.baseline.model.n} dias de operação. Consumo
                    esperado = {fmtNum(baseline.data.baseline.model.intercept, 2)}
                    {Object.entries(baseline.data.baseline.model.coefficients ?? {}).map(([sym, coef]) => (
                      <span key={sym}>
                        {' '}
                        + {fmtNum(coef, 4)} × {baseline.data!.baseline.model.variable_details?.[sym]?.name ?? sym}
                      </span>
                    ))}
                    .
                  </p>
                  <ChartCard
                    title="Observado × esperado"
                    subtitle={`Acumulado no período: observado ${fmtNum(baseline.data.total_observed, 1)} ${baseline.data.unit ?? ''} · esperado ${fmtNum(baseline.data.total_expected, 1)} ${baseline.data.unit ?? ''} · diferença ${fmtNum(-baseline.data.savings, 1)} (${fmtPct(-(baseline.data.savings_pct ?? 0), 1, true)})`}
                    table={{
                      columns: ['Período', 'Observado', 'Esperado', 'Diferença', 'CUSUM'],
                      rows: baseline.data.points.map((p) => [p.label, p.observed, p.expected, p.difference, p.cusum]),
                    }}
                    note="CUSUM acumula a diferença entre observado e esperado: inclinação para baixo indica economia sustentada."
                  >
                    <div className="space-y-1">
                      <TimeSeriesChart
                        x={baseline.data.points.map((p) => p.label)}
                        series={[
                          { name: 'Observado', values: baseline.data.points.map((p) => p.observed) },
                          { name: 'Esperado (baseline)', values: baseline.data.points.map((p) => p.expected), color: 'var(--muted)', dashed: true, hideSymbol: true },
                        ]}
                        unit={baseline.data.unit ?? ''}
                        height={220}
                      />
                      <TimeSeriesChart
                        x={baseline.data.points.map((p) => p.label)}
                        series={[{ name: 'CUSUM (observado − esperado)', values: baseline.data.points.map((p) => p.cusum), color: 'var(--s3)', area: true }]}
                        unit={baseline.data.unit ?? ''}
                        height={150}
                        zeroBased={false}
                      />
                    </div>
                  </ChartCard>
                </>
              ) : (
                <Skeleton className="h-72" />
              )}
            </div>
          )}

          {tab === 'definicao' && (
            <div className="grid gap-4 p-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="Fórmula e vínculos" icon={<Calculator size={14} />} subtitle="Cadastrado como dado — nenhum cálculo está no código" />
                <div className="space-y-3 p-4">
                  <code className="block rounded-lg bg-surface-2 px-3 py-2 text-[13px]">{ind.formula}</code>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Símbolo</th>
                        <th>Origem</th>
                        <th>Agregação</th>
                        <th>Unidade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ind.bindings.map((b) => (
                        <tr key={b.symbol}>
                          <td className="font-semibold">{b.symbol}</td>
                          <td>
                            {b.source_type === 'variable' && b.variable ? (
                              <>
                                <span className="block">{b.variable.name}</span>
                                <span className="block text-[11px] text-muted">
                                  {b.variable.code} · {b.variable.data_source?.name} · {b.variable.source_tag}
                                </span>
                              </>
                            ) : b.source_type === 'constant' ? (
                              <>Constante: {fmtAuto(b.constant_value)}</>
                            ) : b.source_type === 'equipment_attribute' ? (
                              <>Dado de placa: {b.attribute}</>
                            ) : (
                              <>Função do período: {b.builtin}</>
                            )}
                          </td>
                          <td className="text-[11px]">{b.aggregation ? AGGREGATION_LABEL[b.aggregation] : b.variable ? AGGREGATION_LABEL[b.variable.aggregation] : '—'}</td>
                          <td className="text-[11px]">{b.unit ?? b.variable?.unit ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <Info label="Direção desejada" value={ind.direction === 'lower_better' ? 'Menor é melhor' : ind.direction === 'higher_better' ? 'Maior é melhor' : ind.direction === 'target_range' ? 'Faixa alvo' : 'Informativo'} />
                    <Info label="Unidade" value={ind.unit} />
                    <Info label="Frequência de cálculo" value={ind.frequency} />
                    <Info label="Completude mínima" value={`${fmtNum(ind.min_completeness_pct, 0)}%`} />
                    <Info label="Tolerância / crítico" value={`${fmtNum(ind.status_rule.tolerance_pct ?? 0, 0)}% / ${fmtNum(ind.status_rule.critical_pct ?? 0, 0)}%`} />
                    <Info label="Faixa de estabilidade" value={`${fmtNum(ind.stability_band_pct, 0)}%`} />
                    <Info label="Responsável" value={ind.responsible?.name ?? '—'} />
                    <Info label="Variável de operação" value={ind.operating_variable?.name ?? '—'} />
                  </dl>
                  {ind.data_origin_note && <p className="text-[11px] text-muted">{ind.data_origin_note}</p>}
                  <Link to={filters.link('/configuracoes', { tab: 'indicadores', id: String(ind.id) })} className="btn text-xs">
                    <Settings2 size={13} /> Editar indicador
                  </Link>
                </div>
              </Card>

              <Card>
                <CardHeader title="Metas e baselines" subtitle="Metas anuais (Crop Year) e metas por janela de safra" />
                <div className="overflow-x-auto p-1">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Escopo</th>
                        <th>Vigência</th>
                        <th className="right">Meta</th>
                        <th className="right">Baseline</th>
                        <th>Justificativa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ind.targets.map((t) => (
                        <tr key={t.id}>
                          <td>{t.label ?? t.scope}</td>
                          <td className="text-[11px]">
                            {fmtDateFull(t.valid_from)} {t.valid_to ? `– ${fmtDateFull(t.valid_to)}` : '– em diante'}
                          </td>
                          <td className="right">
                            {t.target_value != null
                              ? fmtAuto(t.target_value, ind.decimals)
                              : t.target_min != null
                                ? `${fmtAuto(t.target_min, ind.decimals)} – ${fmtAuto(t.target_max, ind.decimals)}`
                                : '—'}
                          </td>
                          <td className="right">{fmtAuto(t.baseline_value, ind.decimals)}</td>
                          <td className="text-[11px] text-ink-2">{t.justification}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {q.data.opportunities.length > 0 && (
                  <div className="border-t border-edge p-4">
                    <p className="label mb-2">Oportunidades relacionadas</p>
                    <ul className="space-y-1 text-xs">
                      {q.data.opportunities.map((o) => (
                        <li key={o.id}>
                          <Link to={filters.link('/oportunidades', { id: String(o.id) })} className="hover:underline">
                            {o.code} · {o.title} <span className="text-muted">({o.status})</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            </div>
          )}

          {tab === 'qualidade' && (
            <div className="space-y-3 p-4">
              {quality.data ? (
                <>
                  <p className="text-xs text-ink-2">{quality.data.note}</p>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Símbolo</th>
                        <th>Variável / tag</th>
                        <th>Origem</th>
                        <th>Coleta</th>
                        <th className="right">Dias com dado</th>
                        <th className="right">Completude</th>
                        <th className="right">Suspeitas/ruins</th>
                        <th>Última leitura</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quality.data.items.map((v) => (
                        <tr key={v.symbol}>
                          <td className="font-semibold">{v.symbol}</td>
                          <td>
                            <span className="block">{v.name}</span>
                            <span className="block text-[11px] text-muted">{v.source_tag}</span>
                          </td>
                          <td className="text-[11px]">{v.data_source?.name}</td>
                          <td className="text-[11px]">
                            {v.is_automatic ? 'Automática' : 'Manual'} · {METHOD_LABEL[v.measurement_method]} · {v.collection_frequency}
                          </td>
                          <td className="right">
                            {v.days_with_data}/{v.expected_days}
                          </td>
                          <td className="right">
                            <span style={{ color: v.completeness_pct < quality.data!.min_completeness_pct ? 'var(--critical-text)' : undefined }}>
                              {fmtNum(v.completeness_pct, 1)}%
                            </span>
                          </td>
                          <td className="right">{fmtNum(v.suspect_or_bad_pct, 2)}%</td>
                          <td className="text-[11px]">{fmtDateTime(v.last_value_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <Skeleton className="h-40" />
              )}
            </div>
          )}
        </Card>
      </Page>

      {openOpportunity && (
        <OpportunityDialog
          open
          onClose={() => setOpenOpportunity(false)}
          diagnostic={{
            type: 'desvio',
            severity: cur.status,
            title: ind.name,
            explanation: cur.status_explanation,
            indicator_id: ind.id,
            indicator: ind.name,
            unit: ind.unit,
            value: cur.value,
            target: cur.target,
            baseline: cur.baseline,
            deviation_pct: cur.deviation_pct,
            status: cur.status,
            decimals: ind.decimals,
            node: ind.node,
            use: ind.use ? { id: ind.use.id, name: ind.use.name } : null,
            equipment: ind.equipment,
          }}
        />
      )}
    </>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="text-xs text-ink">{value}</dd>
    </div>
  )
}

function ScatterPanel({ data, periodA, periodB }: { data: ComponentsResponse; periodA: string; periodB: string }) {
  const symbols = Object.entries(data.symbols).filter(([, s]) => s.variable)
  const energy = symbols.find(([, s]) => s.variable?.variable_type === 'energy')
  const production = symbols.find(([, s]) => s.variable?.variable_type === 'production')
  if (!energy || !production) {
    return (
      <p className="rounded-lg border border-edge bg-surface-2 p-3 text-xs text-muted">
        <Database size={13} className="mr-1 inline" />
        Este indicador não combina energia e produção — o gráfico de dispersão fica disponível para indicadores de intensidade.
      </p>
    )
  }
  const build = (points: ComponentsResponse['current']['points']) =>
    points
      .map((p) => [p.components[production[0]], p.components[energy[0]]] as [number | null, number | null])
      .filter((p): p is [number, number] => p[0] !== null && p[1] !== null && p[0] > 0)
  return (
    <ChartCard
      title="Energia × produção (valores diários)"
      subtitle="A inclinação é o consumo específico; o intercepto revela o consumo fixo, que não depende do volume"
      table={{
        columns: ['Dia', `${production[1].variable?.name} (${production[1].variable?.unit})`, `${energy[1].variable?.name} (${energy[1].variable?.unit})`],
        rows: data.current.points.map((p) => [p.label, p.components[production[0]], p.components[energy[0]]]),
      }}
    >
      <ScatterChart
        series={[
          { name: periodA, points: build(data.current.points), color: 'var(--s1)' },
          { name: periodB, points: build(data.previous.points), color: 'var(--s2)' },
        ]}
        xName={production[1].variable?.name ?? 'Produção'}
        yName={energy[1].variable?.name ?? 'Energia'}
        xUnit={production[1].variable?.unit}
        yUnit={energy[1].variable?.unit}
        height={300}
      />
    </ChartCard>
  )
}
