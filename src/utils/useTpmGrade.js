/* 🛠️ useTpmGrade — เกรดความสำคัญ (A/B/C) ของ "เลขเครื่องที่กรอกในใบ" · 2026-11-27 · 📄 docs/modules/tpm.md
   ใช้ที่ใบ MO (/mtn-repair) เพื่อตัดสินว่าใบนี้ต้องมี Why-Why ก่อนปิดไหม (`closeGate()` ใน utils/tpm.js)
   · จับคู่เครื่องด้วย `resolveEquip()` ตัวกลาง (SW-10 = SW10) ผ่าน `gradeForMachineNo()`
   · เกณฑ์/คะแนนอ่านสดทุกครั้งที่เปิดใบ (ตารางเล็ก · ดึงแค่แถวของเครื่องนี้) — เกรดไม่เก็บในฐาน
   🔴 อ่านไม่ได้ = `failed: true` (ไม่ใช่ "ไม่มีเกรด") — ผู้เรียกต้องบอกบนจอ */
import { useEffect, useState } from 'react';
import { supabaseDR } from '../supabaseClient';
import useMachines from './useMachines';
import { buildEquipIndex, resolveEquip } from './mtnMetrics';
import { critGrade, critThresholds } from './tpm';

export default function useTpmGrade(machineNo) {
  const { machines, failed: mFailed } = useMachines();
  const [state, setState] = useState({ loading: true, failed: false, machine: null, res: null });
  const key = String(machineNo || '').trim();
  const machineCount = machines?.length || 0;

  useEffect(() => {
    let alive = true;
    if (!key) { setState({ loading: false, failed: false, machine: null, res: null }); return undefined; }
    if (mFailed) { setState({ loading: false, failed: true, machine: null, res: null }); return undefined; }
    if (!machineCount) { setState(s => ({ ...s, loading: true })); return undefined; }
    const { machine } = resolveEquip(key, buildEquipIndex(machines));
    if (!machine) { setState({ loading: false, failed: false, machine: null, res: null }); return undefined; }
    (async () => {
      const [fa, se, cr] = await Promise.all([
        supabaseDR.from('tpm_crit_factors').select('key, label, weight, force_a, is_active'),
        supabaseDR.from('tpm_settings').select('key, value'),
        supabaseDR.from('machine_criticality').select('machine_id, scores').eq('machine_id', machine.id).maybeSingle(),
      ]);
      if (!alive) return;
      if (fa.error || se.error || cr.error) { setState({ loading: false, failed: true, machine, res: null }); return; }
      setState({ loading: false, failed: false, machine, res: critGrade(cr.data?.scores || null, fa.data || [], critThresholds(se.data || [])) });
    })();
    return () => { alive = false; };
    // machines อ่านผ่าน machineCount (primitive) — กฎ DB ข้อ 9 ห้าม array ใน deps
  }, [key, machineCount, mFailed]);

  return state;
}
