-- ═══════════════════════════════════════════════════════════════════════════════
-- 20261120b — คิว "ของที่ไลน์ใช้แต่สโตร์ยังไม่ลงจ่าย" (DR · "Product DB" · eyhclzkifitbhbljgoav)
-- คำสั่ง user 20/11: ทาง 1 · เตือนเมื่อค้างเกิน 1 กะ · รายการที่ค้างอยู่ (กลุ่ม A ~63 แถว) เข้าคิวเลย
--
-- ปัญหา: สโตร์ยื่นของให้ไลน์จริงแต่ไม่ลง "จ่ายพาร์ทเข้าไลน์" ⇒ ระบบเห็นของกองที่ STORE
--         ขณะที่ไลน์ถูกตัดตอนปิดใบผลิต (ตัดเต็ม ยอมติดลบ · 20261119c) จนติดลบ
-- ทางแก้: ไลน์ติดลบ + STORE ในระบบมีของ = รายการในคิว (คำนวณสด ไม่มีตารางสถานะ — ยืนยันแล้วยอดไลน์กลับ ≥ 0 รายการหายเอง)
--   · ยืนยันจ่าย (คลิกเดียว)  → line_issue_gap_confirm : STORE − / ไลน์ + (ย้ายได้ไม่เกินยอด STORE)
--   · ไม่ได้จ่าย (ต้องใส่เหตุผล) → line_issue_gap_reject : ไลน์ + / คลังพัก − + เปิดเคส stock_discrepancies
--       (source 'line_issue_gap' · เคลียร์แบบยืนยันคู่ที่แท็บ "คลังพัก/ผลต่าง" — ledger ฝั่งเคลียร์อยู่ utils/stockDiscrepancy.js)
--   · ค้างเกิน 1 กะ = เริ่มค้างก่อนรอยต่อกะปัจจุบัน (08:00 / 20:00 ไทย) → เคส F ใน v_store_abnormal
--     → แจ้งเตือนช่องทางเดิม (store-daily-scan → send-store-notification · ผู้รับตั้งที่ /notification-config)
--
-- ย้อนกลับ: ส่วน ROLLBACK ท้ายไฟล์
-- ═══════════════════════════════════════════════════════════════════════════════

-- เคสผลต่างชนิดใหม่ 'line_issue_gap' (สโตร์ยืนยันว่าไม่ได้จ่าย) — ขยายรายการที่อนุญาต (ของเดิมครบ)
alter table public.stock_discrepancies drop constraint if exists stock_discrepancies_source_check;
alter table public.stock_discrepancies add constraint stock_discrepancies_source_check
  check (source = any (array['wip_request', 'kanban_round', 'backfill', 'line_issue_gap']));

create or replace view public.v_line_issue_gaps as
with sh as (
  select (case
            when extract(hour from l) >= 8 and extract(hour from l) < 20 then date_trunc('day', l) + interval '8 hour'
            when extract(hour from l) >= 20 then date_trunc('day', l) + interval '20 hour'
            else date_trunc('day', l) - interval '4 hour'
          end) at time zone 'Asia/Bangkok' as shift_start
    from (select now() at time zone 'Asia/Bangkok' as l) x
), neg as (
  select s.line_name, s.mat_no, s.part_name, -s.qty_on_hand as gap
    from public.line_stock_summary s
   where s.qty_on_hand < 0
     and s.line_name not in ('STORE', 'FG WAREHOUSE', 'ผลต่างรอเคลียร์')
     and s.line_name not like 'ร้านชุบ%'
), st as (
  select mat_no, qty_on_hand from public.line_stock_summary where line_name = 'STORE' and qty_on_hand > 0
)
select n.line_name, n.mat_no, coalesce(n.part_name, dp.name) as part_name,
       n.gap, st.qty_on_hand as store_qty, least(n.gap, st.qty_on_hand) as movable,
       g.since,
       (g.since is null or g.since < sh.shift_start) as overdue,
       sh.shift_start
  from neg n
  join st on st.mat_no = n.mat_no
  cross join sh
  left join lateral (
    -- เริ่มค้าง = รายการตัดแรกหลังรายการ "เข้า" ล่าสุดของไลน์+พาร์ทนี้ (null = บอกไม่ได้ → ถือว่าค้างนาน)
    select min(t.created_at) as since from public.line_stock_transactions t
     where t.line_name = n.line_name and t.mat_no = n.mat_no and t.status = 'approved' and t.type = 'consume'
       and t.created_at > coalesce((select max(t2.created_at) from public.line_stock_transactions t2
                                     where t2.line_name = n.line_name and t2.mat_no = n.mat_no and t2.status = 'approved'
                                       and t2.type in ('issue', 'adjust', 'return')), '-infinity'::timestamptz)
  ) g on true
  left join lateral (select d.name from public.dr_products d where d.mat_no = n.mat_no order by d.is_active desc limit 1) dp on true;

