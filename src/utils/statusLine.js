import { tr } from './i18n.js';
/* ══ 🗣 statusLine — "ประโยคสรุปสถานะ" ใต้ชื่อหน้า dashboard (2026-11-18 · user: ก๊อปจาก ERP ที่เห็น) ══════
   ต้นแบบ: "Good afternoon, Noor. 5 operations on the floor, 2 shipments on the road … 1 work order needs a look."
   = เล่าสถานะเป็นภาษาคน แล้วชี้ **สิ่งเดียวที่ต้องดูก่อน** — ไม่ใช่คำอธิบายหน้า

   กติกา (กฎความซื่อสัตย์ของจอ):
   · ค่าที่ยังไม่รู้ (null) **ไม่ถูกเล่าเป็น 0** — นับแยกเป็น "ยังไม่มีข้อมูล N ช่อง"
   · "ต้องดู" เลือกจาก tone: bad ก่อน แล้ว warn · ไม่มี = "ยังไม่มีอะไรต้องรีบดู" · ถ้าทุกช่องยังไม่รู้ = ไม่พูดว่าปกติ
   · ทักทายตามชั่วโมงของ `now` (ต้องส่งเข้ามา — เทสตรึงเวลาได้ · ห้ามอ่านนาฬิกาเอง)
   · ข้อความเป็นไทยที่จุดนี้ · หน้าแปลผ่าน tr() ทีละท่อนเองถ้าต้องการ (ตัวเลข/ชื่อคนไม่แปล)

   items = [{ label, value, unit, tone: 'good'|'ok'|'warn'|'bad'|'none'|undefined, need }]
     need = ข้อความ "สิ่งที่ต้องทำ" ของช่องนั้น (ถ้าไม่ส่ง ใช้ label)
   ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

const fmt = (v) => (typeof v === 'number' ? v.toLocaleString() : String(v));

export function greetingWord(now) {
  // ชั่วโมงตามเวลาไทยเสมอ — ห้ามพึ่ง timezone เครื่อง (CLAUDE.md §Date/Time) · parse ไม่ได้ = ทักทายกลางๆ
  const dt = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(dt.getTime())) return 'สวัสดี';
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', hour: 'numeric', hour12: false }).format(dt)) % 24;
  if (h >= 5 && h < 12) return tr("สวัสดีตอนเช้า");
  if (h >= 12 && h < 17) return 'สวัสดีตอนบ่าย';
  if (h >= 17 && h < 21) return 'สวัสดีตอนเย็น';
  return 'สวัสดี';
}

export function buildStatusLine(items = [], { now, name, max = 4 } = {}) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const known = list.filter(it => it.value != null && it.value !== '');
  const unknown = list.length - known.length;
  const parts = [];
  if (now) parts.push(`${greetingWord(now)}${name ? ` คุณ${name}` : ''}`);
  const facts = known.slice(0, max).map(it => `${it.label} ${fmt(it.value)}${it.unit ? ` ${it.unit}` : ''}`);
  if (facts.length) parts.push(facts.join(' · '));
  if (unknown > 0) parts.push(`ยังไม่มีข้อมูล ${unknown} ช่อง`);
  const bad = known.find(it => it.tone === 'bad');
  const warn = known.find(it => it.tone === 'warn');
  const hit = bad || warn;
  if (hit) parts.push(`⚠ ต้องดู: ${hit.need || hit.label}`);
  else if (known.length) parts.push('ยังไม่มีอะไรต้องรีบดู');
  return { text: parts.join(' — '), focus: hit ? (hit.need || hit.label) : null, tone: bad ? 'bad' : warn ? 'warn' : known.length ? 'ok' : 'none', unknown };
}
