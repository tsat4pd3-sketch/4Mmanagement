-- ═══════════════════════════════════════════════════════════════════════════════
-- 📊 ทะเบียน "รูปแบบกะ" สำหรับเพดานกำลังผลิตรายเดือน (DR project)
--    Supabase: "Product DB" · eyhclzkifitbhbljgoav
--    2026-09-24 · user: "capacity โรงงานเราดูกันแบบนี้ แต่ในโปรแกรมเราเป็นแบบนี้ คนจะดูไม่เข้าใจ"
--
-- ค่า seed ถอดจากสไลด์จริง Capacity_TSATP.4_update_June_26.pptx (มิ.ย. 2026):
--   ทุกไลน์ในสไลด์ใช้ `2 shift = วันทำงาน × 15.5 ชม.` ⇒ 1 กะ = 7.75 ชม. (465 นาที)
--   และ OT = +2 ชม./กะ · เพดาน +Sat/Max ต่างที่ "จำนวนวัน" ไม่ใช่ชั่วโมง/วัน
--
-- ⚠️ 465 นาที **ตั้งใจให้ต่าง** จาก netShiftMin(570,80)=490 ของ capacityModel.js
--    490 = เวลาเดินเครื่องได้ (แผนรายวัน · กะนี้ทำได้กี่ชิ้น)
--    465 = เวลาที่ฝ่ายวางแผนใช้คิดเพดานรายเดือน (ตัดเตรียม/ส่งงานออกอีกชั้น)
--    **ห้ามไปแก้ DEFAULT_SHIFT_MIN ให้เท่ากัน** — แผนรายวันจะเพี้ยนทั้งระบบ
--    ตารางนี้มีไว้ให้ฝ่ายวางแผนแก้เองเมื่อโรงงานเปลี่ยนนโยบายเวลา ไม่ต้องแก้โค้ด
--
-- ⚠️ RLS: DR project ใช้ client `supabaseDR` ซึ่ง **วิ่งด้วย role anon เสมอ** (ไม่เคย authenticate)
--    ⇒ policy ต้องเปิด public เหมือนตารางอื่นในโปรเจคนี้ ห้ามใช้ TO authenticated (เคยทำพังทั้งระบบ)
--
-- Rollback: drop table public.capacity_shift_patterns;
--           (โค้ดถอยไปใช้ SEED_PATTERNS ใน src/utils/capacityPatterns.js เองอยู่แล้ว — จอไม่พัง)
-- ═══════════════════════════════════════════════════════════════════════════════

create table if not exists public.capacity_shift_patterns (
  key            text primary key,
  label          text not null,
  hours_per_day  numeric not null,
  -- เพดานต่างกันที่จำนวนวันด้วย: working = วันทำงาน · working_sat = +เสาร์ · all = ทุกวันในเดือน
  day_source     text not null default 'working',
  sort_order     int  not null default 0,
  color          text,
  is_active      boolean not null default true,
  note           text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  constraint capacity_shift_patterns_day_source_chk
    check (day_source in ('working', 'working_sat', 'all')),
  constraint capacity_shift_patterns_hours_chk
    check (hours_per_day > 0 and hours_per_day <= 24)
);

insert into public.capacity_shift_patterns (key, label, hours_per_day, day_source, sort_order, color, note) values
  ('1s',     '1 กะ',            7.75, 'working',     1, '#22c55e', 'ถอดจากสไลด์: 2 shift = วันทำงาน × 15.5 ⇒ 1 กะ = 7.75 ชม.'),
  ('1s_ot',  '1 กะ + OT',       9.75, 'working',     2, '#84cc16', 'OT = +2 ชม./กะ'),
  ('2s',     '2 กะ',           15.50, 'working',     3, '#f59e0b', 'คอลัมน์หลักของสไลด์ (`2 shift`)'),
  ('2s_ot1', '2 กะ + OT 1 กะ', 17.50, 'working',     4, '#fb923c', null),
  ('2s_ot2', '2 กะ + OT 2 กะ', 19.50, 'working',     5, '#ef4444', null),
  ('2s_sat', '+ ทำเสาร์',       19.50, 'working_sat', 6, '#a855f7', 'ต่างที่จำนวนวัน — เอาเสาร์มานับเป็นวันทำงานเพิ่ม'),
  ('max',    'Max (เต็มที่)',   24.00, 'all',         7, '#64748b', 'เพดานทางทฤษฎี 24 ชม. ทุกวัน — ใช้เป็นเส้นอ้างอิงเท่านั้น')
on conflict (key) do nothing;

alter table public.capacity_shift_patterns enable row level security;

drop policy if exists capacity_shift_patterns_all on public.capacity_shift_patterns;
create policy capacity_shift_patterns_all on public.capacity_shift_patterns
  for all using (true) with check (true);

comment on table public.capacity_shift_patterns is
  'รูปแบบกะสำหรับเพดานกำลังผลิตรายเดือน (/production-plan?tab=capacity) — ศัพท์ตรงกับสไลด์ Capacity ของฝ่ายวางแผน';
