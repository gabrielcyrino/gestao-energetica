/** Diagnóstico do período: desvios, deteriorações, contexto de produção e qualidade de dado,
 *  cada achado ligado ao indicador e com atalho para registrar oportunidade. */
import { AlertOctagon, AlertTriangle, DatabaseZap, Info, Lightbulb, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { statusColor } from '../../lib/colors'
import { fmtAuto, fmtDateFull, fmtPct } from '../../lib/format'
import { useFilters } from '../../lib/hooks'
import type { Diagnostic } from '../../lib/types'
import { OpportunityDialog } from '../ops/OpportunityDialog'
import { Button, EmptyState, cn } from '../ui/primitives'

const ICON = {
  desvio: AlertOctagon,
  deterioracao: TrendingUp,
  contexto: Info,
  qualidade_dados: DatabaseZap,
}

export function DiagnosticsList({ items, limit }: { items: Diagnostic[]; limit?: number }) {
  const filters = useFilters()
  const [prefill, setPrefill] = useState<Diagnostic | null>(null)
  const shown = limit ? items.slice(0, limit) : items

  if (!items.length) {
    return (
      <EmptyState
        title="Nenhum desvio relevante no período"
        description="Todos os indicadores com meta estão dentro da tolerância e a completude dos dados está adequada."
        icon={<AlertTriangle size={20} />}
      />
    )
  }

  return (
    <>
      <ul className="divide-y divide-[var(--edge)]">
        {shown.map((d, i) => {
          const Icon = ICON[d.type] ?? Info
          const color = d.type === 'contexto' ? 'var(--accent)' : statusColor(d.severity)
          return (
            <li key={`${d.indicator_id ?? 'x'}-${i}`} className="flex gap-3 px-4 py-3">
              <Icon size={16} className="mt-0.5 shrink-0" style={{ color }} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  {d.indicator_id ? (
                    <Link to={filters.link(`/indicadores/${d.indicator_id}`)} className="text-[13px] font-medium text-ink hover:underline">
                      {d.title}
                    </Link>
                  ) : (
                    <span className="text-[13px] font-medium text-ink">{d.title}</span>
                  )}
                  {d.equipment && <span className="text-[11px] text-muted">{d.equipment.tag}</span>}
                  {d.node && <span className="text-[11px] text-muted">· {d.node.name}</span>}
                </div>
                <p className="mt-0.5 text-xs leading-snug text-ink-2">{d.explanation}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
                  {d.value !== null && d.value !== undefined && (
                    <span className="num">
                      Valor <b className="text-ink">{fmtAuto(d.value, d.decimals)}</b> {d.unit}
                    </span>
                  )}
                  {d.target !== null && d.target !== undefined && (
                    <span className="num">
                      Meta <b className="text-ink">{fmtAuto(d.target, d.decimals)}</b>
                    </span>
                  )}
                  {d.delta_pct !== null && d.delta_pct !== undefined && (
                    <span className="num">vs período anterior {fmtPct(d.delta_pct, 1, true)}</span>
                  )}
                  {d.behavior_change_since && (
                    <span className="rounded border border-[var(--warning)] px-1">
                      mudança de comportamento desde {fmtDateFull(d.behavior_change_since)}
                    </span>
                  )}
                  {(d.open_opportunities ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1 text-accent-ink">
                      <Lightbulb size={11} /> {d.open_opportunities} oportunidade(s) aberta(s)
                    </span>
                  )}
                </div>
              </div>
              {d.type !== 'contexto' && (
                <Button size="sm" variant="ghost" className={cn('self-start')} onClick={() => setPrefill(d)}>
                  <Lightbulb size={13} /> Registrar
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {prefill && <OpportunityDialog diagnostic={prefill} open onClose={() => setPrefill(null)} />}
    </>
  )
}
