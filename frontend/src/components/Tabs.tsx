import { useLayoutEffect, useRef, useState } from 'react'

interface Tab<T extends string> { id: T; label: string; hint?: string }

/** Segmented glass tabs with a sliding indicator. */
export function Tabs<T extends string>({ tabs, value, onChange, label }: {
  tabs: Tab<T>[]; value: T; onChange: (v: T) => void; label: string
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [ind, setInd] = useState({ x: 0, w: 0 })

  useLayoutEffect(() => {
    const measure = () => {
      const el = wrap.current?.querySelector<HTMLButtonElement>(`[data-tab="${value}"]`)
      if (el) setInd({ x: el.offsetLeft, w: el.offsetWidth })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(wrap.current!)
    document.fonts?.ready.then(measure)
    return () => ro.disconnect()
  }, [value])

  const onKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === value)
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1
    if (n < 0 && e.key !== 'ArrowLeft') return
    const next = tabs[(n + tabs.length) % tabs.length]
    onChange(next.id)
    wrap.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus()
  }

  return (
    <div className="tabs" role="tablist" aria-label={label} ref={wrap} onKeyDown={onKey}>
      <span className="tabs__ind" style={{ transform: `translateX(${ind.x}px)`, width: ind.w }} aria-hidden="true" />
      {tabs.map((t) => (
        <button key={t.id} role="tab" data-tab={t.id} aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1} className="tabs__btn" onClick={() => onChange(t.id)}>
          {t.label}
          {t.hint && <span className="tabs__hint">{t.hint}</span>}
        </button>
      ))}
    </div>
  )
}
