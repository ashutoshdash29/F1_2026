import { useEffect, useRef, useState, type CSSProperties, type ElementType } from 'react'
import { reducedMotion } from '../lib/motion'

/** Word-by-word masked reveal; animated by the [data-rv] batch in App. */
export function Reveal({ text, as: Tag = 'span', className = '' }: { text: string; as?: ElementType; className?: string }) {
  return (
    <Tag className={`rv ${className}`} data-rv aria-label={text}>
      {text.split(' ').map((w, i) => (
        <span className="rv__w" key={i} aria-hidden="true">
          <span style={{ transitionDelay: `${i * 55}ms` }}>{w}</span>
        </span>
      ))}
    </Tag>
  )
}

/** Number that counts up the first time it scrolls into view. */
export function Count({ to, decimals = 0, duration = 1400 }: { to: number; decimals?: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [val, setVal] = useState(reducedMotion() ? to : 0)
  useEffect(() => {
    if (reducedMotion()) return setVal(to)
    const el = ref.current!
    let raf = 0
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      const t0 = performance.now()
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / duration)
        setVal(to * (1 - Math.pow(1 - p, 4)))
        if (p < 1) raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }, { threshold: 0.4 })
    io.observe(el)
    return () => { io.disconnect(); cancelAnimationFrame(raf) }
  }, [to, duration])
  return <span ref={ref} className="tnum">{val.toFixed(decimals)}</span>
}

const FINISH: Record<string, string> = { R: 'DNF', D: 'DSQ', W: 'WD', N: 'NC', E: 'EX', F: 'DNQ' }

/**
 * Points scored per round as mini bars (single series, ink coloured; best visible round emphasised).
 * The whole season is rendered on a strip; the cell shows `win` rounds at a time, latest on the right.
 * Inside a hovered row it zooms (taller team-coloured bars, round numbers, GP finishing positions)
 * and a horizontal swipe / shift+wheel slides the window back through earlier races.
 */
export function FormBars({ values, finishes, rounds, win = 8, label }: {
  values: number[]; finishes?: (string | null)[]; rounds?: string[]; win?: number; label: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const offRef = useRef(0)
  const [off, setOff] = useState(0) // rounds shifted back from the latest (fractional while scrolling)
  const [sliding, setSliding] = useState(false)
  const n = values.length
  const maxOff = Math.max(0, n - win)

  useEffect(() => {
    const el = ref.current
    if (!el || maxOff === 0) return
    let idle = 0
    const onWheel = (e: WheelEvent) => {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0
      if (!d) return // plain vertical wheel still scrolls the table
      e.preventDefault() // also stops the browser's swipe-to-go-back
      ;(e as WheelEvent & { lenisStopPropagation?: boolean }).lenisStopPropagation = true // page must not move
      const cols = el.querySelectorAll<HTMLElement>('.form__col')
      const pitch = cols.length > 1 ? cols[1].offsetLeft - cols[0].offsetLeft : 23
      // swipe/scroll right -> later races (toward the latest), left -> earlier races
      offRef.current = Math.min(maxOff, Math.max(0, offRef.current - d / pitch))
      setSliding(true)
      setOff(offRef.current)
      clearTimeout(idle)
      idle = window.setTimeout(() => { // settle on whole races
        offRef.current = Math.round(offRef.current)
        setSliding(false)
        setOff(offRef.current)
      }, 140)
    }
    const row = el.closest('.srow')
    const reset = () => { clearTimeout(idle); offRef.current = 0; setSliding(false); setOff(0) }
    el.addEventListener('wheel', onWheel, { passive: false })
    row?.addEventListener('mouseleave', reset)
    return () => { el.removeEventListener('wheel', onWheel); row?.removeEventListener('mouseleave', reset); clearTimeout(idle) }
  }, [maxOff])

  const max = Math.max(25, ...values)
  const lo = Math.max(0, n - win - Math.round(off)), hi = n - Math.round(off)
  const best = Math.max(...values.slice(lo, hi))
  return (
    <span ref={ref} className={`form${finishes ? ' form--fin' : ''}${sliding ? ' is-sliding' : ''}`}
      style={{ '--off': off } as CSSProperties}
      data-more-left={off < maxOff - 0.01 || undefined} data-more-right={off > 0.01 || undefined}
      role="img" aria-label={`${label}: last ${Math.min(win, n)} rounds ${values.slice(-win).join(', ')} points`}>
      <span className="form__strip">
        {values.map((x, i) => {
          const fin = finishes?.[i] ?? null
          const pos = fin == null ? '–' : /^\d+$/.test(fin) ? `P${fin}` : (FINISH[fin] ?? fin)
          const kind = fin == null ? 'none' : /^\d+$/.test(fin) ? (+fin <= 3 ? `p${fin}` : 'num') : 'out'
          const rnd = rounds?.[i]
          return (
            <span key={i} className="form__col" title={`${rnd ? rnd + ': ' : ''}${finishes ? pos + ' · ' : ''}${x} pts`}>
              {rnd && <span className="form__rnd">{rnd.split(' ')[0]}</span>}
              <span className="form__track">
                <span className={`form__bar${x === best && x > 0 && i >= lo && i < hi ? ' is-best' : ''}${x === 0 ? ' is-zero' : ''}`}
                  style={{ '--h': `${Math.max(8, (x / max) * 100)}%` } as CSSProperties} />
              </span>
              {finishes && <span className={`form__pos form__pos--${kind}`}>{pos}</span>}
            </span>
          )
        })}
      </span>
    </span>
  )
}

/** Position change vs previous round - arrow icon + number, never colour alone. */
export function Delta({ pos, prev }: { pos: number | null; prev: number | null }) {
  if (pos == null || prev == null || prev === pos) return <span className="delta delta--same" aria-label="no change">–</span>
  const up = prev > pos
  return (
    <span className={`delta ${up ? 'delta--up' : 'delta--down'}`} aria-label={`${up ? 'up' : 'down'} ${Math.abs(prev - pos)}`}>
      <svg viewBox="0 0 10 10" aria-hidden="true"><path d={up ? 'M5 2l4 6H1z' : 'M5 8L1 2h8z'} /></svg>
      {Math.abs(prev - pos)}
    </span>
  )
}
