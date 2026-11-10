-- ════════════════════════════════════════════════════════════════════════════
-- 🔙 ย้อนการปิดใบ MO ที่เซ็นปิดไปแล้วทั้งที่ลูป PR ยังไม่จบ   (DR · 2026-11-10)
--    project: "Product DB" (DR) = eyhclzkifitbhbljgoav
--
-- คำสั่ง user: *"ของเก่าที่อนุมัติปิดไปแล้วแต่ pr ยังไม่จบ reverse กลับด้วย"*
--   ต่อจากด่านใหม่ `moCloseGate()` (src/utils/moChase.js) ที่บล็อกการปิดใบตอน PR ค้าง
--   — ด่านกันของใหม่ได้ แต่ของเก่าที่ปิดไปก่อนมีด่าน ยังค้างอยู่ในฐาน
--
-- ── วัดจริงก่อนแก้ (10/11) ───────────────────────────────────────────────────
--   ใบ status='closed' ที่ยังมีใบขอซื้อซึ่งไม่ใช่ received/cancelled = **4 ใบ ทั้งหมดฟอร์มทีม MTN**
--     O-MTN.2026/10-52  LASER-789 · PD3  PR 1210104217 ordered
--     O-MTN.2026/10-47  Laser LWR · PD4  PR 1210104223 ordered (มี 2 แถวเลขเดียวกัน)
--     O-MTN.2026/10-41  LASER-345 · PD3  PR 1210104287 requested
--     O-MTN.2026/10-57  Line 61   · PD3  PR 1210104329 requested
--   ฟอร์ม JIG/DIE/PD (ขั้น 7 `close`) = 0 ใบ — แต่เขียนสาขาไว้ให้ครบ เพราะ **คนละคอลัมน์**
--
-- ── 🔴 กฎที่ไฟล์นี้ยึด ────────────────────────────────────────────────────────
-- 1. **เก็บแถวเต็มก่อนแก้ลง schema `archive` ก่อนเสมอ** (กฎ CLAUDE.md: migration ที่ copy
--    ข้อมูลกันพลาด ต้องอยู่ schema `archive` ห้ามไว้ใน `public`) ⇒ กู้คืนได้ 100% ด้วยคิวรีท้ายไฟล์
-- 2. **ห้ามแก้คอลัมน์ของขั้นอื่น** — ฟอร์ม MTN ขั้น 7 (ผจก.ช่าง) ใช้ `approve_at`/`approve_sign`
--    ซึ่ง**ชื่อซ้ำ**กับช่องปิดใบของฟอร์ม JIG/DIE ⇒ ล้างผิดสาขา = ลบลายเซ็น ผจก.ช่างทิ้งเงียบๆ
--      · ฟอร์ม MTN  (ขั้น 8 `cost_mgr_close`) ⇒ ล้าง `cost_mgr_at` + `cost_mgr_sign`
--      · ฟอร์มอื่น  (ขั้น 7 `close`)          ⇒ ล้าง `approve_at`  + `approve_sign`
-- 3. **`cost_mgr_name` / `approver_name` ไม่ล้าง** — ชื่อ "ผู้ที่ต้องเซ็นขั้นสุดท้าย" ถูกกรอกไว้
--    ตั้งแต่ขั้น 6 (ดูคอมเมนต์ใน MtnRepair.jsx: ชื่ออยู่ในใบได้ แต่ `*_at` ต้องมาจากการเซ็นจริง)
--    ล้างไปด้วย = ลบข้อมูลของขั้นที่ไม่ได้ย้อน
-- 4. **`snapshot` ไม่ล้าง** — ใบพิมพ์ใช้ snapshot เฉพาะเมื่อ `status='closed'` (`moFromSnapshot`)
--    ⇒ ใบที่ย้อนกลับมาเปิด พิมพ์สดเหมือนใบเปิดทั่วไป · snapshot เดิมคาไว้เป็นหลักฐาน
--    และจะถูกเขียนใหม่ตอนปิดใบจริง (`saveMoSnapshot`)
-- 5. **status กลับเป็น `handover` ไม่ใช่ค่าใหม่** — ขั้น 6-7-8 ของฟอร์ม MTN คง `handover`
--    ทั้ง 3 ขั้นโดยเจตนา (KPI/Andon/dieStatus/FactoryMap/TvBoard/edge อ่าน status ตรงๆ)
--    แยกขั้นด้วย "เวลาเซ็นจริง" ผ่าน `mtnCloseStage()` ⇒ ล้าง `cost_mgr_at` แล้วใบกลับไปรอขั้น 8 เอง
-- 6. **ไม่ยิงแจ้งเตือน** — ตรวจแล้ว `mtn_orders` มี trigger เฉพาะ AFTER DELETE (`fn_audit`)
--    ⇒ UPDATE ไม่ปลุก Telegram/notifications · ใบกลับเข้า "คิวรอคุณ" ของ ผจก. เอง (แผงแบบดึง)
-- 7. **เขียนเหตุผลลงคอมเมนต์ใต้ใบ** (`event_comments` ref_kind='mtn_order') — ไม่งั้นหน้างาน
--    เห็นใบเด้งกลับมาแล้วไม่รู้ว่าใครทำอะไร · ห้ามแก้ทับ `report_note` ของผู้แจ้ง
-- ════════════════════════════════════════════════════════════════════════════

