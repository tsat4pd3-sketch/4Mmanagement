/* ═══════════════════════════════════════════════════════════════════════════════
   🧩 ตารางตรวจ (คน × วัน) — ของกลางของ "ใบตรวจแบบตาราง" ที่ออกแบบในหน้าออกแบบใบงาน (2026-11-26)
   คำสั่ง user: "สร้างใบตรวจแบบตารางได้ทุกแบบ · อนาคตไม่อยากให้มีฟอร์มที่เขียนด้วยโค้ดสด"

   · นิยามอยู่ในช่องชนิด `checkgrid` ของฟอร์มใบงาน (`wf_versions.form_schema.fields[]`) — แช่แข็งตอนเผยแพร่
     { key, type:'checkgrid', label, rows, recordPerm, docKey, marks[], items[], itemsTitle, autofill, alertEvent, rowNote }
   · ข้อมูลอยู่ `wf_grid_sheets` / `wf_grid_cells` / `wf_grid_row_notes` (Main · migration 20261126)
   · จอ = `src/components/WfGridSheet.jsx` · ใบพิมพ์ = `src/lib/gridPrint.js` · สายเซ็น = ขั้นของใบงานเดียวกัน
   🔴 "แหล่งแถว" กับ "ตัวเติมอัตโนมัติ" = โปรแกรมเมอร์ลงทะเบียนที่นี่ (เลือกในหน้าออกแบบ) — ห้ามให้ user เขียนสูตร
   🔴 ไม่มีข้อมูล = ไม่เติม ("ไม่รู้" ≠ "ไม่ได้ตรวจ" ≠ "ผ่าน") · ห้ามทับช่องที่คนกรอกเอง
   Pure — ไม่แตะ supabase
   ═══════════════════════════════════════════════════════════════════════════════ */

/** BBS ย้ายมาใช้ตารางกลางตั้งแต่เดือนนี้ (คำสั่ง user 26/11 "เริ่มตารางใหม่ 1 ธ.ค.") — ก่อนหน้านี้ยังอยู่ bbs_* เดิม */
export const BBS_GRID_KEY = 'bbs_grid';
export const BBS_GRID_FROM = '2026-12';
export const isBbsGridMonth = (monthKey) => String(monthKey || '') >= BBS_GRID_FROM;

/** สีของสัญลักษณ์ — ชื่อ token เท่านั้น (ห้ามสีดิบ) · `print` = สีบนกระดาษ (ใบพิมพ์ไม่มี CSS variable) */
export const GRID_COLORS = Object.freeze({
  green: { css: 'var(--green)', dim: 'var(--green-dim)', print: '#15803d', label: 'เขียว' },
  red:   { css: 'var(--red)',   dim: 'var(--red-dim)',   print: '#b91c1c', label: 'แดง' },
  blue:  { css: 'var(--blue)',  dim: 'var(--blue-dim)',  print: '#1d4ed8', label: 'น้ำเงิน' },
  amber: { css: 'var(--amber)', dim: 'var(--amber-dim)', print: '#b45309', label: 'เหลือง' },
  muted: { css: 'var(--muted)', dim: 'var(--bg3)',       print: '#6b7280', label: 'เทา' },
});
export const colorOf = (c) => GRID_COLORS[c] || GRID_COLORS.muted;

/** แหล่งแถว (ใครอยู่ในตาราง) */
export const GRID_ROW_SOURCES = Object.freeze([
  { key: 'line_employees', label: 'พนักงานในไลน์ (รวมไลน์ลูก)' },
]);

/** ตัวเติมอัตโนมัติ — หัวข้อที่ตั้ง `auto` = คีย์ในชุดนี้จะถูกเติมให้ */
export const GRID_AUTOFILL = Object.freeze([
  { key: 'ppe_daily', label: 'ผลตรวจ PPE รายวัน (เช็คชื่อ)', source: 'ppe',
    autoKeys: [{ key: 'helmet', label: 'หมวกนิรภัย' }, { key: 'boots', label: 'รองเท้านิรภัย' }, { key: 'gloves', label: 'ถุงมือ' }] },
]);
export const autofillOf = (k) => GRID_AUTOFILL.find(a => a.key === k) || null;

/** ช่อง checkgrid ของฟอร์ม (ใบละ 1 ช่อง) */
export function gridOf(form) {
  return (form?.fields || []).find(f => f?.type === 'checkgrid') || null;
}
export const markOf = (cfg, key) => (cfg?.marks || []).find(m => m.key === key) || null;

/** ตัวอักษรในช่อง — สัญลักษณ์ที่ต้องระบุข้อ แสดง "เลขข้อ" (ตามใบกระดาษ BBS) */
export function cellGlyph(cfg, cell) {
  if (!cell?.mark) return '';
  const m = markOf(cfg, cell.mark);
  if (!m) return '?';
  if (m.needsItem) return cell.item_seq != null ? String(cell.item_seq) : '!';
  return m.glyph || '';
}

