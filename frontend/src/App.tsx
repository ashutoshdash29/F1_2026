import { useCallback, useEffect, useState } from 'react'
import { Calendar } from './components/Calendar'
import { FlagWipe } from './components/FlagWipe'
import { Footer } from './components/Footer'
import { Leaders } from './components/Leaders'
import { Loader } from './components/Loader'
import { Marquee } from './components/Marquee'
import { Moments } from './components/Moments'
import { Nav } from './components/Nav'
import { SceneStage } from './components/SceneStage'
import { SeasonPicker } from './components/SeasonPicker'
import { Standings } from './components/Standings'
import { TitleChart } from './components/TitleChart'
import { loadBoot, loadSeason } from './lib/data'
import { gsap, jumpToTop, ScrollTrigger, reducedMotion, startSmoothScroll } from './lib/motion'
import { useTheme } from './lib/theme'
import type { Manifest, SeasonData, SeasonIndex } from './lib/types'

type Phase = 'idle' | 'cover' | 'reveal'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function seasonFromUrl() {
  const s = Number(new URLSearchParams(location.search).get('season'))
  return Number.isInteger(s) && s > 1949 ? s : null
}

export default function App() {
  const [boot, setBoot] = useState<{ index: SeasonIndex; media: Manifest } | null>(null)
  const [data, setData] = useState<SeasonData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picker, setPicker] = useState(false)
  const [wipe, setWipe] = useState<{ phase: Phase; season: number | null }>({ phase: 'idle', season: null })
  const { theme, toggle } = useTheme()

  // boot: season list + media, then the season from the URL (or the current one)
  useEffect(() => {
    loadBoot()
      .then(async (b) => {
        const want = seasonFromUrl()
        const season = want && b.index.seasons.some((s) => s.season === want) ? want : b.index.current
        const d = await loadSeason(season)
        setBoot(b)
        setData(d)
      })
      .catch((e) => setError(String(e.message ?? e)))
  }, [])

  /** Chequered flag in -> swap season underneath -> flag out. */
  const changeSeason = useCallback(async (season: number) => {
    if (!boot || !data || season === data.season || wipe.phase !== 'idle') return
    setPicker(false)
    const next = loadSeason(season) // start loading while the flag sweeps in
    setWipe({ phase: 'cover', season })
    try {
      const [d] = await Promise.all([next, wait(reducedMotion() ? 0 : 750)])
      const url = new URL(location.href)
      if (season === boot.index.current) url.searchParams.delete('season')
      else url.searchParams.set('season', String(season))
      history.replaceState(null, '', url)
      jumpToTop()
      setData(d)
      await wait(reducedMotion() ? 0 : 450) // let the new page mount under the flag
      setWipe({ phase: 'reveal', season })
      await wait(reducedMotion() ? 0 : 900)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    }
    setWipe({ phase: 'idle', season: null })
  }, [boot, data, wipe.phase])

  const step = useCallback((dir: -1 | 1) => {
    if (!boot || !data) return
    const list = boot.index.seasons.map((s) => s.season)
    const next = list[list.indexOf(data.season) + dir]
    if (next) changeSeason(next)
  }, [boot, data, changeSeason])

  // glass sheen follows the pointer (one delegated listener for every .sheen element)
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest?.('.sheen') as HTMLElement | null
      if (!el) return
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${e.clientX - r.left}px`)
      el.style.setProperty('--my', `${e.clientY - r.top}px`)
    }
    addEventListener('pointermove', move, { passive: true })
    return () => removeEventListener('pointermove', move)
  }, [])

  // page-wide scroll choreography; re-run for every season (the page remounts)
  useEffect(() => {
    if (!data) return
    startSmoothScroll()
    const rm = reducedMotion()
    const ctx = gsap.context(() => {
      ScrollTrigger.batch('[data-rv]', { start: 'top 88%', onEnter: (els) => els.forEach((el) => el.classList.add('in')) })
      if (rm) return
      ScrollTrigger.batch('.fx-up', {
        start: 'top 90%',
        onEnter: (els) => gsap.fromTo(els, { y: 26, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9, ease: 'power3.out', stagger: 0.08 }),
      })
      ScrollTrigger.batch('.fx-rise', {
        start: 'top 92%',
        onEnter: (els) => gsap.fromTo(els, { y: 70, opacity: 0, rotateX: -8 }, { y: 0, opacity: 1, rotateX: 0, duration: 1.1, ease: 'expo.out', stagger: 0.09 }),
      })
      gsap.utils.toArray<HTMLElement>('.fx-panel').forEach((el) =>
        gsap.fromTo(el, { y: 90, scale: 0.97, opacity: 0.2 }, {
          y: 0, scale: 1, opacity: 1, ease: 'power2.out',
          scrollTrigger: { trigger: el, start: 'top 98%', end: 'top 55%', scrub: 0.6 },
        }))
      gsap.to('.landing__head', {
        yPercent: -18, opacity: 0.35, ease: 'none',
        scrollTrigger: { trigger: '#tables', start: 'top 70%', end: 'top 10%', scrub: true },
      })
      gsap.to('.marquee', {
        rotate: -2.5, ease: 'none',
        scrollTrigger: { trigger: '.marquee', start: 'top bottom', end: 'bottom top', scrub: true },
      })
    })
    const refresh = () => ScrollTrigger.refresh()
    requestAnimationFrame(refresh)
    document.fonts?.ready.then(refresh)
    addEventListener('load', refresh)
    return () => { ctx.revert(); removeEventListener('load', refresh) }
  }, [data])

  const ready = !!(boot && data)
  const heroScene = data && boot?.media.scenes[`hero-${data.season}`] ? `hero-${data.season}` : 'hero'
  const seasons = boot?.index.seasons.map((s) => s.season) ?? []

  return (
    <>
      <Loader ready={ready} error={error} />
      {boot && data && (
        <>
          <SceneStage media={boot.media} ready season={data.season} heroScene={heroScene} />
          <Nav theme={theme} onToggle={toggle} round={data.round} total={data.totalRounds}
            season={data.season} onSeason={() => setPicker(true)} />
          <main key={data.season}>
            <Standings data={data} media={boot.media} heroScene={heroScene}
              onPickSeason={() => setPicker(true)} onStep={step}
              hasPrev={seasons[0] < data.season} hasNext={seasons[seasons.length - 1] > data.season} />
            <Marquee words={data.drivers.slice(0, 10).map((d) => d.last.toUpperCase())} />
            <Leaders data={data} media={boot.media} />
            <TitleChart data={data} />
            <Moments media={boot.media} season={data.season} heroScene={heroScene} />
            <Calendar data={data} />
          </main>
          <Footer data={data} media={boot.media} />
          <SeasonPicker index={boot.index} media={boot.media} current={data.season} open={picker}
            onClose={() => setPicker(false)} onPick={changeSeason} />
        </>
      )}
      <FlagWipe phase={wipe.phase} season={wipe.season}
        label={wipe.season && boot?.index.seasons.find((s) => s.season === wipe.season)?.complete === false ? 'Live season' : 'Season replay'} />
    </>
  )
}
