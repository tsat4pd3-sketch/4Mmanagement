import { supabaseDR } from '../supabaseClient';
import { isOpenDT, isPlannedDT } from './downtimeRules';

// ─── Downtime Alarm ──────────────────────────────────────────────
// เครื่องจักรถือว่า "กำลัง Alarm" เมื่อมี downtime ที่ยังไม่ปิดรายการ
// (ไม่มี ended_at และไม่มี duration_min) = เครื่องยังหยุดอยู่จริง เท่านั้น
// ปิดรายการเมื่อไหร่ต้องดับทันที — เคยมีกฎ "เพิ่งบันทึกภายใน 10 นาทีให้กระพริบต่อ"
// แต่ทำให้เครื่องที่ซ่อมเสร็จแล้วยังกระพริบค้าง คนหน้างานสับสน จึงถอดออก
//
// ⚠️ **หยุดตามแผน (category='planned') ไม่ Andon แดง** (2026-08-04 · คำสั่ง user) —
// นับสต๊อก / ไม่มีแผนผลิต / 5ส ไม่ใช่ความเสียหาย ไม่มีอะไรให้ "ดำเนินการทันที"
// (เคสจริง: SP-88 "นับสต๊อก / ไม่มีแผนผลิต" ค้าง 349 นาที เด้ง ANDON RED ทั้งวัน)
// ยังเห็นได้จาก plannedList/plannedByLine — แสดงแยกแบบสงบ ห้ามซ่อนหาย
//
// นิยาม isOpenDT/isPlannedDT/isAlarmingDT/dtElapsedMin ย้ายไป `./downtimeRules` (pure —
// 2026-08-19 เพื่อให้ lib ที่เทสด้วย node ได้ import โดยไม่ลาก supabaseClient) — re-export
// จากที่นี่ให้ทุก import เดิมใช้ได้เหมือนเดิม · แก้นิยามให้แก้ที่ downtimeRules.js ที่เดียว
export { isOpenDT, isPlannedDT, isAlarmingDT, dtElapsedMin } from './downtimeRules';

// work date เดียวกับกฎทั้งระบบ: ก่อน 08:00 นับเป็นวันก่อนหน้า (กะดึกข้ามวัน)
function getWorkDate() {
  const now = new Date();
  if (now.getHours() < 8) now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// ดึง downtime ที่กำลัง alarm ของวันนี้ จากกะที่ยังไม่ปิด (open / pending_close)
// lineNames = จำกัดเฉพาะไลน์ที่สนใจ (ไม่ส่ง = ทุกไลน์)
// คืน { byMachine: { [machine_no]: [dt] }, byLine: { [line_name]: [dt] }, list: [dt] }
export async function fetchActiveDowntimes(lineNames = null) {
  const empty = { byMachine: {}, byLine: {}, list: [] };
  let q = supabaseDR.from('production_sessions')
    .select('id, line_name, shift, status')
    .eq('work_date', getWorkDate())
    .in('status', ['open', 'pending_close']);
  if (lineNames?.length) q = q.in('line_name', lineNames);
  const { data: sessions } = await q;
  if (!sessions?.length) return empty;

  const sessById = Object.fromEntries(sessions.map(s => [s.id, s]));
  const { data: dts } = await supabaseDR.from('downtime_logs')
    .select('id, session_id, machine_no, mat_no, description, started_at, ended_at, duration_min, created_at, dr_downtime_types(name_th, category, color)')
    .in('session_id', sessions.map(s => s.id));

  const open = (dts || [])
    .filter(isOpenDT)
    .map(d => ({ ...d, line_name: sessById[d.session_id]?.line_name, shift: sessById[d.session_id]?.shift }));
  const list = open.filter(d => !isPlannedDT(d));          // นอกแผน = Andon แดง
  const plannedList = open.filter(isPlannedDT);            // ตามแผน = แสดงแยกแบบสงบ ไม่ alarm

  const byMachine = {}, byLine = {}, plannedByLine = {};
  list.forEach(d => {
    if (d.machine_no) (byMachine[d.machine_no] ||= []).push(d);
    if (d.line_name)  (byLine[d.line_name]     ||= []).push(d);
  });
  plannedList.forEach(d => { if (d.line_name) (plannedByLine[d.line_name] ||= []).push(d); });
  return { byMachine, byLine, list, plannedList, plannedByLine };
}
