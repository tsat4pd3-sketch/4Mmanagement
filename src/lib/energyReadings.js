/* ⚡ อ่านแถวรายนาทีของมิเตอร์ (DR · energy_readings) — ใช้ร่วม /energy แท็บค่าไฟสด + ผังโรงงาน
   วนทีละ 1000 แถว (เพดาน PostgREST · กฎ DB ข้อ 5) — วันเต็ม 3 เครื่อง = 4,320 แถว
   ⚠️ เลือกเฉพาะคอลัมน์ที่กราฟใช้ (กฎ egress) · error = throw ให้ผู้เรียกตัดสิน (ห้ามกลืนเป็นลิสต์ว่าง) */
import { supabaseDR } from '../supabaseClient';

const PAGE = 1000;

/** @param {string} from ISO · @param {boolean} inclusive true = รวมนาที from (โหลดทั้งวัน) · false = เฉพาะที่ใหม่กว่า (รอบ poll) */
export async function fetchReadingsSince(from, inclusive) {
  const out = [];
  for (let off = 0; off < 20 * PAGE; off += PAGE) {
    const { data, error } = await supabaseDR.from('energy_readings')
      .select('scope_kind, scope_name, bucket_at, kw')
      .filter('bucket_at', inclusive ? 'gte' : 'gt', from).order('bucket_at').range(off, off + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}
