import { useEffect, useRef, useState } from 'react'
import { isComplete, pointsStillAvailable } from '../lib/data'
import { fmtDate, pts } from '../lib/format'
import { gsap, ScrollTrigger, reducedMotion } from '../lib/motion'
import { team } from '../lib/teams'
import type { Manifest, SeasonData } from '../lib/types'
import { Count, Reveal } from './Bits'
import { ConstructorTable } from './ConstructorTable'
import { DriverTable } from './DriverTable'
import { Tabs } from './Tabs'

type View = 'drivers' | 'constructors' | 'both'

export function Standings({ data, media, heroScene = 'hero', onPickSeason, onStep, hasPrev, hasNext }: {
  data: SeasonData; media: Manifest; heroScene?: string
  onPickSeason: () => void; onStep: (dir: -1 | 1) => void; hasPrev: boolean; hasNext: boolean
}) {
  const [view, setView] = useState<View>(() => {
    try { return (sessionStorage.getItem('pitwall-view') as View) || 'drivers' } catch { return 'drivers' }
  })
  const body = useRef<HTMLDivElement>(null)
  const first = useRef(true)

  const available = pointsStillAvailable(data)
  const complete = isComplete(data)
  const [p1, p2] = data.drivers
  const contenders = data.drivers.filter((d) => d.points + available >= p1.points)
  const last = data.lastRace
  const roundNames = data.rounds.map((r) => {
    const c = data.calendar.find((x) => x.round === r)
    return `R${r}${c ? ' ' + c.name.replace(' Grand Prix', ' GP') : ''}`
  })

  // animate rows whenever the view changes (and on first scroll into view)
  useEffect(() => {
    try { sessionStorage.setItem('pitwall-view', view) } catch { /* ignore */ }
    if (reducedMotion()) return
    const rows = body.current!.querySelectorAll('.srow')
    const play = () => gsap.fromTo(rows, { y: 22, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.7, ease: 'power3.out', stagger: 0.035, overwrite: true, clearProps: 'transform,opacity' })
    if (first.current) {
      first.current = false
      gsap.set(rows, { opacity: 0 })
      const st = ScrollTrigger.create({ trigger: body.current, start: 'top 85%', once: true, onEnter: play })
      return () => st.kill()
    }
    play()
    ScrollTrigger.refresh()
  }, [view])

  return (
    <section id="standings" className="sec landing" data-scene={heroScene} data-side="right">
      <header className="landing__head">
        <div className="landing__top fx-up">
          <p className="eyebrow">{complete ? <span className="dot-done" /> : <span className="dot-live" />}FIA Formula One World Championship</p>
          <div className="season-ctl" role="group" aria-label="Season">
            <button type="button" className="season-ctl__step" onClick={() => onStep(-1)} disabled={!hasPrev} aria-label="Previous season">
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 2.5 4 6l3.5 3.5" /></svg>
            </button>
            <button type="button" className="season-ctl__year" onClick={onPickSeason} title="Choose a season">
              <span>{data.season}</span><em>{complete ? 'Season' : 'Live'}</em>
            </button>
            <button type="button" className="season-ctl__step" onClick={() => onStep(1)} disabled={!hasNext} aria-label="Next season">
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 8 6 4.5 9.5" /></svg>
            </button>
          </div>
        </div>
        <h1 className="display">
          <Reveal text={complete ? `${data.season} Final` : 'Championship'} className="display__l1" />
          <Reveal text="Standings" className="display__l2" />
        </h1>
        {last && (
          <p className="landing__sub fx-up">
            {complete ? <>All <b>{data.totalRounds}</b> rounds · decided at the {last.name}, {last.locality}</> : <>After round <b>{data.round}</b> of {data.totalRounds} · {last.name}, {last.locality}</>}
            <span className="muted"> · {fmtDate(last.date, { day: 'numeric', month: 'long' })}</span>
          </p>
        )}
        <div className="kpis fx-up">
          <div className="kpi glass sheen" style={{ '--team': team(p1.teamId).color } as React.CSSProperties}>
            <span className="kpi__label">{complete ? 'World Champion' : 'Leader'}</span>
            <span className={`kpi__value${p1.last.length > 8 ? ' kpi__value--long' : ''}`}>{p1.last}</span>
            <span className="kpi__foot"><Count to={p1.points} decimals={p1.points % 1 ? 1 : 0} /> pts · {p1.wins} wins</span>
          </div>
          {p2 && (
            <div className="kpi glass sheen">
              <span className="kpi__label">{complete ? 'Winning margin' : 'Gap to P2'}</span>
              <span className="kpi__value"><Count to={p1.points - p2.points} decimals={(p1.points - p2.points) % 1 ? 1 : 0} /></span>
              <span className="kpi__foot">over {p2.last}</span>
            </div>
          )}
          {complete ? (
            <div className="kpi glass sheen" style={{ '--team': team(data.constructors[0].id).color } as React.CSSProperties}>
              <span className="kpi__label">Constructors' title</span>
              <span className="kpi__value">{team(data.constructors[0].id).short}</span>
              <span className="kpi__foot"><Count to={data.constructors[0].points} decimals={data.constructors[0].points % 1 ? 1 : 0} /> pts · {data.constructors[0].wins} wins</span>
            </div>
          ) : (
            <div className="kpi glass sheen">
              <span className="kpi__label">Still on the table</span>
              <span className="kpi__value"><Count to={available} /></span>
              <span className="kpi__foot">{data.totalRounds - data.round} rounds to go</span>
            </div>
          )}
          {contenders.length > 1 ? (
            <div className="kpi glass sheen">
              <span className="kpi__label">In contention</span>
              <span className="kpi__value">{contenders.length}</span>
              <span className="kpi__foot">{contenders.map((d) => d.code).join(' · ')}</span>
            </div>
          ) : (
            <div className="kpi kpi--champ glass sheen">
              <span className="kpi__label">{available > 0 ? 'Title' : 'Race wins'}</span>
              <span className="kpi__value">{available > 0 ? 'Clinched' : <Count to={p1.wins} />}</span>
              <span className="kpi__foot">{available > 0 ? `${p1.first} ${p1.last}` : `${p1.podiums} podiums · ${p1.poles} poles`}</span>
            </div>
          )}
        </div>
      </header>

      <div className="panel glass glass--strong sheen fx-panel" id="tables">
        <div className="panel__bar">
          <Tabs<View> label="Championship" value={view} onChange={setView} tabs={[
            { id: 'drivers', label: 'Drivers', hint: String(data.drivers.length) },
            { id: 'constructors', label: 'Constructors', hint: String(data.constructors.length) },
            { id: 'both', label: 'Side by side' },
          ]} />
          <p className="panel__note">
            {complete ? 'Final classification · ' : ''}Updated {new Date(data.generatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            <span className="hide-sm"> · Leader {pts(p1.points)} pts</span>
          </p>
        </div>
        <div className={`panel__body view-${view}`} ref={body} role="tabpanel" aria-label={view}>
          {view === 'drivers' && <DriverTable drivers={data.drivers} constructors={data.constructors} media={media} available={available} roundNames={roundNames} season={data.season} />}
          {view === 'constructors' && <ConstructorTable constructors={data.constructors} media={media} />}
          {view === 'both' && (
            <div className="both">
              <div><h3 className="both__h">Drivers</h3><DriverTable compact drivers={data.drivers} constructors={data.constructors} media={media} available={available} season={data.season} /></div>
              <div><h3 className="both__h">Constructors</h3><ConstructorTable compact constructors={data.constructors} media={media} /></div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
