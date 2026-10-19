/* ══════════════════════════════════════════════════════════════════════════
   👷 linePeopleMap — โหลด "จุดงานบนผัง + คนที่ประจำจุด + ความเหมาะของทักษะ" ของไลน์ (2026-10-16)

   ใช้ที่ `components/LineLensMap.jsx` เลนส์ `people` (กล่องรายละเอียดไลน์บนผังรวม แท็บ 👷 คน)
   — user 16/10: "tab คนก็โชว์ผังไลน์แบบตำแหน่งงานกับคนที่ประจำตำแหน่ง ด้านขวาเป็นรายละเอียดเหมือน tab PM/AM"
   · แหล่งเดียวกับบอร์ด /dashboard: วันนี้ถูกวางจุดไหน = `daily_production_logs.assigned_line` (= id จุดงาน)
     ไม่ถูกวางวันนี้ = ถอยไปจุดประจำ `employee_home_positions` (คนที่ถูกวางวันนี้แล้ว ห้ามโผล่ซ้ำที่จุดประจำ)
   · ความเหมาะ = `skillFit()` (utils/skillFit.js) — จุดที่ไม่ตั้งทักษะ = null ("ยังไม่ตั้ง") ไม่ใช่ 100
   ⚠️ error ทุกคิวรี = throw ให้จอเขียนบอก ห้ามคืนผังว่างเหมือน "ไม่มีคน"
   ══════════════════════════════════════════════════════════════════════════ */
import { supabase } from '../supabaseClient';
import { skillFit, skillMapOf } from '../utils/skillFit';
import { fetchByIds } from '../utils/fetchByIds';

const EMP_COLS = 'id, name, image_url, position, line_id, employee_skills(skill_name, score)';

/**
 * @param {string[]} pointLines  ไลน์ที่จุดงานอยู่บนรูปเดียวกัน
 * @param {string} date          วันงาน YYYY-MM-DD
 * @param {string[]} lineIds     id ของไลน์ในครอบครัว (นับคนที่เช็คชื่อแล้วแต่ยังไม่ถูกวางจุด)
 * @returns {Promise<{ stations:object[], unplaced:object[] }>}
 */
export async function loadLinePeople(pointLines, date, lineIds = []) {
  const names = (pointLines || []).filter(Boolean);
  if (!names.length) return { stations: [], unplaced: [] };
  const { data: ws, error: e0 } = await supabase.from('workstations')
    .select('id, line_name, station_name, pos_top, pos_left, station_requirements(skill_name, min_score)').in('line_name', names);
  if (e0) throw e0;
  const stations = (ws || []).map(w => ({ ...w, reqs: w.station_requirements || [], people: [] }));
  const ids = stations.map(s => String(s.id));
  const byId = Object.fromEntries(stations.map(s => [String(s.id), s]));

  const logCols = `id, is_present, shift, assigned_line, has_helmet, has_boots, has_gloves, employees!inner(${EMP_COLS})`;
  const none = { rows: [], error: null, truncated: false };
  const [lg, hp, loose] = await Promise.all([
    ids.length ? fetchByIds(ids, part => supabase.from('daily_production_logs').select(logCols).eq('work_date', date).in('assigned_line', part)) : none,
    ids.length ? fetchByIds(ids, part => supabase.from('employee_home_positions').select(`employee_id, station_id, employees(${EMP_COLS})`).in('station_id', part), { orderBy: 'employee_id' }) : none,
    lineIds.length
      ? supabase.from('daily_production_logs').select(logCols).eq('work_date', date).is('assigned_line', null)
        .eq('employees.is_active', true).in('employees.line_id', lineIds)
      : { data: [] },
  ]);
  for (const r of [lg, hp]) {
    if (r.error) throw new Error(r.error);
    if (r.truncated) throw new Error('ข้อมูลคนเยอะเกินเพดาน — โหลดได้ไม่ครบ');
  }
  if (loose.error) throw loose.error;
  const logs = lg.rows, homes = hp.rows;

  const attByEmp = {};
  (logs || []).forEach(l => { if (l.employees?.id) attByEmp[l.employees.id] = l; });
  (loose.data || []).forEach(l => { if (l.employees?.id && !attByEmp[l.employees.id]) attByEmp[l.employees.id] = l; });
  const placedToday = new Set((logs || []).map(l => l.employees?.id).filter(Boolean));

  const person = (emp, st, att, source) => {
    const fit = skillFit(st.reqs, skillMapOf(emp.employee_skills));
    return { id: emp.id, name: emp.name, image_url: emp.image_url || null, position: emp.position || null,
      is_present: att ? att.is_present : null, shift: att?.shift || null, source, fit,
      ppeBad: !!att && att.is_present && (att.has_helmet === false || att.has_boots === false || att.has_gloves === false) };
  };
  (homes || []).forEach(h => {
    const st = byId[String(h.station_id)];
    if (!st || !h.employees || placedToday.has(h.employee_id)) return;
    st.people.push(person(h.employees, st, attByEmp[h.employee_id], 'home'));
  });
  (logs || []).forEach(l => {
    const st = byId[String(l.assigned_line)];
    if (!st || !l.employees) return;
    st.people.push(person(l.employees, st, l, 'today'));
  });
  // คนเดียวกันซ้ำในจุดเดียว (เช็คชื่อ 2 แถว/จุดประจำซ้ำ) = แสดงครั้งเดียว · วางจุดวันนี้ชนะจุดประจำ
  stations.forEach(st => {
    const m = new Map();
    st.people.forEach(p => { const o = m.get(p.id); if (!o || (o.source === 'home' && p.source === 'today')) m.set(p.id, p); });
    st.people = [...m.values()];
  });
  const unplaced = (loose.data || []).filter(l => l.is_present && l.employees).map(l => ({ id: l.employees.id, name: l.employees.name, shift: l.shift || null }));
  return { stations, unplaced };
}
