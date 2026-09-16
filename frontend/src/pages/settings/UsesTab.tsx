/** Cadastro dos Usos Significativos de Energia (USEs) por processo/subprocesso. */
import { Network, Pencil, Plus, Trash2 } from 'lucide-react'
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
import { REGIME_LABEL, fmtAuto } from '../../lib/format'
import { useApi, useMeta } from '../../lib/hooks'
import type { Use } from '../../lib/types'
import { ConfirmDialog, FeedbackBanner, NodeSelect, SettingsNote, TableShell, Toolbar, useFeedback, useSave } from './common'

interface UseForm {
  code: string
  name: string
  category_id: number
  node_id: number
  energy_carrier_id: number
  description: string
  operating_regime: 'continuous_24x7' | 'intermittent' | 'batch' | 'seasonal'
  operating_period: string
  significance_reason: string
  responsible_id: number | null
  active: boolean
}

export function UsesTab() {
  const meta = useMeta()
  const { canEdit } = useAuth()
  const [nodeFilter, setNodeFilter] = useState<number | null>(null)
  const uses = useApi<Use[]>('/uses', nodeFilter ? { node_id: nodeFilter } : undefined)
  const fb = useFeedback()
  const [editing, setEditing] = useState<{ id: number | null; form: UseForm } | null>(null)
  const [deleting, setDeleting] = useState<Use | null>(null)

  const save = useSave<{ id: number | null; form: UseForm }>(
    ({ id, form }) => {
      const payload = {
        ...form,
        description: form.description || null,
        operating_period: form.operating_period || null,
        significance_reason: form.significance_reason || null,
      }
      return id ? api.put(`/uses/${id}`, payload) : api.post('/uses', payload)
    },
    {
      prefixes: ['/uses', '/hierarchy', '/nodes', '/matrix'],
      onDone: (_r, vars) => {
        fb.ok(vars.id ? 'USE atualizado.' : 'USE cadastrado e já disponível nas matrizes e páginas de processo.')
        setEditing(null)
      },
      onFail: fb.fail,
    },
  )

  const remove = useSave<number>((id) => api.del(`/uses/${id}`), {
    prefixes: ['/uses', '/hierarchy', '/matrix'],
    onDone: () => {
      fb.ok('USE removido.')
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
        code: '',
        name: '',
        category_id: meta.data?.use_categories[0]?.id ?? 0,
        node_id: nodeFilter ?? 0,
        energy_carrier_id: meta.data?.carriers[0]?.id ?? 0,
        description: '',
        operating_regime: 'intermittent',
        operating_period: '',
        significance_reason: '',
        responsible_id: null,
        active: true,
      },
    })
  }

  const openEdit = (u: Use) => {
    fb.clear()
    setEditing({
      id: u.id,
      form: {
        code: u.code,
        name: u.name,
        category_id: u.category?.id ?? 0,
        node_id: u.node?.id ?? 0,
        energy_carrier_id: u.carrier?.id ?? 0,
        description: u.description ?? '',
        operating_regime: (u.operating_regime as UseForm['operating_regime']) ?? 'intermittent',
        operating_period: u.operating_period ?? '',
        significance_reason: u.significance_reason ?? '',
        responsible_id: u.responsible?.id ?? null,
        active: u.active,
      },
    })
  }

  if (uses.error) return <ErrorState error={uses.error} />

  return (
    <Card>
      <CardHeader
        title="Usos Significativos de Energia"
        subtitle="O USE conecta a categoria de uso final ao processo onde ele acontece — é a espinha dorsal da metodologia."
        icon={<Network size={15} />}
        actions={
          <Button variant="primary" onClick={openNew} disabled={!canEdit()}>
            <Plus size={14} /> Novo USE
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
        <span className="pb-1 text-[11px] text-muted">{uses.data?.length ?? 0} USE(s)</span>
      </Toolbar>
      {uses.isPending ? (
        <Spinner />
      ) : uses.data?.length === 0 ? (
        <EmptyState title="Nenhum USE cadastrado" description="Cadastre os usos significativos identificados no levantamento." />
      ) : (
        <TableShell>
          <thead>
            <tr>
              <th>USE</th>
              <th>Categoria</th>
              <th>Processo</th>
              <th>Fonte</th>
              <th>Regime</th>
              <th className="right">Potência inst. (kW)</th>
              <th className="right">Equip.</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {uses.data?.map((u) => (
              <tr key={u.id}>
                <td>
                  <span className="block font-medium text-ink">{u.name}</span>
                  <span className="block font-mono text-[11px] text-muted">{u.code}</span>
                </td>
                <td className="text-[12px] text-ink-2">{u.category?.name}</td>
                <td className="text-[12px] text-ink-2">{u.node?.name}</td>
                <td className="text-[12px] text-ink-2">{u.carrier?.name}</td>
                <td className="text-[11px] text-ink-2">{REGIME_LABEL[u.operating_regime] ?? u.operating_regime}</td>
                <td className="right num">{fmtAuto(u.installed_power_kw, 1)}</td>
                <td className="right num">{u.equipment_count}</td>
                <td>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" title="Editar" disabled={!canEdit()} onClick={() => openEdit(u)}>
                      <Pencil size={13} />
                    </Button>
                    <Button size="sm" variant="ghost" title="Excluir" disabled={!canEdit()} onClick={() => setDeleting(u)}>
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
        Cada USE reúne os equipamentos de mesma finalidade dentro de uma etapa. A lista de categorias é configurável na aba
        Catálogos — nada é fixo no código.
      </SettingsNote>

      {editing && (
        <Dialog
          open
          onOpenChange={(v) => !v && setEditing(null)}
          wide
          title={editing.id ? `Editar ${editing.form.name}` : 'Novo USE'}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>Cancelar</Button>
              <Button
                variant="primary"
                disabled={save.isPending || !editing.form.name || !editing.form.code || !editing.form.node_id}
                onClick={() => save.mutate(editing)}
              >
                {save.isPending ? 'Salvando…' : 'Salvar'}
              </Button>
            </>
          }
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Nome" required>
              <Input value={editing.form.name} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, name: e.target.value } })} />
            </Field>
            <Field label="Código" required>
              <Input
                value={editing.form.code}
                disabled={!!editing.id}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, code: e.target.value.toUpperCase() } })}
              />
            </Field>
            <Field label="Categoria" required>
              <Select
                value={editing.form.category_id}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, category_id: Number(e.target.value) } })}
                options={(meta.data?.use_categories ?? []).map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
            <Field label="Processo / subprocesso" required>
              <NodeSelect
                value={editing.form.node_id || null}
                onChange={(v) => setEditing({ ...editing, form: { ...editing.form, node_id: v ?? 0 } })}
                levels={['process', 'subprocess']}
              />
            </Field>
            <Field label="Fonte de energia" required>
              <Select
                value={editing.form.energy_carrier_id}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, energy_carrier_id: Number(e.target.value) } })}
                options={(meta.data?.carriers ?? []).map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
            <Field label="Regime operacional">
              <Select
                value={editing.form.operating_regime}
                onChange={(e) =>
                  setEditing({ ...editing, form: { ...editing.form, operating_regime: e.target.value as UseForm['operating_regime'] } })
                }
                options={Object.entries(REGIME_LABEL).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field label="Período de operação" hint="Ex.: 24 h/dia durante a safra; 3 turnos seg–sáb.">
              <Input
                value={editing.form.operating_period}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, operating_period: e.target.value } })}
              />
            </Field>
            <Field label="Responsável">
              <Select
                value={editing.form.responsible_id ?? ''}
                onChange={(e) =>
                  setEditing({ ...editing, form: { ...editing.form, responsible_id: e.target.value === '' ? null : Number(e.target.value) } })
                }
                options={[{ value: '', label: '—' }, ...(meta.data?.people ?? []).map((p) => ({ value: p.id, label: p.name }))]}
              />
            </Field>
            <div className="md:col-span-2">
              <Field label="Justificativa de significância" hint="Por que este uso é significativo: participação no consumo, potencial de melhoria…">
                <Textarea
                  rows={2}
                  value={editing.form.significance_reason}
                  onChange={(e) => setEditing({ ...editing, form: { ...editing.form, significance_reason: e.target.value } })}
                />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Descrição">
                <Textarea
                  rows={2}
                  value={editing.form.description}
                  onChange={(e) => setEditing({ ...editing, form: { ...editing.form, description: e.target.value } })}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-xs text-ink-2">
              <input
                type="checkbox"
                checked={editing.form.active}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, active: e.target.checked } })}
              />
              Ativo
            </label>
          </div>
        </Dialog>
      )}

      <ConfirmDialog
        open={!!deleting}
        title={`Excluir USE "${deleting?.name}"?`}
        description="Só é possível excluir USEs sem equipamentos vinculados."
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </Card>
  )
}
