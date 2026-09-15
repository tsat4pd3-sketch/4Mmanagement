/* ═══════════════════════════════════════════════════════════════════════════
   break_policies.ot_scope — นโยบายพักที่ใช้ "เฉพาะกะที่ทำโอ / เฉพาะกะที่ไม่ทำโอ"
   (DR project — eyhclzkifitbhbljgoav "Product DB")                2026-09-14

   ที่มา (user จับได้เอง): กะเช้า 08:00-17:30 หักพัก 100 นาที · 08:00-20:00 หัก 150
   ต่างกัน 50 ทั้งที่ควรต่างแค่ 30 (เบรค OT) — เพราะ 5ส. ถูกนับ 2 รอบ:
     · "5ส.(ไม่ทำโอ)" 17:10 20 นาที   ← ทำเฉพาะวันที่ไม่ทำโอ
     · "5ส.(ทำโอ)"   19:40 20 นาที   ← ทำเฉพาะวันที่ทำโอ
   ตาราง break_policies ไม่มีช่องบอกเงื่อนไขนี้ → `policyBreakOverlapMin` กวาดทั้ง 2 แถว
   ⇒ กะเช้าที่ทำโอ (453 กะใน 90 วัน) หักพักเกินจริง 20 นาที ⇒ %A ต่ำกว่าจริง ~0.3-0.5 จุด
   (กระทบทุกจอที่ใช้สูตรกลาง: Daily Report · OEE Analytics · VSM · Heijunka · FactoryMap ฯลฯ)

   กติกาในโค้ด (src/utils/oee.js §3): ถ้ากรอบกะครอบนโยบาย ot_scope='ot' อยู่แล้ว
   = กะนี้ทำโอ ⇒ ทิ้งนโยบาย 'no_ot' ทั้งหมด — ไม่ต้อง hardcode เวลาเลิกงานที่ไหนเลย
     · 08:00-20:00 ครอบ 19:40 (ot) ⇒ ทิ้ง 17:10 ⇒ 130 นาที ✅
     · 08:00-17:30 ไม่ถึง 19:40    ⇒ เก็บ 17:10 ⇒ 100 นาที ✅ (ต่างกัน 30 ตามจริง)

   ⚠️ กะดึก **ไม่แตะ** (user ยืนยัน 14/09 ว่า 140 นาทีถูกแล้ว): ประชุมแถว 2 รอบของกะดึก
   ไม่ใช่การนับซ้ำ — 20:00 = ประชุมของชุดที่เข้าโอ · 22:30 = ประชุมของชุดที่เข้ากะปกติ
   (ฐานจริง 90 วัน: กะดึกเริ่ม 20:00 = 531 กะ · เริ่ม 22:30 = 99 กะ)

   backward-compatible: แถวเดิมได้ 'always' = พฤติกรรมเดิมเป๊ะ · ย้อนได้ด้วย drop column
   ═══════════════════════════════════════════════════════════════════════════ */

alter table break_policies add column if not exists ot_scope text not null default 'always';

alter table break_policies drop constraint if exists break_policies_ot_scope_chk;
alter table break_policies add constraint break_policies_ot_scope_chk
  check (ot_scope in ('always', 'ot', 'no_ot'));

comment on column break_policies.ot_scope is
  'always = ใช้ทุกกะ · ot = เฉพาะกะที่ทำโอ · no_ot = เฉพาะกะที่ไม่ทำโอ (ดู policyBreakOverlapMin)';

-- ตั้งค่าตามนโยบายจริงของกะเช้า (idempotent รันซ้ำได้)
-- ⚠️ ชื่อในฐานมีช่องว่างเกินท้ายวงเล็บ ("5ส.(ไม่ทำโอ )") — เทียบ `=` ตรงตัวแล้ว **ไม่ match เงียบๆ**
--    (เกิดจริงตอน apply รอบแรก: แถว ot ถูกตั้ง แถว no_ot ไม่ถูกตั้ง ⇒ ยังหักพัก 150 เหมือนเดิม)
--    ⇒ ใช้ like กับคำสำคัญแทน และเช็คผลกลับทุกครั้งหลัง apply
update break_policies set ot_scope = 'no_ot'
  where shift = 'day' and name_th like '5ส.%' and name_th like '%ไม่ทำโอ%';
update break_policies set ot_scope = 'ot'
  where shift = 'day' and (
    (name_th like '5ส.%' and name_th like '%(ทำโอ%')     -- 5ส. รอบวันที่ทำโอ
    or name_th like 'พักเบรค OT%'                        -- เบรค OT กะเช้า
  );

-- เช็คผล (ควรได้ 3 แถว: 17:10 = no_ot · 17:30 = ot · 19:40 = ot)
-- select name_th, start_time, duration_min, ot_scope from break_policies where ot_scope <> 'always' order by start_time;
