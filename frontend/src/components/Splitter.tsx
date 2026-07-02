import { useRef } from 'react'

/**
 * VS Code–style drag handle between panels.
 *
 *  - `dir='col'` is a vertical bar you drag left/right (resizes a column).
 *  - `dir='row'` is a horizontal bar you drag up/down (resizes the bottom panel).
 *
 * It reports the *incremental* pixel delta on each pointer move; the parent
 * decides which panel grows/shrinks and clamps the size. Pointer capture +
 * window-level listeners keep the drag alive even when the cursor passes over
 * the 3D canvas (which otherwise swallows pointer events). Double-click resets.
 */
export function Splitter({ dir, onResize, onReset }: {
  dir: 'col' | 'row'
  onResize: (deltaPx: number) => void
  onReset?: () => void
}) {
  const last = useRef(0)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    last.current = dir === 'col' ? e.clientX : e.clientY
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.classList.add(dir === 'col' ? 'resizing-col' : 'resizing-row')

    const move = (ev: PointerEvent) => {
      const now = dir === 'col' ? ev.clientX : ev.clientY
      const d = now - last.current
      if (d !== 0) { last.current = now; onResize(d) }
    }
    const up = () => {
      document.body.classList.remove('resizing-col', 'resizing-row')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      className={`splitter ${dir}`}
      role="separator"
      aria-orientation={dir === 'col' ? 'vertical' : 'horizontal'}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
    />
  )
}
