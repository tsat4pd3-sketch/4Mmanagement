-- ═══════════════════════════════════════════════════════════════════════════
-- break_policies: เวลาพักที่ "ผูกกับปลายกะ" ไม่ใช่เวลานาฬิกา   (2026-10-20)
-- Project: DR — ชื่อในจอ Supabase "Product DB" (eyhclzkifitbhbljgoav)
-- ═══════════════════════════════════════════════════════════════════════════
-- ที่มา (feedback หน้างาน ผ่าน user 19/10):
--   *"วันที่เรามาทำโอ 8.00-17.00 เราสร้าง 16.40-17.00 5ส. อีก มันจะทับซ้อนกันมั้ยครับ"*
--   *"เวลา 5ส. ตรงนี้ไม่มี P เลยตก"*
--
-- 🔴 ปัญหา: ทะเบียนเดิมผูกพักกับ "เวลานาฬิกา" + มีมิติวันแค่ ot_scope (ทุกวัน/ทำโอ/ไม่ทำโอ)
--    ⇒ **ไม่มีช่องบอกว่า "วันหยุดที่มาทำโอ 8 ชม."** · 5ส. ของกะเช้ามีแค่ 17:10 กับ 19:40
--    ซึ่งอยู่ "นอกกรอบกะ 08:00–17:00" ⇒ กะวันหยุดไม่ถูกหักพัก 20 นาที = %A/%P ตกทั้งที่ทำงานครบ
--    วัดจริงกะ Laser LWR 17/10/2026 (08:00–17:00):
--      ก่อนลง 5ส.  ฐานเวลา 540−80−30 = 430 → %A 61.4 · %P 77.5 · OEE 47.57
--      หลังลง 5ส.  ฐานเวลา 540−80−50 = 410 → %A 59.5 · %P 83.8 · OEE 49.89  (ตรงกับที่ stamp ไว้)
--    และถ้าเพิ่มแถว 16:40 ด้วย ot_scope แบบใดก็ตาม จะไปหักพักเกิน 20 นาทีของ "วันทำงานปกติ"
--    (วัดด้วย breakIntervalsIn จริงทั้ง 3 แบบ → docs/modules/oee.md §เวลาพักท้ายกะ)
--
-- 💡 สิ่งที่ข้อมูลบอก: 5ส. ทุกแถวที่มีอยู่ = "20 นาทีสุดท้ายของกะ" อยู่แล้ว
--      17:10–17:30 (เลิก 17:30) · 19:40–20:00 (เลิก 20:00) · 07:40–08:00 (เลิก 08:00)
--    ⇒ ผูกกับ "ปลายกะ" แทน แล้วมันครอบทุกรูปแบบวันเองโดยไม่ต้องรู้ว่าวันไหนเป็นวันหยุด
--
-- ✅ back-compatible: แถวเดิมทั้งหมดได้ anchor='clock' = พฤติกรรมเดิมเป๊ะ
--    เวลาเลิกกะจริง 90 วัน มาตรฐาน 98.2% (1,700/1,732 กะ) ⇒ กะมาตรฐานได้ช่วงพักเท่าเดิมทุกนาที
-- ═══════════════════════════════════════════════════════════════════════════

-- ⚠️⚠️ ลำดับสำคัญ — ไฟล์นี้แบ่ง 2 ขั้น ห้ามรันขั้น B ก่อนโค้ดขึ้น production
--   ขั้น A (คอลัมน์+CHECK) = ปลอดภัยทุกเมื่อ · โค้ดเก่าไม่รู้จักคอลัมน์ใหม่ = ไม่กระทบอะไร
--   ขั้น B (ย้ายแถว 5ส.)   = ต้องรอ deploy ก่อน · รันก่อน = แถว 5ส. มี start_time null
--                            โค้ดเก่าอ่านเป็น '00:00' ⇒ **5ส. หายจากกะเช้าทั้งโรงงาน**
--                            และกะดึกได้พักปลอม 00:00–00:20

