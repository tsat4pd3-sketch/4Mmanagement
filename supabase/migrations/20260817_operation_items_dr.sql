-- ═══ ชั้น "Operation" ใต้พาร์ทจริง — เฟส 1 ของแบบ C (งานขับนัท SUB APRON · 2026-08-17) ═══
-- โปรเจค: DR (eyhclzkifitbhbljgoav)
--
-- ปัญหา: งานขับนัทถูกลงทะเบียนเป็น "product ปลอม" 1 ตัวต่อ 1 OP (M6/M8/M10 ไม่มีเกลียว ฯลฯ)
--   เพื่อให้เครื่องขับนัทแต่ละตัวมีใบงาน/เป้าบนบอร์ด — แต่ชิ้นเดียวกันเลยถูกนับ "ผลิตได้" ซ้ำ 2-3 รอบ
--   (ขาต้นนับรายขั้น + ขาดาวนับเลขจริง 2xxx) · SAP ไม่มีตัวตนหลังขับนัท (เป็นแค่ OP ใน routing)
-- โมเดล: product ติดธง is_operation = "รายการขั้นตอน" + op_parent_mat ชี้ MAT พาร์ทจริง + op_seq เลข OP ตาม PFC
--   → ใบงานยังเปิด/ปิดรายเครื่องเหมือนเดิม (หัวหน้าไลน์มอนิเตอร์รายขั้นได้) แต่ยอดรวมภาพใหญ่
--     collapse เข้าพาร์ทจริง ไม่นับซ้ำ (src/utils/pairTotals.js collapseOps + src/utils/opItems.js)
--
-- Rollback: alter table dr_products drop column is_operation, drop column op_parent_mat, drop column op_seq;
--   (โค้ดอ่านแบบ best-effort — ไม่มีคอลัมน์ = พฤติกรรมเดิมเป๊ะ ไม่พัง)

alter table dr_products add column if not exists is_operation boolean not null default false;
alter table dr_products add column if not exists op_parent_mat text;
alter table dr_products add column if not exists op_seq integer;

comment on column dr_products.is_operation is 'true = รายการขั้นตอน (OP เช่นงานขับนัท) ไม่ใช่พาร์ทจริง — ยอดรวมภาพใหญ่ไม่นับซ้ำ / ห้ามเข้า BOM / ไม่เข้าคลัง';
comment on column dr_products.op_parent_mat is 'MAT ของพาร์ทจริงที่ขั้นนี้สังกัด (null = ยังไม่ผูก → worklist ใน Product Master · ยอดยังนับแบบเดิม)';
comment on column dr_products.op_seq is 'เลขลำดับขั้นตาม Process Flow (เช่น 190, 200) — ไม่รู้ = null ห้ามเดา';

-- ── backfill เฉพาะที่ยืนยันได้จาก PFC + ชื่อพาร์ทตรงกัน (กฎ: ห้ามเดา) ──
-- REINF FRT FNDR @ BAT MTNG LWR LH = 20058626 · PFC: OP190 = M8 THDLS(ไม่มีเกลียว) · OP200 = M10 THDLS
update dr_products set is_operation = true, op_parent_mat = '20058626'
where mat_no in ('M6 ไม่มีเกลียว', 'M8 ไม่มีเกลียว', 'M10 ไม่มีเกลียว') and coalesce(is_operation, false) = false;
update dr_products set op_seq = 190 where mat_no = 'M8 ไม่มีเกลียว'  and op_seq is null;
update dr_products set op_seq = 200 where mat_no = 'M10 ไม่มีเกลียว' and op_seq is null;

-- REINF FRT FNDR @ BAT MTNG LWR RH (New) = 20066660 (ยืนยันจากชื่อใน BOM child)
update dr_products set is_operation = true, op_parent_mat = '20066660'
where mat_no = 'E024 (M6 ไม่มีเกลียว)' and coalesce(is_operation, false) = false;

-- รายการขับนัทที่ "ยังไม่รู้พาร์ทจริง" (เลขจริง 2xxx ยังไม่ลงทะเบียนในระบบ) — ติดธง OP ไว้ก่อน
-- op_parent_mat = null โดยตั้งใจ → ยอดยังนับแบบเดิม + ขึ้น worklist ใน /products ให้คนมาเติม (ห้ามเดา parent)
update dr_products set is_operation = true
where mat_no in (
  '290 (M6 มีเกลียว)', '291 (M6 มีเกลียว)', '127 (M6 มีเกลียว)',
  '173 (M6 มีเกลียว)', '173 (M8 ไม่มีเกลียว)',
  '30047596 & 30052451', '30052454 & 30047593'
) and coalesce(is_operation, false) = false;
