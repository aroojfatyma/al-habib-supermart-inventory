import { db } from '../db'
import type { Product, Sale, SaleLine, SettingRow, StockMovement } from '../db'
import { replaceDatabaseTables, type ImportTables } from './backup'

/** Settings keys never sent to the server (re-applied locally after download). */
const LOCAL_ONLY_KEYS = new Set([
  'syncApiKey',
  'syncUrl',
  'syncLastOkAt',
  'syncLastError',
  'appPasswordSalt',
  'appPasswordHash',
  'appAuthKeysV1',
  'syncAutoEnabled',
  'syncAutoFrequency',
  'syncAutoTimes',
  'syncAutoWeekday',
  'syncAutoMonthday',
  'syncAutoNextRunAt',
  'syncAutoLastRunAt',
])
const DEFAULT_SYNC_URL = 'https://d3kn7k84xjdf1l.cloudfront.net/sync'
const DEFAULT_SYNC_API_KEY = 'PvP2QZiKnwY7Mx/jwfHdIO80XhlnephYXJmk9I3N7vmS9QOj9AQsae2GiUYQ7uRn'
const AUTO_ENABLED_KEY = 'syncAutoEnabled'
const AUTO_FREQUENCY_KEY = 'syncAutoFrequency'
const AUTO_TIMES_KEY = 'syncAutoTimes'
const AUTO_WEEKDAY_KEY = 'syncAutoWeekday'
const AUTO_MONTHDAY_KEY = 'syncAutoMonthday'
const AUTO_NEXT_RUN_KEY = 'syncAutoNextRunAt'
const AUTO_LAST_RUN_KEY = 'syncAutoLastRunAt'

const DAY_MS = 24 * 60 * 60 * 1000

export type AutoSyncFrequency = 'daily' | 'weekly' | 'monthly'

export type AutoSyncConfig = {
  enabled: boolean
  frequency: AutoSyncFrequency
  time: string
  weekDay: number
  monthDay: number
}

export type AutoSyncState = {
  nextRunAt: number | null
  lastRunAt: number | null
}

const DEFAULT_AUTO_SYNC_CONFIG: AutoSyncConfig = {
  enabled: false,
  frequency: 'daily',
  time: '09:00',
  weekDay: 1,
  monthDay: 1,
}

let autoSyncTimer: number | null = null
let autoSyncInFlight = false

export type ServerSyncPayload = ImportTables & {
  schemaVersion: 2
  exportedAt: number
}

export async function getSyncConfig(): Promise<{ url: string; apiKey: string }> {
  return { url: DEFAULT_SYNC_URL, apiKey: DEFAULT_SYNC_API_KEY }
}

export async function saveSyncConfig(partial: { url?: string; apiKey?: string }): Promise<void> {
  void partial
}

function toInt(v: string | undefined, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function sanitizeTime(value: string | undefined): string {
  const t = (value ?? '').trim()
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(t) ? t : DEFAULT_AUTO_SYNC_CONFIG.time
}

function monthDays(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate()
}

function makeAtLocal(date: Date, hhmm: string): number {
  const [hStr, mStr] = hhmm.split(':')
  const h = toInt(hStr, 0)
  const m = toInt(mStr, 0)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m, 0, 0).getTime()
}

function nextDaily(nowMs: number, time: string): number {
  const now = new Date(nowMs)
  const today = makeAtLocal(now, time)
  if (today > nowMs + 5000) return today
  const tomorrow = new Date(nowMs + DAY_MS)
  return makeAtLocal(tomorrow, time)
}

function nextWeekly(nowMs: number, weekDay: number, time: string): number {
  for (let add = 0; add < 14; add++) {
    const d = new Date(nowMs + add * DAY_MS)
    if (d.getDay() !== weekDay) continue
    const at = makeAtLocal(d, time)
    if (at > nowMs + 5000) return at
  }
  return nowMs + DAY_MS
}

function nextMonthly(nowMs: number, monthDay: number, time: string): number {
  const now = new Date(nowMs)
  for (let addMonth = 0; addMonth < 14; addMonth++) {
    const y = now.getFullYear()
    const m = now.getMonth() + addMonth
    const d = new Date(y, m, 1)
    const maxDay = monthDays(d.getFullYear(), d.getMonth())
    const day = Math.min(Math.max(1, monthDay), maxDay)
    const target = new Date(d.getFullYear(), d.getMonth(), day)
    const at = makeAtLocal(target, time)
    if (at > nowMs + 5000) return at
  }
  return nowMs + DAY_MS
}

