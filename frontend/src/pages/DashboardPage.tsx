/** Dashboard executivo: onde a energia está sendo usada, como evolui e o que exige ação. */
import { ArrowRight, Factory, Lightbulb, TrendingDown, TrendingUp, Workflow, Zap } from 'lucide-react'
import { Link } from 'react-router'

import { CategoryBars, ChartCard, HeatmapChart, ParetoChart, SankeyChart, TimeSeriesChart, seriesTable } from '../components/charts'
import { KpiTile, StatRow } from '../components/common/Kpi'
import { Page, PageHeader } from '../components/layout/AppShell'
import { IndicatorTable } from '../components/indicators/IndicatorTable'
import { Card, CardHeader, EmptyState, ErrorState, Skeleton, Tooltip } from '../components/ui/primitives'
import { DeltaBadge, StatusBar, StatusPill } from '../components/ui/status'
import { seriesColor } from '../lib/colors'
import { fmtAuto, fmtNum, fmtPct } from '../lib/format'
import { useApi, useFilters, useMeta } from '../lib/hooks'
import type { DashboardOverview, SankeyData } from '../lib/types'

export function DashboardPage() {
  const filters = useFilters()
  const meta = useMeta()
  const q = useApi<DashboardOverview>('/dashboard/overview', filters.params)
  const sankey = useApi<SankeyData & { period: unknown }>(
    q.data ? `/nodes/${q.data.node.id}/sankey` : null,
    { period: filters.period },
  )

  if (q.error) return <ErrorState error={q.error} />
  if (!q.data) {
    return (
      <Page>
        <Skeleton className="h-28" />
        <Skeleton className="h-64" />
      </Page>
    )
  }
  const d = q.data
  const elec = d.carriers.current.find((c) => c.carrier === 'eletricidade')
  const elecPrev = d.carriers.previous.find((c) => c.carrier === 'eletricidade')
  const fuel = d.carriers.current.filter((c) => c.kind === 'boundary' && c.carrier !== 'eletricidade')
  const fuelPrev = d.carriers.previous.filter((c) => c.kind === 'boundary' && c.carrier !== 'eletricidade')
  const fuelSum = fuel.reduce((a, c) => a + c.mwh, 0)
  const fuelPrevSum = fuelPrev.reduce((a, c) => a + c.mwh, 0)
  const offTarget = (d.status_counts.critico ?? 0) + (d.status_counts.atencao ?? 0)

  const months = d.energy_series.buckets.map((b) => b.label)

  return (
    <>
      <PageHeader
        title="Dashboard geral"
        subtitle={
          <>
            {d.node.name} · {d.period.label} — comparado com {d.comparison_period.label}
            {d.period.partial && ' (período em andamento)'}
          </>
        }
        actions={
          <>
            <Link to={filters.link('/comparacoes')} className="btn">
              Comparar períodos <ArrowRight size={14} />
            </Link>
            <Link to={filters.link('/oportunidades')} className="btn">
              <Lightbulb size={14} /> Oportunidades
            </Link>
          </>
        }
      />
      <Page>
        <StatRow cols={5}>
          <KpiTile
            label="Consumo total de energia"
            value={d.energy.current.energy_mwh}
            unit="MWh"
            delta={d.energy.energy_delta_pct}
            changeClass={
              d.energy.energy_delta_pct == null
                ? 'indefinido'
                : d.energy.intensity_delta_pct != null && d.energy.intensity_delta_pct < 0 && d.energy.energy_delta_pct > 0
                  ? 'aumento'
                  : d.energy.energy_delta_pct > 0
                    ? 'piora'
                    : 'melhoria'
            }
            deltaLabel={`vs ${d.comparison_period.short_label}`}
            hero
            hint="Energia final na fronteira da planta (eletricidade + combustíveis). Vapor é energia secundária e não é somado."
          />
          <KpiTile
            label="Energia elétrica"
            value={elec?.mwh ?? null}
            unit="MWh"
            delta={elec && elecPrev ? ((elec.mwh - elecPrev.mwh) / elecPrev.mwh) * 100 : null}
            hint={elec ? `${fmtPct((elec.mwh / (d.energy.current.energy_mwh || 1)) * 100, 0)} do total` : undefined}
          />
          <KpiTile
            label="Combustível (biomassa)"
            value={fuelSum}
            unit="MWh"
            delta={fuelPrevSum ? ((fuelSum - fuelPrevSum) / fuelPrevSum) * 100 : null}
            hint={fuel.map((f) => `${fmtNum(f.native, 0)} ${f.unit}`).join(' · ')}
          />
          {d.areas.map((a) => (
            <KpiTile
              key={a.node.id}
              label={`Intensidade · ${a.node.name}`}
              value={a.current.intensity_kwh_per_unit}
              unit={a.current.intensity_unit ?? ''}
              delta={a.intensity_delta_pct}
              changeClass={a.intensity_delta_pct == null ? 'indefinido' : a.intensity_delta_pct > 0 ? 'piora' : 'melhoria'}
              hint={`Produção: ${fmtNum(a.current.production, 0)} ${a.current.production_unit ?? ''}`}
              to={filters.link(`/areas/${a.node.id}`)}
            />
          ))}
        </StatRow>

        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <ChartCard
            title="Consumo por área ao longo do tempo"
            subtitle="Energia final (MWh) — últimos 13 meses"
            icon={<Factory size={14} />}
            table={seriesTable(months, d.energy_series.groups.map((g) => ({ name: g.name, values: g.values })), 'MWh')}
          >
            <TimeSeriesChart
              x={months}
              series={d.energy_series.groups.map((g) => ({
                name: g.name,
                values: g.values,
                type: 'bar',
                stack: 'total',
                color: seriesColor(g.color_slot ?? 1),
              }))}
              unit="MWh"
              height={260}
            />
          </ChartCard>

          <ChartCard
            title="Consumo por fonte de energia"
            subtitle={`${d.period.short_label} × ${d.comparison_period.short_label}`}
            icon={<Zap size={14} />}
            table={{
              columns: ['Fonte', 'Atual (MWh)', 'Anterior (MWh)', 'Medida física'],
              rows: d.carriers.current.map((c) => [
                c.name,
                c.mwh,
                d.carriers.previous.find((p) => p.carrier === c.carrier)?.mwh ?? null,
                `${fmtNum(c.native, 1)} ${c.unit}`,
              ]),
            }}
          >
            <CategoryBars
              categories={d.carriers.current.map((c) => c.name)}
              series={[
                { name: d.period.short_label, values: d.carriers.current.map((c) => c.mwh), color: 'var(--s1)' },
                {
                  name: d.comparison_period.short_label,
                  values: d.carriers.current.map((c) => d.carriers.previous.find((p) => p.carrier === c.carrier)?.mwh ?? null),
                  color: 'var(--seq-250)',
                },
              ]}
              unit="MWh"
              height={240}
            />
          </ChartCard>
        </div>

        <ChartCard
          title="Fluxo de energia da planta"
          subtitle="Fontes → áreas → processos → categorias de USE. Inclui a conversão biomassa → vapor e suas perdas."
          icon={<Workflow size={14} />}
          note="Energia secundária (vapor) aparece como fluxo interno: não é somada ao total da planta para evitar dupla contagem."
          table={
            sankey.data
              ? {
                  columns: ['Origem', 'Destino', 'MWh'],
                  rows: sankey.data.links.map((l) => [l.source, l.target, l.value]),
                }
              : undefined
          }
        >
          {sankey.data ? <SankeyChart data={{ ...sankey.data, unit: 'MWh' }} height={420} /> : <Skeleton className="h-[420px]" />}
        </ChartCard>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Consumo por processo"
            subtitle="Energia final no período, com variação vs período de comparação"
            table={{
              columns: ['Processo', 'Área', 'MWh', 'Δ %', 'Intensidade'],
              rows: d.processes.map((p) => [
                p.node.name,
                p.area?.name ?? '',
                p.current.energy_mwh,
                p.energy_delta_pct != null ? fmtPct(p.energy_delta_pct, 1, true) : null,
                p.current.intensity_kwh_per_unit != null
                  ? `${fmtAuto(p.current.intensity_kwh_per_unit)} ${p.current.intensity_unit ?? ''}`
                  : null,
              ]),
            }}
          >
            <CategoryBars
              categories={d.processes.map((p) => p.node.name)}
              series={[{ name: 'Consumo', values: d.processes.map((p) => p.current.energy_mwh) }]}
              colorByCategory={d.processes.map((p) => seriesColor(p.area?.color_slot ?? 1))}
              unit="MWh"
              height={260}
            />
          </ChartCard>

          <ChartCard
            title="Concentração do consumo por USE (Pareto)"
            subtitle="Poucos usos significativos respondem pela maior parte da energia"
            table={{
              columns: ['USE', 'Processo', 'MWh', 'Participação'],
              rows: d.uses.map((u) => [u.name, u.node_name ?? '', u.mwh, u.share_pct != null ? fmtPct(u.share_pct, 1) : null]),
            }}
          >
            <ParetoChart
              categories={d.uses.slice(0, 8).map((u) => u.name)}
              shares={d.uses.slice(0, 8).map((u) => u.share_pct ?? 0)}
              colorSlots={d.uses.slice(0, 8).map((u) => u.color_slot)}
              height={260}
            />
          </ChartCard>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card className="flex flex-col">
            <CardHeader
              title="Indicadores fora da meta"
              subtitle={`${offTarget} de ${d.indicator_count} indicadores exigem atenção no período`}
              actions={
                <Link to={filters.link('/indicadores')} className="btn btn-ghost text-xs">
                  Ver todos <ArrowRight size={13} />
                </Link>
              }
            />
            {d.off_target.length ? (
              <IndicatorTable rows={d.off_target} showFilters={false} hideColumns={['baseline', 'level']} maxHeight={360} />
            ) : (
              <EmptyState title="Nenhum indicador fora da meta" description="Todos os IDEs com meta estão dentro da tolerância." />
            )}
          </Card>

          <div className="grid gap-4">
            <Card>
              <CardHeader title="Composição do desempenho" subtitle="Distribuição dos status dos IDEs no período" />
              <div className="p-4">
                <StatusBar counts={d.status_counts} />
                <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt className="text-muted">Oportunidades abertas</dt>
                    <dd className="num text-lg font-semibold">{d.opportunities.open}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Economia estimada</dt>
                    <dd className="num text-lg font-semibold">
                      {fmtNum(d.opportunities.savings_mwh_year, 0)} <span className="text-xs font-normal text-muted">MWh/ano</span>
                    </dd>
                  </div>
                </dl>
                {d.unallocated.some((u) => u.unallocated_mwh > 0) && (
                  <p className="mt-3 border-t border-edge pt-2 text-[11px] text-muted">
                    Consumo não alocado a USEs:{' '}
                    {d.unallocated
                      .filter((u) => u.unallocated_mwh > 0)
                      .map((u) => `${fmtNum(u.unallocated_mwh, 1)} MWh (${u.name})`)
                      .join(' · ')}{' '}
                    — oportunidade de ampliar a submedição.
                  </p>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Maiores movimentos" subtitle="Variação vs período de comparação" />
              <div className="grid gap-3 p-4 sm:grid-cols-2">
                <MoverList title="Deterioração" icon={<TrendingUp size={13} />} rows={d.worsening} link={filters.link} />
                <MoverList title="Melhoria" icon={<TrendingDown size={13} />} rows={d.improving} link={filters.link} />
              </div>
            </Card>
          </div>
        </div>

        <ChartCard
          title="Intensidade energética por processo × mês"
          subtitle="Variação contra o mesmo mês do ano anterior — vermelho indica piora, azul indica melhora"
          note="Comparar com o mesmo mês do ano anterior neutraliza a sazonalidade da safra."
          table={{
            columns: ['Processo', ...(d.intensity_heatmap[0]?.cells.map((c) => c.label) ?? [])],
            rows: d.intensity_heatmap.map((row) => [row.node.name, ...row.cells.map((c) => (c.yoy_pct == null ? null : `${fmtPct(c.yoy_pct, 0, true)}`))]),
          }}
        >
          <HeatmapChart
            rows={d.intensity_heatmap.map((r) => r.node.name)}
            columns={d.intensity_heatmap[0]?.cells.map((c) => c.label) ?? []}
            values={d.intensity_heatmap.flatMap((r, ri) =>
              r.cells.map((c, ci) => ({ row: ri, col: ci, value: c.yoy_pct == null ? null : Number(c.yoy_pct.toFixed(1)) })),
            )}
            valueLabel={(v) => fmtPct(v, 0, true)}
            unit="%"
            diverging
            max={40}
            height={Math.max(220, d.intensity_heatmap.length * 34 + 60)}
          />
        </ChartCard>

        <div className="grid gap-4 md:grid-cols-2">
          {d.areas.map((a) => (
            <Card key={a.node.id}>
              <CardHeader
                title={a.node.name}
                subtitle={`${a.indicator_count} indicadores · ${fmtNum(a.current.energy_mwh, 1)} MWh no período`}
                actions={
                  <div className="flex gap-2">
                    <Link to={filters.link(`/areas/${a.node.id}/fluxograma`)} className="btn btn-ghost text-xs">
                      <Workflow size={13} /> Fluxograma
                    </Link>
                    <Link to={filters.link(`/areas/${a.node.id}`)} className="btn text-xs">
                      Abrir
                    </Link>
                  </div>
                }
              />
              <div className="space-y-3 p-4">
                <StatusBar counts={a.status_counts} />
                <dl className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-muted">Consumo</dt>
                    <dd className="num font-semibold">
                      {fmtNum(a.current.energy_mwh, 1)} <span className="font-normal text-muted">MWh</span>
                    </dd>
                    <dd>
                      <DeltaBadge pct={a.energy_delta_pct} compact />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Produção</dt>
                    <dd className="num font-semibold">
                      {fmtNum(a.current.production, 0)} <span className="font-normal text-muted">{a.current.production_unit}</span>
                    </dd>
                    <dd>
                      <DeltaBadge pct={a.production_delta_pct} compact />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Intensidade</dt>
                    <dd className="num font-semibold">{fmtAuto(a.current.intensity_kwh_per_unit)}</dd>
                    <dd>
                      <DeltaBadge
                        pct={a.intensity_delta_pct}
                        changeClass={a.intensity_delta_pct == null ? 'indefinido' : a.intensity_delta_pct > 0 ? 'piora' : 'melhoria'}
                        compact
                      />
                    </dd>
                  </div>
                </dl>
                {a.decomposition && (
                  <p className="border-t border-edge pt-2 text-[11px] leading-snug text-muted">
                    Decomposição da variação: efeito produção {fmtNum(a.decomposition.production_effect, 1)} MWh · efeito intensidade{' '}
                    {fmtNum(a.decomposition.intensity_effect, 1)} MWh.
                  </p>
                )}
              </div>
            </Card>
          ))}
        </div>

        <p className="pb-4 text-[11px] text-muted">
          {meta.data?.data_notice} Unidade de referência: MWh (energia final). Indicadores calculados pelo motor configurável —
          fórmulas e metas são dados, não código.
        </p>
      </Page>
    </>
  )
}

function MoverList({
  title,
  icon,
  rows,
  link,
}: {
  title: string
  icon: React.ReactNode
  rows: DashboardOverview['worsening']
  link: (p: string) => string
}) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {icon}
        {title}
      </p>
      <ul className="space-y-1.5">
        {rows.slice(0, 5).map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-2">
            <Link to={link(`/indicadores/${r.id}`)} className="min-w-0 flex-1 truncate text-xs hover:underline" title={r.name}>
              {r.name}
              <span className="block truncate text-[10px] text-muted">{r.process?.name ?? r.node?.name}</span>
            </Link>
            <div className="flex shrink-0 flex-col items-end">
              <DeltaBadge pct={r.delta_pct} changeClass={r.change_class} compact />
              <Tooltip content={r.current.status_explanation}>
                <span>
                  <StatusPill status={r.current.status} compact />
                </span>
              </Tooltip>
            </div>
          </li>
        ))}
        {!rows.length && <li className="text-xs text-muted">Sem movimentos relevantes.</li>}
      </ul>
    </div>
  )
}
