import { Navigate, Outlet, Route, Routes } from 'react-router-dom'

import { Sidebar } from '@/components/Sidebar'
import { useAuth } from '@/lib/auth'
import AccountPage from '@/pages/AccountPage'
import AdminPage from '@/pages/AdminPage'
import DatasetsPage from '@/pages/DatasetsPage'
import LoginPage from '@/pages/LoginPage'
import ProjectWorkspacePage from '@/pages/ProjectWorkspacePage'
import ProjectsPage from '@/pages/ProjectsPage'
import PublicProjectsPage from '@/pages/PublicProjectsPage'
import RegisterPage from '@/pages/RegisterPage'

function ProtectedLayout() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-[13px] text-muted-foreground">
        加载中…
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<Navigate to="/datasets" replace />} />
        <Route path="/datasets" element={<DatasetsPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/public" element={<PublicProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectWorkspacePage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
