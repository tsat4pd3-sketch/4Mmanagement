-- ════════════════════════════════════════════════════════════════════════════
-- Main project ("MAIN" · ewhdfqwfwofivojtsizn)
-- ตั้ง `profiles.mtn_teams = {production}` ให้ "ทีม AM" = หัวหน้า/ลีดเดอร์ฝ่ายผลิต (2026-10-06)
--
-- ที่มา (user 06/10): ทีม MTN แจ้งว่า *"ระบบแจ้งเตือนไม่แจ้งตาม user แผนก
--   ไม่รู้ว่าเรียกช่างส่วนงานไหน"* → user ยืนยันนิยาม: **"ทีมที่ทำ AM คือฝ่ายผลิต
--   หัวหน้าผลิต ที่เค้าเช็คเครื่อง"** ⇒ ในระบบคือทีม `production` (mtn_teams.dept_name = PRODUCTION)
--
-- ── ปัญหาที่วัดได้ (ใบทดสอบจริง 06/10 15:33 · เรียกทีม JIG MTN) ──
--   ส่งถึง **16 คน แต่เป็นทีม JIG จริงแค่ 4** — อีก 12 คนเป็นหัวหน้า/ลีดเดอร์ PD3
--   ที่ `mtn_teams` ว่าง จึงหลุดด่านทีมใน `notify_recipients()`:
--       and (p_team is null
--            or coalesce(array_length(p.mtn_teams,1),0) = 0   -- ← fail-open โดยตั้งใจ
--            or p.mtn_teams && array[p_team])
--   🔴 **ห้ามแก้ fail-open ข้อนั้นเป็น fail-closed** — บัญชีที่ยังไม่ตั้งทีมจะเงียบสนิท
--      ทั้งระบบทันที (หลักเดียวกับ `unscoped` ใน SimpleList ของ /mtn-repair)
--   ⇒ ทางแก้ที่ถูกต้องคือ **เติมข้อมูลให้ครบ** ไม่ใช่รัดด่าน
--
-- ── ขอบเขตที่แตะ: 37 บัญชี ──
--   เงื่อนไข: `mtn_teams` ว่าง **และ** role ∈ (supervisor, leader) **และ**
--            section ∈ (PD1, PD2, PD3, PD4) = ส่วนงานฝ่ายผลิต
--   (section อ่านจาก `profiles.section` ก่อน ถอยไป `employees.section` — แบบเดียวกับ notify_recipients)
--
-- ── ที่ **ไม่** แตะ และเหตุผล ──
--   · `manager` / `admin` (8 บัญชี) — เป็นสายกำกับดูแล ต้องเห็นทุกทีม ⇒ ปล่อยว่างให้ fail-open ทำงาน
--   · ส่วนงานที่ไม่ใช่ฝ่ายผลิต (Planning&Store ฯลฯ) — ไม่ใช่ทีม AM
--   · role `mtn` ที่ยังไม่ตั้งทีม — **ห้ามเดา** ว่าเป็น JIG/DIE/MTN ทีมไหน ต้องให้คนตั้งที่ /add-user
--
-- ⚠️ ผลข้างเคียงที่ตั้งใจ: หลังรันแล้ว เวลา PD กดเรียก **JIG / MTN / DIE**
--    37 บัญชีนี้จะ **ไม่ได้รับแจ้งเตือนนั้นอีก** (เพราะไม่ใช่ทีมที่ถูกเรียก)
--    — ยังได้รับตามปกติเมื่อ: เรียกทีม PRODUCTION (AM) · เครื่องหยุดเกินเกณฑ์ (`downtime_open_15min`)
--    · จอ Andon ยังเห็น "เครื่องไหนหยุด" ครบทั้งโรงงานเหมือนเดิม (ตัวกรองทีมห้ามกรองเครื่องหยุด)
--
-- ⚠️ ย้อนกลับได้: สำรองค่าเดิมไว้ใน archive.* · ดูบล็อก ROLLBACK ท้ายไฟล์
-- ════════════════════════════════════════════════════════════════════════════

begin;

create schema if not exists archive;

-- ── 1) สำรองค่าเดิมก่อนแก้ (schema archive — ห้ามไว้ public · กฎ CLAUDE.md) ────
create table if not exists archive.profiles_mtn_teams_20261006 as
  select id, full_name, role::text as role, section, mtn_teams, now() as backed_up_at
    from public.profiles;
alter table archive.profiles_mtn_teams_20261006 enable row level security;

-- ── 2) ตั้งทีม AM = production ให้หัวหน้า/ลีดเดอร์ฝ่ายผลิต ─────────────────────
update public.profiles p
   set mtn_teams = array['production']::text[]
  from (select id from public.profiles) _self
 where _self.id = p.id
   and coalesce(array_length(p.mtn_teams, 1), 0) = 0      -- เฉพาะที่ยังว่าง (รันซ้ำไม่ทับของที่ตั้งแล้ว)
   and p.role::text in ('supervisor', 'leader')
   and coalesce(
         nullif(trim(p.section), ''),
         nullif(trim((select e.section from public.employees e where e.id = p.employee_id)), '')
       ) in ('PD1', 'PD2', 'PD3', 'PD4');

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- ✅ คิวรีเช็คผล (รันใน SQL Editor ของ project "MAIN" · ewhdfqwfwofivojtsizn)
-- ════════════════════════════════════════════════════════════════════════════
-- 1) จำนวนบัญชีแยกตามทีม (คาดหวัง production +37)
--    select coalesce(mtn_teams::text,'(ว่าง)') teams, count(*) n
--      from public.profiles group by 1 order by 2 desc;
--
-- 2) ต้องไม่เหลือหัวหน้า/ลีดเดอร์ฝ่ายผลิตที่ยังไม่มีทีม (คาดหวัง 0)
--    select count(*) from public.profiles p
--     where coalesce(array_length(p.mtn_teams,1),0)=0
--       and p.role::text in ('supervisor','leader')
--       and coalesce(nullif(trim(p.section),''),'') in ('PD1','PD2','PD3','PD4');
--
-- 3) ซ้อมผู้รับก่อนของจริง — "ถ้าเรียกทีม JIG ตอนนี้ ใครได้บ้าง"
--    select p.full_name, p.role::text, p.section, p.mtn_teams
--      from public.profiles p
--     where p.id in (select public.notify_recipients('downtime_call_mtn', 'PD3', 'jig_maintenance', null))
--     order by 2, 1;
--    -- คาดหวัง: เหลือเฉพาะคนทีม JIG + manager/admin ที่ยังไม่ตั้งทีม
--    --          (ไม่มีหัวหน้า/ลีดเดอร์ PD อีกแล้ว)
--
-- 4) เทียบกับการเรียกทีมตัวเอง — PRODUCTION (AM) ต้องยังได้ครบ
--    select count(*) from public.profiles p
--     where p.id in (select public.notify_recipients('downtime_call_mtn', 'PD3', 'production', null));
--
-- ════════════════════════════════════════════════════════════════════════════
-- ⏪ ROLLBACK (คืนค่า mtn_teams เดิมทุกบัญชี)
-- ════════════════════════════════════════════════════════════════════════════
--  begin;
--  update public.profiles p set mtn_teams = b.mtn_teams
--    from archive.profiles_mtn_teams_20261006 b where b.id = p.id;
--  commit;
--  -- ไม่ต้อง revert โค้ดใดๆ — migration นี้แตะข้อมูลอย่างเดียว ไม่แตะ schema/RPC
-- ════════════════════════════════════════════════════════════════════════════
