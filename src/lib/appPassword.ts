import { db } from '../db'

const SALT_KEY = 'appPasswordSalt'
const HASH_KEY = 'appPasswordHash'

/** Session flag: cleared when the browser tab closes. */
export const SESSION_UNLOCKED = 'alhabib_app_unlocked'

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
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
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

export async function isAppPasswordEnabled(): Promise<boolean> {
  const salt = (await db.settings.get(SALT_KEY))?.value?.trim() ?? ''
  const hash = (await db.settings.get(HASH_KEY))?.value?.trim() ?? ''
  return salt.length > 0 && hash.length > 0
}

export async function setAppPassword(plainPassword: string): Promise<void> {
  const salt = randomSaltHex()
  const hash = await derivePasswordHash(plainPassword, salt)
  await db.settings.put({ key: SALT_KEY, value: salt })
  await db.settings.put({ key: HASH_KEY, value: hash })
}

export async function verifyAppPassword(plainPassword: string): Promise<boolean> {
  const saltRow = await db.settings.get(SALT_KEY)
  const hashRow = await db.settings.get(HASH_KEY)
  const salt = saltRow?.value?.trim() ?? ''
  const stored = hashRow?.value?.trim().toLowerCase() ?? ''
  if (!salt || !stored) return false
  const derived = (await derivePasswordHash(plainPassword, salt)).toLowerCase()
  return timingSafeEqualHex(derived, stored)
}

export async function disableAppPassword(): Promise<void> {
  await db.settings.delete(SALT_KEY)
  await db.settings.delete(HASH_KEY)
}
