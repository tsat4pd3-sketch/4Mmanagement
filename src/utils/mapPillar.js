/* ─────────────────────────────────────────────────────────────────────────────
   🧊 ผังโรงงานโหมด 3D (2.5D) — ความสูงของเสาบนผัง                     (2026-10-14 · mockup ตามคำขอ user)

   เสาตั้งขึ้นจากจุดกลางกรอบไลน์ · สี = หมวดสถานะเดิมของ metric (CAT) · **ความสูงต้องบอกความหมายเดียวต่อจอ**
   · metric OEE ที่มีค่าจริง → สูง = %OEE (0-100)
   · metric อื่น → สูง = "ความรุนแรง" ของหมวดสถานะ (ปัญหายิ่งหนัก ยิ่งสูง — กวาดตาเห็นก่อน)
   🔴 OEE ไม่มีค่า (ไม่มีกะ/ไม่รู้ CT) = ใช้ความสูงต่ำสุดของหมวดนั้น **ห้ามเดาเป็นค่ากลาง** · จอต้องเขียนว่าสูงแปลว่าอะไร
   ⚠️ pure — ห้าม import supabase
   ───────────────────────────────────────────────────────────────────────────── */

export const SEVERITY_H = { down: 1, bad: 0.75, ok: 0.5, busy: 0.32, good: 0.22, waiting: 0.22, idle: 0.06 };

/** → { h: 0..1, basis: 'oee'|'severity' } */
export function pillarHeight(metric, cat, oee) {
  if (metric === 'oee') {
    if (oee != null && Number.isFinite(Number(oee))) return { h: Math.max(0.04, Math.min(1, Number(oee) / 100)), basis: 'oee' };
    return { h: 0.04, basis: 'oee' };
  }
  return { h: SEVERITY_H[cat] ?? 0.06, basis: 'severity' };
}

export const pillarLegend = (metric) => (metric === 'oee'
  ? 'ความสูงเสา = %OEE (ไม่มีค่า = เสาเตี้ยสุด)'
  : 'ความสูงเสา = ความรุนแรง · ยิ่งมีปัญหายิ่งสูง (แดง > ส้ม > เหลือง > เขียว > เทา)');
