// กรอง/กลับเครื่องหมายค่าวัดที่ติดลบได้ — ใช้โดย components/SignedDecimalInput.jsx (เหตุผลอยู่หัวไฟล์นั้น)
export function cleanSignedDecimal(raw) {
  let s = String(raw ?? '').replace(/,/g, '.').replace(/[^\d.-]/g, '')
  const neg = s.startsWith('-')
  s = s.replace(/-/g, '')
  const dot = s.indexOf('.')
  if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '')
  return (neg ? '-' : '') + s
}

export function toggleSign(v) {
  const s = String(v ?? '')
  return s.startsWith('-') ? s.slice(1) : `-${s}`
}
