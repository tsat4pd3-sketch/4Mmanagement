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
      (cache หายแค่ทำให้ยิง DB บ่อยขึ้น ไม่ใช่ error ที่ผู้ใช้ต้องเห็น)

   ── 🔴 รอบ 3: "โหลดไม่สำเร็จ" ห้ามถูกเก็บเป็น "ไม่มีข้อมูล" (2026-10-04 · feedback หน้างาน) ──
   เคสจริง 30/09 (คุณนพดล · `/daily-report`): *"ในรายการผลิตไลน์ 250T ไม่มีรายการให้เลือก
   ลองเอา User คนอื่นเข้าเปิด มีรายการให้เปิด"* — ตรวจแล้วข้อมูลใน DB ปกติทุกอย่าง
   (MAT ผูกไลน์ถูก · active · มี kanban standard ตั้งแต่ ส.ค. · สิทธิ์ครอบคลุม)

   ต้นเหตุเชิงโครงสร้าง: loader เขียนกันว่า `(await supabase…).data || []`
   **supabase-js ไม่ throw** ⇒ คิวรีล้ม (เน็ตสะดุด/timeout/RLS) ได้ `data = null` → `|| []`
   ⇒ `cachedMaster` เห็นเป็น "โหลดสำเร็จ ได้ 0 แถว" แล้ว **`lsWrite` ลิสต์ว่างทับของดี
   ค้างในเครื่องนั้นอีก 4 ชม.** โดยไม่มีข้อความอะไรบนจอเลย — เครื่องอื่นที่โหลดติดจึงเห็นครบ
   = "ผมไม่เห็น แต่คนอื่นเห็น" พอดีเป๊ะ (CLAUDE.md §กฎเหล็กการเขียน DB ข้อ 1 · แต่ข้อนั้น
   เขียนไว้สำหรับ **write** — ฝั่ง **read ที่ลง cache** ไม่เคยมีใครคุม จึง drift มา 11 จุด)

   ⇒ กติกาตั้งแต่นี้:
   1. **loader ต้องแยก "ว่างจริง" ออกจาก "ล้มเหลว" ให้ได้** — ห่อผลด้วย `mrows(await …)`
      (หรือ `if (error) throw error` เอง) **ห้าม `.data || []` ใน loader ของ cachedMaster อีก**
      — มีด่าน `master-cache-swallow` ใน regressionGuards
   2. **ล้มเหลว = ไม่เขียนทับของเดิม ไม่ลง localStorage** แล้วตั้ง `at: 0` ให้รอบหน้าลองใหม่
   3. **ล้มเหลวต้องเห็นบนจอ** (toast แดง) — เงียบ = หน้างานนึกว่าข้อมูลหาย เราก็หาไม่เจอ         */

// ใส่ `.js` ให้ครบ — เทส (node ESM) import ไฟล์นี้ตรงๆ และ node ต้องการนามสกุลเสมอ  */

// ใส่ `.js` ให้ครบ — เทส (node ESM) import ไฟล์นี้ตรงๆ และ node ต้องการนามสกุลเสมอ
// (Vite ทำงานได้ทั้งสองแบบ · ไม่ใส่ = เทสโมดูลนี้รันไม่ได้เลย)
import { MASTER_TTL } from './refreshRates.js';

/** error ของ "โหลดทะเบียนไม่สำเร็จ" — แยกชนิดไว้ให้ cachedMaster รู้ว่าไม่ใช่บั๊กโค้ด */
export class MasterLoadError extends Error {
  constructor(cause) {
    super(cause?.message || 'โหลดข้อมูลไม่สำเร็จ');
    this.name = 'MasterLoadError';
    this.cause = cause;
  }
}

