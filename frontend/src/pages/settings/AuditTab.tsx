/** Trilha de auditoria: quem alterou o quê, quando e com quais valores. */
import { ScrollText } from 'lucide-react'
import { useState } from 'react'

import { Button, Card, CardHeader, Dialog, EmptyState, ErrorState, Field, Select, Spinner } from '../../components/ui/primitives'
import { useAuth } from '../../lib/auth'
import { fmtDateTime } from '../../lib/format'
import { useApi } from '../../lib/hooks'
import { TableShell, Toolbar } from './common'

interface AuditEntry {
  id: number
  ts: string
  username: string | null
  action: string
  entity: string
  entity_id: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  ip: string | null
}

const ACTION_LABEL: Record<string, string> = {
  create: 'Criação',
  update: 'Alteração',
  delete: 'Exclusão',
  login: 'Login',
  ingest: 'Ingestão',
  fit: 'Ajuste de baseline',
}

const ENTITIES = [
  'hierarchy_node',
  'significant_energy_use',
  'equipment',
  'variable',
  'indicator',
  'opportunity',
  'energy_baseline',
  'crop_year',
  'season',
  'measurement',
  'app_user',
]

export function AuditTab() {
  const { user } = useAuth()
  const allowed = user?.role === 'admin' || user?.role === 'energy_manager'
  const [entity, setEntity] = useState('')
  const log = useApi<AuditEntry[]>('/audit-log', { limit: 200, entity: entity || undefined }, { enabled: allowed })
  const [detail, setDetail] = useState<AuditEntry | null>(null)

  if (!allowed) {
    return (
      <Card>
        <CardHeader title="Trilha de auditoria" icon={<ScrollText size={15} />} />
        <EmptyState title="Sem permissão" description="A auditoria é visível para Administrador e Gestão de Energia." />
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        title="Trilha de auditoria"
        subtitle="Cada criação, alteração e exclusão de cadastro fica registrada com usuário, horário e valores."
        icon={<ScrollText size={15} />}
      />
      <Toolbar>
        <div className="w-72">
          <Field label="Filtrar por entidade">
            <Select
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
              options={[{ value: '', label: '— todas —' }, ...ENTITIES.map((e) => ({ value: e, label: e }))]}
            />
          </Field>
        </div>
        <span className="pb-1 text-[11px] text-muted">{log.data?.length ?? 0} registro(s)</span>
      </Toolbar>
      {log.error ? (
        <ErrorState error={log.error} />
      ) : log.isPending ? (
        <Spinner />
      ) : log.data?.length === 0 ? (
        <EmptyState title="Nenhum registro" />
      ) : (
        <TableShell>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Usuário</th>
              <th>Ação</th>
              <th>Entidade</th>
              <th>ID</th>
              <th>IP</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {log.data?.map((e) => (
              <tr key={e.id}>
                <td className="text-[11px]">{fmtDateTime(e.ts)}</td>
                <td className="text-[12px] font-medium">{e.username ?? '—'}</td>
                <td className="text-[11px]">{ACTION_LABEL[e.action] ?? e.action}</td>
                <td className="font-mono text-[11px] text-ink-2">{e.entity}</td>
                <td className="num text-[11px]">{e.entity_id ?? '—'}</td>
                <td className="text-[11px] text-muted">{e.ip ?? '—'}</td>
                <td>
                  <div className="flex justify-end">
                    {(e.before || e.after) && (
                      <Button size="sm" variant="ghost" onClick={() => setDetail(e)}>
                        Ver valores
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      {detail && (
        <Dialog
          open
          wide
          onOpenChange={(v) => !v && setDetail(null)}
          title={`${ACTION_LABEL[detail.action] ?? detail.action} em ${detail.entity} #${detail.entity_id ?? ''}`}
          description={`${detail.username ?? 'sistema'} · ${fmtDateTime(detail.ts)}`}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold text-ink">Antes</p>
              <pre className="max-h-80 overflow-auto rounded-lg border border-edge bg-surface-2 p-2 text-[11px]">
                {detail.before ? JSON.stringify(detail.before, null, 2) : '—'}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-ink">Depois</p>
              <pre className="max-h-80 overflow-auto rounded-lg border border-edge bg-surface-2 p-2 text-[11px]">
                {detail.after ? JSON.stringify(detail.after, null, 2) : '—'}
              </pre>
            </div>
          </div>
        </Dialog>
      )}
    </Card>
  )
}
