/** USEs — inventário dos Usos Significativos de Energia e matriz Processo × USE.
 *  A matriz responde à pergunta central da metodologia: quais usos existem em cada etapa do processo. */
import { Layers, Network, Search, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'

import { ChartCard, ParetoChart } from '../components/charts'
import { KpiTile, StatRow } from '../components/common/Kpi'
import { Page, PageHeader } from '../components/layout/AppShell'
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  Popover,
  Select,
  Skeleton,
  Tooltip,
  cn,
} from '../components/ui/primitives'
import { DeltaBadge, StatusIcon } from '../components/ui/status'
import { STATUS_META, seriesColor, statusColor } from '../lib/colors'
import { EMPTY, REGIME_LABEL, fmtAuto, fmtNum, fmtPct } from '../lib/format'
import { useApi, useFilters, useMeta } from '../lib/hooks'
import type { MatrixProcessUse, TreeNode, Use } from '../lib/types'

interface FlatNode {
  id: number
  name: string
  level: string
  depth: number
}

function flatten(nodes: TreeNode[], depth = 0, out: FlatNode[] = []): FlatNode[] {
  nodes.forEach((n) => {
    if (n.level !== 'company') out.push({ id: n.id, name: n.name, level: n.level, depth })
    flatten(n.children, n.level === 'company' ? depth : depth + 1, out)
  })
  return out
}