-- ═══ ขั้น A — คอลัมน์ใหม่  ✅ **apply แล้ว 2026-10-20** (ตรวจกลับ: คอลัมน์ 2 · CHECK 2 ·
--             start_time nullable · แถวที่ไม่ใช่ anchor='clock' = 0 ⇒ พฤติกรรมเดิมทุกจอ) ════
alter table public.break_policies
  add column if not exists anchor     text not null default 'clock',
  add column if not exists offset_min integer;

comment on column public.break_policies.anchor is
  'clock = เริ่มตามเวลานาฬิกา (start_time) · shift_end = เริ่มก่อนเลิกกะ offset_min นาที';
comment on column public.break_policies.offset_min is
  'เฉพาะ anchor=shift_end — เริ่มพักกี่นาทีก่อนเลิกกะ (เช่น 20 = เริ่ม 20 นาทีก่อนเลิก)';

-- start_time ไม่มีความหมายกับแถว shift_end ⇒ ต้องปล่อยว่างได้ (ไม่งั้นเหลือค่าเก่าค้างให้เข้าใจผิด)
alter table public.break_policies alter column start_time drop not null;

do $$ begin
  alter table public.break_policies add constraint break_policies_anchor_chk
    check (anchor in ('clock', 'shift_end'));
exception when duplicate_object then null; end $$;

-- 🔴 กฎความถูกต้องของข้อมูล — ตั้งผิดที่นี่ = %A/%P ทั้งโรงงานเพี้ยน
--    · clock     ต้องมีเวลาเริ่ม
--    · shift_end ต้องมี offset และพักต้องจบ "ไม่เกินเวลาเลิกกะ" (offset_min >= duration_min)
do $$ begin
  alter table public.break_policies add constraint break_policies_anchor_fields_chk
    check (
      (anchor = 'clock'     and start_time is not null)
      or
      (anchor = 'shift_end' and offset_min is not null and offset_min > 0
                            and offset_min >= duration_min)
    );
exception when duplicate_object then null; end $$;

-- ═══ ขั้น B — ย้าย 5ส. 3 แถว → แถวเดียวที่ผูกปลายกะ ══════════════════════
-- 🔴 รันขั้นนี้ **หลัง** โค้ดขึ้น production แล้วเท่านั้น (ดูคำเตือนด้านบน)
-- เดิม 3 แถวคือ "เรื่องเดียวกัน" ที่ถูกแตกตามรูปแบบวัน (ไม่ทำโอ / ทำโอ / กะดึก)
-- พอผูกปลายกะแล้วไม่ต้องแตกอีก — และได้กะวันหยุด 8 ชม. (16:40–17:00) มาฟรีด้วย
update public.break_policies
   set name_th    = '5ส. ท้ายกะ',
       name_en    = '5S (end of shift)',
       shift      = 'both',
       ot_scope   = 'always',
       anchor     = 'shift_end',
       offset_min = 20,
       start_time = null,
       updated_at = now()
 where name_th like '5ส.%' and start_time = '17:10:00';

-- อีก 2 แถวถูกแทนด้วยแถวข้างบนแล้ว — ปิดใช้ (ไม่ลบ เพื่อให้ย้อนกลับได้ และเห็นประวัติ)
update public.break_policies
   set is_active = false, updated_at = now()
 where name_th like '5ส.%' and start_time in ('19:40:00', '07:40:00');

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (ถ้าต้องย้อน — รันย้อนจากล่างขึ้นบน)
-- ═══════════════════════════════════════════════════════════════════════════
-- update public.break_policies set is_active = true
--  where name_th in ('5ส.(ทำโอ)', '5ส. กะดึก');
-- update public.break_policies
--    set name_th = '5ส.(ไม่ทำโอ )', name_en = '5S (NO OT)', shift = 'day',
--        ot_scope = 'no_ot', anchor = 'clock', offset_min = null, start_time = '17:10:00'
--  where name_th = '5ส. ท้ายกะ';
-- alter table public.break_policies drop constraint if exists break_policies_anchor_fields_chk;
-- alter table public.break_policies drop constraint if exists break_policies_anchor_chk;
-- alter table public.break_policies alter column start_time set not null;   -- ต้องไม่มีแถว start_time null ค้าง
-- alter table public.break_policies drop column if exists offset_min;
-- alter table public.break_policies drop column if exists anchor;
