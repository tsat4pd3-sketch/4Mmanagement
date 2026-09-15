/* ── masterCache — cache ตาราง master ที่ "แทบไม่เปลี่ยน แต่ถูกดึงซ้ำทุกรอบ refresh" ──
   (2026-08-19 · หลัง Supabase เตือนโควต้า egress)

   ปัญหาที่แก้: จอสด (FactoryMap/Dashboard/Management) refresh ทุก 30 วิ แล้วดึง
   `dr_products` (109 แถว) · `kanban_standards` (299) · `machines` (518) · `break_policies`
   มาใหม่ "ทั้งตาราง" ทุกครั้ง ทั้งที่ข้อมูลพวกนี้เปลี่ยนเดือนละไม่กี่ครั้ง
   → กิน egress ~70% ของแต่ละรอบ โดยไม่ได้ความสดอะไรเพิ่มเลย

   ⚠️ อย่าเอามาใช้กับ "ข้อมูลการผลิตสด" (session/order/downtime/defect/mtn_orders)
      พวกนั้นต้องสดจริง — cache แล้วจอจะโกหก

   ── 🔴 รอบ 2: cache ข้ามการเปิดแอป (2026-09-14 · หลังโดนล็อกบริการทั้ง organization) ──────
   cache เดิมอยู่ใน memory ของแท็บ ⇒ **เปิดแอปใหม่/กด F5 = โหลด master ใหม่ทั้งชุดทุกครั้ง**
   วัดจาก log 14/09 (วันอาทิตย์ โรงงานหยุด): `machines` + `dr_products` + `kanban_standards`
   ถูกดึงพร้อมกัน **329 ครั้ง/วัน** = จำนวนครั้งที่คนเปิดหน้า Daily Report
     machines 368 KB + kanban_standards 164 KB + dr_products 107 KB ≈ 640 KB × 329
     = **~200 MB/วัน ในวันที่ไม่มีใครทำงาน** ≈ 6 GB/เดือน > โควต้า Free ทั้งเดือน (5 GB)
   ⇒ ย้าย cache ลง **localStorage** (อยู่ข้ามการเปิดแอป) — TTL เท่าเดิม

   **ทางล้าง cache (ต้องมีเสมอ ไม่งั้นข้อมูลค้างแล้วแก้ไม่ได้):**
   1. `invalidateMaster(key)` — หน้าที่แก้ master เรียกหลังบันทึก (ล้างทั้ง memory + localStorage)
   2. บวก `CACHE_EPOCH` (ด้านล่าง) เมื่อ **โครงข้อมูลที่ cache ไว้เปลี่ยน** — ⚠️ deploy เฉยๆ ไม่ล้างแล้ว (แก้ 2026-09-15 · ดูเหตุผลที่ CACHE_EPOCH)
   3. TTL หมดอายุตามปกติ (`MASTER_TTL` = 4 ชม.)
   ⚠️ สิ่งที่ **เปลี่ยนไปจากเดิม**: กด F5 แล้ว **ไม่ล้าง** cache อีกต่อไป (นั่นคือจุดประสงค์ทั้งหมด)
      → แก้ master แล้วเครื่อง "คนอื่น" เห็นช้าได้ถึง 4 ชม. เท่าเดิม แต่เดิมบอกให้ "กด F5 สิ" ได้
      ตอนนี้บอกไม่ได้แล้ว — ถ้าต้องให้เห็นทันทีทั้งโรงงาน ต้อง deploy หรือรอ TTL
   ⚠️ localStorage อาจถูกปิด (private mode) / เต็ม → **ทุกจุดต้อง try/catch แล้วทำงานต่อได้**
      (cache หายแค่ทำให้ยิง DB บ่อยขึ้น ไม่ใช่ error ที่ผู้ใช้ต้องเห็น)                        */

// ใส่ `.js` ให้ครบ — เทส (node ESM) import ไฟล์นี้ตรงๆ และ node ต้องการนามสกุลเสมอ
// (Vite ทำงานได้ทั้งสองแบบ · ไม่ใส่ = เทสโมดูลนี้รันไม่ได้เลย)
import { MASTER_TTL } from './refreshRates.js';

const DEFAULT_TTL = MASTER_TTL;
const cache = new Map();   // key → { at, data, inflight }

const LS_PREFIX = 'esm_mc_';

