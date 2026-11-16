import qrcode from 'qrcode-generator'

/**
 * ZATCA simplified tax invoice QR (phase 1): TLV fields, base64 encoded.
 *   1 seller name, 2 VAT number, 3 time (ISO 8601), 4 total with VAT, 5 VAT amount.
 */
export function zatcaQrPayload(f: { seller: string; vatNumber: string; time: string; total: number; vat: number }): string {
  const enc = new TextEncoder()
  const parts = [f.seller, f.vatNumber, f.time, f.total.toFixed(2), f.vat.toFixed(2)].map((v, i) => {
    const bytes = enc.encode(v)
    return [i + 1, bytes.length, ...bytes]
  })
  const all = Uint8Array.from(parts.flat())
  let bin = ''
  all.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin)
}

/** An SVG QR code for an ASCII text (the payload above is base64). */
export function qrSvg(text: string): string {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })
}
