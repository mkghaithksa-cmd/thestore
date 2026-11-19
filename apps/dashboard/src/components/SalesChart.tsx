import { useState } from 'react'
import { sar } from '../lib/service'

export interface ChartDay {
  d: string
  store: number
  service: number
}

const W = 640
const H = 200
const PAD = { top: 12, right: 28, bottom: 26, left: 48 }

/** Round a max up to a tidy axis top (1, 2, 2.5, 5 × 10^n). */
function niceTop(v: number): number {
  if (v <= 0) return 100
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}
const short = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n)))
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('ar-SA-u-nu-latn-ca-gregory', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/**
 * Store + maintenance sales per day as stacked bars. One axis (SAR),
 * hover/focus a day for its numbers; the table lives on the reports page.
 */
export function SalesChart({ days }: { days: ChartDay[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const rows = days.map((x) => ({ d: x.d, store: Number(x.store), service: Number(x.service) }))
  const top = niceTop(Math.max(0, ...rows.map((r) => r.store + r.service)))
  const iw = W - PAD.left - PAD.right
  const ih = H - PAD.top - PAD.bottom
  const step = iw / Math.max(1, rows.length)
  const bw = Math.max(4, step - 4)
  const y = (v: number) => PAD.top + ih - (v / top) * ih
  const ticks = [0, top / 2, top]
  const total = rows.reduce((a, r) => a + r.store + r.service, 0)
  const h = hover !== null ? rows[hover] : null

  // A bar's top segment gets 4px rounded data-end; the lower one stays square.
  const seg = (x: number, y0: number, y1: number, round: boolean) => {
    const hgt = y0 - y1
    if (hgt <= 0) return ''
    const r = round ? Math.min(4, hgt, bw / 2) : 0
    return `M${x},${y0}V${y1 + r}${r ? `Q${x},${y1} ${x + r},${y1}` : ''}H${x + bw - r}${r ? `Q${x + bw},${y1} ${x + bw},${y1 + r}` : ''}V${y0}Z`
  }

  return (
    <div className="chart">
      <div className="chart-legend">
        <span>
          <i className="sw store" /> المتجر
        </span>
        <span>
          <i className="sw service" /> الصيانة
        </span>
        <span className="muted">المجموع {sar(total)}</span>
      </div>
      <div className="chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`مبيعات آخر ${rows.length} يوم، المجموع ${sar(total)}`} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="tick">
                {short(t)}
              </text>
            </g>
          ))}
          {rows.map((r, i) => {
            const x = PAD.left + i * step + (step - bw) / 2
            const base = y(0)
            const ys = y(r.store)
            const yt = y(r.store + r.service)
            const gap = r.store > 0 && r.service > 0 ? 2 : 0
            return (
              <g key={r.d} className={hover !== null && hover !== i ? 'fade' : undefined}>
                <path d={seg(x, base, ys, r.service === 0)} className="m-store" />
                <path d={seg(x, ys - gap, yt, true)} className="m-service" />
                {i % 5 === (rows.length - 1) % 5 && (
                  <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="tick">
                    {dayLabel(r.d)}
                  </text>
                )}
                {/* Hit target: the whole column, taller and wider than the bar. */}
                <rect x={PAD.left + i * step} y={PAD.top} width={step} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
              </g>
            )
          })}
        </svg>
        {h && hover !== null && (
          <div className="chart-tip" style={{ left: `${((PAD.left + (hover + 0.5) * step) / W) * 100}%` }}>
            <b>{dayLabel(h.d)}</b>
            <span>
              <i className="sw store" /> المتجر {sar(h.store)}
            </span>
            <span>
              <i className="sw service" /> الصيانة {sar(h.service)}
            </span>
            <span className="muted">المجموع {sar(h.store + h.service)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
