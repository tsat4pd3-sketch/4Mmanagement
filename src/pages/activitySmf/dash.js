/* ══ 🏭 Smart Factory Dashboard — สูตรภาพรวมโครงการ (ยกกติกาจากเว็บ TSAT4 Activity "SMF" 28/11) ══
   ไฟล์ข้อมูลล้วน · แผนงาน 2 ชั้นใช้สูตรเดียวกับ 5S (`activity5s/dash.js`: derive · planStatus · taskTree)
   · โครงการ "วัดตามแผนงาน" = % ถ่วงด้วยจำนวนวันของข้อหลักในโครงการ (ข้อหลักที่มีข้อย่อย = คิดจากข้อย่อย)
   · โครงการ "วัดตามจำนวน" = ข้อหลักที่เสร็จ 100% ÷ เป้าจำนวน (กติกาเว็บเดิม)
   · ไม่มีแผน = `null` (จอเขียน "ยังไม่มีแผนงาน" ห้ามโชว์ 0) · ฟังก์ชันที่ใช้วันนี้รับ `today` เป็นพารามิเตอร์ */
import { planStatus, taskTree } from '../activity5s/dash.js';

const days = (s, e) => Math.round((Date.parse(e) - Date.parse(s)) / 86400000) + 1;

/** @returns {{ code, name, targetType, targetCount, heads, done, overdue, progress:number|null, members:number }[]} */
export function projectSummary({ projects, tasks, team, today }) {
  const tree = taskTree(tasks);
  return projects.filter(p => p.status === 'Active').map(p => {
    const mine = tree.filter(t => t.row.unit === p.code);
    const rows = mine.map(t => t.row);
    const all = mine.flatMap(t => [t.row, ...t.kids]);
    const done = rows.filter(r => Number(r.progress) >= 100).length;
    const overdue = all.filter(r => planStatus(r, today).code === 'overdue').length;
    let progress = null;
    if (p.target_type === 'count') {
      progress = p.target_count > 0 ? Math.min(100, Math.round((done / p.target_count) * 100)) : null;
    } else {
      const dated = rows.filter(r => r.start_date && r.end_date);
      if (dated.length) {
        const total = dated.reduce((s, r) => s + days(r.start_date, r.end_date), 0);
        progress = Math.round(dated.reduce((s, r) => s + days(r.start_date, r.end_date) * Number(r.progress || 0), 0) / total);
      } else if (rows.length) {
        progress = Math.round(rows.reduce((s, r) => s + Number(r.progress || 0), 0) / rows.length);
      }
    }
    const members = new Set(team.filter(m => m.status === 'Active' && m.unit === p.code).map(m => m.employee_code)).size;
    return { code: p.code, name: p.name, targetType: p.target_type, targetCount: p.target_count, targetName: p.target_name, unit: p.unit, teamType: p.team_type, heads: rows.length, done, overdue, progress, members };
  });
}

/** ระดับสีของแถบความคืบหน้า (กติกาเว็บเดิม): < 50 แดง · 50–99 เหลือง · 100 เขียว · ไม่มีข้อมูล = เทา */
export const progressTone = (p) => (p == null ? 'muted' : p >= 100 ? 'green' : p >= 50 ? 'amber' : 'red');
