import type { SaleLine } from '../db'

export function lineRevenue(l: SaleLine) {
  return l.unitSalePrice * l.quantity
}

export function lineProfit(l: SaleLine) {
  return (l.unitSalePrice - l.unitCost) * l.quantity
}

export function aggregateSale(lines: SaleLine[]) {
  let revenue = 0
  let profit = 0
  for (const l of lines) {
    revenue += lineRevenue(l)
    profit += lineProfit(l)
  }
  return { revenue, profit }
}

export function startOfDayMs(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.getTime()
}

export function endOfDayMs(d: Date) {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x.getTime()
}
