/*  ═══════════════════════════════════════════════════════════════════════════════════════
    ทบทวน Cycle Time — "ระบบเสนอ วิศวกรตัดสิน"
    project: DR / "Product DB"  (eyhclzkifitbhbljgoav)          วันที่: 2026-09-18
    ═══════════════════════════════════════════════════════════════════════════════════════

    คำสั่ง user (17-18/09):
      *"ปกติก็ต้อง CT มาตรฐานนะ แต่ adaptive เอาไว้โชว์ให้เห็นว่า actual ที่ทำได้
        และอาจจะรอวิศวกรอนุมัติปรับ ก็จะกลายเป็น CT มาตรฐานใหม่"*

    ── 🔴 สัญญาที่ห้ามผิด ──────────────────────────────────────────────────────────────────
      1. `%P` หารด้วย **CT มาตรฐาน** (`dr_products.cycle_time_sec`) เสมอ
         ⇒ ตารางนี้ไม่เคยถูกอ่านโดยสูตร OEE เลย เป็นแค่ "คิวข้อเสนอ"
      2. **ระบบไม่เขียน master เอง** — ต้องมีคนกดอนุมัติ (กติกาเดียวกับ `pe_master_proposals`
         ในฝั่ง Main · ที่นั่นเป็นคนละ project จึงลอกกติกามา ไม่ได้ใช้ตารางร่วม)
      3. อนุมัติแล้ว **เขียนผ่าน `dr_products` ตามปกติ** ⇒ `fn_audit` บันทึกให้เอง
         ⇒ โผล่ใน `v_ct_history` + `ct_sec_at()` ที่ทำไว้ 17/09 — **ห้ามเขียนประวัติซ้อนเอง**

    ── ทำไมต้องมีคิว ไม่ใช่ปุ่มแก้ตรงๆ ────────────────────────────────────────────────────
    CT ตัวนี้ผูกกับ Control Plan / PFC / งานที่ส่งลูกค้า (PPAP) — เปลี่ยนแล้วกระทบเอกสารคุณภาพ
    จึงต้องมีร่องรอยว่า *ใครเสนอ · อ้างอิงจากกี่ใบ · ใครอนุมัติ · เพราะอะไร*

    RLS: ฝั่ง DR ไม่มี `has_perm()` และ `supabaseDR` วิ่งด้วย role `anon` เสมอ
         ⇒ เปิด anon ตาม convention ของ DR ทั้ง project (กฎเหล็กใน CLAUDE.md)
         ด่านสิทธิ์จริงอยู่ที่ client ผ่าน `can('ct:manage')` — known gap เดียวกับทั้ง DR project

    ── ROLLBACK ────────────────────────────────────────────────────────────────────────────
      drop table if exists ct_proposals;
    ═══════════════════════════════════════════════════════════════════════════════════════ */

begin;

create table if not exists ct_proposals (
  id               uuid primary key default gen_random_uuid(),
  mat_no           text not null,
  product_name     text,
  line_name        text,

  ct_standard      numeric,          -- ค่า master ณ ตอนเสนอ (ให้คนเทียบ · null = ยังไม่เคยตั้ง)
  ct_observed      numeric not null, -- ค่าที่เสนอ = มัธยฐานจาก actual (ห้ามใช้ mean)

  -- หลักฐานประกอบการตัดสิน — ไม่มีตรงนี้ วิศวกรตัดสินไม่ได้
  sample_orders    integer not null, -- นับเฉพาะใบที่ผ่านเกณฑ์แล้ว
  dropped_orders   integer default 0,-- ใบที่ถูกตัดทิ้งเพราะข้อมูลเป็นไปไม่ได้
  p25              numeric,
  p75              numeric,          -- p25/p75 = การกระจายตัว บอกว่าข้อมูลนิ่งแค่ไหน
  sample_from      date,
  sample_to        date,
  flags            text[] default '{}',  -- few_samples / dropped_impossible_* / big_gap

  status           text not null default 'proposed'
                   check (status in ('proposed','accepted','rejected')),
  reject_reason    text,
  decided_by       text,
  decided_at       timestamptz,

  created_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- ปฏิเสธต้องบอกเหตุผลเสมอ (กติกาเดียวกับ pe_master_proposals) — กัน "ปฏิเสธลอยๆ" ที่สืบไม่ได้
  constraint ct_prop_reject_needs_reason
    check (status <> 'rejected' or coalesce(btrim(reject_reason), '') <> ''),
  -- ข้อเสนอต้องมีตัวเลขที่ใช้ได้จริง
  constraint ct_prop_observed_positive check (ct_observed > 0),
  constraint ct_prop_sample_positive   check (sample_orders > 0)
);

-- 1 พาร์ท มีข้อเสนอที่ยังไม่ตัดสินได้ทีละ 1 ใบเท่านั้น (กันคิวบวมแบบ 4M auto ที่เคยยิง 392 ใบ)
create unique index if not exists ct_proposals_one_open_per_mat
  on ct_proposals (mat_no) where status = 'proposed';

create index if not exists ct_proposals_status_idx on ct_proposals (status, created_at desc);

alter table ct_proposals enable row level security;
do $$ begin
  create policy ct_proposals_all on ct_proposals for all using (true) with check (true);
exception when duplicate_object then null; end $$;

drop trigger if exists trg_ct_proposals_updated on ct_proposals;
do $$ begin
  if exists (select 1 from pg_proc where proname = 'fn_set_updated_at') then
    execute 'create trigger trg_ct_proposals_updated before update on ct_proposals
             for each row execute function fn_set_updated_at()';
  end if;
end $$;

comment on table ct_proposals is
  'คิวข้อเสนอปรับ Cycle Time — ระบบเสนอจาก actual วิศวกรตัดสิน · **สูตร OEE ไม่เคยอ่านตารางนี้** (%P หารด้วย dr_products.cycle_time_sec เสมอ) · อนุมัติแล้วเขียนผ่าน dr_products ให้ fn_audit บันทึกเอง ดู v_ct_history';

commit;

/* ── ตรวจผลหลังรัน ─────────────────────────────────────────────────────────────────────
select count(*) as คิวที่รออนุมัติ from ct_proposals where status = 'proposed';

-- กันคิวซ้ำ: ต้องขึ้น error 23505 ถ้ามีข้อเสนอค้างของพาร์ทเดิมอยู่แล้ว
-- insert into ct_proposals (mat_no, ct_observed, sample_orders) values ('TEST', 50, 12);
─────────────────────────────────────────────────────────────────────────────────────── */
