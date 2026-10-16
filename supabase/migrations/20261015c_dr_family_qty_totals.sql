-- ═══ ยอดผลิตสะสมต่อ "ตระกูลสินค้า" (family) — รวมฝั่ง DB + แก้ให้ชี้แหล่งจริง ═══
-- QC audit 15/10 · project: DR ("Product DB" · eyhclzkifitbhbljgoav)
--
-- 🔴 สิ่งที่ผิดอยู่เดิม (เจอตอน audit · วัดจริง 15/10):
--   `/products` + `/daily-report` คิวรี
--     production_sessions.select('product_id, qty_ok, dr_products(family_id)')
--   แบบ **ไม่มี filter ไม่มี .order()** แล้วบวกเองในหน้า — ผิด 2 ชั้นซ้อนกัน:
--   (1) production_sessions = **1,675 แถว** ⇒ PostgREST คืนแค่ 1,000 แถวแรก
--       และเพราะไม่มี .order() จึงได้ **คนละชุดทุกครั้งที่โหลด** (กฎเหล็ก DB ข้อ 5)
--   (2) 🔴 หนักกว่า: `production_sessions.product_id` = **NULL ทั้ง 1,675 แถว**
--       ⇒ join ไม่ติดเลย ⇒ ยอดสะสมเป็น {} **ตลอด** ⇒ ชิป "📦 ยอดสะสม" ถูกซ่อนเงียบมาตลอด
--       (จอเขียน `{totalQty > 0 && …}` ⇒ ไม่มีใครเห็นว่าฟีเจอร์ตาย)
--
-- ✅ แหล่งจริงของ "ผลิตได้เท่าไหร่" = `prod_orders` (20,131 แถว · 148 mat · qty_ok รวม 1,216,916)
--   ผูก family ด้วย **mat_no** (วัด 15/10: 215 mat → 1 family : 1 แถว ทั้งหมด ⇒ ไม่มีการนับซ้ำ)
--   · กันใบโมฆะออกด้วย `s.status <> 'void'` (กฎ production_sessions.status — ใบที่เปิดผิดแล้วปิดทิ้ง)
--   · `qty_ok` มีค่าเฉพาะ order ที่ `confirmed` อยู่แล้ว (imported/open/cancelled/carry_over = null)
--
-- ✅ ตัวนี้ทำแค่ "รวมยอด" — ไม่ตัดสินอะไร ไม่คิดเกณฑ์สี (กติกา OBEYA: RPC ห้ามคำนวณ KPI)
-- ย้อนกลับ: drop function public.dr_family_qty_totals();  (จอจับ error แล้วเขียนบนจอ ไม่พัง ไม่โชว์ 0)

create or replace function public.dr_family_qty_totals()
returns table (family_id uuid, qty_total bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select p.family_id, sum(coalesce(o.qty_ok, 0))::bigint
  from public.prod_orders o
  join public.production_sessions s on s.id = o.session_id
  join public.dr_products p
       on upper(btrim(p.mat_no)) = upper(btrim(o.mat_no))
  where p.family_id is not null
    and o.qty_ok is not null
    and coalesce(s.status, '') <> 'void'
  group by p.family_id
$$;

-- ฝั่ง DR วิ่งด้วย role `anon` เสมอ (CLAUDE.md §Supabase Projects — ห้ามเปลี่ยนเป็น authenticated)
grant execute on function public.dr_family_qty_totals() to anon, authenticated;

comment on function public.dr_family_qty_totals() is
  'ยอด qty_ok สะสมต่อ family_id จาก prod_orders (กันใบโมฆะ) — แทนการลาก production_sessions ทั้งตารางมาบวกในหน้า ซึ่งทั้งติดเพดาน 1000 แถวและ join ด้วย product_id ที่เป็น NULL ทั้งตาราง (QC audit 2026-10-15)';