grant select on public.v_line_issue_gaps to anon, authenticated;

-- ✅ ยืนยันจ่าย — สด ณ ตอนกด · ย้ายได้ไม่เกินยอด STORE · คืนจำนวนที่ย้าย
create or replace function public.line_issue_gap_confirm(p_line text, p_mat text, p_by text, p_by_uid uuid default null)
returns numeric language plpgsql as $f$
declare g record; v_q numeric; v_note text;
begin
  if coalesce(btrim(p_by), '') = '' then raise exception 'ไม่รู้ว่าใครเป็นคนยืนยัน'; end if;
  perform pg_advisory_xact_lock(hashtext('line_issue_gap|' || p_line || '|' || p_mat));
  select * into g from public.v_line_issue_gaps where line_name = p_line and mat_no = p_mat;
  if not found or coalesce(g.movable, 0) <= 0 then
    raise exception 'รายการนี้ไม่ค้างแล้ว (มีคนยืนยันไปแล้ว หรือ STORE ในระบบไม่มีของ) — รีเฟรช';
  end if;
  v_q := g.movable;
  v_note := 'ยืนยันจ่ายย้อนหลัง: ' || p_line || ' ใช้ไปแล้วแต่ยังไม่ลงจ่าย (คิวสโตร์)'
         || case when v_q < g.gap then ' · ย้ายได้ ' || round(v_q) || ' จากที่ขาด ' || round(g.gap) || ' (STORE ไม่พอ)' else '' end;
  insert into public.line_stock_transactions (line_name, mat_no, part_name, qty, type, work_date, status, note, created_by, created_by_uid)
  values ('STORE', p_mat, g.part_name, v_q, 'consume', public.work_date_bangkok(), 'approved', v_note, p_by, p_by_uid),
         (p_line,  p_mat, g.part_name, v_q, 'issue',   public.work_date_bangkok(), 'approved', v_note, p_by, p_by_uid);
  return v_q;
end $f$;

-- 🚫 ไม่ได้จ่าย — ยอดติดลบของไลน์ย้ายไปคลังพัก (ติดลบที่คลังพัก = "ใช้ไปแล้วแต่ไม่รู้ที่มา") + เปิดเคสให้ 2 ฝ่ายเคลียร์
create or replace function public.line_issue_gap_reject(p_line text, p_mat text, p_reason text, p_by text, p_by_uid uuid default null)
returns uuid language plpgsql as $f$
declare v_gap numeric; v_part text; v_id uuid; v_note text;
begin
  if coalesce(btrim(p_by), '') = '' then raise exception 'ไม่รู้ว่าใครเป็นคนกด'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'ต้องใส่เหตุผลว่าทำไมไม่ได้จ่าย'; end if;
  perform pg_advisory_xact_lock(hashtext('line_issue_gap|' || p_line || '|' || p_mat));
  select -s.qty_on_hand, s.part_name into v_gap, v_part from public.line_stock_summary s
   where s.line_name = p_line and s.mat_no = p_mat;
  if coalesce(v_gap, 0) <= 0 then raise exception 'รายการนี้ไม่ติดลบแล้ว — รีเฟรช'; end if;
  v_note := 'ผลต่าง: สโตร์ยืนยันว่าไม่ได้จ่าย ' || p_mat || ' ให้ ' || p_line || ' — ' || btrim(p_reason);
  insert into public.line_stock_transactions (line_name, mat_no, part_name, qty, type, work_date, status, note, created_by, created_by_uid)
  values (p_line, p_mat, v_part, v_gap, 'issue', public.work_date_bangkok(), 'approved', v_note || ' (ล้างยอดติดลบของไลน์)', p_by, p_by_uid),
         ('ผลต่างรอเคลียร์', p_mat, v_part, v_gap, 'consume', public.work_date_bangkok(), 'approved', v_note || ' (พักยอดที่ใช้ไปโดยไม่มีที่มา)', p_by, p_by_uid);
  insert into public.stock_discrepancies (source, line_name, mat_no, part_name, sent_qty, received_qty, short_qty, work_date, reported_by, note, status)
  values ('line_issue_gap', p_line, p_mat, v_part, 0, v_gap, v_gap, public.work_date_bangkok(), p_by, btrim(p_reason), 'open')
  returning id into v_id;
  return v_id;
