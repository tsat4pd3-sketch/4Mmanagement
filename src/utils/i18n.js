/* ══ 🌐 ชั้นภาษาของ "โครงหลัก" — ปุ่มสลับ ไทย/English (2026-11-02 · คำสั่ง user) ═══════════════
   ที่มา: comment ว่า UX/UI ไม่ professional → user ให้เริ่มจาก "ทำปุ่มสลับ ไทย/Eng · แปลโครงหลักก่อน"
   (เมนู · ชื่อหมวด · ชื่อหน้า/คำอธิบายใต้หัว · แท็บ · ป้ายตัวกรอง · แถบเวลา · หน้า Home) — เนื้อในหน้ายังไทย

   ┌─ หลักออกแบบ ─────────────────────────────────────────────────────────────────────────┐
   │ 1. **ข้อความไทยในโค้ดยังเป็น "คีย์" อยู่เหมือนเดิม — ห้ามแก้ค่าในข้อมูล**                     │
   │    ชื่อหมวด ('ภาพรวม' …) ถูกใช้เป็น identity ของเมนู/สิทธิ์/`alsoIn`/`NAV_GROUP_META` ทั้งระบบ │
   │    ⇒ แปลที่ "จุดวาด" เท่านั้น: `tr(str)` คืนคำแปลถ้ามี · ไม่มี = คืนไทยเดิม (ไม่พัง ไม่เงียบ —  │
   │    จดลง `trMissing()` ให้ audit/เทสเห็น)                                                   │
   │ 2. ป้ายส่วนใหญ่มี emoji นำหน้า ('📋 รายการ MO') ⇒ แยก emoji ออกก่อนค้น แล้วประกอบกลับ       │
   │    พจนานุกรมจึงเก็บเฉพาะ "เนื้อคำ" — คีย์เดียวใช้ได้ทุกที่ไม่ว่าจะมีไอคอนอะไรนำ                 │
   │ 3. ภาษาไทย (`th`) = ทางด่วน: `tr()` คืนค่าเดิมทันที ไม่แตะพจนานุกรม ⇒ จอไทยเหมือนเดิมทุกพิกเซล │
   │ 4. ไฟล์นี้ **ไม่ import react** — เทส node ล้วนอ่านได้ · hook อยู่ `utils/useLang.js`          │
   └──────────────────────────────────────────────────────────────────────────────────────┘

   🔴 ห้ามแปลด้วยการเขียน `lang === 'en' ? 'Save' : 'บันทึก'` กระจายในหน้า — ใช้ `tr('บันทึก')` แล้วเติม
      คำใน `src/i18n/en.js` (ที่เดียว · มีด่านเทส `i18n.test.mjs` ว่าโครงหลักครบ)
   🔴 คีย์ที่ไม่ใช่ข้อความ (number/element/null) ส่งผ่านตามเดิม — ห้าม throw
   📄 docs/modules/i18n.md · UI-CONVENTIONS §6.34
   ════════════════════════════════════════════════════════════════════════════════════════ */
import EN from '../i18n/en.js';

export const LANG_KEY = 'esm-lang';
export const LANGS = Object.freeze(['th', 'en']);

let cur = 'th';
try {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(LANG_KEY) : null;
  if (LANGS.includes(saved)) cur = saved;
} catch { /* private mode / harness ไม่มี storage = ไทย */ }

/** ภาษาปัจจุบัน `'th' | 'en'` */
export const getLang = () => cur;

/** ตั้งภาษา (บันทึกลงเครื่อง + `<html lang>`) · ค่าที่ไม่รู้จัก = ไม่เปลี่ยน · คืนภาษาหลังตั้ง */
export function setLang(lang) {
  if (!LANGS.includes(lang)) return cur;
  cur = lang;
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* storage ปิด = จำแค่ใน session */ }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  return cur;
}

export const nextLang = (lang = cur) => (lang === 'th' ? 'en' : 'th');

/* emoji/สัญลักษณ์ + ช่องว่าง ที่นำหน้าป้าย — ตัดออกก่อนค้น แล้วคืนให้ตอนประกอบกลับ
   ครอบ: Misc Symbols/Dingbats (2600–27BF) · Arrows/Geometric (2190–21FF · 25A0–25FF · 2B00–2BFF)
   · Misc Technical (2300–23FF) · Supplementary (1F000–1FAFF) · VS16 FE0F · ZWJ 200D · regional (1F1E6–1F1FF)
   · `●` `▸` ฯลฯ อยู่ใน 25A0–25FF แล้ว */
const LEAD_RE = /^(?:[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{25A0}-\u{25FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]|\s)+/u;
const TRAIL_RE = /(?:\s|[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}])+$/u;

const missing = new Set();

/**
 * แปลข้อความโครงหลักเป็นภาษาปัจจุบัน
 * - ไทย (`th`) → คืนค่าเดิมเป๊ะ (ทางด่วน)
 * - อังกฤษ → ค้น `src/i18n/en.js` ด้วย "เนื้อคำ" (ตัด emoji นำ/ตามออก) · เจอ = ประกอบ emoji คืน
 * - ไม่เจอ = คืนไทยเดิม + จดคีย์ลง `trMissing()` (ไม่เงียบ · ไม่พัง)
 * - ไม่ใช่สตริง (element/number/null) → ส่งผ่านตามเดิม
 */
export function tr(str, lang = cur) {
  if (lang === 'th' || typeof str !== 'string' || !str) return str;
  const direct = EN[str];
  if (direct) return direct;
  const lead = str.match(LEAD_RE)?.[0] ?? '';
  const rest = str.slice(lead.length);
  const trail = rest.match(TRAIL_RE)?.[0] ?? '';
  const core = rest.slice(0, rest.length - trail.length);
  if (!core) return str;
  const hit = EN[core];
  if (hit) return `${lead}${hit}${trail}`;
  // ข้อความที่ไม่มีอักษรไทยเลย (OEE · Daily Report · MO-2610-001) = ไม่ต้องแปล ไม่นับว่าขาด
  if (!/[฀-๿]/.test(core)) return str;
  missing.add(core);
  return str;
}

/** คีย์ไทยที่เคยถูกขอแปลเป็นอังกฤษแล้วไม่มีในพจนานุกรม (สะสมตั้งแต่เปิดแอป) — ให้ audit/จอ dev อ่าน */
export const trMissing = () => Array.from(missing).sort();
export const trMissingReset = () => missing.clear();
if (typeof window !== 'undefined') window.__trMissing = trMissing;   // ให้ audit/คอนโซลถามได้ว่าคำไหนยังขาด

/** หน่วย "วัน" ที่ตามหลังตัวเลข — อังกฤษผันพหูพจน์ (`30 days` · `1 day`) · ไทยคงเดิม */
export const unitDays = (n, lang = cur) => (lang === 'th' ? 'วัน' : (Number(n) === 1 ? 'day' : 'days'));

/** `allOf(noun)` ฝั่งอังกฤษ — `ทุก<คำนาม>` → `All <noun>` (คำนามแปลต่อผ่าน tr) */
export const allLabel = (noun, lang = cur) => (lang === 'th' ? `ทุก${noun}` : `All ${tr(noun, lang)}`);
