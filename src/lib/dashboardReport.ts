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
  }).format(x)
}

export type DashboardPrintPayload = {
  /** Shop name on printed report (from Receipt printout settings). */
  reportTitle?: string
  periodFrom: string
  periodTo: string
  generatedAt: string
  unitsSold: number
  receipts: number
  lineItems: number
  netCollected: number
  discounts: number
  costOfGoods: number
  profitNetMinusCost: number
  marginPctOfNet: number
}

export function buildDashboardReportHtml(p: DashboardPrintPayload): string {
  const profitLabel = p.profitNetMinusCost >= 0 ? 'Net profit' : 'Net loss'
  const profitClass = p.profitNetMinusCost >= 0 ? 'profit' : 'loss'

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Profit summary</title>
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
    line-height: 1.25;
    font-variant-numeric: tabular-nums;
  }
  .top {
    text-align: center;
    margin-bottom: 6px;
  }
  .title {
    margin: 0;
    font-size: 0.88rem;
    font-weight: 800;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }
  .subtitle {
    margin: 2px 0 0;
    font-size: 0.64rem;
    text-transform: uppercase;
    color: #444;
    letter-spacing: 0.05em;
  }
  .meta {
    border-top: 1px solid #111;
    border-bottom: 1px solid #111;
    padding: 4px 0;
    margin: 0 0 6px;
  }
  .meta-row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 0.64rem;
    margin: 1px 0;
  }
  .meta-row .k {
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #555;
  }
  .meta-row .v {
    text-align: right;
    font-weight: 700;
  }
  .section {
    border-bottom: 1px dashed #aaa;
    padding-bottom: 4px;
    margin-bottom: 5px;
  }
  .section:last-of-type {
    border-bottom: none;
    margin-bottom: 0;
    padding-bottom: 0;
  }
  .section-title {
    margin: 0 0 2px;
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #444;
    font-weight: 800;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    padding: 2px 0;
    border-bottom: 1px solid #e2e2e2;
    font-size: 0.66rem;
  }
  .row:last-child {
    border-bottom: none;
  }
  .lab {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #333;
  }
  .val {
    text-align: right;
    font-weight: 700;
    white-space: nowrap;
  }
  .highlight {
    border-top: 1px solid #111;
    border-bottom: 1px solid #111;
    margin-top: 2px;
    padding: 3px 0;
  }
  .highlight .lab,
  .highlight .val {
    font-weight: 900;
    color: #111;
  }
  .highlight.profit .val { color: #0b6b3a; }
  .highlight.loss .val { color: #b42318; }
  .foot {
    margin-top: 7px;
    padding-top: 4px;
    border-top: 1px dashed #999;
    font-size: 0.6rem;
    color: #444;
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  @media print {
    body { width: 72mm; max-width: 72mm; padding: 0; }
  }
</style></head><body>
  <div class="top">
    <p class="title">${escapeHtml(p.reportTitle || 'AL HABIB')}</p>
    <p class="subtitle">Profit / Loss Summary</p>
  </div>

  <div class="meta">
    <div class="meta-row"><span class="k">From</span><span class="v">${escapeHtml(p.periodFrom)}</span></div>
    <div class="meta-row"><span class="k">To</span><span class="v">${escapeHtml(p.periodTo)}</span></div>
    <div class="meta-row"><span class="k">Generated</span><span class="v">${escapeHtml(p.generatedAt)}</span></div>
  </div>

  <div class="section">
    <p class="section-title">Volume</p>
    <div class="row"><span class="lab">Units Sold</span><span class="val">${rs(p.unitsSold)}</span></div>
    <div class="row"><span class="lab">Receipts</span><span class="val">${rs(p.receipts)}</span></div>
    <div class="row"><span class="lab">Line Items</span><span class="val">${rs(p.lineItems)}</span></div>
  </div>

  <div class="section">
    <p class="section-title">Financials</p>
    <div class="row"><span class="lab">Net Collected</span><span class="val">Rs. ${rs(p.netCollected)}</span></div>
    <div class="row"><span class="lab">Discounts</span><span class="val">Rs. ${rs(p.discounts)}</span></div>
    <div class="row"><span class="lab">Cost of Goods</span><span class="val">Rs. ${rs(p.costOfGoods)}</span></div>
    <div class="row highlight ${profitClass}"><span class="lab">${profitLabel}</span><span class="val">Rs. ${rs(p.profitNetMinusCost)}</span></div>
    <div class="row"><span class="lab">Margin</span><span class="val">${p.marginPctOfNet}%</span></div>
  </div>

  <div class="foot">Net collected minus cost of goods sold.</div>
</body></html>`
}

export function printDashboardReport(html: string) {
  printReceiptHtml(html)
}
