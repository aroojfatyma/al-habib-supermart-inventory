import { db } from '../db'
import type { Product, Sale, SaleLine, SettingRow, StockMovement } from '../db'
import { replaceDatabaseTables, type ImportTables } from './backup'

/** Settings keys never sent to the server (re-applied locally after download). */
const LOCAL_ONLY_KEYS = new Set(['syncApiKey', 'syncUrl', 'syncLastOkAt', 'syncLastError'])
const DEFAULT_SYNC_URL = 'https://d3kn7k84xjdf1l.cloudfront.net/sync'
const DEFAULT_SYNC_API_KEY = 'PvP2QZiKnwY7Mx/jwfHdIO80XhlnephYXJmk9I3N7vmS9QOj9AQsae2GiUYQ7uRn'

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
