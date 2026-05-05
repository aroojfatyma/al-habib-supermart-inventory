import { db } from '../db'

const SALT_KEY = 'appPasswordSalt'
const HASH_KEY = 'appPasswordHash'
const APP_KEYS_KEY = 'appAuthKeysV1'

/** Session flag: cleared when the browser tab closes. */
export const SESSION_UNLOCKED = 'alhabib_app_unlocked'
export const SESSION_ROLE = 'alhabib_app_role'
export const SESSION_KEY_NAME = 'alhabib_app_key_name'

export const APP_PASSWORD_CHANGED = 'alhabib-app-password-changed'

export function notifyAppPasswordChanged() {
  window.dispatchEvent(new Event(APP_PASSWORD_CHANGED))
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randomSaltHex(byteLength = 16): string {
  const u = new Uint8Array(byteLength)
  crypto.getRandomValues(u)
  return bytesToHex(u)
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function derivePasswordHash(password: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(hexToBytes(saltHex))
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 120_000, hash: 'SHA-256' },
    keyMaterial,
    256,
  )
  return bytesToHex(new Uint8Array(bits))
}

export type AppUserRole = 'admin' | 'staff'

type StoredAppKey = {
  id: string
  name: string
  role: AppUserRole
  salt: string
  hash: string
  createdAt: number
}

function createKeyId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

async function saveStoredKeys(keys: StoredAppKey[]): Promise<void> {
  await db.settings.put({ key: APP_KEYS_KEY, value: JSON.stringify(keys) })
}

function parseStoredKeys(raw: string | undefined): StoredAppKey[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is StoredAppKey => {
      if (typeof x !== 'object' || x == null) return false
      const o = x as Record<string, unknown>
      return (
        typeof o.id === 'string' &&
        typeof o.name === 'string' &&
        (o.role === 'admin' || o.role === 'staff') &&
        typeof o.salt === 'string' &&
        typeof o.hash === 'string'
      )
    })
  } catch {
    return []
  }
}

async function loadStoredKeys(): Promise<StoredAppKey[]> {
  const row = await db.settings.get(APP_KEYS_KEY)
  const keys = parseStoredKeys(row?.value)
  if (keys.length > 0) return keys

  // One-time migration from old single-password shape.
  const oldSalt = (await db.settings.get(SALT_KEY))?.value?.trim() ?? ''
  const oldHash = (await db.settings.get(HASH_KEY))?.value?.trim() ?? ''
  if (!oldSalt || !oldHash) return []

  const migrated: StoredAppKey[] = [
    {
      id: createKeyId(),
      name: 'Admin',
      role: 'admin',
      salt: oldSalt,
      hash: oldHash,
      createdAt: Date.now(),
    },
  ]
  await saveStoredKeys(migrated)
  return migrated
}

export async function listAppKeys(): Promise<Array<{ id: string; name: string; role: AppUserRole }>> {
  const keys = await loadStoredKeys()
  return keys
    .map((k) => ({ id: k.id, name: k.name, role: k.role }))
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === 'admin' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

export async function isAppPasswordEnabled(): Promise<boolean> {
  return (await loadStoredKeys()).length > 0
}

export async function setAppPassword(plainPassword: string): Promise<void> {
  const salt = randomSaltHex()
  const hash = await derivePasswordHash(plainPassword, salt)
  const keys: StoredAppKey[] = [
    {
      id: createKeyId(),
      name: 'Admin',
      role: 'admin',
      salt,
      hash,
      createdAt: Date.now(),
    },
  ]
  await saveStoredKeys(keys)
  await db.settings.put({ key: SALT_KEY, value: salt })
  await db.settings.put({ key: HASH_KEY, value: hash })
}

export async function addAppKey(input: {
  name: string
  plainPassword: string
  role: AppUserRole
}): Promise<void> {
  const name = input.name.trim()
  if (!name) throw new Error('Key name is required.')
  if (input.plainPassword.trim().length < 4) throw new Error('Key must be at least 4 characters.')

  const keys = await loadStoredKeys()
  if (keys.some((k) => k.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('Key name already exists.')
  }
  const salt = randomSaltHex()
  const hash = await derivePasswordHash(input.plainPassword, salt)
  keys.push({
    id: createKeyId(),
    name,
    role: input.role,
    salt,
    hash,
    createdAt: Date.now(),
  })
  await saveStoredKeys(keys)
}

export async function verifyAppPassword(plainPassword: string): Promise<boolean> {
  return (await verifyAppKey(plainPassword)).ok
}

export async function verifyAppKey(
  plainPassword: string,
): Promise<{ ok: boolean; role?: AppUserRole; keyId?: string; keyName?: string }> {
  const keys = await loadStoredKeys()
  if (keys.length === 0) return { ok: false }
  for (const key of keys) {
    const derived = (await derivePasswordHash(plainPassword, key.salt)).toLowerCase()
    if (timingSafeEqualHex(derived, key.hash.toLowerCase())) {
      return { ok: true, role: key.role, keyId: key.id, keyName: key.name }
    }
  }
  return { ok: false }
}

export async function changeAppKeyPassword(args: {
  keyId: string
  newPlainPassword: string
}): Promise<void> {
  const keys = await loadStoredKeys()
  const idx = keys.findIndex((k) => k.id === args.keyId)
  if (idx < 0) throw new Error('Key not found.')
  if (args.newPlainPassword.trim().length < 4) throw new Error('New key must be at least 4 characters.')
  const salt = randomSaltHex()
  const hash = await derivePasswordHash(args.newPlainPassword, salt)
  keys[idx] = { ...keys[idx]!, salt, hash }
  await saveStoredKeys(keys)
}

export async function removeAppKey(keyId: string): Promise<void> {
  const keys = await loadStoredKeys()
  const target = keys.find((k) => k.id === keyId)
  if (!target) return
  if (target.role === 'admin') {
    const adminCount = keys.filter((k) => k.role === 'admin').length
    if (adminCount <= 1) {
      throw new Error('At least one admin key is required.')
    }
  }
  await saveStoredKeys(keys.filter((k) => k.id !== keyId))
}

export async function disableAppPassword(): Promise<void> {
  await db.settings.delete(APP_KEYS_KEY)
  await db.settings.delete(SALT_KEY)
  await db.settings.delete(HASH_KEY)
}
