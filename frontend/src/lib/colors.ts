/** Cores por papel: identidade (série), magnitude (sequencial), polaridade (divergente) e estado (status).
 *  A cor segue a entidade (slot cadastrado), nunca a posição no ranking — filtrar não repinta as séries. */
import type { StatusCode } from './types'

export const SERIES_SLOTS = 8

export function seriesColor(slot: number | null | undefined): string {
  const s = ((Number(slot ?? 1) - 1) % SERIES_SLOTS) + 1
  return `var(--s${s})`
}

export function seriesColors(n: number): string[] {
  return Array.from({ length: n }, (_, i) => seriesColor(i + 1))
}

export const STATUS_META: Record<StatusCode, { label: string; color: string; icon: string; short: string }> = {
  normal: { label: 'Dentro da meta', color: 'var(--good)', icon: 'check', short: 'OK' },
  atencao: { label: 'Atenção', color: 'var(--warning)', icon: 'alert-triangle', short: 'Atenção' },
  critico: { label: 'Desvio significativo', color: 'var(--critical)', icon: 'alert-octagon', short: 'Crítico' },
  sem_dados: { label: 'Sem dados suficientes', color: 'var(--serious)', icon: 'database', short: 'Sem dados' },
  sem_operacao: { label: 'Sem operação', color: 'var(--neutral)', icon: 'pause', short: 'Parado' },
  sem_meta: { label: 'Informativo', color: 'var(--neutral)', icon: 'info', short: 'Info' },
}

export const STATUS_ORDER: StatusCode[] = ['critico', 'atencao', 'sem_dados', 'normal', 'sem_meta', 'sem_operacao']

export function statusColor(status: StatusCode | null | undefined): string {
  return status ? STATUS_META[status].color : 'var(--neutral)'
}

/** Rampa sequencial (magnitude) — uma única matiz, claro → escuro. */
export const SEQUENTIAL = ['var(--seq-100)', 'var(--seq-250)', 'var(--seq-400)', 'var(--seq-550)', 'var(--seq-700)']

/** Divergente azul ↔ vermelho com cinza neutro no meio (polaridade: melhor × pior). */
export const DIVERGING = {
  negative: ['#1c5cab', '#3987e5', '#86b6ef', '#cde2fb'],
  neutral: 'var(--surface-3)',
  positive: ['#f3c9c9', '#e08a8a', '#d03b3b', '#9c2020'],
}

/** Cor divergente para desvio percentual, sensível à direção desejada do indicador. */
export function deviationColor(pct: number | null | undefined, lowerIsBetter = true): string {
  if (pct === null || pct === undefined) return 'var(--surface-3)'
  const unfavorable = lowerIsBetter ? pct : -pct
  const scale = Math.min(1, Math.abs(unfavorable) / 20)
  const idx = Math.min(3, Math.floor(scale * 4))
  if (Math.abs(unfavorable) < 2) return DIVERGING.neutral
  return unfavorable > 0 ? DIVERGING.positive[idx] : DIVERGING.negative[3 - idx]
}

export function readVar(name: string, fallback = '#888'): string {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/** Resolve "var(--x)" para hex — o ECharts precisa de cor concreta em canvas. */
export function resolveColor(color: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(color.trim())
  return m ? readVar(m[1]) : color
}
