/** Tabela de indicadores com filtros locais, ordenação e drill-down preservando o período. */
import { ArrowUpDown, Search, Sigma } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'

import { STATUS_META, STATUS_ORDER } from '../../lib/colors'
import { EMPTY, KIND_LABEL, LEVEL_LABEL, fmtAuto, fmtPct } from '../../lib/format'
import { useFilters } from '../../lib/hooks'
import type { IndicatorRow, StatusCode } from '../../lib/types'
import { Chip, EmptyState, Input, Tooltip, cn } from '../ui/primitives'
import { DeltaBadge, Sparkline, StatusPill } from '../ui/status'

type SortKey = 'name' | 'value' | 'deviation' | 'delta' | 'status'

export function IndicatorTable({
  rows,
  dense,
  hideColumns = [],
  emptyMessage = 'Nenhum indicador para os filtros selecionados.',
  showFilters = true,
  maxHeight,
}: {
  rows: IndicatorRow[]
  dense?: boolean
  hideColumns?: ('level' | 'kind' | 'baseline' | 'previous' | 'spark' | 'origin')[]
  emptyMessage?: string
  showFilters?: boolean
  maxHeight?: number
}) {
  const filters = useFilters()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusCode | null>(null)
  const [kind, setKind] = useState<'intrinsic' | 'extrinsic' | null>(null)
  const [level, setLevel] = useState<'process' | 'use' | 'equipment' | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'status', dir: 1 })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const out = rows.filter(
      (r) =>
        (!q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q) || (r.equipment?.name ?? '').toLowerCase().includes(q)) &&
        (!status || r.current.status === status) &&
        (!kind || r.kind === kind) &&
        (!level || r.level === level),
    )
    const rank = (s: StatusCode) => STATUS_ORDER.indexOf(s)
    out.sort((a, b) => {
      const dir = sort.dir
      switch (sort.key) {
        case 'name':
          return dir * a.name.localeCompare(b.name, 'pt-BR')
        case 'value':
          return dir * ((b.current.value ?? -Infinity) - (a.current.value ?? -Infinity))
        case 'deviation':
          return dir * ((b.current.deviation_pct ?? -Infinity) - (a.current.deviation_pct ?? -Infinity))
        case 'delta':
          return dir * (Math.abs(b.delta_pct ?? 0) - Math.abs(a.delta_pct ?? 0))
        default:
          return dir * (rank(a.current.status) - rank(b.current.status))
      }
    })
    return out
  }, [rows, search, status, kind, level, sort])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    rows.forEach((r) => {
      c[r.current.status] = (c[r.current.status] ?? 0) + 1
    })
    return c
  }, [rows])

  const toggleSort = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key && s.dir === 1 ? -1 : 1 }))
  const Th = ({ label, sortKey, className }: { label: string; sortKey?: SortKey; className?: string }) => (
    <th className={className}>
      {sortKey ? (
        <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => toggleSort(sortKey)}>
          {label}
          <ArrowUpDown size={11} className={cn('opacity-40', sort.key === sortKey && 'opacity-100')} />
        </button>
      ) : (
        label
      )}
    </th>
  )

  return (
    <div className="flex min-h-0 flex-col">
      {showFilters && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
            <Input
              placeholder="Buscar indicador, equipamento…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 pl-7"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {STATUS_ORDER.filter((s) => counts[s]).map((s) => (
              <Chip key={s} active={status === s} onClick={() => setStatus(status === s ? null : s)}>
                {STATUS_META[s].short} <b className="num">{counts[s]}</b>
              </Chip>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1">
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
          </div>
        </div>
      )}

      <div className="min-h-0 overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
        {filtered.length === 0 ? (
          <EmptyState title={emptyMessage} icon={<Sigma size={20} />} />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <Th label="Indicador" sortKey="name" />
                {!hideColumns.includes('level') && <th>Nível</th>}
                <Th label="Valor" sortKey="value" className="right" />
                <th className="right">Meta</th>
                {!hideColumns.includes('baseline') && <th className="right">Baseline</th>}
                {!hideColumns.includes('previous') && <th className="right">Anterior</th>}
                <Th label="Δ período" sortKey="delta" className="right" />
                <Th label="Desvio" sortKey="deviation" className="right" />
                {!hideColumns.includes('spark') && <th>Histórico</th>}
                <Th label="Status" sortKey="status" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className={dense ? 'text-[12px]' : undefined}>
                  <td className="max-w-[320px]">
                    <Link to={filters.link(`/indicadores/${r.id}`)} className="block truncate font-medium text-ink hover:underline">
                      {r.name}
                    </Link>
                    <span className="block truncate text-[11px] text-muted">
                      {[r.process?.name, r.use?.name, r.equipment?.tag].filter(Boolean).join(' › ') || r.code}
                    </span>
                  </td>
                  {!hideColumns.includes('level') && (
                    <td>
                      <span className="whitespace-nowrap text-[11px] text-ink-2">
                        {LEVEL_LABEL[r.level]} · {KIND_LABEL[r.kind]}
                      </span>
                    </td>
                  )}
                  <td className="right font-medium">
                    {r.current.value === null ? (
                      <Tooltip content={r.current.reason ?? undefined}>
                        <span className="text-muted">{EMPTY}</span>
                      </Tooltip>
                    ) : (
                      <>
                        {fmtAuto(r.current.value, r.decimals)}
                        <span className="ml-1 text-[11px] font-normal text-muted">{r.unit}</span>
                      </>
                    )}
                  </td>
                  <td className="right text-ink-2">
                    {r.current.target !== null
                      ? fmtAuto(r.current.target, r.decimals)
                      : r.current.target_min !== null
                        ? `${fmtAuto(r.current.target_min, r.decimals)}–${fmtAuto(r.current.target_max, r.decimals)}`
                        : EMPTY}
                  </td>
                  {!hideColumns.includes('baseline') && <td className="right text-ink-2">{fmtAuto(r.current.baseline, r.decimals)}</td>}
                  {!hideColumns.includes('previous') && (
                    <td className="right text-ink-2">{fmtAuto(r.previous?.value ?? null, r.decimals)}</td>
                  )}
                  <td className="right">
                    <DeltaBadge pct={r.delta_pct} changeClass={r.change_class} compact />
                  </td>
                  <td className="right">
                    {r.current.deviation_pct === null ? (
                      EMPTY
                    ) : (
                      <span
                        className="num"
                        style={{ color: r.current.deviation_pct > 0 ? 'var(--critical-text)' : 'var(--good-text)' }}
                      >
                        {fmtPct(r.current.deviation_pct, 1, true)}
                      </span>
                    )}
                  </td>
                  {!hideColumns.includes('spark') && (
                    <td>{r.spark ? <Sparkline values={r.spark} /> : <span className="text-muted">—</span>}</td>
                  )}
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
