import { useCallback, useEffect, useState } from 'react'
import { AppLockScreen } from './components/AppLockScreen'
import {
  APP_PASSWORD_CHANGED,
  isAppPasswordEnabled,
  SESSION_UNLOCKED,
} from './lib/appPassword'
import { DashboardView } from './views/DashboardView'
import { POSView } from './views/POSView'
import { SalesHistoryView } from './views/SalesHistoryView'
import { InventoryView } from './views/InventoryView'
import { ReceiptSettingsView } from './views/ReceiptSettingsView'
import './App.css'

type Tab = 'dashboard' | 'pos' | 'sales' | 'inventory' | 'receipt'

const tabs: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'pos', label: 'Point of sale' },
  { id: 'sales', label: 'Sales & receipts' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'receipt', label: 'Receipt printout' },
]

type Gate = 'loading' | 'locked' | 'open'

export default function App() {
  const [tab, setTab] = useState<Tab>('pos')
  const [gate, setGate] = useState<Gate>('loading')
  const [passwordOn, setPasswordOn] = useState(false)

  const refreshGate = useCallback(async () => {
    const enabled = await isAppPasswordEnabled()
    setPasswordOn(enabled)
    if (!enabled) {
      setGate('open')
      sessionStorage.removeItem(SESSION_UNLOCKED)
      return
    }
    const sessionOk = sessionStorage.getItem(SESSION_UNLOCKED) === '1'
    setGate(sessionOk ? 'open' : 'locked')
  }, [])

  useEffect(() => {
    const t = requestAnimationFrame(() => {
      void refreshGate()
    })
    return () => cancelAnimationFrame(t)
  }, [refreshGate])

  useEffect(() => {
    const onPasswordChange = () => {
      void refreshGate()
    }
    window.addEventListener(APP_PASSWORD_CHANGED, onPasswordChange)
    return () => window.removeEventListener(APP_PASSWORD_CHANGED, onPasswordChange)
  }, [refreshGate])

  const lockNow = () => {
    sessionStorage.removeItem(SESSION_UNLOCKED)
    setGate('locked')
  }

  if (gate === 'loading') {
    return (
      <div className="app app-loading">
        <p className="muted">Loading…</p>
      </div>
    )
  }

  if (gate === 'locked') {
    return <AppLockScreen onUnlocked={() => setGate('open')} />
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <img
            src="/logo.png"
            alt="AL HABIB Supermart"
            className="logo"
            width={260}
            height={104}
          />
        </div>
        {passwordOn ? (
          <div className="header-actions">
            <button type="button" className="btn secondary" onClick={lockNow}>
              Lock app
            </button>
          </div>
        ) : null}
      </header>

      <nav className="main-nav" aria-label="Main">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'nav-btn active' : 'nav-btn'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="main-area">
        {tab === 'dashboard' ? <DashboardView /> : null}
        {tab === 'pos' ? <POSView /> : null}
        {tab === 'sales' ? <SalesHistoryView /> : null}
        {tab === 'inventory' ? <InventoryView /> : null}
        {tab === 'receipt' ? <ReceiptSettingsView /> : null}
      </main>

      <footer className="footer">
        One shop, one device — data stays locally (IndexedDB). Use <strong>Inventory → Export to Excel</strong> or{' '}
        <strong>Server sync</strong> for an off-device copy. Receipt wording is under <strong>Receipt printout</strong>.
      </footer>
    </div>
  )
}
