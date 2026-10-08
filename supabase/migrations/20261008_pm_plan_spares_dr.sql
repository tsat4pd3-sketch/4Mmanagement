-- 20261008_pm_plan_spares_dr.sql · ⚠️ DR project — ชื่อในจอ Supabase "Product DB" (eyhclzkifitbhbljgoav)
--
-- 🔩 ผูกอะไหล่ (Spare) เข้ากับแผน PM (คำสั่ง user 2026-10-08 "ทำเรื่องผูก Spare เข้ากับแผน PM ต่อเลย")
--   ที่มา: ทีมช่างจะกรอก "Target Plan PM ที่จะถึง" ทั้งฝั่ง PM และ Spare
--   ⇒ ต่อ 1 แผน PM (checklist) บอกได้ว่า "PM รอบหนึ่งใช้อะไหล่อะไร กี่ชิ้น"
--   ⇒ ระบบรวมความต้องการของ PM ที่จะถึง เทียบสต็อก + leadtime → รู้ก่อนว่าต้องสั่งอะไร เมื่อไหร่
--   ⇒ ทำ PM เสร็จ เบิกอะไหล่ตามแผนได้ปุ่มเดียว ผ่านเส้นทางสต็อกเดิม (mtn_stock_move) ไม่มีทางลัด
--
-- 1) pm_plan_spares  = รายการอะไหล่ต่อ PM 1 รอบ (คีย์ = checklist_id เหมือน pm_plans ที่ unique ต่อ checklist)
-- 2) mtn_stock_txns.ref_checklist_id = รายการเบิกนี้ "เบิกให้ PM ใบไหน" (nullable · แถวเดิม null ทั้งหมด)
-- 3) RPC pm_issue_spares(checklist, items, by_name, note) = เบิกทุกรายการ **ทั้งหมดหรือไม่เลย**
--    (อะไหล่ตัวใดไม่พอ = raise ⇒ rollback ทั้งชุด · ไม่มีกรณีตัดสต็อกไปครึ่งเดียว)
--    เรียก mtn_stock_move ตัวเดิมทีละรายการ ⇒ ได้ FOR UPDATE + กันติดลบ + ledger + trigger ยอดใช้รายเดือน ครบ
--
-- additive ทั้งหมด · ตารางว่าง = ไม่มีจอไหนเปลี่ยนพฤติกรรม
-- ย้อนกลับ (ลำดับ: revert โค้ดก่อน แล้วค่อยรัน):
--   drop function if exists public.pm_issue_spares(uuid, jsonb, text, text);
--   alter table public.mtn_stock_txns drop column if exists ref_checklist_id;
--   drop table if exists public.pm_plan_spares;

set lock_timeout = '3s';

create table if not exists public.pm_plan_spares (
  id             uuid primary key default gen_random_uuid(),
  checklist_id   uuid not null references public.checklists(id) on delete cascade,
  part_id        uuid not null references public.mtn_spare_parts(id) on delete cascade,
  qty_per_pm     numeric not null check (qty_per_pm > 0),
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by_name text,
  updated_by_uid  uuid,
  unique (checklist_id, part_id)
);
create index if not exists pm_plan_spares_part_idx on public.pm_plan_spares (part_id);

-- DR = client วิ่งด้วย anon เสมอ (กฎเหล็ก supabaseDR) ⇒ policy แบบเดียวกับตาราง PM/อะไหล่เดิม
-- ห้ามเปลี่ยนเป็น TO authenticated · สิทธิ์ปุ่มคุมที่จอด้วย can('pm','setup') / can('mtn_repair','service')
alter table public.pm_plan_spares enable row level security;
do $$ begin
  create policy pm_plan_spares_all on public.pm_plan_spares for all using (true) with check (true);
exception when duplicate_object then null; end $$;

-- updated_at + audit (ใครแก้อะไหล่ของแผนไหน เมื่อไหร่ · ตารางทะเบียนใหม่ต้องผูก audit)
do $$ begin
  create trigger trg_set_updated_at before update on public.pm_plan_spares
    for each row execute function public.fn_set_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger trg_audit after insert or update or delete on public.pm_plan_spares
    for each row execute function public.fn_audit();
exception when duplicate_object then null; end $$;

alter table public.mtn_stock_txns add column if not exists ref_checklist_id uuid;
create index if not exists mtn_stock_txns_ref_checklist_idx
  on public.mtn_stock_txns (ref_checklist_id) where ref_checklist_id is not null;

create or replace function public.pm_issue_spares(
  p_checklist_id uuid, p_items jsonb, p_by_name text default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  it      jsonb;
  v_part  uuid;
  v_qty   numeric;
  v_bal   numeric;
  v_out   jsonb := '[]'::jsonb;
  v_seen  uuid[] := '{}';
begin
  if p_checklist_id is null then raise exception 'ไม่ระบุแผน PM'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ไม่มีรายการอะไหล่ให้เบิก';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_part := (it->>'part_id')::uuid;
    v_qty  := (it->>'qty')::numeric;
    if v_part is null then raise exception 'รายการอะไหล่ไม่ระบุ part_id'; end if;
    -- กันส่งอะไหล่ตัวเดียวซ้ำ 2 แถว (จะติดตามว่าแถว ledger ไหนของ PM นี้ไม่ได้)
    if v_part = any(v_seen) then raise exception 'อะไหล่ซ้ำในรายการเบิก'; end if;
    v_seen := v_seen || v_part;
    -- ตัวเดิมทั้งหมด: ล็อกแถว · กันติดลบ (raise "สต๊อกไม่พอ") · เขียน ledger · trigger ยอดใช้รายเดือน
    v_bal := public.mtn_stock_move(v_part, 'issue', v_qty, coalesce(p_note, 'เบิกตามแผน PM'), p_by_name, null);
    -- ผูกแถว ledger ที่เพิ่งเขียนกับ PM ใบนี้ · now() = เวลาเริ่มทรานแซกชันนี้ ⇒ ไม่ชนแถวของคนอื่น
    update public.mtn_stock_txns set ref_checklist_id = p_checklist_id
     where part_id = v_part and type = 'issue' and created_at = now() and ref_checklist_id is null;
    v_out := v_out || jsonb_build_object('part_id', v_part, 'qty', v_qty, 'balance', v_bal);
  end loop;
  return v_out;
end $$;

grant execute on function public.pm_issue_spares(uuid, jsonb, text, text) to anon, authenticated;

reset lock_timeout;

-- ตรวจผล:
--   select count(*) from public.pm_plan_spares;                                     -- 0 (ตารางใหม่)
--   select column_name from information_schema.columns
--    where table_name = 'mtn_stock_txns' and column_name = 'ref_checklist_id';       -- 1 แถว
--   select has_function_privilege('anon', 'public.pm_issue_spares(uuid,jsonb,text,text)', 'execute'); -- true
