/* ══ 📅 แผนงานกิจกรรม — สูตรกลาง (ย้ายจาก activity5s/dash.js 28/11 · ใช้ทุกกิจกรรม: 5S · Smart Factory · กิจกรรมอื่น) ══
   แถว = { act_task, parent_id, sort_no, title, start_date, end_date, progress, done_on, … } (2 ชั้น: ข้อหลัก/ข้อย่อย)
   · ฟังก์ชันที่ใช้ "วันนี้" รับ `today` (YYYY-MM-DD) เป็นพารามิเตอร์ (เทสตรึงค่าได้ · ด่านนาฬิกา +400 วัน) */
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
/* ── แผนงาน (act02_task) ─────────────────────────────────────────────────────────── */
export const daysOf = (s, e) => Math.round((Date.parse(e) - Date.parse(s)) / 86400000) + 1;

/** สถานะเทียบแผน (สูตรเดียวกับ Core): เสร็จ = วันเสร็จเทียบวันจบ · ยังเปิด = % จริงเทียบ % ที่ควรได้ถึงวันนี้ (±10) */
export function planStatus(row, today) {
  const s = row.start_date, e = row.end_date, p = num(row.progress);
  if (!s || !e) return { code: 'none', text: '' };
  if (p >= 100) {
    if (!row.done_on) return { code: 'done', text: 'เสร็จแล้ว' };
    const late = daysOf(e, row.done_on) - 1;
    if (late < 0) return { code: 'early', text: `เสร็จก่อนแผน ${-late} วัน` };
    return late === 0 ? { code: 'done', text: 'เสร็จตามแผน' } : { code: 'late', text: `เสร็จช้า ${late} วัน` };
  }
  if (today > e) return { code: 'overdue', text: `เลยกำหนด ${daysOf(e, today) - 1} วัน` };
  if (today < s) return { code: 'waiting', text: 'ยังไม่ถึงกำหนด' };
  const expected = Math.round((daysOf(s, today) / daysOf(s, e)) * 100);
  if (p < expected - 10) return { code: 'behind', text: `ช้ากว่าแผน (ควรได้ ${expected}%)` };
  if (p > expected + 10) return { code: 'ahead', text: `เร็วกว่าแผน (แผน ${expected}%)` };
  return { code: 'ontrack', text: `ตามแผน (แผน ${expected}%)` };
}

/** ข้อหลักที่มีข้อย่อย: ช่วงวันคลุมข้อย่อย · % ถ่วงด้วยจำนวนวัน · เสร็จเมื่อข้อย่อยเสร็จครบ */
export function derive(parent, kids) {
  const list = kids.filter(k => k.start_date && k.end_date);
  if (!list.length) return parent;
  const total = list.reduce((s, k) => s + daysOf(k.start_date, k.end_date), 0);
  return {
    ...parent,
    start_date: list.map(k => k.start_date).sort()[0],
    end_date: list.map(k => k.end_date).sort().at(-1),
    progress: Math.round(list.reduce((s, k) => s + daysOf(k.start_date, k.end_date) * num(k.progress), 0) / total),
    done_on: list.every(k => num(k.progress) >= 100 && k.done_on) ? list.map(k => k.done_on).sort().at(-1) : null,
  };
}

/** แผนงานเรียงเป็นต้นไม้ 2 ชั้น: [{ row (ข้อหลักที่คิดจากข้อย่อยแล้ว), kids }] */
export function taskTree(rows) {
  const heads = rows.filter(r => !r.parent_id).sort((a, b) => num(a.sort_no) - num(b.sort_no));
  return heads.map(h => {
    const kids = rows.filter(r => r.parent_id === h.act_task).sort((a, b) => num(a.sort_no) - num(b.sort_no));
    return { row: derive(h, kids), kids };
  });
}

