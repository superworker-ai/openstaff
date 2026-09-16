type ThemePreference = 'light' | 'dark' | 'system'

const storageKey = 'openstaff.theme'
const root = document.documentElement
const media = window.matchMedia('(prefers-color-scheme: dark)')
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const controls = document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]')
let transitionTimer: number | undefined

function startThemeTransition() {
  window.clearTimeout(transitionTimer)
  if (reducedMotion.matches) {
    root.classList.remove('theme-transition')
    return
  }
  root.classList.add('theme-transition')
  transitionTimer = window.setTimeout(() => root.classList.remove('theme-transition'), 650)
}

function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* Fall back to the device when storage is unavailable. */ }
  return 'system'
}

let preference = readPreference()

function syncTheme() {
  const theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference
  root.dataset.themePreference = preference
  root.dataset.theme = theme
  root.style.colorScheme = theme
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (themeColor) themeColor.content = theme === 'dark' ? '#141416' : '#ffffff'
  controls.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === preference))
  })
}

controls.forEach((button) => {
  button.addEventListener('pointerdown', () => button.setAttribute('data-pointer-active', ''))
  button.addEventListener('click', (event) => {
    const choice = button.dataset.themeChoice
    if (choice !== 'light' && choice !== 'dark' && choice !== 'system') return
    // Keyboard changes are immediate; pointer changes gently dissolve the sky.
    if (event.detail > 0) startThemeTransition()
    else root.classList.remove('theme-transition')
    preference = choice
    try {
      localStorage.setItem(storageKey, preference)
    } catch { /* The choice still applies for this visit. */ }
    syncTheme()
  })
})

const clearPointerFeedback = () => {
  controls.forEach((button) => button.removeAttribute('data-pointer-active'))
}
window.addEventListener('pointerup', clearPointerFeedback)
window.addEventListener('pointercancel', clearPointerFeedback)
window.addEventListener('blur', clearPointerFeedback)

reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) root.classList.remove('theme-transition')
})

media.addEventListener('change', () => {
  if (preference !== 'system') return
  startThemeTransition()
  syncTheme()
})

window.addEventListener('storage', (event) => {
  if (event.key !== storageKey && event.key !== null) return
  preference = readPreference()
  startThemeTransition()
  syncTheme()
})

syncTheme()
document.querySelector<HTMLElement>('[data-theme-controls]')?.removeAttribute('hidden')
