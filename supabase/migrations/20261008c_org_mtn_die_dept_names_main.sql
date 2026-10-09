-- ════════════════════════════════════════════════════════════════════════════
-- Main project ("MAIN" · ewhdfqwfwofivojtsizn) — **apply แล้ว 2026-10-08**
-- 🏷️ ชื่อแผนกจริงของ 2 ทีมช่าง + เติมสังกัดให้ 5 บัญชีที่ไม่มีแผนก (คำสั่ง user 2026-10-08)
--
-- user ตอบชื่อแผนกจริง: **"Maintenance"** และ **"DIE Maintenance"**
--   (QC audit 08/10 ชี้ว่า 5 บัญชี role=mtn มี `profiles.section = null` ⇒ ไม่มีหน่วยงานสังกัด
--    ⇒ จอกำลังคน / คิวงาน / ขอบเขตส่วนงาน วางคนพวกนี้ไม่ได้ · ผมไม่ตั้งชื่อหน่วยงานเอง จึงถาม)
--
-- ── 🔴 ทำไม "ย้ายตัวย่อไปไว้ที่ `code`" ไม่ใช่ "เปลี่ยน `name` ทิ้ง" ────────────────────
--    `orgKey(n) = n.code || n.name` (`src/utils/listOrder.js`) = คีย์ที่ทะเบียนอื่นเก็บเป็น
--    **ข้อความ ไม่ผูก FK** ⇒ เปลี่ยน name ลอยๆ ขณะ code ว่าง = คีย์เปลี่ยนตาม
--    = สำเนาชื่อในทะเบียนอื่นชี้ของที่ไม่มีอยู่ (กฎ CLAUDE.md §ทะเบียนที่จับคู่ด้วย "ข้อความ")
--
--    วัดจริง 08/10 ว่าใครถือคีย์ 'MTN'/'DIE MTN' อยู่ (สแกน **ทุกคอลัมน์ text ของ schema public**
--    ด้วย query_to_xml ไม่ใช่เดาจากลิสต์ใน orgNodeRefs.js):
--      employees.department        18 แถว
--      shift_schedules.dept_name   35 แถว
--      kpi_definitions.scope_value 11 แถว
--      cost_centers.name 3 · cost_centers.section 4
--      org_nodes.name               2 แถว  (ตัวที่แก้ในไฟล์นี้)
--      pe_cp_items.person           8 แถว  ← 🔴 **คนละความหมาย** ("MTN" = ผู้ตรวจ ไม่ใช่หน่วยงาน)
--                                            ⇒ ห้ามแตะ · ไม่รวมในงานนี้
--
--    ⇒ ตั้ง `code` = ตัวย่อเดิม · `name` = ชื่อจริง ⇒ **orgKey ไม่ขยับ**
--      = 55 แถวที่จับคู่ด้วยคีย์ยังตรงครบ **ไม่ต้อง re-key อะไรเลย**
--      แต่ผังองค์กร (`/org-setup`) แสดงชื่อแผนกจริงตามที่ user สั่ง
--    ⇒ `mtn_teams.dept_name` ฝั่ง DR ('MTN'/'DIE MTN') และ `DEFAULT_TEAMS` ใน
--      `src/utils/pmTeams.js` **ไม่ต้องแก้** — ยังเท่ากับ orgKey เหมือนเดิม
--      (KpiMonthly/ObeyaKpiBoard จับคู่ `dept_name` กับค่าขอบเขต ⇒ ยังตรง)
--
-- ⏪ ROLLBACK (ย้อนได้ ไม่เสียข้อมูล):
--   update org_nodes set code = null, name = 'MTN'
--    where kind = 'department' and name = 'Maintenance';
--   update org_nodes set code = null, name = 'DIE MTN'
--    where kind = 'department' and name = 'DIE Maintenance';
--   update profiles set section = null
--    where section in ('MTN','DIE MTN') and mtn_teams && array['maintenance','die_maintenance'];
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) ชื่อแผนกจริง — ตัวย่อย้ายไป code (คีย์เดิม) · name = ชื่อที่ user ให้ ──────────────
update org_nodes set code = 'MTN',     name = 'Maintenance'
 where kind = 'department' and name = 'MTN'     and code is null;

update org_nodes set code = 'DIE MTN', name = 'DIE Maintenance'
 where kind = 'department' and name = 'DIE MTN' and code is null;

-- ── 2) เติมสังกัดให้ 5 บัญชีที่ค้างว่าง ───────────────────────────────────────────────
-- เก็บเป็น **orgKey (ตัวย่อ)** ให้ตรงแบบเดียวกับบัญชี JIG MTN / QA ที่มีอยู่แล้ว
-- (วัด 08/10: บัญชีกลุ่มนั้น `profiles.section` = 'JIG MTN'/'QA' · `org_node_id` = null ทั้งหมด)
-- 🔴 แตะเฉพาะแถวที่ section ยังว่าง — ไม่ทับค่าที่คนตั้งไว้แล้ว
update profiles p set section = 'MTN'
 where p.section is null and p.mtn_teams @> array['maintenance'];

update profiles p set section = 'DIE MTN'
 where p.section is null and p.mtn_teams @> array['die_maintenance'];

-- ✅ ตรวจผล (project "MAIN" · ewhdfqwfwofivojtsizn) — วัดแล้ว 08/10 ตรงทุกบรรทัด
--   select kind, code, name from org_nodes where name in ('Maintenance','DIE Maintenance');
--     -- ต้องได้ code='MTN'/name='Maintenance' · code='DIE MTN'/name='DIE Maintenance'
--   select section, count(*) from profiles
--    where mtn_teams && array['maintenance','die_maintenance'] group by 1;
--     -- ต้องได้ MTN 3 · DIE MTN 2 · ไม่มี null
--   select department, count(*) from employees where department in ('MTN','DIE MTN') group by 1;
--     -- ต้องยังได้ MTN 9 · DIE MTN 9 (คีย์ไม่ขยับ)
