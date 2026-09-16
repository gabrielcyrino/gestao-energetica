/** Matriz de indicadores (Processo → USE → Equipamento → IDE → fórmula → origem → meta)
 *  e matriz de cobertura USE × categoria de indicador, que revela lacunas de medição. */
import { Download, Grid3x3, Search, Sigma } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'

import { Page, PageHeader } from '../components/layout/AppShell'
import { KpiTile, StatRow } from '../components/common/Kpi'
import {
  Button,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  ErrorState,
  Input,
  Popover,
  Select,
  Skeleton,
  Tabs,
  Tooltip,
  cn,
} from '../components/ui/primitives'
import { StatusIcon, StatusPill } from '../components/ui/status'
import { STATUS_META, STATUS_ORDER, statusColor } from '../lib/colors'
import { EMPTY, KIND_LABEL, LEVEL_LABEL, fmtAuto } from '../lib/format'
import { useApi, useFilters } from '../lib/hooks'
import type { IndicatorRow, PeriodInfo, StatusCode, StatusCounts, TreeNode } from '../lib/types'

/* ---------------------------------------------------------------- escopo */

interface FlatNode {
  id: number
  name: string
  depth: number
  level: string
}

export function flattenTree(tree: TreeNode[] | undefined): FlatNode[] {
  const out: FlatNode[] = []
  const walk = (nodes: TreeNode[], depth: number) => {
    nodes.forEach((n) => {
      if (n.level !== 'company') out.push({ id: n.id, name: n.name, depth, level: n.level })
      walk(n.children, n.level === 'company' ? depth : depth + 1)
    })
  }
  walk(tree ?? [], 0)
  return out
}

function ScopeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const tree = useApi<TreeNode[]>('/hierarchy/tree')
  const flat = useMemo(() => flattenTree(tree.data), [tree.data])
  return (
    <label className="flex items-center gap-2 text-xs text-ink-2">
      Escopo
      <Select
        className="w-64"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={[
          { value: '', label: 'Planta inteira' },
          ...flat.map((n) => ({ value: String(n.id), label: `${'  '.repeat(n.depth)}${n.name}` })),
        ]}
      />
    </label>
  )
}

/* ---------------------------------------------------------------- página */

interface MatrixResponse {
  period: PeriodInfo
  comparison_period: PeriodInfo
  items: IndicatorRow[]
  status_counts: StatusCounts
}

interface CoverageCell {
  count: number
  worst_status: StatusCode | null
  indicators: { id: number; name: string; status: StatusCode; value: number | null; unit: string; kind: string }[]
}

interface CoverageResponse {
  period: PeriodInfo
  categories: string[]
  rows: {
    use: { id: number; code: string; name: string; category: { name: string; color_slot: number } | null }
    node: { id: number; name: string } | null
    cells: Record<string, CoverageCell>
  }[]
}

