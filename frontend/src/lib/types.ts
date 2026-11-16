export interface Credit { title: string; author: string | null; license: string | null; url: string | null }
export interface MediaItem {
  src: string; credit: Credit | null; half?: string
  /** era-correct photo for a given season (year -> path), where one exists */
  bySeason?: Record<string, string>
}
export interface Scene extends MediaItem {
  caption?: string; place?: string; focus: string
  /** set on a season's "moments" photos */
  season?: number; round?: number; kind?: string
}
export interface Manifest {
  drivers: Record<string, MediaItem>
  teams: Record<string, MediaItem>
  scenes: Record<string, Scene>
}

export interface RaceRef { id: string; code: string; name: string; teamId?: string }
export interface Race {
  round: number; name: string; date: string; timeUtc: string | null
  circuitId: string; circuit: string; locality: string; country: string
  sprint: boolean; completed: boolean; winner: RaceRef | null; pole?: RaceRef | null
}
export interface DriverStanding {
  id: string; code: string; number: number | null; first: string; last: string
  nationality: string; dob: string | null; teamId: string
  /** null = not classified in the championship */
  pos: number | null; prevPos: number | null; points: number; prevPoints: number | null; wins: number
  podiums: number; poles: number; fastestLaps: number; dnfs: number; starts: number
  avgFinish: number | null; history: number[]
  /** GP result per standings round: '1'..'22', 'R' retired, 'D' DSQ, 'W' withdrawn, null = absent */
  finishes: (string | null)[]
}
export interface ConstructorStanding {
  id: string; name: string; nationality: string
  pos: number | null; prevPos: number | null; points: number; prevPoints: number | null; wins: number
  podiums: number; dnfs: number; drivers: string[]; history: number[]
}
export interface SeasonData {
  season: number; generatedAt: string; round: number; rounds: number[]; totalRounds: number
  lastRace: Race | null; nextRace: Race | null; calendar: Race[]
  drivers: DriverStanding[]; constructors: ConstructorStanding[]
}

export interface SeasonSummary {
  season: number; round: number; totalRounds: number; complete: boolean
  driver: { id: string; code: string; name: string; teamId: string; points: number; wins: number }
  constructor: { id: string; name: string; points: number }
}
export interface SeasonIndex { current: number; seasons: SeasonSummary[] }
