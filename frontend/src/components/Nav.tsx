import { useEffect, useRef, useState } from 'react'
import { scrollToId } from '../lib/motion'
import type { Theme } from '../lib/theme'

const LINKS = [
  { id: 'standings', label: 'Standings' },
  { id: 'leaders', label: 'Leaders' },
  { id: 'title-fight', label: 'Title fight' },
  { id: 'moments', label: 'Moments' },
  { id: 'calendar', label: 'Calendar' },
]
const LIGHTS = 15

export function Nav({ theme, onToggle, round, total, season, onSeason }: {
  theme: Theme; onToggle: (o: { x: number; y: number }) => void; round: number; total: number
  season: number; onSeason: () => void
}) {
  const [progress, setProgress] = useState(0)
  const [current, setCurrent] = useState('standings')
  const [hidden, setHidden] = useState(false)
  const lastY = useRef(0)

  useEffect(() => {
    const onScroll = () => {
      const y = scrollY
      const max = document.documentElement.scrollHeight - innerHeight
      setProgress(max > 0 ? y / max : 0)
      setHidden(y > lastY.current && y > 300 && y - lastY.current > 4)
      if (y < lastY.current - 4) setHidden(false)
      lastY.current = y
      let cur = LINKS[0].id
      for (const l of LINKS) {
        const el = document.getElementById(l.id)
        if (el && el.getBoundingClientRect().top < innerHeight * 0.45) cur = l.id
      }
      setCurrent(cur)
    }
    onScroll()
    addEventListener('scroll', onScroll, { passive: true })
    return () => removeEventListener('scroll', onScroll)
  }, [])

  const lit = Math.round(progress * LIGHTS)
  return (
    <nav className={`nav glass glass--strong${hidden ? ' is-hidden' : ''}`} aria-label="Primary">
      <div className="revs" role="progressbar" aria-label="Page progress" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        {Array.from({ length: LIGHTS }, (_, i) => (
          <span key={i} className={`rev rev--${i < 5 ? 'g' : i < 10 ? 'r' : 'b'}${i < lit ? ' on' : ''}${lit === LIGHTS ? ' flash' : ''}`} />
        ))}
      </div>
      <a className="brand" href="#standings" onClick={(e) => { e.preventDefault(); scrollToId('standings') }}>
        <span className="brand__mark" aria-hidden="true" />
        PITWALL<sup>26</sup>
      </a>
      <ul className="nav__links">
        {LINKS.map((l) => (
          <li key={l.id}>
            <a href={`#${l.id}`} aria-current={current === l.id ? 'true' : undefined}
              onClick={(e) => { e.preventDefault(); scrollToId(l.id) }}>{l.label}</a>
          </li>
        ))}
      </ul>
      <button type="button" className="pitboard" onClick={onSeason} aria-label={`Season ${season}, round ${round} of ${total}. Change season`}>
        <span className="pitboard__year">{season}</span>
        <span className="pitboard__sub">{round >= total ? 'FINAL' : `R${round}/${total}`}</span>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" /></svg>
      </button>
      <button className="toggle" type="button" onClick={(e) => onToggle({ x: e.clientX, y: e.clientY })}
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} aria-pressed={theme === 'light'}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <mask id="moon-cut"><rect width="24" height="24" fill="white" /><circle className="toggle__cut" cx="18" cy="6" r="6" fill="black" /></mask>
          <circle className="toggle__core" cx="12" cy="12" r="5.5" mask="url(#moon-cut)" />
          <g className="toggle__rays">
            {Array.from({ length: 8 }, (_, i) => {
              const a = (i * Math.PI) / 4
              return <line key={i} x1={12 + Math.cos(a) * 8.5} y1={12 + Math.sin(a) * 8.5} x2={12 + Math.cos(a) * 10.5} y2={12 + Math.sin(a) * 10.5} />
            })}
          </g>
        </svg>
      </button>
    </nav>
  )
}
