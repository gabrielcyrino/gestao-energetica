/** Catálogos configuráveis: unidades, fontes de energia, categorias de USE, fontes de dados,
 *  responsáveis, templates de indicador e níveis da hierarquia. */
import { BookOpen, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'

import { Button, Card, CardHeader, Dialog, EmptyState, ErrorState, Field, Input, Select, Spinner, Textarea } from '../../components/ui/primitives'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useApi } from '../../lib/hooks'
import { FeedbackBanner, SettingsNote, TableShell, Toolbar, useFeedback, useSave } from './common'

type FieldType = 'text' | 'number' | 'boolean' | 'textarea' | 'json'

interface CatalogField {
  key: string
  label: string
  type: FieldType
  required?: boolean
  hint?: string
}

interface CatalogDef {
  label: string
  description: string
  fields: CatalogField[]
  columns: string[]
}

type Row = Record<string, unknown>

const CATALOGS: Record<string, CatalogDef> = {
  units: {
    label: 'Unidades',
    description: 'Conversões só acontecem entre unidades da mesma grandeza (energia, massa, tempo…).',
    fields: [
      { key: 'symbol', label: 'Símbolo', type: 'text', required: true },
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'quantity', label: 'Grandeza', type: 'text', required: true, hint: 'energy, mass, time, power, ratio, specific_energy…' },
      { key: 'factor_to_base', label: 'Fator para a base', type: 'number', required: true },
      { key: 'offset_to_base', label: 'Offset para a base', type: 'number' },
    ],
    columns: ['symbol', 'name', 'quantity', 'factor_to_base'],
  },
  'energy-carriers': {
    label: 'Fontes de energia',
    description: 'kind=boundary entra no total da planta; internal é energia secundária (vapor, ar comprimido).',
    fields: [
      { key: 'code', label: 'Código', type: 'text', required: true },
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'kind', label: 'Tipo (boundary/internal)', type: 'text', required: true },
      { key: 'unit_id', label: 'ID da unidade física', type: 'number', required: true },
      { key: 'kwh_per_unit', label: 'kWh por unidade', type: 'number', required: true, hint: 'Ex.: biomassa 11 GJ/t ≈ 3055,6 kWh/t' },
      { key: 'color_slot', label: 'Cor (1–8)', type: 'number' },
      { key: 'description', label: 'Descrição', type: 'textarea' },
    ],
    columns: ['code', 'name', 'kind', 'kwh_per_unit', 'color_slot'],
  },
  'use-categories': {
    label: 'Categorias de USE',
    description: 'Colunas da matriz Processo × USE.',
    fields: [
      { key: 'code', label: 'Código', type: 'text', required: true },
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'icon', label: 'Ícone', type: 'text' },
      { key: 'color_slot', label: 'Cor (1–8)', type: 'number' },
      { key: 'sort_order', label: 'Ordem', type: 'number' },
      { key: 'description', label: 'Descrição', type: 'textarea' },
    ],
    columns: ['code', 'name', 'color_slot', 'sort_order'],
  },
  'data-sources': {
    label: 'Fontes de dados',
    description: 'Historiador, medidores, MES, laboratório, cálculos — base da rastreabilidade do dado.',
    fields: [
      { key: 'code', label: 'Código', type: 'text', required: true },
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'kind', label: 'Tipo', type: 'text', required: true, hint: 'historian, meter, mes, manual, calculated…' },
      { key: 'protocol', label: 'Protocolo', type: 'text', hint: 'OPC UA, Modbus TCP, REST, CSV…' },
      { key: 'is_automatic', label: 'Coleta automática', type: 'boolean' },
      { key: 'description', label: 'Descrição', type: 'textarea' },
    ],
    columns: ['code', 'name', 'kind', 'protocol', 'is_automatic'],
  },
  people: {
    label: 'Responsáveis',
    description: 'Donos de processo e gestão de energia vinculados a nós, USEs, indicadores e oportunidades.',
    fields: [
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'role_title', label: 'Função', type: 'text' },
      { key: 'email', label: 'E-mail', type: 'text' },
    ],
    columns: ['name', 'role_title', 'email'],
  },
  'indicator-templates': {
    label: 'Templates de indicador',
    description: 'Catálogo de referência (planilha USE × indicadores) usado para instanciar IDEs padronizados.',
    fields: [
      { key: 'code', label: 'Código', type: 'text', required: true },
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'kind', label: 'Tipo', type: 'text', required: true, hint: 'intrinsic | extrinsic' },
      { key: 'formula', label: 'Fórmula', type: 'text', required: true },
      { key: 'unit_symbol', label: 'Unidade', type: 'text', required: true },
      { key: 'direction', label: 'Direção', type: 'text' },
      { key: 'use_category_id', label: 'ID da categoria de USE', type: 'number' },
      { key: 'symbols', label: 'Símbolos (JSON)', type: 'json' },
      { key: 'description', label: 'Descrição', type: 'textarea' },
    ],
    columns: ['code', 'name', 'kind', 'formula', 'unit_symbol'],
  },
  'hierarchy-levels': {
    label: 'Níveis da hierarquia',
    description: 'Empresa, planta, área, processo, subprocesso — a estrutura é configurável.',
    fields: [
      { key: 'code', label: 'Código', type: 'text', required: true },
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'depth', label: 'Profundidade', type: 'number', required: true },
      { key: 'has_flow', label: 'Possui fluxograma', type: 'boolean' },
      { key: 'allows_uses', label: 'Aceita USEs', type: 'boolean' },
    ],
    columns: ['code', 'name', 'depth', 'has_flow', 'allows_uses'],
  },
}

