/** "1,450 ر.س" / "1,667.50 ر.س" */
export const formatSar = (n: number) =>
  `${n.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })} ر.س`

/** Parses a typed amount (Arabic digits allowed); NaN when not a number. */
export function parseAmount(value: string): number {
  const ascii = value.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/٫/g, '.').replace(/[,،\s]/g, '')
  return ascii === '' ? NaN : Number(ascii)
}
