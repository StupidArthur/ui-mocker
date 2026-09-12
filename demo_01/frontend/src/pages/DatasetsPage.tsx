import { Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'

import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { ListCard } from '@/components/ListCard'
import { PageHeader } from '@/components/PageHeader'
import { PreviewTable, SummaryGrid } from '@/components/PreviewTable'
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
import { api, type Dataset, type Preview } from '@/lib/api'
import { formatBytes, formatTime } from '@/lib/utils'

export default function DatasetsPage() {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadName, setUploadName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [preview, setPreview] = useState<{ dataset: Dataset; data: Preview } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Dataset | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setDatasets(await api.listDatasets())
    } catch (err) {
      toast(err instanceof Error ? err.message : '加载失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    if (f && !uploadName) setUploadName(f.name.replace(/\.[^.]+$/, ''))
  }

  const handleUpload = async () => {
    if (!file) {
      toast('请选择文件', 'error')
      return
    }
    setSubmitting(true)
    try {
      await api.uploadDataset(file, uploadName || file.name)
      toast('上传成功', 'success')
      setUploadOpen(false)
      setUploadName('')
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      load()
    } catch (err) {
      toast(err instanceof Error ? err.message : '上传失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const openPreview = async (dataset: Dataset) => {
    try {
      const data = await api.previewDataset(dataset.id)
      setPreview({ dataset, data })
    } catch (err) {
      toast(err instanceof Error ? err.message : '预览失败', 'error')
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await api.deleteDataset(deleteTarget.id)
      toast('已删除', 'success')
      setDeleteTarget(null)
      load()
    } catch (err) {
      toast(err instanceof Error ? err.message : '删除失败', 'error')
    }
  }

  return (
    <>
      <PageHeader
        title="数据集"
        desc="时序数据：行=时间，列=位号，单元=值。支持 CSV / Parquet。"
        actions={
          <Button size="sm" onClick={() => setUploadOpen(true)} data-testid="upload-dataset">
            <Upload className="mr-1.5 h-4 w-4" /> 上传数据集
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto px-7 py-6">
        {loading ? (
          <div className="py-16 text-center text-[13px] text-muted-foreground">加载中…</div>
        ) : datasets.length === 0 ? (
          <EmptyState icon="∅" title="暂无数据集" desc="点击右上角上传 CSV 或 Parquet 文件" />
        ) : (
          <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
            {datasets.map((d) => (
              <ListCard
                key={d.id}
                title={d.name}
                desc={`${d.row_count} 行 × ${d.col_count} 列 · 时间列 ${d.time_column ?? '-'}`}
                meta1={`${d.format.toUpperCase()} · ${formatBytes(d.size_bytes)}`}
                meta2={formatTime(d.created_at)}
                badges={<Badge variant="secondary">{d.col_count} 位号</Badge>}
                onClick={() => openPreview(d)}
              />
            ))}
          </div>
        )}
      </div>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-[460px]">
          <DialogHeader>
            <DialogTitle>上传数据集</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>数据文件（.csv / .parquet）</Label>
              <Input ref={fileRef} type="file" accept=".csv,.parquet,.pq" onChange={onFileChange} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ds-name">数据集名称</Label>
              <Input
                id="ds-name"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                placeholder="留空则使用文件名"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setUploadOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleUpload}
              disabled={submitting}
              data-testid="upload-submit"
            >
              {submitting ? '上传中…' : '上传'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="flex max-h-[84vh] max-w-[860px] flex-col">
          <DialogHeader>
            <DialogTitle>{preview?.dataset.name} · 预览</DialogTitle>
          </DialogHeader>
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            <div>
              <div className="mb-2 text-[12.5px] font-medium text-foreground/80">数据预览（前 20 行）</div>
              {preview && <PreviewTable preview={preview.data} />}
            </div>
            <div>
              <div className="mb-2 text-[12.5px] font-medium text-foreground/80">统计摘要</div>
              {preview && <SummaryGrid summary={preview.data.summary} />}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              size="sm"
              data-testid="dataset-delete"
              onClick={() => {
                if (preview) setDeleteTarget(preview.dataset)
                setPreview(null)
              }}
            >
              删除数据集
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPreview(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="删除数据集"
        desc={`确定删除「${deleteTarget?.name}」吗？若该数据集仍被项目引用将无法删除，此操作不可撤销。`}
        confirmText="确认删除"
        onConfirm={handleDelete}
      />
    </>
  )
}
