/** Blocos numéricos: KPI (valor + variação + sparkline), número herói e barra de meta. */
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { EMPTY, fmtAuto } from '../../lib/format'
import type { ChangeClass, StatusCode } from '../../lib/types'
import { Tooltip, cn } from '../ui/primitives'
import { DeltaBadge, Sparkline, StatusPill } from '../ui/status'

export function KpiTile({
  label,
  value,
  unit,
  decimals,
  delta,
  changeClass,
  deltaLabel,
  spark,
  status,
  hint,
  to,
  footer,
  hero,
}: {
  label: string
  value: number | string | null
  unit?: string | null
  decimals?: number
  delta?: number | null
  changeClass?: ChangeClass
  deltaLabel?: string
  spark?: (number | null)[]
  status?: StatusCode
  hint?: ReactNode
  to?: string
  footer?: ReactNode
  hero?: boolean
}) {
  const body = (
    <div className="card card-pad flex h-full flex-col gap-1">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium text-ink-2">{label}</span>
        {status && <StatusPill status={status} compact />}
      </div>
      <div className="flex flex-wrap items-baseline gap-1.5">
        <span className={cn('font-semibold text-ink', hero ? 'text-[34px] leading-none' : 'text-[22px] leading-tight')}>
          {typeof value === 'number'
            ? fmtAuto(value, decimals ?? (Number.isInteger(value) ? 0 : undefined))
            : (value ?? EMPTY)}
        </span>
        {unit && <span className="text-xs text-muted">{unit}</span>}
      </div>
      <div className="flex items-center justify-between gap-2">
        {delta !== undefined ? <DeltaBadge pct={delta} changeClass={changeClass} label={deltaLabel} compact /> : <span />}
        {spark && spark.filter((v) => v !== null).length > 1 && <Sparkline values={spark} />}
      </div>
      {hint && <p className="text-[11px] leading-snug text-muted">{hint}</p>}
      {footer}
    </div>
  )
  return to ? (
    <Link to={to} className="block transition-transform hover:-translate-y-px">
      {body}
    </Link>
  ) : (
    body
  )
}

export function MiniStat({
  label,
  value,
  unit,
  tooltip,
  decimals,
}: {
  label: string
  value: number | string | null
  unit?: string | null
  tooltip?: string
  decimals?: number
}) {
  return (
    <Tooltip content={tooltip}>
      <div className="min-w-0">
        <p className="truncate text-[11px] text-muted">{label}</p>
        <p className="num truncate text-[15px] font-semibold text-ink">
          {typeof value === 'number'
            ? fmtAuto(value, decimals ?? (Number.isInteger(value) ? 0 : undefined))
            : (value ?? EMPTY)}
          {unit && <span className="ml-1 text-[11px] font-normal text-muted">{unit}</span>}
        </p>
      </div>
    </Tooltip>
  )
}

export function StatRow({ children, cols = 4 }: { children: ReactNode; cols?: number }) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${cols >= 5 ? 150 : 190}px, 1fr))` }}
    >
      {children}
    </div>
  )
}
