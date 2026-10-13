/* ── useInstruments — ทะเบียนเครื่องมือวัด (Main qa_instruments) สำหรับ picker  (2026-09-07) ──
   คู่กับ <InstrumentSelect> · หน้าที่แก้ทะเบียน (แท็บ 📏 ใน /qa) เรียก invalidateInstruments() หลังบันทึก */
import { supabase } from '../supabaseClient';
import { cachedMaster, invalidateMaster } from './masterCache';
import useMasterRows from './useMasterRows.js';

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

/** สถานะโหลดทะเบียน — `{ rows, failed, stale, message, loading, reload }`
 *  🔴 ช่องเลือกที่ต้องบอกว่า "ลิสต์ว่างเพราะไม่มีของ หรือเพราะโหลดไม่สำเร็จ" ใช้ตัวนี้
 *     (ตัว default คืนแค่แถว = พฤติกรรมเดิม ไม่ต้องแก้จุดเรียกเก่า) */
export function useInstrumentsState() { return useMasterRows(KEY, loadInstruments); }

export default function useInstruments() { return useInstrumentsState().rows; }
