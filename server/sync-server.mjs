/**
 * Minimal reference server for Inventory → Server sync.
 *
 * Run: SYNC_API_KEY=your-secret node server/sync-server.mjs
 * Optional: SYNC_PORT=3847
 *
 * In the app, set URL to http://127.0.0.1:3847/sync and the same API key.
 * Your real deployment should use HTTPS, a strong key, and proper access control.
 */

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORE = path.join(__dirname, 'sync-store.json')
const PORT = Number(process.env.SYNC_PORT || 3847)
const API_KEY = process.env.SYNC_API_KEY || ''

const emptyPayload = () =>
  JSON.stringify({
    schemaVersion: 2,
    exportedAt: 0,
    products: [],
    sales: [],
    saleLines: [],
    stockMovements: [],
    settings: [],
  })

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key')
}

function auth(req) {
  if (!API_KEY) return true
  return req.headers['x-api-key'] === API_KEY
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const max = 80 * 1024 * 1024
    const chunks = []
    let n = 0
    req.on('data', (c) => {
      n += c.length
      if (n > max) {
        reject(new Error('Body too large'))
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  cors(res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const host = `http://${req.headers.host || `127.0.0.1:${PORT}`}`
  let url
  try {
    url = new URL(req.url || '/', host)
  } catch {
    res.writeHead(400)
    res.end()
    return
  }

  if (url.pathname !== '/sync') {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Use GET or PUT /sync')
    return
  }

  if (!auth(req)) {
    res.writeHead(401, { 'Content-Type': 'text/plain' })
    res.end('Unauthorized')
    return
  }

  try {
    if (req.method === 'GET') {
      if (!fs.existsSync(STORE)) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(emptyPayload())
        return
      }
      const raw = fs.readFileSync(STORE, 'utf8')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(raw)
      return
    }

    if (req.method === 'PUT') {
      const body = await readBody(req)
      JSON.parse(body)
      fs.writeFileSync(STORE, body, 'utf8')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    res.writeHead(405, { 'Content-Type': 'text/plain' })
    res.end('Method not allowed')
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    res.end(e instanceof Error ? e.message : 'Bad request')
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Sync server listening on http://127.0.0.1:${PORT}/sync`)
  if (!API_KEY) {
    console.warn('Warning: SYNC_API_KEY is not set — anyone on the network can read/write data.')
  }
})
