/* ══ คอลัมน์ชีท "รายการ MO" ของ Excel export (`src/lib/mtnMoExportExcel.js`) — pure ══════════════
   2026-11-03 · ประชุมหน้างาน 02/11 ข้อ A8: *"IO ขึ้นขาด PR ขึ้นเกิน"* ตอน export MO

   🔴 ต้นเหตุที่เจอ (วัดจากโค้ด + ฐานจริง 03/11):
     1. **ไฟล์ Excel ไม่มีคอลัมน์ I/O เลย** — หัวตาราง 24 ช่องมี "เลข PR" แต่ไม่มี I/O และคิวรีลิสต์
        (`MO_LIST_COLS` ใน MtnRepair.jsx) ก็ไม่ได้ select `io_no` มาด้วย ⇒ "IO ขาด" ทั้งไฟล์
     2. ค่ากับหัวตารางผูกกันด้วย "ชื่อหัว" คนละที่ (array หัว · array ความกว้าง · `put()` 24 บรรทัด)
        ⇒ เพิ่ม/ถอดคอลัมน์ทีหลังแล้ว 3 ที่นับไม่เท่ากันได้เงียบๆ (ความกว้างเลื่อน · ช่องว่างโผล่กลางแถว)
   ⇒ ไฟล์นี้ = **ทะเบียนคอลัมน์ชุดเดียว**: 1 entry = หัว + ความกว้าง + ค่า + สไตล์ อยู่ด้วยกัน
      ตัวทำไฟล์วนจาก array นี้อย่างเดียว ⇒ หัวกับค่าเลื่อนกันไม่ได้โดยโครงสร้าง (มีเทส `mtnMoExportCols.test.mjs`)

   กฎเดิมของไฟล์ export ยังอยู่ครบ (ห้ามแก้ให้ง่ายขึ้น · docs/modules/mtn-work-order.md §Export):
     · ไม่รู้ = ขีด "–" ห้าม 0 · ป้ายสถานะ/ค้าง-จบ/ชื่อทีมรับเป็น callback (ไฟล์นี้ไม่เดาจากเลขขั้น)
     · โหลดคอมเมนต์/เลข PR ล้ม = เขียนกำกับทุกแถว ห้ามปล่อยว่างเหมือนไม่มีข้อมูล
   ════════════════════════════════════════════════════════════════════════════════════════ */
import { assignedTechsOf, joinTechs, prNumbersOf, repairPathMeta } from './mtnPurchase.js';
import { qaRelatedView } from './mtnStepPerm.js';   // 🔴 "เกี่ยวคุณภาพ" ตอบจากที่นี่ที่เดียว

/** ไม่รู้ = ขีด ห้าม 0 */
export const DASH = '–';

const bkk = (v) => (v ? new Date(v).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : DASH);

/**
 * ทะเบียนคอลัมน์ — ลำดับ = ลำดับในไฟล์
 * 🔴 ลำดับ: ของผู้แจ้งก่อน **แล้วคอมเมนต์ต่อท้าย** (คอมเมนต์ทีม MTN ข้อ 1 · 07/10 — "ต่อจากที่ผู้แจ้งแจ้งมา")
 * 🔴 I/O กับ เลข PR อยู่คู่กันท้ายตาราง (ตำแหน่งเดียวกับใบพิมพ์ FM-MTN-006 ที่ PR.No. กับ I/O. อยู่บรรทัดเดียวกัน)
 *
 * `val(r, ctx)` — r = แถว enriched (`{ o, date, open, group, chara, respMin, fixMin, planned, vague }`)
 *   ctx = `{ statusLabel, teamName, cmtOf, commentText, commentsError, prsBy, prsError }`
 * `opt(r, ctx)` — สไตล์ของช่องนั้น (ทับค่าตั้งต้น size 9.5)
 */
