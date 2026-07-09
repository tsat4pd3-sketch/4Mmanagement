import { supabaseDR } from '../supabaseClient';

// ─── Downtime Alarm ──────────────────────────────────────────────
// เครื่องจักรถือว่า "กำลัง Alarm" เมื่อมี downtime ที่ยังไม่ปิดรายการ
// (ไม่มี ended_at และไม่มี duration_min) = เครื่องยังหยุดอยู่จริง เท่านั้น
// ปิดรายการเมื่อไหร่ต้องดับทันที — เคยมีกฎ "เพิ่งบันทึกภายใน 10 นาทีให้กระพริบต่อ"
// แต่ทำให้เครื่องที่ซ่อมเสร็จแล้วยังกระพริบค้าง คนหน้างานสับสน จึงถอดออก
export function isAlarmingDT(d) {
  return !d.ended_at && d.duration_min == null;
}

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

  const list = (dts || [])
    .filter(isAlarmingDT)
    .map(d => ({ ...d, line_name: sessById[d.session_id]?.line_name, shift: sessById[d.session_id]?.shift }));

  const byMachine = {}, byLine = {};
  list.forEach(d => {
    if (d.machine_no) (byMachine[d.machine_no] ||= []).push(d);
    if (d.line_name)  (byLine[d.line_name]     ||= []).push(d);
  });
  return { byMachine, byLine, list };
}

// นาทีที่ผ่านไปตั้งแต่ downtime เริ่ม (ใช้โชว์ "หยุดมาแล้ว X นาที")
export function dtElapsedMin(d, nowMs = Date.now()) {
  const start = d.started_at || d.created_at;
  if (!start) return null;
  return Math.max(0, Math.round((nowMs - new Date(start).getTime()) / 60000));
}