export function IndicatorsPage() {
  const filters = useFilters()
  const [scope, setScope] = useState('')
  const [tab, setTab] = useState('matriz')
  const params = { ...filters.params, node_id: scope || undefined }
  const matrix = useApi<MatrixResponse>('/matrix/indicators', params)
  const coverage = useApi<CoverageResponse>('/matrix/use-indicator', { period: filters.period, node_id: scope || undefined })

  const items = matrix.data?.items ?? []
  const kpis = useMemo(() => {
    const intr = items.filter((i) => i.kind === 'intrinsic').length
    const withTarget = items.filter((i) => i.current.target !== null || i.current.target_min !== null).length
    const off = items.filter((i) => i.current.status === 'critico' || i.current.status === 'atencao').length
    return { total: items.length, intr, extr: items.length - intr, withTarget, info: items.length - withTarget, off }
  }, [items])

  return (
    <>
      <PageHeader
        title="Indicadores de desempenho energético"
        subtitle="Cada IDE ligado ao processo, ao USE, ao equipamento, à fórmula e à origem do dado — cadastro configurável, sem fórmula no código."
        actions={<ScopeSelect value={scope} onChange={setScope} />}
      />
      <Page>
        <StatRow cols={5}>
          <KpiTile label="IDEs no escopo" value={kpis.total} hint={`Período ${matrix.data?.period.label ?? ''}`} />
          <KpiTile label="Intrínsecos × extrínsecos" value={`${kpis.intr} / ${kpis.extr}`} hint="Características do equipamento × uso no processo" />
          <KpiTile label="Com meta" value={kpis.withTarget} hint={`${kpis.info} informativos (sem meta definida)`} />
          <KpiTile label="Fora da meta" value={kpis.off} status={kpis.off > 0 ? 'atencao' : 'normal'} hint="Atenção + desvio significativo" />
          <KpiTile
            label="Sem dados suficientes"
            value={matrix.data?.status_counts.sem_dados ?? 0}
            status={(matrix.data?.status_counts.sem_dados ?? 0) > 0 ? 'sem_dados' : 'normal'}
            hint="Completude abaixo do mínimo configurado"
          />
        </StatRow>

        <Card>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'matriz', label: 'Matriz de indicadores', count: items.length },
              { value: 'cobertura', label: 'Cobertura USE × categoria', count: coverage.data?.rows.length },
            ]}
          />
          {tab === 'matriz' ? (
            matrix.error ? (
              <ErrorState error={matrix.error} />
            ) : matrix.isPending ? (
              <Skeleton className="m-4" style={{ height: 420 }} />
            ) : (
              <MatrixTable items={items} periodLabel={matrix.data?.period.label ?? ''} />
            )
          ) : coverage.error ? (
            <ErrorState error={coverage.error} />
          ) : coverage.isPending ? (
            <Skeleton className="m-4" style={{ height: 420 }} />
          ) : (
            <CoverageMatrix data={coverage.data!} linkFor={(id) => filters.link(`/indicadores/${id}`)} />
          )}
        </Card>
      </Page>
    </>
  )
}

/* ---------------------------------------------------------------- matriz completa */

