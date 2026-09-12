import { Copy } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { EmptyState } from '@/components/EmptyState'
import { ListCard } from '@/components/ListCard'
import { PageHeader } from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api, type Project } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatTime } from '@/lib/utils'

export default function PublicProjectsPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [cloningId, setCloningId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setProjects(await api.listProjects('public'))
    } catch (err) {
      toast(err instanceof Error ? err.message : '加载失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const clone = async (project: Project) => {
    setCloningId(project.id)
    try {
      const cloned = await api.cloneProject(project.id)
      toast('克隆成功', 'success')
      navigate(`/projects/${cloned.id}`)
    } catch (err) {
      toast(err instanceof Error ? err.message : '克隆失败', 'error')
    } finally {
      setCloningId(null)
    }
  }

  return (
    <>
      <PageHeader title="公开项目" desc="浏览他人公开的项目，克隆后成为你自己的副本。" />
      <div className="flex-1 overflow-y-auto px-7 py-6">
        {loading ? (
          <div className="py-16 text-center text-[13px] text-muted-foreground">加载中…</div>
        ) : projects.length === 0 ? (
          <EmptyState icon="◇" title="暂无公开项目" desc="当有人公开项目后会出现在这里" />
        ) : (
          <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
            {projects.map((p) => (
              <ListCard
                key={p.id}
                title={p.name}
                desc={p.description || '（无描述）'}
                meta1={`作者：${p.owner_name}`}
                meta2={formatTime(p.updated_at)}
                badges={
                  <Badge variant="secondary">{p.node_count} 个血缘节点</Badge>
                }
                onClick={() => navigate(`/projects/${p.id}`)}
                actions={
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={cloningId === p.id || p.owner_id === user?.id}
                      onClick={() => clone(p)}
                    >
                      <Copy className="mr-1.5 h-4 w-4" />
                      {p.owner_id === user?.id ? '我的项目' : cloningId === p.id ? '克隆中…' : '克隆'}
                    </Button>
                  </>
                }
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