export function CatalogsTab() {
  const { user } = useAuth()
  const [catalog, setCatalog] = useState<string>('units')
  const def = CATALOGS[catalog]
  const rows = useApi<Row[]>(`/catalogs/${catalog}`)
  const fb = useFeedback()
  const [editing, setEditing] = useState<{ id: string | null; values: Record<string, string> } | null>(null)
  const canEditAll = !!user?.can_edit_master_data

  const save = useSave<{ id: string | null; values: Record<string, string> }>(
    ({ id, values }) => {
      const payload: Row = {}
      def.fields.forEach((f) => {
        const raw = values[f.key]
        if (raw === undefined || raw === '') {
          if (f.type === 'boolean') payload[f.key] = false
          return
        }
        if (f.type === 'number') payload[f.key] = Number(raw)
        else if (f.type === 'boolean') payload[f.key] = raw === 'true'
        else if (f.type === 'json') payload[f.key] = JSON.parse(raw)
        else payload[f.key] = raw
      })
      return id ? api.put(`/catalogs/${catalog}/${id}`, payload) : api.post(`/catalogs/${catalog}`, payload)
    },
    {
      prefixes: ['/catalogs', '/meta'],
      onDone: (_r, vars) => {
        fb.ok(vars.id ? 'Registro atualizado.' : 'Registro criado.')
        setEditing(null)
      },
      onFail: fb.fail,
    },
  )

  const openNew = () => {
    fb.clear()
    setEditing({ id: null, values: Object.fromEntries(def.fields.map((f) => [f.key, f.type === 'boolean' ? 'false' : ''])) })
  }

  const openEdit = (row: Row) => {
    fb.clear()
    const id = String(row.id ?? row.code ?? '')
    setEditing({
      id,
      values: Object.fromEntries(
        def.fields.map((f) => {
          const v = row[f.key]
          if (v === null || v === undefined) return [f.key, '']
          if (f.type === 'json') return [f.key, JSON.stringify(v, null, 2)]
          return [f.key, String(v)]
        }),
      ),
    })
  }

  if (rows.error) return <ErrorState error={rows.error} />

  return (
    <Card>
      <CardHeader
        title="Catálogos"
        subtitle="Listas de apoio usadas por toda a aplicação — configuráveis, sem alteração de código."
        icon={<BookOpen size={15} />}
        actions={
          <Button variant="primary" disabled={!canEditAll} onClick={openNew}>
            <Plus size={14} /> Novo registro
          </Button>
        }
      />
      <FeedbackBanner feedback={fb.feedback} onClose={fb.clear} />
      <Toolbar>
        <div className="w-72">
          <Field label="Catálogo">
            <Select
              value={catalog}
              onChange={(e) => setCatalog(e.target.value)}
              options={Object.entries(CATALOGS).map(([value, d]) => ({ value, label: d.label }))}
            />
          </Field>
        </div>
        <p className="pb-1 text-[11px] text-muted">{def.description}</p>
      </Toolbar>
      {rows.isPending ? (
        <Spinner />
      ) : rows.data?.length === 0 ? (
        <EmptyState title="Catálogo vazio" />
      ) : (
        <TableShell>
          <thead>
            <tr>
              {def.columns.map((c) => (
                <th key={c}>{def.fields.find((f) => f.key === c)?.label ?? c}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.data?.map((row, i) => (
              <tr key={String(row.id ?? row.code ?? i)}>
                {def.columns.map((c) => (
                  <td key={c} className="text-[12px] text-ink-2">
                    {typeof row[c] === 'boolean' ? (row[c] ? 'Sim' : 'Não') : String(row[c] ?? '—')}
                  </td>
                ))}
                <td>
                  <div className="flex justify-end">
                    <Button size="sm" variant="ghost" title="Editar" disabled={!canEditAll} onClick={() => openEdit(row)}>
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
        Ao criar uma nova fonte de energia informe o conteúdo energético (kWh por unidade física): é ele que permite somar
        eletricidade, biomassa e vapor em uma unidade comum sem dupla contagem.
      </SettingsNote>

      {editing && (
        <Dialog
          open
          onOpenChange={(v) => !v && setEditing(null)}
          title={editing.id ? `Editar ${def.label}` : `Novo registro — ${def.label}`}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>Cancelar</Button>
              <Button
                variant="primary"
                disabled={save.isPending || def.fields.some((f) => f.required && !editing.values[f.key])}
                onClick={() => save.mutate(editing)}
              >
                {save.isPending ? 'Salvando…' : 'Salvar'}
              </Button>
            </>
          }
        >
          <div className="grid gap-3 md:grid-cols-2">
            {def.fields.map((f) => (
              <div key={f.key} className={f.type === 'textarea' || f.type === 'json' ? 'md:col-span-2' : undefined}>
                <Field label={f.label} required={f.required} hint={f.hint}>
                  {f.type === 'boolean' ? (
                    <Select
                      value={editing.values[f.key] || 'false'}
                      onChange={(e) => setEditing({ ...editing, values: { ...editing.values, [f.key]: e.target.value } })}
                      options={[
                        { value: 'true', label: 'Sim' },
                        { value: 'false', label: 'Não' },
                      ]}
                    />
                  ) : f.type === 'textarea' || f.type === 'json' ? (
                    <Textarea
                      rows={f.type === 'json' ? 4 : 2}
                      className={f.type === 'json' ? 'font-mono text-[11px]' : undefined}
                      value={editing.values[f.key] ?? ''}
                      onChange={(e) => setEditing({ ...editing, values: { ...editing.values, [f.key]: e.target.value } })}
                    />
                  ) : (
                    <Input
                      type={f.type === 'number' ? 'number' : 'text'}
                      step="any"
                      value={editing.values[f.key] ?? ''}
                      onChange={(e) => setEditing({ ...editing, values: { ...editing.values, [f.key]: e.target.value } })}
                    />
                  )}
                </Field>
              </div>
            ))}
          </div>
        </Dialog>
      )}
    </Card>
  )
}
