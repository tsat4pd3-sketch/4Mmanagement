/* ══ 📄 ใบ MO ที่ปิดแล้ว = "บันทึก" — **ส่วน pure** (2026-10-12 · คำสั่ง user) ═══════════
 *
 * 🔴 ปัญหาที่ไฟล์นี้มีไว้แก้ (QC audit 08/10 · user ตัดสิน 12/10 "ทำแบบเก็บตอนปิดใบ")
 *    ใบ MO มีเลขที่เอกสาร (`mo_no` 633/674 ใบ) + ขึ้นทะเบียนฟอร์มควบคุมทั้ง 2 ฟอร์ม
 *    (FM-JIG-008 / FM-MTN-006) แต่ `printMoReport` **generate จากข้อมูลสดทุกครั้ง**
 *    ⇒ ใบที่เซ็นครบ 7-8 ขั้นไปแล้ว กดพิมพ์ใหม่วันนี้ = ได้คอมเมนต์/ค่าอะไหล่/ค่าแรงที่แก้ทีหลัง
 *    พิสูจน์ย้อนไม่ได้ว่า "ตอนเซ็นใบเขียนว่าอะไร"
 *    (กฎ CLAUDE.md §ฟอร์มที่ยื่นออกไปแล้ว = บันทึก · ต้นแบบ `src/lib/prodProblemDoc.js`)
 *
 * ── ขอบเขตที่ user เลือก — "ประหยัด" ไม่ทำระบบออกเลขใบใหม่ ──────────────────────────────
 *    ✔ เก็บ **ครั้งเดียวตอนปิดใบ** (ขั้นสุดท้าย) · ✔ ใบที่ปิดแล้วพิมพ์จาก snapshot
 *    ✔ ใบที่ยังไม่ปิด generate สดเหมือนเดิม (ถูกแล้ว — ยังแก้ได้อยู่)
 *    ✘ **ไม่ backfill ใบเก่า** (เดาเนื้อใบตอนเซ็นไม่ได้ = จะโกหก) ⇒ ใบเก่าติดป้ายบนใบ
 *    ✘ ไม่ออกเลขใบใหม่ · ไม่นับ reprint (ใบนี้ไม่ได้ยื่นออกนอกองค์กร)
 *
 * ── 🔴 เก็บ "เนื้อใบ" เท่านั้น ห้ามเก็บเลขฟอร์ม / Rev / โลโก้ / footer / sig_blocks ──────────
 *    พวกนั้นอยู่ทะเบียน `/doc-forms` ให้ doc_control แก้เองได้โดยไม่แก้โค้ด
 *    ⇒ **ต้องอ่านสดตอนพิมพ์เสมอ** ผ่าน `docFormSync()` · แช่ลง snapshot = doc_control
 *      แก้เลขฟอร์มแล้วใบเก่าไม่เปลี่ยนตาม = ขัดกฎ "ห้าม hardcode เลขฟอร์ม/Rev/โลโก้"
 *
 * ── ⚠️ ทำไมแยกเป็น 2 ไฟล์ (core = pure · ตัวนี้แตะฐาน) ──
 *    `mtnMoSnapshot.js` → `supabaseClient` ที่ใช้ `import.meta.env` ⇒ **`node --test`
 *    โหลดโมดูลไม่ได้เลย** = ตรรกะที่พลาดแล้วเจ็บสุด (ตัดสินว่าพิมพ์จากบันทึกหรือพิมพ์สด)
 *    จะไม่มีเทสคุม ⇒ ส่วนที่ไม่แตะฐานอยู่ที่นี่ (หลักเดียวกับ `csvCore.js` / `csvDoc.js`)
 *
 * ── ทำไมไม่เก็บเป็น HTML ──
 *    เก็บ **ข้อมูล** แล้วให้ใบพิมพ์ประกอบใหม่ (หลักเดียวกับ `serializeReport` ของใบรายงานปัญหา)
 *    ⇒ แก้ layout/ฟอนต์/เลขฟอร์มทีหลังแล้วใบเก่ายังพิมพ์ออกมาสวยและถูกระเบียบ
 *      ส่วน **เนื้อหา** ยังเป็นของวันที่เซ็น
 */

