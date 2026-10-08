-- 20260923_billing_to_warehouse_delivery.sql  ·  ⚠️ Main project — "MAIN" (ewhdfqwfwofivojtsizn)
-- แก้การจัดกลุ่มที่ผมเข้าใจผิดใน `20260923_role_warehouse_delivery_seed.sql` (user แก้ให้ 23/09):
--
--   ❌ ที่เข้าใจผิด: billing = "ออกบิล/ข้อมูล ไม่ได้ถือของ" → จัดเป็นฝั่ง แผนงาน & ข้อมูล (`sale`)
--   ✅ ของจริง:     **billing = ออกใบขาย · นั่งรวมกับทีมจัดส่ง** → ฝั่ง Warehouse & Delivery
--                  ส่วน "แผนงาน & ข้อมูล" เป็นงานของ **planning** (บัญชี `planningstore`)
--                  ซึ่งนั่งอยู่กับ sale — ไม่ใช่ billing
--
-- ไม่มีใครเสียสิทธิ์: `warehouse_delivery` ตั้งต้นจาก copy ของ `sale` ทั้งชุด + rack-center
-- ⇒ billing ได้เท่าเดิมทุกอย่าง + หน้าภาชนะ/Packaging เพิ่ม
-- (ESM ไม่มีฟีเจอร์ออกใบขาย/วางบิลในตัว — billing ออกบิลผ่าน SAP ตามที่ระบุใน src/utils/logisticSide.js
--  จึงไม่มีคีย์สิทธิ์เฉพาะทางที่ต้องเติมให้)
update public.profiles set role = 'warehouse_delivery'::user_role
 where id = 'ff302a36-04da-4ddb-a133-56ae481c8fce';   -- billing

-- ⚠️ ผลที่ตามมา — role `sale` เหลือ **0 บัญชี** (billing เป็นคนสุดท้ายที่ถืออยู่)
--    ตั้งใจปล่อยไว้เป็น role สำรองของทีม Sales จริงที่ยังไม่มี login · สิทธิ์ที่ seed ไว้ยังอยู่ครบ
--    เปิดบัญชี Sales เมื่อไหร่เลือก role นี้ได้เลย
--    🔴 แต่ต้องจำกฎที่ตกผลึกไว้: **"สิทธิ์ที่ seed ไว้กับ role ที่ไม่มีบัญชีใช้ = สิทธิ์ที่ไม่มีอยู่จริง"**
--       ห้าม seed สิทธิ์ใหม่ให้ `sale` แล้วเข้าใจว่าหน้างานได้ไปแล้ว — เช็คเสมอว่ามีกี่บัญชีถือ role นั้นจริง
--       (บทเรียน 22/09: planner_store มีสิทธิ์ครบแต่ 0 บัญชี ส่วนคนจริงอยู่ `sale` ⇒ กดอะไรไม่ได้ทั้งแผนก)
--
-- เช็คผลหลังรัน: select full_name, role from public.profiles where section='Planning&Store' order by 2,1;
--   ควรได้ planner_store = planningstore · warehouse_delivery = warehouse1/2 + delivery1/2 + billing
-- rollback: update public.profiles set role='sale'::user_role where id='ff302a36-04da-4ddb-a133-56ae481c8fce';