/* ── 🔴 CACHE_EPOCH — "รุ่นของโครงข้อมูล" ไม่ใช่ "รุ่นของ build" (แก้ 2026-09-15) ──────────
   เดิมใช้ `VITE_BUILD_ID` ⇒ **deploy ทีเดียว = ล้าง cache master ของทุกเครื่องทั้งโรงงาน**
   วัดจริง 15/09 (คำถามจาก user ตรงเป๊ะ: "แก้ระหว่างวันบ่อยๆ + เปิดหลายจอ เลยรีเฟรชเรื่อยๆ ?"):
     แอป boot ใหม่ **~340 ครั้ง/ชม.** ในเวลาทำงาน (1,372 ครั้งใน 4 ชม. วัดจากคิวรี `profiles`)
   ทุก boot หลัง deploy = โหลด master ใหม่ทั้งชุด (~640 KB) เพราะ stamp ไม่ตรง
   ⇒ deploy วันละหลายรอบ × เครื่องที่เปิดค้างทั้งโรงงาน = ค่า egress ที่จ่ายฟรีๆ
   (ตัว reload เองถูกต้องแล้ว — fix ต้องไปถึงจอ · ที่ผิดคือ "ทุก reload ต้องโหลด master ใหม่")

   ตอนนี้: เลขนี้ **เปลี่ยนด้วยมือเท่านั้น** เมื่อ "โครงข้อมูลของสิ่งที่ cache ไว้เปลี่ยนจริง"
   (เพิ่ม/ลบคอลัมน์ใน select ของ cachedMaster · เปลี่ยนรูปแบบค่าที่เก็บ)
   ⚠️ แก้ select ของ cachedMaster แล้วลืมบวกเลขนี้ = เครื่องที่มี cache เก่าอ่านโครงเก่าได้ถึง 4 ชม.
      → **แก้ shape เมื่อไหร่ บวกเลขนี้ในคอมมิทเดียวกันเสมอ**
   (การแก้ "เนื้อข้อมูล" ไม่ต้องแตะเลขนี้ — ใช้ `invalidateTable()` ดู masterInvalidate.js) */
const CACHE_EPOCH = 'e1';

const lsKey = (key) => `${LS_PREFIX}${key}`;

/** อ่านจาก localStorage — คืน null ถ้าไม่มี/หมดอายุ/คนละ build/อ่านไม่ได้ */
function lsRead(key, ttl) {
  try {
    const raw = localStorage.getItem(lsKey(key));
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (o?.v !== CACHE_EPOCH) { localStorage.removeItem(lsKey(key)); return null; }
    if (!(Date.now() - o.at < ttl)) return null;
    return o;
  } catch { return null; }     // private mode / JSON เพี้ยน → ถือว่าไม่มี cache
}

function lsWrite(key, data) {
  try {
    localStorage.setItem(lsKey(key), JSON.stringify({ v: CACHE_EPOCH, at: Date.now(), data }));
  } catch {
    // เต็ม/ปิดอยู่ → ทิ้ง cache เก่าของ master ทั้งหมดแล้วปล่อยผ่าน (ยิง DB บ่อยขึ้นแต่ไม่พัง)
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k?.startsWith(LS_PREFIX)) localStorage.removeItem(k);
      }
    } catch { /* ปิดอยู่จริงๆ — ไม่ต้องทำอะไร */ }
  }
}

/**
 * @param {string}   key    ชื่อเฉพาะของชุดข้อมูล (ใช้เป็นกุญแจ cache + ตัว invalidate)
 * @param {Function} loader async () => data   (ต้องคืน "ข้อมูล" ไม่ใช่ response ของ supabase)
 * @param {number}   ttl    อายุ cache (ms)
 */
export async function cachedMaster(key, loader, ttl = DEFAULT_TTL) {
  const hit = cache.get(key);
  if (hit && hit.data !== undefined && Date.now() - hit.at < ttl) return hit.data;
  if (hit?.inflight) return hit.inflight;   // หลายจุดเรียกพร้อมกัน = ยิงจริงครั้งเดียว

  // memory ยังไม่มี (เพิ่งเปิดแอป) → ลองของที่ค้างใน localStorage ก่อนยิง DB
  const stored = lsRead(key, ttl);
  if (stored) {
    cache.set(key, { at: stored.at, data: stored.data });
    return stored.data;
  }

  const p = (async () => {
    try {
      const data = await loader();
      cache.set(key, { at: Date.now(), data });
      lsWrite(key, data);
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

/** ล้าง cache — ไม่ส่ง key = ล้างทั้งหมด (เรียกหลังแก้ master สำเร็จ)
 *  ⚠️ ต้องล้าง localStorage ด้วยเสมอ ไม่งั้นแก้ master แล้วเปิดแอปใหม่ยังเห็นของเก่า */
export function invalidateMaster(key) {
  if (key == null) {
    cache.clear();
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k?.startsWith(LS_PREFIX)) localStorage.removeItem(k);
      }
    } catch { /* localStorage ปิดอยู่ */ }
  } else {
    cache.delete(key);
    try { localStorage.removeItem(lsKey(key)); } catch { /* localStorage ปิดอยู่ */ }
  }
}

export default cachedMaster;
