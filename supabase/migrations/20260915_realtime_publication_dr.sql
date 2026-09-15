-- ══════════════════════════════════════════════════════════════════════════════
-- realtime publication — DR project (eyhclzkifitbhbljgoav · ชื่อในจอ "Product DB")
-- 2026-09-15 · audit egress (docs/POLLING-AUDIT-2026-09-15.md)
--
-- 🔴 บั๊กที่เจอ: publication `supabase_realtime` ของ DR มีแค่ 8 ตาราง
--    (defect_logs · downtime_logs · kanban_scans · kanban_standards · kanban_targets ·
--     mtn_orders · prod_orders · production_sessions)
--    แต่โค้ด subscribe ตารางที่ **ไม่ได้อยู่ใน publication** ด้วย ⇒ subscribe ไปก็ไม่มีอะไรวิ่งมา:
--      · `rack_requests`  → หน้า /rack-center "live refresh เมื่อมีไลน์อื่นกดเปลี่ยนสถานะ" **ไม่เคยทำงาน**
--      · `inspections`    → /daily-pm บอกว่า "ตรวจเสร็จแล้ว refresh ทันที" — ไม่เคยทันที
--    เป็นบั๊กเงียบสนิท: ไม่มี error โค้ดดูถูกทุกบรรทัด เห็นได้จากฝั่ง DB เท่านั้น
--
-- ทำไมเรื่องนี้อยู่ในงานลด egress (วัดจริง 15/09):
--    Egress รวม 1.578 GB — **Product DB 1.35 GB (85%)** · MAIN 0.23 GB
--    Realtime Messages ใช้ไป 22,314 จากโควต้า 5,000,000/เดือน (**<1%**)
--    ⇒ realtime แทบไม่มีต้นทุน · poll แพงมาก
--    ⇒ ตารางที่ไม่ได้ publish = บังคับให้จอต้อง poll ทั้งก้อนอย่างเดียว = จ่ายแพงฟรีๆ
--
-- ตารางสต๊อก 3 ตัวท้าย เพิ่มเพื่อให้จอสโตร์ (/line-stock · /store-monitor · /rundown-stock ·
-- StoreWaitCards · StoreLotQueue) เลิก poll ล้วนได้ — เป็นกลุ่มที่ payload ใหญ่ที่สุดที่เหลือ
-- (`line_stock_summary` วัดได้ 13.5 KB/รอบ × 999 รอบ/วัน)
--
-- ⚠️ DR เป็น anon-open ตาม convention (ดู CLAUDE.md "supabaseDR ไม่เคย authenticate")
--    realtime จึงส่งถึง client ได้เหมือนการอ่านปกติ — **ไม่ได้เปิดข้อมูลใหม่ที่อ่านไม่ได้อยู่แล้ว**
-- ⚠️ ย้อนกลับได้ทันที: `alter publication supabase_realtime drop table public.<ตาราง>;`
--    (ถอดออกแล้วจอกลับไปพึ่ง poll กันเหนียวตามเดิม ไม่พัง แค่ช้าลง)
-- ══════════════════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array[
    'rack_requests',            -- 🔴 /rack-center — live refresh ที่ไม่เคยทำงาน
    'inspections',              -- 🔴 /daily-pm — "ตรวจเสร็จ refresh ทันที" ที่ไม่เคยทันที
    'improvements',
    'material_requests',
    'quality_bin_records',
    'scrap_reports',
    'child_lot_requests',       -- StoreLotQueue (คิวจ่ายวัตถุดิบหน้าไลน์)
    -- ⚠️ `line_stock_summary` เป็น **view** — เพิ่มเข้า publication ไม่ได้ (22023 "not supported for views")
    --    จอสโตร์จึงใช้ `line_stock_transactions` (ตาราง ledger ที่ป้อน view ตัวนั้น) เป็นตัวปลุกแทน
    --    ทุกการเปลี่ยนแปลงของ summary เกิดจากแถวใหม่ใน transactions เสมอ ⇒ ครอบคลุมเท่ากัน
    'line_stock_transactions'   -- จอสโตร์ — payload ใหญ่สุดที่เหลือ (summary 13.5 KB/รอบ)
  ] loop
    -- idempotent: รันซ้ำได้ ไม่พังถ้ามีอยู่แล้ว / ตารางยังไม่ถูกสร้าง
    -- BASE TABLE เท่านั้น — view เพิ่มเข้า publication ไม่ได้
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t and table_type='BASE TABLE')
       and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t)
    then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
