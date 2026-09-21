-- ─────────────────────────────────────────────────────────────────────────────
-- 🔔 "เรื่องนี้ไม่ยกเว้นผู้บริหารจากการกรองส่วนงาน" — `inapp_scope_strict`  (Main project)
-- 2026-09-21 · คำสั่ง user: *"ถ้า job level manager มองได้หมด ซึ่งความเป็นจริงก็ต้องดูด้วยว่า
--   เค้าอยู่แผนกไหน ส่วนงานไหน ใน organize ไม่งั้นจะมีปัญหาเรื่องตั้งการแจ้งเตือน มันจะมั่ว"*
--   + *"เอาเรื่องที่ยิงถี่ๆ ก่อน จนกว่าจะตั้ง org จบ"*
--
-- ── ปัญหา ───────────────────────────────────────────────────────────────────
--   `notify_recipients()` เขียน `or p.role in ('admin','manager')` = **ข้ามตัวกรองส่วนงานเสมอ**
--   ทั้งที่ ผจก. 3/4 คนตั้ง `sections` ไว้ชัดเจนแล้ว (ศักดา=PD1 · ศิริพร=PD2 · สุรเสน=Plan&Store+PD1-4)
--   ⇒ ผจก.PD1 ได้แจ้งเตือนของ PD2/PD3/PD4 ทุกใบ · 15/22 กฎที่กรองส่วนงานรั่วแบบนี้ทั้งหมด
--
--   วัดจริง 14 วัน (18/09) — ผจก. 4 คน:
--     ได้รับ 49.6-59.8 แถว/วัน/คน · **อ่านรวมกัน 2 แถวจาก 2,920 (0.07%)**
--     เรื่องที่ bypass มีผลจริง: mtn_handover 16.1/วัน (อ่าน 2/900) ·
--     skill_levelup_request 6.3/วัน (อ่าน 0/352) · defect_recorded 2.8/วัน (อ่าน 0/156)
--
-- ── ทางแก้ (ตั้งใจทำแบบ "ทีละเรื่อง" ไม่เหมารวม) ─────────────────────────────
--   เพิ่มธงรายกฎ `inapp_scope_strict` · **default false = ทุกกฎเดิมพฤติกรรมเหมือนเดิมเป๊ะ**
--   แล้วเปิด true เฉพาะ 3 เรื่องที่ยิงถี่ตามที่ user สั่ง
--   ⇒ ผจก.ลดจาก ~50 เหลือ ~25 แถว/วัน โดยไม่เสียอะไร (3 เรื่องนี้อ่านรวมกัน 2 จาก 1,408)
--
-- ⚠️ **ไม่แตะ fail-open "ไม่มี scope เลย = ผ่านทุกส่วนงาน" ในรอบนี้โดยตั้งใจ**
--    (ผจก.ชัยยุทธ ไม่มี section · ช่าง 8 คนไม่มี section) — ปิดตอนนี้ = คนหายจากระบบเงียบๆ
--    ต้องรอให้ผูกตัวตน/ตั้ง org ครบก่อน + มีจอ preview ว่าใครจะหาย (ดู docs/IDENTITY-NOTIFY-DESIGN.md §6.2)
--
-- ⚠️ ตระกูล `mtn_*` = 74% ของแจ้งเตือนทั้งระบบ **แต่ไม่มี manager/admin เป็นผู้รับอยู่แล้ว**
--    (ยกเว้น mtn_handover) ⇒ ธงนี้ช่วยตระกูลนั้นไม่ได้ ต้องรอแกน "ทีมช่าง" — อย่าเข้าใจผิด
--
-- ROLLBACK (ปลอดภัย ย้อนได้ทันที ไม่ต้องแตะโค้ด):
--   update notification_rules set inapp_scope_strict = false;   -- คืนพฤติกรรมเดิม 100%
--   -- ถ้าจะถอดคอลัมน์ด้วย ให้ restore ฟังก์ชันเวอร์ชันเดิมจาก 20260825_notify_targets_and_silent_events.sql ก่อน
--   -- แล้วค่อย: alter table notification_rules drop column inapp_scope_strict;
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.notification_rules
  add column if not exists inapp_scope_strict boolean not null default false;

