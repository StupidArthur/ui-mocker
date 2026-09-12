export function EmptyState({ icon, title, desc }: { icon: string; title: string; desc?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-3 text-[40px] leading-none text-muted-foreground/40">{icon}</div>
      <div className="text-[15px] font-semibold text-muted-foreground">{title}</div>
      {desc && <div className="mt-1 text-[12.5px] text-muted-foreground/60">{desc}</div>}
    </div>
  )
}
