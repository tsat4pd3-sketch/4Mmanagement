-- ── Main project "MAIN" (ewhdfqwfwofivojtsizn) · apply แล้วผ่าน MCP 25/11 11:40 (บันทึกไว้เป็นหลักฐาน · รันซ้ำได้) ──
-- 🔐 มาตรฐาน role ของคนฝ่าย QA/QC (2026-11-25 · คำสั่ง user "ทำใน SQL ให้ที ตามที่ควรเป็น")
--
-- ที่มา: feedback หน้างาน "บางคนแก้ไม่ได้ดูได้อย่างเดียว · บางคนทำได้ over scope" · ตรวจทะเบียนจริง 26 บัญชีในส่วน QA:
--   · หัวหน้า Inspection/PQA-Press 3 คน + เจ้าหน้าที่/หัวหน้าส่วน 2 คน ตั้งเป็น role ฝั่งผลิต (leader/supervisor)
--     ⇒ ไม่มี qa:manage · qa:bin_decide · four_m:approve_qa · page:/qa-setup = จอคุณภาพดูได้อย่างเดียว
--   · วิศวกร QA 1 คนเป็น admin = แก้ได้ทั้งระบบ (over scope)
--   · ผจก. QA role manager ไม่มี qa:bin_decide (คีย์นี้เคยมีแต่ใน role qa) = ตัดสินถังเหลืองไม่ได้
-- กฎ (ตามหลัก "role = ชุดสิทธิ์ ไม่ใช่ตำแหน่ง · ขอบเขตเป็นรายคน"):
--   ① ทุกคนในฝ่าย QA = role `qa` + ใบผ่านข้ามหน่วย all_units (เหมือน 20261121)
--   ② หัวหน้า (dept_head · section_head · line_leader · ผู้คุม PQA-Press) = ติ๊กแอดมินหน่วยงาน (is_dept_admin)
--      ได้ชุดจัดการคนของหน่วยตัวเอง (เช็คชื่อ · จัดกะ · ทะเบียนพนักงาน · ทักษะ · LPA) โดยไม่ต้องใช้ role ผลิต
--   ③ ผจก. ฝ่าย = manager ตามเดิม + เติม qa:bin_decide ให้ role manager
--   · ตำแหน่ง (position) ไม่ใช้ตัดสิทธิ์ — ล็อกเฉพาะช่องเซ็นใบ MO
-- สิ่งที่ 5 บัญชีจาก role ผลิตจะ "เสีย" (ยอมรับ — งาน QA ไม่ใช้): daily_report:open_shift/close_shift · four_m:approve_sv ·
--   bbs:record · obeya:record · wip_* · page:/manpower-board · /workforce-insight · /production-plan ·
--   supervisor เสียเพิ่ม org:manage_divisions · skills:approve_levelup · pm:monthly_approve (ของ admin ไม่นับ)
-- พิสูจน์หลังลง (จำลอง JWT ฝั่ง DB ทั้ง 8 บัญชี): qa:manage/qa:bin_decide/four_m:approve_qa/qa:record = true ทุกคน ·
--   app_all_units() = true (ผจก. false ตามเดิม — จอคุณภาพผ่าน qaWriteCtx อยู่แล้ว) · employees:edit = true เฉพาะคนที่ติ๊กแอดมินหน่วยงาน
-- ย้อนกลับ: update profiles p set role = b.role::app_role, all_units = b.all_units, is_dept_admin = b.is_dept_admin
--           from archive.bk_qa_roles_20261125 b where b.id = p.id;
--           delete from role_permissions where role::text='manager' and permission_key='qa:bin_decide';

create schema if not exists archive;
create table if not exists archive.bk_qa_roles_20261125 as
  select id, full_name, role::text as role, all_units, is_dept_admin, now() as backed_up_at
  from profiles where id in ('5566c913-23a0-4f45-9b30-dd726dea3f7d','1e17575e-d891-4060-9a61-839b8243aae6','7b590985-3431-4f23-ae92-455857af96c6',
    '1f0b4beb-ebc8-4f96-9e37-12960bfeb30b','feda0aa3-4eba-4f31-8679-9e8eb829aa95','0a45547e-1906-4d72-9b38-a6660f13af50','6e6c6e7b-ab94-4f73-b1a3-d5c064e14935');

-- ① 6 บัญชี → role qa + ใบผ่านข้ามหน่วย (หัวหน้า Inspection/PQA-Press 3 · เจ้าหน้าที่/หัวหน้าส่วน 2 · วิศวกรที่เป็น admin 1)
update profiles set role = 'qa', all_units = true
 where id in ('5566c913-23a0-4f45-9b30-dd726dea3f7d','1e17575e-d891-4060-9a61-839b8243aae6','7b590985-3431-4f23-ae92-455857af96c6',
              '1f0b4beb-ebc8-4f96-9e37-12960bfeb30b','feda0aa3-4eba-4f31-8679-9e8eb829aa95','0a45547e-1906-4d72-9b38-a6660f13af50');

-- ② หัวหน้า QA 6 คน → แอดมินหน่วยงาน
update profiles set is_dept_admin = true
 where id in ('6e6c6e7b-ab94-4f73-b1a3-d5c064e14935','feda0aa3-4eba-4f31-8679-9e8eb829aa95','5566c913-23a0-4f45-9b30-dd726dea3f7d',
              '1e17575e-d891-4060-9a61-839b8243aae6','7b590985-3431-4f23-ae92-455857af96c6','1f0b4beb-ebc8-4f96-9e37-12960bfeb30b');

-- ③ ผจก. ตัดสินถังเหลืองได้
insert into role_permissions (role, permission_key, allowed)
 select 'manager', 'qa:bin_decide', true
 where not exists (select 1 from role_permissions where role::text='manager' and permission_key='qa:bin_decide');

-- ตรวจ: select role::text, count(*) filter (where all_units) pass, count(*) filter (where is_dept_admin) dept_admin, count(*) n
--       from profiles where section='QA' group by 1;   -- qa 24/24 pass · dept_admin 6 · manager 1 · display 1