comment on column public.notification_rules.inapp_scope_strict is
  'true = กฎนี้ไม่ยกเว้น admin/manager จากการกรองส่วนงาน (ใช้กับเรื่องที่ยิงถี่ — ผู้บริหารได้เฉพาะส่วนงานตัวเอง) · false = พฤติกรรมเดิม (ได้ทุกส่วนงาน)';

-- ══════════════════════════════════════════════════════════════════
-- ตัวเลือกผู้รับ — จุดเดียวของทั้งระบบ (แก้เฉพาะเงื่อนไข bypass)
--   ⚠️ signature เดิมเป๊ะ — edge function 7 ตัวเรียกผ่าน RPC นี้ ห้ามเปลี่ยนพารามิเตอร์
-- ══════════════════════════════════════════════════════════════════
create or replace function public.notify_recipients(p_event text, p_section text default null)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with r as (
    select coalesce(inapp_roles, '{}')      as roles,
           coalesce(inapp_sections, '{}')   as secs,
           coalesce(inapp_depts, '{}')      as depts,
           coalesce(inapp_match_section, false) as match_sec,
           coalesce(inapp_scope_strict, false)  as strict
      from notification_rules
     where event_key = p_event
  )
  select p.id
    from profiles p
    cross join r
    left join employees e on e.id = p.employee_id
   where coalesce(array_length(r.roles, 1), 0) > 0        -- ไม่ตั้ง role = ไม่แจ้งในแอป (opt-in)
     and p.role::text = any(r.roles)
     -- จำกัดส่วนงาน (ว่าง = ทุกส่วนงาน) — ยอมรับได้ทั้ง section เดี่ยว, sections[] และ section ของพนักงาน
     and (coalesce(array_length(r.secs, 1), 0) = 0
          or p.section = any(r.secs)
          or p.sections && r.secs
          or e.section = any(r.secs))
     -- จำกัดแผนก (ว่าง = ทุกแผนก) — แผนกอยู่ที่ employees ต้องผูกบัญชีกับพนักงานก่อน
     and (coalesce(array_length(r.depts, 1), 0) = 0
          or e.department = any(r.depts))
     -- แจ้งเฉพาะคนที่ดูแลส่วนงานของเหตุการณ์นั้น
     and (not r.match_sec
          or p_section is null                            -- เหตุการณ์ไม่มี context = ไม่กรอง (ห้ามเงียบ)
          -- 🔑 จุดเดียวที่เปลี่ยน: ยกเว้นผู้บริหาร "เฉพาะกฎที่ไม่ได้ตั้ง strict"
          or (not r.strict and p.role::text in ('admin', 'manager'))
          or (coalesce(array_length(p.sections, 1), 0) = 0
              and p.section is null and e.section is null) -- ไม่ได้ตั้ง scope = เห็นทั้งโรงงาน (ยังไม่ปิด — ดูหัวไฟล์)
          or p.section = p_section
          or p.sections && array[p_section]
          or e.section = p_section)
$$;

revoke all on function public.notify_recipients(text, text) from public, anon;
grant execute on function public.notify_recipients(text, text) to authenticated, service_role;

comment on function public.notify_recipients(text, text) is
  'คืน user id ที่ต้องได้รับแจ้งเตือน "ในแอป" ของ event นั้น ตาม role/ส่วนงาน/แผนก ที่ตั้งไว้ใน notification_rules · p_section = ส่วนงานของเหตุการณ์ (ใช้กับ inapp_match_section) · inapp_scope_strict = true แปลว่าผู้บริหารก็ถูกกรองตามส่วนงานเหมือนคนอื่น';

-- ══════════════════════════════════════════════════════════════════
-- เปิด strict เฉพาะ 3 เรื่องที่ยิงถี่ (ตามที่ user เคาะ 21/09)
--   เกณฑ์ที่ใช้เลือก: (ก) มี manager/admin เป็นผู้รับ (ข) กรองส่วนงานอยู่แล้ว
--   (ค) ปริมาณสูง (ง) ผู้บริหารแทบไม่อ่าน — ครบทั้ง 4 ข้อเท่านั้น
-- ══════════════════════════════════════════════════════════════════
update public.notification_rules
   set inapp_scope_strict = true, updated_at = now()
 where event_key in ('mtn_handover', 'skill_levelup_request', 'defect_recorded');
