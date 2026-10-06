// ⏱️ รูปแบบ "ช่วงเวลา" ของทั้งระบบ — ย้ายออกมาจาก utils/mtnMetrics.js (2026-10-06)
// ทำไมต้องมีไฟล์กลาง: จอหน้างานเขียน "เกินกำหนดมาแล้ว 91,098 นาที" ไม่ได้ คนอ่านไม่ออกว่านานแค่ไหน
// และสูตรแปลงนาที→ชม. ถูกก๊อปไว้หลายหน้าแล้ว (DailyReport · MtnRepair · OrderTrace) ซึ่ง drift กันได้
// ⚠️ ไฟล์นี้ต้องไม่ import อะไรเลย — จอไหนก็หยิบไปใช้ได้โดยไม่ลากโมดูลอื่นติดไปด้วย

/** นาที → "2 ชม. 15 น." อ่านง่ายบนจอหน้างาน · null = "—" (ไม่รู้ ไม่ใช่ 0) */
export function fmtDur(min) {
  if (min == null || Number.isNaN(min)) return '—';
  const m = Math.round(min);
  if (m < 60) return `${m} น.`;
  const h = Math.floor(m / 60), rest = m % 60;
  if (h < 24) return rest ? `${h} ชม. ${rest} น.` : `${h} ชม.`;
  const dd = Math.floor(h / 24), hh = h % 24;
  return hh ? `${dd} วัน ${hh} ชม.` : `${dd} วัน`;
}
