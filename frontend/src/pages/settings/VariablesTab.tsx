/** Cadastro de variáveis (tags de sensor, medidores, apontamentos de produção e condições de processo). */
import { Database, Pencil, Plus, Search } from 'lucide-react'
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
import { AGGREGATION_LABEL, METHOD_LABEL, VARIABLE_TYPE_LABEL } from '../../lib/format'
import { useApi, useMeta } from '../../lib/hooks'
import type { Equipment, Variable } from '../../lib/types'
import { FeedbackBanner, NodeSelect, SettingsNote, TableShell, Toolbar, useFeedback, useSave } from './common'

interface VariableForm {
  code: string
  name: string
  variable_type: string
  unit_id: number
  node_id: number | null
  equipment_id: number | null
  energy_carrier_id: number | null
  data_source_id: number | null
  source_tag: string
  collection_frequency: string
  is_automatic: boolean
  measurement_method: 'measured' | 'estimated' | 'calculated'
  aggregation: string
  counts_toward_total: boolean
  notes: string
}

const FREQUENCIES = ['1min', '15min', '1h', '1d', 'turno', 'lote']

export function VariablesTab() {
  const meta = useMeta()
  const { canEdit } = useAuth()
  const [nodeFilter, setNodeFilter] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const variables = useApi<Variable[]>('/variables', {
    node_id: nodeFilter ?? undefined,
    search: search.trim() || undefined,
  })
  const equipment = useApi<Equipment[]>('/equipment', nodeFilter ? { node_id: nodeFilter } : undefined)
  const fb = useFeedback()
  const [editing, setEditing] = useState<{ id: number | null; form: VariableForm } | null>(null)

  const save = useSave<{ id: number | null; form: VariableForm }>(
    ({ id, form }) => {
      const payload = { ...form, source_tag: form.source_tag || null, notes: form.notes || null }
      return id ? api.put(`/variables/${id}`, payload) : api.post('/variables', payload)
    },
    {
      prefixes: ['/variables', '/nodes', '/indicators'],
      onDone: (_r, vars) => {
        fb.ok(vars.id ? 'Variável atualizada.' : 'Variável cadastrada — já pode ser usada em fórmulas de indicadores.')
        setEditing(null)
      },
      onFail: fb.fail,
    },
  )

  const openNew = () => {
    fb.clear()
    setEditing({
      id: null,
      form: {
        code: '',
        name: '',
        variable_type: 'energy',
        unit_id: meta.data?.units.find((u) => u.symbol === 'kWh')?.id ?? meta.data?.units[0]?.id ?? 0,
        node_id: nodeFilter,
        equipment_id: null,
        energy_carrier_id: null,
        data_source_id: null,
        source_tag: '',
        collection_frequency: '1d',
        is_automatic: true,
        measurement_method: 'measured',
        aggregation: 'sum',
        counts_toward_total: false,
        notes: '',
      },
    })
  }

  const openEdit = (v: Variable) => {
    fb.clear()
    setEditing({
      id: v.id,
      form: {
        code: v.code,
        name: v.name,
        variable_type: v.variable_type,
        unit_id: v.unit_id,
        node_id: v.node?.id ?? null,
        equipment_id: v.equipment?.id ?? null,
        energy_carrier_id: v.carrier?.id ?? null,
        data_source_id: v.data_source?.id ?? null,
        source_tag: v.source_tag ?? '',
        collection_frequency: v.collection_frequency,
        is_automatic: v.is_automatic,
        measurement_method: (v.measurement_method as VariableForm['measurement_method']) ?? 'measured',
        aggregation: v.aggregation,
        counts_toward_total: v.counts_toward_total,
        notes: v.notes ?? '',
      },
    })
  }

  if (variables.error) return <ErrorState error={variables.error} />

  return (
    <Card>
      <CardHeader
        title="Variáveis e tags"
        subtitle="Origem do dado, frequência, unidade e forma de agregação — o que sustenta a qualidade dos indicadores."
        icon={<Database size={15} />}
        actions={
          <Button variant="primary" onClick={openNew} disabled={!canEdit()}>
            <Plus size={14} /> Nova variável
          </Button>
        }
      />
      <FeedbackBanner feedback={fb.feedback} onClose={fb.clear} />
      <Toolbar>
        <div className="w-64">
          <Field label="Processo">
            <NodeSelect value={nodeFilter} onChange={setNodeFilter} allowEmpty />
          </Field>
        </div>
        <div className="w-64">
          <Field label="Buscar">
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
              <Input className="pl-7" placeholder="código, nome ou tag" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </Field>
        </div>
        <span className="pb-1 text-[11px] text-muted">{variables.data?.length ?? 0} variável(is)</span>
      </Toolbar>
      {variables.isPending ? (
        <Spinner />
      ) : variables.data?.length === 0 ? (
        <EmptyState title="Nenhuma variável" description="Ajuste os filtros ou cadastre uma nova tag." />
      ) : (
        <TableShell>
          <thead>
            <tr>
              <th>Código</th>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Unid.</th>
              <th>Equipamento</th>
              <th>Origem</th>
              <th>Freq.</th>
              <th>Agregação</th>
              <th>Método</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {variables.data?.slice(0, 400).map((v) => (
              <tr key={v.id}>
                <td className="font-mono text-[11px]">{v.code}</td>
                <td className="max-w-[280px] truncate font-medium text-ink">{v.name}</td>
                <td className="text-[11px] text-ink-2">{VARIABLE_TYPE_LABEL[v.variable_type] ?? v.variable_type}</td>
                <td className="text-[11px]">{v.unit}</td>
                <td className="text-[11px] text-ink-2">{v.equipment?.tag ?? '—'}</td>
                <td className="text-[11px] text-ink-2">{v.data_source?.name ?? '—'}</td>
                <td className="text-[11px]">{v.collection_frequency}</td>
                <td className="text-[11px]">{AGGREGATION_LABEL[v.aggregation] ?? v.aggregation}</td>
                <td className="text-[11px]">{METHOD_LABEL[v.measurement_method] ?? v.measurement_method}</td>
                <td>
                  <div className="flex justify-end">
                    <Button size="sm" variant="ghost" title="Editar" disabled={!canEdit()} onClick={() => openEdit(v)}>
                      <Pencil size={13} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      <SettingsNote>
        "Entra no total do nó" marca os medidores que compõem o consumo da etapa (CCM, balança de biomassa). Submedições
        de equipamento ficam desmarcadas para não haver dupla contagem — a diferença aparece como "não alocado".
      </SettingsNote>

      {editing && (
        <Dialog
          open
          onOpenChange={(v) => !v && setEditing(null)}
          wide
          title={editing.id ? `Editar ${editing.form.code}` : 'Nova variável'}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>Cancelar</Button>
              <Button
                variant="primary"
                disabled={save.isPending || !editing.form.code || !editing.form.name || !editing.form.unit_id}
                onClick={() => save.mutate(editing)}
              >
                {save.isPending ? 'Salvando…' : 'Salvar'}
              </Button>
            </>
          }
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Código" required hint="Identificador único, ex.: REC-SEC.PROD">
              <Input
                value={editing.form.code}
                disabled={!!editing.id}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, code: e.target.value } })}
              />
            </Field>
            <Field label="Nome" required>
              <Input value={editing.form.name} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, name: e.target.value } })} />
            </Field>
            <Field label="Tipo" required>
              <Select
                value={editing.form.variable_type}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, variable_type: e.target.value } })}
                options={Object.entries(VARIABLE_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field label="Unidade" required>
              <Select
                value={editing.form.unit_id}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, unit_id: Number(e.target.value) } })}
                options={(meta.data?.units ?? []).map((u) => ({ value: u.id, label: `${u.symbol} — ${u.name}` }))}
              />
            </Field>
            <Field label="Nó (processo)">
              <NodeSelect
                value={editing.form.node_id}
                onChange={(v) => setEditing({ ...editing, form: { ...editing.form, node_id: v } })}
                allowEmpty
                emptyLabel="— sem nó —"
              />
            </Field>
            <Field label="Equipamento">
              <Select
                value={editing.form.equipment_id ?? ''}
                onChange={(e) =>
                  setEditing({ ...editing, form: { ...editing.form, equipment_id: e.target.value === '' ? null : Number(e.target.value) } })
                }
                options={[{ value: '', label: '— nível de processo —' }, ...(equipment.data ?? []).map((eq) => ({ value: eq.id, label: `${eq.tag} — ${eq.name}` }))]}
              />
            </Field>
            <Field label="Fonte de energia">
              <Select
                value={editing.form.energy_carrier_id ?? ''}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    form: { ...editing.form, energy_carrier_id: e.target.value === '' ? null : Number(e.target.value) },
                  })
                }
                options={[{ value: '', label: '— não é energia —' }, ...(meta.data?.carriers ?? []).map((c) => ({ value: c.id, label: c.name }))]}
              />
            </Field>
            <Field label="Fonte de dados">
              <Select
                value={editing.form.data_source_id ?? ''}
                onChange={(e) =>
                  setEditing({ ...editing, form: { ...editing.form, data_source_id: e.target.value === '' ? null : Number(e.target.value) } })
                }
                options={[{ value: '', label: '—' }, ...(meta.data?.data_sources ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.kind})` }))]}
              />
            </Field>
            <Field label="Tag de origem" hint="Endereço no historiador/SCADA, ex.: MM-REC-SEC-CCM.kWh">
              <Input
                value={editing.form.source_tag}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, source_tag: e.target.value } })}
              />
            </Field>
            <Field label="Frequência de coleta">
              <Select
                value={editing.form.collection_frequency}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, collection_frequency: e.target.value } })}
                options={FREQUENCIES.map((f) => ({ value: f, label: f }))}
              />
            </Field>
            <Field label="Agregação no período" hint="Energia e produção somam; umidade, pressão e fator de potência usam média.">
              <Select
                value={editing.form.aggregation}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, aggregation: e.target.value } })}
                options={Object.entries(AGGREGATION_LABEL).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field label="Método de medição">
              <Select
                value={editing.form.measurement_method}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    form: { ...editing.form, measurement_method: e.target.value as VariableForm['measurement_method'] },
                  })
                }
                options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <label className="flex items-center gap-2 pt-5 text-xs text-ink-2">
              <input
                type="checkbox"
                checked={editing.form.is_automatic}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, is_automatic: e.target.checked } })}
              />
              Coleta automática
            </label>
            <label className="flex items-center gap-2 pt-5 text-xs text-ink-2">
              <input
                type="checkbox"
                checked={editing.form.counts_toward_total}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, counts_toward_total: e.target.checked } })}
              />
              Entra no total de energia do nó
            </label>
            <div className="md:col-span-2">
              <Field label="Observações">
                <Textarea rows={2} value={editing.form.notes} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, notes: e.target.value } })} />
              </Field>
            </div>
          </div>
        </Dialog>
      )}
    </Card>
  )
}