/** ขึ้นเวอร์ชันเมื่อโครง snapshot เปลี่ยนแบบอ่านของเก่าไม่ได้ — ตัวอ่านต้องรองรับของเก่าไว้ */
export const MO_SNAP_VERSION = 1;

/* 🔴 คีย์ที่ **ห้าม** อยู่ใน snapshot
   · snapshot/snapshot_at = ตัวมันเอง (ซ้อนกันเองไม่รู้จบ)
   · form_code … logo_url  = ของทะเบียน `/doc-forms` ต้องอ่านสดตอนพิมพ์
   ⚠️ นอกจากนี้เก็บ **ทุกคอลัมน์ที่เหลือ** โดยเจตนา — ไม่ไล่ลิสต์ฟิลด์ทีละตัว
      เพราะใบนี้มีฟิลด์ 80+ ตัวและยังเพิ่มได้เรื่อยๆ · ลิสต์มือ = วันหนึ่งลืมฟิลด์ใหม่
      แล้ว snapshot ขาดเนื้อหาแบบเงียบ (เสียหายกู้ไม่ได้ เพราะเป็นบันทึกของใบที่ปิดแล้ว) */
const SNAP_OMIT = new Set([
  'snapshot', 'snapshot_at',
  'form_code', 'rev', 'effective_date', 'footer_note', 'sig_blocks', 'logo_url',
]);

const pickOrder = (order) => {
  const out = {};
  for (const [k, v] of Object.entries(order || {})) if (!SNAP_OMIT.has(k)) out[k] = v;
  return out;
};

/**
 * ประกอบก้อน snapshot — pure (มีเทส) ห้ามแตะฐานในนี้
 * @param {object} order   แถว mtn_orders **หลังปิดใบแล้ว** (ต้องเป็นแถวสด ไม่ใช่ของก่อน update)
 * @param {{parts?: any[], labor?: any[], comments?: any[]}} extra
 */
export function serializeMo(order, { parts = [], labor = [], comments = [] } = {}) {
  if (!order?.id) return null;
  return {
    v: MO_SNAP_VERSION,
    at: new Date().toISOString(),
    order: pickOrder(order),
    parts: Array.isArray(parts) ? parts : [],
    labor: Array.isArray(labor) ? labor : [],
    comments: Array.isArray(comments) ? comments : [],
  };
}

/**
 * แกะ snapshot กลับเป็นของที่ใบพิมพ์ต้องใช้ — pure
 * 🔴 คืน `null` เมื่ออ่านไม่ได้ (ว่าง/เวอร์ชันใหม่กว่าที่รู้จัก/ไม่มี order)
 *    ผู้เรียก **ต้องถอยไปพิมพ์สดแล้วเขียนบนใบว่าไม่มีบันทึกต้นฉบับ ห้ามพิมพ์เงียบ**
 * @returns {{order: object, parts: any[], labor: any[], cmt: {rows: any[], error: null}} | null}
 */
export function moFromSnapshot(snap) {
  if (!snap || typeof snap !== 'object') return null;
  if (!snap.order?.id) return null;
  if (Number(snap.v) > MO_SNAP_VERSION) return null;   // ของใหม่กว่าโค้ดนี้ = อ่านผิดดีกว่าไม่อ่าน
  return {
    order: snap.order,
    parts: Array.isArray(snap.parts) ? snap.parts : [],
    labor: Array.isArray(snap.labor) ? snap.labor : [],
    // คอมเมนต์ในบันทึก = ครบแน่นอน ณ เวลาปิดใบ ⇒ error เป็น null เสมอ
    cmt: { rows: Array.isArray(snap.comments) ? snap.comments : [], error: null },
  };
}

