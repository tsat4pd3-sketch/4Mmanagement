/* ─────────────────────────────────────────────────────────────────────────────
   colorPick — สุ่มสีตั้งต้นที่ "ยังไม่ซ้ำ" กับรายการที่มีอยู่ (2026-08-10 · คำสั่ง user)

   ใช้เป็นค่า default ของช่องเลือกสีตอน "สร้างรายการใหม่" ในทุกฟอร์ม master ที่มีสี
   (ประเภทเครื่องจักร / ประเภท Downtime / ประเภทของเสีย / กระบวนการผลิต /
    หมวดอะไหล่ / สกิล / taxonomy PM ฯลฯ) — ผู้ใช้ยังเลือกสีเองทับได้เสมอ

   กติกา:
   - เทียบสีแบบ normalize (trim + lowercase) กันเคส #EF4444 vs #ef4444
   - เลือกสุ่มจาก palette เฉพาะสีที่ยังไม่ถูกใช้
   - palette ถูกใช้ครบแล้ว → generate สีใหม่จาก hue ที่ "ห่างจากทุกสีที่ใช้อยู่มากที่สุด"
     (ไม่วนกลับมาซ้ำสีเดิม)
   ───────────────────────────────────────────────────────────────────────────── */

// palette หลัก — สีสด แยกแยะง่ายบนทั้งธีมมืด/สว่าง (โทนเดียวกับ tailwind 400-500)
export const COLOR_WHEEL = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#fb923c',
  '#facc15', '#4ade80', '#2dd4bf', '#38bdf8', '#a78bfa', '#e879f9',
  '#f87171', '#94a3b8',
]

const norm = (c) => String(c || '').trim().toLowerCase()

// '#rgb' / '#rrggbb' → hue 0-360 (คืน null ถ้า parse ไม่ได้ เช่นค่า rgba()/ชื่อสี)
function hexToHue(hex) {
  let h = norm(hex).replace('#', '')
  if (h.length === 3) h = h.split('').map((x) => x + x).join('')
  if (!/^[0-9a-f]{6}$/.test(h)) return null
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min
  if (d === 0) return null // เทา/ขาว/ดำ ไม่มี hue
  let hue
  if (max === r) hue = ((g - b) / d) % 6
  else if (max === g) hue = (b - r) / d + 2
  else hue = (r - g) / d + 4
  hue = Math.round(hue * 60)
  return (hue + 360) % 360
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => {
    const v = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    return Math.round(v * 255).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/**
 * คืนสี hex ที่ยังไม่ถูกใช้ใน usedColors
 * @param {string[]} usedColors สีที่รายการอื่นใช้อยู่ (รับค่า null/undefined ปนได้)
 */
export function pickUnusedColor(usedColors = []) {
  const used = new Set((usedColors || []).map(norm).filter(Boolean))
  const free = COLOR_WHEEL.filter((c) => !used.has(norm(c)))
  if (free.length) return free[Math.floor(Math.random() * free.length)]

  // palette หมด — กวาด hue ทุก 5° (เริ่มจุดสุ่ม) หา hue ที่ min-distance จากสีที่ใช้อยู่มากสุด
  const hues = [...used].map(hexToHue).filter((h) => h != null)
  if (!hues.length) return COLOR_WHEEL[Math.floor(Math.random() * COLOR_WHEEL.length)]
  let bestHue = 0; let bestDist = -1
  const start = Math.random() * 360
  for (let i = 0; i < 72; i++) {
    const h = (start + i * 5) % 360
    const d = Math.min(...hues.map((u) => { const x = Math.abs(h - u) % 360; return x > 180 ? 360 - x : x }))
    if (d > bestDist) { bestDist = d; bestHue = Math.round(h) }
  }
  return hslToHex(bestHue, 72, 55)
}
