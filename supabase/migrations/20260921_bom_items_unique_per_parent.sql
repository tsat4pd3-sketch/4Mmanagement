-- 🌳 mat เดียวกันอยู่ได้หลายชั้นในใบเดียวกัน — unique ต่อ "ตัวแม่" ไม่ใช่ต่อทั้งใบ
--    (DR project — eyhclzkifitbhbljgoav)
--
-- ที่มา (user ส่งจอ SAP + แชทหน้างานมาให้ 2026-09-21):
--   หน้างานแจ้ง: *"ในระบบ ไม่สามารถเพิ่ม 50027085 ใต้ 20058491 ได้ เนื่องจากเลข Mat ซ้ำครับ"*
--
-- ── ของจริงใน SAP (CS12 ของ `10100381`) ─────────────────────────────────────────────
--   ...3  0090  20058490  REINF FRT S/M @FR MTNG RH   1 PC
--   ....4 0010  50027085  WSS-M1A367-A36 … COIL     0.321 KG   ← ใต้ RH
--   ...3  0100  20058491  REINF FRT S/M @FR MTNG LH   1 PC
--   ....4 0010  50027085  WSS-M1A367-A36 … COIL     0.321 KG   ← ใต้ LH  (แถวเดียวกันเป๊ะ คนละแม่)
--
-- ⇒ คอยล์ม้วนเดียวกันถูกใช้ทั้งฝั่งซ้ายและขวา (ปั๊มคู่ · แผ่นละ 0.642 ÷ 2 = **0.321** พอดี)
--   **SAP เก็บ 2 แถว** เพราะ key ของ BOM คือ (ใบของตัวแม่, component) ไม่ใช่ (FG, component)
--
-- ── ต้นเหตุฝั่งเรา ───────────────────────────────────────────────────────────────────
-- `bom_items_product_id_mat_no_key` = UNIQUE (product_id, mat_no) ⇒ **mat หนึ่งตัวอยู่ในใบ
-- ของ FG ได้แค่แถวเดียว** · ตอนยังไม่มี `parent_mat` (ก่อน 16/09) ข้อจำกัดนี้ยังสมเหตุผล
-- เพราะทุกบรรทัดอยู่ชั้น 1 เหมือนกันหมด — แต่พอมีชั้นแล้ว มันกลายเป็นตัวบล็อกของจริง
-- (และเป็นเหตุผลที่แถวเดียวถูกคีย์เป็น 0.642 รวบ 2 ฝั่ง ซึ่งทำให้ยอดคอยล์ของฝั่งซ้าย/ขวาแยกไม่ออก)
--
-- ── ที่แก้ ───────────────────────────────────────────────────────────────────────────
-- unique ใหม่ = (product_id, **ตัวแม่**, mat_no) — ยังกันซ้ำจริง (mat เดิมใต้แม่เดิม 2 แถว)
-- แต่ยอมให้ mat เดียวกันอยู่ใต้แม่คนละตัวในใบเดียวกันได้ **ตรงกับ SAP**
-- `coalesce(parent_mat,'')` เพราะ null ใน unique index ไม่ชนกันเอง (ชั้น 1 จะซ้ำได้ไม่จำกัด)
-- ⚠️ เงื่อนไขใหม่ **อ่อนกว่าเดิมเสมอ** ⇒ ไม่มีแถวเดิมแถวไหนผิดกติกา (ไม่ต้องล้างข้อมูลก่อน)

alter table public.bom_items drop constraint if exists bom_items_product_id_mat_no_key;

create unique index if not exists bom_items_product_parent_mat_uniq
  on public.bom_items (product_id, coalesce(parent_mat, ''), mat_no);

comment on index public.bom_items_product_parent_mat_uniq is
  'กันซ้ำระดับ "ใบของตัวแม่" แบบ SAP — mat เดียวกันอยู่ใต้ตัวแม่คนละตัวในใบเดียวกันได้ (เคสจริง: คอยล์ 50027085 อยู่ใต้ทั้ง 20058490 RH และ 20058491 LH ข้างละ 0.321 KG) · ห้ามกลับไป unique (product_id, mat_no)';

-- ══ ตรวจผลหลังรัน ═══════════════════════════════════════════════════════════════════
--   select indexname from pg_indexes where tablename='bom_items' order by 1;
--   -- ต้องไม่มี bom_items_product_id_mat_no_key · ต้องมี bom_items_product_parent_mat_uniq
--
-- ══ Rollback ════════════════════════════════════════════════════════════════════════
--   drop index if exists public.bom_items_product_parent_mat_uniq;
--   alter table public.bom_items add constraint bom_items_product_id_mat_no_key unique (product_id, mat_no);
--   ⚠️ ถอยได้เฉพาะตอนที่ยังไม่มีใครเพิ่มแถว mat ซ้ำใต้คนละแม่ — ถ้ามีแล้วต้องลบแถวนั้นก่อน
