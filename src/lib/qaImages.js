import { supabase } from '../supabaseClient';

/* ไฟล์ของระบบตรวจชิ้นงาน QA อยู่ bucket `qa-drawings` (MAIN) — แผ่นแบบเก็บเป็น public URL ·
   รูปโคลสอัพรายจุด (`qa_inspection_items.image_path`) เก็บเป็น path → แปลงผ่านตัวนี้ที่เดียว */
export const QA_BUCKET = 'qa-drawings';
export const qaFileUrl = (path) => (path ? supabase.storage.from(QA_BUCKET).getPublicUrl(path).data.publicUrl : null);
