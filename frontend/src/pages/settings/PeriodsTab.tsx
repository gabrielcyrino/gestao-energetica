/** Crop Years e safras: entidades com data inicial e final — nada assume o ano civil. */
import { CalendarRange, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { Button, Card, CardHeader, Dialog, EmptyState, ErrorState, Field, Input, Select, Spinner, Textarea } from '../../components/ui/primitives'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { fmtDateFull } from '../../lib/format'
import { useApi } from '../../lib/hooks'
import { ConfirmDialog, FeedbackBanner, SettingsNote, TableShell, useFeedback, useSave } from './common'

interface CropYear {
  id: number
  code: string
  name: string
  start_date: string
  end_date: string
  notes: string | null
}

interface Season extends CropYear {
  season_type: string
  crop_year_id: number | null
}

type Kind = 'crop-years' | 'seasons'

interface RangeForm {
  code: string
  name: string
  start_date: string
  end_date: string
  season_type: string
  crop_year_id: number | null
  notes: string
}

const SEASON_TYPES = ['verao', 'safrinha', 'inverno', 'entressafra']

export function PeriodsTab() {
  const { user } = useAuth()
  const crops = useApi<CropYear[]>('/periods/crop-years')
  const seasons = useApi<Season[]>('/periods/seasons')
  const fb = useFeedback()
  const [editing, setEditing] = useState<{ kind: Kind; id: number | null; form: RangeForm } | null>(null)
  const [deleting, setDeleting] = useState<{ kind: Kind; id: number; name: string } | null>(null)
  const canEditAll = !!user?.can_edit_master_data

  const save = useSave<{ kind: Kind; id: number | null; form: RangeForm }>(
    ({ kind, id, form }) => {
      const base = {
        code: form.code,
        name: form.name,
        start_date: form.start_date,
        end_date: form.end_date,
        notes: form.notes || null,
      }
      const payload = kind === 'seasons' ? { ...base, season_type: form.season_type, crop_year_id: form.crop_year_id } : base
      return id ? api.put(`/periods/${kind}/${id}`, payload) : api.post(`/periods/${kind}`, payload)
    },
    {
      prefixes: ['/periods', '/meta', '/dashboard', '/compare'],
      onDone: (_r, vars) => {
        fb.ok(
          vars.id
            ? 'Período atualizado — os seletores de comparação já refletem as novas datas.'
            : 'Período criado e disponível no filtro global (Crop Year × Crop Year, safra × safra).',
        )
        setEditing(null)
      },
      onFail: fb.fail,
    },
  )

  const remove = useSave<{ kind: Kind; id: number }>(({ kind, id }) => api.del(`/periods/${kind}/${id}`), {
    prefixes: ['/periods', '/meta'],
    onDone: () => {
      fb.ok('Período removido.')
      setDeleting(null)
    },
    onFail: (m) => {
      fb.fail(m)
      setDeleting(null)
    },
  })

  const openNew = (kind: Kind) => {
    fb.clear()
    setEditing({
      kind,
      id: null,
      form: {
        code: '',
        name: '',
        start_date: '',
        end_date: '',
        season_type: 'verao',
        crop_year_id: crops.data?.[crops.data.length - 1]?.id ?? null,
        notes: '',
      },
    })
  }

  const openEdit = (kind: Kind, item: CropYear | Season) => {
    fb.clear()
    setEditing({
      kind,
      id: item.id,
      form: {
        code: item.code,
        name: item.name,
        start_date: item.start_date,
        end_date: item.end_date,
        season_type: (item as Season).season_type ?? 'verao',
        crop_year_id: (item as Season).crop_year_id ?? null,
        notes: item.notes ?? '',
      },
    })
  }

  if (crops.error) return <ErrorState error={crops.error} />

  const renderTable = (kind: Kind, rows: (CropYear | Season)[] | undefined, pending: boolean) => (
    <TableShell maxHeight={300}>
      <thead>
        <tr>
          <th>Código</th>
          <th>Nome</th>
          {kind === 'seasons' && <th>Tipo</th>}
          <th>Início</th>
          <th>Fim</th>
          <th>Observações</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {pending ? (
          <tr>
            <td colSpan={7}>
              <Spinner />
            </td>
          </tr>
        ) : (
          rows?.map((r) => (
            <tr key={r.id}>
              <td className="font-mono text-[11px]">{r.code}</td>
              <td className="font-medium text-ink">{r.name}</td>
              {kind === 'seasons' && <td className="text-[11px] text-ink-2">{(r as Season).season_type}</td>}
              <td className="text-[12px]">{fmtDateFull(r.start_date)}</td>
              <td className="text-[12px]">{fmtDateFull(r.end_date)}</td>
              <td className="max-w-[260px] truncate text-[11px] text-muted">{r.notes ?? '—'}</td>
              <td>
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" title="Editar" disabled={!canEditAll} onClick={() => openEdit(kind, r)}>
                    <Pencil size={13} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Excluir"
                    disabled={!canEditAll}
                    onClick={() => setDeleting({ kind, id: r.id, name: r.name })}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </TableShell>
  )

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Crop Years"
          subtitle="Ciclo agrícola com data inicial e final próprias — não precisa coincidir com o ano civil."
          icon={<CalendarRange size={15} />}
          actions={
            <Button variant="primary" disabled={!canEditAll} onClick={() => openNew('crop-years')}>
              <Plus size={14} /> Novo Crop Year
            </Button>
          }
        />
        <FeedbackBanner feedback={fb.feedback} onClose={fb.clear} />
        {crops.data?.length === 0 && !crops.isPending ? (
          <EmptyState title="Nenhum Crop Year cadastrado" />
        ) : (
          renderTable('crop-years', crops.data, crops.isPending)
        )}
      </Card>

      <Card>
        <CardHeader
          title="Safras"
          subtitle="Janelas de safra (verão, safrinha…). A comparação 'safra × safra' usa sempre a safra anterior do mesmo tipo."
          icon={<CalendarRange size={15} />}
          actions={
            <Button variant="primary" disabled={!canEditAll} onClick={() => openNew('seasons')}>
              <Plus size={14} /> Nova safra
            </Button>
          }
        />
        {seasons.data?.length === 0 && !seasons.isPending ? <EmptyState title="Nenhuma safra cadastrada" /> : renderTable('seasons', seasons.data, seasons.isPending)}
        <SettingsNote>
          Estas datas alimentam o seletor global de períodos e as metas por janela de safra: uma safrinha de baixo volume
          é comparada com a safrinha anterior, não com a média do ano.
        </SettingsNote>
      </Card>

      {editing && (
        <Dialog
          open
          onOpenChange={(v) => !v && setEditing(null)}
          title={editing.id ? `Editar ${editing.form.name}` : editing.kind === 'seasons' ? 'Nova safra' : 'Novo Crop Year'}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>Cancelar</Button>
              <Button
                variant="primary"
                disabled={
                  save.isPending ||
                  !editing.form.code ||
                  !editing.form.name ||
                  !editing.form.start_date ||
                  !editing.form.end_date ||
                  editing.form.end_date < editing.form.start_date
                }
                onClick={() => save.mutate(editing)}
              >
                {save.isPending ? 'Salvando…' : 'Salvar'}
              </Button>
            </>
          }
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Código" required hint="Ex.: CY2027, SV2027">
              <Input value={editing.form.code} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, code: e.target.value.toUpperCase() } })} />
            </Field>
            <Field label="Nome" required>
              <Input value={editing.form.name} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, name: e.target.value } })} />
            </Field>
            <Field label="Data inicial" required>
              <Input
                type="date"
                value={editing.form.start_date}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, start_date: e.target.value } })}
              />
            </Field>
            <Field label="Data final" required>
              <Input
                type="date"
                value={editing.form.end_date}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, end_date: e.target.value } })}
              />
            </Field>
            {editing.kind === 'seasons' && (
              <>
                <Field label="Tipo de safra" required>
                  <Select
                    value={editing.form.season_type}
                    onChange={(e) => setEditing({ ...editing, form: { ...editing.form, season_type: e.target.value } })}
                    options={SEASON_TYPES.map((s) => ({ value: s, label: s }))}
                  />
                </Field>
                <Field label="Crop Year">
                  <Select
                    value={editing.form.crop_year_id ?? ''}
                    onChange={(e) =>
                      setEditing({ ...editing, form: { ...editing.form, crop_year_id: e.target.value === '' ? null : Number(e.target.value) } })
                    }
                    options={[{ value: '', label: '—' }, ...(crops.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
                  />
                </Field>
              </>
            )}
            <div className="md:col-span-2">
              <Field label="Observações">
                <Textarea rows={2} value={editing.form.notes} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, notes: e.target.value } })} />
              </Field>
            </div>
          </div>
        </Dialog>
      )}

      <ConfirmDialog
        open={!!deleting}
        title={`Excluir "${deleting?.name}"?`}
        description="Comparações que usam este período deixarão de funcionar até que outro seja selecionado."
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate({ kind: deleting.kind, id: deleting.id })}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
