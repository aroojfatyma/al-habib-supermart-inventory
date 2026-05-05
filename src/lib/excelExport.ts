import * as XLSX from 'xlsx'
import { db } from '../db'
import type { Product, Sale, SaleLine, SettingRow, StockMovement } from '../db'
import { EXCEL_SHEETS } from './excelWorkbookSheets'

function iso(ms: number | undefined) {
  return ms != null ? new Date(ms).toISOString() : ''
}

function sheetOrPlaceholder(rows: Record<string, unknown>[], emptyLabel: string): XLSX.WorkSheet {
  if (rows.length === 0) {
    return XLSX.utils.aoa_to_sheet([[emptyLabel]])
  }
  return XLSX.utils.json_to_sheet(rows)
}

/** Writes a multi-sheet .xlsx with products, sales, lines, movements, and settings. */
export async function exportDatabaseToExcelFile(): Promise<void> {
  const [products, sales, saleLines, stockMovements, settings] = await Promise.all([
    db.products.toArray(),
    db.sales.toArray(),
    db.saleLines.toArray(),
    db.stockMovements.toArray(),
    db.settings.toArray(),
  ])

  const wb = XLSX.utils.book_new()

  const productRows = products.map((p: Product) => ({
    id: p.id ?? '',
    barcode: p.barcode,
    name: p.name,
    category: p.category,
    unit: p.unit,
    quantity: p.quantity,
    salePrice: p.salePrice,
    costPrice: p.costPrice,
    lowStock: p.lowStock,
    notes: p.notes,
    updatedAt: iso(p.updatedAt),
  }))
  XLSX.utils.book_append_sheet(
    wb,
    sheetOrPlaceholder(productRows, 'No products'),
    EXCEL_SHEETS.products,
  )

  const saleRows = sales.map((s: Sale) => ({
    id: s.id ?? '',
    receiptNo: s.receiptNo,
    createdAt: iso(s.createdAt),
    subtotal: s.subtotal,
    discount: s.discount,
    total: s.total,
    paymentMethod: s.paymentMethod,
    notes: s.notes,
  }))
  XLSX.utils.book_append_sheet(wb, sheetOrPlaceholder(saleRows, 'No sales'), EXCEL_SHEETS.sales)

  const lineRows = saleLines.map((l: SaleLine) => ({
    id: l.id ?? '',
    saleId: l.saleId,
    productId: l.productId,
    barcode: l.barcode,
    productName: l.productName,
    unit: l.unit,
    quantity: l.quantity,
    unitSalePrice: l.unitSalePrice,
    unitCost: l.unitCost,
  }))
  XLSX.utils.book_append_sheet(wb, sheetOrPlaceholder(lineRows, 'No sale lines'), EXCEL_SHEETS.saleLines)

  const movRows = stockMovements.map((m: StockMovement) => ({
    id: m.id ?? '',
    productId: m.productId,
    createdAt: iso(m.createdAt),
    delta: m.delta,
    type: m.type,
    refSaleId: m.refSaleId ?? '',
    note: m.note,
  }))
  XLSX.utils.book_append_sheet(
    wb,
    sheetOrPlaceholder(movRows, 'No stock movements'),
    EXCEL_SHEETS.stockMovements,
  )

  const settingRows = settings.map((r: SettingRow) => ({
    key: r.key,
    value: r.value,
  }))
  XLSX.utils.book_append_sheet(wb, sheetOrPlaceholder(settingRows, 'No settings'), EXCEL_SHEETS.settings)

  const day = new Date().toISOString().slice(0, 10)
  const fname = `al-habib-export-${day}.xlsx`

  // Avoid XLSX.writeFile in the browser/Electron: the ESM build routes it through a "file" path that
  // can throw "cannot save file" when anchor.download / Blob download is restricted.
  const raw = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw as ArrayLike<number>)
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = fname
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1500)
  }
}
