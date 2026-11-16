import { MAX_QTY } from '../lib/cart'

/** − qty + control. */
export function QtyStepper({ value, onChange, label, min = 1 }: { value: number; onChange: (n: number) => void; label: string; min?: number }) {
  return (
    <div className="qty" role="group" aria-label={label}>
      <button type="button" aria-label="إنقاص الكمية" disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label="زيادة الكمية" disabled={value >= MAX_QTY} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  )
}