function MatrixCell({
  cell,
  categoryName,
  processName,
}: {
  cell: MatrixProcessUse['rows'][number]['cells'][string] | undefined
  categoryName: string
  processName: string
}) {
  const filters = useFilters()
  if (!cell || !cell.uses.length) {
    return <span className="block text-center text-[11px] text-muted">·</span>
  }
  return (
    <Popover
      align="center"
      trigger={
        <button
          className="w-full rounded-md border border-edge bg-surface-2 px-1.5 py-1 text-center transition-colors hover:border-accent"
          title={`${cell.uses.length} USE(s) · ${fmtNum(cell.mwh, 1)} MWh`}
        >
          <span className="flex items-center justify-center gap-1">
            {cell.worst_status && <StatusIcon status={cell.worst_status} size={11} />}
            <span className="num text-[12px] font-semibold text-ink">{cell.uses.length}</span>
          </span>
          <span className="num block text-[10px] text-muted">{fmtNum(cell.mwh, 1)} MWh</span>
        </button>
      }
    >
      <div className="space-y-2">
        <div>
          <p className="text-[13px] font-semibold">{categoryName}</p>
          <p className="text-[11px] text-muted">
            {processName} · {cell.equipment} equipamento(s) · {fmtPct(cell.share_pct, 1)} do consumo da etapa
          </p>
        </div>
        <ul className="space-y-1">
          {cell.uses.map((u) => (
            <li key={u.id}>
              <Link
                to={filters.link(`/uses/${u.id}`)}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-surface-2"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{u.name}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {u.node} · {REGIME_LABEL[u.regime] ?? u.regime}
                  </span>
                </span>
                <span className="num shrink-0 text-[11px] text-ink-2">{fmtNum(u.mwh, 1)} MWh</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Popover>
  )
}

export function UsesPage() {
  const filters = useFilters()
  const meta = useMeta()
  const tree = useApi<TreeNode[]>('/hierarchy/tree')
  const [nodeId, setNodeId] = useState<string>('')
  const [categoryId, setCategoryId] = useState<string>('')
  const [carrierId, setCarrierId] = useState<string>('')
  const [search, setSearch] = useState('')

  const uses = useApi<Use[]>('/uses', {
    ...filters.params,
    with_energy: true,
    node_id: nodeId || undefined,
    category_id: categoryId || undefined,
    carrier_id: carrierId || undefined,
  })
  const matrix = useApi<MatrixProcessUse>('/matrix/process-use', {
    period: filters.period,
    node_id: nodeId || undefined,
  })

  const nodeOptions = useMemo(() => {
    const flat = flatten(tree.data ?? [])
    return [
      { value: '', label: 'Toda a planta' },
      ...flat.map((n) => ({ value: String(n.id), label: `${' '.repeat(n.depth * 2)}${n.name}` })),
    ]
  }, [tree.data])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = (uses.data ?? []).filter(
      (u) => !q || u.name.toLowerCase().includes(q) || u.code.toLowerCase().includes(q) || (u.node?.name ?? '').toLowerCase().includes(q),
    )
    return [...list].sort((a, b) => (b.mwh ?? 0) - (a.mwh ?? 0))
  }, [uses.data, search])

  const totals = useMemo(() => {
    const mwh = filtered.reduce((acc, u) => acc + (u.mwh ?? 0), 0)
    const power = filtered.reduce((acc, u) => acc + (u.installed_power_kw ?? 0), 0)
    const top5 = filtered.slice(0, 5).reduce((acc, u) => acc + (u.mwh ?? 0), 0)
    return { mwh, power, top5Pct: mwh ? (top5 / mwh) * 100 : null, count: filtered.length }
  }, [filtered])

  const pareto = useMemo(() => {
    const withEnergy = filtered.filter((u) => (u.mwh ?? 0) > 0)
    const total = withEnergy.reduce((acc, u) => acc + (u.mwh ?? 0), 0)
    const top = withEnergy.slice(0, 8)
    const others = withEnergy.slice(8).reduce((acc, u) => acc + (u.mwh ?? 0), 0)
    const categories = [...top.map((u) => u.name), ...(others > 0 ? ['Demais USEs'] : [])]
    const shares = [
      ...top.map((u) => (total ? ((u.mwh ?? 0) / total) * 100 : 0)),
      ...(others > 0 ? [(others / total) * 100] : []),
    ]
    const colorSlots = [...top.map((u) => u.category?.color_slot ?? 1), ...(others > 0 ? [8] : [])]
    return { categories, shares, colorSlots, total }
  }, [filtered])

  return (
    <>
      <PageHeader
        title="Usos Significativos de Energia (USEs)"
        subtitle="Onde a energia é efetivamente usada em cada etapa do processo — base da metodologia (ISO 50001 como referencial)."
      />
      <Page>
        <StatRow cols={4}>
          <KpiTile label="USEs cadastrados" value={totals.count} hint="Filtro atual" />
          <KpiTile label="Potência instalada" value={totals.power} unit="kW" decimals={0} />
          <KpiTile
            label="Consumo no período"
            value={totals.mwh}
            unit="MWh"
            decimals={1}
            hint="Soma dos USEs listados (vetores secundários gerados na própria área não são somados duas vezes)."
          />
          <KpiTile label="Concentração (5 maiores)" value={totals.top5Pct} unit="%" decimals={1} hint="Participação dos 5 maiores USEs" />
        </StatRow>

        <Card>
          <CardHeader
            title="Matriz Processo × USE"
            subtitle="Quais categorias de uso significativo existem em cada etapa. Clique na célula para ver os USEs."
            icon={<Network size={15} />}
            actions={
              <div className="flex items-center gap-2">
                <Select
                  value={nodeId}
                  onChange={(e) => setNodeId(e.target.value)}
                  options={nodeOptions}
                  className="w-52"
                  aria-label="Escopo"
                />
              </div>
            }
          />
          {matrix.error ? (
            <ErrorState error={matrix.error} />
          ) : !matrix.data ? (
            <Skeleton className="m-4 h-56" />
          ) : (
            <div className={cn('overflow-auto', matrix.isFetching && 'opacity-60')}>
              <table className="table">
                <thead>
                  <tr>
                    <th className="min-w-[180px]">Área / Processo</th>
                    {matrix.data.categories.map((c) => (
                      <th key={c.id} className="min-w-[92px] text-center">
                        <span className="inline-flex items-center gap-1">
                          <span className="h-2 w-2 rounded-sm" style={{ background: seriesColor(c.color_slot) }} aria-hidden />
                          {c.name}
                        </span>
                      </th>
                    ))}
                    <th className="right">Total (MWh)</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.data.rows.map((row) => (
                    <tr key={row.node.id}>
                      <td>
                        <Link to={filters.link(`/processos/${row.node.id}`)} className="font-medium text-ink hover:underline">
                          {row.node.name}
                        </Link>
                        <span className="block text-[11px] text-muted">{row.area?.name}</span>
                      </td>
                      {matrix.data.categories.map((c) => (
                        <td key={c.id} className="px-1">
                          <MatrixCell cell={row.cells[c.code]} categoryName={c.name} processName={row.node.name} />
                        </td>
                      ))}
                      <td className="right font-medium">{fmtNum(row.total_mwh, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard
            title="Concentração do consumo (Pareto)"
            subtitle="Participação de cada USE e acumulado — onde priorizar a gestão"
            icon={<Layers size={15} />}
            table={{
              columns: ['USE', 'Participação (%)'],
              rows: pareto.categories.map((c, i) => [c, pareto.shares[i]]),
            }}
          >
            {pareto.categories.length ? (
              <ParetoChart categories={pareto.categories} shares={pareto.shares} colorSlots={pareto.colorSlots} height={300} />
            ) : (
              <EmptyState title="Sem consumo no período" description="Nenhum USE com consumo medido no filtro atual." />
            )}
          </ChartCard>

          <Card className="flex flex-col">
            <CardHeader
              title="USEs por consumo"
              subtitle="Clique para abrir o USE e seus equipamentos"
              icon={<Zap size={15} />}
              actions={
                <div className="relative">
                  <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
                  <Input
                    className="w-48 pl-7"
                    placeholder="Buscar USE…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              }
            />
            <div className="flex flex-wrap gap-2 border-b border-edge px-3 py-2">
              <Select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-48"
                aria-label="Categoria"
                options={[
                  { value: '', label: 'Todas as categorias' },
                  ...(meta.data?.use_categories ?? []).map((c) => ({ value: String(c.id), label: c.name })),
                ]}
              />
              <Select
                value={carrierId}
                onChange={(e) => setCarrierId(e.target.value)}
                className="w-44"
                aria-label="Fonte de energia"
                options={[
                  { value: '', label: 'Todas as fontes' },
                  ...(meta.data?.carriers ?? []).map((c) => ({ value: String(c.id), label: c.name })),
                ]}
              />
            </div>
            <div className="max-h-[420px] min-h-0 overflow-auto">
              {uses.error ? (
                <ErrorState error={uses.error} />
              ) : !uses.data ? (
                <Skeleton className="m-4 h-56" />
              ) : filtered.length === 0 ? (
                <EmptyState title="Nenhum USE encontrado" description="Ajuste os filtros de escopo, categoria ou fonte." />
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>USE</th>
                      <th>Etapa</th>
                      <th>Regime</th>
                      <th className="right">Pot. inst. (kW)</th>
                      <th className="right">Consumo (MWh)</th>
                      <th className="right">Δ período</th>
                      <th className="right">Equip.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((u) => (
                      <tr key={u.id}>
                        <td className="max-w-[260px]">
                          <Link to={filters.link(`/uses/${u.id}`)} className="block truncate font-medium text-ink hover:underline">
                            {u.name}
                          </Link>
                          <span className="flex items-center gap-1 text-[11px] text-muted">
                            <span
                              className="h-2 w-2 shrink-0 rounded-sm"
                              style={{ background: seriesColor(u.category?.color_slot) }}
                              aria-hidden
                            />
                            {u.category?.name} · {u.carrier?.name}
                          </span>
                        </td>
                        <td className="whitespace-nowrap text-[12px] text-ink-2">{u.node?.name}</td>
                        <td className="whitespace-nowrap text-[12px] text-ink-2">
                          {REGIME_LABEL[u.operating_regime] ?? u.operating_regime}
                        </td>
                        <td className="right">{fmtAuto(u.installed_power_kw, 0)}</td>
                        <td className="right font-medium">{u.mwh != null ? fmtNum(u.mwh, 1) : EMPTY}</td>
                        <td className="right">
                          <DeltaBadge pct={u.delta_pct} compact />
                        </td>
                        <td className="right text-ink-2">{u.equipment_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </div>

        <Card className="p-4">
          <p className="text-[11px] text-muted">
            Legenda da matriz: cada célula traz o número de USEs da categoria naquela etapa, o consumo do período e o ícone do{' '}
            <Tooltip content="Pior status entre os indicadores dos USEs da célula">
              <span className="underline decoration-dotted">pior status</span>
            </Tooltip>{' '}
            dos indicadores relacionados —{' '}
            {(['critico', 'atencao', 'normal'] as const).map((s) => (
              <span key={s} className="mr-2 inline-flex items-center gap-1">
                <StatusIcon status={s} size={11} />
                <span style={{ color: statusColor(s) }}>{STATUS_META[s].label}</span>
              </span>
            ))}
          </p>
        </Card>
      </Page>
    </>
  )
}
