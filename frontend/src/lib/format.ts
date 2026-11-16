export const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

export const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) =>
  new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', opts)

export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export const pad = (n: number) => String(n).padStart(2, '0')
