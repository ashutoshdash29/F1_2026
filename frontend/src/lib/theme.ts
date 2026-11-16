import { useCallback, useState } from 'react'

export type Theme = 'dark' | 'light'

/** Theme lives on <html data-theme>. Switching uses a circular View Transition from the toggle. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(
    () => (document.documentElement.dataset.theme as Theme) || 'dark',
  )

  const toggle = useCallback((origin?: { x: number; y: number }) => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    const apply = () => {
      document.documentElement.dataset.theme = next
      try { localStorage.setItem('pitwall-theme', next) } catch { /* private mode */ }
      setTheme(next)
    }
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }
    if (!doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return apply()
    const x = origin?.x ?? innerWidth - 40, y = origin?.y ?? 40
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
    doc.startViewTransition(apply).ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 750, easing: 'cubic-bezier(.7,0,.2,1)', pseudoElement: '::view-transition-new(root)' },
      )
    })
  }, [theme])

  return { theme, toggle }
}
