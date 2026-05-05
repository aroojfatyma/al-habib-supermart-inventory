import Dexie, { type EntityTable } from 'dexie'
import { PAKISTANI_SEED_PRODUCTS } from './data/pakistaniSeedInventory'

export type Product = {
  id?: number
  barcode: string
  name: string
  category: string
  unit: string
  quantity: number
  salePrice: number
  costPrice: number
  lowStock: number
  notes: string
  updatedAt: number
}

/** IndexedDB does not enforce types — imports or hand-edited JSON can leave category null. */
export function normalizeProductCategory(raw: unknown): string {
  if (raw == null) return 'Other'
  const s = String(raw).trim()
  if (s === '' || s === 'null' || s === 'undefined') return 'Other'
  return s
}

export type Sale = {
  id?: number
  receiptNo: string
  createdAt: number
  subtotal: number
  discount: number
  total: number
  paymentMethod: 'cash' | 'card' | 'other'
  notes: string
}

export type SaleLine = {
  id?: number
  saleId: number
  productId: number
  barcode: string
  productName: string
  unit: string
  quantity: number
  unitSalePrice: number
  unitCost: number
}

export type StockMovementType = 'sale' | 'purchase' | 'adjustment'

export type StockMovement = {
  id?: number
  productId: number
  createdAt: number
  delta: number
  type: StockMovementType
  refSaleId?: number
  note: string
}

export type SettingRow = {
  key: string
  value: string
}

class InventoryDB extends Dexie {
  products!: EntityTable<Product, 'id'>
  sales!: EntityTable<Sale, 'id'>
  saleLines!: EntityTable<SaleLine, 'id'>
  stockMovements!: EntityTable<StockMovement, 'id'>
  settings!: EntityTable<SettingRow, 'key'>

  constructor() {
    super('al-habib-supermart-inventory')
    this.version(1).stores({
      products: '++id, barcode, name, category, updatedAt',
    })
    this.version(2).stores({
      products: '++id, barcode, name, category, updatedAt',
      sales: '++id, receiptNo, createdAt, paymentMethod',
      saleLines: '++id, saleId, productId',
      stockMovements: '++id, productId, createdAt, type, refSaleId',
      settings: 'key',
    })
    this.version(3)
      .stores({
        products: '++id, barcode, name, category, updatedAt',
        sales: '++id, receiptNo, createdAt, paymentMethod',
        saleLines: '++id, saleId, productId',
        stockMovements: '++id, productId, createdAt, type, refSaleId',
        settings: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('products')
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            const c = p['category']
            if (c == null || String(c).trim() === '' || String(c) === 'null') {
              p['category'] = 'Other'
            }
          })
      })
  }
}

export const db = new InventoryDB()

export async function findByBarcode(barcode: string) {
  const b = barcode.trim()
  if (!b) return undefined
  return db.products.where('barcode').equals(b).first()
}

const DEFAULT_SETTINGS: SettingRow[] = [
  { key: 'storeName', value: 'AL-HABIB Supermart' },
  { key: 'storeSlogan', value: 'Providing All Your Needs' },
  {
    key: 'storeAddress',
    value: 'Behind PTCL Exchange Office Near Mian Waheed-ud-Din Park',
  },
  { key: 'storePhone', value: '0322 / 0317-7030971' },
]

export type StoreInfo = {
  storeName: string
  slogan: string
  address: string
  phone: string
}

export async function getStoreInfo(): Promise<StoreInfo> {
  const keys = ['storeName', 'storeSlogan', 'storeAddress', 'storePhone'] as const
  const rows = await Promise.all(keys.map((k) => db.settings.get(k)))
  const map = Object.fromEntries(keys.map((k, i) => [k, rows[i]?.value ?? ''])) as Record<
    (typeof keys)[number],
    string
  >
  const pick = (key: keyof typeof map, idx: number) =>
    map[key].trim() ? map[key] : DEFAULT_SETTINGS[idx]!.value

  return {
    storeName: map.storeName.trim() ? map.storeName : DEFAULT_SETTINGS[0]!.value,
    slogan: pick('storeSlogan', 1),
    address: pick('storeAddress', 2),
    phone: pick('storePhone', 3),
  }
}

export async function saveStoreInfo(partial: {
  storeName?: string
  slogan?: string
  address?: string
  phone?: string
}) {
  if (partial.storeName != null) await db.settings.put({ key: 'storeName', value: partial.storeName })
  if (partial.slogan != null) await db.settings.put({ key: 'storeSlogan', value: partial.slogan })
  if (partial.address != null) await db.settings.put({ key: 'storeAddress', value: partial.address })
  if (partial.phone != null) await db.settings.put({ key: 'storePhone', value: partial.phone })
}

