/** Visual identity per constructor (accent colour + display name). */
interface TeamStyle { color: string; short: string }

export const TEAMS: Record<string, TeamStyle> = {
  mercedes:     { color: '#00D7B6', short: 'Mercedes' },
  ferrari:      { color: '#ED1131', short: 'Ferrari' },
  mclaren:      { color: '#F47600', short: 'McLaren' },
  red_bull:     { color: '#4781D7', short: 'Red Bull' },
  rb:           { color: '#6C98FF', short: 'Racing Bulls' },
  alpine:       { color: '#00A1E8', short: 'Alpine' },
  haas:         { color: '#B6BABD', short: 'Haas' },
  audi:         { color: '#F2003C', short: 'Audi' },
  williams:     { color: '#1868DB', short: 'Williams' },
  aston_martin: { color: '#229971', short: 'Aston Martin' },
  cadillac:     { color: '#8A8F98', short: 'Cadillac' },
  // historical constructors (2015-2025)
  sauber:       { color: '#D7262A', short: 'Sauber' },
  alfa:         { color: '#C92D4B', short: 'Alfa Romeo' },
  alphatauri:   { color: '#6F8FBF', short: 'AlphaTauri' },
  toro_rosso:   { color: '#469BFF', short: 'Toro Rosso' },
  racing_point: { color: '#F596C8', short: 'Racing Point' },
  force_india:  { color: '#F596C8', short: 'Force India' },
  renault:      { color: '#FFD500', short: 'Renault' },
  lotus_f1:     { color: '#C9A227', short: 'Lotus' },
  manor:        { color: '#E1241E', short: 'Manor' },
}

export const team = (id: string): TeamStyle =>
  TEAMS[id] ?? { color: '#888', short: id.replace(/_/g, ' ') }
