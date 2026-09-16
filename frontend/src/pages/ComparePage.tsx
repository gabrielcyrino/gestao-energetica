/** Comparação entre períodos: semana × semana, mês × mês, ano × ano, Crop Year, safra ou período livre.
 *  O diferencial é separar o efeito do VOLUME de produção do efeito da EFICIÊNCIA (decomposição LMDI):
 *  consumo maior nem sempre é piora de desempenho. */
import { CalendarRange, GitCompareArrows, Info, Layers, Wrench } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { ChartCard, CategoryBars, TimeSeriesChart, seriesTable } from '../components/charts'
import { Page, PageHeader } from '../components/layout/AppShell'
import { KpiTile, StatRow } from '../components/common/Kpi'
import { DiagnosticsList } from '../components/indicators/Diagnostics'
import { IndicatorTable } from '../components/indicators/IndicatorTable'
import { Button, Card, CardHeader, Chip, EmptyState, ErrorState, Popover, Select, Skeleton, Tooltip } from '../components/ui/primitives'
import { StatusBar } from '../components/ui/status'
import { EMPTY, REGIME_LABEL, fmtAuto, fmtNum, fmtPct } from '../lib/format'
import { useApi, useFilters, useMeta } from '../lib/hooks'
import type { CompareResponse, Equipment, PeriodInfo, TreeNode, Use } from '../lib/types'

/* ------------------------------------------------------------------ helpers */

function flatten(tree: TreeNode[] | undefined): TreeNode[] {
  const out: TreeNode[] = []
  const walk = (nodes: TreeNode[]) => {
    nodes.forEach((n) => {
      out.push(n)
      walk(n.children)
    })
  }
  walk(tree ?? [])
  return out
}

function indentFor(level: string): string {
  return { company: '', plant: '', area: '', process: '   ', subprocess: '      ' }[level] ?? ''
}

