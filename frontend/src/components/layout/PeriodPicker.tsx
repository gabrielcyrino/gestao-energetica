/** Filtro global de período — uma única linha acima de todo o conteúdo que ela escopa.
 *  Semana, mês, ano, Crop Year, safra e período livre; comparação com anterior, ano anterior ou período escolhido. */
import { CalendarDays, Check, ChevronDown, GitCompareArrows } from 'lucide-react'
import { useState } from 'react'

import { useApi, useFilters, useMeta } from '../../lib/hooks'
import type { PeriodInfo } from '../../lib/types'
import { Button, Popover, Segmented, Tooltip, cn } from '../ui/primitives'

type Kind = 'week' | 'month' | 'year' | 'crop_year' | 'season' | 'custom'

const KIND_LABEL: Record<Kind, string> = {
  week: 'Semana',
  month: 'Mês',
  year: 'Ano',
  crop_year: 'Crop Year',
  season: 'Safra',
  custom: 'Personalizado',
}

function kindOf(spec: string): Kind {
  const k = spec.split(':')[0]
  return (['week', 'month', 'year', 'crop_year', 'season'].includes(k) ? k : 'custom') as Kind
}

function PeriodList({
  kind,
  current,
  onPick,
}: {
  kind: Kind
  current: string
  onPick: (spec: string) => void
}) {
  const meta = useMeta()
  const [from, setFrom] = useState(current.startsWith('custom:') ? current.slice(7, 17) : '')
  const [to, setTo] = useState(current.startsWith('custom:') ? current.slice(19) : '')
  if (kind === 'custom') {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-ink-2">
            De
            <input type="date" className="input mt-1" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-xs text-ink-2">
            Até
            <input type="date" className="input mt-1" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <Button
          variant="primary"
          className="w-full justify-center"
          disabled={!from || !to || from > to}
          onClick={() => onPick(`custom:${from}..${to}`)}
        >
          Aplicar período
        </Button>
        <p className="text-[11px] text-muted">
          Dados disponíveis de {meta.data?.periods.data_start} a {meta.data?.periods.data_end}.
        </p>
      </div>
    )
  }
  const list: PeriodInfo[] = (meta.data?.periods[kind] ?? []) as PeriodInfo[]
  return (
    <div className="max-h-72 space-y-0.5 overflow-auto">
      {list.map((p) => (
        <button
          key={p.spec}
          onClick={() => onPick(p.spec)}
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-2',
            p.spec === current && 'bg-accent-soft text-accent-ink',
          )}
        >
          <span className="truncate">{p.label}</span>
          <span className="flex items-center gap-1 text-[10px] text-muted">
            {p.partial && <span className="rounded border border-[var(--warning)] px-1">parcial</span>}
            {p.spec === current && <Check size={14} className="shrink-0" />}
          </span>
        </button>
      ))}
      {list.length === 0 && <p className="p-2 text-xs text-muted">Nenhum período cadastrado.</p>}
    </div>
  )
}

export function PeriodPicker() {
  const filters = useFilters()
  const [kind, setKind] = useState<Kind>(kindOf(filters.period))
  const [compareKind, setCompareKind] = useState<Kind>(kindOf(filters.period))
  const resolved = useApi<{ current: PeriodInfo; previous: PeriodInfo }>('/periods/resolve', {
    spec: filters.period,
    compare: filters.compare,
  })
  const cur = resolved.data?.current
  const prev = resolved.data?.previous

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover
        align="start"
        trigger={
          <button className="btn gap-2">
            <CalendarDays size={14} />
            <span className="max-w-[260px] truncate">{cur?.label ?? 'Selecionar período'}</span>
            {cur?.partial && (
              <Tooltip content="Período em andamento: recortado na última data com dados. A comparação usa o mesmo número de dias decorridos.">
                <span className="rounded border border-[var(--warning)] px-1 text-[10px]">parcial</span>
              </Tooltip>
            )}
            <ChevronDown size={14} className="opacity-60" />
          </button>
        }
      >
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11px]',
                  kind === k ? 'border-accent bg-accent-soft text-accent-ink' : 'border-edge text-ink-2 hover:bg-surface-2',
                )}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <PeriodList kind={kind} current={filters.period} onPick={(spec) => filters.setPeriod(spec)} />
        </div>
      </Popover>

      <span className="text-xs text-muted">comparar com</span>

      <Popover
        align="start"
        trigger={
          <button className="btn gap-2">
            <GitCompareArrows size={14} />
            <span className="max-w-[240px] truncate">{prev?.label ?? '—'}</span>
            {prev?.aligned && (
              <Tooltip content="Recortado para o mesmo número de dias decorridos do período atual (base equivalente).">
                <span className="rounded border border-[var(--accent)] px-1 text-[10px]">base equivalente</span>
              </Tooltip>
            )}
            <ChevronDown size={14} className="opacity-60" />
          </button>
        }
      >
        <div className="space-y-2">
          <div className="space-y-0.5">
            <button
              onClick={() => filters.setCompare('prev')}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-2',
                filters.compare === 'prev' && 'bg-accent-soft text-accent-ink',
              )}
            >
              Período anterior equivalente
              {filters.compare === 'prev' && <Check size={14} />}
            </button>
            <button
              onClick={() => filters.setCompare('yoy')}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-2',
                filters.compare === 'yoy' && 'bg-accent-soft text-accent-ink',
              )}
            >
              Mesmo período do ano anterior
              {filters.compare === 'yoy' && <Check size={14} />}
            </button>
          </div>
          <div className="border-t border-edge pt-2">
            <p className="mb-1 text-[11px] font-medium text-ink-2">Escolher outro período</p>
            <div className="mb-2 flex flex-wrap gap-1">
              {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setCompareKind(k)}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[11px]',
                    compareKind === k ? 'border-accent bg-accent-soft text-accent-ink' : 'border-edge text-ink-2 hover:bg-surface-2',
                  )}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <PeriodList kind={compareKind} current={filters.compare} onPick={(spec) => filters.setCompare(spec)} />
          </div>
        </div>
      </Popover>

      {cur && (
        <Segmented
          size="sm"
          value=""
          onChange={(v) => filters.setPeriod(v)}
          options={[
            { value: `week:${latestWeek(cur)}`, label: 'Semana', title: 'Semana mais recente com dados' },
            { value: `month:${cur.eff_end.slice(0, 7)}`, label: 'Mês', title: 'Mês do período atual' },
            { value: `year:${cur.eff_end.slice(0, 4)}`, label: 'Ano', title: 'Ano do período atual' },
          ]}
        />
      )}
    </div>
  )
}

function latestWeek(p: PeriodInfo): string {
  const d = new Date(`${p.eff_end}T00:00:00`)
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
