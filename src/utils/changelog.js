/* ══ 📦 changelog — จัดกลุ่ม/ตีชนิดรายการอัพเดทโปรแกรม (2026-10-01) ═══════════════════
   pure ทั้งไฟล์ (มีเทส) · ตัวโหลด/ตัววาดอยู่ `src/pages/ProgramUpdate.jsx`
   ข้อมูลเข้ามาจาก `public/changelog.json` ที่ `scripts/gen-changelog.mjs` สร้างจาก git log

   🔴 **ชนิดต้องมี "ตะกร้ารับท้ายลิสต์" เสมอ** — commit ที่ไม่ได้เขียนตามรูป conventional
      (วัดจริง 01/10: 1,153 รายการ มี ~200 ที่ไม่มี prefix) **ห้ามหายจากจอ**
      กฎเดียวกับไลน์ที่ `line_type` ว่างต้องไม่หลุดจาก dropdown
   🔴 **ห้ามแปลงชนิดที่ไม่รู้จักเป็น 'อื่นๆ' แล้วทิ้งข้อความ** — ข้อความคือเนื้อหาที่คนอ่าน
   ═══════════════════════════════════════════════════════════════════════════════════ */

/** ชนิดที่โชว์บนจอ — เรียงตามความสำคัญที่คนถาม ("เพิ่มอะไร" มาก่อน "แก้อะไร") */
export const KINDS = [
  { key: 'feat',  icon: '✨', label: 'ฟีเจอร์ใหม่', color: '#22c55e', hint: 'ของที่เพิ่มเข้ามา',
    types: ['feat', 'feature'] },
  { key: 'fix',   icon: '🔧', label: 'แก้ปัญหา',    color: '#f59e0b', hint: 'บั๊ก/ของที่ทำงานผิด',
    types: ['fix', 'bugfix', 'hotfix'] },
  { key: 'tune',  icon: '⚡', label: 'ปรับปรุง',     color: '#0ea5e9', hint: 'หน้าตา/ความเร็ว/จัดระเบียบ',
    types: ['perf', 'refactor', 'ui', 'ux', 'nav', 'style', 'a11y'] },
  { key: 'doc',   icon: '📄', label: 'เอกสาร/กฎ',   color: '#a855f7', hint: 'กฎโปรเจค คู่มือ สเปก',
    types: ['docs', 'doc'] },
  { key: 'other', icon: '🧱', label: 'งานระบบ',      color: '#94a3b8', hint: 'ฐานข้อมูล เทส ของเบื้องหลัง',
    types: [] },                 // ← ตะกร้ารับท้ายลิสต์: อะไรที่ไม่เข้าข้างบนมาลงที่นี่
  ];

/** มุมมองตั้งต้น "สำหรับผู้ใช้" — เฉพาะของที่คนใช้รับรู้ได้ (ฟีเจอร์ · แก้ปัญหา · ปรับปรุง)
 *  ซ่อนเอกสาร/กฎและงานระบบ (ชื่อไฟล์ · ตัวแปร · ขนาด CLAUDE.md) ซึ่งเป็นภาษาของนักพัฒนา
 *  (UX audit 05/10 — จอนี้อยู่ในเส้นทางเดโมผู้บริหาร) · ดูครบได้ที่ "ทั้งหมด" */
export const USER_KINDS = ['feat', 'fix', 'tune'];

const BY_TYPE = new Map();
for (const k of KINDS) for (const t of k.types) BY_TYPE.set(t, k);
const FALLBACK = KINDS[KINDS.length - 1];

/** ชนิดของ 1 รายการ — ไม่รู้จัก/ไม่มี prefix = ตะกร้าท้ายลิสต์ (ไม่เคยคืน null) */
export const kindOf = (type) => BY_TYPE.get(String(type || '').toLowerCase()) || FALLBACK;

/** นับรายการต่อชนิด — คืนทุกคีย์เสมอ (ไม่มี = 0 เพื่อให้จอวาดการ์ดได้ครบ ไม่กระพริบ) */
export function countByKind(rows = []) {
  const out = Object.fromEntries(KINDS.map(k => [k.key, 0]));
  for (const r of rows) out[kindOf(r?.t).key] += 1;
  return out;
}

/** ค้นแบบง่าย — ตัดช่องว่างซ้ำ + ไม่สนตัวพิมพ์ (ไทยไม่มีตัวพิมพ์ แต่ scope เป็นอังกฤษ) */
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * จัดเป็นฟีดรายวัน (ใหม่ก่อน) หลังกรองชนิด/คำค้น
 * @returns [{ date, items: [...] }] — วันที่ไม่มีรายการเหลือหลังกรอง จะไม่อยู่ในผล
 */
export function buildFeed(rows = [], { kind = 'all', q = '' } = {}) {
  const needle = norm(q);
  const byDay = new Map();
  for (const r of rows) {
    if (!r?.d) continue;
    if (kind === 'user' ? !USER_KINDS.includes(kindOf(r.t).key)
      : (kind !== 'all' && kindOf(r.t).key !== kind)) continue;
    if (needle && !norm(`${r.m} ${r.s || ''}`).includes(needle)) continue;
    if (!byDay.has(r.d)) byDay.set(r.d, []);
    byDay.get(r.d).push(r);
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))      // วันใหม่ขึ้นก่อน
    .map(([date, items]) => ({ date, items }));
}

/**
 * ตัดฟีดตามเพดานจำนวนรายการที่วาด (กันช่วงกว้างมากทำจอหน่วง — จอ TV/มือถือหน้างานแรงน้อย)
 * 🔴 ตัดแล้ว **ต้องบอกบนจอว่าแสดงกี่จากกี่** (กฎเดียวกับ `capped()` ของคิวงาน) ห้ามตัดเงียบ
 * @returns { days, shown, total, hidden } — วันสุดท้ายถูกตัดครึ่งได้ (เรียงใหม่→เก่าอยู่แล้ว)
 */
export function limitFeed(feed = [], max = Infinity) {
  const total = feed.reduce((s, g) => s + (g?.items?.length || 0), 0);
  if (!(max > 0) || total <= max) return { days: feed, shown: total, total, hidden: 0 };
  const days = [];
  let shown = 0;
  for (const g of feed) {
    const room = max - shown;
    if (room <= 0) break;
    const items = (g.items || []).slice(0, room);
    days.push({ ...g, items });
    shown += items.length;
  }
  return { days, shown, total, hidden: total - shown };
}
