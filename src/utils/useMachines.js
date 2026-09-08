/* ── useMachines — ทะเบียนเครื่องจักร/แม่พิมพ์/จิ๊ก (DR `machines`) ชุดเดียวสำหรับ picker ──
   (2026-09-07 · single-source audit)

   ที่มา: `machine_no` เป็น text join key ที่ MtnAndonBoard / DieRegistry / PmCoordination /
   improvements / OrderTrace ใช้เทียบกัน (normNo) แต่มี 3 ฟอร์มให้ "พิมพ์หมายเลขเครื่อง" เองผ่าน
   datalist → พิมพ์ผิดตัวเดียว = ใบซ่อมไม่ขึ้นบอร์ด/สถานะแม่พิมพ์ไม่ผูก โดยไม่มีสัญญาณ

   ⚠️ หน้าใหม่ที่ต้องการ "เลือกเครื่อง" ให้ใช้ <MachineSelect> (src/components/MachineSelect.jsx)
      ห้าม select machines มาทำ datalist เองอีก · ตารางอยู่ DR (anon เสมอ — กฎเหล็ก supabaseDR) */
import { useEffect, useState } from 'react';
import { supabaseDR } from '../supabaseClient';
import { cachedMaster, invalidateMaster } from './masterCache';
import { fetchAllRows } from './fetchAllRows';

const KEY = 'machines:picker';
export const MACHINE_COLUMNS = 'id, machine_no, machine_name, line_name, process_type, equipment_kind, equipment_category, is_active, sort_order';

export async function loadMachinesMaster() {
  return cachedMaster(KEY, async () => {
    let r = await fetchAllRows(supabaseDR, 'machines', MACHINE_COLUMNS, q => q.order('line_name').order('sort_order').order('id'));
    // tolerant: ยังไม่ apply migration equipment_kind/category → ถอยไปคอลัมน์พื้นฐาน
    if (r.error) r = await fetchAllRows(supabaseDR, 'machines', 'id, machine_no, machine_name, line_name, process_type, is_active, sort_order', q => q.order('line_name').order('sort_order').order('id'));
    if (r.error) throw r.error;
    return r.data || [];
  });
}
export const invalidateMachines = () => invalidateMaster(KEY);

/** คืน { machines, loading, failed } — machines รวมทั้ง is_active=false (picker เป็นคนตัด/ติดป้ายเอง) */
export default function useMachines() {
  const [state, setState] = useState({ machines: [], loading: true, failed: false });
  useEffect(() => {
    let alive = true;
    loadMachinesMaster().then(d => { if (alive) setState({ machines: d || [], loading: false, failed: false }); })
      .catch(() => { if (alive) setState({ machines: [], loading: false, failed: true }); });
    return () => { alive = false; };
  }, []);
  return state;
}