create schema if not exists archive;

create table if not exists archive.mtn_close_reversed_20261110 (
  id                 uuid primary key,
  mo_no              text,
  mtn_dept           text,
  form_kind          text not null,          -- 'mtn' (ขั้น 8) | 'other' (ขั้น 7)
  open_pr_n          int  not null,
  open_pr_list       text,
  reversed_at        timestamptz not null default now(),
  reason             text not null,
  prev_row           jsonb not null           -- 🔴 แถวเต็มก่อนแก้ = ตัวกู้คืน
);

comment on table archive.mtn_close_reversed_20261110 is
  'ใบ MO ที่ถูกย้อนการปิด 10/11/2026 เพราะลูป PR ยังไม่จบ (คำสั่ง user) — prev_row = แถวเต็มก่อนแก้ ใช้กู้คืน';

-- ── ① เก็บของเดิม + ② ย้อนใบ ในธุรกรรมเดียว (ชุดเป้าหมายคิดครั้งเดียว ห้ามคิดใหม่ 2 รอบ) ──
with target as (
  select o.id,
         case when lower(btrim(coalesce(o.mtn_dept,''))) in ('maintenance','mtn')
              then 'mtn' else 'other' end as form_kind,
         count(p.id)::int as open_pr_n,
         string_agg(coalesce(nullif(btrim(p.pr_no),''),'(ยังไม่ลงเลข PR)') || ':' || p.status, ', '
                    order by p.pr_no) as open_pr_list
    from public.mtn_orders o
    join public.mtn_purchase_requests p
      on p.order_id = o.id
     and p.status is distinct from 'received'
     and p.status is distinct from 'cancelled'
   where o.status = 'closed'
   group by o.id
),
saved as (
  insert into archive.mtn_close_reversed_20261110
        (id, mo_no, mtn_dept, form_kind, open_pr_n, open_pr_list, reason, prev_row)
  select o.id, o.mo_no, o.mtn_dept, t.form_kind, t.open_pr_n, t.open_pr_list,
         'ปิดใบทั้งที่ใบขอซื้อยังไม่จบลูป (ยังไม่ received/cancelled) — ย้อนกลับไปขั้นรออนุมัติปิดใบ'
         || ' ตามคำสั่ง user 10/11/2026 · ด่านใหม่ moCloseGate() กันของใหม่แล้ว',
         to_jsonb(o)
    from public.mtn_orders o join target t on t.id = o.id
  on conflict (id) do nothing
  returning id, form_kind
)
update public.mtn_orders o
   set status       = 'handover',
       current_step = case when s.form_kind = 'mtn' then 7 else 6 end,
       -- 🔴 ล้างเฉพาะช่องปิดใบของฟอร์มนั้น (ชื่อคอลัมน์ซ้ำกันข้ามฟอร์ม)
       cost_mgr_at   = case when s.form_kind = 'mtn'   then null else o.cost_mgr_at  end,
       cost_mgr_sign = case when s.form_kind = 'mtn'   then null else o.cost_mgr_sign end,
       approve_at    = case when s.form_kind = 'other' then null else o.approve_at   end,
       approve_sign  = case when s.form_kind = 'other' then null else o.approve_sign end,
       updated_at   = now()
  from saved s
 where o.id = s.id;

