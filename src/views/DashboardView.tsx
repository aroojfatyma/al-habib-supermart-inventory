import { useCallback, useEffect, useMemo, useState } from 'react'
import { liveQuery } from 'dexie'
import { SaleSummaryDialog } from '../components/SaleSummaryDialog'
import { db, getStoreInfo, type Sale, type SaleLine } from '../db'
import { buildDashboardReportHtml, printDashboardReport, type DashboardPrintPayload } from '../lib/dashboardReport'
import { formatMoney } from '../lib/money'
import { endOfDayMs, startOfDayMs } from '../lib/stats'

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function localYmd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function todayLocal() {
  return localYmd(new Date())
}

export function DashboardView() {
  const [fromStr, setFromStr] = useState(todayLocal)
  const [toStr, setToStr] = useState(todayLocal)
  const [saleSummaryOpen, setSaleSummaryOpen] = useState(false)

  const [sales, setSales] = useState<Sale[]>([])
  const [lines, setLines] = useState<SaleLine[]>([])

  const fromMs = useMemo(() => startOfDayMs(new Date(fromStr + 'T12:00:00')), [fromStr])
  const toMs = useMemo(() => endOfDayMs(new Date(toStr + 'T12:00:00')), [toStr])

  useEffect(() => {
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
  }, [fromMs, toMs])

  const analysis = useMemo(() => {
    const discountTotal = sales.reduce((s, x) => s + x.discount, 0)
    const netTotal = sales.reduce((s, x) => s + x.total, 0)
    const costOfGoods = lines.reduce((s, l) => s + l.unitCost * l.quantity, 0)
    const unitsSold = lines.reduce((s, l) => s + l.quantity, 0)
    const receipts = sales.length
    const lineItems = lines.length
    const profitNetMinusCost = netTotal - costOfGoods
    const marginPctOfNet =
      netTotal > 0 ? Math.round((profitNetMinusCost / netTotal) * 1000) / 10 : 0

    const printPayload: DashboardPrintPayload = {
      periodFrom: fromStr,
      periodTo: toStr,
      generatedAt: new Date().toLocaleString('en-PK', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
      unitsSold,
      receipts,
      lineItems,
      netCollected: netTotal,
      discounts: discountTotal,
      costOfGoods,
      profitNetMinusCost,
      marginPctOfNet,
    }

    return {
      discountTotal,
      netTotal,
      costOfGoods,
      profitNetMinusCost,
      marginPctOfNet,
      unitsSold,
      receipts,
      lineItems,
      printPayload,
    }
  }, [sales, lines, fromStr, toStr])

  const printReport = useCallback(() => {
    void getStoreInfo().then((store) => {
      const html = buildDashboardReportHtml({
        ...analysis.printPayload,
        reportTitle: store.storeName,
      })
      printDashboardReport(html)
    })
  }, [analysis.printPayload])

  const setToday = () => {
    const t = todayLocal()
    setFromStr(t)
    setToStr(t)
  }

  const setLast7Days = () => {
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - 6)
    setFromStr(localYmd(start))
    setToStr(localYmd(end))
  }

  const setThisMonth = () => {
    const end = new Date()
    const start = new Date(end.getFullYear(), end.getMonth(), 1)
    setFromStr(localYmd(start))
    setToStr(localYmd(end))
  }

  const profit = analysis.profitNetMinusCost
  const profitClass = profit >= 0 ? 'kpi-profit' : 'kpi-loss'

  return (
    <div className="view-stack">
      <SaleSummaryDialog
        open={saleSummaryOpen}
        onClose={() => setSaleSummaryOpen(false)}
        fromMs={fromMs}
        toMs={toMs}
        periodFromStr={fromStr}
        periodToStr={toStr}
      />
      <section className="card kpi-row dash-pl-row">
        <div className="kpi">
          <div className="kpi-label">Net collected</div>
          <div className="kpi-value">{formatMoney(analysis.netTotal)}</div>
          <div className="kpi-hint">After discounts</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Discounts</div>
          <div className="kpi-value">{formatMoney(analysis.discountTotal)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Cost of goods</div>
          <div className="kpi-value">{formatMoney(analysis.costOfGoods)}</div>
          <div className="kpi-hint">From saved costs</div>
        </div>
        <div className={`kpi accent ${profitClass}`}>
          <div className="kpi-label">{profit >= 0 ? 'Net profit' : 'Net loss'}</div>
          <div className="kpi-value">{formatMoney(profit)}</div>
          <div className="kpi-hint">Collected − cost</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Margin % of net</div>
          <div className="kpi-value">{analysis.marginPctOfNet}%</div>
        </div>
      </section>

      <section className="card kpi-row dash-pl-row">
        <div className="kpi">
          <div className="kpi-label">Units sold</div>
          <div className="kpi-value">{analysis.unitsSold}</div>
          <div className="kpi-hint">Sum of line quantities</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Sales</div>
          <div className="kpi-value">{analysis.receipts}</div>
          <div className="kpi-hint">Receipts in period</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Line items</div>
          <div className="kpi-value">{analysis.lineItems}</div>
          <div className="kpi-hint">Rows on those receipts</div>
        </div>
      </section>

      <section className="card dash-period">
        <div className="dash-period-head">
          <h2 className="section-title">Report period &amp; print</h2>
          <div className="dash-period-actions">
            <button type="button" className="btn secondary" onClick={() => setSaleSummaryOpen(true)}>
              Sale summary
            </button>
            <button type="button" className="btn primary" onClick={printReport}>
              Print profit / loss
            </button>
          </div>
        </div>
        <p className="hint dash-print-hint">
          Choose dates for the figures above, then print a summary (profit / loss, units, and counts).
        </p>
        <div className="preset-row">
          <button type="button" className="btn secondary" onClick={setToday}>
            Today
          </button>
          <button type="button" className="btn secondary" onClick={setLast7Days}>
            Last 7 days
          </button>
          <button type="button" className="btn secondary" onClick={setThisMonth}>
            This month
          </button>
        </div>
        <div className="date-range">
          <label>
            From
            <input
              type="date"
              className="input"
              value={fromStr}
              onChange={(e) => setFromStr(e.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              className="input"
              value={toStr}
              onChange={(e) => setToStr(e.target.value)}
            />
          </label>
          <button type="button" className="btn secondary" onClick={() => setToStr(fromStr)}>
            Single day
          </button>
        </div>
      </section>
    </div>
  )
}