export const MO_EXPORT_COLS = Object.freeze([
  { key: 'date', h: 'วันที่', w: 11, val: (r) => r.date || DASH, opt: () => ({ align: 'center' }) },
  { key: 'mo_no', h: 'เลข MO', w: 21, val: (r) => r.o.mo_no || DASH },
  { key: 'status', h: 'สถานะ', w: 17, val: (r, c) => c.statusLabel(r.o) || r.o.status || DASH },
  { key: 'open', h: 'ค้าง/จบ', w: 9, val: (r) => (r.open ? 'ค้าง' : 'จบแล้ว'), opt: (r) => ({ align: 'center', color: r.open ? 'FFC00000' : undefined }) },
  { key: 'team', h: 'ทีมช่าง', w: 15, val: (r, c) => c.teamName(r.o.mtn_dept) || DASH },
  { key: 'line', h: 'ไลน์', w: 16, val: (r) => r.o.line_name || DASH },
  { key: 'machine', h: 'เลขเครื่อง', w: 13, val: (r) => r.o.machine_no || DASH },
  { key: 'item_type', h: 'ชนิดอุปกรณ์', w: 16, val: (r) => r.o.item_type || DASH },
  { key: 'repair_type', h: 'ประเภทงานซ่อม', w: 15, val: (r) => r.o.repair_type || DASH },
  { key: 'group', h: 'กลุ่มปัญหา', w: 22, val: (r) => r.group || DASH, opt: (r) => ({ fill: r.group ? undefined : 'FFFFF2CC' }) },
  { key: 'chara', h: 'อาการ (หัวข้อย่อย)', w: 26, val: (r) => r.chara || DASH },
  { key: 'note', h: 'รายละเอียดที่คนแจ้งพิมพ์', w: 34, val: (r) => r.o.report_note || '', opt: () => ({ size: 9, wrap: true }) },
  /* 💬 ใบที่ไม่มีคอมเมนต์เว้นว่าง (ขีด = "ไม่รู้" แต่กรณีนี้รู้แน่ว่ายังไม่มีใครคอมเมนต์) · โหลดล้ม = เขียนกำกับ */
  { key: 'comments', h: 'คอมเมนต์เพิ่มเติม (ใครพูด · เมื่อไหร่)', w: 42,
    val: (r, c) => (c.commentsError ? '⚠ โหลดคอมเมนต์ไม่สำเร็จ' : c.commentText(c.cmtOf(r.o))), opt: () => ({ size: 9, wrap: true }) },
  { key: 'comment_n', h: 'จำนวนคอมเมนต์', w: 10,
    val: (r, c) => (c.commentsError ? DASH : (c.cmtOf(r.o).length || '')), opt: () => ({ align: 'center' }) },
  { key: 'report_at', h: 'เวลาแจ้ง', w: 16, val: (r) => bkk(r.o.report_at), opt: () => ({ size: 9 }) },
  { key: 'accept_at', h: 'เวลารับงาน', w: 16, val: (r) => bkk(r.o.accept_at), opt: () => ({ size: 9 }) },
  { key: 'repair_done_at', h: 'เวลาซ่อมเสร็จ', w: 16, val: (r) => bkk(r.o.repair_done_at), opt: () => ({ size: 9 }) },
  // 🔴 ยังไม่รับงาน/ยังไม่ปิด = ขีด ห้าม 0 (ไม่งั้น pivot หาค่าเฉลี่ยได้เลขที่ต่ำกว่าจริง)
  { key: 'resp_min', h: 'ตอบสนอง (นาที)', w: 13, val: (r) => (r.respMin == null ? DASH : r.respMin), opt: () => ({ align: 'center' }) },
  { key: 'fix_min', h: 'เวลาซ่อม (นาที)', w: 13, val: (r) => (r.fixMin == null ? DASH : r.fixMin), opt: () => ({ align: 'center' }) },
  /* 🔴 ห้ามอ่าน `quality_related` ดิบ (เก็บเป็นข้อความ) — ใบที่ QA ไม่อยู่ในลูป = ขีด ("ไม่มีคำถามนี้" ≠ "ยังไม่ตอบ") */
  { key: 'qa_related', h: 'เกี่ยวคุณภาพ', w: 11,
    val: (r) => ({ yes: 'ใช่', no: 'ไม่', n_a: DASH, unknown: '' }[qaRelatedView(r.o)]), opt: () => ({ align: 'center' }) },
  { key: 'pinpoint', h: 'ชี้เป้าได้?', w: 10,
    val: (r) => (r.planned ? 'ตามแผน' : r.vague ? 'ไม่ได้' : 'ได้'), opt: (r) => ({ align: 'center', fill: r.vague ? 'FFFFF2CC' : undefined }) },
  { key: 'techs', h: 'ช่างที่มอบหมาย', w: 22, val: (r) => joinTechs(assignedTechsOf(r.o)) || DASH, opt: () => ({ size: 9, wrap: true }) },
  /* 🧑‍🔧 ใครลงมือซ่อมจริง (04/11 · feedback MTN ข้อ 2 "ช่างซ่อมหลัก/รองไม่แสดงในเอกสาร MO ที่ Export")
     🔴 **คนละคอลัมน์กับ "ช่างที่มอบหมาย" ห้ามยุบรวม** — มอบหมาย (ขั้นรับงาน) ≠ ลงมือจริง (ขั้นปิดงาน)
        มอบหมาย 2 คนแล้วคนเดียวทำ / ส่งต่อให้คนอื่นทำ = เกิดปกติ ⇒ ยุบ = KPI ช่างไปลงผิดคน
     🔴 ว่าง 3 ความหมาย: โหลดไม่ติด = ⚠ · **ปิดใบแล้วไม่มีใครกรอก = ไฮไลต์เหลือง** · ใบยังค้าง = ว่าง (ถูกแล้ว)
     ค่ามาจาก `loadRepairTechsFor()` (src/lib/moRepairTechs.js) — โหลดตอนกด export เท่านั้น
     เพราะ `tech_main`/`tech_secondary` ห้ามอยู่ใน `MO_LIST_COLS` (egress · ดูไฟล์นั้น) */
  { key: 'real_techs', h: 'ช่างซ่อมจริง (หลัก/รอง)', w: 24,
    val: (r, c) => (c.techsError ? '⚠ โหลดชื่อช่างซ่อมไม่สำเร็จ'
      : (((c.techsBy || {})[r.o.id]?.names || []).join(' / ') || '')),
    opt: (r, c) => ({ size: 9, wrap: true,
      fill: (!c.techsError && !((c.techsBy || {})[r.o.id]?.names || []).length && !r.open) ? 'FFFFF2CC' : undefined }) },
  { key: 'repair_path', h: 'เส้นทางงานซ่อม', w: 22, val: (r) => repairPathMeta(r.o.repair_path)?.label || DASH, opt: () => ({ size: 9 }) },
  /* 💳 I/O (02/11 · A8 "IO ขึ้นขาด") — เลขที่กรอกในใบ (ตอนเลือกเครื่องระบบเติมจาก `machines.io_no` ให้)
     🔴 ส่งเป็น **ข้อความ** เสมอ: I/O 12 หลักเป็นตัวเลขล้วน ส่งเป็น number แล้ว Excel โชว์ 2.15031E+11 = หลักหาย
     ว่าง = ขีด (ใบไม่ได้กรอก ≠ ไม่มีคอลัมน์) */
  { key: 'io_no', h: 'I/O', w: 16, val: (r) => (String(r.o.io_no ?? '').trim() || DASH), opt: () => ({ size: 9, numFmt: '@' }) },
  /* 🛒 เลข PR — รวมใบขอซื้อที่ผูกใบนี้ + ช่อง pr_no ที่กรอกมือ (ตัดซ้ำใน `prNumbersOf`) · ใบที่ยกเลิกไม่นับ */
  { key: 'pr_no', h: 'เลข PR', w: 26,
    val: (r, c) => (c.prsError ? '⚠ โหลดเลข PR ไม่สำเร็จ' : (prNumbersOf(r.o, (c.prsBy || {})[r.o.id] || []).join(', ') || '')),
    opt: () => ({ size: 9, wrap: true, numFmt: '@' }) },
]);

/** หัวตาราง (ลำดับเดียวกับค่า) */
export const moExportHeaders = () => MO_EXPORT_COLS.map(c => c.h);
/** ความกว้างคอลัมน์ (ลำดับเดียวกับหัว) */
export const moExportWidths = () => MO_EXPORT_COLS.map(c => c.w);

const CTX_DEFAULTS = {
  statusLabel: (o) => o?.status, teamName: (k) => k, cmtOf: () => [], commentText: () => '',
  commentsError: null, prsBy: {}, prsError: null, techsBy: {}, techsError: null,
};

/**
 * ค่าของ 1 แถว — `[{ key, h, value, opt }]` ยาวเท่าหัวตารางเสมอ (ลำดับเดียวกัน)
 * ตัวทำไฟล์เอา index ของ array นี้ไปเป็นตัวอักษรคอลัมน์ตรงๆ
 */
export function moExportCells(r, ctx = {}) {
  const c = { ...CTX_DEFAULTS, ...ctx };
  return MO_EXPORT_COLS.map(col => ({
    key: col.key, h: col.h, value: col.val(r, c), opt: { size: 9.5, ...(col.opt ? col.opt(r, c) : {}) },
  }));
}
