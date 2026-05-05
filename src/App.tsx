import { useCallback, useEffect, useState } from 'react'
import { AppLockScreen } from './components/AppLockScreen'
import {
  APP_PASSWORD_CHANGED,
  isAppPasswordEnabled,
  SESSION_ROLE,
  SESSION_UNLOCKED,
  type AppUserRole,
} from './lib/appPassword'
import { LOGO_SRC } from './lib/publicAssets'
import { startAutoSyncScheduler, stopAutoSyncScheduler } from './lib/sync'
import { DashboardView } from './views/DashboardView'
import { POSView } from './views/POSView'
import { SalesHistoryView } from './views/SalesHistoryView'
import { InventoryView } from './views/InventoryView'
import { ReceiptSettingsView } from './views/ReceiptSettingsView'
import './App.css'

type Tab = 'dashboard' | 'pos' | 'sales' | 'inventory' | 'receipt'
type VisibleTab = { id: Tab; label: string }

const ADMIN_TABS: VisibleTab[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'pos', label: 'Point of sale' },
  { id: 'sales', label: 'Sales & receipts' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'receipt', label: 'Printed receipt' },
]
const STAFF_TABS: VisibleTab[] = [
  { id: 'pos', label: 'Point of sale' },
  { id: 'sales', label: 'Sales & receipts' },
  { id: 'inventory', label: 'Inventory' },
]

function defaultTabForRole(nextRole: AppUserRole): Tab {
  const tabs = nextRole === 'admin' ? ADMIN_TABS : STAFF_TABS
  return tabs.some((t) => t.id === 'dashboard') ? 'dashboard' : 'pos'
}

type Gate = 'loading' | 'locked' | 'open'

export default function App() {
  const [tab, setTab] = useState<Tab>('pos')
  const [gate, setGate] = useState<Gate>('loading')
  const [passwordOn, setPasswordOn] = useState(false)
  const [role, setRole] = useState<AppUserRole>('admin')

  const refreshGate = useCallback(async () => {
    const enabled = await isAppPasswordEnabled()
    setPasswordOn(enabled)
    if (!enabled) {
      setGate('open')
      setRole('admin')
      setTab(defaultTabForRole('admin'))
      sessionStorage.removeItem(SESSION_UNLOCKED)
      sessionStorage.removeItem(SESSION_ROLE)
      return
    }
    const sessionOk = sessionStorage.getItem(SESSION_UNLOCKED) === '1'
    const savedRole = sessionStorage.getItem(SESSION_ROLE)
    if (sessionOk && (savedRole === 'admin' || savedRole === 'staff')) {
      setRole(savedRole)
      setTab(defaultTabForRole(savedRole))
      setGate('open')
    } else {
      setGate('locked')
    }
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

  useEffect(() => {
    startAutoSyncScheduler()
    return () => stopAutoSyncScheduler()
  }, [])

  const lockNow = () => {
    sessionStorage.removeItem(SESSION_UNLOCKED)
    sessionStorage.removeItem(SESSION_ROLE)
    setGate('locked')
  }

  const visibleTabs = role === 'admin' ? ADMIN_TABS : STAFF_TABS

  useEffect(() => {
    if (!visibleTabs.some((t) => t.id === tab)) {
      setTab(defaultTabForRole(role))
    }
  }, [tab, visibleTabs, role])

  if (gate === 'loading') {
    return (
      <div className="app app-loading">
        <p className="muted">Loading…</p>
      </div>
    )
  }

  if (gate === 'locked') {
    return (
      <AppLockScreen
        onUnlocked={(nextRole) => {
          setRole(nextRole)
          setTab(defaultTabForRole(nextRole))
          setGate('open')
        }}
      />
    )
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <img
            src={LOGO_SRC}
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
        {visibleTabs.map((t) => (
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
        <strong>Printed receipt → Server sync</strong> for an off-device copy.
      </footer>
    </div>
  )
}
