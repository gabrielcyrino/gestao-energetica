/** Cadastro/edição de oportunidade — pode nascer de um desvio do dashboard (snapshot anexado). */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { OPPORTUNITY_STATUS, PRIORITY_LABEL, fmtAuto } from '../../lib/format'
import { useMeta } from '../../lib/hooks'
import type { Diagnostic, Opportunity } from '../../lib/types'
import { Button, Dialog, Field, Input, Select, Textarea } from '../ui/primitives'

export function OpportunityDialog({
  open,
  onClose,
  diagnostic,
  opportunity,
}: {
  open: boolean
  onClose: () => void
  diagnostic?: Diagnostic
  opportunity?: Opportunity
}) {
  const meta = useMeta()
  const { user } = useAuth()
  const readOnly = user?.role === 'viewer'
  const qc = useQueryClient()
  const [form, setForm] = useState(() => ({
    title: opportunity?.title ?? (diagnostic ? `Tratar desvio: ${diagnostic.indicator ?? diagnostic.title}` : ''),
    node_id: opportunity?.node_id ?? diagnostic?.node?.id ?? 0,
    use_id: opportunity?.use_id ?? diagnostic?.use?.id ?? null,
    equipment_id: opportunity?.equipment_id ?? diagnostic?.equipment?.id ?? null,
    indicator_id: opportunity?.indicator_id ?? diagnostic?.indicator_id ?? null,
    problem: opportunity?.problem ?? diagnostic?.explanation ?? '',
    opportunity: opportunity?.opportunity ?? '',
    estimated_savings_mwh_year: opportunity?.estimated_savings_mwh_year ?? null,
    estimated_savings_brl_year: opportunity?.estimated_savings_brl_year ?? null,
    estimated_investment_brl: opportunity?.estimated_investment_brl ?? null,
    responsible_id: opportunity?.responsible?.id ?? null,
    priority: opportunity?.priority ?? 'media',
    status: opportunity?.status ?? 'identificada',
    due_date: opportunity?.due_date ?? '',
    notes: opportunity?.notes ?? '',
    reference_consumption: opportunity?.reference_consumption ?? diagnostic?.value ?? null,
    reference_unit: opportunity?.reference_unit ?? diagnostic?.unit ?? null,
  }))
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        due_date: form.due_date || null,
        deviation_snapshot:
          opportunity?.deviation_snapshot ??
          (diagnostic
            ? {
                indicator: diagnostic.indicator,
                value: diagnostic.value,
                unit: diagnostic.unit,
                target: diagnostic.target,
                baseline: diagnostic.baseline,
                deviation_pct: diagnostic.deviation_pct,
                status: diagnostic.status,
                captured_at: new Date().toISOString(),
              }
            : null),
      }
      return opportunity ? api.put(`/opportunities/${opportunity.id}`, payload) : api.post('/opportunities', payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/opportunities'] })
      qc.invalidateQueries({ queryKey: ['/dashboard/overview'] })
      onClose()
    },
    onError: (e: Error) => setError(e.message),
  })

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))
  const canSave = form.title.length > 2 && form.problem.length > 2 && form.opportunity.length > 2 && !!form.node_id

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      wide
      title={opportunity ? `Editar ${opportunity.code}` : 'Registrar oportunidade de melhoria'}
      description={
        diagnostic ? (
          <>
            A partir do desvio de <b>{diagnostic.indicator}</b>
            {diagnostic.value != null && (
              <>
                {' '}
                — valor {fmtAuto(diagnostic.value, diagnostic.decimals)} {diagnostic.unit}
                {diagnostic.target != null && <> contra meta {fmtAuto(diagnostic.target, diagnostic.decimals)}</>}
              </>
            )}
          </>
        ) : undefined
      }
      footer={
        <>
          {error && <span className="mr-auto text-xs text-critical-text">{error}</span>}
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!canSave || save.isPending || readOnly} onClick={() => save.mutate()}>
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Field label="Título" required>
            <Input value={form.title} onChange={(e) => set('title', e.target.value)} />
          </Field>
        </div>
        <Field label="Problema identificado" required>
          <Textarea value={form.problem} onChange={(e) => set('problem', e.target.value)} />
        </Field>
        <Field label="Oportunidade / ação proposta" required>
          <Textarea value={form.opportunity} onChange={(e) => set('opportunity', e.target.value)} />
        </Field>
        <Field label="Economia estimada (MWh/ano)">
          <Input
            type="number"
            value={form.estimated_savings_mwh_year ?? ''}
            onChange={(e) => set('estimated_savings_mwh_year', e.target.value === '' ? null : Number(e.target.value))}
          />
        </Field>
        <Field label="Economia estimada (R$/ano)">
          <Input
            type="number"
            value={form.estimated_savings_brl_year ?? ''}
            onChange={(e) => set('estimated_savings_brl_year', e.target.value === '' ? null : Number(e.target.value))}
          />
        </Field>
        <Field label="Investimento estimado (R$)">
          <Input
            type="number"
            value={form.estimated_investment_brl ?? ''}
            onChange={(e) => set('estimated_investment_brl', e.target.value === '' ? null : Number(e.target.value))}
          />
        </Field>
        <Field label="Prazo">
          <Input type="date" value={form.due_date ?? ''} onChange={(e) => set('due_date', e.target.value)} />
        </Field>
        <Field label="Prioridade">
          <Select
            value={form.priority}
            onChange={(e) => set('priority', e.target.value as typeof form.priority)}
            options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }))}
          />
        </Field>
        <Field label="Status">
          <Select
            value={form.status}
            onChange={(e) => set('status', e.target.value)}
            options={Object.entries(OPPORTUNITY_STATUS).map(([value, label]) => ({ value, label }))}
          />
        </Field>
        <Field label="Responsável">
          <Select
            value={form.responsible_id ?? ''}
            onChange={(e) => set('responsible_id', e.target.value === '' ? null : Number(e.target.value))}
            options={[{ value: '', label: '—' }, ...(meta.data?.people ?? []).map((p) => ({ value: p.id, label: p.name }))]}
          />
        </Field>
        <div className="md:col-span-2">
          <Field label="Observações">
            <Textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} rows={2} />
          </Field>
        </div>
      </div>
    </Dialog>
  )
}
