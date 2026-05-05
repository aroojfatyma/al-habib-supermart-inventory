import {
  db,
  normalizeProductCategory,
  type Product,
  type Sale,
  type SaleLine,
  type StockMovement,
  type SettingRow,
} from '../db'

export type ImportTables = {
  products: Product[]
  sales: Sale[]
  saleLines: SaleLine[]
  stockMovements: StockMovement[]
  settings: SettingRow[]
}

/** Replaces all business tables (full restore). Caller must validate data shape. */
export async function replaceDatabaseTables(data: ImportTables): Promise<void> {
  await db.transaction(
    'rw',
    [db.products, db.sales, db.saleLines, db.stockMovements, db.settings],
    async () => {
      await db.products.clear()
      await db.sales.clear()
      await db.saleLines.clear()
      await db.stockMovements.clear()
      await db.settings.clear()

      if (data.products.length) {
        const products = data.products.map((row) => ({
          ...row,
          category: normalizeProductCategory(row.category),
        }))
        await db.products.bulkPut(products)
      }
      if (data.sales.length) await db.sales.bulkPut(data.sales)
      if (data.saleLines.length) await db.saleLines.bulkPut(data.saleLines)
      if (data.stockMovements.length) await db.stockMovements.bulkPut(data.stockMovements)
      for (const row of data.settings) {
        await db.settings.put(row)
      }
    },
  )
}
