import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import { DEFAULT_CATEGORIES, UNITS } from '../categories'
import { AddProductForm } from '../components/AddProductForm'
import {
  db,
  findByBarcode,
  logStockAdjustment,
  normalizeProductCategory,
  receiveStock,
  type Product,
  type StockMovement,
} from '../db'
import { formatMoney } from '../lib/money'
import {
  getSyncStatus,
  pullFromServer,
  pushToServer,
} from '../lib/sync'

export function InventoryView() {
  const [products, setProducts] = useState<Product[]>([])
  const [movementRows, setMovementRows] = useState<StockMovement[]>([])
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [scanBuffer, setScanBuffer] = useState('')
  const [barcodeForNewProduct, setBarcodeForNewProduct] = useState('')
  const [scanMessage, setScanMessage] = useState<string | null>(null)
  const [activeProduct, setActiveProduct] = useState<Product | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [receiveQty, setReceiveQty] = useState(1)
  const [receiveNote, setReceiveNote] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const scanRef = useRef<HTMLInputElement>(null)

  const [syncLastOk, setSyncLastOk] = useState<string | null>(null)
  const [syncLastErr, setSyncLastErr] = useState<string | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)

  const loadSyncUi = useCallback(async () => {
    const st = await getSyncStatus()
    setSyncLastOk(st.lastOkAt)
    setSyncLastErr(st.lastError)
  }, [])

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      void loadSyncUi()
    })
    return () => cancelAnimationFrame(id)
  }, [loadSyncUi])

  const refresh = useCallback(async () => {
    const [list, mv] = await Promise.all([
      db.products.orderBy('name').toArray(),
      db.stockMovements.orderBy('createdAt').reverse().toArray(),
    ])
    setProducts(list)
    setMovementRows(mv)
  }, [])

  useEffect(() => {
    const subP = liveQuery(() => db.products.orderBy('name').toArray()).subscribe({
      next: setProducts,
      error: () => void refresh(),
    })
    const subM = liveQuery(() => db.stockMovements.orderBy('createdAt').reverse().toArray()).subscribe({
      next: setMovementRows,
      error: () => void refresh(),
    })
    return () => {
      subP.unsubscribe()
      subM.unsubscribe()
    }
  }, [refresh])

  const movements = useMemo(() => {
    const names = new Map<number, string>()
    for (const p of products) {
      if (p.id != null) names.set(p.id, p.name)
    }
    return movementRows.map((m) => ({
      ...m,
      productName: names.get(m.productId) ?? `#${m.productId}`,
    }))
  }, [products, movementRows])

  const categoriesInUse = useMemo(() => {
    const s = new Set<string>([...DEFAULT_CATEGORIES])
    products.forEach((p) => s.add(normalizeProductCategory(p.category)))
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [products])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products.filter((p) => {
      const cat = normalizeProductCategory(p.category)
      if (categoryFilter && cat !== categoryFilter) return false
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q) ||
        cat.toLowerCase().includes(q)
      )
    })
  }, [products, query, categoryFilter])

  const lowStock = useMemo(
    () => products.filter((p) => p.quantity <= p.lowStock && p.lowStock > 0),
    [products],
  )

  const handleScanSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const code = scanBuffer.trim()
    if (!code) return
    const found = await findByBarcode(code)
    if (found) {
      setActiveProduct(found)
      setAddOpen(false)
      setEditOpen(false)
      setScanMessage(`Opened: ${found.name}`)
    } else {
      setBarcodeForNewProduct(code)
      setActiveProduct(null)
      setAddOpen(true)
      setEditOpen(false)
      setScanMessage('Barcode not found — add a new product below.')
    }
    setScanBuffer('')
    scanRef.current?.focus()
  }

  const adjustStock = async (p: Product, delta: number) => {
    if (p.id == null) return
    const next = Math.max(0, p.quantity + delta)
    const actualDelta = next - p.quantity
    await db.products.update(p.id, { quantity: next, updatedAt: Date.now() })
    if (actualDelta !== 0) await logStockAdjustment(p.id, actualDelta, 'Quick adjust from inventory')
    const updated = await db.products.get(p.id)
    if (updated) setActiveProduct(updated)
  }

  const setQuantity = async (p: Product, quantity: number) => {
    if (p.id == null) return
    const q = Math.max(0, Math.floor(quantity))
    const delta = q - p.quantity
    await db.products.update(p.id, { quantity: q, updatedAt: Date.now() })
    if (delta !== 0) await logStockAdjustment(p.id, delta, 'Set quantity from inventory')
    const updated = await db.products.get(p.id)
    if (updated) setActiveProduct(updated)
  }

  const deleteProduct = async (p: Product) => {
    if (p.id == null) return
    if (!confirm(`Remove "${p.name}" from inventory?`)) return
    await db.products.delete(p.id)
    setActiveProduct(null)
    setAddOpen(false)
    setEditOpen(false)
  }

  const exportExcel = async () => {
    try {
      const { exportDatabaseToExcelFile } = await import('../lib/excelExport')
      await exportDatabaseToExcelFile()
      setScanMessage('Excel file downloaded (all sheets).')
    } catch {
      setScanMessage('Excel export failed — try again.')
    }
  }

  const importExcel = async (file: File) => {
    if (
      !confirm(
        'Replace ALL data on this device with this Excel file? Current products, sales, and stock history will be overwritten.',
      )
    ) {
      return
    }
    try {
      const { importDatabaseFromExcelFile } = await import('../lib/excelImport')
      await importDatabaseFromExcelFile(file)
      setScanMessage('Imported from Excel — products, sales, lines, movements, and settings updated.')
    } catch (e) {
      setScanMessage(
        e instanceof Error
          ? `Import failed: ${e.message}`
          : 'Import failed — use an .xlsx exported from this app (same sheet names).',
      )
    }
  }

  const doPushSync = async () => {
    if (!confirm('Upload this device’s full database to the server? This overwrites the server copy.')) {
      return
    }
    setSyncBusy(true)
    try {
      await pushToServer()
      await loadSyncUi()
      setScanMessage('Uploaded to server.')
    } catch (e) {
      setScanMessage(e instanceof Error ? e.message : 'Upload failed.')
      await loadSyncUi()
    } finally {
      setSyncBusy(false)
    }
  }

  const doPullSync = async () => {
    if (!confirm('Download from the server and replace ALL data on this device?')) {
      return
    }
    setSyncBusy(true)
    try {
      await pullFromServer()
      await loadSyncUi()
      setScanMessage('Downloaded from server — local data replaced.')
      setActiveProduct(null)
    } catch (e) {
      setScanMessage(e instanceof Error ? e.message : 'Download failed.')
      await loadSyncUi()
    } finally {
      setSyncBusy(false)
    }
  }

  const syncLastOkLabel =
    syncLastOk && !Number.isNaN(Number(syncLastOk))
      ? new Date(Number(syncLastOk)).toLocaleString('en-PK', {
          dateStyle: 'short',
          timeStyle: 'short',
        })
      : null

  const doReceive = async () => {
    if (!activeProduct?.id) return
    try {
      await receiveStock(activeProduct.id, receiveQty, receiveNote)
      setReceiveNote('')
      setReceiveQty(1)
      setScanMessage(`Received stock for ${activeProduct.name}.`)
      const updated = await db.products.get(activeProduct.id)
      if (updated) setActiveProduct(updated)
    } catch (e) {
      setScanMessage(e instanceof Error ? e.message : 'Receive failed.')
    }
  }

  return (
    <div className="view-stack">
      <section className="scan-panel card">
        <h2>Barcode scanner</h2>
        <p className="hint">
          Click here first, then scan — most USB scanners act like a keyboard and press Enter.
        </p>
        <form onSubmit={handleScanSubmit} className="scan-form">
          <input
            ref={scanRef}
            className="input scan-input"
            placeholder="Scan barcode or type and press Enter…"
            value={scanBuffer}
            onChange={(e) => setScanBuffer(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="btn primary">
            Look up
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              setBarcodeForNewProduct('')
              setAddOpen(true)
              setActiveProduct(null)
              setEditOpen(false)
              setScanMessage('Enter details — add a barcode if the item has one.')
            }}
          >
            Add without scan
          </button>
        </form>
        <div className="inv-backup-row">
          <label className="btn secondary">
            Import from Excel
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void importExcel(f)
                e.target.value = ''
              }}
            />
          </label>
          <button type="button" className="btn primary" onClick={() => void exportExcel()}>
            Export to Excel
          </button>
        </div>
        <p className="hint inv-backup-hint">
          One workbook with sheets: Products, Sales, Sale lines, Stock movements, Settings. Import{' '}
          <strong>replaces everything</strong> on this device — export a copy first if you are unsure.
        </p>
        {scanMessage ? <p className="scan-msg">{scanMessage}</p> : null}
      </section>

      <section className="card sync-panel">
        <h2 className="section-title">Server sync</h2>
        <p className="hint">
          Sync is preconfigured in this app build. Use these buttons to upload/download data with the configured
          server.
        </p>
        <div className="grid-form sync-form">
          <div className="form-actions span-2 sync-actions">
            <button type="button" className="btn secondary" onClick={() => void doPushSync()} disabled={syncBusy}>
              Upload to server
            </button>
            <button type="button" className="btn secondary" onClick={() => void doPullSync()} disabled={syncBusy}>
              Download from server
            </button>
          </div>
        </div>
        <p className="hint sync-status-hint">
          Last sync: {syncLastOkLabel ?? '—'}
          {syncLastErr ? (
            <>
              <br />
              <span className="sync-err">Last error: {syncLastErr}</span>
            </>
          ) : null}
        </p>
      </section>

      {activeProduct ? (
        <section className="card active-card">
          <div className="active-head">
            <h2>{activeProduct.name}</h2>
            <span className="pill">{activeProduct.barcode}</span>
          </div>
          <div className="active-grid">
            <div>
              <div className="stat-label">On hand</div>
              <div className="stat-value">
                {activeProduct.quantity} {activeProduct.unit}
              </div>
            </div>
            <div>
              <div className="stat-label">Sale price</div>
              <div className="stat-value">{formatMoney(activeProduct.salePrice)}</div>
            </div>
            <div>
              <div className="stat-label">Cost price</div>
              <div className="stat-value">{formatMoney(activeProduct.costPrice)}</div>
            </div>
            <div>
              <div className="stat-label">Category</div>
              <div className="stat-value small">{normalizeProductCategory(activeProduct.category)}</div>
            </div>
          </div>
          <div className="stock-actions">
            <button type="button" className="btn" onClick={() => adjustStock(activeProduct, -1)}>
              −1
            </button>
            <button type="button" className="btn" onClick={() => adjustStock(activeProduct, 1)}>
              +1
            </button>
            <label className="set-qty">
              Set qty
              <input
                type="number"
                min={0}
                className="input inline-num"
                defaultValue={activeProduct.quantity}
                key={activeProduct.id + '-' + activeProduct.quantity}
                onBlur={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) void setQuantity(activeProduct, v)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = Number((e.target as HTMLInputElement).value)
                    if (Number.isFinite(v)) void setQuantity(activeProduct, v)
                  }
                }}
              />
            </label>
            <button type="button" className="btn secondary" onClick={() => setEditOpen((v) => !v)}>
              {editOpen ? 'Close editor' : 'Edit product'}
            </button>
            <button
              type="button"
              className="btn danger ghost"
              onClick={() => void deleteProduct(activeProduct)}
            >
              Delete item
            </button>
          </div>

          <div className="receive-block">
            <h3 className="subhead">Stock in (purchase / delivery)</h3>
            <div className="receive-row">
              <label>
                Quantity
                <input
                  type="number"
                  min={1}
                  className="input"
                  value={receiveQty}
                  onChange={(e) => setReceiveQty(Number(e.target.value))}
                />
              </label>
              <label className="flex-grow">
                Note
                <input
                  className="input"
                  value={receiveNote}
                  onChange={(e) => setReceiveNote(e.target.value)}
                  placeholder="Supplier, invoice #, etc."
                />
              </label>
              <button type="button" className="btn primary receive-btn" onClick={() => void doReceive()}>
                Add to stock
              </button>
            </div>
          </div>

          {editOpen ? (
            <EditProductForm
              key={activeProduct.id}
              product={activeProduct}
              categories={categoriesInUse}
              onClose={() => setEditOpen(false)}
              onSaved={async () => {
                const id = activeProduct.id
                if (id != null) {
                  const u = await db.products.get(id)
                  if (u) setActiveProduct(u)
                }
                setEditOpen(false)
              }}
            />
          ) : null}
        </section>
      ) : null}

      {addOpen ? (
        <AddProductForm
          key={barcodeForNewProduct || 'new'}
          initialBarcode={barcodeForNewProduct}
          categories={categoriesInUse}
          onCancel={() => {
            setAddOpen(false)
            setBarcodeForNewProduct('')
            setScanMessage(null)
          }}
          onSaved={async (barcode) => {
            setAddOpen(false)
            setBarcodeForNewProduct('')
            setScanMessage('Product saved.')
            const p = await findByBarcode(barcode)
            if (p) setActiveProduct(p)
          }}
        />
      ) : null}

      <section className="toolbar card">
        <input
          className="input flex"
          placeholder="Search name, barcode, category…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="input select"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">All categories</option>
          {categoriesInUse.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </section>

      {lowStock.length > 0 ? (
        <section className="card warn-banner">
          <strong>Low stock:</strong>{' '}
          {lowStock.map((p) => (
            <button
              type="button"
              key={p.id}
              className="linkish"
              onClick={() => {
                setActiveProduct(p)
                setAddOpen(false)
                setEditOpen(false)
              }}
            >
              {p.name} ({p.quantity})
            </button>
          ))}
        </section>
      ) : null}

      <div className="table-wrap card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Barcode</th>
              <th>Category</th>
              <th className="num">Qty</th>
              <th className="num">Sale</th>
              <th className="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr
                key={p.id}
                className={p.id === activeProduct?.id ? 'row-active' : undefined}
                onClick={() => {
                  setActiveProduct(p)
                  setAddOpen(false)
                  setEditOpen(false)
                }}
              >
                <td>{p.name}</td>
                <td className="mono">{p.barcode}</td>
                <td>{normalizeProductCategory(p.category)}</td>
                <td className="num">
                  {p.quantity} {p.unit}
                </td>
                <td className="num">{formatMoney(p.salePrice)}</td>
                <td className="num">{formatMoney(p.costPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 ? <p className="empty">No products match.</p> : null}
      </div>

      <section className="card">
        <h2 className="section-title">Stock movements</h2>
        <p className="hint">
          All sales, stock in, and adjustments on this device (newest first). Nothing is trimmed — keep
          backups via <strong>Export to Excel</strong>.
        </p>
        <div className="table-wrap flat table-wrap-scroll">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>When</th>
                <th>Product</th>
                <th>Type</th>
                <th className="num">Δ Qty</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td className="nowrap">
                    {new Date(m.createdAt).toLocaleString('en-PK', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </td>
                  <td>{m.productName}</td>
                  <td>{m.type}</td>
                  <td className="num">{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                  <td className="small muted">{m.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {movements.length === 0 ? <p className="empty">No movements yet.</p> : null}
        </div>
      </section>
    </div>
  )
}

function EditProductForm({
  product,
  categories,
  onClose,
  onSaved,
}: {
  product: Product
  categories: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(product.name)
  const [barcode, setBarcode] = useState(product.barcode)
  const [category, setCategory] = useState(normalizeProductCategory(product.category))
  const [unit, setUnit] = useState(product.unit)
  const [salePrice, setSalePrice] = useState(product.salePrice)
  const [costPrice, setCostPrice] = useState(product.costPrice)
  const [lowStock, setLowStock] = useState(product.lowStock)
  const [notes, setNotes] = useState(product.notes)
  const [err, setErr] = useState<string | null>(null)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (!product.id) return
    const b = barcode.trim()
    if (!b) {
      setErr('Barcode is required.')
      return
    }
    if (!name.trim()) {
      setErr('Name is required.')
      return
    }
    const clash = await db.products.where('barcode').equals(b).first()
    if (clash && clash.id !== product.id) {
      setErr('Another product already uses this barcode.')
      return
    }
    await db.products.update(product.id, {
      barcode: b,
      name: name.trim(),
      category: normalizeProductCategory(category),
      unit,
      salePrice: Math.max(0, salePrice),
      costPrice: Math.max(0, costPrice),
      lowStock: Math.max(0, Math.floor(lowStock)),
      notes: notes.trim(),
      updatedAt: Date.now(),
    })
    onSaved()
  }

  return (
    <form className="edit-form card inner" onSubmit={save}>
      <h3 className="subhead">Edit product</h3>
      <div className="grid-form">
        <label>
          Barcode
          <input className="input" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
        </label>
        <label className="span-2">
          Name
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Category
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Unit
          <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sale price
          <input
            type="number"
            min={0}
            className="input"
            value={salePrice}
            onChange={(e) => setSalePrice(Number(e.target.value))}
          />
        </label>
        <label>
          Cost price
          <input
            type="number"
            min={0}
            className="input"
            value={costPrice}
            onChange={(e) => setCostPrice(Number(e.target.value))}
          />
        </label>
        <label>
          Low stock alert
          <input
            type="number"
            min={0}
            className="input"
            value={lowStock}
            onChange={(e) => setLowStock(Number(e.target.value))}
          />
        </label>
        <label className="span-2">
          Notes
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {err ? <p className="error span-2">{err}</p> : null}
        <div className="form-actions span-2">
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Save changes
          </button>
        </div>
      </div>
    </form>
  )
}
