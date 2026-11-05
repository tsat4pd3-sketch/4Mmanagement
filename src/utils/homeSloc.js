/* 🏠 โหลด "ที่จัดเก็บหลัก" ของพาร์ท (`parts_master.home_sloc` · DR) — กฎอยู่ที่ `storageLoc.js` (§ที่จัดเก็บหลัก)
   คืน { map: Map(mat → code), error } · อ่านไม่ได้ = error (จอต้องบอก ห้ามถือว่า "ยังไม่ตั้ง")
   ⚠️ คอลัมน์ยังไม่ apply (42703) = map ว่าง + error 'not_ready' */
import { supabaseDR } from '../supabaseClient';
import { fetchAllRows } from './fetchAllRows';

export async function loadHomeSlocs() {
  const { data, error } = await fetchAllRows(supabaseDR, 'parts_master', 'mat_no, home_sloc',
    q => q.not('home_sloc', 'is', null).order('mat_no'));
  if (error) return { map: new Map(), error: error.code === '42703' ? 'not_ready' : (error.message || String(error)) };
  return { map: new Map((data || []).map(r => [String(r.mat_no || '').trim(), String(r.home_sloc || '').trim().toUpperCase()])), error: null };
}
