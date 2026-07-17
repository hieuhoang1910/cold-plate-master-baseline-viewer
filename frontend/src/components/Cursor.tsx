import { useEffect, useRef } from 'react'

// V4 — custom cursor: a crisp dot with a trailing ring (lerp-follow). The ring
// grows over interactive elements and shows a "drag" label over 3-D canvases
// (containers marked data-cursor="drag"). Fine pointers only; reduced-motion
// users keep the native cursor untouched.

const INTERACTIVE = 'button, a, select, option, input, textarea, label, summary, [role=button], .cand-item, tbody tr, .v-stage'

export function Cursor() {
  const dotRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fine = window.matchMedia('(pointer: fine)').matches
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!fine || reduced) return

    document.body.classList.add('has-cursor')
    const dot = dotRef.current!
    const ring = ringRef.current!
    let mx = -100, my = -100
    let rx = -100, ry = -100
    let raf = 0
    let visible = false

    const onMove = (e: MouseEvent) => {
      mx = e.clientX; my = e.clientY
      if (!visible) {
        visible = true
        dot.style.opacity = '1'
        ring.style.opacity = '1'
      }
      const el = e.target as Element | null
      const drag = el?.closest?.('[data-cursor="drag"]')
      const hit = !drag && el?.closest?.(INTERACTIVE)
      ring.classList.toggle('hit', !!hit)
      ring.classList.toggle('drag', !!drag)
    }
    const onLeave = () => {
      visible = false
      dot.style.opacity = '0'
      ring.style.opacity = '0'
    }
    const onDown = () => ring.classList.add('down')
    const onUp = () => ring.classList.remove('down')

    const tick = () => {
      rx += (mx - rx) * 0.16
      ry += (my - ry) * 0.16
      dot.style.transform = `translate(${mx}px, ${my}px)`
      ring.style.transform = `translate(${rx}px, ${ry}px)`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    window.addEventListener('mousemove', onMove, { passive: true })
    document.documentElement.addEventListener('mouseleave', onLeave)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      document.documentElement.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('has-cursor')
    }
  }, [])

  return (
    <>
      <div ref={dotRef} className="cur-dot" aria-hidden />
      <div ref={ringRef} className="cur-ring" aria-hidden><span>drag</span></div>
    </>
  )
}
