-- ⏸️ พักรอบจัดส่งที่ seed ไว้ — สโตร์ไม่ได้ทำงานเป็นรอบ  (DR)
--
-- ที่มา (user 2026-08-27 หลังคุยกับทีมสโตร์):
--   "work flow ปัจจุบันคือ แทบจะไม่มีกำหนดรอบ และกำหนดเฟสการทำงาน ทุกวันนี้อ่านจาก LINE chat กลุ่ม
--    ว่ามีใครเบิกงาน เห็นใครเบิกก่อนก็จัดของไปส่งเลย"
--   ⇒ รอบ 3 รอบ/วัน ที่ seed ไป 26/08 เป็น **กระบวนการที่ควรจะเป็น ไม่ใช่กระบวนการที่มีอยู่**
--
-- ⚠️ ทำไมต้องพัก ไม่ใช่ปล่อยไว้เฉยๆ
--   รอบที่ตั้งไว้ = **คำสัญญา** — จอ Heijunka/Store Time Chart จะขึ้น "เลยเวลา/ค้างส่ง" ทุกวัน
--   ทั้งที่ไม่มีใครเคยรับปากว่าจะส่ง 09:00 · และ `kanban-round-scan` จะยิง Telegram บอกให้เตรียมของ
--   ตามรอบที่ไม่มีอยู่จริง (บทเรียน shipping_phase_alert: เตือนเฟสที่ทีมไม่ได้ใช้ 592 ครั้งใน 4 วัน
--   จนไม่มีใครอ่านทั้งห้อง) — **จอที่ยืนยันสิ่งที่ไม่จริง แย่กว่าจอที่ว่าง**
--
-- ⭐ "โหมดของไลน์" ไม่ต้องเพิ่มคอลัมน์/master ใหม่ — derive จากของที่มีอยู่แล้ว:
--      มีรอบ active  = โหมด **กำหนดรอบ** (fixed round)
--      ไม่มีรอบ      = โหมด **ส่งตามคำขอ** (delivery to order)
--    เปิดกลับเป็นโหมดรอบ = ไปติ๊ก active ที่ 📦 Line Stock → ⏰ รอบจัดส่ง (UI มีอยู่แล้ว)
--    ห้ามเพิ่มคอลัมน์ `store_mode` ที่ production_lines — ไลน์อยู่ Main รอบอยู่ DR อ่านข้ามไม่ได้
--    และจะกลายเป็นความจริง 2 แหล่งที่ drift กันทันที (ตั้ง mode=round แต่ไม่มีรอบ = ตอบอะไรไม่ได้)
--
-- ⚠️ ไม่ลบ — snapshot ไว้ก่อนเสมอ แล้วปิดด้วย is_active
--    (precedent: _reclass_dt_20260826 · line_stock_txn_bak_op_20260820 · ใบ 4M [Auto] 323 ใบ)
--
-- ⚠️ ผลที่ตามมาโดยตั้งใจ — ไม่ใช่ของพัง:
--    · `v_kanban_round_due` คืน 0 แถว → `kanban-round-scan` ออกทันที → Telegram เรื่องตัดยอดเงียบ
--    · Heijunka Board แถวไลน์ขึ้น "— ไม่มีรอบกะเช้า/กะดึก" (ตรงกับความจริง)
--    · Store Time Chart ขึ้นบล็อกส้ม "ผลิตต้องใช้ของ แต่ยังไม่ได้ตั้งรอบจัดส่ง" ครบทุกไลน์
--      ⇒ **ยังพูดความจริง**: วันนี้ความต้องการมีจริง แต่ยังไม่มีกลไกในระบบที่รับไปส่งต่อ
--      บล็อกนี้จะถูกแทนด้วยคิวคำขอจริงเมื่อ Store⇄Production Pull Loop ลง (docs/STORE-PULL-LOOP-DESIGN.md)

-- ── 1) snapshot ก่อน (กู้คืนได้ตรงแถว) ──
create table if not exists public.kanban_rounds_bak_20260827 as
select *, now() as _backed_up_at
from public.kanban_delivery_rounds
where is_active;

-- ── 2) พักทุกรอบ ──
update public.kanban_delivery_rounds
   set is_active = false
 where is_active;

-- ตรวจผล:
--   select count(*) filter (where is_active) as active,
--          count(*) filter (where not is_active) as parked
--     from kanban_delivery_rounds;                       -- คาด: active 0
--   select count(*) from kanban_rounds_bak_20260827;     -- คาด: 32 (30 ที่ seed + 2 ของเดิม)
--   select * from v_kanban_round_due;                    -- คาด: 0 แถว
--
-- Rollback (คืนสถานะเดิมทุกแถวที่เคย active):
--   update public.kanban_delivery_rounds r set is_active = true
--     from public.kanban_rounds_bak_20260827 b where b.id = r.id;
--
-- เปิดกลับเฉพาะบางไลน์ (ทางที่ควรใช้จริง — ทีมนั้นตกลงกันแล้วว่าจะเดินเป็นรอบ):
--   ไปติ๊กที่ 📦 Line Stock → ⏰ รอบจัดส่ง · หรือ
--   update public.kanban_delivery_rounds set is_active = true where line_name = 'HYDROFORM';
