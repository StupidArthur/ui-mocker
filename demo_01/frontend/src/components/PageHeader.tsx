import type { ReactNode } from 'react'

export function PageHeader({
  title,
  desc,
  actions,
}: {
  title: string
  desc?: string
  actions?: ReactNode
}) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-border px-7 py-5">
      <div className="min-w-0">
        <h1 className="text-[17px] font-semibold">{title}</h1>
        {desc && <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">{desc}</p>}
      </div>
      {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
