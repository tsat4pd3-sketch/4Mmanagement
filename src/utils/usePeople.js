/* ── usePeople — ทะเบียน "คน" ชุดเดียวสำหรับ picker ทั้งแอป  (2026-09-07 · single-source audit) ──

   ที่มา: audit ทั้งระบบเจอช่อง "ชื่อคน" ที่พิมพ์เองกว่า 60 จุด (ผู้ตรวจ/ผู้อนุมัติ/ผู้รับผิดชอบ/
   ผู้แจ้ง/ผู้สอน/หัวหน้างาน ฯลฯ) ทั้งที่มี `profiles` (user ระบบ) + `employees` (พนักงาน) อยู่แล้ว
   → ชื่อสะกดคนละแบบ จัดกลุ่ม/หา KPI รายคนไม่ได้ · ลายเซ็นไม่ตามมา

   ⚠️ หน้าใหม่ที่ต้องการ "เลือกคน" ให้ใช้ <PersonSelect> (src/components/PersonSelect.jsx)
      ที่กิน hook นี้ — ห้าม select profiles/employees มาทำ datalist/select เองอีก

   คืนค่า 2 ชุด (cache ร่วมทั้งแอปผ่าน masterCache):
     profiles  — user ที่ login ได้ (มี signature_url/role) · ตัด role 'display'
     employees — พนักงานในทะเบียน (is_active) · มี employee_id_code / line_id / section / team
   สินค้าปลายทางส่วนใหญ่เก็บ "ชื่อ" เป็น snapshot (ตาราง DR อยู่คนละ project กับ Main
   ผูก FK ไม่ได้) — picker จึงคืนทั้ง id และชื่อ ให้หน้าเลือกเก็บได้ทั้งสองแบบ */
import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { cachedMaster, invalidateMaster } from './masterCache';
import { fetchAllRows } from './fetchAllRows';

const KEY_PROFILES = 'people:profiles';
const KEY_EMPLOYEES = 'people:employees';

export async function loadProfilesPeople() {
  return cachedMaster(KEY_PROFILES, async () => {
    // profiles ไม่มี email (CLAUDE.md) · position = ตำแหน่งจริง (แสดงผล) · employee_id = ผูกทะเบียนพนักงาน (nullable)
    let r = await supabase.from('profiles')
      .select('id, full_name, role, section, sections, line_id, position, signature_url, employee_id')
      .order('full_name');
    // tolerant: ยังไม่ apply migration บางตัว (42703) → ถอยไปชุดคอลัมน์ขั้นต่ำ ไม่ให้ picker ว่างทั้งแอป
    if (r.error) r = await supabase.from('profiles').select('id, full_name, role, section, line_id, signature_url').order('full_name');
    if (r.error) throw r.error;
    return (r.data || []).filter(p => p.full_name && String(p.role) !== 'display');
  });
}

export async function loadEmployeesPeople() {
  return cachedMaster(KEY_EMPLOYEES, async () => {
    const { data, error } = await fetchAllRows(supabase, 'employees',
      'id, employee_id_code, name, line_id, section, department, group_name, team, position, is_active',
      q => q.eq('is_active', true).order('name').order('id'));
    if (error) throw error;
    return data || [];
  });
}

export const invalidatePeople = () => { invalidateMaster(KEY_PROFILES); invalidateMaster(KEY_EMPLOYEES); };

/** @param {{ profiles?: boolean, employees?: boolean }} want — default โหลดเฉพาะ profiles */
export default function usePeople({ profiles = true, employees = false } = {}) {
  const [state, setState] = useState({ profiles: [], employees: [], loading: true, failed: false });
  useEffect(() => {
    let alive = true;
    Promise.all([
      profiles ? loadProfilesPeople().catch(() => null) : Promise.resolve([]),
      employees ? loadEmployeesPeople().catch(() => null) : Promise.resolve([]),
    ]).then(([p, e]) => {
      if (!alive) return;
      setState({ profiles: p || [], employees: e || [], loading: false, failed: p === null || e === null });
    });
    return () => { alive = false; };
  }, [profiles, employees]);
  return state;
}
