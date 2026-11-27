-- ═══════════════════════════════════════════════════════════════════════════════
-- 20261120d — รายงานเทียบยอดคงคลัง SAP (MB52) กับ ESM รายสัปดาห์ (DR · "Product DB" · eyhclzkifitbhbljgoav)
-- คำสั่ง user 20/11: "ทำรายงานเทียบกับ SAP รายสัปดาห์" · ใช้ MB52 · เทียบทุกรหัสคลังที่อยู่ในไฟล์ · ตัดยอด ESM ตอนอัปโหลด
--
-- ไฟล์ MB52 = TSV UTF-16LE (นามสกุล .xls) · แกะที่จอ (`utils/mb52Import.js`) แล้วส่งยอดรวมราย SLoc×MAT มาที่ RPC
-- `sap_stock_upload_create` ⇒ ธุรกรรมเดียว: บันทึกรอบ + แถว SAP + **ตรึงยอด ESM ณ ตอนนั้น** ลง sap_stock_compare
--   ESM ต่อรหัสคลัง:
--   · ไลน์ผลิต = ยอดไลน์ที่ผูกกับรหัส (`storage_locations.line_names`)
--   · กอง STORE / FG WAREHOUSE = แยกตาม "ที่จัดเก็บหลัก" ของพาร์ท (`parts_master.home_sloc`)
--     ไม่ได้ตั้ง = รหัสเทียม 'STORE?' / 'FG?' (ห้ามเดารหัสให้ · จอเขียนบอก)
--   ขอบเขต = รหัสที่อยู่ในไฟล์ (+ 'STORE?' ถ้าไฟล์มีรหัสฝั่งสโตร์/วัตถุดิบ · 'FG?' ถ้ามีรหัส warehouse)
--   เทียบกับ Unrestr. (คอลัมน์ QI / Blocked เก็บไว้โชว์ข้าง ไม่รวม)
-- ย้อนกลับ: ส่วน ROLLBACK ท้ายไฟล์ (ตารางใหม่ล้วน ไม่แตะของเดิม)
-- ═══════════════════════════════════════════════════════════════════════════════

create table if not exists public.sap_stock_uploads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  cutoff_at timestamptz not null default now(),          -- = เวลาที่ตรึงยอด ESM
  report_date date,                                       -- วันที่บนหัวไฟล์ MB52
  file_name text,
  slocs text[] not null default '{}',
  sap_rows int not null default 0,                        -- แถวดิบในไฟล์ (ก่อนรวม batch)
  qty_basis text not null default 'unrestricted',
  uploaded_by text, uploaded_by_uid uuid,
  note text
);
create table if not exists public.sap_stock_compare (
  id bigserial primary key,
  upload_id uuid not null references public.sap_stock_uploads(id) on delete cascade,
  sloc text not null, mat_no text not null, part_name text, bun text,
  sap_qty numeric, sap_qi numeric, sap_blocked numeric, sap_src_rows int,
  esm_qty numeric,
  esm_basis text,                                         -- line | pile | pile_unknown
  hint_gap numeric, hint_rcpt numeric, hint_po numeric    -- คำใบ้สาเหตุ ณ ตอนตรึงยอด
);
create index if not exists sap_stock_compare_upload_idx on public.sap_stock_compare (upload_id, sloc);

alter table public.sap_stock_uploads enable row level security;
alter table public.sap_stock_compare enable row level security;
-- 🔴 DR = anon เสมอ (CLAUDE.md §supabaseDR) — policy แบบเดียวกับตารางฝั่ง DR อื่น (known gap)
drop policy if exists sap_stock_uploads_all on public.sap_stock_uploads;
create policy sap_stock_uploads_all on public.sap_stock_uploads for all to public using (true) with check (true);
drop policy if exists sap_stock_compare_all on public.sap_stock_compare;
create policy sap_stock_compare_all on public.sap_stock_compare for all to public using (true) with check (true);
grant select, insert, delete on public.sap_stock_uploads to anon, authenticated;
grant select, insert, delete on public.sap_stock_compare to anon, authenticated;
grant usage, select on sequence public.sap_stock_compare_id_seq to anon, authenticated;
drop trigger if exists trg_audit on public.sap_stock_uploads;
create trigger trg_audit after insert or update or delete on public.sap_stock_uploads for each row execute function public.fn_audit();

