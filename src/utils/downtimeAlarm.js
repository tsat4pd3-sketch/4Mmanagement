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
export { isOpenDT, isPlannedDT, isAlarmingDT, dtElapsedMin, fmtDtElapsed, isOverDtThreshold, DT_OPEN_ALERT_MIN_DEFAULT } from './downtimeRules';

/* เกณฑ์ "หยุดเกินกี่นาทีถึงเตือน" — ตั้งที่ /notification-config (dt_alert_config ฝั่ง DR แถวเดียว)
   cache ระดับ module: จอที่ใช้ค่านี้เป็นจอเปิดค้างทั้งวัน ไม่ต้องยิงซ้ำ (กฎ egress)
   โหลดไม่ได้ = ค่า default 15 — **ห้ามคืน null แล้วให้จอเงียบ** (เกณฑ์หายไม่ใช่เหตุให้ไม่เตือน) */
let _dtAlertMin = null, _dtAlertPromise = null;
export function dtAlertMinSync() { return _dtAlertMin ?? DT_OPEN_ALERT_MIN_DEFAULT_LOCAL; }
const DT_OPEN_ALERT_MIN_DEFAULT_LOCAL = 15;
export function loadDtAlertMin() {
  if (_dtAlertMin != null) return Promise.resolve(_dtAlertMin);
  if (!_dtAlertPromise) {
    _dtAlertPromise = supabaseDR.from('dt_alert_config').select('open_alert_min').eq('id', 1).maybeSingle()
      .then(({ data }) => { _dtAlertMin = Math.max(1, Number(data?.open_alert_min ?? DT_OPEN_ALERT_MIN_DEFAULT_LOCAL)); return _dtAlertMin; })
      .catch(() => DT_OPEN_ALERT_MIN_DEFAULT_LOCAL);
  }
  return _dtAlertPromise;
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
  const empty = { byMachine: {}, byLine: {}, list: [], plannedList: [], plannedByLine: {} };
  let q = supabaseDR.from('production_sessions')
    .select('id, line_name, shift, status')
    .eq('work_date', getWorkDate())
    .in('status', ['open', 'pending_close']);
  if (lineNames?.length) q = q.in('line_name', lineNames);
  const { data: sessions, error: sErr } = await q;
  // ⚠️ ห้ามยุบ "คิวรีพัง" ให้กลายเป็น "ไม่มีเครื่องหยุด" — จอที่เรียก (DeptHub · Dashboard แผง Andon
  //    · Management) จะขึ้นเขียวว่าปกติดี ทั้งที่ความจริงคือ "ไม่รู้" (กฎ CLAUDE.md: ห้ามล้มเหลวเงียบ)
  //    คืน error มาให้ผู้เรียกตัดสินใจแสดงผลเอง
  if (sErr) return { ...empty, error: sErr.message };
  if (!sessions?.length) return empty;

  const sessById = Object.fromEntries(sessions.map(s => [s.id, s]));
  const { data: dts, error: dErr } = await supabaseDR.from('downtime_logs')
    .select('id, session_id, machine_no, mat_no, description, started_at, ended_at, duration_min, created_at, dr_downtime_types(name_th, category, color)')
    .in('session_id', sessions.map(s => s.id));
  if (dErr) return { ...empty, error: dErr.message };

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
