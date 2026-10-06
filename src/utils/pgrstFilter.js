/* ══ ตัวช่วยประกอบตัวกรอง `.or()` ของ PostgREST จากคำที่คนพิมพ์ (QC 05/10) ═════════════════
   `.or('a.ilike.%x%,b.ilike.%x%')` แยกเงื่อนไขด้วย `,` และจัดกลุ่มด้วย `( )`
   ⇒ คำค้นที่มี `,` `(` `)` (เช่นชื่อชิ้นงาน "BRKT (RH), LOWER") = คิวรีพัง/ตีความผิดเงียบ
   ทางแก้ตามเอกสาร PostgREST: ห่อค่าด้วยเครื่องหมายคำพูด `"…"` แล้ว escape `\` กับ `"` ข้างใน
   ไฟล์นี้ pure — เทสได้ตรง · จุดใหม่ที่เอาคำที่คนพิมพ์ไปใส่ `.or()` ให้เรียกตัวนี้ */

/** ค่าหนึ่งค่าที่ปลอดภัยสำหรับใส่ใน `.or()` — ห่อ `"…"` เสมอ */
export function orValue(v) {
  return `"${String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** `col1.ilike."%term%",col2.ilike."%term%"` — คำว่าง = '' (ผู้เรียกไม่ต้องใส่ .or) */
export function orIlike(cols, term) {
  const t = String(term ?? '').trim();
  if (!t) return '';
  const v = orValue(`%${t}%`);
  return (cols || []).map(c => `${c}.ilike.${v}`).join(',');
}
