import { useState } from 'react';

/**
 * ⓘ InfoMore — พับคำอธิบายยาวไว้หลังปุ่มเล็ก ๆ
 *
 * ที่มา (user 2026-08-21): *"รายละเอียดที่อธิบายเยอะๆ เป็น hardcode ให้ใช้เครื่องหมาย
 * เพื่ออ่านเพิ่ม"* — หลายหน้าสะสมคำอธิบายจนกลายเป็นกำแพงข้อความคร่อม UI ที่ใช้งานจริง
 * (เคสต้นเรื่อง: การ์ด TEEP ใน /oee-analytics โต 7 บรรทัดจนตัวเลขจริงจมหาย)
 *
 * ⚠️ กฎการใช้ — สิ่งที่ **ห้าม** เอามาพับ:
 *   - ตัวเลข/ที่มาของสูตร (ตัวตั้ง ÷ ตัวหาร = ผล) — คนต้องตรวจได้ทันทีไม่ต้องกด
 *   - คำเตือนสถานะจริง (⚠️ ข้อมูลไม่ครบ · โหลดไม่สำเร็จ · ยังไม่ apply migration)
 *   - ป้ายกำกับที่กันการอ้างเกินจริง (🧪 MOCKUP · "เติมอัตโนมัติครอบแค่ N ข้อ" · ReadOnlyNote)
 *   → พวกนี้ถ้าซ่อน = กลับไปผิดเงียบ ซึ่งเป็นสิ่งที่โปรเจคนี้ห้ามที่สุด
 *   สิ่งที่ **ควร** พับ = วิธีใช้ / เหตุผลเบื้องหลัง / ข้อควรระวังที่อ่านรอบเดียวก็พอ
 *
 * 🚫 **ห้ามใช้กับฝั่งเอกสาร/รายงานทุกกรณี** (คำสั่ง user 2026-08-21 "ยกเว้นพวกรายงานนะ")
 *   — บนกระดาษกดปุ่มไม่ได้ ข้อความที่พับจะหายจากใบพิมพ์โดยไม่มีใครรู้ และหมายเหตุ/legend บนใบ
 *   เป็นส่วนหนึ่งของเอกสารควบคุมที่ทะเบียน `doc_forms` คุมอยู่
 *   ครอบ: `src/lib/*Print.js` / `*ExportExcel.js` / pptx · หน้าที่ผลลัพธ์คือตัวเอกสาร
 *   (/report, /skills-report, ScrapReport, OjtTraining, LPA, QualityBins, VSM เอกสาร, PEDocs, BbsCheck)
 *   · ส่วนที่เป็น preview ของสิ่งที่จะพิมพ์ · ดู UI-CONVENTIONS §6.10
 *
 * ⚠️ ใช้ "กดเปิด" ไม่ใช่ hover tooltip — จอสัมผัส/จอ TV ไม่มีเมาส์ (UI-CONVENTIONS §6)
 *    `title=` ใช้ได้เฉพาะรายละเอียดที่ขาดไปก็ยังอ่านรู้เรื่อง
 *
 * ใช้:
 *   <InfoMore lead="เลือกได้หลายส่วนงาน">ข้อความยาว…</InfoMore>
 *   <InfoMore label="วิธีใช้" id="cal_help">ข้อความยาว…</InfoMore>   // id = จำสถานะเปิด/ปิด
 */

/** เครื่องหมายเปิดอ่านเพิ่ม — แก้ที่นี่ที่เดียวทั้งระบบ
 *  ⚠️ ห้ามใช้ ! / ⚠️ — ในระบบนี้สัญลักษณ์เตือนแปลว่า "ผิดปกติ ต้องไปแก้" (Andon)
 *     เอามาใช้กับข้อความอธิบายเฉยๆ คนหน้างานจะเข้าใจผิดว่ามีปัญหา */
export const MORE_MARK = 'ⓘ';

const KEY = (id) => `infomore_${id}`;

