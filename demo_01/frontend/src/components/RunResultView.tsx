import { PreviewTable } from '@/components/PreviewTable'
import type { RunResult } from '@/lib/api'

function Table({ headers, rows }: { headers: string[]; rows: (string | number | null)[][] }) {
  return (
    <div className="overflow-auto rounded-md border border-border">
      <table className="w-full border-collapse text-[12px]">
        <thead className="bg-secondary">
          <tr>
            {headers.map((h) => (
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
          {rows.map((row, i) => (
            <tr key={i} className="odd:bg-background/60">
              {row.map((cell, j) => (
                <td key={j} className="whitespace-nowrap border-b border-border/60 px-3 py-1.5 font-mono">
                  {cell === null || cell === undefined ? '-' : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function RunResultView({ result }: { result: RunResult }) {
  const { summary, category } = result

  if (category === 'statistics' && Array.isArray(summary)) {
    if (summary.length > 0 && 'slope' in summary[0]) {
      return (
        <Table
          headers={['位号', '斜率', '截距', 'R²', '趋势']}
          rows={summary.map((s: any) => [
            s.name,
            s.slope,
            s.intercept,
            s.r2,
            s.direction === 'up' ? '上升' : s.direction === 'down' ? '下降' : '平稳',
          ])}
        />
      )
    }
    return (
      <Table
        headers={['位号', '数量', '缺失率', '均值', '标准差', '最小', '最大']}
        rows={summary.map((s: any) => [
          s.name,
          s.count,
          s.missing_rate,
          s.mean,
          s.std,
          s.min,
          s.max,
        ])}
      />
    )
  }

  if (category === 'statistics' && summary?.matrix) {
    const cols: string[] = summary.columns
    const rows = cols.map((col, i) => [col, ...summary.matrix[i]])
    return <Table headers={['位号', ...cols]} rows={rows} />
  }

  if (category === 'prediction') {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-secondary/40 p-3 text-[12.5px]">
          <div className="mb-1 font-medium text-foreground/80">算法参数与结果</div>
          <pre className="whitespace-pre-wrap font-mono text-[11.5px] text-muted-foreground">
            {JSON.stringify(summary, null, 2)}
          </pre>
        </div>
        <div>
          <div className="mb-2 text-[12.5px] font-medium text-foreground/80">
            派生数据预览（共 {result.row_count} 行）
          </div>
          <PreviewTable preview={result.preview} />
        </div>
      </div>
    )
  }

  return (
    <pre className="whitespace-pre-wrap rounded-md border border-border bg-secondary/40 p-3 font-mono text-[11.5px]">
      {JSON.stringify(summary, null, 2)}
    </pre>
  )
}
