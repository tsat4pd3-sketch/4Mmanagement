-- ══ 🏭 ตั้ง line_type ให้ไลน์ปั๊ม PD1 ที่ยังว่าง — LINE C / LINE D ═════════════════════
-- Target project: Main (ewhdfqwfwofivojtsizn) — "MAIN" ในจอ Supabase
--
-- ที่มา (user 2026-09-10): *"มันคือไลน์ stamping เหมือน line A กับ line B แก้ให้ที"*
-- ก่อนหน้านั้น (2026-09-09): *"มันขึ้นไลน์ไม่ครบนะ LINE C (200 Ton), (110&300 Ton) ก็ไม่ขึ้น"*
--
-- `LINE A ( 800 Ton )` / `LINE B ( 600 Ton )` ตั้งเป็น stamping ไว้แล้ว
-- แต่ `LINE C ( 200&250 Ton )` / `LINE D ( 110&300 Ton )` ของแผนก PD1 เดียวกัน **ยังเป็น null**
-- ⇒ ทุกตัวกรองที่อ่าน `isFormingLine(line_type)` มองไม่เห็น (dropdown ย้ายมินิสโตร์ ฯลฯ)
--
-- 🔴 หมายเหตุ: อาการ "หายจาก dropdown" แก้ที่โค้ดไปแล้ว (`moveTargets` มีตะกร้าท้าย
--    🏢 ไลน์อื่นทั้งโรงงาน — master ไม่ครบต้องจัดลำดับแย่ลง ไม่ใช่เลือกไม่ได้)
--    ไฟล์นี้เติม **ข้อมูลที่ขาด** เพื่อให้ 2 ไลน์นี้ถูกจัดขึ้นกลุ่ม ⭐ แนะนำตามที่ควรเป็น
--
-- ผลกระทบ (ไล่ทุกจุดที่อ่าน line_type แล้ว):
--   · `moveTargets` → LINE C/D เลื่อนจากตะกร้าท้าย ขึ้นกลุ่ม "🏭 ไลน์ขึ้นรูป" (ที่ต้องการ)
--   · `checkStockPlacement` → stamping = ไลน์ขึ้นรูป ⇒ จ่ายวัตถุดิบ 5xx เข้าไลน์นี้ **เลิกเตือนผิด**
--   · `checkIssueFlow` (bomTree) → เตือนเฉพาะไลน์ประกอบ ⇒ ไม่มีคำเตือนใหม่โผล่
--   · `/line-setup` แสดงป้ายประเภทไลน์ให้ถูกต้อง
--   ⇒ ไม่มีจุดไหนที่พฤติกรรมแย่ลง

update public.production_lines
   set line_type = 'stamping'
 where name in ('LINE C ( 200&250 Ton )', 'LINE D ( 110&300 Ton )')
   and line_type is null;              -- idempotent + ไม่ทับค่าที่คนตั้งเองทีหลัง

/* ══ ตรวจหลังรัน — PD1 ต้องเป็น stamping ครบทั้ง 4 ไลน์ ═══════════════════════════════
select name, section, line_type from public.production_lines
 where section='PD1' order by name;

   ══ ROLLBACK ═══════════════════════════════════════════════════════════════════
   update public.production_lines set line_type = null
    where name in ('LINE C ( 200&250 Ton )', 'LINE D ( 110&300 Ton )');
   ⇒ กลับไปอยู่ตะกร้าท้าย "🏢 ไลน์อื่นทั้งโรงงาน" (ยังเลือกได้ แค่ไม่ถูกแนะนำ)
══════════════════════════════════════════════════════════════════════════════════ */
