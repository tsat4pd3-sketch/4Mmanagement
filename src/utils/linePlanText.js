/* 💬 ข้อความ popup ยืนยัน "แจ้งสโตร์" — ตอนเปิดใบผลิต + ตอนกดขอเบิกเอง (2026-11-05 · คำสั่ง user)
   user: *"popup นี้โอเค แต่ไม่มีหน่วยบอก คนงง · ควรขึ้นตอนเปิด order ด้วย และจะไปดึงเหล็กด้วย ·
          รายละเอียดที่แจ้งบอกด้วยว่าของค้างเท่าไหร่ มีมั้ย สะสมอีกเท่าไหร่ถึงจะแจ้ง"*
   ป้อนด้วย rows จาก `syncLineOrderDemand({ dryRun:true })` (ผล `planLineRequest` ต่อพาร์ท + `uom`) — pure (มีเทส) */
import { qtyUnit } from './coilUom.js';

const f = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('th-TH', { maximumFractionDigits: 3 }));

/** บรรทัดผลลัพธ์ต่อพาร์ท — ต้องบอก "ทำอะไร" และถ้าไม่แจ้ง "ขาดอีกเท่าไหร่ถึงจะแจ้ง" */
export function planActionText(r) {
  const u = qtyUnit(r.uom);
  switch (r.action) {
    case 'insert': return `✅ แจ้งสโตร์ ${f(r.qty)} ${u}${r.packs ? ` (${r.packs} กล่อง × ${f(r.pkg)})` : r.coil ? ' (จ่ายเป็นม้วน — สโตร์กรอกน้ำหนักจริง)' : ''}${r.carry > 0 ? ` · ทด ${f(r.carry)} ${u} รอบหน้า` : ''}`;
    case 'raise': return `✅ เพิ่มยอดใบที่รอหยิบอยู่ ${f(r.pending)} → ${f(r.qty)} ${u}`;
    case 'wait': return `⏳ ยังไม่แจ้ง — สะสมอีก ${f(Math.max(0, Math.round((r.pkg - r.short) * 1e3) / 1e3))} ${u} ให้ครบ 1 กล่อง (${f(r.pkg)} ${u})`;
    case 'no_pkg': return '📦 ยังไม่แจ้ง — พาร์ทนี้ยังไม่ตั้งขนาดกล่อง (packing std)';
    default: return r.pending ? `☑️ มีใบรอหยิบอยู่แล้ว ${f(r.pending)} ${u} — พอแล้ว` : '☑️ ของหน้าไลน์พอ — ไม่ต้องเบิก';
  }
}

/** บรรทัดรายละเอียดต่อพาร์ท: ต้องใช้ · หน้าไลน์มี · ขาด */
export function planRowText(r) {
  const u = qtyUnit(r.uom);
  const name = r.part_name ? `${r.part_name} · ` : '';
  return `• ${name}MAT ${r.mat_no}${r.coil ? ' 🧲 coil' : ''}\n   ต้องใช้ ${f(r.need)} ${u} · หน้าไลน์มี ${f(r.base)} ${u} · ขาด ${f(r.short)} ${u}\n   ${planActionText(r)}`;
}

/**
 * @param rows ผล dryRun
 * @param {{ title: string, focus?: string[], max?: number }} o  focus = MAT ที่เกี่ยวกับการกดครั้งนี้ (ขึ้นก่อน)
 * @returns {{ text: string, sendCount: number }}
 */
export function planConfirmText(rows = [], { title = '', focus = [], max = 12 } = {}) {
  const fs = new Set((focus || []).map(m => String(m).trim()));
  const sorted = [...rows].sort((a, b) => (fs.has(b.mat_no) ? 1 : 0) - (fs.has(a.mat_no) ? 1 : 0));
  const send = rows.filter(r => r.action === 'insert' || r.action === 'raise').length;
  const shown = sorted.slice(0, max).map(planRowText);
  const more = sorted.length > max ? `\n… อีก ${sorted.length - max} พาร์ท (ดูครบที่แผง 📦 เรียกชิ้นส่วนจากสโตร์)` : '';
  const tail = send ? `\n\nแจ้งสโตร์ ${send} รายการ?` : '\n\nตอนนี้ยังไม่มีรายการที่ต้องแจ้งสโตร์';
  return { text: `${title}\n(ความต้องการรวมของใบผลิตที่เปิดอยู่ทั้งไลน์ หักของหน้าไลน์แล้ว)\n\n${shown.join('\n\n')}${more}${tail}`, sendCount: send };
}
