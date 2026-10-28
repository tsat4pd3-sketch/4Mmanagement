/* 👁 "ขอบเขตที่เห็น" ของหน้า /qa (ภาพรวม · NCR · เคลมลูกค้า · SPC ฯลฯ) — ตัวเดียวทุกแท็บ (2026-10-19)
   ห่อ `scopedLineNames()` (utils/sectionScope.js — ตัวกลางของทั้งระบบ) ให้คืนทั้งแถวไลน์และชุดชื่อ
   🔴 เดิมหน้า /qa เขียนกฎเอง 3 ชุด ⇒ ส่วนงานที่ไม่มีไลน์ผลิต (QA · Planning&Store) ได้ 0 ไลน์
      ⇒ NCR/เคลม/ภาพรวม/ตัวเลือกไลน์ว่างทั้งหน้า ทั้งที่มีข้อมูล (หน้างานแจ้ง 19/10 · 9 บัญชีฝั่ง QA โดน)
      ตัวกลางคืน null (= ทั้งโรงงาน) ในเคสนี้อยู่แล้ว · **ห้ามกลับไปเขียนกฎขอบเขตเองในหน้า**
   · นี่คือ "เห็น" เท่านั้น — การแก้ยังผ่าน RLS (`qa:record`/`qa:manage`) + `writeScope.js` เหมือนเดิม
   คืน `names` = Set ชื่อไลน์ที่เห็น หรือ null = ไม่จำกัด */
import { scopedLineNames } from './sectionScope.js';

export function qaViewScope(allLines = [], { role, lineId, sections, scopeIdx } = {}) {
  /* ส่ง `scopeIdx` ต่อให้ตัวกลาง — ขอบเขตที่เป็นแผนก/ไลน์จึงขยายผ่านผังได้ (22/10) */
  const names = scopedLineNames({ role, lineId, sections: sections || [], lines: allLines, scopeIdx });
  if (!names) return { lines: allLines, names: null };
  const set = new Set(names);
  return { lines: allLines.filter(l => set.has(l.name)), names: set };
}

/* ✍️ "QA ใหญ่สุด" (คำสั่ง user 19/10) — ด่านแก้ข้อมูลคุณภาพ (ชั้น ③ writeScope) ของคนฝ่ายคุณภาพ
   คนที่ **บ้านจริง** (`profiles.section`) เป็นหน่วยที่ไม่เป็นเจ้าของไลน์ผลิตใดเลย (QA = หน่วยสนับสนุน)
   ⇒ แกน "ไลน์ของส่วนงานตัวเอง" ไม่มีความหมาย และงานของเขาคือตรวจ/ตัดสินคุณภาพของ **ทุกไลน์**
   ⇒ บนจอคุณภาพ ถือว่าแก้ได้ทุกไลน์ (`allUnits`) — ตัวเรียกใช้เฉพาะจอที่สิทธิ์ `qa:*` คุมอยู่แล้ว
   · ด่านจริงยังอยู่ที่ RLS (`qa:record`/`qa:manage`) — ตัวนี้แค่ไม่ให้ชั้น ③ บล็อกคนฝ่ายคุณภาพผิดคน
   · หัวหน้าไลน์/ส่วนงานผลิต (บ้านมีไลน์) = เหมือนเดิมทุกอย่าง
   🔴 ทะเบียนไลน์ยังไม่โหลด (`lines` ว่าง) = ไม่ยกสิทธิ์ (กัน fail-open ระหว่างโหลด) */
export function qaWriteCtx(ctx = {}, lines = []) {
  if (ctx.allUnits || !lines?.length || !ctx.section) return ctx;
  const home = String(ctx.section).trim().toLowerCase();
  const ownsLine = lines.some(l => String(l?.section ?? '').trim().toLowerCase() === home);
  return ownsLine ? ctx : { ...ctx, allUnits: true, qaUnit: true };
}
