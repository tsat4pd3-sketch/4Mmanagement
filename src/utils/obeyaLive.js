/* ══ 🏛️ obeyaLive — "บอร์ดสถานะ OBEYA แบบสด" บนผังรวมโรงงาน (/factory-map) ════════════
   2026-09-22 · คำขอ user: *"หน้าผังรวมโรงงานด้านขวา เอาสเตตัสบอร์ด OBEYA ใส่แทนในกรณีที่ดูสดได้
   เพราะถ้าขึ้นแบบนี้มันซ้ำกับใน box ที่มี — เอาแค่สถานะของแต่ละหัวข้อมาโชว์ เขียว/เหลือง/แดง
   เช่น สมมติ Quality แดง กดเข้าไปก็ drill down หาว่าไลน์ไหนมีปัญหาคุณภาพ"*

   แผงขวาเดิมเป็น "จัดอันดับไลน์ตาม metric ที่เลือก" ซึ่งพูดเรื่องเดียวกับป้าย/การ์ด hover บนผัง
   ⇒ เปลี่ยนเป็นบอร์ดรายหัวข้อ (SQDCM + OEE) ที่ตอบคำถามคนละคำถาม: *"วันนี้เรื่องไหนมีปัญหา"*
   แล้วค่อยกดเจาะลงไปหาไลน์

   ── กฎของไฟล์นี้ (เหมือน obeyaKpi.js — อ่านก่อนแก้) ─────────────────────────────────
   1. **pure ล้วน** ห้าม import supabase / ห้ามแตะ DOM — หน้าเป็นคนโหลด ไฟล์นี้เป็นคนตัดสิน
   2. 🔴 **ห้ามตั้งเกณฑ์สีชุดใหม่ในไฟล์นี้เด็ดขาด** — สถานะรายไลน์ต้อง "ยืม" มาจาก
      **metric เจ้าของเรื่องบนผังเอง** (`METRICS.<x>.cat` ใน FactoryMap.jsx) แล้วส่งเข้ามาที่
      `rollupAxis()` เป็น `status` ที่แปลงด้วย `CAT_TO_STATUS` เท่านั้น · เกณฑ์เทียบเป้าที่ไม่มี
      เจ้าของบนผัง (PPE) ให้ใช้ `statusOf()` ของ `obeyaKpi.js`
      เหตุผล = กฎเดียวกับแท็บ 🚦 สุขภาพรวม: *จอเดียวกันคนละแผง ห้ามตอบสถานะเดียวกันคนละสี*
      (เคยเจอมาแล้ว: KPI แถวเดียวกันได้ 3 คำตอบจาก 3 จอ)
   3. 🔴 **กฎความซื่อสัตย์ของจอ (OBEYA-DESIGN §4 · CLAUDE.md)** — หัวข้อที่ข้อมูลไม่พอ/ดูสดไม่ได้
      ต้องคืน `'none'` พร้อม `note` ที่อ่านรู้เรื่อง **ห้ามคืน 0 · ห้ามซ่อนหัวข้อทิ้ง ·
      ห้ามนับ `none` เป็นเขียว** และไฟรวมต้องบอกเสมอว่าตัดสินจากกี่หัวข้อ
   ════════════════════════════════════════════════════════════════════════════════════ */
import { OBEYA_AXES, statusOf, SAFETY_PROXY_NOTE } from './obeyaKpi.js';

/* ── แปลง cat ของผังรวมโรงงาน → สถานะไฟของบอร์ด OBEYA ────────────────────────────────
   ผังมี 7 cat (ดู CAT ใน FactoryMap.jsx) บอร์ดมี 4 สถานะ — การแปลงเป็น "ตารางเดียว" แบบนี้
   ตั้งใจให้เห็นชัดว่าไม่มีการตัดสินใหม่เกิดขึ้นตรงไหนเลย มีแต่การเปลี่ยนชื่อ
   ⚠️ `idle`/`waiting` = ยังไม่เปิดกะ / เปิดกะแต่ยังไม่มีใบงาน ⇒ **ตัดสินไม่ได้ ไม่ใช่ผ่าน**
      (เอาไปนับเป็นเขียวเมื่อไหร่ = จอโกหกว่าโรงงานปกติทั้งที่ยังไม่มีใครเริ่มงาน) */
export const CAT_TO_STATUS = {
  good: 'good',
  ok: 'warn',
  bad: 'bad',
  down: 'bad',     // เครื่องหยุดอยู่ = หลุดเป้าแน่นอน (Andon แดง)
  busy: 'good',    // กำลังทำ PM ตามแผน = งานปกติ ไม่ใช่ปัญหา
  waiting: 'none',
  idle: 'none',
};
export const catToStatus = (cat) => CAT_TO_STATUS[cat] || 'none';

/** ยิ่งมากยิ่งต้องรีบดู — ใช้เรียง drill-down และหา "หัวข้อที่แย่สุด" */
export const STATUS_RANK = { bad: 3, warn: 2, good: 1, none: 0 };

/* ── เป้า PPE ────────────────────────────────────────────────────────────────────────
   แกน S ไม่มี metric เจ้าของเรื่องบนผัง (แท็บ 👷 คน & จุดงาน โชว์ ⚠PPE เป็นข้อความเฉยๆ
   ไม่ได้เอามาตัดสินสี) ⇒ ยืมเกณฑ์จาก `statusOf()` ของ obeyaKpi เทียบเป้า 100%
   = ชุดเดียวกับ `axisSafety()` บนจอ SQDCM (เป้า 100) ห้ามตั้งเลขใหม่ที่นี่ */
export const PPE_TARGET = 100;

