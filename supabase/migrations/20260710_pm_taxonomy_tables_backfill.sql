-- ★ DR project (eyhclzkifitbhbljgoav) — เขียนย้อนหลัง: ตารางนี้ถูกสร้างตรง (dashboard/MCP)
--   โดยไม่มี migration file — QC audit 2026-07-10 พบตกหล่น จึง backfill ไว้เป็นประวัติ
--   ตารางมีอยู่จริงแล้ว ไฟล์นี้ idempotent (create if not exists) ไม่ต้องรันซ้ำ
-- ใช้โดย: src/lib/pmTaxonomy.js + PMSetup.jsx (TaxonomyManagerModal) — หมวดจุดตรวจ/วิธีตรวจของ PM
-- RLS: ตาราง DR ทุกตัวต้องเปิดให้ role anon (กฎเหล็ก supabaseDR ไม่เคย authenticate)

create table if not exists public.pm_checkpoint_categories (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  label       text not null,
  color       text not null default '#6b7280',
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.pm_checking_methods (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  label       text not null,
  icon        text not null default '🔍',
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
