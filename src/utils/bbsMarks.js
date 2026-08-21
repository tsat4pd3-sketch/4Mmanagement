/**
 * bbsMarks — สัญลักษณ์บนใบ BBS (แบบฟอร์มสังเกตพฤติกรรมความปลอดภัย)
 *
 * ⚠️ นิยามอยู่ที่นี่ที่เดียว — จอ (BbsCheck.jsx) กับใบพิมพ์ (bbsPrint.js) อ่านตัวเดียวกัน
 *    ห้ามพิมพ์สัญลักษณ์/คำอธิบายซ้ำในไฟล์อื่น (ไม่งั้น legend กับตารางเพี้ยนกันเงียบๆ)
 *
 * ถอดจากฟอร์มกระดาษที่ user ส่งมา (2026-08-21):
 *   ü = พฤติกรรมเหมาะสม
 *   เลข 1-13 = ไม่เหมาะสม (อ้างข้อตกลงข้อนั้น)
 *   m = ปรับแก้แล้วหลังผู้ตรวจแนะนำ
 *   û = ไม่ได้ตรวจ (ไม่มาทำงาน / ทำงานนอกบริษัท)
 *
 * ⚠️ ฟอร์มกระดาษใช้ฟอนต์ Wingdings (ü/û เป็น ✓/✗) — บนเว็บใช้ตัวอักษรจริงแทน
 *    เพื่อให้อ่านออกทุกเครื่องโดยไม่ต้องพึ่งฟอนต์ที่อาจไม่มีติดตั้ง
 */

export const MARKS = [
  { key: 'ok',    glyph: '✓', label: 'พฤติกรรมเหมาะสม',                    color: '#15803d' },
  { key: 'ng',    glyph: '#', label: 'ไม่เหมาะสม (ใส่เลขข้อที่ผิด)',        color: '#b91c1c' },
  { key: 'fixed', glyph: 'm', label: 'ปรับแก้แล้วหลังผู้ตรวจแนะนำ',        color: '#1d4ed8' },
  { key: 'na',    glyph: '✗', label: 'ไม่ได้ตรวจ (ไม่มาทำงาน/งานนอกบริษัท)', color: '#6b7280' },
];

export const MARK_BY_KEY = Object.fromEntries(MARKS.map(m => [m.key, m]));

/** ตัวอักษรที่พิมพ์ลงช่อง — 'ng' แสดง "เลขข้อ" ไม่ใช่สัญลักษณ์ (ตามฟอร์มกระดาษ) */
export function markGlyph(cell) {
  if (!cell?.mark) return '';
  if (cell.mark === 'ng') return cell.agreement_seq != null ? String(cell.agreement_seq) : '!';
  return MARK_BY_KEY[cell.mark]?.glyph ?? '';
}

export const markColor = (cell) => (cell?.mark ? MARK_BY_KEY[cell.mark]?.color : undefined);

/** จำนวนวันในเดือน 'YYYY-MM' */
export function daysInMonth(monthKey) {
  const [y, m] = String(monthKey || '').split('-').map(Number);
  if (!y || !m) return 31;
  return new Date(y, m, 0).getDate();
}

/**
 * แปลงผลตรวจ PPE 1 แถว (daily_production_logs) → ช่องบนใบ BBS
 *
 * ⚠️ กติกาที่ห้ามเปลี่ยนโดยไม่คิด:
 *   - ไม่มีแถว log = **ไม่เติมอะไรเลย** ("ไม่รู้" ≠ "ไม่ได้ตรวจ" ≠ "ผ่าน")
 *   - ไม่มาทำงาน → na (ตรงกับ û ในฟอร์ม)
 *   - PPE ครบ → ok · ขาดชิ้นไหน → ng + เลขข้อของ PPE ชิ้นนั้น (ขาดหลายชิ้น = เอาข้อแรก
 *     แล้วบอกที่เหลือใน note — ช่องบนใบใส่ได้เลขเดียวตามฟอร์มกระดาษ)
 *
 * @param {object} log   แถว daily_production_logs
 * @param {object} bySrc { helmet: seq, boots: seq, gloves: seq } จาก bbs_agreements.auto_source
 */
export function ppeToMark(log, bySrc) {
  if (!log) return null;
  if (log.is_present === false) return { mark: 'na', source: 'ppe' };

  const miss = [];
  if (bySrc.helmet != null && log.has_helmet === false) miss.push({ seq: bySrc.helmet, name: 'หมวก' });
  if (bySrc.boots  != null && log.has_boots  === false) miss.push({ seq: bySrc.boots,  name: 'รองเท้า' });
  if (bySrc.gloves != null && log.has_gloves === false) miss.push({ seq: bySrc.gloves, name: 'ถุงมือ' });

  if (miss.length) {
    return {
      mark: 'ng', agreement_seq: miss[0].seq, source: 'ppe',
      note: miss.length > 1 ? `ขาด ${miss.map(m => m.name).join(' + ')} (ข้อ ${miss.map(m => m.seq).join(',')})` : null,
    };
  }
  return { mark: 'ok', source: 'ppe' };
}
