-- ══ ⏰ เก็บ "เวลาส่งตามแผนเดิม" ไว้ เมื่อ e-SMART ย้ายไปเวลารับจริง ═══════════════════
-- Target project: DR (eyhclzkifitbhbljgoav) — "Product DB" ในจอ Supabase
--
-- ที่มา (user 2026-09-10): *"รอบ AAT ยังไม่ตรงนะ มันควรขึ้น 11 ปะ ไม่ใช่ 10 โมง"*
--
-- 862 = เวลาตามแผน (10:00) · ตารางรอบรับของลูกค้า = **เวลาที่รถมาถึงจริง** (11:00)
-- ⇒ เมื่อ e-SMART ยืนยันออเดอร์ ต้องย้าย `ship_time` ไปเป็นเวลารับจริง
--    หน้างานเตรียมของตามเวลาที่รถมา ไม่ใช่เวลาที่วางแผนไว้
-- 🔴 กฎเดิม "ห้ามแก้ ship_time" ที่เขียนไว้ 2026-09-09 **ยกเลิก** — เป็นกฎที่ AI ตั้งเอง
--    ไม่ใช่คำสั่ง user และทำให้จอบอกเวลาที่ไม่มีรถมารับ
--
-- คอลัมน์นี้เก็บเวลาเดิมไว้ (แบบเดียวกับ `plan_qty` เก็บยอดเดิม) ⇒ เทียบแผน vs จริงได้
-- nullable + ไม่มี default ⇒ backward-compatible · client ทน 42703 อยู่แล้วถ้ายังไม่ apply

alter table public.customer_shipping_orders
  add column if not exists plan_ship_time text;

comment on column public.customer_shipping_orders.plan_ship_time is
  'เวลาส่งตามแผน 862 ก่อนถูก e-SMART ย้ายไปเวลารถมารับจริง (คู่กับ plan_qty) — เขียนครั้งแรกที่ยืนยันเท่านั้น ห้ามทับตอนอัพซ้ำ';

/* ══ ตรวจหลังรัน ═══════════════════════════════════════════════════════════════════
select column_name, data_type from information_schema.columns
 where table_name='customer_shipping_orders' and column_name in ('plan_qty','plan_ship_time');

   ══ ROLLBACK ═══════════════════════════════════════════════════════════════════
   alter table public.customer_shipping_orders drop column if exists plan_ship_time;
   ⇒ client ตกไป fallback 42703 เอง (ยังอัพเดทยอด+เวลาได้ แค่ไม่เก็บเวลาแผนเดิม)
══════════════════════════════════════════════════════════════════════════════════ */
