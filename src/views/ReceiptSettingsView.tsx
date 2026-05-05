import { useCallback, useEffect, useState } from 'react'
import {
  addAppKey,
  changeAppKeyPassword,
  disableAppPassword,
  isAppPasswordEnabled,
  listAppKeys,
  notifyAppPasswordChanged,
  removeAppKey,
  SESSION_ROLE,
  SESSION_UNLOCKED,
  setAppPassword,
  verifyAppKey,
  type AppUserRole,
} from '../lib/appPassword'
import { getStoreInfo, saveStoreInfo } from '../db'
import {
  getAutoSyncConfig,
  getAutoSyncState,
  getSyncStatus,
  pullFromServer,
  pushToServer,
  saveAutoSyncConfig,
  type AutoSyncFrequency,
} from '../lib/sync'

const MIN_PASSWORD_LEN = 4
const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const HOUR_12_OPTIONS = ['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

function to12HourParts(time24: string): { hour12: string; minute: string; meridiem: 'AM' | 'PM' } {
  const [hRaw = '09', mRaw = '00'] = time24.split(':')
  const h = Number(hRaw)
  const m = Number(mRaw)
  const safeH = Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 9
  const safeM = Number.isFinite(m) ? Math.min(59, Math.max(0, m)) : 0
  const meridiem: 'AM' | 'PM' = safeH >= 12 ? 'PM' : 'AM'
  const hour12num = safeH % 12 || 12
  return { hour12: String(hour12num), minute: String(safeM).padStart(2, '0'), meridiem }
}

function to24Hour(hour12: string, minute: string, meridiem: 'AM' | 'PM'): string {
  const h12 = Math.min(12, Math.max(1, Number(hour12) || 12))
  const m = Math.min(59, Math.max(0, Number(minute) || 0))
  const h24 = (h12 % 12) + (meridiem === 'PM' ? 12 : 0)
  return `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Text that appears at the top of printed receipts — one shop, edit when address or phones change. */
export function ReceiptSettingsView() {
  const [storeName, setStoreName] = useState('')
  const [storeSlogan, setStoreSlogan] = useState('')
  const [storeAddress, setStoreAddress] = useState('')
  const [storePhone, setStorePhone] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const [lockEnabled, setLockEnabled] = useState(false)
  const [lockBusy, setLockBusy] = useState(false)
  const [lockMsg, setLockMsg] = useState<string | null>(null)
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [currentPwLock, setCurrentPwLock] = useState('')
  const [changeNew, setChangeNew] = useState('')
  const [changeConfirm, setChangeConfirm] = useState('')
  const [keys, setKeys] = useState<Array<{ id: string; name: string; role: AppUserRole }>>([])
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyPw, setNewKeyPw] = useState('')
  const [newKeyRole, setNewKeyRole] = useState<AppUserRole>('staff')
  const [adminPwManage, setAdminPwManage] = useState('')
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [syncLastOk, setSyncLastOk] = useState<string | null>(null)
  const [syncLastErr, setSyncLastErr] = useState<string | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [autoEnabled, setAutoEnabled] = useState(false)
  const [autoFrequency, setAutoFrequency] = useState<AutoSyncFrequency>('daily')
  const [autoTime, setAutoTime] = useState('09:00')
  const [autoWeekDay, setAutoWeekDay] = useState(1)
  const [autoMonthDay, setAutoMonthDay] = useState(1)
  const [autoNextRunAt, setAutoNextRunAt] = useState<number | null>(null)
  const [autoLastRunAt, setAutoLastRunAt] = useState<number | null>(null)

  const loadSyncUi = useCallback(async () => {
    const [st, autoCfg, autoState] = await Promise.all([
      getSyncStatus(),
      getAutoSyncConfig(),
      getAutoSyncState(),
    ])
    setSyncLastOk(st.lastOkAt)
    setSyncLastErr(st.lastError)
    setAutoEnabled(autoCfg.enabled)
    setAutoFrequency(autoCfg.frequency)
    setAutoTime(autoCfg.time)
    setAutoWeekDay(autoCfg.weekDay)
    setAutoMonthDay(autoCfg.monthDay)
    setAutoNextRunAt(autoState.nextRunAt)
    setAutoLastRunAt(autoState.lastRunAt)
  }, [])

  useEffect(() => {
    void getStoreInfo().then((s) => {
      setStoreName(s.storeName)
      setStoreSlogan(s.slogan)
      setStoreAddress(s.address)
      setStorePhone(s.phone)
    })
  }, [])

  useEffect(() => {
    void refreshLockState()
  }, [])

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      void loadSyncUi()
    })
    return () => cancelAnimationFrame(id)
  }, [loadSyncUi])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    await saveStoreInfo({
      storeName: storeName.trim() || 'AL-HABIB Supermart',
      slogan: storeSlogan.trim(),
      address: storeAddress.trim(),
      phone: storePhone.trim(),
    })
    setMsg('Saved. Next receipt print will use this text.')
  }

  async function refreshLockState() {
    setLockEnabled(await isAppPasswordEnabled())
    setKeys(await listAppKeys())
  }

  const enableLock = async (e: React.FormEvent) => {
    e.preventDefault()
    setLockMsg(null)
    if (newPw.length < MIN_PASSWORD_LEN) {
      setLockMsg(`Use at least ${MIN_PASSWORD_LEN} characters.`)
      return
    }
    if (newPw !== confirmPw) {
      setLockMsg('New password and confirmation do not match.')
      return
    }
    setLockBusy(true)
    try {
      await setAppPassword(newPw)
      sessionStorage.removeItem(SESSION_UNLOCKED)
      setNewPw('')
      setConfirmPw('')
      await refreshLockState()
      notifyAppPasswordChanged()
      setLockMsg('App lock is on. Enter your password on the next screen.')
    } finally {
      setLockBusy(false)
    }
  }

  const updateLockPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setLockMsg(null)
    if (changeNew.length < MIN_PASSWORD_LEN) {
      setLockMsg(`New password must be at least ${MIN_PASSWORD_LEN} characters.`)
      return
    }
    if (changeNew !== changeConfirm) {
      setLockMsg('New password and confirmation do not match.')
      return
    }
    setLockBusy(true)
    try {
      const verified = await verifyAppKey(currentPwLock)
      if (!verified.ok || !verified.keyId) {
        setLockMsg('Current password is wrong.')
        return
      }
      await changeAppKeyPassword({ keyId: verified.keyId, newPlainPassword: changeNew })
      sessionStorage.removeItem(SESSION_UNLOCKED)
      setCurrentPwLock('')
      setChangeNew('')
      setChangeConfirm('')
      notifyAppPasswordChanged()
      setLockMsg('Key updated. Unlock again with the new key.')
    } finally {
      setLockBusy(false)
    }
  }

  const turnOffLock = async (e: React.FormEvent) => {
    e.preventDefault()
    setLockMsg(null)
    setLockBusy(true)
    try {
      const verified = await verifyAppKey(currentPwLock)
      if (!verified.ok) {
        setLockMsg('Current password is wrong.')
        return
      }
      if (verified.role !== 'admin') {
        setLockMsg('Only admin key can turn lock off.')
        return
      }
      await disableAppPassword()
      setCurrentPwLock('')
      await refreshLockState()
      notifyAppPasswordChanged()
      setLockMsg('App lock is off. Anyone using this device can open the app.')
    } finally {
      setLockBusy(false)
    }
  }

  const doPushSync = async () => {
    if (!confirm('Upload this device’s full database to the server? This overwrites the server copy.')) {
      return
    }
    setSyncBusy(true)
    try {
      await pushToServer()
      await loadSyncUi()
      setSyncMsg('Uploaded to server.')
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : 'Upload failed.')
      await loadSyncUi()
    } finally {
      setSyncBusy(false)
    }
  }

  const doPullSync = async () => {
    if (!confirm('Download from the server and replace ALL data on this device?')) {
      return
    }
    setSyncBusy(true)
    try {
      await pullFromServer()
      await loadSyncUi()
      setSyncMsg('Downloaded from server — local data replaced.')
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : 'Download failed.')
      await loadSyncUi()
    } finally {
      setSyncBusy(false)
    }
  }

  const saveAutoSchedule = async () => {
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(autoTime.trim())) {
      setSyncMsg('Invalid time. Use AM/PM time selectors.')
      return
    }
    try {
      await saveAutoSyncConfig({
        enabled: autoEnabled,
        frequency: autoFrequency,
        time: autoTime.trim(),
        weekDay: autoWeekDay,
        monthDay: autoMonthDay,
      })
      await loadSyncUi()
      setSyncMsg('Auto-sync schedule saved.')
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : 'Could not save auto-sync schedule.')
    }
  }

  const addNewAppKey = async (e: React.FormEvent) => {
    e.preventDefault()
    setLockMsg(null)
    if (newKeyPw.length < MIN_PASSWORD_LEN) {
      setLockMsg(`Use at least ${MIN_PASSWORD_LEN} characters for new key.`)
      return
    }
    const verified = await verifyAppKey(adminPwManage)
    if (!verified.ok || verified.role !== 'admin') {
      setLockMsg('Admin key required to create new keys.')
      return
    }
    setLockBusy(true)
    try {
      await addAppKey({ name: newKeyName || 'Staff key', plainPassword: newKeyPw, role: newKeyRole })
      await refreshLockState()
      setNewKeyName('')
      setNewKeyPw('')
      setLockMsg('New app key created.')
    } catch (e) {
      setLockMsg(e instanceof Error ? e.message : 'Could not add key.')
    } finally {
      setLockBusy(false)
    }
  }

  const removeExistingKey = async (keyId: string) => {
    setLockMsg(null)
    const verified = await verifyAppKey(adminPwManage)
    if (!verified.ok || verified.role !== 'admin') {
      setLockMsg('Admin key required to remove keys.')
      return
    }
    setLockBusy(true)
    try {
      await removeAppKey(keyId)
      await refreshLockState()
      setLockMsg('Key removed.')
    } catch (e) {
      setLockMsg(e instanceof Error ? e.message : 'Could not remove key.')
    } finally {
      setLockBusy(false)
    }
  }

  const syncLastOkLabel =
    syncLastOk && !Number.isNaN(Number(syncLastOk))
      ? new Date(Number(syncLastOk)).toLocaleString('en-PK', {
          dateStyle: 'short',
          timeStyle: 'short',
        })
      : null
  const autoNextLabel =
    autoNextRunAt != null && !Number.isNaN(autoNextRunAt)
      ? new Date(autoNextRunAt).toLocaleString('en-PK', { dateStyle: 'short', timeStyle: 'short' })
      : '—'
  const autoLastLabel =
    autoLastRunAt != null && !Number.isNaN(autoLastRunAt)
      ? new Date(autoLastRunAt).toLocaleString('en-PK', { dateStyle: 'short', timeStyle: 'short' })
      : '—'
  const autoTimeParts = to12HourParts(autoTime)
  const isAdminSession = !lockEnabled || sessionStorage.getItem(SESSION_ROLE) === 'admin'

  if (!isAdminSession) {
    return (
      <div className="view-stack">
        <section className="card">
          <h2 className="section-title">Printed receipt</h2>
          <p className="hint">Only admin user can access printed receipt, server sync, and app lock settings.</p>
        </section>
      </div>
    )
  }

  return (
    <div className="view-stack">
      <section className="card">
        <h2 className="section-title">Printed receipt</h2>
        <p className="hint">
          This app runs at one counter only. These lines are what customers see on the paper slip — change
          them when your signboard, address, or phone numbers change. Empty fields use the built‑in defaults.
        </p>
        <form onSubmit={save} className="grid-form" noValidate>
          <label className="span-2">
            Name on receipt
            <input
              className="input"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder="AL-HABIB Supermart"
            />
          </label>
          <label className="span-2">
            Slogan (black bar)
            <input
              className="input"
              value={storeSlogan}
              onChange={(e) => setStoreSlogan(e.target.value)}
              placeholder="Providing All Your Needs"
            />
          </label>
          <label className="span-2">
            Visit us (address)
            <textarea
              className="input textarea"
              rows={2}
              value={storeAddress}
              onChange={(e) => setStoreAddress(e.target.value)}
              placeholder="Behind PTCL Exchange Office Near Mian Waheed-ud-Din Park"
            />
          </label>
          <label className="span-2">
            Phone / WhatsApp
            <input
              className="input"
              value={storePhone}
              onChange={(e) => setStorePhone(e.target.value)}
              placeholder="0322 / 0317-7030971"
            />
          </label>
          <div className="form-actions span-2">
            <button type="submit" className="btn primary">
              Save
            </button>
          </div>
        </form>
        {msg ? <p className="scan-msg">{msg}</p> : null}
      </section>

      <section className="card sync-panel">
        <h2 className="section-title">Server sync</h2>
        <p className="hint">
          Sync is preconfigured in this app build. Use these buttons to upload/download data and set the auto-sync
          schedule.
        </p>
        <div className="grid-form sync-form">
          <label className="span-2">
            <input
              type="checkbox"
              checked={autoEnabled}
              onChange={(e) => setAutoEnabled(e.target.checked)}
              style={{ marginRight: 8 }}
            />
            Enable auto-sync
          </label>

          <label>
            Frequency
            <select
              className="input"
              value={autoFrequency}
              onChange={(e) => setAutoFrequency(e.target.value as AutoSyncFrequency)}
            >
              <option value="daily">Daily (once)</option>
              <option value="weekly">Weekly (once)</option>
              <option value="monthly">Monthly (once)</option>
            </select>
          </label>

          {autoFrequency === 'weekly' ? (
            <label>
              Week day
              <select
                className="input"
                value={String(autoWeekDay)}
                onChange={(e) => setAutoWeekDay(Number(e.target.value))}
              >
                {WEEKDAY_LABELS.map((d, idx) => (
                  <option key={d} value={String(idx)}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {autoFrequency === 'monthly' ? (
            <label>
              Day of month
              <input
                type="number"
                min={1}
                max={31}
                className="input"
                value={autoMonthDay}
                onChange={(e) => setAutoMonthDay(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
              />
            </label>
          ) : null}

          <label className="span-2">
            Time
            <div className="auto-time-controls">
              <select
                className="input"
                value={autoTimeParts.hour12}
                onChange={(e) => setAutoTime(to24Hour(e.target.value, autoTimeParts.minute, autoTimeParts.meridiem))}
              >
                {HOUR_12_OPTIONS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              <select
                className="input"
                value={autoTimeParts.minute}
                onChange={(e) => setAutoTime(to24Hour(autoTimeParts.hour12, e.target.value, autoTimeParts.meridiem))}
              >
                {MINUTE_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                className="input"
                value={autoTimeParts.meridiem}
                onChange={(e) =>
                  setAutoTime(to24Hour(autoTimeParts.hour12, autoTimeParts.minute, e.target.value as 'AM' | 'PM'))
                }
              >
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </div>
          </label>

          <div className="form-actions span-2 sync-actions">
            <button type="button" className="btn primary" onClick={() => void saveAutoSchedule()}>
              Save auto-sync schedule
            </button>
          </div>

          <div className="form-actions span-2 sync-actions">
            <button type="button" className="btn secondary" onClick={() => void doPushSync()} disabled={syncBusy}>
              Upload to server
            </button>
            <button type="button" className="btn secondary" onClick={() => void doPullSync()} disabled={syncBusy}>
              Download from server
            </button>
          </div>
        </div>
        <p className="hint sync-status-hint">
          Last sync: {syncLastOkLabel ?? '—'}
          <br />
          Auto-sync next run: {autoNextLabel}
          <br />
          Auto-sync last run: {autoLastLabel}
          {syncLastErr ? (
            <>
              <br />
              <span className="sync-err">Last error: {syncLastErr}</span>
            </>
          ) : null}
        </p>
        {syncMsg ? <p className="scan-msg">{syncMsg}</p> : null}
      </section>

      <section className="card lock-card">
        <h2 className="section-title">App lock</h2>
        <p className="hint lock-hint-tight">
          Optional password for POS / inventory / sales (stored hashed on this device). Use{' '}
          <strong>Lock app</strong> in the header when you step away.
        </p>

        {!lockEnabled ? (
          <div className="lock-manage">
            <form onSubmit={enableLock} className="grid-form lock-form-compact" noValidate>
              <label>
                New
                <input
                  type="password"
                  className="input"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LEN}
                />
              </label>
              <label>
                Confirm
                <input
                  type="password"
                  className="input"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LEN}
                />
              </label>
              <div className="lock-btn-row">
                <button type="submit" className="btn primary sm" disabled={lockBusy}>
                  Turn on lock
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="lock-manage">
            <p className="lock-status-line">
              Lock is <strong>on</strong>.
            </p>
            <label className="lock-current-label">
              Current password
              <input
                type="password"
                className="input"
                value={currentPwLock}
                onChange={(e) => setCurrentPwLock(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <form id="lock-form-update" onSubmit={updateLockPassword} className="grid-form lock-form-compact" noValidate>
              <label>
                New
                <input
                  type="password"
                  className="input"
                  value={changeNew}
                  onChange={(e) => setChangeNew(e.target.value)}
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LEN}
                />
              </label>
              <label>
                Confirm
                <input
                  type="password"
                  className="input"
                  value={changeConfirm}
                  onChange={(e) => setChangeConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
            </form>
            <form id="lock-form-off" onSubmit={turnOffLock} className="lock-form-off" noValidate />
            <div className="lock-btn-row">
              <button
                type="submit"
                form="lock-form-update"
                className="btn primary sm"
                disabled={lockBusy}
              >
                Update
              </button>
              <button
                type="submit"
                form="lock-form-off"
                className="btn secondary sm"
                disabled={lockBusy}
              >
                Turn off
              </button>
            </div>

            <div className="receive-block" style={{ marginTop: '0.9rem' }}>
              <h3 className="subhead">Manage app keys</h3>
              <p className="hint">
                Create multiple keys for staff. Admin key is required to add/remove keys and view settings.
              </p>
              <label className="lock-current-label">
                Admin key (required for key management)
                <input
                  type="password"
                  className="input"
                  value={adminPwManage}
                  onChange={(e) => setAdminPwManage(e.target.value)}
                  autoComplete="current-password"
                />
              </label>
              <form onSubmit={addNewAppKey} className="grid-form lock-form-compact" noValidate>
                <label>
                  Key name
                  <input
                    className="input"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="e.g. Counter 2"
                  />
                </label>
                <label>
                  Role
                  <select
                    className="input"
                    value={newKeyRole}
                    onChange={(e) => setNewKeyRole(e.target.value as AppUserRole)}
                  >
                    <option value="staff">Staff</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <label className="span-2">
                  New key password
                  <input
                    type="password"
                    className="input"
                    value={newKeyPw}
                    onChange={(e) => setNewKeyPw(e.target.value)}
                    minLength={MIN_PASSWORD_LEN}
                    autoComplete="new-password"
                  />
                </label>
                <div className="form-actions span-2">
                  <button type="submit" className="btn secondary sm" disabled={lockBusy}>
                    Add key
                  </button>
                </div>
              </form>

              <div className="table-wrap flat table-wrap-scroll" style={{ marginTop: '0.6rem' }}>
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((k) => (
                      <tr key={k.id}>
                        <td>{k.name}</td>
                        <td style={{ textTransform: 'capitalize' }}>{k.role}</td>
                        <td className="num">
                          <button
                            type="button"
                            className="btn danger ghost sm"
                            onClick={() => void removeExistingKey(k.id)}
                            disabled={lockBusy}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {lockMsg ? <p className="scan-msg lock-msg-tight">{lockMsg}</p> : null}
      </section>
    </div>
  )
}
