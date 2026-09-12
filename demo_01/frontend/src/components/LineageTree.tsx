import { GitBranch } from 'lucide-react'

import type { LineageNode } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Props {
  nodes: LineageNode[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function LineageTree({ nodes, selectedId, onSelect }: Props) {
  const childrenMap = new Map<string | null, LineageNode[]>()
  for (const node of nodes) {
    const key = node.parent_id
    if (!childrenMap.has(key)) childrenMap.set(key, [])
    childrenMap.get(key)!.push(node)
  }

  const roots = childrenMap.get(null) ?? []

  const renderNode = (node: LineageNode, depth: number) => (
    <div key={node.id}>
      <button
        onClick={() => onSelect(node.id)}
        data-testid="lineage-node"
        data-node-title={node.title}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        className={cn(
          'flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-[12.5px] transition-colors',
          selectedId === node.id
            ? 'bg-[hsl(var(--accent))]/15 font-medium text-foreground'
            : 'text-muted-foreground hover:bg-[hsl(var(--accent))]/10 hover:text-foreground',
        )}
      >
        <span
          className={cn(
            'h-1.5 w-1.5 flex-shrink-0 rounded-full',
            node.node_type === 'root' ? 'bg-primary' : 'bg-[#2f9e6f]',
          )}
        />
        <span className="truncate">{node.title}</span>
      </button>
      {(childrenMap.get(node.id) ?? []).map((child) => renderNode(child, depth + 1))}
    </div>
  )

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-1.5 px-1 text-[12.5px] font-medium text-foreground/80">
        <GitBranch className="h-3.5 w-3.5" /> 血缘树
      </div>
      {roots.length === 0 ? (
        <div className="px-1 py-3 text-[12.5px] text-muted-foreground">暂无节点</div>
      ) : (
        <div className="space-y-0.5">{roots.map((root) => renderNode(root, 0))}</div>
      )}
    </div>
  )
}
