/* 🖼️ partImages — รูปชิ้นงานต่อ mat_no ที่ใช้ร่วมกันทุกจอ (2026-09-25 · คำสั่ง user)
   *"หน้านี้คือแดชบอร์ดที่สโตร์จะเปิดมอนิเตอร์ ความต้องการของไลน์ผลิตใช่มั้ย ควรจะมีรูปภาพชิ้นงานด้วยนะ"*

   ทำไมต้องมีของกลาง: รูปพาร์ทอยู่ 2 ทะเบียนคนละตาราง (ฝั่ง DR ทั้งคู่)
     · `parts_master.image_url`  — พาร์ทย่อย/ของซื้อ (2xx/3xx/5xx) = ทะเบียนหลักของสโตร์
     · `dr_products.image_url`   — พาร์ทแม่/สินค้าสำเร็จรูป (1xx)
   พาร์ทหนึ่งตัวอาจอยู่ทะเบียนใดทะเบียนหนึ่งหรือทั้งคู่ ⇒ ถ้าปล่อยให้แต่ละหน้าเลือกเอง
   จอหนึ่งจะเห็นรูป อีกจอไม่เห็นทั้งที่เป็นพาร์ทเดียวกัน — ลำดับความสำคัญต้องอยู่ที่เดียว

   🔴 กติกาที่ห้ามพัง:
   1. **ไม่มีรูป = ต้องบอกว่า "ยังไม่มีรูป" ห้ามเว้นช่องว่างเงียบๆ** (ENGINEERING-PRINCIPLES: ห้ามล้มเหลวเงียบ)
      วัดจริง 25/09: พาร์ทย่อยที่ขึ้นบอร์ด 155 ตัว มีรูป 52 ตัว (34%) — ถ้าไม่บอก คนจะคิดว่าจอพัง
   2. **เลือกเฉพาะคอลัมน์ที่ใช้** (`mat_no, image_url`) ห้าม `select('*')` — กฎเหล็ก DB ข้อ 11 (egress)
   3. รูปมาจาก Supabase Storage ที่ upload ผ่าน `uploadOpts()` อยู่แล้ว (cacheControl ยาว) —
      **ห้ามเติม query string กันแคชท้าย URL** จะทำให้โหลดใหม่ทุกครั้ง = egress บาน */

import { cachedMaster, invalidateMaster } from './masterCache.js';   // ใส่ .js ให้ครบ — เทส (node ESM) import ไฟล์นี้ตรงๆ

const IMG_KEY = 'part_images:v1';

/** ทะเบียนไหนชนะ: parts_master (ทะเบียนพาร์ทของสโตร์) ก่อน แล้วค่อย dr_products
 *  รับ rows แบบ [{ mat_no, image_url }] — แถวที่ไม่มี mat_no หรือรูปว่าง ถูกข้าม (ไม่เขียนค่า null ทับของที่มีแล้ว) */
export function partImageMap(partRows = [], productRows = []) {
  const m = {};
  // ใส่ dr_products ก่อน แล้ว parts_master ทับ = parts_master ชนะ
  [productRows, partRows].forEach(rows => {
    (rows || []).forEach(r => {
      const mat = String(r?.mat_no ?? '').trim();
      const url = String(r?.image_url ?? '').trim();
      if (mat && url) m[mat] = url;
    });
  });
  return m;
}

/** หา URL รูปของ mat หนึ่งตัว — คืน null เมื่อไม่มี (ห้ามคืน '' ให้ <img src=""> ยิงโหลดหน้าเปล่า) */
export function partImageOf(map, matNo) {
  const key = String(matNo ?? '').trim();
  if (!key) return null;
  return map?.[key] || null;
}

/** สรุปความครอบคลุมไว้เขียนบนจอ — { total, withImg, pct } · total 0 ⇒ pct null (ไม่ใช่ 0) */
export function imageCoverage(map, matNos = []) {
  const uniq = [...new Set((matNos || []).map(m => String(m ?? '').trim()).filter(Boolean))];
  const withImg = uniq.filter(m => !!partImageOf(map, m)).length;
  return { total: uniq.length, withImg, pct: uniq.length ? Math.round((withImg / uniq.length) * 100) : null };
}

/** โหลดทะเบียนรูปทั้ง 2 ตาราง (ฝั่ง DR · anon เสมอ)
 *  ทั้ง 2 ตารางรวมกันหลักร้อยแถว + เลือก 2 คอลัมน์ ⇒ ดึงทีเดียวจบ ไม่ต้อง chunk
 *  🔴 ผ่าน `cachedMaster` — ทะเบียนรูปเปลี่ยนเดือนละไม่กี่ครั้ง แต่ตอนนี้มี **6 จอ** ที่ต้องใช้
 *     ไม่ cache = เปิดจอไหนก็ยิงใหม่ทุกครั้ง (บทเรียน egress 14/09 ที่เคยโดนล็อกทั้ง organization)
 *  คืน { map, error } — ผู้เรียกต้องอ่าน error เอง (supabase-js ไม่ throw) */
export async function loadPartImages(client) {
  try {
    const rows = await cachedMaster(IMG_KEY, async () => {
      const [pm, dp] = await Promise.all([
        client.from('parts_master').select('mat_no, image_url').not('image_url', 'is', null),
        client.from('dr_products').select('mat_no, image_url').not('image_url', 'is', null),
      ]);
      if (pm.error) throw pm.error;
      if (dp.error) throw dp.error;
      return { pm: pm.data || [], dp: dp.data || [] };
    });
    return { map: partImageMap(rows.pm, rows.dp), error: null };
  } catch (e) {
    // รูปโหลดไม่ได้ = จอยังใช้งานได้ (ตกเป็นกล่อง "ยังไม่มีรูป") — ห้ามทำให้จอพัง
    return { map: {}, error: e };
  }
}

/** เรียกหลังแก้รูปในทะเบียนสินค้า/พาร์ท ไม่งั้นรูปใหม่ไม่ขึ้นจนกว่า TTL หมด (4 ชม.) */
export const invalidatePartImages = () => invalidateMaster(IMG_KEY);

export default partImageMap;
