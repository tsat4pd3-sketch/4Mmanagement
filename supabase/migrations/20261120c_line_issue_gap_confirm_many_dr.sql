-- 20261120c — ยืนยันจ่ายหลายรายการในธุรกรรมเดียว (DR · "Product DB") · คู่กับ 20261120b
-- ห้ามให้จอวนยิง RPC ทีละรายการ (บทเรียนคิวรอรับเข้า) · รายการที่ไม่ค้างแล้ว = ข้าม (ไม่ล้มทั้งก้อน) แล้วนับคืนให้จอบอก
create or replace function public.line_issue_gap_confirm_many(p_lines text[], p_mats text[], p_by text, p_by_uid uuid default null)
returns jsonb language plpgsql as $f$
declare i int; v_q numeric; v_ok int := 0; v_skip int := 0; v_sum numeric := 0;
begin
  if coalesce(array_length(p_lines, 1), 0) <> coalesce(array_length(p_mats, 1), 0) then
    raise exception 'รายการไลน์กับพาร์ทไม่ครบคู่';
  end if;
  for i in 1 .. coalesce(array_length(p_lines, 1), 0) loop
    begin
      v_q := public.line_issue_gap_confirm(p_lines[i], p_mats[i], p_by, p_by_uid);
      v_ok := v_ok + 1; v_sum := v_sum + v_q;
    exception when others then
      v_skip := v_skip + 1;
    end;
  end loop;
  return jsonb_build_object('confirmed', v_ok, 'skipped', v_skip, 'qty', v_sum);
end $f$;
grant execute on function public.line_issue_gap_confirm_many(text[], text[], text, uuid) to anon, authenticated;
-- ROLLBACK: drop function if exists public.line_issue_gap_confirm_many(text[], text[], text, uuid);
