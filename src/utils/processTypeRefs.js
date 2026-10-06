/* ══ processTypeRefs — "ใครยัง tag กระบวนการนี้อยู่" ก่อนลบออกจากทะเบียน ════════════════
   (2026-10-06 · QC audit — เดิม `ProcessTypeSetup.handleDelete` ลบทันทีโดย**ไม่เคยนับปลายทางเลย**
   มีแค่ข้อความเตือนในกล่อง confirm ว่า "จะกลายเป็นยังไม่กำหนด")

   `process_types.key` เป็น**ทะเบียนที่จับคู่ด้วยข้อความ ไม่ผูก FK** ⇒ ลบแล้วไม่มีใครเตือน
   CLAUDE.md §Database Schema: *"ลบ/เปลี่ยนชื่อแถวทะเบียน ต้องไล่เช็คและไล่แก้ปลายทางในคราวเดียว
   · **นับไม่ครบ = ห้ามลบ (fail-closed)**"* — ต้นแบบของกฎนี้คือ `src/utils/orgNodeRefs.js`

   ปลายทางที่ถือค่า `process_type` (ทั้งหมดอยู่ DR project · ยืนยันจากโค้ดที่อ่าน/เขียนจริง):
     machines.process_type           → ประเภทเครื่องจักร (`utils/useMachines.js` MACHINE_COLUMNS)
     dr_products.process_type        → ประเภทของสินค้า/ชั้น OP (`utils/useProducts.js` PRODUCT_COLUMNS)
     break_policies.process_type     → 🔴 **สูตรเวลาพักต่อกระบวนการ** — ตกตัวนี้ = นับพักผิด
                                        ⇒ %A/%P ของทุกกะที่ใช้สูตรนั้นเพี้ยน (CLAUDE.md §OEE)
     part_routings.process_type      → ขั้นตอนการผลิตต่อพาร์ท
     pe_master_processes.process_type → คลัง PFMEA กลาง

   🔴 **นับไม่ได้ = `partial: true` ห้ามตอบ 0** — การลบย้อนไม่ได้ ⇒ จอต้องไม่ลบไว้ก่อน
      (`42P01` ตารางไม่มี / `42703` คอลัมน์ไม่มี = ยังไม่ apply migration ของปลายทางนั้น
       ⇒ ปลายทางนั้นยังไม่มีข้อมูลจริง ถือว่า 0 ได้ · error อื่น = ไม่รู้)
   ══════════════════════════════════════════════════════════════════════════════════════════ */

/** ตาราง → ป้ายที่เอาไปเขียนบนจอ (เรียงตามความสำคัญที่คนต้องเห็นก่อน) */
export const PROCESS_TYPE_REF_TABLES = [
  ['break_policies', 'สูตรเวลาพัก'],
  ['machines', 'เครื่องจักร'],
  ['dr_products', 'สินค้า/ชั้น OP'],
  ['part_routings', 'ขั้นตอนการผลิต'],
  ['pe_master_processes', 'คลัง PFMEA'],
];

/** error code ที่แปลว่า "ปลายทางนั้นยังไม่มีในฐาน" ⇒ นับเป็น 0 ได้จริง ไม่ใช่ "ไม่รู้" */
const SCHEMA_GAP = ['42P01', '42703'];

/**
 * นับว่ามีแถวไหนยัง tag `key` นี้อยู่บ้าง
 * @param {object} client  supabaseDR (ปลายทางทุกตัวอยู่ DR)
 * @param {string} key     ค่าใน process_types.key
 * @returns {Promise<{counts: {table:string,label:string,n:number}[], total:number, partial:boolean}>}
 *   `partial: true` = นับไม่ครบ ⇒ **ผู้เรียกต้องไม่ลบ**
 */
export async function loadProcessTypeRefs(client, key) {
  if (!client || !key) return { counts: [], total: 0, partial: true };
  const res = await Promise.all(PROCESS_TYPE_REF_TABLES.map(([t]) =>
    client.from(t).select('*', { count: 'exact', head: true }).eq('process_type', key)));
  const counts = [];
  let partial = false;
  res.forEach((r, i) => {
    const [table, label] = PROCESS_TYPE_REF_TABLES[i];
    if (r.error) {
      if (!SCHEMA_GAP.includes(r.error.code)) partial = true;
      return;                                   // ปลายทางยังไม่มี = ข้าม (นับเป็น 0)
    }
    const n = r.count ?? 0;
    if (n > 0) counts.push({ table, label, n });
  });
  return { counts, total: counts.reduce((s, c) => s + c.n, 0), partial };
}

/**
 * ข้อความ "ลบไม่ได้เพราะ…" — คืน `null` เมื่อลบได้จริง (นับครบ และไม่มีใครใช้)
 * ⚠️ ผู้เรียกต้องเช็ค `!== null` แล้ว return ก่อนยิง delete เสมอ
 */
export function processTypeBlockMessage(label, refs) {
  if (!refs) return 'ยังตรวจการใช้งานไม่เสร็จ — ลองอีกครั้ง';
  if (refs.partial) {
    return `ยังลบ "${label}" ไม่ได้ — ตรวจไม่ครบว่ามีอะไรยังใช้อยู่ (คิวรีนับล้ม) · ลองใหม่อีกครั้ง`;
  }
  if (!refs.counts.length) return null;
  const parts = refs.counts.map(c => `${c.label} ${c.n.toLocaleString()} รายการ`);
  return `ลบไม่ได้: "${label}" ยังถูกใช้อยู่ — ${parts.join(' · ')}`
       + ' · ย้ายไปกระบวนการอื่นก่อน หรือกด "ปิดใช้งาน" แทนการลบ (ค่าเดิมยังอ่านออก)';
}