/* รหัสที่แปลว่า "โครงสร้างยังไม่มีจริงๆ" ไม่ใช่ "โหลดไม่สำเร็จ"
   — ตาราง/คอลัมน์ที่ migration ยังไม่ถูก apply · ของจริงคือ "ว่าง" ⇒ cache ได้ ไม่ต้องตกใจ
   (หลาย picker ตั้งใจถอยไปโหมดพิมพ์เองพร้อมป้ายเมื่อเจอเคสนี้ — ห้ามเปลี่ยนพฤติกรรมนั้น) */
const SCHEMA_MISSING = new Set(['42P01', '42703']);   // undefined_table / undefined_column

/** แกะผลคิวรี supabase ให้ loader ของ cachedMaster — **error ต้องโยน ห้ามกลายเป็น []**
 *  ใช้: cachedMaster(<คีย์>, async () => mrows(await supabase.from(<ตาราง>).select('*')))
 *  🔴 ข้อยกเว้นเดียว = ตาราง/คอลัมน์ไม่มี (migration ยังไม่ apply) → คืน [] ตามเดิม
 *     ทุก error อื่น (เน็ตสะดุด · timeout · RLS · 5xx) = **ล้มเหลว ต้องโยน**
 *     ไม่งั้นลิสต์ว่างจะถูก cache ทับของดี 4 ชม. เงียบๆ (เคส 30/09 ในหัวไฟล์) */
export function mrows(res) {
  const err = res?.error;
  if (err) {
    if (SCHEMA_MISSING.has(err.code)) {
      console.warn('[masterCache] โครงสร้างยังไม่มี —', err.code, err.message, '· ถือว่าว่าง');
      return [];
    }
    throw new MasterLoadError(err);
  }
  return res?.data || [];
}

/* ตัวรับแจ้ง "โหลดทะเบียนไม่สำเร็จ" — แยก util ออกจาก UI (เทส node import ไฟล์นี้ตรงๆ
   ถ้า import toast ที่นี่ เทสจะลาก React/DOM เข้ามาทั้งก้อน) · ผูกจริงใน main.jsx */
let failSink = null;
export function onMasterLoadFail(fn) { failSink = typeof fn === 'function' ? fn : null; }

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

/* อ่าน localStorage **ไม่สนใจ TTL** — ใช้เฉพาะตอน "โหลดไม่สำเร็จ" เท่านั้น
   ของเก่าเกิน 4 ชม. ยังดีกว่าลิสต์ว่าง (ลิสต์ว่าง = หน้างานนึกว่าข้อมูลหาย)
   🔴 ห้ามเอาไปใช้ในทางปกติ — คนละเรื่องกับ `lsRead` ที่ต้องเคารพ TTL */
function lsAny(key) {
  try {
    const raw = localStorage.getItem(lsKey(key));
    if (!raw) return null;
    const o = JSON.parse(raw);
    return o?.v === CACHE_EPOCH ? o : null;
  } catch { return null; }
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
      /* 🔴 โหลดพลาด — 3 อย่างที่ "ต้อง" ทำ (ดูรอบ 3 ในหัวไฟล์)
         1. **ไม่ lsWrite** → ของดีที่ค้างใน localStorage ไม่ถูกลิสต์ว่างทับ
         2. `at: 0` → รอบหน้ายิงใหม่ทันที ไม่ต้องรอ TTL 4 ชม.
         3. บอกคน — เงียบคือต้นเหตุที่ทำให้เคส 30/09 หาไม่เจอ
         ⚠️ คืน `?? []` เสมอ ห้ามคืน undefined — ผู้เรียกทำ `.map()` ต่อทันทีหลายจุด */
      console.warn('[masterCache] โหลด', key, 'ไม่สำเร็จ — ใช้ค่าเดิมไปก่อน', e);
      const kept = hit?.data ?? lsAny(key)?.data;
      cache.set(key, { at: 0, data: kept });
      try { failSink?.(key, e, { hadFallback: kept !== undefined }); } catch { /* ตัวแจ้งพังห้ามลาม */ }
      return kept ?? [];
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
