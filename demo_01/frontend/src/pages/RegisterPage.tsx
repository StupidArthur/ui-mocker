import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'

import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth'

export default function RegisterPage() {
  const { user, register } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (user) return <Navigate to="/datasets" replace />

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) {
      toast('两次输入的密码不一致', 'error')
      return
    }
    setSubmitting(true)
    try {
      await register(username, password)
      toast('注册成功，已自动登录', 'success')
      navigate('/datasets')
    } catch (err) {
      toast(err instanceof Error ? err.message : '注册失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-[380px] rounded-xl border border-border bg-card p-7 shadow-sm">
        <div className="mb-6">
          <h1 className="text-[19px] font-semibold">创建账号</h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">注册后即可上传数据集并创建项目</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="username">用户名</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="2-32 个字符"
              minLength={2}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 4 位"
              minLength={4}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">确认密码</Label>
            <Input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="再次输入密码"
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? '注册中…' : '注册'}
          </Button>
        </form>
        <p className="mt-4 text-center text-[12.5px] text-muted-foreground">
          已有账号？
          <Link to="/login" className="ml-1 text-primary hover:underline">
            去登录
          </Link>
        </p>
      </div>
    </div>
  )
}
