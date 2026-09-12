import { Database, FolderOpen, Globe, LogOut, Shield, User } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { to: '/datasets', label: '数据集', icon: Database },
  { to: '/projects', label: '我的项目', icon: FolderOpen },
  { to: '/public', label: '公开项目', icon: Globe },
  { to: '/account', label: '账号设置', icon: User },
]

export function Sidebar() {
  const { user, logout } = useAuth()

  const items = [...NAV_ITEMS]
  if (user?.role === 'admin') {
    items.push({ to: '/admin', label: '管理后台', icon: Shield })
  }

  return (
    <aside className="flex w-[248px] flex-shrink-0 flex-col border-r border-border bg-card">
      <div className="px-5 py-5">
        <div className="text-[15px] font-semibold tracking-tight">Data-Algorithm</div>
        <div className="text-[11.5px] text-muted-foreground">Studio 演示站</div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13.5px] transition-colors',
                isActive
                  ? 'bg-[hsl(var(--accent))]/15 font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-[hsl(var(--accent))]/10 hover:text-foreground',
              )
            }
          >
            <item.icon className="h-4 w-4" />
            <span className="truncate">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-[12px] font-medium">
            {user?.username?.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{user?.username}</div>
            <div className="text-[11px] text-muted-foreground">
              {user?.role === 'admin' ? '管理员' : '普通用户'}
            </div>
          </div>
          <button
            onClick={() => logout()}
            title="登出"
            data-testid="logout"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}
