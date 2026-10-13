-- ════════════════════════════════════════════════════════════════════════════════
-- 🖥️ บัญชีกลาง (account_kind='shared') ห้ามลบอะไรทั้งนั้น — ชั้น DB ของ Main project
-- 2026-10-13 · คำสั่ง user ("บัญชีกลาง ไม่ควรลบได้") + คำขอหน้างานทีม MTN ("ไม่กดลบกันมั่ว")
--
-- ทำไม: บัญชีกลาง = จอ TV / บัญชีประจำเครื่อง-กะ (`maintenance` · `toolingmaintenance` · TV-1..13)
--        ใช้ร่วมกันหลายคน ⇒ ลบแถวแล้ว **สอบกลับไม่ได้ว่าใครกด** (audit เขียนได้แค่ชื่อบัญชี)
--        ส่วนบัญชีของคน (account_kind='person') สิทธิ์เดิม **ไม่เปลี่ยนเลย**
--
-- ขอบเขต: ปฏิเสธเฉพาะคีย์ที่ลงท้าย ':delete' — อ่าน/เพิ่ม/แก้ ยังได้เหมือนเดิม
--          (จอ TV ต้องอ่านได้ · บัญชีประจำเครื่องยังลงบันทึกผลิต/แจ้งซ่อมได้)
-- 🔴 อยู่ก่อนด่าน admin ในฟังก์ชัน — บัญชี `ADMIN` เองก็เป็นบัญชีกลาง ถ้าเช็คหลัง admin ด่านนี้ไร้ผล
--    ⇒ ผลพลอยได้ที่ต้องรู้: บัญชีกลาง `ADMIN` จะลบไม่ได้แล้ว (ใช้บัญชีคนที่เป็น admin แทน — มี 3 คน)
--
-- ย้อนกลับ: create or replace กลับเป็นตัวเดิม (เก็บไว้ท้ายไฟล์นี้) — ไม่แตะ schema/ข้อมูล
-- ⚠️ ฝั่ง DR วิ่งด้วย role anon ⇒ **ไม่มี has_perm** ⇒ ตาราง DR (ใบ MO) พึ่งด่านฝั่งจอ
--    `canDelete()` ใน src/utils/permissions.js เท่านั้น (known gap เดิมของโปรเจค)
-- ════════════════════════════════════════════════════════════════════════════════

create or replace function public.has_perm(perm_key text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select
       -- 🖥️🔴 บัญชีกลางห้ามลบ — ต้องเช็คก่อน admin เสมอ
       case when p.account_kind = 'shared' and perm_key like '%:delete' then false
       else
            p.role = 'admin'::user_role
            or exists (
              select 1 from role_permissions rp
              where rp.role = p.role
                and rp.permission_key = perm_key
                and rp.allowed
            )
            or (
              coalesce(p.is_dept_admin, false)
              and perm_key not like 'page:%'
              and exists (
                select 1 from role_permissions rp
                where rp.role = 'dept_admin'::user_role
                  and rp.permission_key = perm_key
                  and rp.allowed
              )
            )
       end
     from profiles p
     where p.id = auth.uid()),
    false
  );
$function$;

-- ── ตรวจผล (รันแล้วต้องได้ตามคอมเมนต์) ─────────────────────────────────────────
-- 1) ฟังก์ชันมีกฎใหม่จริง (ต้องได้ 1 แถว)
--    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname='public' and p.proname='has_perm'
--       and pg_get_functiondef(p.oid) like '%account_kind = ''shared''%';
--
-- 2) ใครได้รับผลกระทบ — บัญชีกลางที่ role ยังถือคีย์ลบอยู่
--    select pr.full_name, pr.role, rp.permission_key
--      from profiles pr join role_permissions rp on rp.role = pr.role
--     where pr.account_kind = 'shared' and rp.permission_key like '%:delete' and rp.allowed
--     order by pr.role, pr.full_name;
