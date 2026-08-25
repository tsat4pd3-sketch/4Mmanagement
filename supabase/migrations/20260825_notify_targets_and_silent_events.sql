-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- 🔔 ยกเครื่องระบบแจ้งเตือน: Telegram ↔ ในแอป ใช้กติกาชุดเดียวกัน
--    + เลือกผู้รับได้ถึงระดับ "ส่วนงาน / แผนก / role"
--    + เก็บ 16 เรื่องที่พนักงานกรอกแล้ว "เงียบสนิท" เข้าระบบ
--    (2026-08-25 · คำสั่ง user: "upgrade ทั้งระบบ telegram กับ ใน app ต้องสอดคล้องตรงกัน
--     ส่วนเรื่องที่เงียบอยู่ต้องมีการแจ้งเตือนด้วย และสามารถ setup ได้ว่าจะแจ้งไปส่วนงานไหน
--     แผนกไหน role ไหนบ้าง")
--
-- ⚠️ ก่อนหน้านี้: `notification_rules.inapp_roles` เลือกได้แค่ "role" อย่างเดียว
--    → แจ้ง supervisor = เด้งหา supervisor **ทั้งโรงงาน** ทุกส่วนงาน
--    ตอนนี้เพิ่ม 3 แกน แล้วรวมตัวเลือกผู้รับไว้ที่ฟังก์ชันเดียว `notify_recipients()`
--
-- ⚠️ additive ล้วน — ค่าเดิมทุกแถวไม่ถูกแตะ (ส่วนงาน/แผนกว่าง = ไม่จำกัด = พฤติกรรมเดิมเป๊ะ)

-- ══════════════════════════════════════════════════════════════════
-- 1) แกนผู้รับเพิ่ม 3 ตัว
-- ══════════════════════════════════════════════════════════════════
alter table public.notification_rules
  add column if not exists inapp_sections      text[] default '{}'::text[],
  add column if not exists inapp_depts         text[] default '{}'::text[],
  add column if not exists inapp_match_section boolean not null default false;

comment on column public.notification_rules.inapp_sections is
  'จำกัดผู้รับในแอปเฉพาะส่วนงานเหล่านี้ · ว่าง = ทุกส่วนงาน';
comment on column public.notification_rules.inapp_depts is
  'จำกัดผู้รับในแอปเฉพาะแผนกเหล่านี้ (จาก employees.department ผ่าน profiles.employee_id) · ว่าง = ทุกแผนก';
comment on column public.notification_rules.inapp_match_section is
  'true = แจ้งเฉพาะคนที่ดูแล "ส่วนงานของเหตุการณ์นั้น" (เช่น downtime ไลน์ 60 → หัวหน้า PD2 เท่านั้น) · เหตุการณ์ที่ไม่มี context ส่วนงาน = แจ้งทุกคนตามปกติ';

-- ══════════════════════════════════════════════════════════════════
-- 2) ตัวเลือกผู้รับ — จุดเดียวของทั้งระบบ
--    ⚠️ edge function ทุกตัว + ฝั่งเว็บ ต้องเรียกตัวนี้ ห้ามเขียนเงื่อนไขกรองผู้รับเอง
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
           coalesce(inapp_match_section, false) as match_sec
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
          or p.role::text in ('admin', 'manager')         -- ไม่จำกัดขอบเขตอยู่แล้ว
          or (coalesce(array_length(p.sections, 1), 0) = 0
              and p.section is null and e.section is null) -- ไม่ได้ตั้ง scope = เห็นทั้งโรงงาน
          or p.section = p_section
          or p.sections && array[p_section]
          or e.section = p_section)
$$;

revoke all on function public.notify_recipients(text, text) from public, anon;
grant execute on function public.notify_recipients(text, text) to authenticated, service_role;

comment on function public.notify_recipients(text, text) is
  'คืน user id ที่ต้องได้รับแจ้งเตือน "ในแอป" ของ event นั้น ตาม role/ส่วนงาน/แผนก ที่ตั้งไว้ใน notification_rules · p_section = ส่วนงานของเหตุการณ์ (ใช้กับ inapp_match_section)';

