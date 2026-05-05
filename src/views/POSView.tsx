import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import {
  completeSale,
  db,
  findByBarcode,
  getSaleWithLines,
  getStoreInfo,
  normalizeProductCategory,
  type Product,
  type Sale,
} from '../db'
import { formatMoney } from '../lib/money'
import { buildReceiptHtml, loadReceiptLogoDataUrl, printReceiptHtml } from '../lib/receipt'

type CartLine = {
  key: string
  productId: number
  name: string
  barcode: string
  /** Present on new lines; older in-memory cart lines may omit until bumped again. */
  category?: string
  unit: string
  maxQty: number
  quantity: number
  unitSalePrice: number
}

/** Replaces a long native select so wheel/trackpad scroll stays inside the list (Electron-friendly). */
function PosProductSearch({
  products,
  onPick,
}: {
  products: Product[]
  onPick: (p: Product) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const fn = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [open])

  const filtered = useMemo(() => {
    const qn = q.trim().toLowerCase()
    return products.filter((p) => {
      if (p.id == null || p.quantity <= 0) return false
      if (!qn) return true
      const cat = normalizeProductCategory(p.category).toLowerCase()
      return (
        p.name.toLowerCase().includes(qn) ||
        cat.includes(qn) ||
        p.barcode.toLowerCase().includes(qn)
      )
    })
  }, [products, q])

  const select = (p: Product) => {
    onPick(p)
    setOpen(false)
    setQ('')
  }

  return (
    <div className="pos-product-picker" ref={wrapRef}>
      <button
        type="button"
        className="btn secondary pos-picker-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Close list' : 'Browse / search products'}
      </button>
      {open ? (
        <div className="pos-picker-panel">
          <input
            type="search"
            className="input"
            placeholder="Name, category, or barcode…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <ul
            className="pos-picker-list"
            role="listbox"
            aria-label="In-stock products"
            onWheel={(e) => e.stopPropagation()}
          >
            {filtered.length === 0 ? (
              <li className="pos-picker-empty">No matching in-stock items.</li>
            ) : (
              filtered.map((p) => (
                <li key={p.id} role="presentation">
                  <button type="button" className="pos-picker-row" onClick={() => select(p)}>
                    <span className="pos-picker-cat">{normalizeProductCategory(p.category)}</span>
                    <span className="pos-picker-name">{p.name}</span>
                    <span className="pos-picker-meta">
                      {formatMoney(p.salePrice)} · {p.quantity} {p.unit}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export function POSView() {
  const [products, setProducts] = useState<Product[]>([])
  const [scanBuffer, setScanBuffer] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [discount, setDiscount] = useState(0)
  const [payment, setPayment] = useState<Sale['paymentMethod']>('cash')
  const [notes, setNotes] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const scanRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const sub = liveQuery(() => db.products.orderBy('name').toArray()).subscribe({
      next: setProducts,
      error: () => void db.products.orderBy('name').toArray().then(setProducts),
    })
    return () => sub.unsubscribe()
  }, [])

  useEffect(() => {
    scanRef.current?.focus()
  }, [])

  const subtotal = useMemo(
    () => cart.reduce((s, l) => s + l.unitSalePrice * l.quantity, 0),
    [cart],
  )
  const discountClamped = Math.max(0, Math.min(subtotal, discount))
  const total = subtotal - discountClamped

  const addOrBump = useCallback((p: Product) => {
    const pid = p.id
    if (pid == null) return
    if (p.quantity <= 0) {
      setMsg(`Out of stock: ${p.name}`)
      return
    }
    setMsg(null)
    setCart((prev) => {
      const i = prev.findIndex((x) => x.productId === pid)
      if (i >= 0) {
        const line = prev[i]!
        if (line.quantity >= line.maxQty) {
          setMsg(`Maximum on hand for ${p.name}: ${line.maxQty}`)
          return prev
        }
        const next = [...prev]
        next[i] = {
          ...line,
          quantity: line.quantity + 1,
          category: line.category ?? normalizeProductCategory(undefined),
        }
        return next
      }
      return [
        ...prev,
        {
          key: `${pid}-${Date.now()}`,
          productId: pid,
          name: p.name,
          barcode: p.barcode,
          category: normalizeProductCategory(p.category),
          unit: p.unit,
          maxQty: p.quantity,
          quantity: 1,
          unitSalePrice: p.salePrice,
        },
      ]
    })
  }, [])

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault()
    const code = scanBuffer.trim()
    if (!code) return
    const p = await findByBarcode(code)
    if (!p) {
      setMsg(`Unknown barcode: ${code}`)
      setScanBuffer('')
      scanRef.current?.focus()
      return
    }
    addOrBump(p)
    setScanBuffer('')
    scanRef.current?.focus()
  }

  const setLineQty = (key: string, qty: number) => {
    setCart((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l
        const q = Math.max(1, Math.min(l.maxQty, Math.floor(qty)))
        return { ...l, quantity: q }
      }),
    )
  }

  const setLinePrice = (key: string, price: number) => {
    setCart((prev) =>
      prev.map((l) => (l.key === key ? { ...l, unitSalePrice: Math.max(0, price) } : l)),
    )
  }

  const removeLine = (key: string) => {
    setCart((prev) => prev.filter((l) => l.key !== key))
  }

  const checkout = async () => {
    if (cart.length === 0) {
      setMsg('Add items to the cart first.')
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const { saleId } = await completeSale({
        lines: cart.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitSalePrice: l.unitSalePrice,
        })),
        discount: discountClamped,
        paymentMethod: payment,
        notes,
      })
      const pack = await getSaleWithLines(saleId)
      if (pack) {
        const [store, logoDataUrl] = await Promise.all([getStoreInfo(), loadReceiptLogoDataUrl()])
        const html = await buildReceiptHtml({ ...store, logoDataUrl: logoDataUrl || undefined }, pack.sale, pack.lines)
        printReceiptHtml(html)
      }
      setCart([])
      setDiscount(0)
      setNotes('')
      setMsg('Sale completed — receipt opened for printing. Use an 80mm thermal printer if you have one.')
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Checkout failed.')
    } finally {
      setBusy(false)
      scanRef.current?.focus()
    }
  }

  return (
    <div className="view-stack pos-layout">
      <section className="card pos-scan">
        <h2 className="section-title">Scan or search</h2>
        <form onSubmit={handleScan} className="scan-form">
          <input
            ref={scanRef}
            className="input scan-input"
            placeholder="Barcode — USB scanner or type Enter…"
            value={scanBuffer}
            onChange={(e) => setScanBuffer(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="btn primary">
            Add
          </button>
        </form>
        <div className="pos-quick-add">
          <span className="hint">Quick add without barcode — search scrolls inside this box only:</span>
          <PosProductSearch products={products} onPick={addOrBump} />
        </div>
        {msg ? <p className="scan-msg">{msg}</p> : null}
      </section>

      <div className="pos-split">
        <section className="card pos-cart">
          <h2 className="section-title">Cart</h2>
          {cart.length === 0 ? (
            <p className="empty">No items yet. Scan a barcode to start.</p>
          ) : (
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th className="num">Price</th>
                  <th className="num">Line</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cart.map((l) => (
                  <tr key={l.key}>
                    <td>
                      <div className="cart-name">{l.name}</div>
                      <div className="cart-meta">
                        <span className="cart-cat">{normalizeProductCategory(l.category)}</span>
                        <span className="mono"> · {l.barcode}</span>
                      </div>
                    </td>
                    <td className="num">
                      <input
                        type="number"
                        min={1}
                        max={l.maxQty}
                        className="input inline-qty"
                        value={l.quantity}
                        onChange={(e) => setLineQty(l.key, Number(e.target.value))}
                      />
                    </td>
                    <td className="num">
                      <input
                        type="number"
                        min={0}
                        className="input inline-price"
                        value={l.unitSalePrice}
                        onChange={(e) => setLinePrice(l.key, Number(e.target.value))}
                      />
                    </td>
                    <td className="num">{formatMoney(l.unitSalePrice * l.quantity)}</td>
                    <td>
                      <button type="button" className="btn danger ghost sm" onClick={() => removeLine(l.key)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card pos-totals">
          <h2 className="section-title">Checkout</h2>
          <div className="totals-stack">
            <div className="total-row">
              <span>Subtotal</span>
              <strong>{formatMoney(subtotal)}</strong>
            </div>
            <label className="total-discount">
              Discount (PKR)
              <input
                type="number"
                min={0}
                className="input"
                value={discount}
                onChange={(e) => setDiscount(Math.max(0, Number(e.target.value)))}
              />
            </label>
            <div className="total-row grand">
              <span>Total due</span>
              <strong>{formatMoney(total)}</strong>
            </div>
            <label>
              Payment
              <select
                className="input"
                value={payment}
                onChange={(e) => setPayment(e.target.value as Sale['paymentMethod'])}
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Notes (optional)
              <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn primary large"
              disabled={busy || cart.length === 0}
              onClick={() => void checkout()}
            >
              {busy ? 'Processing…' : 'Complete sale & print receipt'}
            </button>
            <p className="hint" style={{ marginTop: '0.65rem', marginBottom: 0 }}>
              Receipt layout matches a typical superstore slip (80mm roll). In the print dialog, choose your
              receipt printer; margin is set for narrow paper.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
