-- ═══════════════════════════════════════════════════════════════════════════
-- ปิดใบข้ามไลน์ "ไม่ต้องคอนเฟิร์ม แต่ต้องมี log" (2026-11-03 · คำสั่ง user)
-- project: DR / "Product DB" (eyhclzkifitbhbljgoav)
--
-- เรื่อง: 30/10 เปิดให้สแกนปิดใบของไลน์อื่นได้ แต่บังคับกดยืนยัน 1 ครั้งเสมอ
--   user: *"ถ้าเป็นยอดงานของ user นั้นรับผิดชอบ อยากให้ไม่ต้องคอนเฟิร์มเลย
--          แต่มีการเก็บ log ไว้ตรวจสอบได้"*
--   ⇒ ถอดการยืนยันออกเมื่อใบนั้นอยู่ในขอบเขตที่คนสแกนรับผิดชอบ (ด่าน `canWriteLine`)
--     แล้วย้ายความปลอดภัยไปอยู่ที่ **ร่องรอยย้อนหลัง** แทน
--
-- ① คอลัมน์ `closed_from_line` = "จอของไลน์ไหนเป็นคนกดปิด"
--    null = ปิดจากจอของไลน์เจ้าของใบเอง (พฤติกรรมเดิม 100% · แถวเก่าทั้งหมดเป็น null)
--
-- ② trigger เขียน `audit_log` **เฉพาะตอนปิดข้ามไลน์จริง** (append-only · กู้ย้อนได้)
--    🔴 ทำไมไม่ผูก `fn_audit()` ทั้งตาราง: `prod_orders` เป็นตารางเขียนถี่ที่สุดของระบบ
--       (หลักพันแถว/วัน) — audit ทั้งตารางจะกิน free tier เร็วกว่าของจริงทั้งหมดรวมกัน
--       (เหตุผลเดียวกับที่ `20261006_delete_audit_dr.sql` ผูกเฉพาะ DELETE)
--    🔴 client เขียน `audit_log` เองไม่ได้ (ไม่มี INSERT policy — ตั้งใจ) ⇒ ต้องเป็น trigger
--       `security definer` เท่านั้น · ห่อ `exception when others then null` ตามกฎ fn_audit:
--       **audit ล้มเหลวห้ามทำให้การปิดใบพัง**
--
-- ✅ apply แล้ว 2026-11-04 ผ่าน MCP (คอลัมน์ 1 · function 1 · trigger `trg_prod_order_cross_close_audit`)
--    🔴 ไม่ชนกับ `trg_audit_update_closed` ที่มีอยู่เดิม — ตัวนั้นยิงเมื่อ `old.status <> 'open'`
--       แต่ปิดใบคือ `open → confirmed` ⇒ ตัวนั้นไม่เคยยิงตอนปิดใบ (ตรวจแล้ว 04/11)
--
-- ย้อนกลับ: drop trigger + function · คอลัมน์ทิ้งไว้ได้ (nullable ไม่มีใครบังคับใช้)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.prod_orders add column if not exists closed_from_line text;

comment on column public.prod_orders.closed_from_line is
  'ไลน์ของ "จอที่กดปิดใบ" เมื่อปิดข้ามไลน์ · null = ปิดจากจอของไลน์เจ้าของใบเอง (2026-11-03)';

create or replace function public.fn_prod_order_cross_close_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line  text;
  v_wd    date;
  v_shift text;
begin
  begin
    select s.line_name, s.work_date, s.shift
      into v_line, v_wd, v_shift
      from public.production_sessions s
     where s.id = new.session_id;

    insert into public.audit_log
      (table_name, row_pk, action, actor, changed_fields, old_data, new_data)
    values (
      'prod_orders', new.id::text, 'CROSS_LINE_CLOSE',
      nullif(new.confirmed_by, ''),
      array['status', 'qty_ok', 'closed_from_line'],
      jsonb_build_object('status', old.status, 'qty_ok', old.qty_ok),
      jsonb_build_object(
        'prod_no',          new.prod_no,
        'mat_no',           new.mat_no,
        'part_name',        new.part_name,
        'qty_ok',           new.qty_ok,
        'owner_line',       v_line,
        'work_date',        v_wd,
        'shift',            v_shift,
        'closed_from_line', new.closed_from_line,
        'confirmed_by',     new.confirmed_by,
        'confirmed_at',     new.confirmed_at
      )
    );
  exception when others then null;   -- 🔴 audit ล้ม = ปล่อยผ่าน ห้ามทำให้ปิดใบพัง
  end;
  return null;
end $$;

drop trigger if exists trg_prod_order_cross_close_audit on public.prod_orders;

create trigger trg_prod_order_cross_close_audit
after update on public.prod_orders
for each row
when (
  new.closed_from_line is not null
  and new.status = 'confirmed'
  and old.status is distinct from 'confirmed'
)
execute function public.fn_prod_order_cross_close_audit();

-- ── ตรวจผล ────────────────────────────────────────────────────────────────
-- select count(*) from information_schema.columns
--  where table_name='prod_orders' and column_name='closed_from_line';          -- ต้องได้ 1
-- select tgname from pg_trigger where tgrelid='public.prod_orders'::regclass
--   and tgname='trg_prod_order_cross_close_audit';                             -- ต้องได้ 1 แถว
-- select * from audit_log where action='CROSS_LINE_CLOSE' order by changed_at desc limit 20;