function yyyymmdd(d: Date) {
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

export type CheckoutLineInput = {
  productId: number
  quantity: number
  unitSalePrice: number
}

export async function completeSale(input: {
  lines: CheckoutLineInput[]
  discount: number
  paymentMethod: Sale['paymentMethod']
  notes: string
}): Promise<{ saleId: number; receiptNo: string }> {
  if (input.lines.length === 0) {
    throw new Error('Cart is empty.')
  }

  return db.transaction('rw', [db.products, db.sales, db.saleLines, db.stockMovements], async () => {
    for (const line of input.lines) {
      const p = await db.products.get(line.productId)
      if (!p?.id) throw new Error('A product in the cart no longer exists.')
      const q = Math.floor(line.quantity)
      if (q <= 0) throw new Error(`Invalid quantity for ${p.name}.`)
      if (p.quantity < q) throw new Error(`Not enough stock: ${p.name} (have ${p.quantity}).`)
    }

    const subtotal = input.lines.reduce((s, l) => s + l.unitSalePrice * Math.floor(l.quantity), 0)
    const discount = Math.max(0, Math.min(subtotal, input.discount))
    const total = subtotal - discount

    const createdAt = Date.now()
    const newSaleId = await db.sales.add({
      receiptNo: `TEMP-${createdAt}-${Math.random().toString(36).slice(2, 9)}`,
      createdAt,
      subtotal,
      discount,
      total,
      paymentMethod: input.paymentMethod,
      notes: input.notes.trim(),
    })
    if (newSaleId === undefined) {
      throw new Error('Could not record sale.')
    }
    const saleId: number = newSaleId

    const day = yyyymmdd(new Date(createdAt))
    const receiptNo = `AH-${day}-${String(saleId).padStart(5, '0')}`
    await db.sales.update(saleId, { receiptNo })

    for (const line of input.lines) {
      const p = (await db.products.get(line.productId))!
      const qty = Math.floor(line.quantity)
      const unitSalePrice = line.unitSalePrice
      const unitCost = p.costPrice

      await db.saleLines.add({
        saleId,
        productId: p.id!,
        barcode: p.barcode,
        productName: p.name,
        unit: p.unit,
        quantity: qty,
        unitSalePrice,
        unitCost,
      })

      await db.products.update(p.id!, {
        quantity: p.quantity - qty,
        updatedAt: Date.now(),
      })

      await db.stockMovements.add({
        productId: p.id!,
        createdAt,
        delta: -qty,
        type: 'sale',
        refSaleId: saleId,
        note: receiptNo,
      })
    }

    return { saleId, receiptNo }
  })
}

export async function receiveStock(productId: number, qty: number, note: string) {
  const q = Math.floor(qty)
  if (q <= 0) throw new Error('Quantity must be a positive whole number.')

  await db.transaction('rw', [db.products, db.stockMovements], async () => {
    const p = await db.products.get(productId)
    if (!p?.id) throw new Error('Product not found.')
    const createdAt = Date.now()
    await db.products.update(productId, {
      quantity: p.quantity + q,
      updatedAt: createdAt,
    })
    await db.stockMovements.add({
      productId,
      createdAt,
      delta: q,
      type: 'purchase',
      note: note.trim() || 'Stock in',
    })
  })
}

export async function logStockAdjustment(productId: number, delta: number, note: string) {
  if (delta === 0) return
  await db.stockMovements.add({
    productId,
    createdAt: Date.now(),
    delta,
    type: 'adjustment',
    note: note.trim() || 'Stock adjustment',
  })
}

export async function getSaleWithLines(saleId: number) {
  const sale = await db.sales.get(saleId)
  if (!sale) return null
  const lines = await db.saleLines.where('saleId').equals(saleId).toArray()
  return { sale, lines }
}

/** Adds Pakistani demo SKUs whose barcodes are not already in inventory (safe on repeat load). */
export async function seedPakistaniInventoryMerge(): Promise<number> {
  const codes = PAKISTANI_SEED_PRODUCTS.map((p) => p.barcode)
  if (codes.length === 0) return 0
  const existing = await db.products.where('barcode').anyOf(codes).toArray()
  const present = new Set(existing.map((e) => e.barcode))
  let added = 0
  const t = Date.now()
  await db.transaction('rw', db.products, async () => {
    for (const p of PAKISTANI_SEED_PRODUCTS) {
      if (present.has(p.barcode)) continue
      await db.products.add({
        ...p,
        updatedAt: t,
      })
      present.add(p.barcode)
      added++
    }
  })
  return added
}