/** สถานะ PPE ของไลน์/ทั้งโรงงาน — `present` = คนที่มาทำงาน (ไม่นับคนลา) */
export function ppeStatus({ present = 0, ppeBad = 0 } = {}) {
  const n = Number(present) || 0;
  if (n <= 0) return { status: 'none', pct: null, ok: 0, present: 0, bad: 0 };
  const bad = Math.min(n, Number(ppeBad) || 0);
  const pct = Math.round(((n - bad) / n) * 1000) / 10;
  return { status: statusOf(pct, PPE_TARGET, 'up'), pct, ok: n - bad, present: n, bad };
}

/* ── ลำดับหัวข้อบนบอร์ด ──────────────────────────────────────────────────────────────
   OEE มาก่อนเพราะเป็นแกนกลางที่อธิบาย D กับ C (ตามที่ obeyaKpi.js เขียนไว้) แล้วตามด้วย
   SQDCM **ตามลำดับเดิมห้ามสลับ** (กฎใน obeyaKpi.js) */
export const LIVE_AXIS_OEE = { key: 'OEE', icon: '⚙️', label: 'ประสิทธิผล', en: 'OEE', color: '#60a5fa' };
export const LIVE_AXES = [LIVE_AXIS_OEE, ...OBEYA_AXES];

/** ข้อความของหัวข้อที่ "ไม่มีไลน์ไหนตัดสินได้เลยตอนนี้" — ห้ามปล่อยให้เป็นเขียวหรือ 0 */
export const NO_JUDGE_NOTE =
  'ยังไม่มีไลน์ที่ตัดสินหัวข้อนี้ได้ตอนนี้ (ยังไม่เปิดกะ / ยังไม่มีใบงาน) — ไม่ใช่ว่าผลเป็นศูนย์';

/** ข้อความของหัวข้อที่ดูสดบนผังไม่ได้ (ข้อมูลไม่ได้อยู่บนหน้านี้) */
export const NOT_LIVE_NOTE = (what) =>
  `ดูสดจากผังรวมไม่ได้ — ${what} · ดูย้อนหลังได้ที่ห้อง OBEYA`;

/**
 * รวมสถานะรายไลน์ของหัวข้อหนึ่งเป็นไฟดวงเดียว + รายการไลน์สำหรับ drill-down
 *
 * ⚠️ ไฟของหัวข้อ = **ไลน์ที่แย่ที่สุด** ไม่ใช่ค่าเฉลี่ย — เจตนาของ Andon คือ
 *    "มีไลน์เดียวแดงก็ต้องเห็น" · ตัวเลขถ่วงเฉลี่ยกลบปัญหารายไลน์เสมอ
 *    (จำนวนไลน์แต่ละสีอยู่ใน `counts` ให้จอโชว์กำกับ จะได้ไม่เข้าใจผิดว่าแดงทั้งโรงงาน)
 *
 * @param {object}   p
 * @param {string}   p.key      คีย์หัวข้อ (OEE/S/Q/D/C/M)
 * @param {Array}    p.rows     [{ name, status, text, val }] — status ต้องผ่าน catToStatus มาแล้ว
 * @param {boolean} [p.live]    false = หัวข้อนี้ดูสดไม่ได้ (ไฟเทาเสมอ)
 * @param {string}  [p.note]    คำอธิบายที่ต้องขึ้นบนจอ (ข้อมูลไม่ครบ/เป็นตัวแทน/ดูสดไม่ได้)
 * @param {string}  [p.value]   ตัวเลขสรุปทั้งโรงงานที่จอเอาไปโชว์ (null = ยังไม่มี ห้ามใส่ 0)
 */
export function rollupAxis({ key, rows = [], live = true, note = null, value = null, sub = null } = {}) {
  const counts = { good: 0, warn: 0, bad: 0, none: 0 };
  rows.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
  const judged = counts.good + counts.warn + counts.bad;
  const status = !live ? 'none'
    : counts.bad ? 'bad'
    : counts.warn ? 'warn'
    : counts.good ? 'good'
    : 'none';
  const problems = rows
    .filter(r => r.status === 'bad' || r.status === 'warn')
    .sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status]
      || String(a.name).localeCompare(String(b.name)));
  return {
    key, live, status, counts, judged, rows, problems,
    total: rows.length,
    value: live ? value : null,
    sub: live ? sub : null,
    note: note || (live && judged === 0 ? NO_JUDGE_NOTE : null),
  };
}

/**
 * ไฟรวมของบอร์ด — 🔴 ต้องบอกเสมอว่า "ตัดสินจากกี่หัวข้อ"
 * (กฎความซื่อสัตย์: ไฟเขียวที่ตัดสินจาก 2/6 หัวข้อ ไม่ใช่ไฟเขียวเดียวกับ 6/6)
 */
export function boardOverall(axes = []) {
  const judged = axes.filter(a => a.status !== 'none');
  const status = judged.some(a => a.status === 'bad') ? 'bad'
    : judged.some(a => a.status === 'warn') ? 'warn'
    : judged.length ? 'good'
    : 'none';
  const blind = axes.length - judged.length;
  return {
    status,
    judged: judged.length,
    total: axes.length,
    note: `ตัดสินจาก ${judged.length}/${axes.length} หัวข้อ`
      + (blind ? ` · อีก ${blind} หัวข้อยังตัดสินไม่ได้ (เทา)` : ''),
  };
}

/** ข้อความกำกับแกน S — re-export ให้หน้าเรียกที่เดียว ไม่ต้องรู้ว่ามาจาก obeyaKpi */
export { SAFETY_PROXY_NOTE };
