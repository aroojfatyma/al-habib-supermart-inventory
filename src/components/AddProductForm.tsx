import { useState } from 'react'
import { DEFAULT_CATEGORIES, UNITS } from '../categories'
import { db, findByBarcode, normalizeProductCategory } from '../db'

export function AddProductForm({
  initialBarcode,
  categories,
  onCancel,
  onSaved,
}: {
  initialBarcode: string
  categories: string[]
  onCancel: () => void
  onSaved: (barcode: string) => void
}) {
  const [barcode, setBarcode] = useState(initialBarcode)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<string>(DEFAULT_CATEGORIES[0] ?? 'Other')
  const [unit, setUnit] = useState<string>(UNITS[0] ?? 'pcs')
  const [quantity, setQuantity] = useState(0)
  const [salePrice, setSalePrice] = useState(0)
  const [costPrice, setCostPrice] = useState(0)
  const [lowStock, setLowStock] = useState(5)
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    const b = barcode.trim()
    if (!b) {
      setErr('Barcode is required.')
      return
    }
    if (!name.trim()) {
      setErr('Product name is required.')
      return
    }
    const existing = await findByBarcode(b)
    if (existing) {
      setErr('This barcode already exists — scan it to open the item.')
      return
    }
    await db.products.add({
      barcode: b,
      name: name.trim(),
      category: normalizeProductCategory(category),
      unit,
      quantity: Math.max(0, Math.floor(quantity)),
      salePrice: Math.max(0, salePrice),
      costPrice: Math.max(0, costPrice),
      lowStock: Math.max(0, Math.floor(lowStock)),
      notes: notes.trim(),
      updatedAt: Date.now(),
    })
    onSaved(b)
  }

  return (
    <section className="card add-form">
      <h2>Add product</h2>
      <form onSubmit={submit} className="grid-form">
        <label>
          Barcode
          <input
            className="input"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            required
          />
        </label>
        <label className="span-2">
          Name
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Category
          <select
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
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
          Opening quantity
          <input
            type="number"
            min={0}
            className="input"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </label>
        <label>
          Sale price (PKR)
          <input
            type="number"
            min={0}
            className="input"
            value={salePrice}
            onChange={(e) => setSalePrice(Number(e.target.value))}
          />
        </label>
        <label>
          Cost price (PKR)
          <input
            type="number"
            min={0}
            className="input"
            value={costPrice}
            onChange={(e) => setCostPrice(Number(e.target.value))}
          />
        </label>
        <label>
          Low stock alert at
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
          <button type="button" className="btn secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Save product
          </button>
        </div>
      </form>
    </section>
  )
}
