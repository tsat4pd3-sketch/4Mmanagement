-- ═══ 📦 ย้ายทะเบียน min/max ไป "ที่ของนอนรอจริง" (Product DB · DR) ═══════════════════
-- คำสั่ง user 24/11: ตอบ "ค 1" — ย้าย 36 แถวที่ชัดเจน เว้น 5 แถวที่ต้องคนตัดสิน
--
-- ปัญหา (วัดจริง 18/11 · ยืนยันซ้ำ 24/11):
--   ทะเบียนตั้ง min ไว้ที่ **ไลน์ปั๊ม** แต่โซ่จริงคือ
--   ไลน์ปั๊ม --issue--> STORE --ใบขอเติม--> ไลน์ประกอบ --คอนเฟิร์ม FG--> consume
--   ⇒ ของออกจากไลน์ปั๊มไปแล้ว บัญชีที่นั่นนิ่งถาวร ⇒ สัญญาณ min ไม่มีวันติด
--   ก่อนย้าย: 41 คู่ · บัญชีสด (ขยับใน 3 วัน) = **0 คู่**
--
-- กติกาเลือกปลายทาง: ไลน์ที่ consume ล่าสุด ในหน้าต่าง 45 วัน (ตัวเดียวกับธง wrongPlace
-- ใน src/utils/replenish.js) · ชนแถวเดิม 0 คู่ (unique index line_name+mat_no)
--
-- 🔴 เว้นไว้ 5 แถว ไม่ย้าย (ต้องคนตัดสิน):
--   20059892 / 20059894  ของขยับล่าสุดที่ "ร้านชุบ · บจก. จรูญรัตน์" = ส่งออกไปชุบ ไม่ใช่บัฟเฟอร์หน้าไลน์
--   20059897 / 20060001 / 20058725  ไม่เคยมี consume เลย ⇒ ยืนยันปลายทางจากบัญชีไม่ได้
--
-- ย้อนกลับ: สำเนาเต็มก่อนแก้อยู่ที่ archive.line_part_levels_bak_20261124
--   update public.line_part_levels l set line_name = b.line_name
--     from archive.line_part_levels_bak_20261124 b where b.id = l.id;
-- ═══════════════════════════════════════════════════════════════════════════════════

create schema if not exists archive;

-- 🔴 สำเนาข้อมูลต้องอยู่ schema archive ห้ามไว้ public (กฎ CLAUDE.md · มีด่านใน build)
create table if not exists archive.line_part_levels_bak_20261124 as
  select *, now() as backed_up_at from public.line_part_levels;

with tgt as (
  select r.id, r.line_name as from_line, r.mat_no,
         (select t.line_name from public.line_stock_transactions t
           where t.mat_no = r.mat_no and t.type = 'consume'
             and t.created_at > now() - interval '45 days'
           group by t.line_name
           order by max(t.created_at) desc, sum(t.qty) desc
           limit 1) as to_line
    from public.line_part_levels r
   where r.is_active and r.min_qty > 0)
update public.line_part_levels l
   set line_name = t.to_line
  from tgt t
 where l.id = t.id
   and t.to_line is not null
   and t.to_line <> t.from_line
   and t.to_line not like 'ร้านชุบ%';
-- ผลจริง 24/11: ย้าย 36 แถว · หลังย้าย บัญชีสด (ขยับใน 3 วัน) = 24 จาก 41 คู่
