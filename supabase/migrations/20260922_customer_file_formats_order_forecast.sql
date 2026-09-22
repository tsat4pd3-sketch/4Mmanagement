-- 🧩 ทะเบียนฟอร์แมตไฟล์ลูกค้า — ขยายให้ครอบ "ไฟล์ order/forecast" ไม่ใช่แค่สัญญาณดึง (DR project)
--
-- ที่มา (audit แผนผลิต 2026-09-22 + user ยืนยัน):
--   ความต้องการลูกค้าเข้าระบบได้แค่ 3 ทาง (EDI 830 · EDI 862 · e-SMART) ซึ่งเป็นตระกูล Ford ทั้งหมด
--   วัดจริงฐาน DR วันนั้น: order/forecast ทุกแถวมาจาก ship-to 6 แห่ง (GRBNA/GBL9A/GBJWE/GBJWC/GBJWA/HPUDA)
--   ⇒ **72 จาก 115 พาร์ท active ไม่มีความต้องการในระบบเลยสักแถว** — TSRA 28 · TSPK 15 (FG ทั้งหมด) ·
--     ISUZU RT50 · GWM · TSESA · FVL ฯลฯ ⇒ 10 จาก 22 ไลน์หายจากแผนผลิตทั้งไลน์
--   user ยืนยัน: ลูกค้าพวกนี้ส่ง **ไฟล์ Excel/CSV เหมือนกัน แต่คนละหน้าตากับ Ford**
--
-- ปัญหาเชิงโครงสร้าง: ชื่อหัวคอลัมน์ของ 830/862 ถูก **hardcode ใน src/utils/ediDetect.js**
--   ⇒ ลูกค้าเจ้าใหม่ = แก้โค้ด + build + deploy ทุกครั้ง
--   ขณะที่ฝั่ง e-SMART ทำ data-driven ไว้แล้วที่ตารางนี้ (เพิ่มแถว = จบ)
--   ⇒ ยุบให้เป็น **ทะเบียนเดียว** ด้วยคอลัมน์ `kind` แทนการสร้างตารางทะเบียนใหม่
--      (กฎโปรเจค: ห้ามสร้างทะเบียนซ้อนกับของที่มีอยู่)
--
-- backward-compatible 100%:
--   · `kind` default 'pull' ⇒ แถว ford_esmart เดิมยังเป็นสัญญาณดึงเหมือนเดิม ไม่ต้องแก้
--   · แถว order/forecast ที่ seed = "ชื่อคอลัมน์ที่โค้ดรู้จักอยู่แล้ว" ⇒ พฤติกรรมการอ่านไฟล์เท่าเดิมเป๊ะ
--     (โค้ดรวม alias ทะเบียน + ค่าสำรองในโค้ดเสมอ — ทะเบียนว่าง/โหลดไม่ได้ ก็ยังอ่านไฟล์ Ford ได้)
--
-- rollback: alter table public.customer_pull_formats drop column kind, drop column customer_name;
--           delete from public.customer_pull_formats where code in ('edi_862','edi_830');

alter table public.customer_pull_formats
  add column if not exists kind          text not null default 'pull',
  add column if not exists customer_name text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customer_pull_formats_kind_chk') then
    alter table public.customer_pull_formats
      add constraint customer_pull_formats_kind_chk check (kind in ('pull', 'order', 'forecast'));
  end if;
end $$;

comment on column public.customer_pull_formats.kind is
  'pull = สัญญาณดึง (e-SMART) · order = ไฟล์ใบสั่งส่งรายวัน (เทียบเท่า EDI 862) · forecast = ไฟล์แผนล่วงหน้า (830)';
comment on column public.customer_pull_formats.customer_name is
  'ชื่อลูกค้าเจ้าของฟอร์แมต (ไว้แสดง/ค้นหา) — การจับคู่ ship-to ยังใช้ ship_to_codes เหมือนเดิม';

-- ── seed 2 แถวที่ "เท่ากับสิ่งที่โค้ดรู้จักอยู่แล้ว" ให้คนเห็น/แก้ต่อได้จากหน้าจอ ──
-- alias ชุดนี้ = FALLBACK_EDI_DICT ใน src/utils/ediDetect.js (ต้องตรงกัน — แก้ที่ไหนแก้ให้ครบทั้งคู่)
insert into public.customer_pull_formats
  (code, name, customer_name, kind, ship_to_codes, detect_keywords, col_map, ts_format, is_active, note)
values
  ('edi_862', 'EDI 862 — Shipping Schedule (ใบสั่งส่งรายวัน)', 'FORD (ทุก ship-to)', 'order',
   '{}', '{}',
   jsonb_build_object(
     'part',    jsonb_build_array('Part Num', 'Part Number', 'PartNo', 'Part'),
     'qty',     jsonb_build_array('Forecast Net Qty', 'Net Qty', 'Forecast Qty', 'Quantity', 'Qty'),
     'date',    jsonb_build_array('Forecast Date', 'Date', 'Ship Date', 'Delivery Date'),
     'time',    jsonb_build_array('Forecast Time', 'Time', 'Ship Time', 'Delivery Time', 'Forecast Ship Time'),
     'dock',    jsonb_build_array('Dock Code', 'Dock', 'Market Row', 'Unload Point'),
     'ship_to', jsonb_build_array('Ship To GSDB Code', 'Ship To', 'GSDB', 'Ship To Code'),
     'po',      jsonb_build_array('Purchase Order Num', 'Purchase Order', 'PO Num', 'PO')
   ),
   'ISO', true,
   'ค่าตั้งต้นของระบบ — ลูกค้าเจ้าอื่นที่ส่งไฟล์คนละหน้าตา ให้เพิ่มแถวใหม่ อย่าลบแถวนี้'),
  ('edi_830', 'EDI 830 — Planning Forecast (แผนล่วงหน้า)', 'FORD (ทุก ship-to)', 'forecast',
   '{}', '{}',
   jsonb_build_object(
     'part',    jsonb_build_array('Part Num', 'Part Number', 'PartNo', 'Part'),
     'qty',     jsonb_build_array('Forecast Net Qty', 'Net Qty', 'Forecast Qty', 'Quantity', 'Qty'),
     'date',    jsonb_build_array('Forecast Date', 'Date', 'Ship Date', 'Delivery Date'),
     'ship_to', jsonb_build_array('Ship To GSDB Code', 'Ship To', 'GSDB', 'Ship To Code'),
     'po',      jsonb_build_array('Purchase Order Num', 'Purchase Order', 'PO Num', 'PO')
   ),
   'ISO', true,
   'ค่าตั้งต้นของระบบ — ไม่มีคอลัมน์เวลา/ท่ารับ คือสัญญาณว่าเป็นแผนล่วงหน้า ไม่ใช่ใบส่ง')
on conflict (code) do nothing;
