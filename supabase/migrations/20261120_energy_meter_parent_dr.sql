-- ⚡ ผังจ่ายไฟหลายชั้น (DR "Product DB" · 2026-11-20 · คำสั่ง user "เอาผังวาดให้สมบูรณ์")
-- มิเตอร์ลูกบอกว่าต่อจากมิเตอร์ตัวไหน (ชื่อ scope_name ของแม่ใน scope_kind เดียวกัน)
-- · null = อยู่ชั้นบนสุดของตู้ (`panel`) = พฤติกรรมเดิมทุกแถว
-- · ยอดรวมตู้/ทั้งโรงงานนับเฉพาะชั้นบนสุด (ลูกอยู่ในยอดแม่แล้ว · กันนับซ้ำ) — กฎใน src/utils/energy.js buildLiveBoard()
-- ย้อนกลับ: alter table public.energy_live_meters drop column if exists parent_name;
alter table public.energy_live_meters add column if not exists parent_name text;
comment on column public.energy_live_meters.parent_name is
  'มิเตอร์แม่ (scope_name ใน scope_kind เดียวกัน) · null = ชั้นบนสุดของตู้ · ยอดรวมนับเฉพาะชั้นบนสุด';
