/* ── useInstruments — ทะเบียนเครื่องมือวัด (Main qa_instruments) สำหรับ picker  (2026-09-07) ──
   คู่กับ <InstrumentSelect> · หน้าที่แก้ทะเบียน (แท็บ 📏 ใน /qa) เรียก invalidateInstruments() หลังบันทึก */
import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { cachedMaster, invalidateMaster } from './masterCache';

const KEY = 'qa_instruments:picker';

export async function loadInstruments() {
  return cachedMaster(KEY, async () => {
    const { data, error } = await supabase.from('qa_instruments')
      .select('id, code, name, inst_type, brand, line_name, status').order('code');
    if (error) throw error;
    return data || [];
  });
}
export const invalidateInstruments = () => invalidateMaster(KEY);

export default function useInstruments() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let alive = true;
    loadInstruments().then(d => { if (alive) setRows(d || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return rows;
}
