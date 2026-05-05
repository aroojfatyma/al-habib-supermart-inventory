import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import { db, getSaleWithLines, getStoreInfo, type Sale } from '../db'
import { formatMoney } from '../lib/money'
import { buildReceiptHtml, loadReceiptLogoDataUrl, printReceiptHtml } from '../lib/receipt'

type SaleDetail = NonNullable<Awaited<ReturnType<typeof getSaleWithLines>>>

export function SalesHistoryView() {
  const [sales, setSales] = useState<Sale[]>([])
  const [selected, setSelected] = useState<SaleDetail | null>(null)

  useEffect(() => {
    const sub = liveQuery(() => db.sales.orderBy('createdAt').reverse().toArray()).subscribe({
      next: setSales,
      error: () => {
        void db.sales.orderBy('createdAt').reverse().toArray().then(setSales)
      },
    })
    return () => sub.unsubscribe()
  }, [])

  const openSale = (saleId: number) => {
    void getSaleWithLines(saleId).then((pack) => {
      if (pack) setSelected(pack)
    })
  }

  const reprint = async (saleId: number) => {
    const pack = await getSaleWithLines(saleId)
    if (!pack) return
    const [store, logoDataUrl] = await Promise.all([getStoreInfo(), loadReceiptLogoDataUrl()])
    const html = await buildReceiptHtml(
      { ...store, logoDataUrl: logoDataUrl || undefined },
      pack.sale,
      pack.lines,
    )
    printReceiptHtml(html)
  }

  return (
    <div className="view-stack">
      <section className="card">
        <h2 className="section-title">Sales & receipts</h2>
        <p className="hint">
          All sales stored on this device (newest first). Open a row for lines or reprint. Use{' '}
          <strong>Inventory → Export to Excel</strong> to archive data.
        </p>
        <div className="table-wrap flat table-wrap-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>When</th>
                <th className="num">Total</th>
                <th>Payment</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr
                  key={s.id}
                  className={s.id != null && s.id === selected?.sale.id ? 'row-active' : undefined}
                  onClick={() => {
                    if (s.id != null) openSale(s.id)
                  }}
                >
                  <td className="mono">{s.receiptNo}</td>
                  <td>
                    {new Date(s.createdAt).toLocaleString('en-PK', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </td>
                  <td className="num">{formatMoney(s.total)}</td>
                  <td>{s.paymentMethod}</td>
                  <td>
                    <button
                      type="button"
                      className="btn secondary sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (s.id != null) void reprint(s.id)
                      }}
                    >
                      Reprint
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sales.length === 0 ? <p className="empty">No sales recorded yet — use Point of sale.</p> : null}
        </div>
      </section>

      {selected ? (
        <section className="card">
          <div className="detail-head">
            <h2 className="section-title">{selected.sale.receiptNo}</h2>
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                if (selected.sale.id != null) void reprint(selected.sale.id)
              }}
            >
              Print receipt
            </button>
            <button type="button" className="btn secondary" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <div className="detail-meta">
            <span>
              {new Date(selected.sale.createdAt).toLocaleString('en-PK', {
                dateStyle: 'full',
                timeStyle: 'short',
              })}
            </span>
            <span>Payment: {selected.sale.paymentMethod}</span>
          </div>
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Qty</th>
                <th className="num">Sale</th>
                <th className="num">Cost</th>
                <th className="num">Line profit</th>
              </tr>
            </thead>
            <tbody>
              {selected.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.productName}</td>
                  <td className="num">
                    {l.quantity} {l.unit}
                  </td>
                  <td className="num">{formatMoney(l.unitSalePrice)}</td>
                  <td className="num">{formatMoney(l.unitCost)}</td>
                  <td className="num">{formatMoney((l.unitSalePrice - l.unitCost) * l.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="detail-totals">
            <div>
              Subtotal <strong>{formatMoney(selected.sale.subtotal)}</strong>
            </div>
            {selected.sale.discount > 0 ? (
              <div>
                Discount <strong>−{formatMoney(selected.sale.discount)}</strong>
              </div>
            ) : null}
            <div className="grand">
              Total <strong>{formatMoney(selected.sale.total)}</strong>
            </div>
          </div>
          {selected.sale.notes ? <p className="hint">Notes: {selected.sale.notes}</p> : null}
        </section>
      ) : null}
    </div>
  )
}
