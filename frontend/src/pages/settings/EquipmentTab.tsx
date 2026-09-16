/** Cadastro de equipamentos e seus dados de placa (base dos indicadores intrínsecos). */
import { Cog, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import {
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from '../../components/ui/primitives'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { fmtAuto } from '../../lib/format'
import { useApi } from '../../lib/hooks'
import type { Equipment, Use } from '../../lib/types'
import { ConfirmDialog, FeedbackBanner, NodeSelect, SettingsNote, TableShell, Toolbar, useFeedback, useSave } from './common'

interface EquipmentForm {
  tag: string
  name: string
  use_id: number
  equipment_type: string
  manufacturer: string
  model: string
  rated_power_kw: number | null
  rated_efficiency_pct: number | null
  efficiency_class: string
  has_vfd: boolean
  commissioning_year: number | null
  attributes: string
  active: boolean
}

export function EquipmentTab() {
  const { canEdit } = useAuth()
  const [nodeFilter, setNodeFilter] = useState<number | null>(null)
  const equipment = useApi<Equipment[]>('/equipment', nodeFilter ? { node_id: nodeFilter } : undefined)
  const uses = useApi<Use[]>('/uses', nodeFilter ? { node_id: nodeFilter } : undefined)
  const fb = useFeedback()
  const [editing, setEditing] = useState<{ id: number | null; form: EquipmentForm } | null>(null)
  const [deleting, setDeleting] = useState<Equipment | null>(null)
  const [jsonError, setJsonError] = useState<string | null>(null)

  const save = useSave<{ id: number | null; form: EquipmentForm }>(
    ({ id, form }) => {
      const payload = {
        ...form,
        manufacturer: form.manufacturer || null,
        model: form.model || null,
        efficiency_class: form.efficiency_class || null,
        attributes: form.attributes.trim() ? JSON.parse(form.attributes) : {},
      }
      return id ? api.put(`/equipment/${id}`, payload) : api.post('/equipment', payload)
    },
    {
      prefixes: ['/equipment', '/uses', '/hierarchy'],
      onDone: (_r, vars) => {
        fb.ok(vars.id ? 'Equipamento atualizado.' : 'Equipamento cadastrado.')
        setEditing(null)
      },
      onFail: fb.fail,
    },
  )

  const remove = useSave<number>((id) => api.del(`/equipment/${id}`), {
    prefixes: ['/equipment', '/uses'],
    onDone: () => {
      fb.ok('Equipamento removido.')
      setDeleting(null)
    },
    onFail: (m) => {
      fb.fail(m)
      setDeleting(null)
    },
  })

  const openNew = () => {
    fb.clear()
    setEditing({
      id: null,
      form: {
        tag: '',
        name: '',
        use_id: uses.data?.[0]?.id ?? 0,
        equipment_type: '',
        manufacturer: '',
        model: '',
        rated_power_kw: null,
        rated_efficiency_pct: null,
        efficiency_class: '',
        has_vfd: false,
        commissioning_year: null,
        attributes: '{}',
        active: true,
      },
    })
  }

  const openEdit = (e: Equipment) => {
    fb.clear()
    setJsonError(null)
    setEditing({
      id: e.id,
      form: {
        tag: e.tag,
        name: e.name,
        use_id: e.use?.id ?? 0,
        equipment_type: e.equipment_type,
        manufacturer: e.manufacturer ?? '',
        model: e.model ?? '',
        rated_power_kw: e.rated_power_kw,
        rated_efficiency_pct: e.rated_efficiency_pct,
        efficiency_class: e.efficiency_class ?? '',
        has_vfd: e.has_vfd,
        commissioning_year: e.commissioning_year,
        attributes: JSON.stringify(e.attributes ?? {}, null, 2),
        active: e.active,
      },
    })
  }

  const validateJson = (text: string) => {
    if (!text.trim()) return setJsonError(null)
    try {
      const parsed = JSON.parse(text)
      setJsonError(typeof parsed === 'object' && !Array.isArray(parsed) ? null : 'Informe um objeto JSON.')
    } catch {
      setJsonError('JSON inválido.')
    }
  }

  if (equipment.error) return <ErrorState error={equipment.error} />

  return (
    <Card>
      <CardHeader
        title="Equipamentos"
        subtitle="Dados de placa alimentam indicadores intrínsecos (fator de carga usa potência nominal e rendimento)."
        icon={<Cog size={15} />}
        actions={
          <Button variant="primary" onClick={openNew} disabled={!canEdit()}>
            <Plus size={14} /> Novo equipamento
          </Button>
        }
      />
      <FeedbackBanner feedback={fb.feedback} onClose={fb.clear} />
      <Toolbar>
        <div className="w-72">
          <Field label="Filtrar por processo">
            <NodeSelect value={nodeFilter} onChange={setNodeFilter} allowEmpty />
          </Field>
        </div>
        <span className="pb-1 text-[11px] text-muted">{equipment.data?.length ?? 0} equipamento(s)</span>
      </Toolbar>
      {equipment.isPending ? (
        <Spinner />
      ) : equipment.data?.length === 0 ? (
        <EmptyState title="Nenhum equipamento" description="Cadastre os equipamentos de cada USE." />
      ) : (
        <TableShell>
          <thead>
            <tr>
              <th>TAG</th>
              <th>Equipamento</th>
              <th>USE</th>
              <th>Tipo</th>
              <th className="right">Pot. (kW)</th>
              <th className="right">η (%)</th>
              <th>Classe</th>
              <th>Inversor</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {equipment.data?.map((e) => (
              <tr key={e.id}>
                <td className="font-mono text-[11px]">{e.tag}</td>
                <td className="font-medium text-ink">{e.name}</td>
                <td className="text-[12px] text-ink-2">{e.use?.name}</td>
                <td className="text-[11px] text-ink-2">{e.equipment_type}</td>
                <td className="right num">{fmtAuto(e.rated_power_kw, 1)}</td>
                <td className="right num">{fmtAuto(e.rated_efficiency_pct, 1)}</td>
                <td className="text-[11px]">{e.efficiency_class ?? '—'}</td>
                <td className="text-[11px]">{e.has_vfd ? 'Sim' : 'Não'}</td>
                <td>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" title="Editar" disabled={!canEdit()} onClick={() => openEdit(e)}>
                      <Pencil size={13} />
                    </Button>
                    <Button size="sm" variant="ghost" title="Excluir" disabled={!canEdit()} onClick={() => setDeleting(e)}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      <SettingsNote>
        Atributos livres (JSON) guardam dados específicos do tipo: corrente nominal, capacidade em t/h, pressão, vazão.
        Eles podem ser referenciados nas fórmulas dos indicadores como "atributo do equipamento".
      </SettingsNote>

      {editing && (
        <Dialog
          open
          onOpenChange={(v) => !v && setEditing(null)}
          wide
          title={editing.id ? `Editar ${editing.form.tag}` : 'Novo equipamento'}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>Cancelar</Button>
              <Button
                variant="primary"
                disabled={save.isPending || !!jsonError || !editing.form.tag || !editing.form.name || !editing.form.use_id}
                onClick={() => save.mutate(editing)}
              >
                {save.isPending ? 'Salvando…' : 'Salvar'}
              </Button>
            </>
          }
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="TAG" required>
              <Input
                value={editing.form.tag}
                disabled={!!editing.id}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, tag: e.target.value.toUpperCase() } })}
              />
            </Field>
            <Field label="Nome" required>
              <Input value={editing.form.name} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, name: e.target.value } })} />
            </Field>
            <Field label="USE" required>
              <Select
                value={editing.form.use_id}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, use_id: Number(e.target.value) } })}
                options={(uses.data ?? []).map((u) => ({ value: u.id, label: `${u.name} — ${u.node?.name ?? ''}` }))}
              />
            </Field>
            <Field label="Tipo" required hint="Ex.: Motor de indução trifásico, Ventilador centrífugo, Caldeira a biomassa.">
              <Input
                value={editing.form.equipment_type}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, equipment_type: e.target.value } })}
              />
            </Field>
            <Field label="Fabricante">
              <Input
                value={editing.form.manufacturer}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, manufacturer: e.target.value } })}
              />
            </Field>
            <Field label="Modelo">
              <Input value={editing.form.model} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, model: e.target.value } })} />
            </Field>
            <Field label="Potência nominal (kW)">
              <Input
                type="number"
                step="0.1"
                value={editing.form.rated_power_kw ?? ''}
                onChange={(e) =>
                  setEditing({ ...editing, form: { ...editing.form, rated_power_kw: e.target.value === '' ? null : Number(e.target.value) } })
                }
              />
            </Field>
            <Field label="Rendimento nominal (%)">
              <Input
                type="number"
                step="0.1"
                value={editing.form.rated_efficiency_pct ?? ''}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    form: { ...editing.form, rated_efficiency_pct: e.target.value === '' ? null : Number(e.target.value) },
                  })
                }
              />
            </Field>
            <Field label="Classe de rendimento" hint="IE2, IE3, IE4…">
              <Input
                value={editing.form.efficiency_class}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, efficiency_class: e.target.value } })}
              />
            </Field>
            <Field label="Ano de comissionamento">
              <Input
                type="number"
                value={editing.form.commissioning_year ?? ''}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    form: { ...editing.form, commissioning_year: e.target.value === '' ? null : Number(e.target.value) },
                  })
                }
              />
            </Field>
            <label className="flex items-center gap-2 pt-5 text-xs text-ink-2">
              <input
                type="checkbox"
                checked={editing.form.has_vfd}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, has_vfd: e.target.checked } })}
              />
              Possui inversor de frequência
            </label>
            <label className="flex items-center gap-2 pt-5 text-xs text-ink-2">
              <input
                type="checkbox"
                checked={editing.form.active}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, active: e.target.checked } })}
              />
              Ativo
            </label>
            <div className="md:col-span-2">
              <Field label="Atributos (JSON)" hint={jsonError ?? 'Ex.: {"corrente_nominal_a": 150, "tensao_nominal_v": 380}'}>
                <Textarea
                  rows={4}
                  className="font-mono text-[11px]"
                  value={editing.form.attributes}
                  onChange={(e) => {
                    setEditing({ ...editing, form: { ...editing.form, attributes: e.target.value } })
                    validateJson(e.target.value)
                  }}
                />
              </Field>
            </div>
          </div>
        </Dialog>
      )}

      <ConfirmDialog
        open={!!deleting}
        title={`Excluir equipamento "${deleting?.tag}"?`}
        description="Equipamentos com indicadores vinculados não podem ser excluídos."
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </Card>
  )
}
