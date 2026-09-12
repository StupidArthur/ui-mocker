import { ArrowLeft, Globe, Lock, Play, Settings, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { LineageTree } from '@/components/LineageTree'
import { PageHeader } from '@/components/PageHeader'
import { PreviewTable } from '@/components/PreviewTable'
import { RunResultView } from '@/components/RunResultView'
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
import {
  api,
  type Algorithm,
  type AlgorithmRun,
  type LineageNode,
  type Preview,
  type Project,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatTime } from '@/lib/utils'

const STATUS_META: Record<string, { label: string; variant: 'warning' | 'success' | 'destructive' }> = {
  pending: { label: '待审核', variant: 'warning' },
  approved: { label: '已通过', variant: 'success' },
  rejected: { label: '已驳回', variant: 'destructive' },
}

export default function ProjectWorkspacePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()

  const [project, setProject] = useState<Project | null>(null)
  const [nodes, setNodes] = useState<LineageNode[]>([])
  const [runs, setRuns] = useState<AlgorithmRun[]>([])
  const [algorithms, setAlgorithms] = useState<Algorithm[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [nodePreview, setNodePreview] = useState<Preview | null>(null)

  const [runOpen, setRunOpen] = useState(false)
  const [algorithmKey, setAlgorithmKey] = useState('')
  const [params, setParams] = useState<Record<string, number>>({})
  const [resultRun, setResultRun] = useState<AlgorithmRun | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false)
  const [deleteRunTarget, setDeleteRunTarget] = useState<AlgorithmRun | null>(null)

  const canEdit = !!project && (user?.role === 'admin' || project.owner_id === user?.id)
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null
  const currentAlgorithm = algorithms.find((a) => a.key === algorithmKey) ?? null

  const loadRuns = useCallback(async () => {
    setRuns(await api.listRuns(id))
  }, [id])

  const loadNodes = useCallback(async () => {
    const data = await api.listNodes(id)
    setNodes(data)
    return data
  }, [id])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [projectData, nodesData, runsData, algorithmsData] = await Promise.all([
        api.getProject(id),
        api.listNodes(id),
        api.listRuns(id),
        api.listAlgorithms(),
      ])
      setProject(projectData)
      setNodes(nodesData)
      setRuns(runsData)
      setAlgorithms(algorithmsData)
      setSelectedNodeId((prev) => prev ?? nodesData.find((n) => n.node_type === 'root')?.id ?? null)
    } catch (err) {
      toast(err instanceof Error ? err.message : '加载失败', 'error')
      navigate('/projects')
    } finally {
      setLoading(false)
    }
  }, [id, navigate, toast])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!selectedNodeId) {
      setNodePreview(null)
      return
    }
    let active = true
    api
      .previewNode(id, selectedNodeId)
      .then((data) => active && setNodePreview(data))
      .catch(() => active && setNodePreview(null))
    return () => {
      active = false
    }
  }, [id, selectedNodeId])

  const openRun = () => {
    const first = algorithms[0]
    if (!first) return
    setAlgorithmKey(first.key)
    setParams(Object.fromEntries(first.params.map((p) => [p.name, p.default])))
    setRunOpen(true)
  }

  const handleAlgorithmChange = (key: string) => {
    setAlgorithmKey(key)
    const algo = algorithms.find((a) => a.key === key)
    setParams(Object.fromEntries((algo?.params ?? []).map((p) => [p.name, p.default])))
  }

  const submitRun = async () => {
    if (!selectedNodeId) return
    try {
      const run = await api.runAlgorithm(id, selectedNodeId, algorithmKey, params)
      toast('算法执行完成，等待审核', 'success')
      setRunOpen(false)
      setResultRun(run)
      await loadRuns()
    } catch (err) {
      toast(err instanceof Error ? err.message : '执行失败', 'error')
    }
  }

  const review = async (run: AlgorithmRun, decision: 'approve' | 'reject') => {
    try {
      const updated = await api.reviewRun(id, run.id, decision)
      toast(decision === 'approve' ? '已通过并沉淀为血缘节点' : '已驳回', 'success')
      setResultRun((prev) => (prev?.id === updated.id ? updated : prev))
      await Promise.all([loadNodes(), loadRuns()])
    } catch (err) {
      toast(err instanceof Error ? err.message : '审核失败', 'error')
    }
  }

  const removeRun = async () => {
    if (!deleteRunTarget) return
    try {
      await api.deleteRun(id, deleteRunTarget.id)
      toast('已删除', 'success')
      setDeleteRunTarget(null)
      loadRuns()
    } catch (err) {
      toast(err instanceof Error ? err.message : '删除失败', 'error')
    }
  }

  const togglePublish = async () => {
    if (!project) return
    try {
      setProject(await api.publishProject(id, !project.is_public))
      toast(project.is_public ? '已取消公开' : '已公开项目', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '操作失败', 'error')
    }
  }

  const saveEdit = async () => {
    try {
      setProject(await api.updateProject(id, editName, editDesc))
      toast('已保存', 'success')
      setEditOpen(false)
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存失败', 'error')
    }
  }

  const deleteProject = async () => {
    try {
      await api.deleteProject(id)
      toast('项目已删除', 'success')
      navigate('/projects')
    } catch (err) {
      toast(err instanceof Error ? err.message : '删除失败', 'error')
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
        加载中…
      </div>
    )
  }
  if (!project) return null

  return (
    <>
      <PageHeader
        title={project.name}
        desc={`数据集：${project.dataset_name ?? '-'} · 作者：${project.owner_name}`}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => navigate('/projects')}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> 返回
            </Button>
            <Badge variant={project.is_public ? 'success' : 'outline'}>
              {project.is_public ? '已公开' : '私有'}
            </Badge>
            {canEdit && (
              <>
                <Button variant="outline" size="sm" onClick={togglePublish} data-testid="project-publish">
                  {project.is_public ? (
                    <Lock className="mr-1.5 h-4 w-4" />
                  ) : (
                    <Globe className="mr-1.5 h-4 w-4" />
                  )}
                  {project.is_public ? '取消公开' : '公开'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditName(project.name)
                    setEditDesc(project.description)
                    setEditOpen(true)
                  }}
                >
                  <Settings className="mr-1.5 h-4 w-4" /> 编辑
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setDeleteProjectOpen(true)}>
                  <Trash2 className="mr-1.5 h-4 w-4" /> 删除
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="w-[300px] flex-shrink-0 space-y-4 overflow-y-auto border-r border-border p-4">
          <LineageTree nodes={nodes} selectedId={selectedNodeId} onSelect={setSelectedNodeId} />
          {selectedNode && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-[13px] font-semibold">{selectedNode.title}</div>
              <div className="mt-1 text-[11.5px] text-muted-foreground">
                {selectedNode.node_type === 'root' ? '根节点 · 数据集状态' : '算法结果节点'} ·{' '}
                {formatTime(selectedNode.created_at)}
              </div>
              {canEdit && (
                <Button
                  size="sm"
                  className="mt-3 w-full"
                  onClick={openRun}
                  disabled={!selectedNode}
                  data-testid="run-algorithm"
                >
                  <Play className="mr-1.5 h-4 w-4" /> 在该节点执行算法
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-7 py-6">
          <section>
            <div className="mb-2 text-[13.5px] font-semibold">节点数据预览</div>
            {nodePreview ? (
              <PreviewTable preview={nodePreview} />
            ) : (
              <div className="rounded-lg border border-border bg-card py-8 text-center text-[12.5px] text-muted-foreground">
                选择一个节点查看预览
              </div>
            )}
          </section>

          <section>
            <div className="mb-2 text-[13.5px] font-semibold">算法结果与审核</div>
            {runs.length === 0 ? (
              <EmptyState icon="∅" title="暂无算法结果" desc="在上方选择节点并执行算法" />
            ) : (
              <div className="space-y-2">
                {runs.map((run) => {
                  const meta = STATUS_META[run.status]
                  const inputNode = nodes.find((n) => n.id === run.input_node_id)
                  return (
                    <div
                      key={run.id}
                      className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[13.5px] font-medium">
                            {run.result.name || run.algorithm}
                          </span>
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                          <Badge variant="secondary">
                            {run.result.category === 'prediction' ? '预测' : '统计'}
                          </Badge>
                        </div>
                        <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                          输入节点：{inputNode?.title ?? run.input_node_id} · {formatTime(run.created_at)}
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => setResultRun(run)}>
                          查看结果
                        </Button>
                        {canEdit && run.status === 'pending' && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => review(run, 'approve')}
                              data-testid="run-approve"
                            >
                              通过
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => review(run, 'reject')}
                              data-testid="run-reject"
                            >
                              驳回
                            </Button>
                          </>
                        )}
                        {canEdit && run.status !== 'approved' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteRunTarget(run)}
                            title="删除"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      <Dialog open={runOpen} onOpenChange={setRunOpen}>
        <DialogContent className="max-w-[460px]">
          <DialogHeader>
            <DialogTitle>执行算法</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="algo">算法</Label>
              <select
                id="algo"
                value={algorithmKey}
                onChange={(e) => handleAlgorithmChange(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-card px-3 text-[13px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {algorithms.map((a) => (
                  <option key={a.key} value={a.key}>
                    [{a.category === 'statistics' ? '统计' : '预测'}] {a.name}
                  </option>
                ))}
              </select>
            </div>
            {currentAlgorithm && (
              <div className="rounded-md border border-border bg-secondary/40 p-3 text-[12px] text-muted-foreground">
                {currentAlgorithm.description}
              </div>
            )}
            {currentAlgorithm?.params.map((p) => (
              <div key={p.name} className="space-y-1.5">
                <Label htmlFor={`param-${p.name}`}>{p.label}</Label>
                <Input
                  id={`param-${p.name}`}
                  type="number"
                  min={1}
                  value={params[p.name] ?? p.default}
                  onChange={(e) =>
                    setParams((prev) => ({ ...prev, [p.name]: Number(e.target.value) }))
                  }
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRunOpen(false)}>
              取消
            </Button>
            <Button size="sm" onClick={submitRun} data-testid="run-submit">
              执行
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resultRun} onOpenChange={(o) => !o && setResultRun(null)}>
        <DialogContent className="flex max-h-[84vh] max-w-[820px] flex-col">
          <DialogHeader>
            <DialogTitle>{resultRun?.result.name} · 结果详情</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto pr-1">
            {resultRun && <RunResultView result={resultRun.result} />}
          </div>
          {canEdit && resultRun?.status === 'pending' && (
            <DialogFooter className="items-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => review(resultRun, 'reject')}
                data-testid="run-reject-dialog"
              >
                驳回
              </Button>
              <Button
                size="sm"
                onClick={() => review(resultRun, 'approve')}
                data-testid="run-approve-dialog"
              >
                通过并沉淀为节点
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle>编辑项目</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">名称</Label>
              <Input id="edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-desc">描述</Label>
              <Input id="edit-desc" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>
              取消
            </Button>
            <Button size="sm" onClick={saveEdit} disabled={!editName.trim()}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteProjectOpen}
        onOpenChange={setDeleteProjectOpen}
        title="删除项目"
        desc={`确定删除「${project.name}」吗？项目的血缘与算法结果将一并删除。`}
        confirmText="确认删除"
        onConfirm={deleteProject}
      />
      <ConfirmDialog
        open={!!deleteRunTarget}
        onOpenChange={(o) => !o && setDeleteRunTarget(null)}
        title="删除算法结果"
        desc="确定删除该条算法结果吗？"
        confirmText="确认删除"
        onConfirm={removeRun}
      />
    </>
  )
}
