import type { Preview, StatSummary } from '@/lib/api'

function cell(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'number') return value.toFixed(4)
  return String(value)
}

export function PreviewTable({ preview }: { preview: Preview }) {
  if (!preview || preview.columns.length === 0) {
    return <div className="py-6 text-center text-[12.5px] text-muted-foreground">无数据</div>
  }
  return (
    <div className="max-h-[42vh] overflow-auto rounded-md border border-border">
      <table className="w-full border-collapse text-[12px]">
        <thead className="sticky top-0 bg-secondary">
          <tr>
            {preview.columns.map((col) => (
              <th
                key={col.name}
                className="whitespace-nowrap border-b border-border px-3 py-2 text-left font-medium text-foreground/80"
              >
                {col.name}
                <span className="ml-1 font-normal text-muted-foreground/60">{col.dtype}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row, idx) => (
            <tr key={idx} className="odd:bg-background/60 hover:bg-secondary/40">
              {preview.columns.map((col) => (
                <td
                  key={col.name}
                  className="whitespace-nowrap border-b border-border/60 px-3 py-1.5 font-mono text-foreground/90"
                >
                  {cell(row[col.name])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SummaryGrid({ summary }: { summary: StatSummary[] }) {
  if (!summary || summary.length === 0) {
    return <div className="text-[12.5px] text-muted-foreground">无数值列</div>
  }
  return (
    <div className="overflow-auto rounded-md border border-border">
      <table className="w-full border-collapse text-[12px]">
        <thead className="bg-secondary">
          <tr>
            {['位号', '数量', '缺失率', '均值', '标准差', '最小', '最大'].map((h) => (
              <th
                key={h}
                className="whitespace-nowrap border-b border-border px-3 py-2 text-left font-medium text-foreground/80"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {summary.map((s) => (
            <tr key={s.name} className="odd:bg-background/60">
              <td className="border-b border-border/60 px-3 py-1.5 font-medium">{s.name}</td>
              <td className="border-b border-border/60 px-3 py-1.5 font-mono">{s.count}</td>
              <td className="border-b border-border/60 px-3 py-1.5 font-mono">{s.missing_rate}</td>
              <td className="border-b border-border/60 px-3 py-1.5 font-mono">{s.mean ?? '-'}</td>
              <td className="border-b border-border/60 px-3 py-1.5 font-mono">{s.std ?? '-'}</td>
              <td className="border-b border-border/60 px-3 py-1.5 font-mono">{s.min ?? '-'}</td>
              <td className="border-b border-border/60 px-3 py-1.5 font-mono">{s.max ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
