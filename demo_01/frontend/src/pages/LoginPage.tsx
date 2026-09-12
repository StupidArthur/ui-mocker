import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'

import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth'

export default function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (user) return <Navigate to="/datasets" replace />

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await login(username, password)
      toast('登录成功', 'success')
      navigate('/datasets')
    } catch (err) {
      toast(err instanceof Error ? err.message : '登录失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-[380px] rounded-xl border border-border bg-card p-7 shadow-sm">
        <div className="mb-6">
          <h1 className="text-[19px] font-semibold">Data-Algorithm Studio</h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">登录以进入数据算法工作室</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="username">用户名</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
              autoComplete="username"
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
              placeholder="请输入密码"
              autoComplete="current-password"
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={submitting} data-testid="login-submit">
            {submitting ? '登录中…' : '登录'}
          </Button>
        </form>
        <p className="mt-4 text-center text-[12.5px] text-muted-foreground">
          还没有账号？
          <Link to="/register" className="ml-1 text-primary hover:underline">
            去注册
          </Link>
        </p>
      </div>
    </div>
  )
}
