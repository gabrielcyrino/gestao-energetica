/** Ingestão de dados por CSV (e histórico dos lotes recebidos, inclusive via API de integração). */
import { Download, FileUp, Upload } from 'lucide-react'
import { useRef, useState } from 'react'

import { Button, Card, CardHeader, EmptyState, ErrorState, Spinner } from '../../components/ui/primitives'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { fmtDateTime } from '../../lib/format'
import { useApi } from '../../lib/hooks'
import { FeedbackBanner, SettingsNote, TableShell, useFeedback } from './common'

interface IngestReport {
  batch_id: number
  rows_total: number
  rows_ok: number
  rows_rejected: number
  errors: { line: number; variable_code: string; error: string }[]
}

interface Batch {
  id: number
  source: string
  filename: string | null
  received_at: string
  rows_total: number
  rows_ok: number
  rows_rejected: number
  errors: { line: number; variable_code: string; error: string }[]
}

export function IngestionTab() {
  const { user } = useAuth()
  const canIngest = user?.role === 'admin' || user?.role === 'energy_manager'
  const batches = useApi<Batch[]>('/ingestion/batches', { limit: 50 }, { enabled: canIngest })
  const fb = useFeedback()
  const [report, setReport] = useState<IngestReport | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const upload = async (file: File) => {
    setBusy(true)
    fb.clear()
    setReport(null)
    try {
      const res = await api.upload<IngestReport>('/ingestion/csv', file)
      setReport(res)
      fb.ok(`Arquivo processado: ${res.rows_ok} linha(s) aceitas, ${res.rows_rejected} rejeitada(s).`)
      await batches.refetch()
    } catch (e) {
      fb.fail(e instanceof Error ? e.message : 'Falha no envio')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const downloadTemplate = async () => {
    try {
      const tpl = await api.get<{ filename: string; content: string; note: string }>('/ingestion/template.csv')
      const blob = new Blob([tpl.content], { type: 'text/csv;charset=utf-8' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = tpl.filename
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (e) {
      fb.fail(e instanceof Error ? e.message : 'Falha ao baixar modelo')
    }
  }

  if (!canIngest) {
    return (
      <Card>
        <CardHeader title="Ingestão de dados" icon={<Upload size={15} />} />
        <EmptyState title="Sem permissão" description="Apenas Administrador e Gestão de Energia podem enviar dados." />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Envio de medições por CSV"
          subtitle="Colunas: variable_code; ts; value; quality — separador vírgula ou ponto e vírgula."
          icon={<Upload size={15} />}
          actions={
            <Button onClick={downloadTemplate}>
              <Download size={14} /> Baixar modelo
            </Button>
          }
        />
        <FeedbackBanner feedback={fb.feedback} onClose={fb.clear} />
        <div className="px-4 py-4">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-edge px-4 py-8 text-center hover:bg-surface-2">
            <FileUp size={22} className="text-muted" />
            <span className="text-sm font-medium text-ink">{busy ? 'Enviando…' : 'Selecionar arquivo CSV'}</span>
            <span className="text-[11px] text-muted">As linhas inválidas são rejeitadas individualmente, com o motivo.</span>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void upload(file)
              }}
            />
          </label>
        </div>

        {report && (
          <div className="px-4 pb-4">
            <div className="mb-2 flex flex-wrap gap-4 text-xs">
              <span>
                Lote <b className="num">#{report.batch_id}</b>
              </span>
              <span>
                Total <b className="num">{report.rows_total}</b>
              </span>
              <span style={{ color: 'var(--good-text)' }}>
                Aceitas <b className="num">{report.rows_ok}</b>
              </span>
              <span style={{ color: 'var(--critical-text)' }}>
                Rejeitadas <b className="num">{report.rows_rejected}</b>
              </span>
            </div>
            {report.errors.length > 0 && (
              <TableShell maxHeight={220}>
                <thead>
                  <tr>
                    <th>Linha</th>
                    <th>Variável</th>
                    <th>Motivo da rejeição</th>
                  </tr>
                </thead>
                <tbody>
                  {report.errors.map((e, i) => (
                    <tr key={i}>
                      <td className="num">{e.line}</td>
                      <td className="font-mono text-[11px]">{e.variable_code || '—'}</td>
                      <td className="text-[12px] text-ink-2">{e.error}</td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </div>
        )}

        <SettingsNote>
          <b>Valor vazio só é aceito com quality=bad ou suspect.</b> Ausência de leitura nunca vira zero: ela reduz a
          completude do período e pode deixar o indicador com status "sem dados suficientes" — o que é diferente de
          "sem operação".
        </SettingsNote>
      </Card>

      <Card>
        <CardHeader title="Histórico de lotes" subtitle="Inclui envios por CSV e pela API de integração (gateway OPC UA/MQTT)." />
        {batches.error ? (
          <ErrorState error={batches.error} />
        ) : batches.isPending ? (
          <Spinner />
        ) : batches.data?.length === 0 ? (
          <EmptyState title="Nenhum lote registrado" />
        ) : (
          <TableShell maxHeight={320}>
            <thead>
              <tr>
                <th>#</th>
                <th>Origem</th>
                <th>Arquivo</th>
                <th>Recebido em</th>
                <th className="right">Total</th>
                <th className="right">Aceitas</th>
                <th className="right">Rejeitadas</th>
              </tr>
            </thead>
            <tbody>
              {batches.data?.map((b) => (
                <tr key={b.id}>
                  <td className="num">{b.id}</td>
                  <td className="text-[11px]">{b.source}</td>
                  <td className="max-w-[240px] truncate text-[11px] text-ink-2">{b.filename ?? '—'}</td>
                  <td className="text-[11px]">{fmtDateTime(b.received_at)}</td>
                  <td className="right num">{b.rows_total}</td>
                  <td className="right num" style={{ color: 'var(--good-text)' }}>
                    {b.rows_ok}
                  </td>
                  <td className="right num" style={{ color: b.rows_rejected ? 'var(--critical-text)' : undefined }}>
                    {b.rows_rejected}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>
    </div>
  )
}
