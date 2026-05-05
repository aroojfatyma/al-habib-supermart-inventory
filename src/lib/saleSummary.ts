import type { Sale, SaleLine } from '../db'
import { printReceiptHtml } from './receipt'

function escapeHtml(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function rs(n: number) {
  const x = Number.isFinite(n) ? n : 0
  return new Intl.NumberFormat('en-PK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(x))
}

export type SaleSummaryCore = {
  totalSaleNet: number
  totalSaleQty: number
  totalReturnAmount: number
  totalReturnQty: number
  receivingsGross: number
  paymentsOut: number
  cashTotal: number
  cardTotal: number
  otherTotal: number
}

export type SaleSummaryPayload = SaleSummaryCore & {
  reportTitle?: string
  periodFrom: string
  periodTo: string
  generatedAt: string
}

export function computeSaleSummary(sales: Sale[], lines: SaleLine[]): SaleSummaryCore {
  const totalSaleNet = sales.reduce((s, x) => s + x.total, 0)
  const receivingsGross = sales.reduce((s, x) => s + x.subtotal, 0)
  const totalSaleQty = lines.reduce((s, l) => s + l.quantity, 0)
  let cashTotal = 0
  let cardTotal = 0
  let otherTotal = 0
  for (const x of sales) {
    if (x.paymentMethod === 'cash') cashTotal += x.total
    else if (x.paymentMethod === 'card') cardTotal += x.total
    else otherTotal += x.total
  }
  return {
    totalSaleNet,
    totalSaleQty,
    totalReturnAmount: 0,
    totalReturnQty: 0,
    receivingsGross,
    paymentsOut: 0,
    cashTotal,
    cardTotal,
    otherTotal,
  }
}

export function buildSaleSummaryPrintHtml(p: SaleSummaryPayload): string {
  const title = escapeHtml(p.reportTitle || 'AL HABIB')
  const closingLabel = p.otherTotal > 0 ? 'Cash sales (period)' : 'Closing cash'
  const closingVal = p.otherTotal > 0 ? `${rs(p.cashTotal)} · Other ${rs(p.otherTotal)}` : rs(p.cashTotal)

  const bar = (cls: string, leftL: string, leftV: string, rightL: string, rightV: string) => `
  <div class="bar ${cls}">
    <div class="cell"><div class="lab">${leftL}</div><div class="num">${leftV}</div></div>
    <div class="cell right"><div class="lab">${rightL}</div><div class="num">${rightV}</div></div>
  </div>`

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Sale summary</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    font-family: "Segoe UI", Arial, Helvetica, sans-serif;
    width: 72mm;
    max-width: 72mm;
    margin: 0 auto;
    font-size: 10px;
    line-height: 1.15;
    font-variant-numeric: tabular-nums;
  }
  .title { text-align: center; font-weight: 800; font-size: 0.95rem; margin: 0 0 6px; }
  .meta { font-size: 0.62rem; color: #444; text-align: center; margin-bottom: 8px; }
  .bar {
    display: grid;
    grid-template-columns: 1fr 1fr;
    color: #fff;
    font-weight: 700;
    margin-bottom: 5px;
    min-height: 36px;
  }
  .bar .cell { padding: 8px 10px; display: flex; flex-direction: column; justify-content: center; gap: 2px; }
  .bar .cell.right { text-align: right; align-items: flex-end; border-left: 1px solid rgba(255,255,255,.25); }
  .bar .lab { font-size: 0.62rem; font-weight: 600; opacity: 0.95; text-transform: capitalize; }
  .bar .num { font-size: 0.85rem; font-weight: 800; }
  .b1 { background: #2563eb; }
  .b2 { background: #db2777; }
  .b3 { background: #22c55e; }
  .b4 { background: #0d9488; }
  .foot {
    margin-top: 12px;
    text-align: center;
    font-weight: 700;
    font-size: 0.78rem;
  }
</style></head><body>
  <p class="title">${title}</p>
  <div class="meta">Sale summary · ${escapeHtml(p.periodFrom)}${p.periodFrom !== p.periodTo ? ' – ' + escapeHtml(p.periodTo) : ''}<br/>${escapeHtml(p.generatedAt)}</div>
  ${bar('b1', 'Total sale', rs(p.totalSaleNet), 'Total sale qty', rs(p.totalSaleQty))}
  ${bar('b2', 'Total sale return', rs(p.totalReturnAmount), 'Total return qty', rs(p.totalReturnQty))}
  ${bar('b3', 'Receivings', rs(p.receivingsGross), 'Payments', rs(p.paymentsOut))}
  ${bar('b4', 'Cash payments', rs(p.cashTotal), 'Card payments', rs(p.cardTotal))}
  <div class="foot">${closingLabel} : ${closingVal}</div>
</body></html>`
}

export function printSaleSummary(html: string) {
  printReceiptHtml(html)
}
