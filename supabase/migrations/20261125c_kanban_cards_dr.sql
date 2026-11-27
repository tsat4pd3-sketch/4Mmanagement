/* ═══ 🎴 e-Kanban — ใบคัมบังที่มี "ตัวตนรายใบ" (DR · 2026-11-25 · คำสั่ง user) ═══════════
   user: *"อยากให้ระบบ gen ใบ e-kanban ในหน้าจอได้ เพื่อจะได้ไม่ต้องมีการส่งใบจริง"*
         *"อยากลดการเดินของพนักงาน"*

   ── ลูปจริงที่หน้างานทำอยู่ (user อธิบาย 25/11) ───────────────────────────────────
     การ์ดติดอยู่กับ**ตระกร้า/กล่อง**ที่สโตร์ → ส่งมาพร้อมกล่องถึงไลน์ →
     ไลน์ใช้หมด → **พักการ์ดขึ้นตู้** → **สโตร์เดินเก็บตามรอบ** → เตรียมของส่งใหม่
   ⇒ ขาที่ e-kanban ตัดทิ้งได้คือ **"เดินไปเก็บการ์ด"** (วัด 30 วัน: 30.5 เที่ยว/วัน · 10 ไลน์)
     เหลือเฉพาะเที่ยวขนของจริง ซึ่งตัดไม่ได้

   🔴🔴 **ป้ายหน้างานมี 2 ชนิด ห้ามปน** (user ยืนยัน 25/11):
     · **แท็ก one-way จาก SAP** ติดตระกร้า/กล่องในสโตร์ = บอกว่ากล่องนี้คือพาร์ทอะไร **ไปกับของ ไม่วนกลับ** → ระบบนี้ไม่แตะ
     · **ใบ PW KANBAN** = **สัญญาณเบิก ต้องวนกลับสโตร์** → ตารางนี้แทนใบนั้น
   ⇒ ใบที่แทนเป็น**สัญญาณล้วน ไม่มีหน้าที่ทางกายภาพ** ⇒ เลิกใบจริงได้โดยไม่เสียการระบุกล่อง
   🔴 **ห้ามทำป้ายติดกล่องชุดที่ 2** — ของที่ระบบออกคือ QR ถาวรติด**ชั้น/จุดวางที่ไลน์** ไม่ใช่ติดกล่อง

   ── 🔴 ทำไมต้องมีตารางนี้ (ของเดิมตอบไม่ได้) ────────────────────────────────────
   `kanban_standards` รู้แค่ "พาร์ทนี้ใช้ 8 ใบ ใบละ 600 ชิ้น" (`total_kanban`/`qty_per_kanban`)
   แต่ **ไม่มีตัวตนของ "ใบที่ 3"** ⇒ ตอบไม่ได้ว่าใบไหนอยู่ที่ไลน์ ใบไหนอยู่ในตู้รอเก็บ
   1 แถวที่นี่ = **1 กล่องที่หมุนอยู่ในลูป** (ไม่ใช่ 1 ช่องวาง)

   ── สถานะ = ตำแหน่งจริงของการ์ดในลูป (วนกลับที่เดิม ห้ามข้ามขั้น) ────────────────
     at_line    การ์ดติดกล่องอยู่ที่ไลน์ กำลังใช้
     in_box     ใช้หมดแล้ว พักขึ้นตู้ = **คิวรอสโตร์**  ← "ถอดป้าย" อยู่ตรงนี้
     picking    สโตร์รับคิวแล้ว กำลังเตรียมของ
     delivering ของกำลังเดินทาง
     → สแกนจุดส่ง (ESM:D) = กลับ at_line
   🔴 **เจ้าของกฎการเปลี่ยนสถานะ = `src/utils/kanbanCard.js` ห้ามเขียนเงื่อนไขซ้ำในหน้า**

   ── 🔴 "ระบบเสนอ คนตัดสิน" (คำสั่ง user 25/11) ──────────────────────────────────
   backflush บอกได้ว่า *น่าจะ* ใช้ครบ 1 กล่องแล้ว ⇒ เขียนลง `suggested_at`/`suggest_reason`
   **ห้ามเปลี่ยน `state` ให้เอง** — คนหน้าไลน์เป็นคนยืนยัน (= การนำการ์ดขึ้นตู้ของจริง)
   เหตุผล: BOM/backflush ยังเพี้ยนได้ ถ้าถอดเอง ป้ายจะถอดผิดจังหวะเงียบๆ แล้วของมาไม่ตรงเวลา

   ── ประวัติอยู่ที่ `kanban_card_events` — **ledger ห้ามแก้แถวเดิม** ────────────────
   ใบเดินผิดขั้น = เขียน event ใหม่ที่อธิบายตัวเองได้ ห้ามลบ/ทับของเก่า

   🔴 RLS = pattern ฝั่ง DR (`using(true)`) เพราะ `supabaseDR` วิ่งด้วย role `anon` เสมอ
      **ห้ามเปลี่ยนเป็น `TO authenticated`** = พังทั้งระบบ (CLAUDE.md §Supabase Projects)
   ═══════════════════════════════════════════════════════════════════════════════ */

