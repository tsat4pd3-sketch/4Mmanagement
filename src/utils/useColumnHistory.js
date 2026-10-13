/* ── useColumnHistory — "ค่าที่เคยบันทึกไว้" ของคอลัมน์หนึ่ง สำหรับป้อน picker เป็นกลุ่ม 📜 ──
   (2026-09-07 · คำสั่ง user: "ถ้าข้อมูลจะไม่มี[ในทะเบียน] ใช้ข้อมูลที่เคยลงไว้ได้มั้ย")

   picker กลางบังคับเลือกจากทะเบียน แต่ของจริงมีค่าที่บันทึกมาก่อนทะเบียนจะครบ (เครื่องที่ยังไม่ลง
   /machines · MAT เก่าที่ Product Master ยังไม่มี · ชื่อคนที่พิมพ์มาก่อน) — ห้ามล้าง/บล็อกเงียบ
   → หน้าโหลด distinct ของคอลัมน์ปลายทางผ่าน hook นี้ แล้วส่งเข้า picker เป็น `history`
     picker แสดงเป็นกลุ่ม "📜 เคยบันทึกไว้ (ไม่มีในทะเบียน)" เลือกได้ + ติดป้าย ⚠ ให้เห็นว่านอกทะเบียน

   ⚠️ best-effort: อ่านล่าสุด `limit` แถวแล้ว dedupe ฝั่ง client (PostgREST ไม่มี distinct) · cache ร่วม
   ผ่าน masterCache · ตาราง/คอลัมน์ไม่มี = คืน [] · คิวรีล้มจริง = โยน (ห้าม cache ว่างทับ) */
import { cachedMaster, invalidateMaster, mrows } from './masterCache';
import useMasterRows from './useMasterRows.js';

const norm = (v) => String(v ?? '').trim();

/**
 * @param {object} client   supabase หรือ supabaseDR (ตารางอยู่ project ไหน)
 * @param {string} table
 * @param {string} column
 * @param {{ limit?: number, upper?: boolean, enabled?: boolean }} opt
 */
export async function loadColumnHistory(client, table, column, { limit = 3000, upper = false } = {}) {
  const key = `hist:${table}.${column}`;
  return cachedMaster(key, async () => {
    // mrows: คอลัมน์/ตารางไม่มี → [] (เดิม) · error อื่น → โยน (ไม่งั้น "ค่าที่เคยบันทึก" หายเงียบ 4 ชม.)
    const rows = mrows(await client.from(table).select(column).not(column, 'is', null).limit(limit));
    const seen = new Set(); const out = [];
    for (const row of rows) {
      const v = norm(row[column]); if (!v) continue;
      const k = upper ? v.toUpperCase() : v;
      if (seen.has(k)) continue; seen.add(k); out.push(upper ? k : v);
    }
    return out.sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
  });
}
export const invalidateColumnHistory = (table, column) => invalidateMaster(`hist:${table}.${column}`);

/** สถานะโหลด "ค่าที่เคยบันทึก" — `{ rows, failed, stale, message, loading, reload }`
 *  🔴 ล้ม = กลุ่ม 📜 หายไปจาก picker ⇒ คนหาค่าที่ตัวเองเพิ่งกรอกไม่เจอ ต้องเขียนบอกได้ */
export function useColumnHistoryState(client, table, column, { enabled = true, limit = 3000, upper = false } = {}) {
  // คีย์ต้องตรงกับที่ `loadColumnHistory` ส่งให้ cachedMaster (ไม่ตรง = ถามสถานะล้มผิดคีย์)
  return useMasterRows(`hist:${table}.${column}`,
    () => loadColumnHistory(client, table, column, { limit, upper }),
    { enabled: !!(enabled && client && table && column), dep: `${limit}|${upper ? 1 : 0}` });
}

export default function useColumnHistory(client, table, column, opt = {}) {
  return useColumnHistoryState(client, table, column, opt).rows;
}
