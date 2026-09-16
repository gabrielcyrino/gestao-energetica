/** Estado e variação: sempre ícone + rótulo (nunca só cor) — requisito de acessibilidade. */
import {
  AlertOctagon,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  DatabaseZap,
  Info,
  Minus,
  PauseCircle,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { STATUS_META, STATUS_ORDER, statusColor } from '../../lib/colors'
import { CHANGE_LABEL, TREND_LABEL, fmtPct } from '../../lib/format'
import type { ChangeClass, StatusCode, StatusCounts, TrendClass } from '../../lib/types'
import { Tooltip, cn } from './primitives'

const ICONS: Record<StatusCode, typeof CheckCircle2> = {
  normal: CheckCircle2,
  atencao: AlertTriangle,
  critico: AlertOctagon,
  sem_dados: DatabaseZap,
  sem_operacao: PauseCircle,
  sem_meta: Info,
}

export function StatusIcon({ status, size = 14 }: { status: StatusCode; size?: number }) {
  const Icon = ICONS[status] ?? Info
  return <Icon size={size} style={{ color: statusColor(status) }} aria-hidden />
}

export function StatusPill({
  status,
  explanation,
  compact,
}: {
  status: StatusCode
  explanation?: string | null
  compact?: boolean
}) {
  const meta = STATUS_META[status] ?? STATUS_META.sem_meta
  return (
    <Tooltip content={explanation}>
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
        )}
        style={{ borderColor: meta.color, color: 'var(--ink)' }}
      >
        <StatusIcon status={status} size={12} />
        {compact ? meta.short : meta.label}
      </span>
    </Tooltip>
  )
}

export function StatusDot({ status, title }: { status: StatusCode; title?: string }) {
  return (
    <Tooltip content={title ?? STATUS_META[status]?.label}>
      <span className="inline-flex items-center">
        <StatusIcon status={status} size={13} />
      </span>
    </Tooltip>
  )
}

/** Barra de composição de status (soma dos indicadores do escopo). */
export function StatusBar({ counts, total, onSelect }: { counts: StatusCounts; total?: number; onSelect?: (s: StatusCode) => void }) {
  const sum = total ?? Object.values(counts).reduce((a, b) => a + b, 0)
  if (!sum) return <span className="text-xs text-muted">sem indicadores</span>
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-3">
        {STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => (
          <Tooltip key={s} content={`${STATUS_META[s].label}: ${counts[s]}`}>
            <button
              type="button"
              onClick={onSelect ? () => onSelect(s) : undefined}
              aria-label={`${STATUS_META[s].label}: ${counts[s]}`}
              className="h-full border-r-2 border-[var(--surface)] last:border-r-0"
              style={{ width: `${(counts[s] / sum) * 100}%`, background: STATUS_META[s].color }}
            />
          </Tooltip>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-2">
        {STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <StatusIcon status={s} size={11} />
            {STATUS_META[s].short}
            <b className="num font-semibold text-ink">{counts[s]}</b>
          </span>
        ))}
      </div>
    </div>
  )
}

/** Variação percentual com leitura de negócio: melhora/piora depende da direção desejada. */
export function DeltaBadge({
  pct,
  changeClass,
  label,
  compact,
}: {
  pct: number | null | undefined
  changeClass?: ChangeClass
  label?: string
  compact?: boolean
}) {
  if (pct === null || pct === undefined) return <span className="text-xs text-muted">—</span>
  const up = pct > 0
  const Icon = Math.abs(pct) < 0.05 ? Minus : up ? ArrowUpRight : ArrowDownRight
  const color =
    changeClass === 'melhoria'
      ? 'var(--good-text)'
      : changeClass === 'piora'
        ? 'var(--critical-text)'
        : 'var(--ink-2)'
  return (
    <Tooltip content={label ?? (changeClass ? CHANGE_LABEL[changeClass] : undefined)}>
      <span className="inline-flex items-center gap-0.5 text-xs font-medium num" style={{ color }}>
        <Icon size={13} aria-hidden />
        {fmtPct(Math.abs(pct), Math.abs(pct) < 10 ? 1 : 0)}
        {!compact && changeClass && changeClass !== 'indefinido' && (
          <span className="ml-1 text-[11px] font-normal text-ink-2">{CHANGE_LABEL[changeClass]}</span>
        )}
      </span>
    </Tooltip>
  )
}

export function TrendBadge({ trend, relative }: { trend: TrendClass; relative?: number | null }) {
  const map: Record<TrendClass, { icon: ReactNode; color: string }> = {
    melhoria: { icon: <TrendingDown size={13} />, color: 'var(--good-text)' },
    deterioracao: { icon: <TrendingUp size={13} />, color: 'var(--critical-text)' },
    estavel: { icon: <ArrowRight size={13} />, color: 'var(--ink-2)' },
    aumento: { icon: <TrendingUp size={13} />, color: 'var(--ink-2)' },
    reducao: { icon: <TrendingDown size={13} />, color: 'var(--ink-2)' },
    insuficiente: { icon: <Minus size={13} />, color: 'var(--muted)' },
  }
  const m = map[trend] ?? map.insuficiente
  return (
    <Tooltip content={relative != null ? `Tendência na janela: ${fmtPct(relative, 1, true)}` : undefined}>
      <span className="inline-flex items-center gap-1 text-xs" style={{ color: m.color }}>
        {m.icon}
        {TREND_LABEL[trend]}
      </span>
    </Tooltip>
  )
}

/** Sparkline SVG (12 pontos) — contexto rápido na linha da tabela. */
export function Sparkline({
  values,
  color = 'var(--ink-2)',
  width = 84,
  height = 22,
}: {
  values: (number | null)[]
  color?: string
  width?: number
  height?: number
}) {
  const points = values.filter((v): v is number => v !== null)
  if (points.length < 2) return <span className="text-[11px] text-muted">—</span>
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const step = width / Math.max(1, values.length - 1)
  let d = ''
  values.forEach((v, i) => {
    if (v === null) return
    const x = i * step
    const y = height - 2 - ((v - min) / span) * (height - 4)
    d += `${d ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
  })
  const lastIdx = values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop() ?? 0
  const lastX = lastIdx * step
  const lastY = height - 2 - (((values[lastIdx] as number) - min) / span) * (height - 4)
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
    </svg>
  )
}
