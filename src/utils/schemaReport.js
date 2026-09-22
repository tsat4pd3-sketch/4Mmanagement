/* ══ schemaReport — ข้อความ "แจ้งบัคให้ตรงจุด" จากข้อมูลโครงสร้างตาราง ════════════════
   (2026-09-22 · ใช้โดยหน้า /schema — `src/pages/SchemaMap.jsx`)

   เหตุผลที่แยกออกมาเป็น util: หน้า /schema import virtual module (`virtual:schema-usage`)
   ซึ่ง node รันตรงๆ ไม่ได้ ⇒ ตัวประกอบข้อความอยู่ในหน้า = เขียนเทสไม่ได้
   ที่นี่เป็น pure function ล้วน มีเทสใน `src/utils/__tests__/schemaReport.test.mjs`

   รูปแบบที่ได้ ตั้งใจให้ "วางในแชท/กล่องแจ้งปัญหาแล้วคนแก้ทำงานต่อได้ทันที":
   ตาราง + โปรเจคไหน (2 project ชื่อตารางคล้ายกัน — เคยรัน SQL ผิดฝั่งมาแล้ว) + PK + FK + หน้าที่ใช้
   ═══════════════════════════════════════════════════════════════════════════════════════ */

const list = (a) => (Array.isArray(a) ? a.filter(Boolean) : []);

/** `col → ตาราง.col` อ่านง่ายๆ 1 บรรทัดต่อ 1 FK */
export function fkLine(fk) {
  if (!fk) return '';
  return `${list(fk.c).join('+')} → ${fk.rt}.${list(fk.rc).join('+')}`;
}

/** สรุปตารางแบบสั้น (ใช้ทั้งปุ่มคัดลอก และตัวตั้งต้นของกล่องแจ้งปัญหา) */
export function tableSummaryText({ table, projectLabel, projectId, detail, pages = [], url = '' } = {}) {
  if (!table) return '';
  const d = detail || {};
  const lines = [];
  lines.push(`ตาราง: ${table}`);
  lines.push(`ฐานข้อมูล: ${projectLabel || '-'}${projectId ? ` (${projectId})` : ''}`);
  if (d.k === 'v' || d.k === 'm') lines.push('ชนิด: VIEW (ไม่ใช่ตารางจริง — แก้ข้อมูลตรงๆ ไม่ได้)');
  lines.push(`คีย์หลัก (PK): ${list(d.pk).join(', ') || '— ไม่มี'}`);

  const fks = list(d.fks);
  lines.push(`ชี้ออกไปหา (FK): ${fks.length ? fks.map(fkLine).join(' · ') : '— ไม่มี'}`);

  const refs = list(d.refs);
  if (refs.length) lines.push(`ตารางที่ชี้มาหา: ${refs.map(r => `${r.t}.${list(r.c).join('+')}`).join(' · ')}`);

  if (d.rls === false) lines.push('RLS: ปิดอยู่');
  const pageList = list(pages);
  if (pageList.length) lines.push(`หน้าที่ใช้ตารางนี้: ${pageList.join(' · ')}`);
  if (url) lines.push(`ดูโครงสร้าง: ${url}`);
  return lines.join('\n');
}

/** ข้อความตั้งต้นของกล่อง 💬 แจ้งปัญหา — เว้นช่อง "อาการ" ให้คนกรอกต่อ */
export function bugReportText(opts = {}) {
  const { pagePath, pageLabel } = opts;
  const head = ['🐛 แจ้งปัญหา (สร้างจากหน้า 🗄️ โครงสร้างฐานข้อมูล)'];
  if (pagePath) head.push(`หน้าที่เจอปัญหา: ${pageLabel ? `${pageLabel} ` : ''}${pagePath}`);
  const body = tableSummaryText(opts);
  return `${head.join('\n')}\n${body}\n\nอาการที่เจอ (พิมพ์ต่อตรงนี้):\n- \nทำอะไรอยู่ตอนเจอ:\n- \n`;
}

export default { fkLine, tableSummaryText, bugReportText };