end $f$;

grant execute on function public.line_issue_gap_confirm(text, text, text, uuid) to anon, authenticated;
grant execute on function public.line_issue_gap_reject(text, text, text, text, uuid) to anon, authenticated;

-- 🔔 เคส F ใน v_store_abnormal (วิวกลางของการแจ้งเตือนสโตร์ + หน้า /store-monitor)
--    ต่อท้ายนิยามเดิมแบบอ่านสด (ไม่ก๊อปนิยามเดิมมาเขียนซ้ำ = ไม่ drift กับคนที่แก้เคส A–E) · รันซ้ำได้ (เช็คว่ามี F แล้วหรือยัง)
do $do$
declare d text;
begin
  d := pg_get_viewdef('public.v_store_abnormal'::regclass, true);
  if position('v_line_issue_gaps' in d) = 0 then
    execute 'create or replace view public.v_store_abnormal as ' || rtrim(btrim(d), ';') || $f$
UNION ALL
 SELECT 'shortage'::text AS kind, 'F'::text AS code,
    'ไลน์ใช้ของแต่สโตร์ยังไม่ลงจ่าย (เกิน 1 กะ)'::text AS title,
    g.line_name, g.mat_no, g.part_name,
    'ไลน์ติดลบ ' || round(g.gap) || ' · STORE ในระบบมี ' || round(g.store_qty)
      || ' · ค้างตั้งแต่ ' || coalesce(to_char(g.since at time zone 'Asia/Bangkok', 'DD/MM HH24:MI'), 'ไม่ทราบ')
      || ' — กดยืนยันจ่ายที่ สต็อกในไลน์ › ส่งของเข้าไลน์' AS detail,
    3 AS sev, NULL::numeric AS qty_on_hand, NULL::numeric AS min_qty, NULL::numeric AS max_qty
   FROM public.v_line_issue_gaps g
  WHERE g.overdue$f$;
  end if;
end $do$;

-- ⏰ รอบเตือนกะดึก 19:50 ไทย (12:50 UTC) ส่งเฉพาะเคส F — รอบเช้า 07:50 (store-daily-scan เดิม) ส่งทุกเคสรวม F อยู่แล้ว
select cron.unschedule('store-gap-shift-scan') where exists (select 1 from cron.job where jobname = 'store-gap-shift-scan');
select cron.schedule('store-gap-shift-scan', '50 12 * * *', $c$
  select net.http_post(
    url     := 'https://eyhclzkifitbhbljgoav.supabase.co/functions/v1/store-daily-scan',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := '{"only":["F"]}'::jsonb
  );
$c$);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- select cron.unschedule('store-gap-shift-scan');
-- v_store_abnormal: create or replace view ด้วยนิยามเดิม (ตัดบล็อก UNION ALL ... FROM public.v_line_issue_gaps ... ท้ายสุดออก)
--   ⚠️ ต้องทำก่อน drop view v_line_issue_gaps (ไม่งั้น drop ไม่ได้ — มีวิวพึ่งอยู่)
-- drop function if exists public.line_issue_gap_confirm(text, text, text, uuid);
-- drop function if exists public.line_issue_gap_reject(text, text, text, text, uuid);
-- drop view if exists public.v_line_issue_gaps;
-- (constraint source: คืนเป็น 3 ค่าเดิมได้เฉพาะเมื่อไม่มีเคส 'line_issue_gap' แล้ว)
-- (รายการ ledger/เคสที่เกิดจากคิวไปแล้ว คงไว้ — เป็นประวัติจริง)
-- ═══════════════════════════════════════════════════════════════════════════════
