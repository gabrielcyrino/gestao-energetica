/** Qualidade dos dados por variável/tag: completude, origem, frequência e leituras suspeitas.
 *  Regra do sistema: dado ausente nunca é tratado como zero — ele reduz a completude e pode
 *  invalidar o indicador no período. */
import { CircleAlert, Database, Search, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'

import { CategoryBars, ChartCard } from '../components/charts'
import { KpiTile, StatRow } from '../components/common/Kpi'
import { Page, PageHeader } from '../components/layout/AppShell'
import { Card, CardHeader, Chip, EmptyState, ErrorState, Input, Select, Skeleton, Tooltip } from '../components/ui/primitives'
import { StatusPill } from '../components/ui/status'
import { EMPTY, METHOD_LABEL, VARIABLE_TYPE_LABEL, fmtDateTime, fmtNum, fmtPct } from '../lib/format'
import { useApi, useFilters } from '../lib/hooks'
import type { PeriodInfo, StatusCode, TreeNode, VariableQuality } from '../lib/types'

interface QualityResponse {
  period: PeriodInfo
  items: VariableQuality[]
}

const QUALITY_LABEL: Record<string, string> = {
  good: 'Boa',
  suspect: 'Suspeita',
  bad: 'Ruim',
  manual: 'Manual',
  estimated: 'Estimada',
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

function CompletenessBar({ pct }: { pct: number }) {
  const color = pct >= 90 ? 'var(--good)' : pct >= 60 ? 'var(--warning)' : 'var(--critical)'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full" style={{ width: `${Math.max(2, pct)}%`, background: color }} />
      </div>
      <span className="num text-[11px] text-ink-2">{fmtNum(pct, 0)}%</span>
    </div>
  )
}

export function DataQualityPage() {
  const filters = useFilters()
  const tree = useApi<TreeNode[]>('/hierarchy/tree')
  const [scope, setScope] = useState('')
  const [search, setSearch] = useState('')
  const [only, setOnly] = useState<'all' | 'low' | 'manual' | 'estimated'>('all')

  const quality = useApi<QualityResponse>('/variables/quality', { period: filters.period, node_id: scope || undefined })
  const items = quality.data?.items ?? []
  const flat = useMemo(() => flatten(tree.data), [tree.data])

  const kpis = useMemo(() => {
    if (!items.length) return { total: 0, avg: 0, low: 0, badPct: 0, manual: 0 }
    const avg = items.reduce((a, v) => a + v.completeness_pct, 0) / items.length
    let reads = 0
    let bad = 0
    items.forEach((v) => {
      const total = Object.values(v.quality_breakdown).reduce((a, b) => a + b, 0)
      reads += total
      bad += (v.quality_breakdown.bad ?? 0) + (v.quality_breakdown.suspect ?? 0)
    })
    return {
      total: items.length,
      avg,
      low: items.filter((v) => v.completeness_pct < 90).length,
      badPct: reads ? (bad / reads) * 100 : 0,
      manual: items.filter((v) => !v.is_automatic).length,
    }
  }, [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(
      (v) =>
        (!q ||
          v.code.toLowerCase().includes(q) ||
          v.name.toLowerCase().includes(q) ||
          (v.source_tag ?? '').toLowerCase().includes(q) ||
          (v.equipment?.tag ?? '').toLowerCase().includes(q)) &&
        (only === 'all' ||
          (only === 'low' && v.completeness_pct < 90) ||
          (only === 'manual' && !v.is_automatic) ||
          (only === 'estimated' && v.measurement_method !== 'measured')),
    )
  }, [items, search, only])

  const worst = useMemo(() => items.slice(0, 15), [items])

  return (
    <>
      <PageHeader
        title="Qualidade dos dados"
        subtitle="Origem, frequência e completude de cada variável. Dado ausente não vira zero: reduz a completude e, abaixo do mínimo configurado, o indicador fica “Sem dados suficientes”."
        actions={
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
        }
      />
      <Page>
        <StatRow cols={5}>
          <KpiTile label="Variáveis monitoradas" value={kpis.total} hint={`Período ${quality.data?.period.label ?? ''}`} />
          <KpiTile
            label="Completude média"
            value={kpis.avg}
            unit="%"
            decimals={1}
            status={kpis.avg >= 95 ? 'normal' : kpis.avg >= 85 ? 'atencao' : 'critico'}
            hint="Dias com leitura ÷ dias esperados"
          />
          <KpiTile
            label="Abaixo de 90%"
            value={kpis.low}
            status={kpis.low > 0 ? 'atencao' : 'normal'}
            hint="Variáveis que podem invalidar indicadores"
          />
          <KpiTile
            label="Leituras suspeitas/ruins"
            value={kpis.badPct}
            unit="%"
            decimals={2}
            status={kpis.badPct > 2 ? 'atencao' : 'normal'}
            hint="Marcadas pela origem como suspect/bad"
          />
          <KpiTile label="Coleta manual" value={kpis.manual} hint="Variáveis sem automação (planilha/laboratório)" />
        </StatRow>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <Card>
            <CardHeader
              title="Variáveis e tags"
              subtitle="Ordenadas da menor para a maior completude no período."
              icon={<Database size={14} />}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
                    <Input
                      className="w-52 pl-7"
                      placeholder="Buscar código, tag, equipamento…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <Chip active={only === 'low'} onClick={() => setOnly(only === 'low' ? 'all' : 'low')}>
                    Completude &lt; 90%
                  </Chip>
                  <Chip active={only === 'manual'} onClick={() => setOnly(only === 'manual' ? 'all' : 'manual')}>
                    Manuais
                  </Chip>
                  <Chip active={only === 'estimated'} onClick={() => setOnly(only === 'estimated' ? 'all' : 'estimated')}>
                    Estimadas/calculadas
                  </Chip>
                </div>
              }
            />
            {quality.error ? (
              <ErrorState error={quality.error} />
            ) : quality.isPending ? (
              <Skeleton className="m-4" style={{ height: 420 }} />
            ) : filtered.length === 0 ? (
              <EmptyState title="Nenhuma variável para os filtros selecionados." icon={<Database size={20} />} />
            ) : (
              <div className="max-h-[560px] overflow-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Variável</th>
                      <th>Tipo</th>
                      <th>Etapa / equipamento</th>
                      <th>Origem</th>
                      <th>Frequência</th>
                      <th className="right">Dias com dado</th>
                      <th>Completude</th>
                      <th>Qualidade das leituras</th>
                      <th>Última atualização</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((v) => {
                      const totalReads = Object.values(v.quality_breakdown).reduce((a, b) => a + b, 0)
                      return (
                        <tr key={v.id}>
                          <td className="max-w-[240px]">
                            <span className="block truncate font-medium text-ink" title={v.name}>
                              {v.name}
                            </span>
                            <span className="block truncate text-[11px] text-muted">
                              {v.code} · {v.unit}
                            </span>
                          </td>
                          <td className="whitespace-nowrap text-[11px] text-ink-2">
                            {VARIABLE_TYPE_LABEL[v.variable_type] ?? v.variable_type}
                            <span className="block text-muted">{METHOD_LABEL[v.measurement_method] ?? v.measurement_method}</span>
                          </td>
                          <td className="max-w-[170px] truncate text-[11px] text-ink-2">
                            {v.node?.name ?? EMPTY}
                            {v.equipment && <span className="block truncate text-muted">{v.equipment.tag}</span>}
                          </td>
                          <td className="max-w-[180px] text-[11px] text-ink-2">
                            <Tooltip content={v.data_source?.protocol ?? ''}>
                              <span className="block truncate">{v.data_source?.name ?? EMPTY}</span>
                            </Tooltip>
                            <span className="block truncate text-muted">{v.source_tag ?? ''}</span>
                          </td>
                          <td className="whitespace-nowrap text-[11px] text-ink-2">
                            {v.collection_frequency}
                            <span className="block text-muted">{v.is_automatic ? 'automática' : 'manual'}</span>
                          </td>
                          <td className="right num text-ink-2">
                            {v.days_with_data}/{v.expected_days}
                          </td>
                          <td>
                            <CompletenessBar pct={v.completeness_pct} />
                          </td>
                          <td className="text-[11px] text-ink-2">
                            {totalReads === 0 ? (
                              <span className="text-muted">sem leituras</span>
                            ) : (
                              <span className="flex flex-wrap gap-1">
                                {Object.entries(v.quality_breakdown).map(([k, n]) => (
                                  <span
                                    key={k}
                                    className="rounded border border-edge px-1"
                                    title={`${QUALITY_LABEL[k] ?? k}: ${n} leitura(s)`}
                                  >
                                    {QUALITY_LABEL[k] ?? k} <b className="num">{n}</b>
                                  </span>
                                ))}
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap text-[11px] text-ink-2">{fmtDateTime(v.last_value_at)}</td>
                          <td>
                            <StatusPill
                              status={v.quality_status as StatusCode}
                              compact
                              explanation={
                                v.quality_status === 'sem_dados'
                                  ? 'Completude insuficiente: indicadores que usam esta variável ficam sem status.'
                                  : v.quality_status === 'atencao'
                                    ? 'Falhas de coleta ou leituras suspeitas no período.'
                                    : 'Coleta dentro do esperado.'
                              }
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="space-y-4">
            <ChartCard
              title="Menores completudes do período"
              subtitle="Priorize a recuperação destas coletas."
              icon={<CircleAlert size={14} />}
              table={{
                columns: ['Variável', 'Completude (%)', 'Dias com dado', 'Dias esperados'],
                rows: worst.map((v) => [v.code, v.completeness_pct, v.days_with_data, v.expected_days]),
              }}
            >
              <CategoryBars
                categories={worst.map((v) => v.code)}
                series={[{ name: 'Completude', values: worst.map((v) => v.completeness_pct), color: 'var(--s1)' }]}
                unit="%"
                decimals={0}
                height={Math.max(220, worst.length * 26 + 40)}
                colorByCategory={worst.map((v) =>
                  v.completeness_pct >= 90 ? 'var(--good)' : v.completeness_pct >= 60 ? 'var(--warning)' : 'var(--critical)',
                )}
              />
            </ChartCard>

            <Card className="p-4">
              <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
                <ShieldCheck size={14} /> Como a qualidade afeta os indicadores
              </h3>
              <ul className="space-y-2 text-xs leading-relaxed text-ink-2">
                <li>
                  <b className="text-ink">Ausência não é zero.</b> Dias sem leitura não entram na soma; eles reduzem a
                  completude do período.
                </li>
                <li>
                  <b className="text-ink">Mínimo por indicador.</b> Abaixo do mínimo configurado (padrão 80%), o IDE recebe o
                  status “Sem dados suficientes” — o valor continua visível, mas não é comparado com a meta.
                </li>
                <li>
                  <b className="text-ink">Parada não é falha.</b> Quando o indicador tem variável de operação, dias sem
                  operação saem da base de cálculo e o status vira “Sem operação”.
                </li>
                <li>
                  <b className="text-ink">Leituras ruins são descartadas.</b> Registros marcados como <i>bad</i> não entram nas
                  agregações; <i>suspect</i> entram, mas ficam sinalizados.
                </li>
                <li>
                  <b className="text-ink">Rastreabilidade.</b> Cada variável declara origem, tag no historiador, frequência e se
                  é medida, estimada ou calculada.
                </li>
              </ul>
              <p className="mt-3 text-[11px] text-muted">
                Percentuais do período {quality.data?.period.label ?? ''} · {fmtPct(kpis.badPct, 2)} das leituras marcadas como
                suspeitas ou ruins.
              </p>
            </Card>
          </div>
        </div>
      </Page>
    </>
  )
}
