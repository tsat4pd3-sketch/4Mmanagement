-- ── DR project "Product DB" (eyhclzkifitbhbljgoav) ──
-- ผลตรวจ "ของชิ้นเดียวถูกนิยามไว้ 2 ใบ" (bom_dup_reviews) — 2026-10-08 · คำสั่ง user
--
-- ที่มา: ไล่ลิสต์ทั้งฐาน 06/10 เจอ **94 คู่** ที่ลูกของพาร์ทตัวหนึ่งถูกกรอกทั้งในใบ FG และในใบของพาร์ทเอง
--   user: *"ทำจอสรุป 94 คู่ให้ PE ไล่เคลียร์เลย"* → แท็บ 🔁 ใน /products (?tab=bomdup)
--   ลิสต์ตัวคู่ **ไม่เก็บในตาราง** — คำนวณสดจาก bom_items ทุกครั้ง (`src/utils/bomDupAudit.js`)
--   ตารางนี้เก็บแค่ "คนตรวจแล้วตัดสินว่าอะไร" เพื่อให้คู่ที่จบแล้วหายจากคิว
--
-- 🔴 ทำไมต้องมี `fingerprint`: PE กด "ถูกทั้ง 2 ใบ ปล่อยไว้" ไว้ แล้วพรุ่งนี้มีคนแก้ BOM
--   ⇒ ผลตรวจเก่าใช้ไม่ได้แล้ว แต่คู่นั้นจะหายจากคิวตลอดกาล = จอโกหก
--   เก็บลายนิ้วมือของ "ชุดลูกทั้ง 2 ใบ ณ เวลาที่ตรวจ" (FNV-1a ของ mat ที่เรียงแล้ว · `dupFingerprint()`)
--   ไม่ตรงกับของจริงวันนี้ = **เปิดคู่นั้นกลับเข้าคิว** พร้อมป้าย "ข้อมูลเปลี่ยนหลังตรวจ"
--   วัดจริง: ระหว่างทำงานนี้เอง (06/10 → 08/10) มี **82 แถวถูกเพิ่มใน bom_items**
--   และคู่ 10105772→20070036 เปลี่ยนผลจาก "ขัดกันจริง" เป็น "ใบ FG ขาดของ" — เคสนี้เกิดขึ้นจริงแล้ว
--
-- 🔑 คีย์ upsert = unique index **คอลัมน์ล้วน** (sheet_mat, component_mat) ห้าม expression/partial
--   (กฎเหล็ก DB ข้อ 3 — PostgREST infer ไม่เจอ = 42P10 = ไม่เขียนเลยทั้งก้อน · เกิดมา 3 รอบแล้ว)
--   เก็บเป็น **ตัวพิมพ์ใหญ่** ให้ตรงกับ `dupKeyOf()` ฝั่ง JS (MAT เขียนต่างตัวพิมพ์ = คนละคู่ไม่ได้)
--
-- ไม่แตะ bom_items / dr_products เลย · additive ทั้งหมด
-- rollback (revert โค้ดก่อน แล้วค่อยแตะ schema):
--   drop table public.bom_dup_reviews;

create table if not exists public.bom_dup_reviews (
  id                uuid primary key default gen_random_uuid(),
  sheet_mat         text not null,          -- MAT ของ "ใบ" ที่กรอกลูกไว้เอง (UPPERCASE)
  component_mat     text not null,          -- MAT ของพาร์ทที่ถูกนิยามไว้ 2 ที่ (UPPERCASE)
  fingerprint       text not null,          -- ลายนิ้วมือชุดลูกทั้ง 2 ใบ ตอนที่ตรวจ (ไม่ตรง = ตรวจใหม่)
  verdict           text,                   -- ผลที่ระบบตีไว้ตอนนั้น (subset/conflict/extra/identical/deeper/op)
  decision          text not null,          -- ok_both | fixed | later  (ดู DUP_DECISIONS ใน bomDupAudit.js)
  note              text,
  reviewed_by_name  text,
  reviewed_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by_name   text,
  constraint bom_dup_reviews_pair_uniq unique (sheet_mat, component_mat)
);
comment on table public.bom_dup_reviews is
  'ผลตรวจคู่ "นิยามไว้ 2 ใบ" ของ BOM (แท็บ 🔁 ใน /products) — ตัวลิสต์คำนวณสดจาก bom_items ไม่เก็บที่นี่ · fingerprint ไม่ตรง = คู่นั้นกลับเข้าคิว';

alter table public.bom_dup_reviews enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='bom_dup_reviews' and policyname='bom_dup_reviews_all') then
    create policy bom_dup_reviews_all on public.bom_dup_reviews for all using (true) with check (true); -- DR convention: anon-open
  end if;
end $$;

drop trigger if exists trg_bom_dup_reviews_updated on public.bom_dup_reviews;
create trigger trg_bom_dup_reviews_updated before update on public.bom_dup_reviews
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_bom_dup_reviews_audit on public.bom_dup_reviews;
create trigger trg_bom_dup_reviews_audit after insert or update or delete on public.bom_dup_reviews
  for each row execute function public.fn_audit();
