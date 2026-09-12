import { useState, type FormEvent } from 'react'

import { PageHeader } from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatTime } from '@/lib/utils'

export default function AccountPage() {
  const { user } = useAuth()
  const toast = useToast()
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirm) {
      toast('两次输入的新密码不一致', 'error')
      return
    }
    setSubmitting(true)
    try {
      await api.changePassword(oldPassword, newPassword)
      toast('密码已修改', 'success')
      setOldPassword('')
      setNewPassword('')
      setConfirm('')
    } catch (err) {
      toast(err instanceof Error ? err.message : '修改失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <PageHeader title="账号设置" desc="查看账号信息并修改密码。" />
      <div className="flex-1 overflow-y-auto px-7 py-6">
        <div className="max-w-[520px] space-y-6">
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="mb-3 text-[13.5px] font-semibold">账号信息</div>
            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between">
                <span className="text-muted-foreground">用户名</span>
                <span className="font-medium">{user?.username}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">角色</span>
                <Badge variant={user?.role === 'admin' ? 'default' : 'secondary'}>
                  {user?.role === 'admin' ? '管理员' : '普通用户'}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">注册时间</span>
                <span className="font-mono">{user ? formatTime(user.created_at) : '-'}</span>
              </div>
            </div>
          </div>

          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-lg border border-border bg-card p-5"
          >
            <div className="text-[13.5px] font-semibold">修改密码</div>
            <div className="space-y-1.5">
              <Label htmlFor="old">原密码</Label>
              <Input
                id="old"
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new">新密码</Label>
              <Input
                id="new"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={4}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-new">确认新密码</Label>
              <Input
                id="confirm-new"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? '提交中…' : '修改密码'}
            </Button>
          </form>
        </div>
      </div>
    </>
  )
}
