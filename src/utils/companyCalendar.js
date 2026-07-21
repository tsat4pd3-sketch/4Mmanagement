/**
 * Company calendar helpers — shared across workflows that need to know
 * whether a date is a normal working day or an OT-rate holiday.
 * Backed by the `company_calendar` table (work_date, day_type).
 * day_type: 'working' | 'ot15' (หยุด OT*1.5) | 'ot2' (หยุด OT*2)
 */
import { supabase } from '../supabaseClient';

export const DAY_TYPE_META = {
  working: { label: 'วันทำงาน',        color: '#3d3d3d', otMultiplier: 1 },
  ot15:    { label: 'วันหยุด OT×1.5', color: '#f59e0b', otMultiplier: 1.5 },
  ot2:     { label: 'วันหยุด OT×2',   color: '#ef4444', otMultiplier: 2 },
};

let cache = null; // Map<work_date string, day_type>

export async function loadCompanyCalendar(forceRefresh = false) {
  if (cache && !forceRefresh) return cache;
  const { data } = await supabase.from('company_calendar').select('work_date, day_type');
  cache = new Map((data || []).map(r => [r.work_date, r.day_type]));
  return cache;
}

/** ใช้แบบ sync หลังเรียก loadCompanyCalendar() แล้วครั้งหนึ่ง */
export function getDayType(workDate) {
  return cache?.get(workDate) || 'working';
}

export function getOtMultiplier(workDate) {
  return (DAY_TYPE_META[getDayType(workDate)] || DAY_TYPE_META.working).otMultiplier;
}
