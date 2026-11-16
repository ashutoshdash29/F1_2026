import { useEffect, useRef } from 'react'
import { gsap, reducedMotion } from '../lib/motion'
import { pad } from '../lib/format'
import type { Manifest } from '../lib/types'
import { Reveal } from './Bits'

const KIND: Record<string, string> = {
  title: 'Title decider', maiden: 'First win', comeback: 'Comeback', opener: 'Season opener', headline: 'Headline', win: 'Victory',
}

const ORDER = ['leclerc', 'norris', 'russell', 'spa', 'hamilton', 'piastri', 'verstappen', 'ferrari', 'safetycar', 'singapore']

/** Pinned section: vertical scroll drives a horizontal reel of full-height photos. */
export function Moments({ media, season, heroScene = 'spa' }: { media: Manifest; season: number; heroScene?: string }) {
  const sec = useRef<HTMLElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const counter = useRef<HTMLSpanElement>(null)
  // this season's news moments (photo + headline); generic photos only if a season has none
  const own = Object.entries(media.scenes).filter(([, sc]) => sc.season === season)
    .sort((a, b) => (a[1].round ?? 0) - (b[1].round ?? 0)).map(([id, sc]) => ({ id, ...sc }))
  const items = own.length ? own : ORDER.filter((id) => media.scenes[id]).map((id) => ({ id, ...media.scenes[id] }))

  useEffect(() => {
    if (reducedMotion() || !items.length) return
    const mm = gsap.matchMedia()
    mm.add('(min-width: 820px)', () => {
      const el = track.current!
      const dist = () => el.scrollWidth - innerWidth
      const tween = gsap.to(el, {
        x: () => -dist(), ease: 'none',
        scrollTrigger: {
          trigger: sec.current, start: 'top top', end: () => `+=${dist()}`, pin: true, scrub: 0.6,
          invalidateOnRefresh: true, anticipatePin: 1,
          onUpdate: (s) => {
            if (counter.current) counter.current.textContent = pad(Math.min(items.length, Math.max(1, Math.round(s.progress * (items.length - 1)) + 1)))
          },
        },
      })
      // inner parallax: each photo drifts inside its frame as the reel moves
      el.querySelectorAll<HTMLElement>('.reel__img').forEach((img) => {
        gsap.fromTo(img, { xPercent: -12 }, {
          xPercent: 12, ease: 'none',
          scrollTrigger: { trigger: img.parentElement, containerAnimation: tween, start: 'left right', end: 'right left', scrub: true },
        })
      })
      gsap.fromTo(el.querySelectorAll('.reel__cap'), { y: 30, opacity: 0 }, {
        y: 0, opacity: 1, stagger: 0.1,
        scrollTrigger: { trigger: sec.current, start: 'top 60%' },
      })
    })
    return () => mm.revert()
  }, [items.length])

  return (
    <section id="moments" className="sec moments" ref={sec} data-scene={heroScene} data-side="full">
      <div className="moments__hud">
        <p className="eyebrow">Moments</p>
        <span className="moments__count"><span ref={counter}>01</span> / {pad(items.length)}</span>
      </div>
      <div className="reel" ref={track}>
        <div className="reel__intro">
          <h2 className="h2 h2--xl"><Reveal text={`${season} in motion`} /></h2>
          <p className="lede">{own.length ? `Keep scrolling. The ${season} races that made the headlines, from the opener to the title decider.` : 'Keep scrolling. The cars and the places of the championship.'}</p>
          <span className="reel__hint" aria-hidden="true">Scroll <i /></span>
        </div>
        {items.map((s, i) => (
          <figure key={s.id} className={`reel__card${i % 3 === 1 ? ' reel__card--tall' : ''}`}>
            <div className="reel__frame">
              <img className="reel__img" src={`/${s.src}`} alt={s.caption ?? ''} style={{ objectPosition: s.focus }} loading="lazy" decoding="async" />
            </div>
            <figcaption className="reel__cap glass glass--strong">
              <span className="reel__n">{pad(i + 1)}</span>
              <span>
                {s.kind && KIND[s.kind] && <i className="reel__kind">{KIND[s.kind]}</i>}
                <b>{s.caption}</b><em>{s.place}</em>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}
