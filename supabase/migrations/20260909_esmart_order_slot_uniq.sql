-- ══ 🛡️ กันใบ e-SMART ซ้ำในรอบเดียวกัน + ล้างใบซ้ำที่เกิดไปแล้ว ═════════════════════════
-- Target project: DR (eyhclzkifitbhbljgoav) — "Product DB" ในจอ Supabase
--
-- ที่มา (user 2026-09-09): *"รอบ 11 โมงของ AAT นี่ มี 6 รอบจริง หรือบัคซ้ำกัน ทั้ง 862 กับ e-smart recheck ที"*
-- ⇒ ตรวจแล้ว **บั๊กซ้ำจริง ไม่เกี่ยวกับ 862 เลย** — เป็นใบ e-SMART 2 ชุดซ้อนกัน (40/40/70 × 2)
--
-- **ไฟล์เดียวกัน (`Detailed SMART - 2026-09-09T100430.028.csv`) ถูกอัพ 2 ครั้งห่างกัน 4 วินาที**
-- (06:35:30 → batch 944d9338 · 06:35:34 → batch 6272470b) แล้วตัวกันซ้ำ **ตายทั้ง 2 ชั้น**:
--   ชั้น 1 `customer_pull_signals` — insert ล้ม 42P10 ตั้งแต่วันแรก ⇒ ตารางว่าง ⇒ ไม่มีอะไรให้เทียบซ้ำ
--          (แก้แล้วที่ `20260909_pull_signal_dedup_fix_and_be_year.sql`)
--   ชั้น 2 ฝั่งจอ — `plan` ถูกคำนวณตอน "เปิดไฟล์" แล้วใช้ยาว ⇒ รอบที่ 2 ยังเห็นภาพเก่าที่ยังไม่มีใบ
--          ⇒ ตัดสินเป็น "สร้างใหม่" ทั้งชุด (แก้แล้ว: `apply()` re-plan จากของจริงก่อนเขียนเสมอ)
--
-- ⇒ ไฟล์นี้เพิ่ม **ด่านสุดท้ายที่ฐานข้อมูล** — โค้ดพลาดอีกกี่ทาง ใบก็ซ้ำไม่ได้
--   (pattern เดียวกับ `wip_replenish_open_per_part_uniq` ของลูปสโตร์)

/* ── ① ล้างใบซ้ำ "ก่อน" สร้าง index (ไม่งั้น create index ล้ม) ───────────────────────
   เกณฑ์ปลอดภัย 3 ชั้น — แตะเฉพาะใบที่พิสูจน์ได้ว่าเป็นตัวซ้ำที่ยังไม่มีผลกับของจริง:
     ⓐ `source='esmart'` เท่านั้น (ไม่มีทางแตะใบ 862/คีย์มือ)
     ⓑ มีใบพี่น้อง **ที่เก่ากว่า** ใน (ลูกค้า+วัน+รอบ+mat) เดียวกัน = เป็นตัวที่ 2 ขึ้นไปจริง
     ⓒ **ยังไม่มีแถวหักสต็อกผูกอยู่** (`line_stock_transactions.ref_shipment_id`)
        และสถานะยังไม่เลย `confirmed` → ยังไม่มีใครทำงานกับใบนี้
   ⇒ ตรวจกับข้อมูลจริง 09/09: ชุดที่เก็บ = `shipped` + หักสต็อกแล้ว 1 แถว/ใบ ·
      ชุดที่ลบ = `confirmed` + หักสต็อก 0 แถว  ⇒ ลบแล้วยอดที่ต้องผลิต/ส่งกลับมาถูก (40/40/70 ครั้งเดียว)
   ⚠️ ใบซ้ำที่ "ถูกเตรียม/ส่งไปแล้ว" จะ **ไม่ถูกลบ** โดยตั้งใจ — ของแบบนั้นมีคนทำงานไปแล้ว
      ต้องให้คนตัดสินเอง ไม่ใช่ให้ migration ลบทิ้ง */
with dup as (
  select o.id,
         row_number() over (
           partition by o.customer, o.due_date, left(o.ship_time, 5), o.mat_no
           order by o.created_at
         ) as seq
    from public.customer_shipping_orders o
   where o.source = 'esmart'
)
delete from public.customer_shipping_orders o
 using dup
 where dup.id = o.id
   and dup.seq > 1                                    -- ⓑ ไม่ใช่ใบแรกของ slot
   and o.status in ('pending', 'confirmed')           -- ⓒ ยังไม่มีใครเตรียม/โหลด/ส่ง
   and not exists (select 1 from public.line_stock_transactions t where t.ref_shipment_id = o.id);

/* ── ② ด่านกันซ้ำถาวร — 1 ใบ e-SMART ต่อ (ลูกค้า × วัน × รอบ × MAT) ─────────────────
   partial index (เฉพาะ source='esmart') ⇒ **ไม่กระทบใบ 862/คีย์มือเลย**
   ซึ่งซ้ำ slot เดียวกันได้ตามธรรมชาติ (PO คนละใบ/แยกส่งหลายเที่ยว) */
create unique index if not exists customer_shipping_orders_esmart_slot_uniq
  on public.customer_shipping_orders (customer, due_date, ship_time, mat_no)
  where source = 'esmart';
comment on index public.customer_shipping_orders_esmart_slot_uniq is
  'กันใบ e-SMART ซ้ำในรอบเดียวกัน (อัพไฟล์เดิม 2 ครั้ง) — client แปลง 23505 เป็นข้อความไทยให้กด ↻ แล้วลองใหม่ · partial เฉพาะ esmart จึงไม่กระทบ 862/คีย์มือที่ซ้ำ slot ได้ตามปกติ';

/* ══ ตรวจหลังรัน ═══════════════════════════════════════════════════════════════════
-- ต้องได้ 0 แถว (ไม่มี slot ไหนมีใบ esmart เกิน 1)
select customer, due_date, ship_time, mat_no, count(*)
  from public.customer_shipping_orders where source='esmart'
 group by 1,2,3,4 having count(*) > 1;

-- รอบ 11:00 ของ AAT วันนี้ ควรเหลือ 3 ใบ (40 / 40 / 70)
select mat_no, qty, status from public.customer_shipping_orders
 where source='esmart' and customer='GRBNA' and due_date='2026-09-09' and ship_time='11:00'
 order by mat_no;

   ══ ROLLBACK ═══════════════════════════════════════════════════════════════════
   drop index if exists public.customer_shipping_orders_esmart_slot_uniq;
   ⚠️ ใบที่ลบไปแล้วกู้คืนไม่ได้จาก migration นี้ — แต่เป็นใบซ้ำที่ไม่เคยมีผลกับสต็อก
      ถ้าต้องการกลับมา ให้อัพไฟล์ e-SMART เดิมซ้ำ (ระบบจะสร้าง/อัพเดทให้ตามยอดในไฟล์)
══════════════════════════════════════════════════════════════════════════════════ */
