/* ══ uom — กฎ "หน่วยนับนี้คือรหัสไหนในทะเบียน" ที่เดียว (2026-11-05) ═══════════════════════════
   ทะเบียน = DR `uom_units` (migration 20261105_uom_units_dr.sql · จัดการที่ /products แท็บ 📏 หน่วยนับ)
   คอลัมน์ปลายทาง parts_master.uom · bom_items.uom · material_request_items.unit เก็บ **code** (text ไม่ผูก FK)

   🔴 user ตัดสิน 05/11: **EA = pcs = PC (หน่วยเดียวกัน) · หน่วยหลัก = PC** ⇒ ทุกจุดที่ "เขียน" หน่วยลงฐาน
      (ฟอร์ม · import Excel · import SAP · ลงทะเบียนอัตโนมัติ) ต้องผ่าน `normUom()` ก่อน
      ไม่งั้นค่า default 'EA'/'pcs' แบบเดิมจะไหลกลับมาปนอีก
   · ไม่รู้จัก = คืนตัวพิมพ์ใหญ่ของค่าเดิม (ห้ามเดา/ห้ามทิ้ง) + `isKnownUom()` = false ให้จอเตือน
   · ทะเบียนโหลดไม่ได้ = ใช้ `DEFAULT_UOMS` (ชุดเดียวกับ seed) — แม็ป EA→PC ยังทำงาน จอเตือนผ่าน loadFail
   ═══════════════════════════════════════════════════════════════════════════════════════ */

/** ชุดเดียวกับ seed ใน migration — ใช้เมื่อทะเบียนยังโหลดไม่ได้ */
export const DEFAULT_UOMS = [
  { code: 'PC',   name: 'ชิ้น',     aliases: ['EA', 'PCS', 'EACH', 'PIECE'], sort_order: 10 },
  { code: 'KG',   name: 'กิโลกรัม', aliases: ['KGS'], sort_order: 20 },
  { code: 'M',    name: 'เมตร',     aliases: [], sort_order: 30 },
  { code: 'SET',  name: 'ชุด',      aliases: [], sort_order: 40 },
  { code: 'BOX',  name: 'กล่อง',    aliases: [], sort_order: 50 },
  { code: 'ROLL', name: 'ม้วน',     aliases: [], sort_order: 60 },
];

/** หน่วยตั้งต้นของพาร์ทใหม่ (แทน 'EA'/'pcs' ที่เคยกระจายอยู่หลายจุด) */
export const DEFAULT_UOM = 'PC';

const key = v => String(v ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

/** สร้างตัวค้น code/alias → code · `rows` ว่าง = ใช้ DEFAULT_UOMS · ข้ามแถวปิดใช้ */
export function buildUomIndex(rows) {
  const list = (Array.isArray(rows) && rows.length ? rows : DEFAULT_UOMS).filter(r => r && r.is_active !== false && key(r.code));
  const map = new Map();
  // code ก่อน alias — alias ที่บังเอิญชนกับ code ของอีกแถว ห้ามทับ code
  for (const r of list) map.set(key(r.code), key(r.code));
  for (const r of list) for (const a of (Array.isArray(r.aliases) ? r.aliases : [])) {
    const k = key(a);
    if (k && !map.has(k)) map.set(k, key(r.code));
  }
  return { map, codes: list.map(r => key(r.code)), rows: list };
}

const FALLBACK_IDX = buildUomIndex(DEFAULT_UOMS);

/** ค่าหน่วยที่จะเขียนลงฐาน — ว่าง = '' · รู้จัก = code ในทะเบียน · ไม่รู้จัก = ตัวพิมพ์ใหญ่ของค่าเดิม */
export function normUom(raw, idx = FALLBACK_IDX) {
  const k = key(raw);
  if (!k) return '';
  return (idx || FALLBACK_IDX).map.get(k) || k;
}

/** อยู่ในทะเบียนไหม (นับ alias) — ว่าง = ไม่นับว่าไม่รู้จัก (คืน true) */
export function isKnownUom(raw, idx = FALLBACK_IDX) {
  const k = key(raw);
  return !k || (idx || FALLBACK_IDX).map.has(k);
}

/** หน่วยที่ไม่อยู่ในทะเบียน (ไม่ซ้ำ · ตัวพิมพ์ใหญ่) — ให้จอ/พรีวิว import เขียนเตือน */
export function unknownUoms(values, idx = FALLBACK_IDX) {
  const out = new Set();
  for (const v of values || []) if (!isKnownUom(v, idx)) out.add(key(v));
  return [...out];
}

/** ตัวเลือกของ <select> หน่วย — `current` ที่ไม่อยู่ในลิสต์ต้องโชว์เป็น "ค่าเดิม" (ห้ามให้ช่องขึ้นตัวแรกแทน) */
export function uomOptions(idx = FALLBACK_IDX, current = '') {
  const opts = (idx || FALLBACK_IDX).rows.map(r => ({ value: key(r.code), label: r.name ? `${key(r.code)} · ${r.name}` : key(r.code) }));
  const cur = String(current ?? '').trim();
  if (cur && !opts.some(o => o.value === cur)) opts.unshift({ value: cur, label: `${cur} (ค่าเดิม · ไม่อยู่ในทะเบียน)`, legacy: true });
  return opts;
}