/** Decomposição LMDI: ΔE = efeito produção + efeito intensidade (soma exata). */
function LmdiWaterfall({
  previousMwh,
  currentMwh,
  productionEffect,
  intensityEffect,
  labelA,
  labelB,
}: {
  previousMwh: number
  currentMwh: number
  productionEffect: number
  intensityEffect: number
  labelA: string
  labelB: string
}) {
  const afterProduction = previousMwh + productionEffect
  const max = Math.max(previousMwh, currentMwh, afterProduction) * 1.12 || 1
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`

  const rows = [
    { label: `Consumo ${labelB}`, kind: 'total' as const, value: previousMwh, start: 0, width: previousMwh },
    {
      label: 'Efeito produção (volume)',
      kind: 'effect' as const,
      value: productionEffect,
      start: Math.min(previousMwh, afterProduction),
      width: Math.abs(productionEffect),
      color: 'var(--s1)',
    },
    {
      label: 'Efeito intensidade (eficiência)',
      kind: 'effect' as const,
      value: intensityEffect,
      start: Math.min(afterProduction, afterProduction + intensityEffect),
      width: Math.abs(intensityEffect),
      color: intensityEffect > 0 ? 'var(--critical)' : 'var(--good)',
    },
    { label: `Consumo ${labelA}`, kind: 'total' as const, value: currentMwh, start: 0, width: currentMwh },
  ]

  return (
    <div className="space-y-2 px-2 py-1">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[190px_1fr_92px] items-center gap-2">
          <span className="truncate text-[12px] text-ink-2">{r.label}</span>
          <div className="relative h-5 rounded-sm bg-surface-2">
            <div
              className="absolute inset-y-0.5 rounded-sm"
              style={{
                left: pct(r.start),
                width: pct(r.width),
                background: r.kind === 'total' ? 'var(--ink-2)' : r.color,
                opacity: r.kind === 'total' ? 0.55 : 0.95,
              }}
            />
          </div>
          <span className="num text-right text-[12px] font-medium text-ink">
            {r.kind === 'effect' && r.value > 0 ? '+' : ''}
            {fmtNum(r.value, 1)}
          </span>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ página */

export function ComparePage() {
  const filters = useFilters()
  const meta = useMeta()
  const [sp, setSp] = useSearchParams()
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const nodeId = sp.get('node')
  const useId = sp.get('use')
  const eqId = sp.get('eq')

  const patch = (values: Record<string, string | null>) => {
    const next = new URLSearchParams(sp)
    Object.entries(values).forEach(([k, v]) => {
      if (v === null || v === '') next.delete(k)
      else next.set(k, v)
    })
    setSp(next)
  }

  const tree = useApi<TreeNode[]>('/hierarchy/tree')
  const nodes = useMemo(() => flatten(tree.data).filter((n) => n.level !== 'company'), [tree.data])
  const uses = useApi<Use[]>('/uses', { node_id: nodeId ?? undefined })
  const equipment = useApi<Equipment[]>('/equipment', { node_id: nodeId ?? undefined })

  const data = useApi<CompareResponse>('/compare', {
    ...filters.params,
    node_id: nodeId ?? undefined,
    use_id: useId ?? undefined,
    equipment_id: eqId ?? undefined,
  })

  const periods = meta.data?.periods
  const latest = (list: PeriodInfo[] | undefined) => list?.[0]?.spec
  const currentKind = filters.period.split(':')[0]

  const shortcuts: { label: string; title: string; active: boolean; apply: () => void }[] = [
    {
      label: 'Semana × semana anterior',
      title: 'Compara a semana selecionada com a semana imediatamente anterior',
      active: currentKind === 'week' && filters.compare === 'prev',
      apply: () => patch({ p: currentKind === 'week' ? filters.period : (latest(periods?.week) ?? null), c: 'prev' }),
    },
    {
      label: 'Mês × mês anterior',
      title: 'Ex.: Agosto de 2026 × Julho de 2026',
      active: currentKind === 'month' && filters.compare === 'prev',
      apply: () => patch({ p: currentKind === 'month' ? filters.period : (latest(periods?.month) ?? null), c: 'prev' }),
    },
    {
      label: 'Ano × ano anterior',
      title: 'Ex.: 2026 × 2025',
      active: currentKind === 'year' && filters.compare === 'prev',
      apply: () => patch({ p: currentKind === 'year' ? filters.period : (latest(periods?.year) ?? null), c: 'prev' }),
    },
    {
      label: 'Crop Year × Crop Year',
      title: 'Crop Year é uma entidade configurável, com data inicial e final próprias',
      active: currentKind === 'crop_year' && filters.compare === 'prev',
      apply: () => patch({ p: currentKind === 'crop_year' ? filters.period : (latest(periods?.crop_year) ?? null), c: 'prev' }),
    },
    {
      label: 'Safra × safra anterior',
      title: 'Compara com a safra anterior do mesmo tipo (verão com verão, safrinha com safrinha)',
      active: currentKind === 'season' && filters.compare === 'prev',
      apply: () => patch({ p: currentKind === 'season' ? filters.period : (latest(periods?.season) ?? null), c: 'prev' }),
    },
    {
      label: 'Mesmo período do ano anterior',
      title: 'Mantém o período atual e compara com o equivalente do ano anterior',
      active: filters.compare === 'yoy',
      apply: () => patch({ c: 'yoy' }),
    },
  ]

  const cur = data.data?.period
  const prev = data.data?.comparison_period
  const energy = data.data?.energy

  const scopeName =
    data.data?.scope.name ?? nodes.find((n) => String(n.id) === nodeId)?.name ?? 'Planta inteira'

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Análise' }, { label: 'Comparações' }]}
        title="Comparação entre períodos"
        subtitle={
          cur && prev ? (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <b className="text-ink">{cur.label}</b>
              <span className="text-muted">×</span>
              <b className="text-ink">{prev.label}</b>
              <span className="text-muted">· escopo: {scopeName}</span>
              {cur.partial && (
                <Tooltip content="Período em andamento: recortado na última data com dados disponíveis.">
                  <span className="rounded border border-[var(--warning)] px-1 text-[10px]">parcial</span>
                </Tooltip>
              )}
              {prev.aligned && (
                <Tooltip content="O período de comparação foi recortado para o mesmo número de dias decorridos — comparação em base equivalente.">
                  <span className="rounded border border-[var(--accent)] px-1 text-[10px]">base equivalente</span>
                </Tooltip>
              )}
            </span>
          ) : (
            'Selecione os períodos na barra superior'
          )
        }
        actions={
          <Popover
            align="end"
            trigger={
              <Button>
                <CalendarRange size={14} /> Período personalizado
              </Button>
            }
          >
            <div className="space-y-2">
              <p className="text-xs text-ink-2">Compara o intervalo escolhido com o intervalo anterior de mesmo tamanho.</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-ink-2">
                  De
                  <input type="date" className="input mt-1" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                </label>
                <label className="text-xs text-ink-2">
                  Até
                  <input type="date" className="input mt-1" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                </label>
              </div>
              <Button
                variant="primary"
                className="w-full justify-center"
                disabled={!customFrom || !customTo || customFrom > customTo}
                onClick={() => patch({ p: `custom:${customFrom}..${customTo}`, c: 'prev' })}
              >
                Aplicar
              </Button>
            </div>
          </Popover>
        }
      />

      <Page>
        {/* ------------------------------------------------ atalhos e escopo */}
        <Card>
          <CardHeader
            title="Como comparar"
            subtitle="Os atalhos ajustam o período global; o escopo define o recorte físico da análise."
            icon={<GitCompareArrows size={15} />}
          />
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            {shortcuts.map((s) => (
              <Chip key={s.label} active={s.active} onClick={s.apply} title={s.title}>
                {s.label}
              </Chip>
            ))}
          </div>
          <div className="grid gap-3 border-t border-edge px-4 py-3 md:grid-cols-3">
            <label className="text-xs text-ink-2">
              <span className="mb-1 flex items-center gap-1 font-medium">
                <Layers size={12} /> Área / processo
              </span>
              <Select
                value={nodeId ?? ''}
                onChange={(e) => patch({ node: e.target.value || null, use: null, eq: null })}
                options={[
                  { value: '', label: 'Planta inteira' },
                  ...nodes.map((n) => ({ value: n.id, label: `${indentFor(n.level)}${n.name}` })),
                ]}
              />
            </label>
            <label className="text-xs text-ink-2">
              <span className="mb-1 flex items-center gap-1 font-medium">
                <Wrench size={12} /> USE (opcional)
              </span>
              <Select
                value={useId ?? ''}
                onChange={(e) => patch({ use: e.target.value || null, eq: null })}
                options={[
                  { value: '', label: 'Todos os USEs' },
                  ...(uses.data ?? []).map((u) => ({ value: u.id, label: u.name })),
                ]}
              />
            </label>
            <label className="text-xs text-ink-2">
              <span className="mb-1 flex items-center gap-1 font-medium">
                <Wrench size={12} /> Equipamento (opcional)
              </span>
              <Select
                value={eqId ?? ''}
                onChange={(e) => patch({ eq: e.target.value || null })}
                options={[
                  { value: '', label: 'Todos os equipamentos' },
                  ...(equipment.data ?? []).map((e) => ({ value: e.id, label: `${e.tag} — ${e.name}` })),
                ]}
              />
            </label>
          </div>
        </Card>

        {data.error ? (
          <ErrorState error={data.error} />
        ) : data.isPending || !data.data || !energy || !cur || !prev ? (
          <Skeleton style={{ height: 320 }} />
        ) : (
          <div className={data.isFetching ? 'space-y-4 opacity-60 transition-opacity' : 'space-y-4 transition-opacity'}>
            {/* ------------------------------------------------ KPIs A × B */}
            <StatRow cols={5}>
              <KpiTile
                label={`Consumo · ${cur.short_label}`}
                value={energy.current.energy_mwh}
                unit="MWh"
                decimals={1}
                delta={energy.energy_delta_pct}
                deltaLabel={`vs ${prev.short_label}: ${fmtAuto(energy.previous.energy_mwh, 1)} MWh`}
                hint={`Período anterior: ${fmtAuto(energy.previous.energy_mwh, 1)} MWh`}
              />
              <KpiTile
                label={`Produção · ${cur.short_label}`}
                value={energy.current.production}
                unit={energy.current.production_unit ?? ''}
                decimals={0}
                delta={energy.production_delta_pct}
                hint={
                  energy.current.production_name
                    ? `${energy.current.production_name} — anterior: ${fmtAuto(energy.previous.production, 0)}`
                    : 'Sem variável de produção de referência'
                }
              />
              <KpiTile
                label="Intensidade energética"
                value={energy.current.intensity_kwh_per_unit}
                unit={energy.current.intensity_unit ?? ''}
                decimals={2}
                delta={energy.intensity_delta_pct}
                changeClass={
                  energy.intensity_delta_pct === null || energy.intensity_delta_pct === undefined
                    ? 'indefinido'
                    : energy.intensity_delta_pct < 0
                      ? 'melhoria'
                      : 'piora'
                }
                hint={`Anterior: ${fmtAuto(energy.previous.intensity_kwh_per_unit, 2)} ${energy.previous.intensity_unit ?? ''}`}
              />
              <KpiTile
                label="Indicadores comparados"
                value={data.data.indicators.length}
                hint="Cada IDE avaliado nos dois períodos, com a meta vigente em cada um."
                footer={
                  <div className="mt-2">
                    <StatusBar counts={data.data.status_counts} />
                  </div>
                }
              />
              <KpiTile
                label="Completude dos dados"
                value={energy.current.completeness_pct}
                unit="%"
                decimals={0}
                hint={`Medição: ${energy.current.metering}. Dias sem leitura não viram zero.`}
              />
            </StatRow>

            {/* ------------------------------------------------ LMDI */}
            <ChartCard
              title="De onde veio a variação de consumo"
              subtitle="Decomposição LMDI: quanto da diferença é volume de produção e quanto é eficiência"
              icon={<Info size={15} />}
              note={
                energy.decomposition
                  ? 'Aumento de consumo não significa, por si só, piora de desempenho: se o efeito produção domina, a planta processou mais. A piora de eficiência aparece no efeito intensidade.'
                  : 'Decomposição indisponível: exige consumo e produção positivos nos dois períodos.'
              }
              table={
                energy.decomposition
                  ? {
                      columns: ['Componente', 'MWh'],
                      rows: [
                        [`Consumo ${prev.short_label}`, energy.previous.energy_mwh],
                        ['Efeito produção (volume)', energy.decomposition.production_effect],
                        ['Efeito intensidade (eficiência)', energy.decomposition.intensity_effect],
                        [`Consumo ${cur.short_label}`, energy.current.energy_mwh],
                        ['Variação total', energy.decomposition.delta_energy],
                      ],
                    }
                  : undefined
              }
            >
              {energy.decomposition && energy.previous.energy_mwh !== null && energy.current.energy_mwh !== null ? (
                <>
                  <LmdiWaterfall
                    previousMwh={energy.previous.energy_mwh}
                    currentMwh={energy.current.energy_mwh}
                    productionEffect={energy.decomposition.production_effect}
                    intensityEffect={energy.decomposition.intensity_effect}
                    labelA={cur.short_label}
                    labelB={prev.short_label}
                  />
                  <p className="px-2 pb-1 pt-2 text-xs leading-relaxed text-ink-2">
                    O consumo variou <b>{fmtNum(energy.decomposition.delta_energy, 1)} MWh</b> ({fmtPct(energy.energy_delta_pct, 1, true)}).
                    Desse total, <b style={{ color: 'var(--s1)' }}>{fmtNum(energy.decomposition.production_effect, 1)} MWh</b> vêm da mudança de
                    volume produzido e{' '}
                    <b style={{ color: energy.decomposition.intensity_effect > 0 ? 'var(--critical-text)' : 'var(--good-text)' }}>
                      {fmtNum(energy.decomposition.intensity_effect, 1)} MWh
                    </b>{' '}
                    da mudança de intensidade energética ({fmtAuto(energy.decomposition.intensity_before, 2)} →{' '}
                    {fmtAuto(energy.decomposition.intensity_after, 2)} {energy.current.intensity_unit ?? ''}).
                  </p>
                </>
              ) : (
                <EmptyState
                  title="Sem decomposição para este recorte"
                  description="É necessário haver consumo e produção maiores que zero nos dois períodos comparados."
                />
              )}
            </ChartCard>

            {/* ------------------------------------------------ por etapa e sobreposição */}
            <div className="grid gap-4 xl:grid-cols-2">
              {data.data.children.length > 0 && (
                <ChartCard
                  title="Consumo por etapa"
                  subtitle={`${cur.short_label} × ${prev.short_label} (MWh de energia de fronteira)`}
                  table={{
                    columns: ['Etapa', `${cur.short_label} (MWh)`, `${prev.short_label} (MWh)`, 'Δ %'],
                    rows: data.data.children.map((c) => [
                      c.node.name,
                      c.current.energy_mwh,
                      c.previous.energy_mwh,
                      c.energy_delta_pct === null ? EMPTY : fmtPct(c.energy_delta_pct, 1, true),
                    ]),
                  }}
                >
                  <CategoryBars
                    categories={data.data.children.map((c) => c.node.name)}
                    series={[
                      { name: cur.short_label, values: data.data.children.map((c) => c.current.energy_mwh), color: 'var(--s1)' },
                      { name: prev.short_label, values: data.data.children.map((c) => c.previous.energy_mwh), color: 'var(--seq-250)' },
                    ]}
                    unit="MWh"
                    decimals={1}
                    height={Math.max(220, data.data.children.length * 56)}
                  />
                </ChartCard>
              )}

              <ChartCard
                title="Evolução dentro do período"
                subtitle={`Séries alinhadas pelo mesmo número de ${data.data.overlay.grain === 'day' ? 'dias' : data.data.overlay.grain === 'week' ? 'semanas' : 'meses'} decorridos`}
                table={seriesTable(
                  data.data.overlay.current.buckets.map((b, i) => `${i + 1} — ${b.label}`),
                  [
                    { name: cur.short_label, values: data.data.overlay.current.total },
                    { name: prev.short_label, values: data.data.overlay.previous.total },
                  ],
                  'MWh',
                )}
                note="O período de comparação é sobreposto ponto a ponto, permitindo ver em que momento a diferença apareceu."
              >
                <TimeSeriesChart
                  x={data.data.overlay.current.buckets.map((b, i) =>
                    data.data.overlay.grain === 'day' ? `${i + 1}` : b.label,
                  )}
                  series={[
                    { name: cur.short_label, values: data.data.overlay.current.total, color: 'var(--s1)' },
                    {
                      name: prev.short_label,
                      values: data.data.overlay.current.buckets.map((_, i) => data.data.overlay.previous.total[i] ?? null),
                      color: 'var(--muted)',
                      dashed: true,
                      hideSymbol: true,
                    },
                  ]}
                  unit="MWh"
                  decimals={1}
                  height={260}
                  showLegend
                />
              </ChartCard>
            </div>

            {/* ------------------------------------------------ USEs */}
            {data.data.uses.length > 0 && (
              <Card>
                <CardHeader
                  title="Usos Significativos de Energia no recorte"
                  subtitle={`Participação e variação de cada USE entre ${cur.short_label} e ${prev.short_label}`}
                />
                <div className="max-h-[420px] overflow-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>USE</th>
                        <th>Categoria</th>
                        <th>Etapa</th>
                        <th>Regime</th>
                        <th className="right">{cur.short_label} (MWh)</th>
                        <th className="right">{prev.short_label} (MWh)</th>
                        <th className="right">Δ %</th>
                        <th className="right">Participação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.uses.map((u) => (
                        <tr key={u.use_id}>
                          <td className="max-w-[280px]">
                            <Link to={filters.link(`/uses/${u.use_id}`)} className="font-medium text-ink hover:underline">
                              {u.name}
                            </Link>
                            {u.internal && <span className="ml-1 text-[10px] text-muted">(energia secundária)</span>}
                          </td>
                          <td className="text-ink-2">
                            <span className="inline-flex items-center gap-1">
                              <span className="h-2 w-2 rounded-sm" style={{ background: `var(--s${u.color_slot})` }} />
                              {u.category}
                            </span>
                          </td>
                          <td className="text-ink-2">{u.node_name ?? EMPTY}</td>
                          <td className="text-[11px] text-ink-2">{REGIME_LABEL[u.operating_regime] ?? u.operating_regime}</td>
                          <td className="right">{fmtNum(u.mwh, 1)}</td>
                          <td className="right text-ink-2">{fmtNum(u.previous_mwh ?? null, 1)}</td>
                          <td className="right">
                            {u.delta_pct === null || u.delta_pct === undefined ? (
                              EMPTY
                            ) : (
                              <span
                                className="num"
                                style={{ color: u.delta_pct > 0 ? 'var(--critical-text)' : 'var(--good-text)' }}
                              >
                                {fmtPct(u.delta_pct, 1, true)}
                              </span>
                            )}
                          </td>
                          <td className="right text-ink-2">{fmtPct(u.share_pct, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* ------------------------------------------------ indicadores e diagnóstico */}
            <Card>
              <CardHeader
                title="Indicadores nos dois períodos"
                subtitle="Cada IDE é avaliado com a meta vigente no respectivo período (metas anuais e por safra)."
              />
              <IndicatorTable rows={data.data.indicators} maxHeight={560} />
            </Card>

            <Card>
              <CardHeader
                title="Diagnóstico da comparação"
                subtitle="Desvios, deteriorações, contexto de produção e problemas de qualidade de dado"
              />
              <DiagnosticsList items={data.data.diagnostics} limit={20} />
            </Card>
          </div>
        )}
      </Page>
    </>
  )
}