function computeNextRunAt(nowMs: number, cfg: AutoSyncConfig): number | null {
  if (!cfg.enabled) return null
  const time = sanitizeTime(cfg.time)
  if (cfg.frequency === 'daily') return nextDaily(nowMs, time)
  if (cfg.frequency === 'weekly') return nextWeekly(nowMs, cfg.weekDay, time)
  return nextMonthly(nowMs, cfg.monthDay, time)
}

export async function getAutoSyncConfig(): Promise<AutoSyncConfig> {
  const [enabledRow, freqRow, timesRow, weekRow, monthRow] = await Promise.all([
    db.settings.get(AUTO_ENABLED_KEY),
    db.settings.get(AUTO_FREQUENCY_KEY),
    db.settings.get(AUTO_TIMES_KEY),
    db.settings.get(AUTO_WEEKDAY_KEY),
    db.settings.get(AUTO_MONTHDAY_KEY),
  ])

  const frequencyRaw = (freqRow?.value ?? DEFAULT_AUTO_SYNC_CONFIG.frequency).trim().toLowerCase()
  const frequency: AutoSyncFrequency =
    frequencyRaw === 'weekly' || frequencyRaw === 'monthly' ? frequencyRaw : 'daily'

  const firstTime =
    Array.from(
      new Set(
        (timesRow?.value ?? DEFAULT_AUTO_SYNC_CONFIG.time)
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    ).find((t) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(t)) ?? DEFAULT_AUTO_SYNC_CONFIG.time

  return {
    enabled: enabledRow?.value === '1',
    frequency,
    time: sanitizeTime(firstTime),
    weekDay: Math.min(6, Math.max(0, toInt(weekRow?.value, DEFAULT_AUTO_SYNC_CONFIG.weekDay))),
    monthDay: Math.min(31, Math.max(1, toInt(monthRow?.value, DEFAULT_AUTO_SYNC_CONFIG.monthDay))),
  }
}

export async function saveAutoSyncConfig(partial: Partial<AutoSyncConfig>): Promise<void> {
  const base = await getAutoSyncConfig()
  const merged: AutoSyncConfig = {
    ...base,
    ...partial,
    time: sanitizeTime(partial.time ?? base.time),
  }

  const rows: SettingRow[] = [
    { key: AUTO_ENABLED_KEY, value: merged.enabled ? '1' : '0' },
    { key: AUTO_FREQUENCY_KEY, value: merged.frequency },
    { key: AUTO_TIMES_KEY, value: merged.time },
    { key: AUTO_WEEKDAY_KEY, value: String(merged.weekDay) },
    { key: AUTO_MONTHDAY_KEY, value: String(merged.monthDay) },
  ]
  const nextRun = computeNextRunAt(Date.now(), merged)
  rows.push({ key: AUTO_NEXT_RUN_KEY, value: nextRun ? String(nextRun) : '' })

  await db.transaction('rw', db.settings, async () => {
    for (const row of rows) await db.settings.put(row)
  })
}

export async function getAutoSyncState(): Promise<AutoSyncState> {
  const [nextRow, lastRow] = await Promise.all([db.settings.get(AUTO_NEXT_RUN_KEY), db.settings.get(AUTO_LAST_RUN_KEY)])
  const nextRunAt = toInt(nextRow?.value, NaN)
  const lastRunAt = toInt(lastRow?.value, NaN)
  return {
    nextRunAt: Number.isFinite(nextRunAt) && nextRunAt > 0 ? nextRunAt : null,
    lastRunAt: Number.isFinite(lastRunAt) && lastRunAt > 0 ? lastRunAt : null,
  }
}

async function autoSyncTick(): Promise<void> {
  if (autoSyncInFlight) return
  const cfg = await getAutoSyncConfig()
  if (!cfg.enabled) return

  const now = Date.now()
  const next = await db.settings.get(AUTO_NEXT_RUN_KEY)
  let nextRunAt = toInt(next?.value, NaN)
  if (!Number.isFinite(nextRunAt) || nextRunAt <= 0) {
    const computed = computeNextRunAt(now, cfg)
    if (!computed) return
    nextRunAt = computed
    await db.settings.put({ key: AUTO_NEXT_RUN_KEY, value: String(nextRunAt) })
  }

  if (now < nextRunAt) return

  autoSyncInFlight = true
  try {
    await pushToServer()
    await db.settings.put({ key: AUTO_LAST_RUN_KEY, value: String(Date.now()) })
  } catch {
    // keep syncLastError from pushToServer; scheduler retries at next window
  } finally {
    const after = Date.now() + 1000
    const nextAfter = computeNextRunAt(after, cfg)
    await db.settings.put({ key: AUTO_NEXT_RUN_KEY, value: nextAfter ? String(nextAfter) : '' })
    autoSyncInFlight = false
  }
}

export function startAutoSyncScheduler(): void {
  if (autoSyncTimer != null) return
  void autoSyncTick()
  autoSyncTimer = window.setInterval(() => {
    void autoSyncTick()
  }, 30000)
}

export function stopAutoSyncScheduler(): void {
  if (autoSyncTimer != null) {
    window.clearInterval(autoSyncTimer)
    autoSyncTimer = null
  }
}

async function buildPayload(): Promise<ServerSyncPayload> {
  const [products, sales, saleLines, stockMovements, settings] = await Promise.all([
    db.products.toArray(),
    db.sales.toArray(),
    db.saleLines.toArray(),
    db.stockMovements.toArray(),
    db.settings.toArray(),
  ])
  const safeSettings = settings.filter((s) => !LOCAL_ONLY_KEYS.has(s.key))
  return {
    schemaVersion: 2,
    exportedAt: Date.now(),
    products,
    sales,
    saleLines,
    stockMovements,
    settings: safeSettings,
  }
}

function parseServerPayload(json: unknown): ImportTables {
  if (typeof json !== 'object' || json === null) {
    throw new Error('Server did not return JSON data.')
  }
  const o = json as Record<string, unknown>
  if (o.schemaVersion !== 2) {
    throw new Error('Server data is not in the expected format (need schema version 2).')
  }
  return {
    products: Array.isArray(o.products) ? (o.products as Product[]) : [],
    sales: Array.isArray(o.sales) ? (o.sales as Sale[]) : [],
    saleLines: Array.isArray(o.saleLines) ? (o.saleLines as SaleLine[]) : [],
    stockMovements: Array.isArray(o.stockMovements) ? (o.stockMovements as StockMovement[]) : [],
    settings: Array.isArray(o.settings) ? (o.settings as SettingRow[]) : [],
  }
}

async function markSyncOk(): Promise<void> {
  await db.settings.put({ key: 'syncLastOkAt', value: String(Date.now()) })
  await db.settings.delete('syncLastError')
}

async function markSyncError(message: string): Promise<void> {
  await db.settings.put({ key: 'syncLastError', value: message })
}

/** Upload full local database snapshot (minus sync credentials) to the server. */
export async function pushToServer(): Promise<void> {
  const { url, apiKey } = await getSyncConfig()
  if (!url) throw new Error('Set the sync server URL first.')
  const payload = await buildPayload()
  let res: Response
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-Api-Key': apiKey } : {}),
      },
      body: JSON.stringify(payload),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Network error'
    await markSyncError(msg)
    throw new Error(msg, { cause: e })
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    const msg = `Server ${res.status}${t ? `: ${t.slice(0, 200)}` : ''}`
    await markSyncError(msg)
    throw new Error(msg)
  }
  await markSyncOk()
}

/** Replace local database with the server snapshot; keeps this device’s sync URL and API key. */
export async function pullFromServer(): Promise<void> {
  const { url, apiKey } = await getSyncConfig()
  if (!url) throw new Error('Set the sync server URL first.')
  let res: Response
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        ...(apiKey ? { 'X-Api-Key': apiKey } : {}),
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Network error'
    await markSyncError(msg)
    throw new Error(msg, { cause: e })
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    const msg = `Server ${res.status}${t ? `: ${t.slice(0, 200)}` : ''}`
    await markSyncError(msg)
    throw new Error(msg)
  }
  let json: unknown
  try {
    json = await res.json()
  } catch {
    await markSyncError('Invalid JSON from server')
    throw new Error('Server response was not valid JSON.')
  }
  const data = parseServerPayload(json)
  await replaceDatabaseTables(data)
  await markSyncOk()
}

export async function getSyncStatus(): Promise<{ lastOkAt: string | null; lastError: string | null }> {
  const [ok, err] = await Promise.all([db.settings.get('syncLastOkAt'), db.settings.get('syncLastError')])
  return { lastOkAt: ok?.value ?? null, lastError: err?.value ?? null }
}
