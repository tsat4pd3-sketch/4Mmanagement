-- ── DR project "Product DB" (eyhclzkifitbhbljgoav) ──
-- 🔗 ทะเบียน "จับคู่พาร์ทลูกค้า → MAT SAP" ที่คนยืนยันแล้ว (2026-10-01 · คำสั่ง user)
-- user: *"จะแก้ error พวกนี้ให้หายขาดทำยังไง แจ้ง error มาก็ไม่รู้จะไปแก้ยังไง · แจ้งให้เช็คว่าจับคู่ถูกมั้ย แล้วตัดสินใจอะไรได้"*
--
-- ตัวนำเข้า EDI (PlannerSales.jsx) เดาคู่จาก dr_products.p_no — เตือน 3 แบบแต่แก้จากจอไม่ได้:
--   ① จับคู่ไม่ได้ (ไม่มี p_no) ② 1 พาร์ทหลาย MAT แยกลูกค้าไม่ออก ③ จับจาก base part (rev ต่าง)
-- ⇒ คนตัดสินบนจอ preview ครั้งเดียว → เก็บที่นี่ → นำเข้ารอบถัดไปใช้คำตัดสินนี้ก่อนการเดาทุกชั้น
-- ship_to = '' ⇒ ใช้กับทุก ship-to · มีค่า ⇒ เฉพาะ ship-to นั้น (ชนะแบบ '')
-- part_key = เลขพาร์ทลูกค้า normalize (ตัดขีด/ช่องว่าง · ตัวใหญ่) — ตรงกับ normKey ใน src/utils/ediMerge.js
-- ย้อนกลับ: drop table public.edi_part_map; (ตัวนำเข้าถอยไปใช้การเดาแบบเดิมเอง)

create table if not exists public.edi_part_map (
  id               uuid primary key default gen_random_uuid(),
  ship_to          text not null default '',
  part_key         text not null,
  customer_part_no text,
  mat_no           text not null,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by_name  text,
  unique (ship_to, part_key)
);
comment on table public.edi_part_map is
  'คำตัดสินของคน: เลขพาร์ทลูกค้า (+ship-to) → MAT SAP · ตัวนำเข้า EDI ใช้ก่อนการเดาจาก p_no';

alter table public.edi_part_map enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='edi_part_map' and policyname='edi_part_map_all') then
    create policy edi_part_map_all on public.edi_part_map for all using (true) with check (true); -- DR convention: anon-open
  end if;
end $$;

drop trigger if exists trg_edi_part_map_updated on public.edi_part_map;
create trigger trg_edi_part_map_updated before update on public.edi_part_map for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_edi_part_map_audit on public.edi_part_map;
create trigger trg_edi_part_map_audit after insert or update or delete on public.edi_part_map for each row execute function public.fn_audit();
