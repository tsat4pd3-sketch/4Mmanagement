-- ── ลายเซ็น/รูปโปรไฟล์ของตัวเอง บันทึกไม่ติดแบบเงียบ (2026-08-17 · หัวหน้าแผนกแจ้ง) ──
-- อาการ: หัวหน้ากลุ่มวาดลายเซ็นในโมดัล "จัดการลายเซ็น" → ขึ้น "บันทึกลายเซ็นเรียบร้อย"
--        → พอ logout/login ใหม่ ลายเซ็นหาย ต้องเซ็นใหม่ทุกครั้ง
--
-- ต้นเหตุ: RLS ของ public.profiles ไม่อนุญาตให้ user แก้แถวตัวเอง
--   ⚠️ UPDATE ที่ถูก RLS บล็อก **ไม่ error** — คืน "สำเร็จ 0 แถว"
--      supabase-js จึงได้ error = null → โค้ดขึ้น toast เขียวทั้งที่ไม่มีอะไรถูกบันทึก
--      (พิสูจน์บน PostgreSQL 16 แล้ว — ดูหัวข้อในรายงาน)
--
-- ทางแก้ที่ "ไม่" ใช้: policy `for update using (id = auth.uid())` แบบตรงๆ
--   → เปิดช่องให้ทุกคน UPDATE role ของตัวเองเป็น 'admin' ได้ (ทดสอบแล้วทำได้จริง)
--   RLS จำกัดรายคอลัมน์ไม่ได้ · จะใช้ column GRANT ก็พังฝั่ง /add-user
--   (admin แก้ role/section ของคนอื่นผ่าน client ตรงๆ อยู่)
--
-- ทางแก้ที่ใช้: SECURITY DEFINER ที่แตะ "เฉพาะคอลัมน์ที่อนุญาต" ของ "แถวตัวเองเท่านั้น"
--   ทำงานได้โดยไม่ต้องแก้ policy เดิมของ profiles เลย (ไม่รู้ว่าตั้งไว้ยังไงก็ไม่กระทบ)
--   additive ล้วน — revert = drop 2 ฟังก์ชันนี้ทิ้ง โค้ดเก่าทำงานได้เหมือนเดิม

create or replace function public.set_my_signature(p_url text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid := auth.uid();
begin
  if v_id is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  update public.profiles set signature_url = p_url where id = v_id;
  if not found then raise exception 'ไม่พบโปรไฟล์ของผู้ใช้นี้'; end if;
  return p_url;
end $$;

create or replace function public.set_my_avatar(p_url text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid := auth.uid();
begin
  if v_id is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  update public.profiles set avatar_url = p_url where id = v_id;
  if not found then raise exception 'ไม่พบโปรไฟล์ของผู้ใช้นี้'; end if;
  return p_url;
end $$;

-- anon ยิงไม่ได้ (anon key ฝังอยู่ใน JS bundle สาธารณะ — กฎเดียวกับ fn_weekly_skill_update)
revoke execute on function public.set_my_signature(text) from public, anon;
revoke execute on function public.set_my_avatar(text)    from public, anon;
grant  execute on function public.set_my_signature(text) to authenticated;
grant  execute on function public.set_my_avatar(text)    to authenticated;

comment on function public.set_my_signature(text) is
  'บันทึกลายเซ็นของผู้ใช้ที่ login เอง (แตะเฉพาะ profiles.signature_url ของแถวตัวเอง) — เลี่ยง RLS ที่บล็อก UPDATE แบบเงียบ';
comment on function public.set_my_avatar(text) is
  'บันทึกรูปโปรไฟล์ของผู้ใช้ที่ login เอง (แตะเฉพาะ profiles.avatar_url ของแถวตัวเอง)';
