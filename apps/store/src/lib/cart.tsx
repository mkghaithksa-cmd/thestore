import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * The cart lives in this browser only. It keeps product ids and quantities,
 * never prices: prices always come from the live catalog, and the server
 * prices the order again when it is placed.
 */
export interface CartLine {
  productId: string
  qty: number
}

export const MAX_QTY = 20
const STORAGE_KEY = 'ghaith-cart-v1'

function read(): CartLine[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .filter((l) => l && typeof l.productId === 'string' && Number.isInteger(l.qty) && l.qty > 0)
      .map((l) => ({ productId: l.productId, qty: Math.min(l.qty, MAX_QTY) }))
  } catch {
    return []
  }
}

function write(lines: CartLine[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines))
  } catch {
    // Private mode or storage full: the cart still works for this visit.
  }
}

interface CartState {
  lines: CartLine[]
  /** Total number of pieces. */
  count: number
  qtyOf: (productId: string) => number
  add: (productId: string, qty?: number) => void
  setQty: (productId: string, qty: number) => void
  remove: (productId: string) => void
  clear: () => void
}

const CartContext = createContext<CartState | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(read)

  // Keep other open tabs in step.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setLines(read())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const update = useCallback((fn: (prev: CartLine[]) => CartLine[]) => {
    setLines((prev) => {
      const next = fn(prev).filter((l) => l.qty > 0)
      write(next)
      return next
    })
  }, [])

  const value = useMemo<CartState>(() => {
    const clamp = (n: number) => Math.max(0, Math.min(MAX_QTY, Math.floor(n)))
    return {
      lines,
      count: lines.reduce((n, l) => n + l.qty, 0),
      qtyOf: (id) => lines.find((l) => l.productId === id)?.qty ?? 0,
      add: (id, qty = 1) =>
        update((prev) =>
          prev.some((l) => l.productId === id)
            ? prev.map((l) => (l.productId === id ? { ...l, qty: clamp(l.qty + qty) } : l))
            : [...prev, { productId: id, qty: clamp(qty) }],
        ),
      setQty: (id, qty) => update((prev) => prev.map((l) => (l.productId === id ? { ...l, qty: clamp(qty) } : l))),
      remove: (id) => update((prev) => prev.filter((l) => l.productId !== id)),
      clear: () => update(() => []),
    }
  }, [lines, update])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartState {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used inside CartProvider')
  return ctx
}