create or replace function public.sap_stock_upload_create(p_meta jsonb, p_rows jsonb)
returns jsonb language plpgsql as $f$
declare v_id uuid; v_slocs text[]; v_store boolean; v_fg boolean; v_n int;
begin
  if coalesce(btrim(p_meta->>'uploaded_by'), '') = '' then raise exception 'ไม่รู้ว่าใครอัปโหลด'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'ไฟล์ไม่มีแถวยอด'; end if;

  select array_agg(distinct upper(btrim(r->>'sloc'))) into v_slocs from jsonb_array_elements(p_rows) r
   where coalesce(btrim(r->>'sloc'), '') <> '';
  if v_slocs is null then raise exception 'ไม่มีรหัสคลัง (SLoc) ในไฟล์'; end if;
  select bool_or(kind in ('store_part', 'raw')), bool_or(kind = 'warehouse') into v_store, v_fg
    from public.storage_locations where code = any(v_slocs);

  insert into public.sap_stock_uploads (report_date, file_name, slocs, sap_rows, uploaded_by, uploaded_by_uid, note)
  values (nullif(p_meta->>'report_date', '')::date, p_meta->>'file_name', v_slocs,
          coalesce((p_meta->>'sap_rows')::int, 0), btrim(p_meta->>'uploaded_by'),
          nullif(p_meta->>'uploaded_by_uid', '')::uuid, nullif(btrim(p_meta->>'note'), ''))
  returning id into v_id;

  with sap as (
    select upper(btrim(r->>'sloc')) sloc, btrim(r->>'mat_no') mat_no,
           max(r->>'mat_desc') mat_desc, max(r->>'bun') bun,
           sum(coalesce((r->>'unrestricted')::numeric, 0)) unr, sum(coalesce((r->>'qual_insp')::numeric, 0)) qi,
           sum(coalesce((r->>'blocked')::numeric, 0)) blk, sum(coalesce((r->>'src_rows')::int, 1)) src
      from jsonb_array_elements(p_rows) r
     where coalesce(btrim(r->>'mat_no'), '') <> '' and coalesce(btrim(r->>'sloc'), '') <> ''
     group by 1, 2
  ), lmap as (
    select sl.code sloc, unnest(sl.line_names) line_name from public.storage_locations sl
     where sl.is_active and sl.code = any(v_slocs)
  ), esm_line as (
    select m.sloc, s.mat_no, max(s.part_name) part_name, sum(s.qty_on_hand) q, 'line'::text basis
      from public.line_stock_summary s join lmap m on m.line_name = s.line_name
     group by 1, 2
  ), esm_pile as (
    select coalesce(nullif(upper(btrim(p.home_sloc)), ''), case when s.line_name = 'STORE' then 'STORE?' else 'FG?' end) sloc,
           s.mat_no, max(s.part_name) part_name, sum(s.qty_on_hand) q,
           case when coalesce(btrim(p.home_sloc), '') = '' then 'pile_unknown' else 'pile' end basis
      from public.line_stock_summary s
      left join lateral (select pm.home_sloc from public.parts_master pm where pm.mat_no = s.mat_no limit 1) p on true
     where s.line_name in ('STORE', 'FG WAREHOUSE') and s.qty_on_hand <> 0
     group by 1, 2, 5
  ), esm as (
    select sloc, mat_no, max(part_name) part_name, sum(q) q, min(basis) basis from (
      select * from esm_line
      union all
      select * from esm_pile
       where sloc = any(v_slocs) or (sloc = 'STORE?' and coalesce(v_store, false)) or (sloc = 'FG?' and coalesce(v_fg, false))
    ) x group by 1, 2
  ), cmp as (
    select coalesce(sap.sloc, esm.sloc) sloc, coalesce(sap.mat_no, esm.mat_no) mat_no,
           coalesce(nullif(sap.mat_desc, ''), esm.part_name) part_name, sap.bun,
           sap.unr, sap.qi, sap.blk, sap.src, esm.q, esm.basis
      from sap full join esm on esm.sloc = sap.sloc and esm.mat_no = sap.mat_no
     where coalesce(sap.unr, 0) <> 0 or coalesce(sap.qi, 0) <> 0 or coalesce(sap.blk, 0) <> 0 or coalesce(esm.q, 0) <> 0
  )
  insert into public.sap_stock_compare (upload_id, sloc, mat_no, part_name, bun, sap_qty, sap_qi, sap_blocked, sap_src_rows,
                                        esm_qty, esm_basis, hint_gap, hint_rcpt, hint_po)
  select v_id, c.sloc, c.mat_no, c.part_name, c.bun, c.unr, c.qi, c.blk, c.src, c.q, c.basis,
         (select sum(g.gap) from public.v_line_issue_gaps g
            join lmap m on m.line_name = g.line_name and m.sloc = c.sloc where g.mat_no = c.mat_no),
         (select sum(r.qty_expected) from public.stock_receipts r
           where r.status = 'pending' and r.mat_no = c.mat_no
             and (r.dest_line_name in (select line_name from lmap where sloc = c.sloc)
                  or (c.basis in ('pile', 'pile_unknown') and r.dest_line_name in ('STORE', 'FG WAREHOUSE')))),
         (select sum(pr.qty) from public.purchase_requests pr
           where pr.mat_no = c.mat_no and pr.status in ('ordered', 'pending')
             and (c.basis in ('pile', 'pile_unknown') or c.sloc like 'S%' or c.sloc like 'R%'))
    from cmp c;
  get diagnostics v_n = row_count;
  return jsonb_build_object('id', v_id, 'compare_rows', v_n, 'slocs', to_jsonb(v_slocs));
end $f$;
grant execute on function public.sap_stock_upload_create(jsonb, jsonb) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- drop function if exists public.sap_stock_upload_create(jsonb, jsonb);
-- drop table if exists public.sap_stock_compare;
-- drop table if exists public.sap_stock_uploads;
-- ═══════════════════════════════════════════════════════════════════════════════
