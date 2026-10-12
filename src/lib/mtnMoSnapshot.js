/* ══ 📄 ใบ MO ที่ปิดแล้ว = "บันทึก" ไม่ใช่ใบที่ generate ใหม่ (2026-10-12 · คำสั่ง user) ══════
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
 * ── ทำไมไม่เก็บเป็น HTML ──
 *    เก็บ **ข้อมูล** แล้วให้ใบพิมพ์ประกอบใหม่ (หลักเดียวกับ `serializeReport` ของใบรายงานปัญหา)
 *    ⇒ แก้ layout/ฟอนต์/เลขฟอร์มทีหลังแล้วใบเก่ายังพิมพ์ออกมาสวยและถูกระเบียบ
 *      ส่วน **เนื้อหา** ยังเป็นของวันที่เซ็น
 */

import { supabaseDR } from '../supabaseClient';
import { loadMoComments } from './moComments';
import { MO_SNAP_VERSION, serializeMo, moFromSnapshot, moPrintSource, moPrintNote, snapshotUsesFile }
  from './mtnMoSnapshotCore';

/* ของกลางชิ้นเดียวสำหรับหน้า — re-export ส่วน pure ต่อ เพื่อให้ผู้เรียก import ที่เดียวจบ
   (ส่วน pure อยู่ `mtnMoSnapshotCore.js` เพราะไฟล์นี้แตะฐาน `node --test` โหลดไม่ได้) */
export { MO_SNAP_VERSION, serializeMo, moFromSnapshot, moPrintSource, moPrintNote, snapshotUsesFile };

/**
 * เก็บ snapshot ของใบที่ "เพิ่งปิด" — เรียกหลัง update ปิดใบสำเร็จแล้วเท่านั้น
 *
 * 🔴 ไม่เขียนทับของเดิม — ใบปิดครั้งเดียว บันทึกต้นฉบับต้องมีชุดเดียว
 *    (กด "แก้ไข" ขั้นปิดใบทีหลังแล้วทับ = บันทึกเปลี่ยนตามคนแก้ = หมดความเป็นบันทึก)
 *    กันด้วย `.is('snapshot', null)` ที่ชั้น WHERE ⇒ เขียนซ้ำได้ 0 แถวโดยไม่ error
 * 🔴 ล้มเหลว **ห้ามเงียบ** — คืน `{ ok:false, reason }` ให้หน้าบอก user
 *    แต่ **ไม่ทำให้การปิดใบเป็นโมฆะ** (ใบปิดไปแล้วจริง) ⇒ ใบนั้นจะกลายเป็น `closed_no_record`
 *    แล้วใบพิมพ์เขียนกำกับให้เอง (ไม่มีจุดไหนโกหก)
 */
export async function saveMoSnapshot(order) {
  if (!order?.id) return { ok: false, reason: 'ไม่รู้ว่าใบไหน' };
  if (order.snapshot) return { ok: true, skipped: 'มีบันทึกต้นฉบับอยู่แล้ว' };

  const [pr, lr, cr] = await Promise.all([
    supabaseDR.from('mtn_order_parts').select('*').eq('order_id', order.id),
    supabaseDR.from('mtn_order_labor').select('*').eq('order_id', order.id).order('seq'),
    loadMoComments(order.id),
  ]);
  /* 🔴 อ่านอะไหล่/ค่าแรง/คอมเมนต์ไม่ครบ = **ไม่เก็บ** (fail-closed)
     บันทึกที่ขาดตารางอะไหล่ไป ดูเหมือนใบที่ไม่มีอะไหล่เลย = แย่กว่าไม่มีบันทึก
     (ไม่มีบันทึก ⇒ ใบเขียนกำกับว่าเป็นข้อมูลปัจจุบัน · บันทึกที่ขาด ⇒ โกหกแบบดูไม่ออก) */
  const bad = [
    pr.error && `อะไหล่: ${pr.error.message}`,
    lr.error && `ค่าแรง: ${lr.error.message}`,
    cr.error && `คอมเมนต์: ${cr.error}`,
  ].filter(Boolean);
  if (bad.length) return { ok: false, reason: `อ่านเนื้อใบไม่ครบ — ${bad.join(' · ')}` };

  const snap = serializeMo(order, { parts: pr.data || [], labor: lr.data || [], comments: cr.rows });
  if (!snap) return { ok: false, reason: 'ประกอบบันทึกไม่สำเร็จ' };

  /* นับแถวจาก `.select('id')` ไม่ใช่ `!error` — RLS ปฏิเสธ UPDATE = สำเร็จ 0 แถว ไม่มี error
     (db-write-rules ข้อ 2) · 0 แถว + ไม่มี error ที่นี่ = มีคนเก็บ snapshot ไปก่อนแล้ว (ไม่ใช่ error) */
  const { data, error } = await supabaseDR.from('mtn_orders')
    .update({ snapshot: snap, snapshot_at: snap.at })
    .eq('id', order.id).is('snapshot', null)
    .select('id');
  if (error) return { ok: false, reason: error.message };
  if (!(data || []).length) return { ok: true, skipped: 'มีบันทึกต้นฉบับอยู่แล้ว' };
  return { ok: true, at: snap.at };
}
