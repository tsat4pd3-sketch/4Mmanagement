-- Activity rate ที่ seed ไว้ = ชุดของ "ปี 2026" (user ยืนยัน 2026-08-19)
-- ตอน seed ใส่ effective_from = 2000-01-01 ไว้ก่อนเพื่อให้ครอบทุกโปรเจคที่มีอยู่ ไม่ให้คำนวณไม่ได้
-- ตอนนี้รู้ปีจริงแล้ว → เปลี่ยนเป็น 2026-01-01 ให้ตรงกับที่บัญชีส่งมา
--
-- ⚠️ ทำได้ปลอดภัยเพราะ improvements = 0 แถว (ตรวจ 2026-08-19) ยังไม่มีโปรเจคไหนคิด cost saving ด้วย rate ชุดนี้
--    ถ้ามีโปรเจคแล้วห้ามขยับวันแบบนี้ — ตัวเลข saving ของโปรเจคเก่าจะเปลี่ยนตามเงียบๆ
-- ⚠️ ผลที่ตั้งใจ: โปรเจคที่ start_date ก่อน 2026-01-01 จะ "ไม่รู้ rate" (null) แทนที่จะเอา rate ปี 2026
--    ไปคิดย้อนหลังแบบผิดๆ — ตรงกับกฎ "ไม่รู้ = null ห้ามเดา"
-- ⚠️ ถ้าปีบัญชีของบริษัทเริ่ม เม.ย. (ไม่ใช่ ม.ค.) ให้แก้วันเป็น 2026-04-01
--    (แก้ทีละแถวได้ที่ /org-setup → 💰 Activity Rate → ✏️ → ปุ่ม 🔓 แก้วันที่)
--
-- rollback: update public.cost_center_rates set effective_from = '2000-01-01'
--           where effective_from = '2026-01-01' and note is not null;

update public.cost_center_rates
set effective_from = date '2026-01-01'
where effective_from = date '2000-01-01';
