/* ═══ 🔧 ของที่ถอดออกมาแล้วส่งซ่อมภายนอก เพื่อเอากลับมาเป็นสแปร์ ═══  2026-10-26
   ฝั่ง **DR (Product DB · eyhclzkifitbhbljgoav)**

   เคสจริง (ทีม MTN · Axis Com Robot): ช่างเปลี่ยนอะไหล่สำรองเข้าเครื่อง **เครื่องกลับมาผลิตทันที
   ใบ MO ปิดได้ตามปกติ** — แต่ของตัวที่ถอดออกมาไม่ได้ทิ้ง ส่งไปซ่อมข้างนอกแล้วเอากลับมาเป็นสแปร์
   ⇒ "พอของกลับมา กดรับ PO ของชิ้นนั้นจะกลับเข้าไปที่ Stock Spare Part"

   🔴 ทำไมใช้ `mtn_orders.vendor_*` เดิมไม่ได้:
      คอลัมน์ชุดนั้นแปลว่า **"ใบนี้รอของจาก supplier อยู่"** (เครื่องยังเสีย ใบยังไม่จบ) และ
      `summarizeMachineHistory()` เอาช่วง `vendor_sent_at → vendor_back_at` ไป**หักออกจากเวลาซ่อมของช่าง**
      ⇒ ใบที่ปิดแล้วแต่ของยังอยู่ข้างนอกจะทำให้ KPI เวลาซ่อมเพี้ยน · คนละเรื่องกันคนละทิศ
      (วัด 26/10: ชุด vendor_* ไม่เคยถูกใช้เลยสักใบ — repair_path ระบุแค่ 5/1,150 · outsource 1 ใบ)

   🔴 สต็อก: **ตอนส่งไม่แตะ** (ของเสียไม่เคยอยู่ในสต็อก) · **ตอนรับกลับ +qty** ผ่าน `mtn_stock_move('in')`
      จากฝั่ง client — ตารางนี้ไม่ยุ่งกับสต็อกเอง (กันยอดขยับ 2 ทางแล้วตามไม่ทัน)

   ย้อนกลับ: `drop table if exists public.mtn_outsource_parts;` (ตารางใหม่ล้วน ไม่แตะของเดิม) */

create table if not exists public.mtn_outsource_parts (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.mtn_orders(id) on delete cascade,
  -- อะไหล่ในทะเบียน (ชนิดเดียวกับตัวที่เบิกไปใส่) · null = ของที่ไม่มีในทะเบียน พิมพ์ชื่อเอง
  part_id       uuid references public.mtn_spare_parts(id) on delete set null,
  part_name     text not null,
  qty           numeric not null default 1 check (qty > 0),
  supplier      text,                       -- ส่งไปที่ไหน — "อยู่ไหนบ้าง" ของลิสต์ติดตาม
  pr_no         text,                       -- เลข PR/PO ของงานซ่อม (ค่าซ่อม ≠ ราคาซื้อ)
  repair_cost   numeric,                    -- ค่าซ่อมต่อชิ้น (ว่างได้ — ยังไม่รู้ราคาก็ส่งไปก่อนได้)
  sent_at       timestamptz not null default now(),
  sent_by       text,
  expected_at   date,                       -- นัดรับกลับ (ว่าง = ไม่ได้นัด)
  back_at       timestamptz,                -- null = **ยังอยู่ข้างนอก** ← ตัวตั้งของลิสต์ติดตาม
  back_by       text,
  cancelled_at  timestamptz,                -- ซ่อมไม่ได้/ไม่เอากลับ — เก็บประวัติไว้ ห้าม delete
  cancel_reason text,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by_name text
);

comment on table public.mtn_outsource_parts is
  'ของที่ถอดจากเครื่องแล้วส่งซ่อมภายนอกเพื่อเอากลับมาเป็นสแปร์ — ใบ MO ปิดได้โดยไม่ต้องรอของ (2026-10-26)';

/* ค้นหา "ของที่ยังไม่กลับ" คือคิวรีหลักของฟีเจอร์นี้ ⇒ index ตรงนั้น */
create index if not exists mtn_outsource_parts_pending_idx
  on public.mtn_outsource_parts (sent_at desc)
  where back_at is null and cancelled_at is null;
create index if not exists mtn_outsource_parts_order_idx
  on public.mtn_outsource_parts (order_id);
/* 🔴 FK ที่ไม่มี index = ลบอะไหล่ 1 ตัวต้อง seq-scan ทั้งตาราง (บทเรียน fixture_shim_events) */
create index if not exists mtn_outsource_parts_part_idx
  on public.mtn_outsource_parts (part_id);

alter table public.mtn_outsource_parts enable row level security;

/* ⚠️ ฝั่ง DR ทุก client วิ่งด้วย role `anon` เสมอ (ไม่มี JWT ให้เช็ค)
   ⇒ policy ต้องเป็น anon/authenticated แบบเดียวกับตารางพี่น้อง (mtn_order_parts)
   **ห้ามเปลี่ยนเป็น TO authenticated** = พังทั้งระบบทันที (CLAUDE.md §Supabase Projects) */
drop policy if exists mtn_outsource_parts_all on public.mtn_outsource_parts;
create policy mtn_outsource_parts_all on public.mtn_outsource_parts
  for all to anon, authenticated using (true) with check (true);

/* audit — ใครแก้อะไร (trigger ตัวเดียวกับตารางอื่นในโมดูล) */
drop trigger if exists trg_audit_outsource_parts on public.mtn_outsource_parts;
create trigger trg_audit_outsource_parts
  after insert or update or delete on public.mtn_outsource_parts
  for each row execute function public.fn_audit();
