-- ติดป้าย account_kind='shared' ให้บัญชีที่ "ไม่ใช่คน" — บัญชีหน่วยงาน / อุปกรณ์
--
-- ทำไม: worklist "บัญชีที่ยังไม่ผูกฐานพนักงาน" ใน /add-user มี 48 รายการ
--   ในนั้น 13 ตัวเป็นบัญชีกลางของหน่วยงาน/จอ ซึ่ง "ไม่ควรผูก" อยู่แล้วตามดีไซน์
--   (CLAUDE.md ยกตัวอย่างไว้ตรงตัว: maintenance / warehouse1 / delivery1 / Display / ADMIN)
--   ติดป้ายแล้ว worklist จะเหลือแต่ "คนจริงที่ยังไม่ผูก" = ไล่ทำจบได้
--
-- ⚠️ ไม่กระทบพฤติกรรมใดๆ — account_kind เป็นป้ายจำแนกอย่างเดียว
--   ไม่ได้ใช้ใน notify_recipients / scope / สิทธิ์ ที่ไหนเลย
--
-- ⚠️ รายชื่อ fix ไว้ตายตัวโดยตั้งใจ ไม่ใช้ pattern เดา
--   (กฎ CLAUDE.md: "ระบบไม่เดาว่าบัญชีไหนเป็นแบบไหน") — บัญชีใหม่ที่เพิ่มทีหลัง admin ตั้งเองที่ /add-user
--
-- ⚠️ ไม่แตะบัญชีทดสอบ (qa test / leader test / leader pd3 test) โดยตั้งใจ
--   พวกนั้นควร "ลบทิ้ง" ไม่ใช่ติดป้ายว่าเป็นบัญชีหน่วยงาน — ให้ admin ตัดสินเอง
--
-- ย้อนกลับ: update profiles set account_kind = null where account_kind = 'shared';

update public.profiles
   set account_kind = 'shared'
 where employee_id is null
   and account_kind is null
   and full_name in (
     -- ทีมช่าง
     'maintenance', 'jigmaintenance', 'toolingmaintenance',
     -- คลัง / จัดส่ง / ขาย
     'warehouse1', 'warehouse2', 'delivery1', 'delivery2', 'planningstore', 'billing',
     -- วิศวกรรม
     'processengineering',
     -- ระบบ / อุปกรณ์
     'ADMIN', 'Display'
   );
