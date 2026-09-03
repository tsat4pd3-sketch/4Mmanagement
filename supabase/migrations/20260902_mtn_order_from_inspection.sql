-- ═══════════════════════════════════════════════════════════════════════════
-- 🔧 เปิดใบแจ้งซ่อม MO จากผลตรวจ PM/AM ที่พบ NG   ·   project = DR (eyhclzkifitbhbljgoav)
--
-- ที่มา (feedback หน้างาน 2026-09-02): "ในการตรวจเช็ค PM ถ้า NG จะให้เลือกเปิด MO ได้เลยใช่มั้ย"
--   → เดิม **ไม่มี** — PMCheckData แจ้งเตือนในแอปว่าพบ NG แล้วจบ
--     ช่างต้องไปพิมพ์ใบแจ้งซ่อมใหม่เองที่ /mtn-repair โดยไม่มีอะไรผูกกลับมาที่ผลตรวจ
--     ⇒ ตอบไม่ได้ว่า "NG ที่เจอเมื่อวาน ถูกซ่อมหรือยัง"
--
-- additive ล้วน — ยังไม่ apply ก็เปิดใบซ่อมได้ตามปกติ (โค้ดตัดคอลัมน์ทิ้งเมื่อเจอ 42703)
-- แต่จะยังผูกกลับผลตรวจไม่ได้ และกันเปิดซ้ำไม่ได้
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.mtn_orders add column if not exists source_inspection_id uuid;

-- ⚠️ on delete set null — ใบซ่อมเป็นเอกสารของตัวเอง ต้องอยู่ต่อแม้ผลตรวจถูกลบ
--    (หลักเดียวกับ scrap_report_items.src_request_item_id / quality_bin_records.defect_log_id)
do $$ begin
  alter table public.mtn_orders
    add constraint mtn_orders_source_inspection_fk
    foreign key (source_inspection_id) references public.inspections(id) on delete set null;
exception when duplicate_object then null;
end $$;

-- 1 ผลตรวจ = 1 ใบซ่อม — กัน 2 เครื่อง/ดับเบิลคลิกออกใบซ้ำ (client แปลง 23505 เป็นข้อความไทย)
-- partial: ใบที่ไม่ได้มาจากผลตรวจ (แจ้งเองที่ /mtn-repair) ไม่ถูกจำกัด
create unique index if not exists mtn_orders_source_inspection_uniq
  on public.mtn_orders(source_inspection_id) where source_inspection_id is not null;

comment on column public.mtn_orders.source_inspection_id is
  'ผลตรวจ PM/AM (inspections.id) ที่เป็นต้นเหตุของใบซ่อมนี้ — เปิดจากหน้า /pm?tab=check เมื่อผลตรวจเป็น NG';