-- ══════════════════════════════════════════════════════════════════
-- 3) 16 เรื่องที่ "เงียบสนิท" — พนักงานกรอกแล้วไม่มีใครรู้
--    ตรวจทั้งระบบ 2026-08-25: ตารางพวกนี้ถูก insert จากหน้าเว็บ แต่ไม่มีโค้ดไหน
--    ยิงแจ้งเตือนเลยสักช่องทาง (ทั้ง Telegram และในแอป)
--
--    ⚠️ ค่า inapp_roles ที่ seed ให้ = จุดตั้งต้นที่สมเหตุผล **ไม่ใช่ของตายตัว**
--       admin ปรับเองได้ที่ /notification-config (รวมส่วนงาน/แผนก)
--    ⚠️ `defect_recorded` seed inapp_roles ว่างโดยตั้งใจ — วัดจริง 2.4 ครั้ง/วัน
--       (กฎ CLAUDE.md: event ที่ยิงถี่ไม่ควรเข้ากระดิ่งโดยไม่ได้ตั้งใจ) → Telegram ก่อน
--       อยากให้เด้งมือถือค่อยติ๊ก role เอาเอง
-- ══════════════════════════════════════════════════════════════════
insert into public.notification_rules (event_key, label, category, is_enabled, sort_order, inapp_roles, inapp_match_section)
values
  ('skill_levelup_request',   '📊 ขออนุมัติอัพระดับทักษะ',            'manpower',   true, 310, array['supervisor','manager','admin'],              true),
  ('ojt_training',            '🎓 บันทึกใบอบรมสอนงาน OJT',            'manpower',   true, 320, array['supervisor','manager','admin'],              true),
  ('improvement_opened',      '💡 เปิดโปรเจคปรับปรุง (Kaizen)',        'production', true, 330, array['supervisor','manager','admin'],              true),
  ('meeting_action_assigned', '📌 มอบหมาย Action จากประชุมแถวเช้า',   'production', true, 340, array['supervisor','leader','manager','admin'],     true),
  ('user_feedback',           '💬 แจ้งปัญหา / ข้อเสนอแนะ จากหน้างาน', 'production', true, 350, array['admin','manager'],                           false),
  ('defect_recorded',         '🚫 บันทึกของเสีย',                      'quality',    true, 360, array[]::text[],                                    true),
  ('quality_bin_added',       '🗑️ ของเข้าถังเหลือง / ถังแดง',         'quality',    true, 370, array['qa','supervisor','manager','admin'],         true),
  ('scrap_report_submitted',  '🗑️ ส่งใบรายงานของเสีย (รออนุมัติ)',    'quality',    true, 380, array['qa','manager','admin'],                      true),
  ('qa_ncr_opened',           '🚫 เปิด NCR (ของไม่เป็นไปตามข้อกำหนด)', 'quality',   true, 390, array['qa','manager','admin'],                      true),
  ('qa_capa_opened',          '🛠️ เปิด CAPA / 8D',                     'quality',    true, 400, array['qa','manager','admin'],                      true),
  ('qa_claim_opened',         '📮 เคลมลูกค้าใหม่',                     'quality',    true, 410, array['qa','manager','admin','engineer'],           false),
  ('lpa_finding',             '📋 LPA พบข้อบกพร่อง (ตอบ N / T)',       'quality',    true, 420, array['supervisor','manager','admin','qa'],         true),
  ('pe_change_request',       '📐 คำขอแก้เอกสาร PE (PFMEA/CP/PFC)',    'quality',    true, 430, array['engineer','manager','admin'],                false),
  ('rack_request',            '📦 เรียกภาชนะเข้าไลน์',                 'logistic',   true, 440, array['planner_store','sale','manager','admin'],    false),
  ('wip_replenish',           '🔩 ขอเติมงานระหว่างผลิต (WIP)',        'logistic',   true, 450, array['planner_store','manager','admin'],           false),
  ('material_request',        '📦 ใบขอเบิก / คืนสินค้าคงคลัง',        'logistic',   true, 460, array['planner_store','sale','manager','admin'],    false)
on conflict (event_key) do nothing;

-- ตั้งห้อง Telegram ตั้งต้น = ห้องเดียวกับเรื่องอื่นในหมวดนั้น (ที่ตั้งไว้แล้ว)
-- → เปิดใช้ได้ทันทีโดยไม่ต้องไปเลือกห้องทีละเรื่อง · เปลี่ยนทีหลังที่ /notification-config
update public.notification_rules n
   set channel_ids = src.channel_ids
  from (
    select distinct on (category) category, channel_ids
      from public.notification_rules
     where coalesce(array_length(channel_ids, 1), 0) > 0
     order by category, sort_order
  ) src
 where n.category = src.category
   and coalesce(array_length(n.channel_ids, 1), 0) = 0
   and n.event_key in (
     'skill_levelup_request','ojt_training','improvement_opened','meeting_action_assigned',
     'user_feedback','defect_recorded','quality_bin_added','scrap_report_submitted',
     'qa_ncr_opened','qa_capa_opened','qa_claim_opened','lpa_finding','pe_change_request',
     'rack_request','wip_replenish','material_request'
   );

-- rollback:
--   delete from notification_rules where event_key in ( … 16 คีย์ข้างบน … );
--   drop function if exists public.notify_recipients(text, text);
--   alter table notification_rules drop column if exists inapp_sections,
--     drop column if exists inapp_depts, drop column if exists inapp_match_section;
