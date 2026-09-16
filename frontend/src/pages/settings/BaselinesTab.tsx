/** Linhas de base energéticas: consumo esperado = a + Σ b·variável relevante (regressão sobre dias de operação). */
import { LineChart, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import { Button, Card, CardHeader, Dialog, EmptyState, ErrorState, Field, Input, Spinner } from '../../components/ui/primitives'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { fmtAuto, fmtDateFull, fmtPct } from '../../lib/format'
import { useApi } from '../../lib/hooks'
import type { Baseline } from '../../lib/types'
import { FeedbackBanner, SettingsNote, TableShell, useFeedback, useSave } from './common'

export function BaselinesTab() {
  const { user } = useAuth()
  const baselines = useApi<Baseline[]>('/baselines')
  const fb = useFeedback()
  const [fitting, setFitting] = useState<Baseline | null>(null)
  const [range, setRange] = useState<{ start: string; end: string }>({ start: '', end: '' })

  const fit = useSave<{ id: number; start: string; end: string }>(
    ({ id, start, end }) =>
      api.post(`/baselines/${id}/fit`, {
        period_start: start || null,
        period_end: end || null,
      }),
    {
      prefixes: ['/baselines', '/indicators'],
      onDone: () => {
        fb.ok('Modelo reajustado com os dados do período informado.')
        setFitting(null)
      },
      onFail: (m) => fb.fail(m),
    },
  )

  if (baselines.error) return <ErrorState error={baselines.error} />

  return (
    <Card>
      <CardHeader
        title="Linhas de base energéticas"
        subtitle="Comparam o consumo observado com o esperado para as condições do período (produção, água evaporada, vapor…)."
        icon={<LineChart size={15} />}
      />
      <FeedbackBanner feedback={fb.feedback} onClose={fb.clear} />
      {baselines.isPending ? (
        <Spinner />
      ) : baselines.data?.length === 0 ? (
        <EmptyState title="Nenhuma linha de base" description="Modelos de consumo esperado ainda não foram criados." />
      ) : (
        <TableShell>
          <thead>
            <tr>
              <th>Código</th>
              <th>Modelo</th>
              <th>Variável de energia</th>
              <th>Variáveis relevantes</th>
              <th>Período de referência</th>
              <th className="right">R²</th>
              <th className="right">CV(RMSE)</th>
              <th className="right">n</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {baselines.data?.map((b) => {
              const coef = b.model?.coefficients ?? {}
              const details = b.model?.variable_details ?? {}
              const acceptance = b.model?.acceptance
              return (
                <tr key={b.id}>
                  <td className="font-mono text-[11px]">{b.code}</td>
                  <td>
                    <span className="block font-medium text-ink">{b.name}</span>
                    <span className="block font-mono text-[10px] text-muted">
                      esperado = {fmtAuto(b.model?.intercept ?? null, 2)}
                      {Object.entries(coef).map(([s, v]) => ` ${v >= 0 ? '+' : '−'} ${fmtAuto(Math.abs(v), 4)}·${s}`)}
                    </span>
                  </td>
                  <td className="text-[11px] text-ink-2">
                    {b.energy_variable?.name} ({b.energy_variable?.unit})
                  </td>
                  <td className="text-[11px] text-ink-2">
                    {Object.entries(details)
                      .map(([s, d]) => `${s} = ${d.name}`)
                      .join(' · ') || '—'}
                  </td>
                  <td className="text-[11px] text-ink-2">
                    {fmtDateFull(b.period_start)} – {fmtDateFull(b.period_end)}
                  </td>
                  <td className="right num" style={{ color: acceptance?.r2_ok ? 'var(--good-text)' : 'var(--critical-text)' }}>
                    {fmtAuto(b.model?.r2 ?? null, 3)}
                  </td>
                  <td className="right num" style={{ color: acceptance?.cv_rmse_ok ? 'var(--good-text)' : 'var(--critical-text)' }}>
                    {fmtPct(b.model?.cv_rmse_pct ?? null, 1)}
                  </td>
                  <td className="right num">{b.model?.n ?? '—'}</td>
                  <td>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Reajustar modelo"
                        disabled={!user?.can_edit_master_data}
                        onClick={() => {
                          fb.clear()
                          setRange({ start: b.period_start, end: b.period_end })
                          setFitting(b)
                        }}
                      >
                        <RefreshCw size={13} />
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </TableShell>
      )}
      <SettingsNote>
        Critérios de aceitação exibidos como referência (R² ≥ 0,75 e CV(RMSE) ≤ 25% em base diária, adaptados da ASHRAE
        Guideline 14). O ajuste usa apenas dias com operação, evitando que paradas distorçam o modelo.
      </SettingsNote>

      {fitting && (
        <Dialog
          open
          onOpenChange={(v) => !v && setFitting(null)}
          title={`Reajustar ${fitting.code}`}
          description="Escolha o período de referência do novo ajuste (normalmente um Crop Year completo)."
          footer={
            <>
              <Button onClick={() => setFitting(null)}>Cancelar</Button>
              <Button variant="primary" disabled={fit.isPending} onClick={() => fit.mutate({ id: fitting.id, ...range })}>
                {fit.isPending ? 'Ajustando…' : 'Reajustar'}
              </Button>
            </>
          }
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Início">
              <Input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} />
            </Field>
            <Field label="Fim">
              <Input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} />
            </Field>
          </div>
        </Dialog>
      )}
    </Card>
  )
}
