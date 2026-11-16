import type { Manifest, SeasonData, SeasonIndex } from './types'

const EMPTY_MANIFEST: Manifest = { drivers: {}, teams: {}, scenes: {} }

/** Single place the UI gets data from - swap for an API later without touching components. */
async function json<T>(url: string, missing: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(missing)
  return r.json() as Promise<T>
}

export async function loadBoot(): Promise<{ index: SeasonIndex; media: Manifest }> {
  const [index, media] = await Promise.all([
    json<SeasonIndex>('/data/seasons/index.json', 'seasons/index.json missing - run `npm run data`'),
    fetch('/media/manifest.json', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : EMPTY_MANIFEST))
      .catch(() => EMPTY_MANIFEST),
  ])
  return { index, media }
}

const seasonCache = new Map<number, Promise<SeasonData>>()
export function loadSeason(season: number): Promise<SeasonData> {
  if (!seasonCache.has(season)) {
    const p = json<SeasonData>(`/data/seasons/${season}.json`, `No data for ${season}`)
    p.catch(() => seasonCache.delete(season))
    seasonCache.set(season, p)
  }
  return seasonCache.get(season)!
}

/** Has every round of the season been run? */
export const isComplete = (d: SeasonData) => d.round >= d.totalRounds

/** Points a driver can still score after the latest standings round (25/race, 8/sprint). */
export function pointsStillAvailable(d: SeasonData) {
  return d.calendar
    .filter((r) => r.round > d.round)
    .reduce((sum, r) => sum + 25 + (r.sprint ? 8 : 0), 0)
}

/** per-round points scored, derived from the cumulative history */
export function perRound(history: number[]) {
  return history.map((v, i) => v - (i ? history[i - 1] : 0))
}
