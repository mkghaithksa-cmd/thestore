// Light / dark appearance. Both apps share one saved choice (same site).
// "auto" follows the phone or computer setting. index.html applies the
// saved choice before the page draws, so there is no flash.
export type ThemeChoice = 'auto' | 'light' | 'dark'

const KEY = 'ghaith-theme'

export const THEME_LABELS: Record<ThemeChoice, string> = {
  light: 'فاتح',
  dark: 'ليلي',
  auto: 'حسب الجهاز',
}

export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

/** What is on screen now (auto resolved through the device setting). */
export function effectiveTheme(choice: ThemeChoice = getThemeChoice()): 'light' | 'dark' {
  if (choice !== 'auto') return choice
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement
  if (choice === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', choice)
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, choice)
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  applyTheme(choice)
  window.dispatchEvent(new CustomEvent('ghaith-theme', { detail: choice }))
}
