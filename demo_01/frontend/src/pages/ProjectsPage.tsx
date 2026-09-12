import { Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { EmptyState } from '@/components/EmptyState'
import { ListCard } from '@/components/ListCard'
import { PageHeader } from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, type Dataset, type Project } from '@/lib/api'
import { formatTime } from '@/lib/utils'

export default function ProjectsPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [datasetId, setDatasetId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [projectsData, datasetsData] = await Promise.all([
        api.listProjects('mine'),
        api.listDatasets(),
      ])
      setProjects(projectsData)
      setDatasets(datasetsData)
    } catch (err) {
      toast(err instanceof Error ? err.message : '加载失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setName('')
    setDescription('')
    setDatasetId(datasets[0]?.id ?? '')
    setCreateOpen(true)
  }

  const handleCreate = async () => {
    if (!name.trim() || !datasetId) {
      toast('请填写项目名并选择数据集', 'error')
      return
    }
    setSubmitting(true)
    try {
      const project = await api.createProject(name.trim(), description, datasetId)
      toast('项目已创建', 'success')
      setCreateOpen(false)
      navigate(`/projects/${project.id}`)
    } catch (err) {
      toast(err instanceof Error ? err.message : '创建失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="我的项目"
        desc="每个项目绑定一个数据集，加载后形成血缘根节点。"
        actions={
          <Button size="sm" onClick={openCreate} data-testid="create-project">
            <Plus className="mr-1.5 h-4 w-4" /> 新建项目
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto px-7 py-6">
        {loading ? (
          <div className="py-16 text-center text-[13px] text-muted-foreground">加载中…</div>
        ) : projects.length === 0 ? (
          <EmptyState icon="∅" title="暂无项目" desc="点击右上角，用数据集创建一个项目" />
        ) : (
          <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
            {projects.map((p) => (
              <ListCard
                key={p.id}
                title={p.name}
                desc={p.description || '（无描述）'}
                meta1={`数据集：${p.dataset_name ?? '-'}`}
                meta2={formatTime(p.updated_at)}
                badges={
                  <Badge variant={p.is_public ? 'success' : 'outline'}>
                    {p.is_public ? '已公开' : '私有'}
                  </Badge>
                }
                onClick={() => navigate(`/projects/${p.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-[460px]">
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="p-name">项目名称</Label>
              <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-desc">描述</Label>
              <Input
                id="p-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="可选"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-dataset">绑定数据集</Label>
              {datasets.length === 0 ? (
                <div className="text-[12.5px] text-destructive">
                  暂无数据集，请先到「数据集」页上传。
                </div>
              ) : (
                <select
                  id="p-dataset"
                  value={datasetId}
                  onChange={(e) => setDatasetId(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-card px-3 text-[13px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {datasets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}（{d.row_count} 行）
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={submitting || datasets.length === 0}
              data-testid="project-submit"
            >
              {submitting ? '创建中…' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
