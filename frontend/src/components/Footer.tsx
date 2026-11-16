import type { Credit, Manifest, SeasonData } from '../lib/types'

export function Footer({ data, media }: { data: SeasonData; media: Manifest }) {
  const credits: Credit[] = [
    ...Object.values(media.scenes), ...Object.values(media.drivers), ...Object.values(media.teams),
  ].map((m) => m.credit).filter((c): c is Credit => !!c)
  const seen = new Set<string>()
  const unique = credits.filter((c) => !seen.has(c.title) && seen.add(c.title))
  return (
    <footer className="foot" data-scene="safetycar" data-side="right">
      <div className="foot__big" aria-hidden="true">PITWALL<sup>26</sup></div>
      <div className="foot__grid glass">
        <p>Data: Jolpica F1 API (Ergast-compatible), exported {new Date(data.generatedAt).toLocaleString('en-GB')}.</p>
        <p>Unofficial fan project. Not affiliated with Formula 1, the FIA or any team.</p>
        <details>
          <summary>Photo credits ({unique.length})</summary>
          <ul>
            {unique.map((c) => (
              <li key={c.title}>
                {c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.title}</a> : c.title}
                {c.author && <> · {c.author}</>}{c.license && <> · {c.license}</>}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </footer>
  )
}
