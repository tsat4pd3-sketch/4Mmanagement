/* ══ 🖼️ นับว่า "ยังมีใครอ้างรูปนี้อยู่ไหม" ก่อนลบไฟล์ใน storage — จุดเดียวทั้งระบบ (2026-10-08) ══
 *
 * 🔴 ปัญหาที่ไฟล์นี้มีไว้แก้ (QC audit 08/10) — **ลบเครื่อง 1 ตัว = รูปของเครื่องอื่นหายถาวร**
 *    `copyChecklistToEquipment()` / `copyChecklistToDept()` (`src/lib/pmChecklists.js`)
 *    คัดลอก "นิยามจุดตรวจ" ไปเครื่องอื่นโดย **ใช้ `image_path` เดิมร่วมกัน ไม่ก๊อปไฟล์ storage**
 *    ⇒ `jigs/<เครื่องต้นแบบ>/cp-*.webp` ถูกอ้างจากจุดตรวจของหลายเครื่องพร้อมกัน
 *    เดิม `handleDelete` ของทะเบียนจิ๊ก ลบ **ทั้งโฟลเดอร์** `jigs/<id>/` ทิ้ง
 *    ⇒ จุดตรวจของทุกเครื่องที่ก๊อปไปกลายเป็นรูปเสีย **กู้ไม่ได้ และไม่มี error ใดฟ้อง**
 *    (ความเสี่ยงเดิมแคบ เพราะคัดลอกได้แค่ข้ามแผนก · ฟีเจอร์ 07/10 คัดลอกได้ทีละหลายร้อยเครื่อง
 *     ⇒ ขยายความเสียหายของบั๊กคลาสนี้มาก)
 *
 * ⚠️ **path เดียวถูกอ้างจาก 3 ตาราง** — `jig_images` · `jigs` · `jig_checkpoints`
 *    (ชุดเดียวกับที่ `src/utils/recompressLayouts.js` §4 ใช้ · ขาดตารางไหน = รูปหายจากจอนั้น)
 *
 * 🔴 **นับไม่ได้ = ห้ามลบ (fail-closed)** — กฎเดียวกับ `orgNodeRefs.js` / `processTypeRefs.js`
 *    ไฟล์กำพร้าค้างใน storage เป็นเรื่องเล็ก · ลบรูปที่ยังมีคนใช้ = ข้อมูลเสียกู้ไม่ได้
 */

import { supabaseDR } from '../supabaseClient';
import { fetchByIds } from './fetchByIds';

/** ตารางที่อาจชี้มาที่ไฟล์เดียวกัน — เพิ่มที่เก็บ `image_path` ใหม่ ต้องเติมที่นี่ด้วย */
const REF_TABLES = ['jig_images', 'jigs', 'jig_checkpoints'];

/**
 * คัดเฉพาะ path ที่ "ไม่มีใครอ้างแล้ว" ออกมา — ลบได้เฉพาะชุดนี้
 *
 * @param {string[]} paths               path ที่อยากลบ
 * @param {{ exceptCheckpointIds?: string[], exceptJigId?: string }} [opt]
 *        แถวที่ "กำลังจะหาย/หายไปแล้ว" จึงไม่ควรนับว่าเป็นผู้อ้าง
 *        · `exceptJigId` — ลบทะเบียนจิ๊กตัวนี้ (แถว `jigs`/`jig_images` ของมันถูกลบไปแล้วตาม cascade)
 * @returns {Promise<{ orphan: string[], stillUsed: string[], error: string|null }>}
 *   🔴 `error` ไม่ null = **นับไม่ครบ ⇒ `orphan` เป็น `[]` เสมอ** (ห้ามลบอะไรเลย)
 */
export async function orphanImagePaths(paths, opt = {}) {
  const want = [...new Set((paths || []).filter(Boolean))];
  if (!want.length) return { orphan: [], stillUsed: [], error: null };

  const { exceptCheckpointIds = [], exceptJigId = null } = opt;
  const skipCp = new Set(exceptCheckpointIds.map(String));
  const used = new Set();
  const errs = [];

  await Promise.all(REF_TABLES.map(async (t) => {
    /* เลือกคอลัมน์ id มาด้วย เพื่อข้ามแถวที่กำลังถูกลบ (ไม่งั้นมันนับตัวเองว่า "ยังมีคนใช้"
       แล้วไฟล์กำพร้าจะไม่ถูกเก็บกวาดเลย) · `jigs` ใช้คอลัมน์ id ตรงๆ */
    const cols = t === 'jig_checkpoints' ? 'id, image_path'
      : t === 'jigs' ? 'id, image_path'
        : 'id, jig_id, image_path';
    const { rows, error, truncated } = await fetchByIds(
      want,
      (chunk) => supabaseDR.from(t).select(cols).in('image_path', chunk),
    );
    if (error) { errs.push(`${t}: ${error}`); return; }
    if (truncated) { errs.push(`${t}: อ่านได้ไม่ครบ`); return; }
    (rows || []).forEach((r) => {
      if (t === 'jig_checkpoints' && skipCp.has(String(r.id))) return;
      if (t === 'jigs' && exceptJigId && String(r.id) === String(exceptJigId)) return;
      if (t === 'jig_images' && exceptJigId && String(r.jig_id) === String(exceptJigId)) return;
      if (r.image_path) used.add(r.image_path);
    });
  }));

  // 🔴 นับไม่ครบแม้ตารางเดียว = ไม่ลบอะไรเลย (ลบผิด = กู้ไม่ได้ · ค้างไว้ = แค่กินที่)
  if (errs.length) return { orphan: [], stillUsed: want, error: errs.join(' · ') };

  return {
    orphan: want.filter(p => !used.has(p)),
    stillUsed: want.filter(p => used.has(p)),
    error: null,
  };
}
