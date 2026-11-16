import type { CSSProperties } from 'react'
import { perRound } from '../lib/data'
import { pts } from '../lib/format'
import { team } from '../lib/teams'
import type { ConstructorStanding, DriverStanding, Manifest } from '../lib/types'
import { Delta, FormBars } from './Bits'
import { DriverPhoto, TeamLogo } from './Media'
import { useHeaderFold } from '../lib/useHeaderFold'

export function DriverTable({ drivers, constructors, media, compact = false, available, roundNames, season }: {
  drivers: DriverStanding[]; constructors: ConstructorStanding[]; media: Manifest
  compact?: boolean; available: number; roundNames?: string[]; season?: number
}) {
  const scroller = useHeaderFold<HTMLDivElement>()
  const leader = drivers[0]?.points || 1
  const teamName = (id: string) => constructors.find((c) => c.id === id)?.name ?? id
  return (
    <div className="tscroll" ref={scroller}>
      <table className={`stable stable--drivers${compact ? ' stable--compact' : ''}`}>
        <caption className="sr-only">Drivers' championship standings</caption>
        <thead>
          <tr>
            <th className="c-pos" scope="col">Pos</th>
            <th className="c-name" scope="col">Driver</th>
            {!compact && <th className="c-team hide-sm" scope="col">Team</th>}
            <th className="c-num hide-sm" scope="col">Wins</th>
            {!compact && <th className="c-num hide-md" scope="col">Podiums</th>}
            {!compact && <th className="c-num hide-md" scope="col">Poles</th>}
            {!compact && <th className="c-form hide-md" scope="col" title="Hover a row, then swipe sideways (or shift + scroll) to see earlier races">Form <small>last 8 · swipe ⇆</small></th>}
            <th className="c-pts" scope="col">Points</th>
            <th className="c-gap hide-sm" scope="col">Gap</th>
          </tr>
        </thead>
        <tbody>
          {drivers.map((d) => {
            const t = team(d.teamId)
            const alive = d.points + available >= leader && available > 0
            return (
              <tr key={d.id} className={`srow p${d.pos}`} style={{ '--team': t.color } as CSSProperties}>
                <td className="c-pos">
                  <span className="pos">{d.pos ?? '–'}</span>
                  <Delta pos={d.pos} prev={d.prevPos} />
                </td>
                <th className="c-name" scope="row">
                  <span className="who">
                    <DriverPhoto media={media} id={d.id} first={d.first} last={d.last} teamId={d.teamId}
                      size={compact ? 44 : 60} season={season} />
                    <span className="who__txt">
                      <span className="who__first">{d.first}</span>
                      <span className="who__last">{d.last}</span>
                      <span className="who__meta">
                        <b>{d.code}</b>
                        {!compact && d.number != null && <span className="who__num">#{d.number}</span>}
                        {compact ? <span>{t.short}</span> : <span className="hide-sm">{d.nationality}</span>}
                        {alive && (d.pos ?? 99) > 1 && <span className="chip-live" title="Can still mathematically win the title">In contention</span>}
                      </span>
                    </span>
                  </span>
                </th>
                {!compact && (
                  <td className="c-team hide-sm">
                    <span className="teamcell">
                      <TeamLogo media={media} id={d.teamId} name={teamName(d.teamId)} />
                      <span className="hide-md">{t.short}</span>
                    </span>
                  </td>
                )}
                <td className="c-num hide-sm">{d.wins}</td>
                {!compact && <td className="c-num hide-md">{d.podiums}</td>}
                {!compact && <td className="c-num hide-md">{d.poles}</td>}
                {!compact && <td className="c-form hide-md"><FormBars values={perRound(d.history)} finishes={d.finishes} rounds={roundNames} label={`${d.last} points per round`} /></td>}
                <td className="c-pts">
                  <span className="ptsnum">{pts(d.points)}</span>
                  <span className="ptsbar"><span style={{ width: `${(d.points / leader) * 100}%` }} /></span>
                </td>
                <td className="c-gap hide-sm">{d.pos === 1 ? <span className="gap-lead">Leader</span> : `−${pts(leader - d.points)}`}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
