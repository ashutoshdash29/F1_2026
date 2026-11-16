import { useRef, type CSSProperties, type PointerEvent } from 'react'
import { ordinal, pts } from '../lib/format'
import { team } from '../lib/teams'
import type { Manifest, SeasonData } from '../lib/types'
import { Count, Reveal } from './Bits'
import { driverSrc, TeamLogo } from './Media'

function TiltCard({ children, className, style }: { children: React.ReactNode; className: string; style?: CSSProperties }) {
  const ref = useRef<HTMLElement>(null)
  const move = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    const r = ref.current!.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5
    ref.current!.style.setProperty('--rx', `${-y * 7}deg`)
    ref.current!.style.setProperty('--ry', `${x * 9}deg`)
  }
  const leave = () => { ref.current!.style.setProperty('--rx', '0deg'); ref.current!.style.setProperty('--ry', '0deg') }
  // GSAP animates the <article>; the tilt lives on the inner glass so the two transforms never fight
  return (
    <article ref={ref} className={className} style={style} onPointerMove={move} onPointerLeave={leave}>
      <div className="pcard__in glass sheen">{children}</div>
    </article>
  )
}

export function Leaders({ data, media }: { data: SeasonData; media: Manifest }) {
  const top = data.drivers.slice(0, 3)
  const order = [top[1], top[0], top[2]].filter(Boolean)
  const teams = data.constructors.slice(0, 3)
  const teamName = (id: string) => data.constructors.find((c) => c.id === id)?.name ?? id

  return (
    <section id="leaders" className="sec leaders" data-scene="crowd" data-side="left">
      <header className="sec__head sec__head--right">
        <p className="eyebrow fx-up">The front runners</p>
        <h2 className="h2"><Reveal text="Top of the order" /></h2>
        <p className="lede fx-up">{data.round >= data.totalRounds
          ? `The three drivers who defined the ${data.season} season, over ${data.totalRounds} rounds.`
          : `The three drivers who have shaped the ${data.season} season so far, after ${data.round} rounds.`}</p>
      </header>

      <div className="podium">
        {order.map((d) => {
          const t = team(d.teamId)
          const photo = driverSrc(media, d.id, data.season)
          return (
            <TiltCard key={d.id} className={`pcard pcard--p${d.pos} fx-rise`} style={{ '--team': t.color } as CSSProperties}>
              <div className="pcard__photo">
                {photo ? <img src={`/${photo}`} alt={`${d.first} ${d.last}`} loading="lazy" /> : <span className="pcard__ph">{d.code}</span>}
              </div>
              <span className="pcard__pos" aria-hidden="true">{d.pos}</span>
              <div className="pcard__body">
                <p className="pcard__rank">{ordinal(d.pos ?? 0)} · {d.code}{d.number != null && <> · #{d.number}</>}</p>
                <h3 className="pcard__name"><span>{d.first}</span>{d.last}</h3>
                <div className="pcard__team"><TeamLogo media={media} id={d.teamId} name={teamName(d.teamId)} /> {t.short}</div>
                <dl className="pcard__stats">
                  <div><dt>Points</dt><dd><Count to={d.points} decimals={d.points % 1 ? 1 : 0} /></dd></div>
                  <div><dt>Wins</dt><dd><Count to={d.wins} duration={900} /></dd></div>
                  <div><dt>Podiums</dt><dd><Count to={d.podiums} duration={900} /></dd></div>
                  <div><dt>Poles</dt><dd><Count to={d.poles} duration={900} /></dd></div>
                </dl>
              </div>
            </TiltCard>
          )
        })}
      </div>

      <div className="cpodium">
        {teams.map((c) => (
          <div key={c.id} className="ctile glass sheen fx-rise" style={{ '--team': team(c.id).color } as CSSProperties}>
            <span className="ctile__pos">P{c.pos}</span>
            <TeamLogo media={media} id={c.id} name={c.name} size="lg" />
            <span className="ctile__pts"><b>{pts(c.points)}</b> pts · {c.wins} wins</span>
          </div>
        ))}
      </div>
    </section>
  )
}
