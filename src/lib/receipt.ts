import type { Sale, SaleLine, StoreInfo } from '../db'
import { LOGO_SRC } from './publicAssets'

/** Printed slip — matches AL-HABIB manual receipt book layout. */
export type ReceiptStoreInfo = StoreInfo & {
  /** Optional base64 data URL so the print window does not need to resolve /public paths. */
  logoDataUrl?: string
}

function rs(n: number) {
  const x = Number.isFinite(n) ? n : 0
  return new Intl.NumberFormat('en-PK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(x)
}

function escapeHtml(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** Load brand mark for embedding in the print document (works in Electron `about:blank`). */
export async function loadReceiptLogoDataUrl(): Promise<string> {
  const path = LOGO_SRC
  try {
    const res = await fetch(new URL(path, window.location.href).href)
    if (!res.ok) return ''
    const blob = await res.blob()
    return await blobToDataUrl(blob)
  } catch {
    return ''
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(blob)
  })
}

const waIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="#25D366" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`

export async function buildReceiptHtml(
  store: ReceiptStoreInfo,
  sale: Sale,
  lines: SaleLine[],
): Promise<string> {
  const dateOnly = new Date(sale.createdAt).toLocaleDateString('en-PK', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  const timeOnly = new Date(sale.createdAt).toLocaleTimeString('en-PK', {
    hour: '2-digit',
    minute: '2-digit',
  })
  const paymentLabel =
    sale.paymentMethod === 'cash'
      ? 'Cash'
      : sale.paymentMethod === 'card'
        ? 'Card'
        : 'Other'

  const dataRows = lines.map((l) => {
    const amt = l.unitSalePrice * l.quantity
    return `<tr>
      <td class="c-qty">${l.quantity}</td>
      <td class="c-desc">${escapeHtml(l.productName)}</td>
      <td class="c-rate">${rs(l.unitSalePrice)}</td>
      <td class="c-amt">${rs(amt)}</td>
    </tr>`
  })

  const logoBlock = store.logoDataUrl
    ? `<img class="mark" src="${store.logoDataUrl}" alt="" width="126" />`
    : `<div class="mark-fallback" aria-hidden="true"></div>`

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(sale.receiptNo)}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    font-family: "Segoe UI", Arial, Helvetica, sans-serif;
    font-size: 10px;
    line-height: 1.25;
    width: 72mm;
    max-width: 72mm;
    margin: 0 auto;
    padding: 0;
  }
  .sheet {
    border: 0;
    border-radius: 0;
    padding: 0;
  }
  .receipt-top {
    display: flex;
    justify-content: center;
    align-items: baseline;
    gap: 6px;
    margin-bottom: 6px;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .receipt-top .label {
    color: #555;
    font-weight: 700;
  }
  .receipt-top .value {
    font-weight: 900;
  }
  .head {
    display: grid;
    grid-template-columns: 1fr;
    gap: 4px;
    margin-bottom: 6px;
    align-items: stretch;
  }
  .mark,
  .mark-fallback {
    width: 100%;
    min-width: 0;
    height: 44px;
    object-fit: cover;
    object-position: center 56%;
    border-radius: 2px;
  }
  .mark-fallback {
    border: 1px solid #111;
    background: #f2f2f2;
  }
  .contact-box {
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 0.7rem;
    justify-content: center;
    align-items: flex-end;
  }
  .contact-box .line {
    line-height: 1.25;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .contact-box .line .label {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #555;
    font-size: 0.68rem;
    margin-right: 4px;
  }
  .contact-box .line .value {
    font-weight: 700;
  }
  .visit {
    padding: 0 0 6px;
    margin-bottom: 6px;
    font-size: 0.7rem;
    border-bottom: 1px solid #111;
  }
  .visit .label {
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
    margin-right: 6px;
  }
  .meta-row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
    margin: 0 0 6px;
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .meta-row .u {
    border-bottom: 1px solid #111;
    min-height: 0.9rem;
    margin-top: 2px;
    font-family: "Roboto Mono", "Consolas", "Courier New", monospace;
    font-size: 0.72rem;
    letter-spacing: 0;
    font-weight: 600;
    text-transform: none;
    padding: 0 1px 2px;
  }
  table.grid {
    width: 100%;
    border-collapse: collapse;
    border: 1px solid #111;
    margin: 0 0 12px;
    font-size: 0.74rem;
  }
  table.grid th,
  table.grid td {
    border: 1px solid #111;
    padding: 3px 4px;
    vertical-align: middle;
  }
  table.grid th {
    background: #f4f4f4;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 0.64rem;
    text-align: center;
  }
  .c-qty {
    width: 11%;
    text-align: center;
    white-space: nowrap;
  }
  .c-desc {
    width: 47%;
    font-weight: 600;
  }
  .c-rate {
    width: 21%;
    text-align: right;
    white-space: nowrap;
  }
  .c-amt {
    width: 21%;
    text-align: right;
    white-space: nowrap;
    font-weight: 800;
  }
  .totals-wrap {
    display: flex;
    justify-content: flex-end;
    margin: 14px 0 0;
    padding-top: 4px;
  }
  .totals {
    width: 50%;
    min-width: 34mm;
    margin-left: auto;
  }
  .totals .row {
    display: grid;
    grid-template-columns: 1fr 70px;
    gap: 8px;
    padding: 3px 0;
    border-bottom: 1px solid #d7d7d7;
    font-size: 0.68rem;
    align-items: baseline;
  }
  .totals .row:last-child {
    border-bottom: none;
  }
  .totals .lab {
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #333;
    font-size: 0.6rem;
    font-weight: 700;
  }
  .totals .val {
    text-align: right;
    font-weight: 700;
  }
  .totals .row.grand {
    border-top: 1px solid #111;
    border-bottom: 1px solid #111;
    margin: 1px 0;
    padding: 5px 0;
  }
  .totals .row.grand .lab {
    color: #111;
    font-size: 0.62rem;
    font-weight: 900;
  }
  .totals .row.grand .val {
    font-size: 0.78rem;
    font-weight: 900;
  }
  .thanks-line {
    margin-top: 10px;
    padding-top: 6px;
    border-top: 1px dashed #999;
    text-align: center;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #333;
    font-weight: 700;
  }
  @media print {
    body { width: 72mm; max-width: 72mm; padding: 0; }
  }
</style></head><body>
  <div class="sheet">
    <div class="receipt-top"><span class="label">Receipt #</span><span class="value">${escapeHtml(sale.receiptNo)}</span></div>
    <div class="head">
      <div>${logoBlock}</div>
      <div class="contact-box">
        <div class="line">${waIconSvg}<span class="value">${escapeHtml(store.phone)}</span></div>
      </div>
    </div>
    <div class="visit"><span class="label">Visit Us:</span>${escapeHtml(store.address)}</div>

    <div class="meta-row">
      <div>Date:<div class="u">${escapeHtml(dateOnly)}</div></div>
      <div>Time:<div class="u">${escapeHtml(timeOnly)}</div></div>
      <div>Payment:<div class="u">${escapeHtml(paymentLabel)}</div></div>
    </div>

    <table class="grid" aria-label="Items">
      <thead>
        <tr>
          <th>Qty</th>
          <th>Description</th>
          <th>Rate</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        ${dataRows.join('')}
      </tbody>
    </table>

    <div class="totals-wrap">
      <div class="totals" aria-label="Totals">
        <div class="row subtotal"><span class="lab">Subtotal</span><span class="val">${rs(sale.subtotal)}</span></div>
        <div class="row discount"><span class="lab">Discount</span><span class="val">${rs(sale.discount)}</span></div>
        <div class="row grand"><span class="lab">Grand Total</span><span class="val">${rs(sale.total)}</span></div>
      </div>
    </div>
    <div class="thanks-line">Thanks for shopping with us.</div>
  </div>
</body></html>`
}

export function printReceiptHtml(html: string) {
  const w = window.open('', '_blank', 'width=560,height=900,scrollbars=yes')
  if (!w) {
    window.alert('Pop-up blocked — allow pop-ups for this site to print the receipt.')
    return
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.focus()

  const trigger = () => {
    try {
      w.focus()
      w.print()
    } catch {
      /* ignore */
    }
  }

  w.onload = () => {
    requestAnimationFrame(() => {
      setTimeout(trigger, 150)
    })
  }
  setTimeout(trigger, 400)
}
