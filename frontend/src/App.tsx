import { Navigate, Route, Routes, useLocation } from 'react-router'

import { AppShell } from './components/layout/AppShell'
import { Spinner } from './components/ui/primitives'
import { useAuth } from './lib/auth'
import { AreaPage } from './pages/AreaPage'
import { ComparePage } from './pages/ComparePage'
import { DashboardPage } from './pages/DashboardPage'
import { DataQualityPage } from './pages/DataQualityPage'
import { EquipmentPage } from './pages/EquipmentPage'
import { FlowPage } from './pages/FlowPage'
import { IndicatorPage } from './pages/IndicatorPage'
import { IndicatorsPage } from './pages/IndicatorsPage'
import { LoginPage } from './pages/LoginPage'
import { MethodologyPage } from './pages/MethodologyPage'
import { OpportunitiesPage } from './pages/OpportunitiesPage'
import { ProcessPage } from './pages/ProcessPage'
import { SettingsPage } from './pages/SettingsPage'
import { TrendsPage } from './pages/TrendsPage'
import { UsePage } from './pages/UsePage'
import { UsesPage } from './pages/UsesPage'

export function App() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Spinner label="Carregando sessão…" />
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname }} />} />
      </Routes>
    )
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/areas/:nodeId" element={<AreaPage />} />
        <Route path="/areas/:nodeId/fluxograma" element={<FlowPage />} />
        <Route path="/processos/:nodeId" element={<ProcessPage />} />
        <Route path="/uses" element={<UsesPage />} />
        <Route path="/uses/:useId" element={<UsePage />} />
        <Route path="/equipamentos/:equipmentId" element={<EquipmentPage />} />
        <Route path="/indicadores" element={<IndicatorsPage />} />
        <Route path="/indicadores/:indicatorId" element={<IndicatorPage />} />
        <Route path="/comparacoes" element={<ComparePage />} />
        <Route path="/tendencias" element={<TrendsPage />} />
        <Route path="/oportunidades" element={<OpportunitiesPage />} />
        <Route path="/qualidade" element={<DataQualityPage />} />
        <Route path="/configuracoes" element={<SettingsPage />} />
        <Route path="/metodologia" element={<MethodologyPage />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  )
}