-- ── ③ เขียนเหตุผลใต้ใบ (ไปโผล่บนใบพิมพ์/Excel ผ่าน moCommentLines() ด้วย) ──
insert into public.event_comments (ref_kind, ref_id, author_name, body)
select 'mtn_order', a.id::text, 'ระบบ ESM (คำสั่งผู้ดูแล)',
       '🔙 ย้อนการอนุมัติปิดใบ — ใบนี้ถูกเซ็นปิดไปแล้วทั้งที่ใบขอซื้อยังไม่จบลูป ('
       || a.open_pr_n || ' ใบ: ' || coalesce(a.open_pr_list,'-') || ')' || chr(10)
       || 'ใบกลับไปรอขั้นอนุมัติปิดใบ · ลายเซ็นช่องปิดใบถูกล้าง (ลายเซ็นขั้นก่อนหน้าคงเดิม)' || chr(10)
       || 'ปิดใบได้อีกครั้งเมื่อลูป PR จบ: รับของเข้าสต็อก หรือ ยกเลิกใบขอซื้อที่ไม่ใช้'
  from archive.mtn_close_reversed_20261110 a
 -- idempotent ด้วยการเช็คว่ามีคอมเมนต์นี้แล้วหรือยัง (ห้ามกรองด้วยเวลา — รันซ้ำแล้วจะข้ามใบที่ยังไม่มี)
 where not exists (
     select 1 from public.event_comments c
      where c.ref_kind = 'mtn_order' and c.ref_id = a.id::text
        and c.body like '🔙 ย้อนการอนุมัติปิดใบ%');

-- ════════════════════════════════════════════════════════════════════════════
-- ✅ คิวรีเช็คผล (รันบน "Product DB" / eyhclzkifitbhbljgoav)
--
-- 1) ต้องไม่มีใบปิดที่ PR ยังค้างเหลืออยู่ (คาดหวัง 0 แถว)
--    select o.mo_no, o.status, count(p.id) from mtn_orders o
--      join mtn_purchase_requests p on p.order_id=o.id
--       and p.status is distinct from 'received' and p.status is distinct from 'cancelled'
--     where o.status='closed' group by o.id;
--
-- 2) ใบที่ย้อนแล้ว อยู่ขั้นไหน (คาดหวัง status=handover · cost_mgr_at ว่าง · approve_at ยังอยู่)
--    select a.mo_no, a.form_kind, a.open_pr_list, o.status, o.current_step,
--           o.cost_mgr_at, o.cost_mgr_sign is not null as has_cm_sign,
--           o.approve_at,  o.approve_sign  is not null as has_ap_sign
--      from archive.mtn_close_reversed_20261110 a join mtn_orders o on o.id=a.id;
--
-- 3) จำนวนต้องเท่ากัน: ที่เก็บไว้ = ที่ย้อน (ไม่มีใบหลุด)
--    select (select count(*) from archive.mtn_close_reversed_20261110) as saved,
--           (select count(*) from archive.mtn_close_reversed_20261110 a
--              join mtn_orders o on o.id=a.id where o.status='handover') as reversed;
--
-- ⏪ ROLLBACK — คืนทุกใบกลับเป็นปิดเหมือนเดิม (กู้จาก prev_row ตรงๆ)
--    update mtn_orders o set
--      status        = a.prev_row->>'status',
--      current_step  = (a.prev_row->>'current_step')::int,
--      cost_mgr_at   = nullif(a.prev_row->>'cost_mgr_at','')::timestamptz,
--      cost_mgr_sign = a.prev_row->>'cost_mgr_sign',
--      approve_at    = nullif(a.prev_row->>'approve_at','')::timestamptz,
--      approve_sign  = a.prev_row->>'approve_sign',
--      updated_at    = now()
--    from archive.mtn_close_reversed_20261110 a where o.id = a.id;
--    delete from event_comments where ref_kind='mtn_order' and body like '🔙 ย้อนการอนุมัติปิดใบ%';
-- ════════════════════════════════════════════════════════════════════════════
