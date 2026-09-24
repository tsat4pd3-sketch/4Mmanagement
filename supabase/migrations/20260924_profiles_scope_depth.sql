-- ─────────────────────────────────────────────────────────────────────────────
-- 🔭 แกน "ระดับ → เห็นกว้างแค่ไหน" — `profiles.scope_depth`         (Main project)
-- 2026-09-24 · docs/ORG-AXES-DECISION.md §5.2 (user เคาะ "ผูกระดับ + override รายคนได้")
--             · docs/ACCESS-CONTROL-STANDARDS.md §2 (role-centric RBAC-A)
--
-- ── ปัญหา ───────────────────────────────────────────────────────────────────
-- user: *"job level manager (role manager) มองได้หมด ซึ่งความจริงต้องดูด้วยว่า
--        เค้าอยู่แผนกไหน ส่วนงานไหน"* + *"ไม่งั้นตั้งการแจ้งเตือนมันจะมั่ว"*
--
-- วันนี้ `role` ทำหน้าที่ 2 อย่างพร้อมกัน: "ทำอะไรได้" **และ** "เห็นกว้างแค่ไหน"
-- ซึ่งเป็นคนละเรื่อง · และ "ความกว้าง" ถูกอนุมานจากการ **เว้นว่าง**:
--   `sections = []` ⇒ `effectiveSections()` คืน [] ⇒ ทุกตัวกรองผ่านหมด ⇒ **เห็นทั้งโรงงาน**
--
-- 🔴 ผิดมาตรฐาน 2 ข้อพร้อมกัน (docs/ACCESS-CONTROL-STANDARDS.md):
--   1. **role-centric RBAC-A (NIST)** — attribute ต้อง *ตัดสิทธิ์ให้แคบลง* เท่านั้น ห้ามขยาย
--      แต่ของเรา "ไม่ตั้ง" กลับ = กว้างสุด
--   2. **Deny by default (OWASP A01)** — ค่าเริ่มต้นต้องปฏิเสธ ไม่ใช่อนุญาต
--
-- ── ทางแก้ขั้นนี้: ทำของที่ "เดาเอาเงียบๆ" ให้กลายเป็น "ค่าที่เห็นได้และตรวจได้" ──
--   ⚠️ **ขั้นนี้ยังไม่เปลี่ยนพฤติกรรมของจอไหนเลย** — backfill ให้ผลลัพธ์เท่าเดิมเป๊ะทุกบัญชี
--      (ยังไม่มีโค้ดไหนอ่านคอลัมน์นี้ · การสลับตัวคำนวณ = ขั้นถัดไป และต้องพิสูจน์
--       ว่าให้ผลเท่าเดิมกับบัญชีจริงครบทั้ง 97 ใบก่อน)
--   ✅ สิ่งที่ได้ทันที: **ของใหม่เริ่มที่แคบ** (default `unit`) และ **รู้ว่าใครกว้างเพราะอะไร**
--
--   `scope_depth`  self   = เห็นเฉพาะของตัวเอง
--                  unit   = หน่วยที่สังกัด (ไลน์/ทีมตัวเอง)      ← default ของแถวใหม่
--                  branch = หน่วยตัวเอง + ทุกหน่วยที่อยู่ใต้ลงไป
--                  all    = ทั้งโรงงาน
--   `scope_depth_src` role_wide     = กว้างเพราะ role (admin/qa/ช่าง) — ตั้งใจมาแต่เดิม
--                     legacy_scoped = เคยตั้งขอบเขตไว้แล้ว (มี sections)
--                     🔴 legacy_open = **กว้างเพราะไม่เคยตั้ง ไม่ใช่เพราะมีคนตั้งใจ** ← ต้องมีคนมาทบทวน
--                     manual        = คนเลือกเองจากจอ (เชื่อได้)
--
-- ── วัดจริง 24/09 (97 บัญชี) ─────────────────────────────────────────────────
--   branch 45 · all(qa) 20 · all(ช่าง) 16 · **all fail-open 12** · all(admin) 4
--   ⇒ 52/97 (54%) เห็นทั้งโรงงานวันนี้ · ในนั้น **12 ใบกว้างโดยไม่มีใครตั้งใจ**
--
-- 📋 ISO 27001 A.5.18 บังคับ "ทบทวนสิทธิ์เป็นรอบ" — `legacy_open` คือคิวงานทบทวนใบแรกของเรา
--
-- ROLLBACK:
--   alter table public.profiles drop column if exists scope_depth, drop column if exists scope_depth_src;
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists scope_depth     text not null default 'unit',
  add column if not exists scope_depth_src text;

do $$ begin
  alter table public.profiles add constraint profiles_scope_depth_chk
    check (scope_depth in ('self', 'unit', 'branch', 'all'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.profiles add constraint profiles_scope_depth_src_chk
    check (scope_depth_src is null
           or scope_depth_src in ('role_wide', 'legacy_scoped', 'legacy_open', 'manual'));
exception when duplicate_object then null; end $$;

comment on column public.profiles.scope_depth is
  'เห็นกว้างแค่ไหน **นับจากหน่วยที่สังกัด** (org_node_id) — self/unit/branch/all · คนละแกนกับ role (ทำอะไรได้) · ขอบเขตตัดสิทธิ์ให้แคบลงเท่านั้น ห้ามขยาย (role-centric RBAC-A · docs/ACCESS-CONTROL-STANDARDS.md §2)';
comment on column public.profiles.scope_depth_src is
  'ที่มา: role_wide = กว้างเพราะ role · legacy_scoped = เคยตั้งขอบเขตไว้ · legacy_open = **กว้างเพราะไม่เคยตั้ง ต้องมีคนทบทวน (ISO 27001 A.5.18)** · manual = คนเลือกเอง';

-- ══════════════════════════════════════════════════════════════════
-- backfill — ต้องได้ผลลัพธ์ "เท่าพฤติกรรมวันนี้เป๊ะ" ทุกใบ
--   ลำดับเงื่อนไขล้อ effectiveSections() + scopedLineNames() ใน src/utils/sectionScope.js
--   ⚠️ แก้ลำดับนี้โดยไม่แก้โค้ดตาม = พฤติกรรมแตกกันเงียบๆ
-- ══════════════════════════════════════════════════════════════════
update public.profiles p set
  scope_depth = case
    when p.role::text = 'admin'                                     then 'all'
    when p.role::text = 'qa'                                        then 'all'   -- FACTORY_WIDE_ROLES
    when p.role::text in ('mtn', 'engineer')                        then 'all'   -- MAINTENANCE_ROLES
    when coalesce(array_length(p.sections, 1), 0) > 0               then 'branch'
    when p.role::text = 'supervisor' and coalesce(p.section,'') <> '' then 'branch'
    else 'all' end,
  scope_depth_src = case
    when p.role::text in ('admin', 'qa', 'mtn', 'engineer')         then 'role_wide'
    when coalesce(array_length(p.sections, 1), 0) > 0               then 'legacy_scoped'
    when p.role::text = 'supervisor' and coalesce(p.section,'') <> '' then 'legacy_scoped'
    else 'legacy_open' end
where p.scope_depth_src is null;