export default function InfoMore({
  lead,                 // ข้อความสั้นที่เห็นตลอด (ไม่ใส่ก็ได้ — จะเหลือแค่ปุ่ม)
  children,             // เนื้อหาที่พับไว้
  label = 'อ่านเพิ่ม',
  id,                   // ใส่แล้วจำสถานะเปิด/ปิดต่อเครื่อง (localStorage)
  tone = 'muted',       // muted | info | warn — สีกล่องตอนกาง
  size = 11.5,
  style,
}) {
  const [open, setOpen] = useState(() => {
    if (!id) return false;
    try { return localStorage.getItem(KEY(id)) === '1'; } catch { return false; }
  });

  const toggle = () => {
    setOpen(o => {
      const n = !o;
      if (id) { try { localStorage.setItem(KEY(id), n ? '1' : '0'); } catch { /* โหมดส่วนตัว/บล็อก storage */ } }
      return n;
    });
  };

  const box = {
    muted: { bg: 'var(--bg3)', bd: 'var(--border)' },
    info: { bg: 'rgba(59,130,246,0.08)', bd: 'rgba(59,130,246,0.45)' },
    warn: { bg: 'rgba(245,158,11,0.1)', bd: '#f59e0b' },
  }[tone] || { bg: 'var(--bg3)', bd: 'var(--border)' };

  return (
    <div data-infomore="1" style={{ fontSize: size, color: 'var(--text2)', lineHeight: 1.65, ...style }}>
      {lead}
      <button type="button" onClick={toggle}
        aria-expanded={open}
        style={{
          marginLeft: lead ? 6 : 0, padding: '1px 7px', borderRadius: 'var(--r-md)', cursor: 'pointer',
          border: `1px solid var(--border2)`, background: 'var(--bg3)',
          color: 'var(--muted)', fontSize: Math.max(11, size - 1.5), fontWeight: 700,
          whiteSpace: 'nowrap', verticalAlign: 'middle',
        }}>
        {open ? '▴ ย่อ' : `${MORE_MARK} ${label}`}
      </button>
      {open && (
        <div style={{
          marginTop: 5, padding: '7px 10px', borderRadius: 8,
          background: box.bg, border: `1px solid ${box.bd}`, color: 'var(--text2)',
        }}>{children}</div>
      )}
    </div>
  );
}

/* ── 💬 Why — "สถานะสั้น + วิธีแก้ซ่อนไว้" (2026-11-05 · คำสั่ง user "text ที่เป็น comment ต้องเป็น tooltip ไม่ใช่โชว์ทุกอย่าง รกมาก")
   บรรทัดสถานะในการ์ดเคยเขียน "⚠ ไลน์ยังไม่ตั้ง cost center — กรอกที่หน้าจัดการไลน์ (ไลน์แม่ ตกทอดถึงลูก)" ซ้ำทุกใบ ⇒ การ์ด 3 ใบ = 15 บรรทัดอธิบาย
   กติกา: บนจอเหลือ **สถานะ** (ก่อน " — ") · **วิธีแก้/เหตุผล** (หลัง " — ") อยู่ใน title= + กดเปิดได้ (จอสัมผัสไม่มี hover)
   · ไม่ใช่การพับคำเตือน — สถานะยังเห็นเสมอ (ติด data-warn ให้ textsweep รู้ว่าเป็นของสั้นโดยตั้งใจ)
   ใช้:  <Why msg="ไลน์ยังไม่ตั้ง cost center — กรอกที่หน้าจัดการไลน์" />   // แยกเองที่ " — " ตัวแรก
         <Why what="ยังไม่ได้ตั้งเป้าหมาย" how="กด แก้ไข แล้วกรอกช่อง “เป้าหมาย”" tone="warn" /> */
const WHY_TONE = { warn: 'var(--amber)', bad: 'var(--red)', info: 'var(--blue)', muted: 'var(--muted)' };
export const splitWhy = (msg) => {
  const s = String(msg ?? ''); const i = s.indexOf(' — ');
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 3)];
};
export function Why({ msg, what, how, tone = 'warn', size = 11, style }) {
  const [w, h] = msg != null ? splitWhy(msg) : [what, how];
  const [open, setOpen] = useState(false);
  const c = WHY_TONE[tone] || WHY_TONE.warn;
  return (
    <div data-warn="1" style={{ fontSize: size, color: c, lineHeight: 1.5, ...style }}>
      <span title={h || undefined} style={{ cursor: h ? 'help' : 'default', borderBottom: h ? '1px dotted currentColor' : 'none' }}
        onClick={() => h && setOpen(o => !o)}>{w}</span>
      {h && <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} title={h}
        style={{ marginLeft: 5, padding: 0, border: 'none', background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: size, lineHeight: 1 }}>{MORE_MARK}</button>}
      {open && h && <div style={{ color: 'var(--text2)', marginTop: 2 }}>{h}</div>}
    </div>
  );
}
