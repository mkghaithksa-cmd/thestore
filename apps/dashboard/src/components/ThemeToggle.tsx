import { useEffect, useState } from 'react'
import { effectiveTheme, getThemeChoice, setThemeChoice, type ThemeChoice } from '@ghaith/shared'

/** The saved choice and what is on screen, kept in step with other tabs and the device setting. */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(getThemeChoice)
  const [dark, setDark] = useState(() => effectiveTheme() === 'dark')
  useEffect(() => {
    const sync = () => {
      const c = getThemeChoice()
      setChoice(c)
      setDark(effectiveTheme(c) === 'dark')
    }
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    window.addEventListener('ghaith-theme', sync)
    window.addEventListener('storage', sync)
    mq?.addEventListener?.('change', sync)
    return () => {
      window.removeEventListener('ghaith-theme', sync)
      window.removeEventListener('storage', sync)
      mq?.removeEventListener?.('change', sync)
    }
  }, [])
  return { choice, dark, set: setThemeChoice }
}

/** Sun / moon button: one tap switches between light and dark. */
export function ThemeToggle({ className = 'cart-btn' }: { className?: string }) {
  const { dark, set } = useTheme()
  const label = dark ? 'تحويل للوضع الفاتح' : 'تحويل للوضع الليلي'
  return (
    <button type="button" className={`${className} theme-btn`} onClick={() => set(dark ? 'light' : 'dark')} aria-label={label} title={label}>
      {dark ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
        </svg>
      )}
    </button>
  )
}