function MatrixTable({ items, periodLabel }: { items: IndicatorRow[]; periodLabel: string }) {
  const filters = useFilters()
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<'intrinsic' | 'extrinsic' | null>(null)
  const [level, setLevel] = useState<'process' | 'use' | 'equipment' | null>(null)
  const [status, setStatus] = useState<StatusCode | null>(null)

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(
      (r) =>
        (!q ||
          r.name.toLowerCase().includes(q) ||
          r.code.toLowerCase().includes(q) ||
          r.formula.toLowerCase().includes(q) ||
          (r.equipment?.tag ?? '').toLowerCase().includes(q) ||
          (r.use?.name ?? '').toLowerCase().includes(q)) &&
        (!kind || r.kind === kind) &&
        (!level || r.level === level) &&
        (!status || r.current.status === status),
    )
  }, [items, search, kind, level, status])

  const counts = useMemo(() => {
    const c: Partial<Record<StatusCode, number>> = {}
    items.forEach((r) => {
      c[r.current.status] = (c[r.current.status] ?? 0) + 1
    })
    return c
  }, [items])

  const exportCsv = () => {
    const header = [
      'Processo', 'Subprocesso/nó', 'USE', 'Equipamento', 'Código', 'Indicador', 'Tipo', 'Categoria', 'Fórmula',
      'Variáveis', 'Unidade', 'Origem do dado', 'Coleta', 'Frequência', 'Responsável', 'Meta', 'Baseline',
      'Valor atual', 'Período anterior', 'Variação %', 'Status',
    ]
    const lines = rows.map((r) =>
      [
        r.process?.name ?? '',
        r.node?.name ?? '',
        r.use?.name ?? '',
        r.equipment ? `${r.equipment.tag} — ${r.equipment.name}` : '',
        r.code,
        r.name,
        KIND_LABEL[r.kind],
        r.category,
        r.formula,
        (r.bindings ?? []).map((b) => `${b.symbol}=${b.variable ?? b.constant_value ?? b.attribute ?? b.builtin ?? ''}`).join(' | '),
        r.unit,
        r.data_sources.join(' / '),
        r.collection,
        r.frequency,
        r.responsible?.name ?? '',
        r.current.target ?? (r.current.target_min !== null ? `${r.current.target_min}–${r.current.target_max}` : ''),
        r.current.baseline ?? '',
        r.current.value ?? '',
        r.previous?.value ?? '',
        r.delta_pct ?? '',
        r.current.status_label,
      ]
        .map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`)
        .join(';'),
    )
    const blob = new Blob([`﻿${[header.join(';'), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `matriz-indicadores-${periodLabel.replace(/\s+/g, '-').toLowerCase()}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            className="w-64 pl-7"
            placeholder="Buscar indicador, fórmula, TAG, USE…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {(['intrinsic', 'extrinsic'] as const).map((k) => (
          <Chip key={k} active={kind === k} onClick={() => setKind(kind === k ? null : k)}>
            {KIND_LABEL[k]}
          </Chip>
        ))}
        {(['process', 'use', 'equipment'] as const).map((l) => (
          <Chip key={l} active={level === l} onClick={() => setLevel(level === l ? null : l)}>
            {LEVEL_LABEL[l]}
          </Chip>
        ))}
        <span className="mx-1 h-4 w-px bg-[var(--edge)]" />
        {STATUS_ORDER.filter((s) => counts[s]).map((s) => (
          <Chip key={s} active={status === s} onClick={() => setStatus(status === s ? null : s)}>
            {STATUS_META[s].short} <b className="num">{counts[s]}</b>
          </Chip>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-muted num">{rows.length} linhas</span>
          <Button size="sm" onClick={exportCsv}>
            <Download size={13} /> CSV
          </Button>
        </div>
      </div>

      <div className="max-h-[calc(100vh-330px)] min-h-0 overflow-auto">
        {rows.length === 0 ? (
          <EmptyState title="Nenhum indicador para os filtros selecionados." icon={<Sigma size={20} />} />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Processo</th>
                <th>USE</th>
                <th>Equipamento</th>
                <th>Indicador</th>
                <th>Fórmula</th>
                <th>Unidade</th>
                <th>Origem do dado</th>
                <th>Frequência</th>
                <th>Responsável</th>
                <th className="right">Meta</th>
                <th className="right">Baseline</th>
                <th className="right">Valor atual</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-ink-2">
                    {r.process?.name ?? EMPTY}
                    {r.node && r.node.id !== r.process?.id && <span className="block text-[11px] text-muted">{r.node.name}</span>}
                  </td>
                  <td className="max-w-[170px] truncate text-ink-2" title={r.use?.name}>
                    {r.use?.name ?? <span className="text-muted">—</span>}
                  </td>
                  <td className="max-w-[150px] truncate text-ink-2" title={r.equipment?.name}>
                    {r.equipment ? r.equipment.tag : <span className="text-muted">—</span>}
                  </td>
                  <td className="max-w-[260px]">
                    <Link to={filters.link(`/indicadores/${r.id}`)} className="block truncate font-medium text-ink hover:underline">
                      {r.name}
                    </Link>
                    <span className="text-[11px] text-muted">
                      {r.code} · {KIND_LABEL[r.kind]} · {r.category}
                    </span>
                  </td>
                  <td>
                    <Tooltip
                      content={
                        <div className="space-y-0.5">
                          {(r.bindings ?? []).map((b) => (
                            <div key={b.symbol}>
                              <b>{b.symbol}</b> = {b.variable ?? b.constant_value ?? b.attribute ?? b.builtin}
                              {b.aggregation ? ` (${b.aggregation})` : ''}
                            </div>
                          ))}
                        </div>
                      }
                    >
                      <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-2">{r.formula}</code>
                    </Tooltip>
                  </td>
                  <td className="whitespace-nowrap text-ink-2">{r.unit}</td>
                  <td className="max-w-[170px] truncate text-[11px] text-ink-2" title={r.data_sources.join(' / ')}>
                    {r.data_sources.join(' / ') || EMPTY}
                    <span className="block text-muted">{r.collection}</span>
                  </td>
                  <td className="whitespace-nowrap text-[11px] text-ink-2">{r.frequency}</td>
                  <td className="max-w-[140px] truncate text-[11px] text-ink-2" title={r.responsible?.role_title ?? ''}>
                    {r.responsible?.name ?? EMPTY}
                  </td>
                  <td className="right text-ink-2">
                    {r.current.target !== null
                      ? fmtAuto(r.current.target, r.decimals)
                      : r.current.target_min !== null
                        ? `${fmtAuto(r.current.target_min, r.decimals)}–${fmtAuto(r.current.target_max, r.decimals)}`
                        : EMPTY}
                  </td>
                  <td className="right text-ink-2">{fmtAuto(r.current.baseline, r.decimals)}</td>
                  <td className="right font-medium">
                    {r.current.value === null ? (
                      <Tooltip content={r.current.reason ?? 'Sem valor no período'}>
                        <span className="text-muted">{EMPTY}</span>
                      </Tooltip>
                    ) : (
                      fmtAuto(r.current.value, r.decimals)
                    )}
                  </td>
                  <td>
                    <StatusPill status={r.current.status} explanation={r.current.status_explanation} compact />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- cobertura USE × categoria */

function CoverageMatrix({ data, linkFor }: { data: CoverageResponse; linkFor: (id: number) => string }) {
  const gaps = useMemo(
    () => data.rows.reduce((acc, r) => acc + data.categories.filter((c) => !r.cells[c]).length, 0),
    [data],
  )
  return (
    <div className="flex min-h-0 flex-col">
      <CardHeader
        className="border-b-0"
        title="Cobertura de medição por USE"
        subtitle={`Quais categorias de indicador cada USE já possui. Células vazias (${gaps}) são lacunas: USE sem indicador daquela categoria.`}
        icon={<Grid3x3 size={14} />}
      />
      <div className="max-h-[calc(100vh-360px)] overflow-auto px-3 pb-3">
        <table className="table">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 bg-surface">USE</th>
              <th>Etapa</th>
              {data.categories.map((c) => (
                <th key={c} className="text-center">
                  {c}
                </th>
              ))}
              <th className="right">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => {
              const total = data.categories.reduce((acc, c) => acc + (row.cells[c]?.count ?? 0), 0)
              return (
                <tr key={row.use.id}>
                  <td className="sticky left-0 z-10 max-w-[230px] truncate bg-surface font-medium" title={row.use.name}>
                    {row.use.name}
                  </td>
                  <td className="whitespace-nowrap text-[11px] text-ink-2">{row.node?.name ?? EMPTY}</td>
                  {data.categories.map((c) => {
                    const cell = row.cells[c]
                    if (!cell) {
                      return (
                        <td key={c} className="text-center">
                          <Tooltip content={`Sem indicador de "${c}" para este USE — oportunidade de cadastro.`}>
                            <span className="inline-block rounded border border-dashed border-edge px-2 py-0.5 text-[11px] text-muted">—</span>
                          </Tooltip>
                        </td>
                      )
                    }
                    return (
                      <td key={c} className="text-center">
                        <Popover
                          align="center"
                          trigger={
                            <button
                              className={cn(
                                'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium hover:bg-surface-2',
                              )}
                              style={{ borderColor: statusColor(cell.worst_status) }}
                            >
                              {cell.worst_status && <StatusIcon status={cell.worst_status} size={11} />}
                              <span className="num">{cell.count}</span>
                            </button>
                          }
                        >
                          <p className="mb-2 text-xs font-semibold">
                            {row.use.name} · {c}
                          </p>
                          <ul className="space-y-1">
                            {cell.indicators.map((ind) => (
                              <li key={ind.id} className="flex items-center justify-between gap-2 text-xs">
                                <Link to={linkFor(ind.id)} className="truncate hover:underline">
                                  {ind.name}
                                </Link>
                                <span className="flex shrink-0 items-center gap-1 num text-ink-2">
                                  {fmtAuto(ind.value)} {ind.unit}
                                  <StatusIcon status={ind.status} size={12} />
                                </span>
                              </li>
                            ))}
                          </ul>
                        </Popover>
                      </td>
                    )
                  })}
                  <td className="right num font-medium">{total}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-edge px-4 py-2 text-[11px] text-muted">
        O número na célula é a quantidade de IDEs; o ícone indica o pior status do período. Clique para abrir a lista.
      </p>
    </div>
  )
}
