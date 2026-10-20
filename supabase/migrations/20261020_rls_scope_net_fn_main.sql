-- ═══════════════════════════════════════════════════════════════════════════
-- ชั้นที่ 3 ของสิทธิ์ ลงไปถึง "ชั้น DB" — ส่วนที่ 1: ตัวตัดสิน (ยังไม่มีใครเรียก)
-- Project: MAIN (ewhdfqwfwofivojtsizn)   ·   2026-10-20   ·   QC audit §7.1
--
-- ทำไม: RLS ฝั่ง Main 154 policy เป็น `has_perm()` เปล่า = ตอบแค่ "กดปุ่มเป็นไหม"
--       ไม่เคยถามว่า "แถวนี้ของหน่วยงานเราไหม" ⇒ คนยิง REST ตรงข้ามด่านจอได้ทั้งหมด
--
-- 🔴 กติกาของตัวนี้ = **fail-open ที่ DB · fail-closed ที่จอ**
--    ด่าน DB เป็น "ตาข่ายชั้นสอง" ไม่ใช่เจ้าของกฎ — ตัดสินไม่ได้เมื่อไหร่ให้ผ่าน
--    (กฎจริงอยู่ที่ src/utils/writeScope.js ซึ่งละเอียดกว่า: แกน CC + ผังองค์กร + ไลน์แม่-ลูก)
--    เหตุผล: ถ้า DB เข้มกว่าจอแม้แต่เคสเดียว = หน้างานบันทึกไม่ได้ทั้งโรงงาน (ล่ม = เปิดกะไม่ได้)
--
-- ผ่านเสมอเมื่อ: ไม่มี JWT (service_role/edge) · ถือ scope:all_units · ไม่รู้ไลน์ของแถว
--               · บัญชีไม่มี profile · บัญชีไม่ได้ตั้งส่วนงาน · ไลน์ไม่รู้ส่วนงาน
--               · บัญชีตั้งแกน Cost Center ไว้ (ปล่อยให้จอเป็นคนตัดสิน ด่าน DB ไม่เดาแทน)
-- บล็อกเฉพาะ: รู้ครบทุกอย่างแล้วและ "ส่วนงานของไลน์ ≠ ส่วนงานบ้านของคนเขียน"
--
-- ย้อนกลับ: drop function public.app_can_write_line(text);
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.app_can_write_line(p_line text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then true                      -- ไม่มี JWT = ไม่ใช่คน (edge/service) ⇒ ไม่ตัดสิน
    when public.has_perm('scope:all_units') then true      -- ใบผ่านข้ามหน่วยงาน
    when coalesce(p_line, '') = '' then true               -- แถวไม่ระบุไลน์ = ตัดสินไม่ได้
    else coalesce((
      select
        (pr.resp_cost_centers is not null and array_length(pr.resp_cost_centers, 1) > 0)  -- แกน CC → ให้จอตัดสิน
        or coalesce(pr.section, '') = ''                   -- ไม่มีบ้านจริง = ตัดสินไม่ได้
        or l.section is null                               -- ไลน์ไม่รู้ส่วนงาน = ตัดสินไม่ได้
        or l.section = pr.section                          -- ของหน่วยงานเราเอง
      from public.profiles pr
      left join public.production_lines l on l.name = p_line
      where pr.id = auth.uid()
    ), true)                                               -- ไม่มี profile = ตัดสินไม่ได้
  end;
$$;

comment on function public.app_can_write_line(text) is
  'ชั้นสิทธิ์ที่ 3 ฝั่ง DB (ตาข่ายชั้นสอง · fail-open) — "ไลน์นี้อยู่ในส่วนงานบ้านของผู้เขียนไหม" '
  'กฎจริงอยู่ที่ src/utils/writeScope.js · ห้ามทำให้เข้มกว่าจอ (ดูหัวไฟล์ migration 20261020)';

grant execute on function public.app_can_write_line(text) to authenticated;