/**
 * ใบนี้ควรพิมพ์จากอะไร — ตัวตัดสินที่เดียว ห้ามเช็ค status/snapshot เองในหน้า
 * @returns {'live'|'snapshot'|'closed_no_record'}
 *   · `live`             — ใบยังไม่ปิด ⇒ พิมพ์สด (ถูกแล้ว ยังแก้ได้)
 *   · `snapshot`         — ปิดแล้วและมีบันทึกต้นฉบับ ⇒ พิมพ์จากบันทึก
 *   · `closed_no_record` — ปิดแล้วแต่ไม่มีบันทึก (ใบก่อน 12/10 หรือเก็บไม่สำเร็จ)
 *                          ⇒ พิมพ์สดได้ **แต่ต้องเขียนบนใบ** ว่าไม่ใช่เนื้อใบวันที่เซ็น
 */
export function moPrintSource(order) {
  if (order?.status !== 'closed') return 'live';
  return moFromSnapshot(order?.snapshot) ? 'snapshot' : 'closed_no_record';
}

/** ข้อความกำกับบนใบพิมพ์ — `null` = ไม่ต้องเขียนอะไร (ใบปกติ) */
export function moPrintNote(order) {
  const src = moPrintSource(order);
  if (src === 'snapshot') {
    const at = order?.snapshot_at || moFromSnapshot(order.snapshot)?.order?.cost_mgr_at || null;
    return `พิมพ์จากบันทึกต้นฉบับ ณ วันที่ปิดใบ${at ? ` (${beDate(at)})` : ''} — เนื้อใบตรงกับที่ลงนามไว้`;
  }
  if (src === 'closed_no_record') {
    return 'ใบนี้ปิดก่อนระบบเริ่มเก็บบันทึกต้นฉบับ — เนื้อใบที่พิมพ์เป็นข้อมูลปัจจุบัน '
         + 'อาจไม่ตรงกับที่ลงนามไว้';
  }
  return null;
}

/**
 * บันทึกต้นฉบับของใบนี้ อ้างไฟล์นี้อยู่ไหม — เช็คก่อนลบไฟล์ใน storage
 *
 * 🔴 ทำไมต้องมี: ใบที่ปิดแล้วถ้ามีคนกด "แก้ไข" ขั้นปิดใบแล้วเซ็นใหม่ ตัวลบไฟล์เก่าของหน้า
 *    (`removeMtnImg`) จะลบลายเซ็น/รูปตัวเดิมทิ้ง — **แต่ snapshot ชี้ URL เดิมอยู่**
 *    ⇒ พิมพ์ใบจากบันทึกแล้วช่องลายเซ็นกลายเป็นรูปเสีย **กู้ไม่ได้ และไม่มี error ใดฟ้อง**
 *    (คลาสเดียวกับบั๊ก "ลบเครื่อง 1 ตัว = รูปจุดตรวจของเครื่องอื่นหาย" · `utils/jigImageRefs.js`)
 * 🔴 เทียบด้วยสตริงทั้งก้อน **โดยเจตนา** — ลายเซ็น/รูปกระจายอยู่หลายคีย์และเพิ่มได้เรื่อยๆ
 *    ไล่เช็คทีละคีย์ = วันหนึ่งลืมคีย์ใหม่แล้วไฟล์ที่บันทึกใช้อยู่ถูกลบเงียบ
 *    (เทียบเกินไปแค่ทำให้ "ไม่ลบไฟล์กำพร้า" = กินที่ · ถูกกว่าบันทึกเสีย — fail-closed)
 */
export function snapshotUsesFile(snapshot, url) {
  if (!snapshot || !url) return false;
  try { return JSON.stringify(snapshot).includes(String(url)); } catch { return true; }
}

/** วันที่ไทยสั้น — ใช้เฉพาะในข้อความกำกับของไฟล์นี้ */
function beDate(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const g = {};
  p.forEach(x => { g[x.type] = x.value; });
  return `${+g.day}/${+g.month}/${+g.year + 543}`;
}
