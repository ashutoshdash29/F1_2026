import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'

gsap.registerPlugin(ScrollTrigger)

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

let lenis: Lenis | null = null
const velocityListeners = new Set<(v: number) => void>()

/** Smooth scrolling driven by GSAP's ticker so ScrollTrigger stays in lock-step. */
export function startSmoothScroll() {
  if (lenis || reducedMotion()) return
  lenis = new Lenis({
    lerp: 0.12, // higher = page follows the wheel more closely (0.085 felt laggy) wheelMultiplier: 0.95, smoothWheel: true,
    // inner scroll areas (standings tables, credits list) keep the wheel only while they can still
    // move in that direction; once they hit their top/bottom the page takes over seamlessly
    allowNestedScroll: true,
  })
  lenis.on('scroll', (l: Lenis) => {
    ScrollTrigger.update()
    velocityListeners.forEach((f) => f(l.velocity))
  })
  gsap.ticker.add((t) => lenis?.raf(t * 1000))
  gsap.ticker.lagSmoothing(0)
}

export function scrollToId(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  if (lenis) lenis.scrollTo(el, { offset: -70, duration: 1.6 })
  else el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' })
}

/** Instant jump to the top (used under the season-change flag). */
export function jumpToTop() {
  if (lenis) lenis.scrollTo(0, { immediate: true, force: true })
  else window.scrollTo(0, 0)
}

export function onScrollVelocity(f: (v: number) => void) {
  velocityListeners.add(f)
  return () => void velocityListeners.delete(f)
}

export { gsap, ScrollTrigger }
