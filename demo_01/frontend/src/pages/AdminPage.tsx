import { UserPlus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

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
import { api, type User } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatTime } from '@/lib/utils'

export default function AdminPage() {
  const { user } = useAuth()
  const toast = useToast()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'user' | 'admin'>('user')
  const [submitting, setSubmitting] = useState(false)
  const [resetTarget, setResetTarget] = useState<User | null>(null)
  const [newPassword, setNewPassword] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setUsers(await api.listUsers())
    } catch (err) {
      toast(err instanceof Error ? err.message : '加载失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (user?.role === 'admin') load()
    else setLoading(false)
  }, [user, load])

  if (user?.role !== 'admin') {
    return (
      <>
        <PageHeader title="管理后台" />
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
          仅管理员可访问
        </div>
      </>
    )
  }

  const handleCreate = async () => {
    setSubmitting(true)
    try {
      await api.createUser(username.trim(), password, role)
      toast('账号已创建', 'success')
      setCreateOpen(false)
      setUsername('')
      setPassword('')
      setRole('user')
      load()
    } catch (err) {
      toast(err instanceof Error ? err.message : '创建失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleReset = async () => {
    if (!resetTarget) return
    try {
      await api.resetPassword(resetTarget.id, newPassword)
      toast('密码已重置', 'success')
      setResetTarget(null)
      setNewPassword('')
    } catch (err) {
      toast(err instanceof Error ? err.message : '重置失败', 'error')
    }
  }

  return (
    <>
      <PageHeader
        title="管理后台"
        desc="创建账号、重置用户密码。"
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="create-account">
            <UserPlus className="mr-1.5 h-4 w-4" /> 创建账号
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto px-7 py-6">
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full border-collapse text-[13px]">
            <thead className="bg-secondary/60">
              <tr>
                {['用户名', '角色', '注册时间', '操作'].map((h) => (
                  <th
                    key={h}
                    className="border-b border-border px-4 py-2.5 text-left font-medium text-foreground/80"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                    加载中…
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="odd:bg-background/50">
                    <td className="border-b border-border/60 px-4 py-2.5 font-medium">
                      {u.username}
                      {u.id === user?.id && (
                        <span className="ml-2 text-[11px] text-muted-foreground">(我)</span>
                      )}
                    </td>
                    <td className="border-b border-border/60 px-4 py-2.5">
                      <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>
                        {u.role === 'admin' ? '管理员' : '普通用户'}
                      </Badge>
                    </td>
                    <td className="border-b border-border/60 px-4 py-2.5 font-mono text-[12px] text-muted-foreground">
                      {formatTime(u.created_at)}
                    </td>
                    <td className="border-b border-border/60 px-4 py-2.5">
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid="reset-password"
                        onClick={() => {
                          setResetTarget(u)
                          setNewPassword('')
                        }}
                      >
                        重置密码
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle>创建账号</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="u-name">用户名</Label>
              <Input id="u-name" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-pass">初始密码</Label>
              <Input
                id="u-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={4}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-role">角色</Label>
              <select
                id="u-role"
                value={role}
                onChange={(e) => setRole(e.target.value as 'user' | 'admin')}
                className="h-9 w-full rounded-md border border-input bg-card px-3 text-[13px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={submitting || !username.trim() || password.length < 4}
              data-testid="account-submit"
            >
              {submitting ? '创建中…' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetTarget} onOpenChange={(o) => !o && setResetTarget(null)}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle>重置「{resetTarget?.username}」的密码</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reset-pass">新密码</Label>
            <Input
              id="reset-pass"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setResetTarget(null)}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleReset}
              disabled={newPassword.length < 4}
              data-testid="reset-submit"
            >
              确认重置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
