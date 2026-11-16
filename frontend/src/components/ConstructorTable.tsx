import type { CSSProperties } from 'react'
import { perRound } from '../lib/data'
import { pts } from '../lib/format'
import { team } from '../lib/teams'
import type { ConstructorStanding, Manifest } from '../lib/types'
import { Delta, FormBars } from './Bits'
import { TeamLogo } from './Media'
import { useHeaderFold } from '../lib/useHeaderFold'

export function ConstructorTable({ constructors, media, compact = false }: {
  constructors: ConstructorStanding[]; media: Manifest; compact?: boolean
}) {
  const scroller = useHeaderFold<HTMLDivElement>()
  const leader = constructors[0]?.points || 1
  return (
    <div className="tscroll" ref={scroller}>
      <table className={`stable stable--teams${compact ? ' stable--compact' : ''}`}>
        <caption className="sr-only">Constructors' championship standings</caption>
        <thead>
          <tr>
            <th className="c-pos" scope="col">Pos</th>
            <th className="c-name" scope="col">Constructor</th>
            <th className="c-num hide-sm" scope="col">Wins</th>
            {!compact && <th className="c-num hide-md" scope="col">Podiums</th>}
            {!compact && <th className="c-form hide-md" scope="col">Form <small>last 8</small></th>}
            <th className="c-pts" scope="col">Points</th>
            {!compact && <th className="c-gap hide-sm" scope="col">Gap</th>}
          </tr>
        </thead>
        <tbody>
          {constructors.map((c) => {
            const t = team(c.id)
            return (
              <tr key={c.id} className={`srow p${c.pos}`} style={{ '--team': t.color } as CSSProperties}>
                <td className="c-pos">
                  <span className="pos">{c.pos ?? '–'}</span>
                  <Delta pos={c.pos} prev={c.prevPos} />
                </td>
                <th className="c-name" scope="row">
                  <span className="teamcell teamcell--big">
                    <TeamLogo media={media} id={c.id} name={c.name} size={compact ? 'md' : 'lg'} />
                    <span className="sr-only">{t.short}</span>
                  </span>
                </th>
                <td className="c-num hide-sm">{c.wins}</td>
                {!compact && <td className="c-num hide-md">{c.podiums}</td>}
                {!compact && <td className="c-form hide-md"><FormBars values={perRound(c.history)} label={`${t.short} points per round`} /></td>}
                <td className="c-pts">
                  <span className="ptsnum">{pts(c.points)}</span>
                  <span className="ptsbar"><span style={{ width: `${(c.points / leader) * 100}%` }} /></span>
                </td>
                {!compact && <td className="c-gap hide-sm">{c.pos === 1 ? <span className="gap-lead">Leader</span> : `−${pts(leader - c.points)}`}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
