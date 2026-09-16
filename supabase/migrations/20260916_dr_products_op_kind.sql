-- 🔩 ชนิดของ "ขั้นตอน (OP)" — ขั้นต่อเนื่องบนพาร์ทเดิม vs ขั้นประกอบเป็นของใหม่
--    (DR project — eyhclzkifitbhbljgoav)
--
-- ที่มา (user 2026-09-16 · ส่งรูปวาดมืออธิบายมาให้):
--   แบบที่ 1  Part A + nut M10 ×1 + nut M8 ×2 → "Part A ที่มีนัทแล้ว"  → no mat SAP, just OP
--             ของที่ออกมา **ยังเป็น Part A ตัวเดิม** ⇒ "เป็นขั้นของพาร์ทไหน" ตอบได้ = Part A
--   แบบที่ 2  Part B + Part C → ของใหม่ 1 ชิ้น                        → no mat SAP, just OP
--             ของที่ออกมา **ไม่ใช่ทั้ง B และ C** ⇒ คำถามนั้น **ไม่มีคำตอบ**
--
--   user: "ชื่อของ OP นี้คือ 291+088 มาประกอบกัน โดยใช้ 291 1 ชิ้น 089 1 ชิ้น และ nut 2 ชิ้น
--          แต่ต้องไปเลือกว่าเป็นชั้นของ 089 คือมันก็แปลกๆ รึป่าว"
--
-- ── ปัญหาเดิม ────────────────────────────────────────────────────────────────────────
-- ฟอร์มติดดาว `*` บังคับกรอก "เป็นขั้นของพาร์ทจริง (MAT)" + worklist เตือน "ยังไม่ผูกพาร์ทจริง"
-- ⇒ ขั้นแบบที่ 2 ถูกไล่ให้หาอะไรมาใส่ สุดท้ายได้หนึ่งใน **วัตถุดิบของตัวเอง**
-- ⚠️ ไม่ใช่แค่ดูแปลก — เป็น**ระเบิดเวลา**: `collapseOps` (src/utils/pairTotals.js) มีบรรทัด
--    `if (present.has(parent)) return;` ⇒ วันไหนพาร์ทที่ชี้ไปถูกเปิดเป็นสินค้าและมีใบผลิต
--    **ยอดของขั้นนี้จะถูกทิ้งเงียบๆ ทั้งก้อน** (FENDER = 45 ใบ) เพราะระบบคิดว่า "ตัวจริงถือยอดแล้ว"
--
-- ── ข้อควรรู้ที่วัดจากข้อมูลจริง (อย่าเข้าใจผิดซ้ำ) ──────────────────────────────────────
-- "op_parent_mat เป็นชิ้นส่วนใน BOM ของขั้นตัวเอง" **ไม่ใช่ความผิดปกติ** — ขั้นแบบที่ 1 เป็นแบบนั้น
-- โดยธรรมชาติ (ขั้นกิน Part A เข้าไปแล้วคาย Part A ที่มีนัท) · 8/18 ขั้นที่มีอยู่เข้าข่ายนี้
-- สิ่งที่แยกแบบ 1 ออกจากแบบ 2 คือ **"มีพาร์ทจริงกี่ตัวเป็นขาเข้า"** ซึ่งเดาอัตโนมัติไม่ได้
-- (nut/สกรูเป็นของสิ้นเปลือง ไม่ใช่ตัวตนของชิ้นงาน) ⇒ **ต้องให้คนระบุ ห้ามให้ระบบเดา**

alter table public.dr_products
  add column if not exists op_kind text;

do $$ begin
  alter table public.dr_products
    add constraint dr_products_op_kind_chk check (op_kind is null or op_kind in ('sequence','assembly'));
exception when duplicate_object then null; end $$;

comment on column public.dr_products.op_kind is
  'ชนิดของขั้นตอน (ใช้เมื่อ is_operation) — sequence = ขั้นต่อเนื่องบนพาร์ทเดิม (ต้องมี op_parent_mat · ยอดต้องยุบเข้าพาร์ทจริง ห้ามนับซ้ำ) · assembly = ขั้นประกอบหลายชิ้นเป็นของใหม่ (op_parent_mat ต้องว่าง · ของที่ออกมาไม่ใช่ตัวไหนในขาเข้า ยอดนับตรงๆ) · null = ยังไม่ระบุ (worklist ตามให้คนมาเลือก)';

-- ══ 1) backfill แบบไม่เปลี่ยนพฤติกรรม ════════════════════════════════════════════════
-- ขั้นที่มี parent อยู่แล้ว = วันนี้ระบบทำตัวแบบ sequence อยู่แล้ว → ติดป้ายให้ตรงกับของจริง
update public.dr_products
   set op_kind = 'sequence'
 where coalesce(is_operation, false) and op_parent_mat is not null and op_kind is null;

-- ขั้นที่ยังไม่มี parent = ยังไม่รู้ว่าแบบไหน → ปล่อย null ไว้ (worklist เตือนต่อ) **ห้ามเดาให้**

-- ══ 2) แก้เคสที่ user ยืนยันเองว่าเป็นขั้นประกอบ ═════════════════════════════════════
-- `FENDER` (ชื่อ 291+088) = 291 + 089 + nut ×2 → ของใหม่ · parent เดิม 30052451 คือ "089"
-- ซึ่งเป็นแค่ 1 ใน 2 พาร์ทขาเข้าของมันเอง (จะตอบอีกตัวก็ได้ = สัญญาณว่าคำถามผิด)
update public.dr_products
   set op_kind = 'assembly', op_parent_mat = null, op_seq = null
 where coalesce(is_operation, false) and mat_no = 'FENDER';

-- ══ ตรวจผลหลังรัน ═══════════════════════════════════════════════════════════════════
--   select op_kind, count(*), count(*) filter (where op_parent_mat is not null) as has_parent
--     from dr_products where is_operation and is_active group by op_kind order by 1;
--   -- ผลจริงหลัง apply 16/09: sequence 14 (has_parent 14) · assembly 1 (has_parent 0) · null 3 (has_parent 0)
--   select mat_no, name, op_kind, op_parent_mat from dr_products where mat_no = 'FENDER';
--
-- ══ Rollback ════════════════════════════════════════════════════════════════════════
--   update dr_products set op_kind='sequence', op_parent_mat='30052451' where mat_no='FENDER';
--   alter table dr_products drop constraint if exists dr_products_op_kind_chk;
--   alter table dr_products drop column if exists op_kind;
--   (โค้ดฝั่งแอปถอยได้เอง: loadOpInfo จับ 42703 แล้วคืน {} = พฤติกรรมเดิม)
