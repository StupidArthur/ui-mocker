import type { ReactNode } from 'react'

interface Props {
  title: string
  desc?: string
  meta1?: string
  meta2?: string
  badges?: ReactNode
  actions?: ReactNode
  onClick: () => void
}

export function ListCard({ title, desc, meta1, meta2, badges, actions, onClick }: Props) {
  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-lg border border-border bg-card p-4 transition-all duration-200 hover:-translate-y-px hover:border-[hsl(var(--ring))] hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-[14.5px] font-semibold text-foreground">{title}</div>
        {badges}
      </div>
      {desc && <div className="mt-1 line-clamp-3 text-[12.5px] text-muted-foreground">{desc}</div>}
      {(meta1 || meta2) && (
        <div className="mt-2 flex justify-between border-t border-border pt-2 text-[11.5px] text-muted-foreground/70">
          <span className="truncate font-mono">{meta1}</span>
          <span className="whitespace-nowrap">{meta2}</span>
        </div>
      )}
      {actions && (
        <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  )
}
