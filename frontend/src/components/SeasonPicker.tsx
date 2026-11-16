import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { pts } from '../lib/format'
import { reducedMotion } from '../lib/motion'
import { team } from '../lib/teams'
import type { Manifest, SeasonIndex } from '../lib/types'
import { driverSrc, TeamLogo } from './Media'

/**
 * "Pick a lap": every season is a marshal post around a circuit. Hover / arrow keys preview a
 * season; choosing one drives the car forward round the track to that post (through the
 * start/finish line if it has to), then hands over to the chequered-flag transition.
 */

// A stylised circuit (not a real track): long start/finish straight at the bottom, run clockwise.
const TRACK =
  'M 150 430 L 640 430 C 760 430 812 400 846 330 C 880 260 904 196 862 142 C 820 88 736 104 696 150 ' +
  'L 626 232 C 596 266 548 268 524 236 L 470 160 C 438 114 380 94 322 112 L 196 152 ' +
  'C 120 176 86 228 86 300 C 86 372 96 430 150 430 Z'
const VB = { w: 960, h: 520 }
const LIGHTS = 15

interface Pt { x: number; y: number; a: number }

export function SeasonPicker({ index, media, current, open, onClose, onPick }: {
  index: SeasonIndex; media: Manifest; current: number; open: boolean
  onClose: () => void; onPick: (season: number) => void
}) {
  const seasons = index.seasons
  const pathRef = useRef<SVGPathElement>(null)
  const carRef = useRef<SVGGElement>(null)
  const trailRef = useRef<SVGPathElement>(null)
  const [len, setLen] = useState(0)
  const [marks, setMarks] = useState<(Pt & { at: number; lx: number; ly: number; anchor: 'start' | 'end' | 'middle' })[]>([])
  const [preview, setPreview] = useState(current)
  const [driving, setDriving] = useState(false)
  const [revs, setRevs] = useState(0)
  const carAt = useRef(0) // current distance along the track
  const raf = useRef(0)

  // geometry: posts spaced evenly by arc length, labels pushed outward from the track's centre
  useLayoutEffect(() => {
    const p = pathRef.current
    if (!p) return
    const L = p.getTotalLength()
    setLen(L)
    const pts: Pt[] = Array.from({ length: 80 }, (_, i) => { const q = p.getPointAtLength((i / 80) * L); return { x: q.x, y: q.y, a: 0 } })
    const cx = pts.reduce((s, q) => s + q.x, 0) / pts.length, cy = pts.reduce((s, q) => s + q.y, 0) / pts.length
    setMarks(seasons.map((_, i) => {
      const at = ((i + 0.5) / seasons.length) * L
      const q = p.getPointAtLength(at), q2 = p.getPointAtLength((at + 2) % L)
      const a = Math.atan2(q2.y - q.y, q2.x - q.x)
      let nx = -Math.sin(a), ny = Math.cos(a)
      if (nx * (q.x - cx) + ny * (q.y - cy) < 0) { nx = -nx; ny = -ny } // outward
      const lx = q.x + nx * 40, ly = q.y + ny * 34
      return { x: q.x, y: q.y, a, at, lx, ly, anchor: Math.abs(nx) < 0.35 ? 'middle' : nx > 0 ? 'start' : 'end' }
    }))
  }, [seasons])

  const placeCar = useCallback((d: number) => {
    const p = pathRef.current, car = carRef.current
    if (!p || !car || !len) return
    const at = ((d % len) + len) % len
    const q = p.getPointAtLength(at), q2 = p.getPointAtLength((at + 1.5) % len)
    car.setAttribute('transform', `translate(${q.x} ${q.y}) rotate(${(Math.atan2(q2.y - q.y, q2.x - q.x) * 180) / Math.PI})`)
    trailRef.current?.setAttribute('stroke-dashoffset', String(len - at))
  }, [len])

  // park the car at the current season whenever the picker opens
  useEffect(() => {
    if (!open || !marks.length) return
    const i = Math.max(0, seasons.findIndex((s) => s.season === current))
    carAt.current = marks[i].at
    placeCar(carAt.current)
    setPreview(current)
    setDriving(false)
    setRevs(0)
  }, [open, marks, current, seasons, placeCar])

  const drive = useCallback((season: number) => {
    if (driving) return
    const i = seasons.findIndex((s) => s.season === season)
    if (i < 0 || !marks.length) return
    if (season === current) return onClose()
    setPreview(season)
    const from = carAt.current
    let dist = marks[i].at - (from % len)
    if (dist <= 0) dist += len // always drive forward, through the start/finish line if needed
    if (reducedMotion()) { carAt.current = marks[i].at; placeCar(carAt.current); return onPick(season) }
    setDriving(true)
    const dur = 650 + (dist / len) * 1500
    const t0 = performance.now()
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur)
      const d = from + dist * ease(t)
      placeCar(d)
      // revs follow speed: derivative of the ease curve
      const speed = t < 0.5 ? 12 * t * t : 3 * Math.pow(-2 * t + 2, 2) / 2 * 2
      setRevs(Math.round(Math.min(1, speed / 3) * LIGHTS))
      if (t < 1) raf.current = requestAnimationFrame(step)
      else {
        carAt.current = marks[i].at
        setRevs(LIGHTS)
        window.setTimeout(() => { setDriving(false); onPick(season) }, 260)
      }
    }
    raf.current = requestAnimationFrame(step)
  }, [driving, seasons, marks, len, current, onClose, onPick, placeCar])

  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  // keyboard: arrows preview, Enter drives, Esc closes
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (driving) return
      const i = seasons.findIndex((s) => s.season === preview)
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setPreview(seasons[Math.min(seasons.length - 1, i + 1)].season) }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setPreview(seasons[Math.max(0, i - 1)].season) }
      else if (e.key === 'Enter') { e.preventDefault(); drive(preview) }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [open, driving, preview, seasons, drive, onClose])

  const sel = useMemo(() => seasons.find((s) => s.season === preview) ?? seasons[seasons.length - 1], [seasons, preview])
  const champColor = team(sel.driver.teamId).color
  const photo = driverSrc(media, sel.driver.id, sel.season)

  return (
    <div className={`picker${open ? ' is-open' : ''}`} role="dialog" aria-modal="true" aria-label="Choose a season" aria-hidden={!open}
      style={{ '--champ': champColor } as CSSProperties}>
      <div className="picker__scrim" onClick={() => !driving && onClose()} />
      <div className="picker__box glass glass--strong">
        <header className="picker__head">
          <div>
            <p className="eyebrow">Season select</p>
            <h2 className="picker__title">Pick a lap</h2>
          </div>
          <div className="revs revs--picker" aria-hidden="true">
            {Array.from({ length: LIGHTS }, (_, i) => (
              <span key={i} className={`rev rev--${i < 5 ? 'g' : i < 10 ? 'r' : 'b'}${i < revs ? ' on' : ''}${revs === LIGHTS ? ' flash' : ''}`} />
            ))}
          </div>
          <button type="button" className="picker__close" onClick={onClose} aria-label="Close season select" disabled={driving}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" /></svg>
          </button>
        </header>

        <div className="picker__body">
          <div className="picker__track">
            <svg viewBox={`0 0 ${VB.w} ${VB.h}`} role="group" aria-label="Seasons around the circuit">
              <defs>
                <pattern id="pk-chk" width="10" height="10" patternUnits="userSpaceOnUse">
                  <rect width="10" height="10" fill="#fff" /><rect width="5" height="5" fill="#111" /><rect x="5" y="5" width="5" height="5" fill="#111" />
                </pattern>
              </defs>
              <path d={TRACK} className="trk__glow" />
              <path d={TRACK} className="trk__kerb" />
              <path d={TRACK} className="trk__asphalt" ref={pathRef} />
              <path d={TRACK} className="trk__line" />
              <path d={TRACK} className="trk__trail" ref={trailRef} strokeDasharray={len || 1} strokeDashoffset={len || 1} />
              {/* start / finish line */}
              <rect x="146" y="414" width="10" height="32" fill="url(#pk-chk)" className="trk__sf" />
              <text x="151" y="472" className="trk__sftxt" textAnchor="middle">START / FINISH</text>

              {marks.map((m, i) => {
                const s = seasons[i]
                const on = s.season === preview, here = s.season === current
                return (
                  <g key={s.season} className={`post${on ? ' is-on' : ''}${here ? ' is-here' : ''}`} tabIndex={0} role="button"
                    aria-label={`${s.season}: ${s.complete ? 'champion' : 'leader'} ${s.driver.name}`}
                    style={{ '--c': team(s.driver.teamId).color, '--i': i } as CSSProperties}
                    onMouseEnter={() => !driving && setPreview(s.season)} onFocus={() => !driving && setPreview(s.season)}
                    onClick={() => drive(s.season)}>
                    <circle cx={m.x} cy={m.y} r="22" className="post__hit" />
                    <circle cx={m.x} cy={m.y} r="7" className="post__dot" />
                    <text x={m.lx} y={m.ly} textAnchor={m.anchor} className="post__year">{s.season}</text>
                    <text x={m.lx} y={m.ly + 17} textAnchor={m.anchor} className="post__code">{s.driver.code}{s.complete ? '' : ' · live'}</text>
                  </g>
                )
              })}

              {/* the car (top-down, nose pointing along +x) */}
              <g ref={carRef} className="car" aria-hidden="true">
                <g transform="scale(1.55) translate(-17 0)">
                  <rect x="27" y="-9" width="5" height="18" rx="1.5" className="car__wing" />
                  <rect x="0" y="-8" width="4" height="16" rx="1" className="car__wing" />
                  <rect x="4" y="-10" width="7" height="5" rx="1.5" className="car__tyre" />
                  <rect x="4" y="5" width="7" height="5" rx="1.5" className="car__tyre" />
                  <rect x="21" y="-9" width="6" height="4" rx="1.5" className="car__tyre" />
                  <rect x="21" y="5" width="6" height="4" rx="1.5" className="car__tyre" />
                  <path d="M3 -4 L 14 -5.5 L 30 -2 L 33 0 L 30 2 L 14 5.5 L 3 4 Z" className="car__body" />
                  <circle cx="15" cy="0" r="2.4" className="car__halo" />
                </g>
              </g>
            </svg>
            {/* touch-sized season chips for small screens (the posts are too small to tap there) */}
            <div className="picker__chips" role="group" aria-label="Seasons">
              {seasons.map((s) => (
                <button key={s.season} type="button" className={`chip${s.season === preview ? ' is-on' : ''}${s.season === current ? ' is-here' : ''}`}
                  style={{ '--c': team(s.driver.teamId).color } as CSSProperties}
                  onClick={() => (s.season === preview ? drive(s.season) : setPreview(s.season))} disabled={driving}>
                  <b>{s.season}</b><em>{s.driver.code}</em>
                </button>
              ))}
            </div>
          </div>

          <aside className="picker__card" aria-live="polite">
            <div className="pcd__photo">
              {photo ? <img src={`/${photo}`} alt="" key={sel.season} /> : <span>{sel.driver.code}</span>}
            </div>
            <p className="pcd__year" key={`y${sel.season}`}>{sel.season}</p>
            <p className="eyebrow">{sel.complete ? 'World Champion' : `Leader · round ${sel.round} of ${sel.totalRounds}`}</p>
            <h3 className="pcd__name">{sel.driver.name}</h3>
            <div className="pcd__team">
              <TeamLogo media={media} id={sel.driver.teamId} name={team(sel.driver.teamId).short} />
              {team(sel.driver.teamId).short}
            </div>
            <dl className="pcd__stats">
              <div><dt>Points</dt><dd>{pts(sel.driver.points)}</dd></div>
              <div><dt>Wins</dt><dd>{sel.driver.wins}</dd></div>
              <div><dt>Rounds</dt><dd>{sel.totalRounds}</dd></div>
            </dl>
            <div className="pcd__cons">
              <TeamLogo media={media} id={sel.constructor.id} name={sel.constructor.name} size="md" />
              <span><em>{sel.complete ? "Constructors' champion" : "Constructors' leader"}</em><b>{team(sel.constructor.id).short}</b> · {pts(sel.constructor.points)} pts</span>
            </div>
            <button type="button" className="pcd__go" onClick={() => drive(sel.season)} disabled={driving}>
              {sel.season === current ? 'Stay in this season' : driving ? 'On track…' : `Lights out · ${sel.season}`}
            </button>
            <p className="pcd__hint">Hover a marshal post or use ← → · Enter to go · Esc to close</p>
          </aside>
        </div>
      </div>
    </div>
  )
}
