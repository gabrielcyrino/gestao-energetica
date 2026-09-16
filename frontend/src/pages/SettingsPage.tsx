/** Configurações: toda a metodologia é cadastro. Áreas, processos, USEs, equipamentos, variáveis,
 *  indicadores, linhas de base, períodos e catálogos são dados — a aplicação não precisa ser recompilada. */
import { useState } from 'react'

import { Page, PageHeader } from '../components/layout/AppShell'
import { Tabs } from '../components/ui/primitives'
import { useAuth } from '../lib/auth'
import { AuditTab } from './settings/AuditTab'
import { BaselinesTab } from './settings/BaselinesTab'
import { CatalogsTab } from './settings/CatalogsTab'
import { EquipmentTab } from './settings/EquipmentTab'
import { HierarchyTab } from './settings/HierarchyTab'
import { IndicatorsTab } from './settings/IndicatorsTab'
import { IngestionTab } from './settings/IngestionTab'
import { PeriodsTab } from './settings/PeriodsTab'
import { UsesTab } from './settings/UsesTab'
import { VariablesTab } from './settings/VariablesTab'

const TABS = [
  { value: 'hierarquia', label: 'Hierarquia & fluxogramas' },
  { value: 'uses', label: 'USEs' },
  { value: 'equipamentos', label: 'Equipamentos' },
  { value: 'variaveis', label: 'Variáveis / tags' },
  { value: 'indicadores', label: 'Indicadores (IDEs)' },
  { value: 'baselines', label: 'Linhas de base' },
  { value: 'periodos', label: 'Períodos (Crop Year e safras)' },
  { value: 'catalogos', label: 'Catálogos' },
  { value: 'ingestao', label: 'Ingestão de dados' },
  { value: 'auditoria', label: 'Auditoria' },
]

export function SettingsPage() {
  const [tab, setTab] = useState('hierarquia')
  const { user } = useAuth()

  return (
    <>
      <PageHeader
        title="Configurações"
        subtitle="Estrutura da planta, usos significativos, indicadores e períodos — tudo configurável, sem alteração de código."
        badges={
          user && (
            <span className="rounded-md border border-edge px-2 py-0.5 text-[11px] font-normal text-ink-2">
              Perfil: {user.role_label}
              {user.role === 'process_owner' && ' · edição restrita ao seu escopo'}
              {user.role === 'viewer' && ' · somente leitura'}
            </span>
          )
        }
      />
      <Page>
        <Tabs tabs={TABS} value={tab} onChange={setTab} />
        <div className="pt-1">
          {tab === 'hierarquia' && <HierarchyTab />}
          {tab === 'uses' && <UsesTab />}
          {tab === 'equipamentos' && <EquipmentTab />}
          {tab === 'variaveis' && <VariablesTab />}
          {tab === 'indicadores' && <IndicatorsTab />}
          {tab === 'baselines' && <BaselinesTab />}
          {tab === 'periodos' && <PeriodsTab />}
          {tab === 'catalogos' && <CatalogsTab />}
          {tab === 'ingestao' && <IngestionTab />}
          {tab === 'auditoria' && <AuditTab />}
        </div>
      </Page>
    </>
  )
}
