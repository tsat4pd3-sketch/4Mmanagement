/* public.machine_key() ต้องตัด "วรรณยุกต์/สระไทยลอย" ให้ตรงกับ machineKey() ใน
   src/utils/machineNo.js  (DR · 2026-11-09 · apply แล้ว)

   ⇒ typo ที่พิมพ์ใหม่ (`ฺBD-08`) ยุบเข้าแท่งเดียวกับ `BD-08` ทันที ไม่ต้องรอ backfill รอบหน้า
   🔴 ฐานรวมสระ ก-๎ (ไม่ใช่แค่พยัญชนะ) — ไม่งั้นกิน เครื่อง→เครือง
   🔴 **แก้ฟังก์ชันนี้เมื่อไหร่ ต้องตามไปแก้ `machineKey()` ฝั่ง JS เสมอ** (มีด่าน machine-key-sql-js-sync)
   ⚠️ ตอน apply ไม่มีแถวไหนเหลือมาร์คลอยแล้ว ⇒ ไม่ขยับคีย์ของข้อมูลเดิมแม้แต่ตัวเดียว (กันล่วงหน้าล้วน) */
create or replace function public.machine_key(txt text)
returns text language sql immutable parallel safe as $function$
  select regexp_replace(
           upper(regexp_replace(
             regexp_replace(coalesce(txt,''), '(^|[^\u0E01-\u0E4E])[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]+', '\1', 'g'),
             '[^A-Za-z0-9฀-๿]', '', 'g')),
           '^([A-Z฀-๿]+)0*([0-9]+)$', '\1\2')
$function$;
