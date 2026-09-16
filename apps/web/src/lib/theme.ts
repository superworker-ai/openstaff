import { useSyncExternalStore } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'openstaff.theme'

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  return preference === 'system' ? prefersDark ? 'dark' : 'light' : preference
}

export function readPreference(storage: Pick<Storage, 'getItem'> | undefined): ThemePreference {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY)
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(targetDocument: Document, resolved: ResolvedTheme) {
  targetDocument.documentElement.dataset.theme = resolved
  targetDocument.documentElement.style.colorScheme = resolved
  let themeColor = targetDocument.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!themeColor) {
    themeColor = targetDocument.createElement('meta')
    themeColor.name = 'theme-color'
    targetDocument.head.append(themeColor)
  }
  themeColor.content = resolved === 'dark' ? '#0d0d0f' : '#ffffff'
}

export const THEME_BOOT_SCRIPT = `(function(){try{var preference=window.localStorage.getItem('${THEME_STORAGE_KEY}');var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=preference==='dark'||(preference!=='light'&&preference!=='dark'&&prefersDark)?'dark':'light';document.documentElement.dataset.theme=resolved;document.documentElement.style.colorScheme=resolved;}catch(error){}})();`

type ThemeSnapshot = { preference: ThemePreference; resolved: ResolvedTheme }

const serverSnapshot: ThemeSnapshot = { preference: 'system', resolved: 'light' }
let browserSnapshot = serverSnapshot
const subscribers = new Set<() => void>()
let stopBrowserListeners: (() => void) | undefined

function mediaQuery(): MediaQueryList | undefined {
  try {
    return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? undefined
      : window.matchMedia('(prefers-color-scheme: dark)')
  } catch {
    return undefined
  }
}

function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

function updateSnapshot(preference: ThemePreference, prefersDark: boolean, notify = true) {
  const resolved = resolveTheme(preference, prefersDark)
  if (typeof document !== 'undefined') applyTheme(document, resolved)
  if (browserSnapshot.preference === preference && browserSnapshot.resolved === resolved) return
  browserSnapshot = { preference, resolved }
  if (notify) subscribers.forEach((subscriber) => subscriber())
}

function syncFromBrowser(notify = true) {
  updateSnapshot(readPreference(browserStorage()), mediaQuery()?.matches ?? false, notify)
}

function startListening() {
  if (typeof window === 'undefined' || stopBrowserListeners) return
  syncFromBrowser(false)
  const media = mediaQuery()
  const onMediaChange = (event: MediaQueryListEvent) => {
    if (browserSnapshot.preference === 'system') updateSnapshot('system', event.matches)
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) syncFromBrowser()
  }
  media?.addEventListener('change', onMediaChange)
  window.addEventListener('storage', onStorage)
  stopBrowserListeners = () => {
    media?.removeEventListener('change', onMediaChange)
    window.removeEventListener('storage', onStorage)
    stopBrowserListeners = undefined
  }
}

function subscribe(subscriber: () => void) {
  subscribers.add(subscriber)
  startListening()
  return () => {
    subscribers.delete(subscriber)
    if (!subscribers.size) stopBrowserListeners?.()
  }
}

function setBrowserPreference(preference: ThemePreference) {
  try {
    browserStorage()?.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // The visual preference still applies when storage is unavailable.
  }
  updateSnapshot(preference, mediaQuery()?.matches ?? false)
}

export function useTheme(): ThemeSnapshot & { setPreference: (preference: ThemePreference) => void } {
  const snapshot = useSyncExternalStore(subscribe, () => browserSnapshot, () => serverSnapshot)
  return { ...snapshot, setPreference: setBrowserPreference }
}
