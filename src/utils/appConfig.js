/* ── 🔌 appConfig — จุดเดียวที่รู้ว่า "backend อยู่ที่ไหน" (2026-09-08) ─────────────────
 *
 * ทำไมต้องมี (เตรียมย้ายระบบมา server ของบริษัท — ไอทีจะรับช่วง maintain ต่อ):
 *   เดิม URL ของ Supabase project ถูก **hardcode กระจาย 9 จุดในโค้ดฝั่งเว็บ**
 *   (8 จุดเรียก edge function + 1 จุด fallback ของ client ฝั่ง DR)
 *   → ย้าย server แล้วตั้ง env ครบ **หน้าเว็บก็ยังยิงแจ้งเตือนกลับไปที่ cloud ตัวเก่าอยู่ดี**
 *     และที่อันตรายกว่า: DR ยัง fallback ไป cloud ตัวเก่า **แบบเงียบ ไม่มี error**
 *     = ข้อมูลผลิตแตกเป็น 2 ที่ โดยไม่มีใครรู้จนกว่าจะมีคนทักว่า "ตัวเลขไม่ตรง"
 *
 * กฎของไฟล์นี้:
 *   1. **ห้ามเขียน URL/key ของ Supabase project ที่ไหนอีกในโค้ด** — ทุกที่อ่านผ่านไฟล์นี้
 *   2. เรียก edge function ต้องผ่าน `callFn()` / `fnUrl()` เท่านั้น ห้าม fetch URL เต็มเอง
 *   3. ขาด env → **ห้ามเงียบ** (กฎ ENGINEERING-PRINCIPLES) — ลง `console.error` + โผล่ป้ายเตือน
 *      ให้ admin เห็นบนจอผ่าน `configWarnings`
 *
 * ⚠️ LEGACY_DR_* ด้านล่างเป็น "ค่าประคอง" ของ deploy ปัจจุบันเท่านั้น:
 *    `render.yaml` ตั้งแค่ VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (ไม่มีฝั่ง DR)
 *    → ถอดทิ้งตอนนี้ = production ล่มทันที จึงคงไว้ก่อนแบบ "ส่งเสียงดัง"
 *    **ขั้นตอนถอด (ทำหลังย้าย server เสร็จ):** ตั้ง VITE_SUPABASE_DR_URL/KEY ให้ครบทุกที่ที่ build
 *    → ยืนยันว่าป้ายเตือนหายจากจอ → ค่อยลบ 2 ค่านี้ + บล็อก fallback ทิ้งในคอมมิทเดียว
 */

// `import.meta.env` มีเฉพาะตอน Vite bundle — เวลารันเทสด้วย node ธรรมดาจะเป็น undefined
const env = import.meta.env || {};

/** ปัญหา config ที่เจอตอนบูต — App.jsx เอาไปแสดงเป็นป้ายเตือนให้ admin (ห้ามล้มเหลวเงียบ) */
export const configWarnings = [];

const warn = (msg) => {
  configWarnings.push(msg);
  // eslint-disable-next-line no-console
  console.error(`[appConfig] ${msg}`);
};

// ── Main project (auth, employees, 4M, shifts, skills, edge functions ทั้งหมด) ──
export const SUPABASE_URL      = env.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // ไม่มีค่านี้ = แอปใช้งานไม่ได้เลยอยู่แล้ว (createClient จะโยน) — แต่บอกให้ชัดว่าต้องตั้งอะไร
  warn('ไม่ได้ตั้ง VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — แอปต่อฐานข้อมูลหลักไม่ได้');
}

// ── DR project (production sessions, OEE, kanban, PM, MTN) ──
const LEGACY_DR_URL = 'https://eyhclzkifitbhbljgoav.supabase.co';
const LEGACY_DR_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5aGNsemtpZml0YmhibGpnb2F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODExMDQsImV4cCI6MjA5MjQ1NzEwNH0.fHTA70fQ8yAvQuwAeM9HQ_UQjMdR3FUkxu_klvXs-h4';

export const USING_LEGACY_DR_FALLBACK = !env.VITE_SUPABASE_DR_URL || !env.VITE_SUPABASE_DR_KEY;

export const SUPABASE_DR_URL = env.VITE_SUPABASE_DR_URL || LEGACY_DR_URL;
export const SUPABASE_DR_KEY = env.VITE_SUPABASE_DR_KEY || LEGACY_DR_KEY;

if (USING_LEGACY_DR_FALLBACK) {
  warn(`ไม่ได้ตั้ง VITE_SUPABASE_DR_URL / VITE_SUPABASE_DR_KEY → กำลังใช้ค่าเดิมที่ฝังในโค้ด (${LEGACY_DR_URL}) `
     + 'ถ้านี่คือ server ใหม่ ข้อมูลการผลิตกำลังวิ่งไปฐานเดิม ไม่ได้อยู่ที่นี่');
}

/**
 * ประกอบ URL ของ edge function — pure function แยกไว้ให้เทสได้ (ไม่แตะ env)
 * ตัด `/` ท้าย base ทิ้งเสมอ: ตั้ง env เป็น `https://x/` แล้วได้ `//functions/v1/…` = 404 หายาก
 * @param {string} baseUrl เช่น 'https://xxx.supabase.co'
 * @param {string} name    ชื่อฟังก์ชัน เช่น 'send-notification'
 */
export function buildFnUrl(baseUrl, name) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}/functions/v1/${name}`;
}

/**
 * URL เต็มของ edge function บน Main project
 * @param {string} name ชื่อฟังก์ชัน เช่น 'send-notification'
 */
export function fnUrl(name) {
  return buildFnUrl(SUPABASE_URL, name);
}

/**
 * เรียก edge function แบบ fire-and-forget — ใช้แทน `fetch('https://….supabase.co/functions/v1/…')` ทุกจุด
 *
 * แจ้งเตือนล้มเหลว **ห้าม**ทำให้การบันทึกของผู้ใช้พัง (กฎเดิมของโปรเจค) → คืน Promise ที่ไม่ reject
 * แต่ **ห้ามเงียบสนิท** → log ไว้ที่ console ให้ไล่ปัญหาได้
 *
 * @param {string} name  ชื่อ edge function
 * @param {object} body  payload (จะถูก JSON.stringify)
 * @param {{ apikey?: boolean }} [opts] apikey=false เมื่อฟังก์ชันตั้ง verify_jwt=false และไม่ต้องการ header
 * @returns {Promise<Response|null>} null เมื่อยิงไม่สำเร็จ
 */
export function callFn(name, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opts.apikey !== false && SUPABASE_ANON_KEY) headers.apikey = SUPABASE_ANON_KEY;
  try {
    return fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify(body) })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.warn(`[callFn] ${name} ยิงไม่สำเร็จ`, e);
        return null;
      });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[callFn] ${name} ยิงไม่สำเร็จ`, e);
    return Promise.resolve(null);
  }
}