/** วันในรอบรายเดือน (คอลัมน์) */
export function daysOfMonth(monthKey) {
  const [y, m] = String(monthKey || '').split('-').map(Number);
  if (!y || !m) return 0;
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * ตัวเติม "ผลตรวจ PPE รายวัน" → ช่อง (กติกาเดียวกับ `ppeToMark` ของ BBS เดิม)
 *   ไม่มีแถว = null · ไม่มาทำงาน = สัญลักษณ์ "ไม่ได้ตรวจ" · ขาดชิ้นไหน = สัญลักษณ์ที่ต้องระบุข้อ + เลขข้อแรก · ครบ = "เหมาะสม"
 * สัญลักษณ์ที่ใช้: `cfg.autofillMap = { pass, missing, absent }` · ไม่ตั้ง = เดา ok/ng/na **เฉพาะถ้ามีคีย์นั้นในฟอร์ม**
 */
export function ppeToGridCell(log, cfg) {
  if (!log) return null;
  const has = (k) => (markOf(cfg, k) ? k : null);
  const map = { pass: has('ok'), missing: has('ng'), absent: has('na'), ...(cfg?.autofillMap || {}) };
  const bySrc = {};
  (cfg?.items || []).forEach(it => { if (it.auto && bySrc[it.auto] == null) bySrc[it.auto] = it.seq; });
  if (log.is_present === false) return map.absent ? { mark: map.absent, source: 'ppe', item_seq: null, note: null } : null;
  const miss = [];
  const names = { helmet: 'หมวก', boots: 'รองเท้า', gloves: 'ถุงมือ' };
  ['helmet', 'boots', 'gloves'].forEach(k => {
    if (bySrc[k] != null && log[`has_${k}`] === false) miss.push({ seq: bySrc[k], name: names[k] });
  });
  if (miss.length) {
    if (!map.missing) return null;
    return { mark: map.missing, item_seq: miss[0].seq, source: 'ppe',
      note: miss.length > 1 ? `ขาด ${miss.map(m => m.name).join(' + ')} (ข้อ ${miss.map(m => m.seq).join(',')})` : null };
  }
  return map.pass ? { mark: map.pass, source: 'ppe', item_seq: null, note: null } : null;
}

/** ตรวจนิยามช่อง checkgrid ในหน้าออกแบบ — คืน [ข้อความ] (ว่าง = ผ่าน) · ตรงกับด่านใน `wf_request_publish` */
export function validateGrid(cfg) {
  const errs = [];
  if (!cfg) return errs;
  if (!cfg.recordPerm) errs.push('ตารางตรวจ: ยังไม่ได้เลือกคีย์สิทธิ์บันทึก');
  if (!GRID_ROW_SOURCES.some(r => r.key === cfg.rows)) errs.push('ตารางตรวจ: ยังไม่ได้เลือกแหล่งแถว');
  const marks = cfg.marks || [];
  if (!marks.length) errs.push('ตารางตรวจ: ต้องมีสัญลักษณ์อย่างน้อย 1 ตัว');
  const seen = new Set();
  marks.forEach((m, i) => {
    if (!/^[a-z][a-z0-9_]{0,19}$/.test(String(m.key || ''))) errs.push(`สัญลักษณ์ที่ ${i + 1}: รหัสต้องเป็นอังกฤษตัวเล็ก`);
    else if (seen.has(m.key)) errs.push(`สัญลักษณ์ที่ ${i + 1}: รหัส "${m.key}" ซ้ำ`);
    seen.add(m.key);
    if (!m.label) errs.push(`สัญลักษณ์ที่ ${i + 1}: ต้องมีคำอธิบาย`);
    if (!m.needsItem && !m.glyph) errs.push(`สัญลักษณ์ที่ ${i + 1}: ต้องมีตัวอักษรที่แสดงในช่อง`);
  });
  const items = cfg.items || [];
  if (marks.some(m => m.needsItem) && !items.length) errs.push('ตารางตรวจ: มีสัญลักษณ์ที่ต้องระบุข้อ แต่ยังไม่มีหัวข้อ');
  const seqs = new Set();
  items.forEach((it, i) => {
    if (!Number.isInteger(it.seq) || it.seq < 1) errs.push(`หัวข้อที่ ${i + 1}: เลขข้อต้องเป็นจำนวนเต็มบวก`);
    else if (seqs.has(it.seq)) errs.push(`หัวข้อที่ ${i + 1}: เลขข้อ ${it.seq} ซ้ำ`);
    seqs.add(it.seq);
    if (!it.text) errs.push(`หัวข้อที่ ${i + 1}: ต้องมีข้อความ`);
  });
  const af = cfg.autofill ? autofillOf(cfg.autofill) : null;
  if (cfg.autofill && !af) errs.push('ตารางตรวจ: ตัวเติมอัตโนมัติไม่รู้จัก');
  if (af && !items.some(it => it.auto)) errs.push('ตารางตรวจ: เลือกตัวเติมอัตโนมัติแล้ว แต่ยังไม่มีหัวข้อที่ผูกกับมัน');
  return errs;
}

/** แม่แบบช่องตารางตรวจเปล่า (ปุ่ม "+ ตารางตรวจ" ในหน้าออกแบบ) */
export function emptyGrid() {
  return {
    key: 'grid', type: 'checkgrid', label: 'ตารางตรวจ', rows: 'line_employees', recordPerm: '', docKey: '',
    rowNote: true, autofill: '', alertEvent: '', itemsTitle: 'หัวข้อตรวจ',
    marks: [
      { key: 'ok', glyph: '✓', label: 'ผ่าน', color: 'green' },
      { key: 'ng', glyph: '#', label: 'ไม่ผ่าน (ใส่เลขข้อ)', color: 'red', needsItem: true, alert: true },
      { key: 'na', glyph: '✗', label: 'ไม่ได้ตรวจ', color: 'muted' },
    ],
    items: [],
  };
}

/** สรุปจำนวนช่องต่อสัญลักษณ์ + ที่มา (เติมเอง/อัตโนมัติ) */
export function gridTally(cfg, cells) {
  const by = Object.fromEntries((cfg?.marks || []).map(m => [m.key, 0]));
  let auto = 0, manual = 0;
  Object.values(cells || {}).forEach(c => {
    by[c.mark] = (by[c.mark] || 0) + 1;
    if (c.source && c.source !== 'manual') auto += 1; else manual += 1;
  });
  return { by, auto, manual };
}
