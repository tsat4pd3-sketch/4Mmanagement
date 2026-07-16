// ทีมช่างซ่อม 4 ส่วน + การจับคู่กับ section ของ user (2026-07-16)
//   ใช้แจกใบแจ้งซ่อม MO ให้ถูกทีม: คิวงานแยกทีม + default หน่วยงานตอนแจ้ง + แจ้งเตือน Telegram แยกห้อง
//   จับคู่จาก profiles.sections (ตามคำสั่ง user) — ผูกกับ section ของคน
export const MTN_TEAMS = ['JIG MTN', 'DIE MTN', 'MTN', 'PRODUCTION']

// section string → ทีมช่าง (null = ไม่เข้าทีมซ่อมทีมใดชัดเจน เช่น QA/ธุรการ/ขาย → เห็นคิวทุกทีม)
// หมายเหตุ: จับเฉพาะ 3 ทีมซ่อมเฉพาะทาง (JIG/DIE/MTN) — ทีม PRODUCTION (autonomous) เลือกเองตอนแจ้ง
//   เพราะ section ฝ่ายผลิตมีหลายชื่อ (PD1/PD2/GOR/...) เดาเป็น PRODUCTION เหมาจะไปโดน QA/ธุรการด้วย
export function teamForSection(section) {
  const s = (section || '').toUpperCase().trim()
  if (!s) return null
  if (s.includes('JIG')) return 'JIG MTN'
  if (s.includes('DIE')) return 'DIE MTN'
  if (s === 'MTN' || s.includes('MAINT') || s.includes('ซ่อม')) return 'MTN'
  return null
}

// รายชื่อทีมที่ user คนนี้สังกัด (จาก sections หลายค่า) — [] = ไม่ผูกทีม
export function teamsForUser(sections) {
  const set = new Set()
  for (const sec of sections || []) { const t = teamForSection(sec); if (t) set.add(t) }
  return [...set]
}

// ชนิดอุปกรณ์ → ทีม (ใช้เดา default ตอนแจ้งซ่อม) — JIG→JIG MTN, DIE→DIE MTN, อื่น→MTN
export const teamForItem = (it) => {
  const s = (it || '').toUpperCase()
  if (s.includes('JIG')) return 'JIG MTN'
  if (s.includes('DIE')) return 'DIE MTN'
  return 'MTN'
}
