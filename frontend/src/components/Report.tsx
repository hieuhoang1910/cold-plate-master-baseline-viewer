import { useMemo, useState } from 'react'
import { generateReport } from '../report'
import type { BaselineResult, Catalog, DesignState, Project } from '../types'

export function Report({
  project, catalog, live, design, onClose,
}: {
  project: Project | null
  catalog: Catalog
  live: BaselineResult | null
  design: DesignState | null
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const md = useMemo(
    () => generateReport(project, catalog, live, design, new Date().toLocaleString()),
    [project, catalog, live, design],
  )

  const copy = async () => {
    try { await navigator.clipboard.writeText(md); setCopied(true); setTimeout(() => setCopied(false), 1500) }
    catch { /* clipboard blocked; the textarea is selectable */ }
  }
  const download = () => {
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(project?.name ?? 'design').replace(/[^\w.-]+/g, '_')}-review.md`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  return (
    <div className="about-overlay" onClick={onClose}>
      <div className="about-card report" onClick={(e) => e.stopPropagation()}>
        <div className="about-head">
          <h2>Design review report</h2>
          <button className="about-close" onClick={onClose}>✕</button>
        </div>
        <div className="report-actions">
          <button className="ds2-save" onClick={download}>⬇ Download .md</button>
          <button className="vo-reset" onClick={copy}>{copied ? 'Copied ✓' : 'Copy Markdown'}</button>
          <span className="muted" style={{ fontSize: 11 }}>
            Print-ready review of the current problem + selected design + candidates + provenance.
          </span>
        </div>
        <pre className="report-md">{md}</pre>
      </div>
    </div>
  )
}
