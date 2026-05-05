import { useEffect, useState } from 'react'
import {
  disableAppPassword,
  isAppPasswordEnabled,
  notifyAppPasswordChanged,
  SESSION_UNLOCKED,
  setAppPassword,
  verifyAppPassword,
} from '../lib/appPassword'
import { getStoreInfo, saveStoreInfo } from '../db'

const MIN_PASSWORD_LEN = 4

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

  useEffect(() => {
    void getStoreInfo().then((s) => {
      setStoreName(s.storeName)
      setStoreSlogan(s.slogan)
      setStoreAddress(s.address)
      setStorePhone(s.phone)
    })
  }, [])

  useEffect(() => {
    void isAppPasswordEnabled().then(setLockEnabled)
  }, [])

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

  const refreshLockState = async () => {
    setLockEnabled(await isAppPasswordEnabled())
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
      const ok = await verifyAppPassword(currentPwLock)
      if (!ok) {
        setLockMsg('Current password is wrong.')
        return
      }
      await setAppPassword(changeNew)
      sessionStorage.removeItem(SESSION_UNLOCKED)
      setCurrentPwLock('')
      setChangeNew('')
      setChangeConfirm('')
      notifyAppPasswordChanged()
      setLockMsg('Password updated. Unlock again with the new password.')
    } finally {
      setLockBusy(false)
    }
  }

  const turnOffLock = async (e: React.FormEvent) => {
    e.preventDefault()
    setLockMsg(null)
    setLockBusy(true)
    try {
      const ok = await verifyAppPassword(currentPwLock)
      if (!ok) {
        setLockMsg('Current password is wrong.')
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

  return (
    <div className="view-stack">
      <section className="card">
        <h2 className="section-title">Printed receipt</h2>
        <p className="hint">
          This app runs at one counter only. These lines are what customers see on the paper slip — change
          them when your signboard, address, or phone numbers change. Empty fields use the built‑in defaults.
        </p>
        <form onSubmit={save} className="grid-form">
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

      <section className="card lock-card">
        <h2 className="section-title">App lock</h2>
        <p className="hint lock-hint-tight">
          Optional password for POS / inventory / sales (stored hashed on this device). Use{' '}
          <strong>Lock app</strong> in the header when you step away.
        </p>

        {!lockEnabled ? (
          <div className="lock-manage">
            <form onSubmit={enableLock} className="grid-form lock-form-compact">
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
            <form id="lock-form-update" onSubmit={updateLockPassword} className="grid-form lock-form-compact">
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
            <form id="lock-form-off" onSubmit={turnOffLock} className="lock-form-off" />
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
          </div>
        )}
        {lockMsg ? <p className="scan-msg lock-msg-tight">{lockMsg}</p> : null}
      </section>
    </div>
  )
}
