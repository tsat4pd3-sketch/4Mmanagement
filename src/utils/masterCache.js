/* ── masterCache — cache ตาราง master ที่ "แทบไม่เปลี่ยน แต่ถูกดึงซ้ำทุกรอบ refresh" ──
   (2026-08-19 · หลัง Supabase เตือนโควต้า egress)

   ปัญหาที่แก้: จอสด (FactoryMap/Dashboard/Management) refresh ทุก 30 วิ แล้วดึง
   `dr_products` (109 แถว) · `kanban_standards` (299) · `machines` (518) · `break_policies`
   มาใหม่ "ทั้งตาราง" ทุกครั้ง ทั้งที่ข้อมูลพวกนี้เปลี่ยนเดือนละไม่กี่ครั้ง
   → กิน egress ~70% ของแต่ละรอบ โดยไม่ได้ความสดอะไรเพิ่มเลย

   ⚠️ อย่าเอามาใช้กับ "ข้อมูลการผลิตสด" (session/order/downtime/defect/mtn_orders)
      พวกนั้นต้องสดจริง — cache แล้วจอจะโกหก

   ⚠️ แก้ master แล้วจอสดจะเห็นช้าได้ถึง TTL (ดีฟอลต์ 10 นาที)
      หน้าที่แก้ master เองให้เรียก `invalidateMaster(key)` หลังบันทึกสำเร็จ เพื่อให้เห็นทันที   */

const DEFAULT_TTL = 10 * 60 * 1000;
const cache = new Map();   // key → { at, data, inflight }

/**
 * @param {string}   key    ชื่อเฉพาะของชุดข้อมูล (ใช้เป็นกุญแจ cache + ตัว invalidate)
 * @param {Function} loader async () => data   (ต้องคืน "ข้อมูล" ไม่ใช่ response ของ supabase)
 * @param {number}   ttl    อายุ cache (ms)
 */
export async function cachedMaster(key, loader, ttl = DEFAULT_TTL) {
  const hit = cache.get(key);
  if (hit && hit.data !== undefined && Date.now() - hit.at < ttl) return hit.data;
  if (hit?.inflight) return hit.inflight;   // หลายจุดเรียกพร้อมกัน = ยิงจริงครั้งเดียว

  const p = (async () => {
    try {
      const data = await loader();
      cache.set(key, { at: Date.now(), data });
      return data;
    } catch (e) {
      // โหลดพลาด → คืนของเก่าไปก่อน (ดีกว่าจอว่าง) และไม่ต่ออายุ cache ให้รอบหน้าลองใหม่
      console.warn('[masterCache] โหลด', key, 'ไม่สำเร็จ — ใช้ค่าเดิมไปก่อน', e);
      cache.set(key, { at: 0, data: hit?.data });
      return hit?.data;
    }
  })();

  cache.set(key, { ...(hit || {}), inflight: p });
  return p;
}

/** ล้าง cache — ไม่ส่ง key = ล้างทั้งหมด (เรียกหลังแก้ master สำเร็จ) */
export function invalidateMaster(key) {
  if (key == null) cache.clear();
  else cache.delete(key);
}

export default cachedMaster;
