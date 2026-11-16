/**
 * Chequered-flag transition between seasons: a dark band edged with chequers sweeps in from
 * the left, covers the page while the new season loads, then carries on off to the right.
 * phase: 'idle' (hidden left) -> 'cover' (on screen) -> 'reveal' (off right) -> 'idle'
 */
export function FlagWipe({ phase, season, label }: { phase: 'idle' | 'cover' | 'reveal'; season: number | null; label: string }) {
  return (
    <div className={`flag flag--${phase}`} aria-hidden={phase === 'idle'} role="status">
      <div className="flag__band">
        <div className="flag__inner">
          <span className="flag__year">{season}</span>
          <span className="flag__label">{label}</span>
        </div>
      </div>
    </div>
  )
}
