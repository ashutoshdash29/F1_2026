import { useEffect, useState, type CSSProperties } from 'react'
import { fmtDate, pad } from '../lib/format'
import { team } from '../lib/teams'
import type { Race, SeasonData } from '../lib/types'
import { Reveal } from './Bits'

function useCountdown(r: Race | null) {
  const target = r ? Date.parse(`${r.date}T${(r.timeUtc ?? '14:00:00Z').replace(/Z?$/, 'Z')}`) : 0
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!r) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [r])
  const s = Math.max(0, Math.floor((target - now) / 1000))
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 }
}

export function Calendar({ data }: { data: SeasonData }) {
  const next = data.nextRace
  const c = useCountdown(next)
  const done = data.calendar.filter((r) => r.completed).length
  return (
    <section id="calendar" className="sec cal" data-scene="singapore" data-side="left">
      <header className="sec__head sec__head--right">
        <p className="eyebrow fx-up">The calendar</p>
        <h2 className="h2"><Reveal text={done >= data.totalRounds ? `${data.totalRounds} rounds. Season complete.` : `${data.totalRounds} rounds. ${data.totalRounds - done} to go.`} /></h2>
      </header>

      {next && (
        <div className="next glass glass--strong sheen fx-panel">
          <div>
            <p className="eyebrow"><span className="dot-live" />Next up · Round {next.round}</p>
            <h3 className="next__name">{next.name}</h3>
            <p className="muted">{next.circuit} · {next.locality}, {next.country} · {fmtDate(next.date, { weekday: 'short', day: 'numeric', month: 'long' })}</p>
          </div>
          <div className="clock" aria-label={`${c.d} days ${c.h} hours ${c.m} minutes to lights out`}>
            {([['Days', c.d], ['Hrs', c.h], ['Min', c.m], ['Sec', c.s]] as const).map(([l, v]) => (
              <span key={l} className="clock__u"><b>{pad(v)}</b><em>{l}</em></span>
            ))}
          </div>
        </div>
      )}

      <div className="season-bar fx-up" aria-label={`${done} of ${data.totalRounds} races completed`}>
        <span style={{ width: `${(done / data.totalRounds) * 100}%` }} />
      </div>

      <ol className="rounds">
        {data.calendar.map((r) => {
          const isNext = next?.round === r.round
          return (
            <li key={r.round} className={`rtile glass fx-rise${r.completed ? ' is-done' : ''}${isNext ? ' is-next' : ''}`}
              style={r.winner?.teamId ? { '--team': team(r.winner.teamId).color } as CSSProperties : undefined}>
              <span className="rtile__top"><b>R{pad(r.round)}</b>{r.sprint && <em className="tag">Sprint</em>}<span>{fmtDate(r.date)}</span></span>
              <span className="rtile__name">{r.name.replace(' Grand Prix', '')}</span>
              <span className="rtile__loc">{r.locality}</span>
              <span className="rtile__foot">
                {r.winner ? <><i className="rtile__dot" />{r.winner.code}<small>winner</small></> : isNext ? 'Next race' : 'Upcoming'}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
