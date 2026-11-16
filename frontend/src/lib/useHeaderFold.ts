import { useEffect, useRef } from 'react'
import { reducedMotion } from './motion'

/**
 * Inside a scrolling table frame with a sticky <thead>, rows never slide behind the header:
 * as a row reaches the header's bottom edge it fades out and folds down (rotating on its bottom
 * edge), so its visible top stays pinned to the header line until it has fully disappeared.
 * Driven straight on the DOM from the scroll position - no React re-renders.
 */
export function useHeaderFold<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const scroller = ref.current
    const table = scroller?.querySelector('table')
    // the sticky element is the header cell (the <thead> box itself scrolls away)
    const head = table?.querySelector<HTMLElement>('thead th')
    if (!scroller || !table || !head) return
    const reduce = reducedMotion()
    const folded = new Set<HTMLElement>()
    let raf = 0

    const update = () => {
      raf = 0
      const st = scroller.scrollTop
      // the sticky header sits at the top of the scroller; fold rows a few px before its edge
      const line = head.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top + 4
      // table position in scroll-content coordinates (the table itself is never transformed)
      const tableTop = table.getBoundingClientRect().top - scroller.getBoundingClientRect().top + st
      // read every row's layout first, then write styles: interleaving reads and writes forced a
      // style/layout recalculation per row on every scroll frame
      const rowsEls = [...table.querySelectorAll<HTMLElement>('tbody > tr')]
      const geo = rowsEls.map((tr) => [tr.offsetTop, tr.offsetHeight || 1] as const)
      rowsEls.forEach((tr, i) => {
        const [offTop, h] = geo[i]
        const top = tableTop + offTop - st // layout position, unaffected by our transform
        const p = Math.min(1, Math.max(0, (line - top) / h))
        if (p <= 0) {
          if (folded.delete(tr)) { tr.style.removeProperty('transform'); tr.style.removeProperty('opacity'); tr.style.removeProperty('visibility') }
          return
        }
        folded.add(tr)
        // angle chosen so the projected height is h*(1-p): the row's top stays on the header line
        const deg = (Math.acos(1 - p) * 180) / Math.PI
        tr.style.transform = reduce ? '' : `perspective(900px) rotateX(${deg.toFixed(2)}deg)`
        tr.style.opacity = String(Math.pow(1 - p, 1.6).toFixed(3))
        tr.style.visibility = p >= 1 ? 'hidden' : ''
      })
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update) }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(onScroll)
    ro.observe(scroller)
    update()
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      ro.disconnect()
      cancelAnimationFrame(raf)
      folded.forEach((tr) => { tr.style.removeProperty('transform'); tr.style.removeProperty('opacity'); tr.style.removeProperty('visibility') })
    }
  }, [])
  return ref
}
