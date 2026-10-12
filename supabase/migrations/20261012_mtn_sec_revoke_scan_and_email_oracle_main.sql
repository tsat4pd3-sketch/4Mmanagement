-- ════════════════════════════════════════════════════════════════════════════
-- Main project ("MAIN" · ewhdfqwfwofivojtsizn) — **apply แล้ว 2026-10-12**
-- 🔒 ปิด 2 ช่องที่ QC audit 08/10 ชี้ไว้ (คำสั่ง user 12/10 "1+2 ลุย · 3 ถอดออกได้")
--
-- ── (2) `fn_shift_schedule_scan(int)` — ใครที่ login แล้วก็สั่งยิงแจ้งเตือนได้ ────────────
--   SECURITY DEFINER · ไม่มีด่านสิทธิ์ข้างใน · `EXECUTE` ถูก grant ให้ `authenticated`
--   ทำอะไรได้: ยิง Telegram ผ่าน net.http_post + เขียนแถวลง `shift_schedule_alerts`
--   ⚠️ ความแรงจริงถูกจำกัดโดย unique (scope_key, week_key) ของตาราง alerts
--      ⇒ ยิงได้ **สัปดาห์ละครั้งต่อส่วนงาน** เรียกซ้ำจะ skip · ไม่รั่วข้อมูล ไม่ลบอะไร
--   🔑 ตัวชี้ขาด: **ไม่มีโค้ดฝั่งจอเรียกมันเลย** — ผู้เรียกมีแค่ cron
--      (`20260828_shift_schedule_gap_alert.sql` บรรทัด 186 `select public.fn_shift_schedule_scan();`)
--   ⇒ ถอน grant ทิ้งได้เลย **ไม่กระทบการใช้งาน** (ไม่มีปุ่มไหนหาย) — ดีกว่าใส่ `has_perm()`
--     ซึ่งต้องเดาคีย์ทั้งที่ไม่มีใครเรียกจากจอ · cron วิ่งด้วย postgres/service_role ยังเรียกได้
--
-- ── (3) `login_email_exists(text)` — เปิดให้คนนอกเดาว่าอีเมลไหนมีบัญชี ─────────────────
--   `EXECUTE` grant ให้ **`anon`** (จำเป็น เพราะ Login.jsx เรียกก่อน login)
--   คืน boolean ว่าอีเมลนี้มีบัญชีใน auth.users ไหม ⇒ **account enumeration**
--   ระบบเปิดบนอินเทอร์เน็ตจริง (Render + anon key อ่านได้จากหน้าเว็บ)
--   ⇒ ใครก็ยิงไล่เดาได้ว่าอีเมลไหนมีบัญชี = ได้ลิสต์เป้าไปไล่ลองรหัสผ่าน
--   user ตัดสิน 12/10: **ถอดออก** · Login.jsx เลิกเรียกแล้ว (ใช้ข้อความรวม + บอกให้ติดต่อ admin)
--   · มีด่าน `login-no-email-oracle` ใน regressionGuards กันเอากลับมา
--
--   ⚠️ ไฟล์นี้ใช้ `revoke` ไม่ใช่ `drop function` **โดยเจตนา 2 เหตุ**
--      1. revoke ปิดช่องได้ครบแล้ว (เรียกไม่ได้ = เดาไม่ได้) และ **ย้อนกลับได้ 1 บรรทัด**
--      2. `drop` ค้างที่ตัว MCP ทุกครั้ง (timeout 60s) — AI session apply เองไม่ได้
--      ⇒ ตัวฟังก์ชันที่เหลือเป็นซากที่ไม่มีใครเรียกได้ · SQL เก็บกวาดส่งให้ user รันเอง (ท้ายไฟล์)
--
-- ⏪ ROLLBACK:
--   grant execute on function public.fn_shift_schedule_scan(int) to authenticated;
--   grant execute on function public.login_email_exists(text) to anon, authenticated;
--   (ข้อ 3 ต้องคืนโค้ด Login.jsx ด้วย ไม่งั้น grant กลับไปก็ไม่มีใครเรียก)
-- ════════════════════════════════════════════════════════════════════════════

-- (2) เหลือเฉพาะ cron/service_role
revoke execute on function public.fn_shift_schedule_scan(int) from authenticated;

-- (3) ไม่ให้ใครเรียกได้อีก (anon = ช่องเดา · authenticated = ไม่มีใครใช้)
revoke execute on function public.login_email_exists(text) from anon, authenticated;

-- ✅ ตรวจผล — ควรเหลือเฉพาะ postgres / service_role ทั้ง 2 ตัว
--   select p.proname,
--          (select string_agg(distinct r.rolname, ', ') from aclexplode(p.proacl) ac
--             join pg_roles r on r.oid = ac.grantee where ac.privilege_type = 'EXECUTE') as exec_to
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('fn_shift_schedule_scan', 'login_email_exists');
--
-- 🧹 เก็บกวาดซากฟังก์ชัน (ไม่บังคับ · ช่องถูกปิดด้วย revoke แล้ว) — user รันใน SQL Editor:
--   drop function if exists public.login_email_exists(text);
