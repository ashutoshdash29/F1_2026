import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { gsap, reducedMotion, ScrollTrigger } from '../lib/motion'
import { pts } from '../lib/format'
import { team } from '../lib/teams'
import type { SeasonData } from '../lib/types'
import { Reveal } from './Bits'

const DURATION = 10 // seconds from round 1 to the latest round
const M = { t: 18, r: 92, b: 34, l: 44 }

/**
 * Cumulative points for every driver in the championship, round by round.
 * Lines take their team's colour; the second driver of each team is dashed so teammates stay
 * distinguishable (identity never rests on colour alone: legend + head labels carry the codes).
 * Hover a legend chip or a line to spotlight a driver; click to pin.
 * Each time the chart scrolls into view it replays: a play-head travels from R1 to the latest
 * round at constant speed (DURATION seconds), and every line grows continuously - the tip is
 * interpolated between rounds every frame, so there are no visible 20-step jumps.
 */
export function TitleChart({ data }: { data: SeasonData }) {
  const wrap = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const clipRect = useRef<SVGRectElement>(null)
  const readout = useRef<HTMLSpanElement>(null)
  const progress = useRef(0) // fractional round index currently drawn (0 = R1)
  const tween = useRef<gsap.core.Tween | null>(null)
  const clipId = useId().replace(/:/g, '')
  const [w, setW] = useState(900)
  const [hover, setHover] = useState<number | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  // drivers toggled on via the legend; when non-empty only these drivers' markers are shown
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const hasSel = selected.size > 0
  // hover spotlights one driver (only among visible ones); otherwise the selection is the focus
  const focusSet = useMemo(() => {
    if (hoverId && (!hasSel || selected.has(hoverId))) return new Set([hoverId])
    return selected
  }, [hoverId, selected, hasSel])
  const isFocus = (id: string) => focusSet.has(id)
  const anyFocus = focusSet.size > 0
  const h = w < 640 ? 400 : 560
  // every classified driver, in championship order; teammate #2 gets a dashed line
  const series = useMemo(() => {
    const seen = new Set<string>()
    return data.drivers.filter((d) => d.history.length).map((d) => {
      const dashed = seen.has(d.teamId)
      seen.add(d.teamId)
      return { ...d, color: team(d.teamId).color, dashed }
    })
  }, [data])
  // legend grouped by team, in constructors' order
  const groups = useMemo(() => {
    const order = data.constructors.map((c) => c.id)
    const by = new Map<string, typeof series>()
    series.forEach((d) => by.set(d.teamId, [...(by.get(d.teamId) ?? []), d]))
    return [...by.entries()].sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99))
  }, [series, data.constructors])
  const rounds = data.rounds
  const last = rounds.length - 1

  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, e.contentRect.width)))
    ro.observe(wrap.current!)
    return () => ro.disconnect()
  }, [])

  const geo = useMemo(() => {
    const max = Math.ceil(Math.max(...series.map((d) => d.points), 50) / 50) * 50
    const iw = w - M.l - M.r, ih = h - M.t - M.b
    const x = (i: number) => M.l + (last > 0 ? (i / last) * iw : iw / 2) // accepts fractional i
    const y = (v: number) => M.t + ih - (v / max) * ih
    const ticks = Array.from({ length: 5 }, (_, i) => (max / 4) * i)
    return { max, x, y, ticks, iw }
  }, [w, h, series, last])

  const race = (i: number) => data.calendar.find((c) => c.round === rounds[i])

  /** Paint the chart at fractional round t. Runs every animation frame, straight on the DOM. */
  const draw = useCallback((t: number) => {
    progress.current = t
    const s = svg.current
    if (!s) return
    const i0 = Math.floor(t), f = t - i0, i1 = Math.min(last, i0 + 1)
    const hx = geo.x(t)
    clipRect.current?.setAttribute('width', String(Math.max(0, hx + 1.5)))

    const vals = series.map((d) => (d.history[i0] ?? 0) * (1 - f) + (d.history[i1] ?? 0) * f)

    // each label sits exactly level with its own dot (labels may overlap - that's intended)
    s.querySelectorAll<SVGGElement>('.tc__head').forEach((g, k) => {
      const dot = g.querySelector('circle')!, txt = g.querySelector('text')!, val = g.querySelector('.tc__val')!
      const cy = String(geo.y(vals[k]))
      dot.setAttribute('cx', String(hx))
      dot.setAttribute('cy', cy)
      txt.setAttribute('x', String(hx + 10))
      txt.setAttribute('y', cy)
      val.textContent = ' ' + pts(Math.round(vals[k] * 2) / 2)
    })
    if (readout.current) {
      const r = race(Math.round(t))
      readout.current.textContent = `R${rounds[Math.round(t)]}${r ? ' · ' + r.name.replace(' Grand Prix', ' GP') : ''}`
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, series, last, rounds])

  // keep the current frame correct when the chart resizes
  useLayoutEffect(() => { draw(progress.current) }, [draw])

  const play = useCallback(() => {
    if (reducedMotion()) return draw(last)
    const state = { t: 0 }
    tween.current?.kill()
    tween.current = gsap.to(state, { t: last, duration: DURATION, ease: 'none', onUpdate: () => draw(state.t) })
  }, [draw, last])

  // replay every time the chart enters the viewport (from above or below); reset when it leaves
  useEffect(() => {
    if (reducedMotion()) { draw(last); return }
    draw(0)
    const reset = () => { tween.current?.kill(); draw(0) }
    const st = ScrollTrigger.create({
      trigger: wrap.current, start: 'top 75%', end: 'bottom 15%',
      refreshPriority: -1,
      onEnter: play, onEnterBack: play, onLeave: reset, onLeaveBack: reset,
    })
    return () => { st.kill(); tween.current?.kill() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play])

  const onMove = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect()
    const i = Math.round(((e.clientX - r.left - M.l) / geo.iw) * last)
    // only allow hovering rounds that have already been drawn
    setHover(i >= 0 && i <= Math.floor(progress.current + 1e-6) ? i : null)
  }
  const tipLeft = hover != null ? geo.x(hover) : 0

  return (
    <section id="title-fight" className="sec tfight" data-scene="leclerc" data-side="right">
      <header className="sec__head">
        <p className="eyebrow fx-up">Title fight</p>
        <h2 className="h2"><Reveal text="How the gap was built" /></h2>
        <p className="lede fx-up">Cumulative championship points for all {series.length} drivers, after every round. Hover a name to follow one driver; click names to show only the drivers you pick.</p>
      </header>
      <div className="tc glass glass--strong sheen fx-panel">
        <div className="tc__top">
          <ul className="tc__legend tc__legend--teams" aria-label="Legend: drivers grouped by team">
            {groups.map(([tid, ds]) => (
              <li key={tid} className="tc__team">
                {ds.map((d) => (
                  <button key={d.id} type="button"
                    className={`tc__chip${isFocus(d.id) ? ' is-on' : ''}${anyFocus && !isFocus(d.id) ? ' is-dim' : ''}`}
                    aria-pressed={selected.has(d.id)} title={`${d.first} ${d.last} · ${team(d.teamId).short}`}
                    onMouseEnter={() => setHoverId(d.id)} onMouseLeave={() => setHoverId(null)}
                    onFocus={() => setHoverId(d.id)} onBlur={() => setHoverId(null)}
                    onClick={() => toggle(d.id)}>
                    <svg className="sw sw--line" viewBox="0 0 18 4" aria-hidden="true">
                      <line x1="1" y1="2" x2="17" y2="2" style={{ stroke: d.color }} strokeDasharray={d.dashed ? '4 3' : undefined} />
                    </svg>
                    {d.code}
                  </button>
                ))}
              </li>
            ))}
          </ul>
          <div className="tc__ctl">
            {hasSel && (
              <button type="button" className="tc__replay" onClick={() => setSelected(new Set())} aria-label="Show all drivers">
                Show all
              </button>
            )}
            <span className="tc__readout" ref={readout} aria-hidden="true" />
            <button type="button" className="tc__replay" onClick={play} aria-label="Replay the season">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" /></svg>
              Replay
            </button>
          </div>
        </div>
        <div className="tc__plot" ref={wrap}>
          <svg ref={svg} width={w} height={h} role="img" onPointerMove={onMove} onPointerLeave={() => { setHover(null); setHoverId(null) }}
            className={[anyFocus && 'has-focus', hasSel && 'has-sel'].filter(Boolean).join(' ') || undefined}
            aria-label={`Line chart of cumulative points. ${series.map((d) => `${d.last} ${pts(d.points)}`).join(', ')}.`}>
            <defs>
              <clipPath id={clipId}><rect ref={clipRect} x={0} y={0} height={h} /></clipPath>
            </defs>
            {geo.ticks.map((t) => (
              <g key={t} className="tc__grid">
                <line x1={M.l} x2={w - M.r} y1={geo.y(t)} y2={geo.y(t)} />
                <text x={M.l - 10} y={geo.y(t)} dy="0.32em" textAnchor="end">{t}</text>
              </g>
            ))}
            {rounds.map((r, i) => (i % (w < 640 ? 4 : 2) === 0 || i === last) && (
              <text key={r} className="tc__x" x={geo.x(i)} y={h - 10} textAnchor="middle">R{r}</text>
            ))}
            {hover != null && <line className="tc__cross" x1={geo.x(hover)} x2={geo.x(hover)} y1={M.t} y2={h - M.b} />}
            <g clipPath={`url(#${clipId})`}>
              {series.map((d) => {
                const path = d.history.map((v, i) => `${i ? 'L' : 'M'}${geo.x(i).toFixed(1)},${geo.y(v).toFixed(1)}`).join('')
                return (
                  <g key={d.id} className={`tc__series${isFocus(d.id) ? ' is-focus' : ''}${selected.has(d.id) ? ' is-sel' : ''}`}>
                    <path className="tc__line" d={path} style={{ stroke: d.color }} strokeDasharray={d.dashed ? '7 5' : undefined} />
                    {/* wide invisible hit area so a thin line is easy to point at */}
                    <path className="tc__hit" d={path} onPointerEnter={() => setHoverId(d.id)} onPointerLeave={() => setHoverId(null)}
                      onClick={() => toggle(d.id)} />
                  </g>
                )
              })}
            </g>
            {hover != null && series.filter((d) => !anyFocus || isFocus(d.id)).map((d) => (
              <circle key={d.id} className="tc__dot" r={anyFocus && focusSet.size <= 3 ? 5.5 : 3.5} cx={geo.x(hover)} cy={geo.y(d.history[hover] ?? 0)} style={{ fill: d.color }} />
            ))}
            {/* moving heads: positions and values are written by draw() every frame */}
            {series.map((d) => (
              <g key={d.id} className={`tc__head${isFocus(d.id) ? ' is-focus' : ''}${selected.has(d.id) ? ' is-sel' : ''}`}>
                <circle r={series.length > 10 ? 3.5 : 4.5} style={{ fill: d.color }} />
                <text dy="0.32em"><tspan className="tc__code">{d.code}</tspan><tspan className="tc__val" /></text>
              </g>
            ))}
          </svg>
          {hover != null && (
            <div className={`tc__tip glass glass--strong${series.filter((d) => !anyFocus || isFocus(d.id)).length > 10 ? ' tc__tip--cols' : ''}`}
              style={{ left: tipLeft, transform: `translateX(${tipLeft > w * 0.55 ? 'calc(-100% - 14px)' : '14px'})` }}>
              <p className="tc__tiph">R{rounds[hover]} · {race(hover)?.name.replace(' Grand Prix', ' GP')}</p>
              <div className="tc__rows">
                {series.filter((d) => !anyFocus || isFocus(d.id)).map((d) => ({ d, v: d.history[hover] ?? 0 }))
                  .sort((a, b) => b.v - a.v).map(({ d, v }, i) => (
                    <p key={d.id} className="tc__row">
                      <span className="tc__rank">{i + 1}</span>
                      <svg className="sw sw--line" viewBox="0 0 18 4" aria-hidden="true">
                        <line x1="1" y1="2" x2="17" y2="2" style={{ stroke: d.color }} strokeDasharray={d.dashed ? '4 3' : undefined} />
                      </svg>
                      {d.code}<b>{pts(v)}</b>
                    </p>
                  ))}
              </div>
            </div>
          )}
        </div>
        <p className="tc__note">Solid line = team's lead driver, dashed = teammate. Replays each time you scroll back to it; hover for round-by-round totals. Exact figures are in the standings table above.</p>
      </div>
    </section>
  )
}
