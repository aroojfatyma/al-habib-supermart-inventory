import * as XLSX from 'xlsx'
import type { Product, Sale, SaleLine, SettingRow, StockMovement } from '../db'
import { replaceDatabaseTables } from './backup'
import { EXCEL_SHEETS } from './excelWorkbookSheets'

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

function num(v: unknown, fallback = 0): number {
  if (v === '' || v == null) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function optId(v: unknown): number | undefined {
  if (v === '' || v == null) return undefined
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function optRefSaleId(v: unknown): number | undefined {
  if (v === '' || v == null) return undefined
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function parseCreatedAt(v: unknown): number {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.getTime()
  if (typeof v === 'string' && v) {
    const p = Date.parse(v)
    if (!Number.isNaN(p)) return p
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v > 1e12) return Math.floor(v)
    if (v > 2000 && v < 120000) {
      const d = XLSX.SSF.parse_date_code(v)
      if (d) return Date.UTC(d.y, d.m - 1, d.d, d.H || 0, d.M || 0, d.S || 0, 0)
    }
  }
  return Date.now()
}

function payMethod(v: unknown): Sale['paymentMethod'] {
  const s = str(v).toLowerCase()
  if (s === 'cash' || s === 'card' || s === 'other') return s
  return 'cash'
}

function movType(v: unknown): StockMovement['type'] {
  const s = str(v).toLowerCase()
  if (s === 'sale' || s === 'purchase' || s === 'adjustment') return s
  return 'adjustment'
}

function isEmptyRow(r: Record<string, unknown>): boolean {
  return Object.values(r).every((x) => x === '' || x == null)
}

function readDataRows(wb: XLSX.WorkBook, sheetName: string): Record<string, unknown>[] {
  const ws = wb.Sheets[sheetName]
  if (!ws) {
    throw new Error(`Missing worksheet "${sheetName}". Export from this app first, then edit if needed.`)
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: '',
    raw: true,
  })
  const filtered = rows.filter((r) => !isEmptyRow(r))
  if (filtered.length === 0) return []
  if (filtered.length === 1) {
    const keys = Object.keys(filtered[0]!)
    if (keys.length === 1) {
      const cell = String(Object.values(filtered[0]!)[0] ?? '')
      if (cell.startsWith('No ')) return []
    }
  }
  return filtered
}

function rowToProduct(r: Record<string, unknown>): Product {
  return {
    id: optId(r['id']),
    barcode: str(r['barcode']),
    name: str(r['name']),
    category: str(r['category']) || 'Other',
    unit: str(r['unit']) || 'pc',
    quantity: Math.max(0, Math.floor(num(r['quantity']))),
    salePrice: Math.max(0, num(r['salePrice'])),
    costPrice: Math.max(0, num(r['costPrice'])),
    lowStock: Math.max(0, Math.floor(num(r['lowStock']))),
    notes: str(r['notes']),
    updatedAt: parseCreatedAt(r['updatedAt']),
  }
}

function rowToSale(r: Record<string, unknown>): Sale {
  return {
    id: optId(r['id']),
    receiptNo: str(r['receiptNo']),
    createdAt: parseCreatedAt(r['createdAt']),
    subtotal: Math.max(0, num(r['subtotal'])),
    discount: Math.max(0, num(r['discount'])),
    total: Math.max(0, num(r['total'])),
    paymentMethod: payMethod(r['paymentMethod']),
    notes: str(r['notes']),
  }
}

function rowToSaleLine(r: Record<string, unknown>): SaleLine {
  return {
    id: optId(r['id']),
    saleId: Math.floor(num(r['saleId'], 0)),
    productId: Math.floor(num(r['productId'], 0)),
    barcode: str(r['barcode']),
    productName: str(r['productName']),
    unit: str(r['unit']) || 'pc',
    quantity: Math.max(0, Math.floor(num(r['quantity']))),
    unitSalePrice: Math.max(0, num(r['unitSalePrice'])),
    unitCost: Math.max(0, num(r['unitCost'])),
  }
}

function rowToMovement(r: Record<string, unknown>): StockMovement {
  return {
    id: optId(r['id']),
    productId: Math.floor(num(r['productId'], 0)),
    createdAt: parseCreatedAt(r['createdAt']),
    delta: Math.floor(num(r['delta'], 0)),
    type: movType(r['type']),
    refSaleId: optRefSaleId(r['refSaleId']),
    note: str(r['note']),
  }
}

function rowToSetting(r: Record<string, unknown>): SettingRow {
  return { key: str(r['key']), value: str(r['value']) }
}

/** Parses an .xlsx from this app’s export and replaces the local database. */
export async function importDatabaseFromExcelFile(file: File): Promise<void> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })

  const productRows = readDataRows(wb, EXCEL_SHEETS.products)
  const saleRows = readDataRows(wb, EXCEL_SHEETS.sales)
  const lineRows = readDataRows(wb, EXCEL_SHEETS.saleLines)
  const movRows = readDataRows(wb, EXCEL_SHEETS.stockMovements)
  const settingRows = readDataRows(wb, EXCEL_SHEETS.settings)

  const products = productRows.map(rowToProduct).filter((p) => p.name || p.barcode)
  const sales = saleRows.map(rowToSale).filter((s) => s.receiptNo)
  const saleLines = lineRows.map(rowToSaleLine).filter((l) => l.saleId > 0 && l.productId > 0)
  const stockMovements = movRows.map(rowToMovement).filter((m) => m.productId > 0)
  const settings = settingRows.map(rowToSetting).filter((s) => s.key)

  await replaceDatabaseTables({
    products,
    sales,
    saleLines,
    stockMovements,
    settings,
  })
}
