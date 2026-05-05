import { useEffect, useRef, useState } from 'react'
import { SESSION_KEY_NAME, SESSION_ROLE, SESSION_UNLOCKED, verifyAppKey, type AppUserRole } from '../lib/appPassword'

type Props = {
  onUnlocked: (role: AppUserRole) => void
}

export function AppLockScreen({ onUnlocked }: Props) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Prevent browser from jumping/scrolling when lock input receives focus.
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const p = password.trim()
    if (!p) {
      setError('Enter your password.')
      return
    }
    setBusy(true)
    try {
      const result = await verifyAppKey(p)
      if (!result.ok || !result.role) {
        setError('Wrong password. Try again.')
        setPassword('')
        return
      }
      sessionStorage.setItem(SESSION_UNLOCKED, '1')
      sessionStorage.setItem(SESSION_ROLE, result.role)
      sessionStorage.setItem(SESSION_KEY_NAME, result.keyName ?? '')
      onUnlocked(result.role)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-lock-screen">
      <div className="app-lock-card card">
        <img
          src="/logo.png"
          alt=""
          className="app-lock-logo"
          width={100}
          height={40}
        />
        <h1 className="app-lock-title">Supermart suite</h1>
        <p className="hint app-lock-hint">Enter your app password to continue.</p>
        <form onSubmit={submit} className="app-lock-form">
          <label>
            Password
            <input
              ref={inputRef}
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={busy}
            />
          </label>
          {error ? <p className="app-lock-error">{error}</p> : null}
          <button type="submit" className="btn primary app-lock-btn" disabled={busy}>
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  )
}
