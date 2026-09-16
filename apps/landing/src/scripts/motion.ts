import { animate, inView, scroll, stagger } from 'motion'

const preference = '(prefers-reduced-motion: reduce)'
const ease = [0.23, 1, 0.32, 1] as const

export function prefersReducedMotion(): boolean {
  return window.matchMedia(preference).matches
}

// Changes to the OS preference also stop motion already in progress.
export function whenMotionOk(fn: () => void | (() => void)): void {
  if (prefersReducedMotion()) return
  const media = window.matchMedia(preference)
  const cleanup = fn()
  const onChange = () => {
    if (!media.matches) return
    cleanup?.()
    media.removeEventListener('change', onChange)
  }
  media.addEventListener('change', onChange)
}

const root = document.documentElement
root.dataset.motionReady = ''

whenMotionOk(() => {
  const stop: (() => void)[] = []
  const animated = document.querySelectorAll<HTMLElement>('[data-hero-reveal], [data-mock-reveal], .horizon [data-reveal]')
  const reset = () => {
    root.classList.remove('motion-ok')
    stop.forEach((cleanup) => cleanup())
    animated.forEach((element) => {
      element.style.removeProperty('opacity')
      element.style.removeProperty('transform')
    })
    document.querySelectorAll<HTMLElement>('.horizon-image, .sun-glow').forEach((element) => {
      element.style.removeProperty('transform')
      element.style.removeProperty('opacity')
      element.style.removeProperty('will-change')
    })
  }

  try {
    // If the loading watchdog has already revealed the page, don't hide it again.
    if (!root.classList.contains('motion-ok')) return reset
    const hero = document.querySelector<HTMLElement>('[data-hero-reveal]')
    if (hero) {
      const entrance = animate(hero, { opacity: [0, 1], transform: ['translateY(12px)', 'translateY(0)'] }, { duration: 0.5, ease })
      stop.push(() => entrance.stop())
    }
    stop.push(inView('[data-mock-reveal]', (element) => {
      const entrance = animate(element, { opacity: [0, 1], transform: ['translateY(16px)', 'translateY(0)'] }, { duration: 0.55, ease })
      stop.push(() => entrance.stop())
      // No leave callback: Motion unobserves this target after its first entrance.
    }, { amount: 0.3 }))

    const section = document.querySelector<HTMLElement>('[data-horizon]')
    const img = section?.querySelector<HTMLElement>('.horizon-image')
    const glow = section?.querySelector<HTMLElement>('.sun-glow')
    if (section && img && glow) {
      const parallax = animate(img, { transform: ['translateY(-6%) scale(1.12)', 'translateY(6%) scale(1)'] }, { ease: 'linear' })
      stop.push(scroll(parallax, { target: section, offset: ['start end', 'end start'] }))
      stop.push(() => parallax.stop())

      const shimmer = animate(glow, { opacity: [0.5, 0.9, 0.5] }, { duration: 6, repeat: Infinity, ease: 'easeInOut', autoplay: false })
      stop.push(() => shimmer.stop())
      stop.push(inView(section, () => {
        img.style.willChange = 'transform'
        shimmer.play()
        return () => {
          img.style.removeProperty('will-change')
          shimmer.pause()
        }
      }))
      stop.push(inView(section, () => {
        const entrance = animate(
          section.querySelectorAll('[data-reveal]'),
          { opacity: [0, 1], transform: ['translateY(24px)', 'translateY(0)'] },
          { duration: 0.6, ease, delay: stagger(0.06) },
        )
        stop.push(() => entrance.stop())
      }, { amount: 0.35 }))
    }
  } catch (error) {
    reset()
    console.error('Motion unavailable; showing the static page.', error)
  }
  return reset
})
