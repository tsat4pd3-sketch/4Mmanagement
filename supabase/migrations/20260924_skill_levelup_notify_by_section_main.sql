-- ════════════════════════════════════════════════════════════════════════════════
-- 🔕 ลดกระดิ่งท่วม #1 — คำขออัพระดับทักษะ: แจ้ง "แยกรายส่วนงาน" แทนยิงทุกคน
-- Project: MAIN (ewhdfqwfwofivojtsizn)          วันที่: 2026-09-24
--
-- ที่มา — วัดจริง 24/09 (กระดิ่ง 7 วันล่าสุด):
--   ทั้งระบบ 22,029 ใบ ถึง 94 คน = ~33 ใบ/คน/วัน · **อ่านแค่ 6.9%**
--   อันดับ 1 = "📊 ขออนุมัติอัพระดับทักษะ" **1,247 ใบ ถึง 29 คน อ่าน 2.2%**
--
--   พิสูจน์ว่าเป็น fan-out ไม่ใช่ยิงซ้ำ: เกิด **วันเดียว (21/09)** · 43 เนื้อความต่างกัน ·
--   ผู้รับ 29 คน → 43 × 29 = 1,247 เป๊ะ ⇒ **1 คำขอ = เด้ง 29 คน**
--
-- 🔴 รูทคอส: ทะเบียนตั้ง `inapp_match_section = true` ไว้แล้ว **แต่ trigger ไม่ส่ง section ไปให้**
--   ⇒ `notify_recipients(event, NULL)` = ตัวกรองส่วนงานไม่ทำงานเลย → ได้ทุกคนที่ role ตรง
--   วัดยืนยัน: notify_recipients('skill_levelup_request', NULL) = 31 คน
--              notify_recipients('skill_levelup_request','PD1') = 10 · PD2 = 8 · PD3 = 17 · PD4 = 9
--
-- ✅ ที่แก้: จัดกลุ่มแถวใหม่ **ตามส่วนงานของพนักงาน** แล้วยิง 1 ข้อความต่อ 1 ส่วนงาน พร้อมส่ง `section`
--   ⇒ หัวหน้าเห็นเฉพาะคำขอของลูกน้องตัวเอง · คาดว่าจาก 1,247 ใบ เหลือ ~40-60 ใบ (ลด ~95%)
--
-- 🔴 กฎที่รักษาไว้ (ห้ามพลาดตอนแก้ต่อ):
--   1. **พนักงานที่ยังไม่ตั้ง section = ยิงแบบไม่ระบุขอบเขตเหมือนเดิม ห้ามเงียบ**
--      (ข้อมูลทะเบียนไม่ครบ ไม่ใช่เหตุให้คำขอหายไปจากคิว) + เขียนบนข้อความว่าไม่รู้ส่วนงาน
--   2. **แจ้งเตือนล้ม ห้ามทำให้ job สกิลพัง** — `exception when others then return null` คงไว้
--   3. เพดาน 200 แถว/ส่วนงาน คงไว้ (กันข้อความยาวเกิน)
--
-- ⚠️ ไม่แตะ `notify_recipients` — ผู้รับยังมาจาก RPC จุดเดียวของระบบตามกฎเดิม
--    นี่คือการส่ง "ขอบเขตของเหตุการณ์" ให้ครบ ไม่ใช่การเขียนเงื่อนไขกรองผู้รับเอง
--
-- ROLLBACK: คืนฟังก์ชันเดิม (ไม่ group ตามส่วนงาน · ไม่ส่ง section) —
--   ดูนิยามเดิมในไฟล์นี้ใต้หัวข้อ "-- === เวอร์ชันเดิมก่อน 24/09 ===" ท้ายไฟล์
--   ไม่มีการเปลี่ยน schema/ตาราง = revert ได้ทันทีโดยไม่กระทบข้อมูล
-- ════════════════════════════════════════════════════════════════════════════════

create or replace function public.fn_notify_skill_levelup()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sec   text;
  v_rows  jsonb;
  v_count int;
begin
  /* 1 ข้อความต่อ 1 ส่วนงาน — ส่วนงานที่ยังไม่ตั้ง (null) ถูกจับเป็นกลุ่มของตัวเอง
     แล้วส่ง section = null ⇒ ยิงกว้างเหมือนเดิม (ห้ามทำให้คำขอหายเงียบ) */
  for v_sec in
    select distinct nullif(trim(e.section), '')
      from new_rows n
      left join employees e on e.id = n.employee_id
  loop
    select count(*), jsonb_agg(x order by x->>'nm')
      into v_count, v_rows
      from (
        select jsonb_build_object(
                 'nm', coalesce(e.name, 'ไม่ทราบชื่อ'),
                 'sk', n.skill_name,
                 'lv', n.to_level
               ) as x
          from new_rows n
          left join employees e on e.id = n.employee_id
         where nullif(trim(e.section), '') is not distinct from v_sec
         limit 200
      ) t;

    continue when coalesce(v_count, 0) = 0;

    perform net.http_post(
      url := 'https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-event-notification',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'event', 'skill_levelup_request',
        'type', 'info',
        'ref_table', 'skill_level_up_requests',
        -- 🔑 บรรทัดที่ขาดไปเดิม — ไม่ส่งอันนี้ = ตัวกรองส่วนงานในทะเบียนไม่ทำงานเลย
        'section', v_sec,
        'lines', (
          select jsonb_build_array(format('📊 มีคำขออัพระดับทักษะรออนุมัติ %s รายการ%s',
                    v_count,
                    case when v_sec is null then ' (ยังไม่ระบุส่วนงานในทะเบียนพนักงาน)'
                         else ' · ' || v_sec end))
               || coalesce((
                    select jsonb_agg(format('  • %s — %s → ระดับ %s',
                             r->>'nm', r->>'sk', r->>'lv'))
                      from jsonb_array_elements(v_rows) r
                     where (r->>'nm') is not null
                  ), '[]'::jsonb)
               || jsonb_build_array('👉 อนุมัติที่ ฐานข้อมูลพนักงาน → แท็บ ⬆️ คำขออัพระดับ')
        )
      )
    );
  end loop;
  return null;
exception when others then return null;   -- แจ้งเตือนล้ม ห้ามทำให้ job สกิลพัง
end;
$function$;

-- === เวอร์ชันเดิมก่อน 24/09 (เก็บไว้สำหรับ rollback) ===
-- ยิงครั้งเดียวรวมทุกส่วนงาน ไม่ส่ง 'section' ⇒ notify_recipients ได้ p_section = null
-- ⇒ ผู้รับ = ทุกคนที่ role ตรง (31 คน) ต่อ 1 statement
