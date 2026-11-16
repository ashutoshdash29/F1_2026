import { useEffect, useState } from 'react'
import { reducedMotion } from '../lib/motion'

/** Five red lights come on one by one, then "lights out" once data is ready. */
export function Loader({ ready, error }: { ready: boolean; error: string | null }) {
  const [lit, setLit] = useState(0)
  const [out, setOut] = useState(false)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    if (reducedMotion()) { setLit(5); return }
    const t = setInterval(() => setLit((n) => Math.min(5, n + 1)), 280)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!ready || lit < 5) return
    const a = setTimeout(() => setOut(true), reducedMotion() ? 0 : 450)
    const b = setTimeout(() => setGone(true), reducedMotion() ? 50 : 1500)
    return () => { clearTimeout(a); clearTimeout(b) }
  }, [ready, lit])

  if (gone) return null
  return (
    <div className={`loader${out ? ' is-out' : ''}`} role="status" aria-live="polite">
      <div className="loader__gantry">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className="loader__pod"><i className={!out && i < lit ? 'on' : ''} /><i className={!out && i < lit ? 'on' : ''} /></span>
        ))}
      </div>
      <p className="loader__txt">{error ? error : out ? 'Lights out and away we go' : 'Loading the grid'}</p>
    </div>
  )
}