create table if not exists public.kanban_cards (
  id            uuid primary key default gen_random_uuid(),
  card_no       text not null,                    -- เลขใบที่คนอ่าน เช่น 30051864-03
  mat_no        text not null,
  line_name     text not null,                    -- ปลายทาง (TO AREA บนใบจริง)
  from_location text,                             -- ต้นทาง (storage_locations.code · FROM AREA) · null = ยังไม่ตั้ง
  qty_per_card  numeric not null check (qty_per_card > 0),  -- snapshot ตอนออกใบ (ทะเบียนเปลี่ยนทีหลัง ใบเดิมต้องไม่เปลี่ยน)
  seq           int  not null check (seq > 0),    -- ใบที่เท่าไหร่
  total_cards   int,                              -- จาก total_kanban ตอนออก (null = ไม่รู้ ห้ามเดา)
  state         text not null default 'at_line',
  state_at      timestamptz not null default now(),
  state_by      text,
  /* ระบบเสนอให้ถอด — คนยังไม่ยืนยัน (ว่าง = ไม่มีข้อเสนอค้าง) */
  suggested_at    timestamptz,
  suggest_reason  text,
  is_active     boolean not null default true,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by_name text,
  updated_by_uid  uuid,
  constraint kanban_cards_state_chk
    check (state in ('at_line','in_box','picking','delivering'))
);

/* คีย์ธรรมชาติ = พาร์ท+ไลน์+ลำดับใบ · unique คอลัมน์ล้วน (upsert ใช้ได้ · db-write-rules ข้อ 3) */
create unique index if not exists kanban_cards_key_uidx
  on public.kanban_cards (mat_no, line_name, seq);
create unique index if not exists kanban_cards_no_uidx on public.kanban_cards (card_no);
create index if not exists kanban_cards_line_state_idx on public.kanban_cards (line_name, state);
create index if not exists kanban_cards_mat_idx on public.kanban_cards (mat_no);

create table if not exists public.kanban_card_events (
  id         uuid primary key default gen_random_uuid(),
  card_id    uuid not null references public.kanban_cards(id) on delete cascade,
  from_state text,
  to_state   text not null,
  source     text not null default 'manual',   -- manual | suggest | scan | system
  by_name    text,
  by_uid     uuid,
  note       text,
  ref_id     uuid,                             -- ใบขอเติม/เที่ยวส่งที่ผูกกัน (ถ้ามี)
  created_at timestamptz not null default now()
);
create index if not exists kanban_card_events_card_idx on public.kanban_card_events (card_id, created_at desc);

alter table public.kanban_cards       enable row level security;
alter table public.kanban_card_events enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='kanban_cards' and policyname='kanban_cards_all') then
    create policy kanban_cards_all on public.kanban_cards for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='kanban_card_events' and policyname='kanban_card_events_all') then
    create policy kanban_card_events_all on public.kanban_card_events for all using (true) with check (true);
  end if;
end $$;

/* 🔴 GRANT ระดับตารางต้องครบทุก cmd ที่ client ใช้ — RLS ผ่านแต่ GRANT ขาด = PostgREST ตอบ 401 */
grant select, insert, update, delete on public.kanban_cards       to anon, authenticated;
grant select, insert                 on public.kanban_card_events to anon, authenticated;

/* updated_at อัตโนมัติ (pattern เดียวกับ master ตัวอื่นฝั่ง DR) */
create or replace function public.tg_kanban_cards_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if new.state is distinct from old.state then new.state_at := now(); end if;
  return new;
end $$;

drop trigger if exists trg_kanban_cards_touch on public.kanban_cards;
create trigger trg_kanban_cards_touch before update on public.kanban_cards
  for each row execute function public.tg_kanban_cards_touch();

comment on table public.kanban_cards is
  'ใบ e-kanban รายใบ = 1 กล่องที่หมุนในลูป · กฎสถานะอยู่ src/utils/kanbanCard.js (2026-11-25)';
comment on table public.kanban_card_events is
  'ledger การเปลี่ยนสถานะของใบ — ห้ามแก้/ลบแถวเดิม';
