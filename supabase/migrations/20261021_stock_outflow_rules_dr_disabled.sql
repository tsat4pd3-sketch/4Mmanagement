/* ═══ 📦 stock_outflow_rules (DR · Product DB eyhclzkifitbhbljgoav) — สร้างแล้วปิดทันที ═════
 *
 * ⚠️⚠️ ไฟล์นี้บันทึก **ความผิดพลาด** ไว้ให้ session ถัดไปไม่ทำซ้ำ — ไม่ใช่ฟีเจอร์ที่ใช้งาน
 *
 * 21/10: สร้างตาราง `stock_outflow_rules` + `fn_post_shipment_outflow()` + trigger
 * `trg_post_shipment_outflow` บน `customer_shipping_orders` เพื่อ "หักยอดคลังอัตโนมัติตอนส่งของ"
 *
 * 🔴 **ผิด — งานนี้ทำอยู่แล้วฝั่งแอป** `src/pages/CustomerDemand.jsx` หักยอด FG ตอนเฟสที่ติ๊ก
 *    (เฟสตั้งค่าได้ · คลัง FG ก่อน · มี guard กันหักซ้ำ · migration `20260826_shipping_step_deducts_stock`)
 *    ⇒ trigger นี้ทำงาน = **หักซ้ำ 2 เท่า** ของทุกใบส่งที่ตรงกฎ
 *
 * ✅ ปิดทาง 21/10 (2 ชั้น · ตรวจกลับแล้ว):
 *    ① `stock_outflow_rules`: 4 กฎที่ seed ไว้ → `is_active=false` ทั้งหมด (active 0 / total 4)
 *    ② `fn_post_shipment_outflow()` → เนื้อตัวเป็น `return new;` (no-op)
 *    · trigger ยังค้างอยู่บนตาราง — `drop trigger` ผ่าน MCP timeout ซ้ำ 3 ครั้ง (ไม่มี lock ค้าง
 *      ใน `pg_stat_activity`) ⇒ ยังไม่ถอด **แต่ไม่มีผลใดๆ เพราะฟังก์ชันเป็น no-op**
 *    · ตรวจความเสียหาย: `line_stock_transactions` ที่ `created_by='auto'` ทุกแถวมี
 *      `ref_shipment_id is null` (= กลไกเดิม "auto: FG … ใช้ mini-store" / "auto: ปิดออเดอร์ …")
 *      **ไม่มีแถวใดมาจาก trigger นี้ ⇒ ไม่เกิดการหักซ้ำจริง**
 *
 * 🔴 ห้ามเอาตรรกะกลับเข้ามาโดยไม่ถอดฝั่งแอปออกก่อน — มี 2 ที่หัก = ยอดคลังผิดแบบเงียบที่สุด
 * 🔴 ถ้าจะล้างให้สะอาด ให้รันผ่าน SQL Editor (ไม่ใช่ MCP):
 *      drop trigger if exists trg_post_shipment_outflow on public.customer_shipping_orders;
 *      drop function if exists public.fn_post_shipment_outflow();
 *      drop table if exists public.stock_outflow_rules;
 *
 * 📄 docs/modules/demand-flow-tower.md
 * ═══════════════════════════════════════════════════════════════════════════════════ */

-- ① กฎทุกใบปิดตาย (idempotent)
update public.stock_outflow_rules set is_active = false where is_active;

-- ② ฟังก์ชันเป็น no-op (idempotent) — ชั้นที่กัน trigger ที่ยังค้างอยู่
create or replace function public.fn_post_shipment_outflow() returns trigger
language plpgsql as $$
begin
  /* ถอดการใช้งาน 21/10 — การหักยอดตอนส่งของทำอยู่แล้วฝั่งแอป (CustomerDemand.jsx)
     ⇒ ตัวนี้ทำงาน = หักซ้ำ. ห้ามใส่ตรรกะกลับเข้ามาโดยไม่ถอดฝั่งแอปออกก่อน */
  return new;
end $$;
