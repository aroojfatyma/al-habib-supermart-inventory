import { useEffect, useMemo, useState } from 'react'
import { liveQuery } from 'dexie'
import { db, getStoreInfo, type Sale, type SaleLine } from '../db'
import {
  buildSaleSummaryPrintHtml,
  computeSaleSummary,
  printSaleSummary,
  type SaleSummaryCore,
} from '../lib/saleSummary'
import { formatMoney } from '../lib/money'

async function purchaseStockValueInPeriod(fromMs: number, toMs: number): Promise<number> {
  const moves = await db.stockMovements.where('createdAt').between(fromMs, toMs).toArray()
  let sum = 0
  for (const m of moves) {
    if (m.type !== 'purchase') continue
    const p = await db.products.get(m.productId)
    sum += (p?.costPrice ?? 0) * m.delta
  }
  return sum
}

type Props = {
  open: boolean
  onClose: () => void
  fromMs: number
  toMs: number
  periodFromStr: string
  periodToStr: string
}

export function SaleSummaryDialog({
  open,
  onClose,
  fromMs,
  toMs,
  periodFromStr,
  periodToStr,
}: Props) {
  const [sales, setSales] = useState<Sale[]>([])
  const [lines, setLines] = useState<SaleLine[]>([])
  const [paymentsOut, setPaymentsOut] = useState(0)

  useEffect(() => {
    if (!open) return
    const sub = liveQuery(async () => {
      const list = await db.sales.where('createdAt').between(fromMs, toMs).toArray()
      const ids = list.map((s) => s.id).filter((id): id is number => id != null)
      const allLines =
        ids.length === 0 ? [] : await db.saleLines.where('saleId').anyOf(ids).toArray()
      return { list, allLines }
    }).subscribe({
      next: (v) => {
        setSales(v.list)
        setLines(v.allLines)
      },
      error: () => {
        setSales([])
        setLines([])
      },
    })
    return () => sub.unsubscribe()
  }, [open, fromMs, toMs])

  useEffect(() => {
    if (!open) return
    void purchaseStockValueInPeriod(fromMs, toMs).then(setPaymentsOut)
  }, [open, fromMs, toMs])

  const core = useMemo((): SaleSummaryCore => {
    const c = computeSaleSummary(sales, lines)
    return { ...c, paymentsOut }
  }, [sales, lines, paymentsOut])

  const fmtInt = (n: number) =>
    new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(Math.round(n))

  const doPrint = () => {
    void getStoreInfo().then((store) => {
      const html = buildSaleSummaryPrintHtml({
        ...core,
        reportTitle: store.storeName,
        periodFrom: periodFromStr,
        periodTo: periodToStr,
        generatedAt: new Date().toLocaleString('en-PK', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
      })
      printSaleSummary(html)
    })
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const periodHint =
    periodFromStr === periodToStr ? periodFromStr : `${periodFromStr} → ${periodToStr}`

  return (
    <div
      className="sale-summary-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="sale-summary-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sale-summary-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sale-summary-header">
          <h2 id="sale-summary-title">Sale summary</h2>
          <button type="button" className="btn secondary sm sale-summary-close" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="sale-summary-period hint">{periodHint}</p>

        <div className="sale-summary-bar b1">
          <div className="sale-summary-cell">
            <span className="sale-summary-label">Total sale</span>
            <span className="sale-summary-value">{fmtInt(core.totalSaleNet)}</span>
          </div>
          <div className="sale-summary-cell right">
            <span className="sale-summary-label">Total sale qty</span>
            <span className="sale-summary-value">{fmtInt(core.totalSaleQty)}</span>
          </div>
        </div>

        <div className="sale-summary-bar b2">
          <div className="sale-summary-cell">
            <span className="sale-summary-label">Total sale return</span>
            <span className="sale-summary-value">{fmtInt(core.totalReturnAmount)}</span>
          </div>
          <div className="sale-summary-cell right">
            <span className="sale-summary-label">Total return qty</span>
            <span className="sale-summary-value">{fmtInt(core.totalReturnQty)}</span>
          </div>
        </div>

        <div className="sale-summary-bar b3">
          <div className="sale-summary-cell">
            <span className="sale-summary-label">Receivings</span>
            <span className="sale-summary-value">{fmtInt(core.receivingsGross)}</span>
          </div>
          <div className="sale-summary-cell right">
            <span className="sale-summary-label">Payments</span>
            <span className="sale-summary-value">{fmtInt(core.paymentsOut)}</span>
          </div>
        </div>

        <div className="sale-summary-bar b4">
          <div className="sale-summary-cell">
            <span className="sale-summary-label">Cash payments</span>
            <span className="sale-summary-value">{fmtInt(core.cashTotal)}</span>
          </div>
          <div className="sale-summary-cell right">
            <span className="sale-summary-label">Card payments</span>
            <span className="sale-summary-value">{fmtInt(core.cardTotal)}</span>
          </div>
        </div>

        {core.otherTotal > 0 ? (
          <p className="sale-summary-other hint">
            Other payments: {formatMoney(core.otherTotal)}
          </p>
        ) : null}

        <p className="sale-summary-closing">
          Closing cash : {fmtInt(core.cashTotal)}
          {core.otherTotal > 0 ? ` (other ${fmtInt(core.otherTotal)})` : ''}
        </p>

        <div className="sale-summary-actions">
          <button type="button" className="btn primary" onClick={doPrint}>
            Print
          </button>
        </div>
      </div>
    </div>
  )
}
