-- 🔴 สโตร์กด "ส่งถึงแล้ว" ในคิวเติม WIP → ยอดที่จุดไม่เคยขยับ แต่จอขึ้น "✅ เติมเรียบร้อย"
--
-- ต้นเหตุ (วัดกับฐานจริง 2026-09-03):
--   RLS ของ wip_buffer_points เขียนได้เฉพาะ admin/manager/supervisor (hardcode role array)
--   แต่คนที่กดปุ่มเติม WIP จริงคือผู้ถือ heijunka:operate = 9 role / 44 บัญชี
--   (leader 19 · qa 20 · planner_store 1 · document_control 2 · display 2 — ไม่ผ่าน RLS สักคน)
--   ⇒ planner_store ซึ่งเป็น "สโตร์ตัวจริง" เจ้าของงานนี้ ก็เขียนไม่ได้
--   และ RLS ปฏิเสธ UPDATE = "สำเร็จ 0 แถว ไม่มี error" → client เช็คแค่ error จึงขึ้น toast เขียว
--
-- ทำไมไม่เปิด policy ให้ 44 บัญชีตรงๆ:
--   ตารางนี้เป็น master ของจุด WIP (ตำแหน่งบนผัง · min/max · ชนิดภาชนะ) ซึ่งเป็นของ admin/mgr/sv จริง
--   สิ่งที่สโตร์ต้องทำคือ "บวกยอดที่เติม" คอลัมน์เดียว = คนละแกน
--   → SECURITY DEFINER ที่แตะเฉพาะคอลัมน์ที่อนุญาตของแถวนั้น (precedent เดียวกับ set_my_signature)
--   → guard ด้วย has_perm() ตามกฎ "RLS/สิทธิ์ต้อง data-driven ห้าม hardcode role array"
create or replace function public.wip_point_add_qty(p_point_id uuid, p_add numeric)
returns table (new_qty numeric, capped boolean, cap_max numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur numeric;
  v_max numeric;
  v_raw numeric;
begin
  if not public.has_perm('heijunka:operate') then
    raise exception 'ไม่มีสิทธิ์เติมยอดจุด WIP (ต้องมีคีย์ heijunka:operate)' using errcode = '42501';
  end if;
  if p_add is null or p_add <= 0 then
    raise exception 'จำนวนที่เติมต้องมากกว่า 0' using errcode = '22023';
  end if;

  -- ล็อกแถวก่อนอ่าน: 2 เครื่องสโตร์กดพร้อมกันต้องบวกทบกัน ไม่ใช่เขียนทับกัน
  -- (เดิมเป็น read-modify-write ฝั่ง client = ยอดหายไปหนึ่งใบเงียบๆ)
  select coalesce(w.current_qty, 0), w.max_qty
    into v_cur, v_max
    from public.wip_buffer_points w
   where w.id = p_point_id
     for update;
  if not found then
    raise exception 'ไม่พบจุด WIP นี้ (อาจถูกลบไปแล้ว)' using errcode = 'P0002';
  end if;

  v_raw := v_cur + p_add;

  -- max_qty ที่ยังไม่ตั้ง (null) หรือ 0 = "ไม่รู้เพดาน" → ไม่ clamp
  -- (clamp ด้วย 0 จะกลายเป็นล้างยอดทิ้ง ซึ่งเสียหายกว่าการยอมให้เกินเพดานที่ยังไม่มีใครตั้ง)
  update public.wip_buffer_points w
     set current_qty = case when v_max is null or v_max <= 0 then v_raw else least(v_raw, v_max) end,
         updated_at  = now(),
         updated_by  = auth.uid()
   where w.id = p_point_id
   returning w.current_qty into new_qty;

  cap_max := v_max;
  -- บอกกลับไปให้จอเตือนได้ว่า "ส่งไป N แต่จุดรับได้แค่เพดาน" — ห้าม clamp เงียบ
  capped  := (new_qty < v_raw);
  return next;
end;
$$;

revoke all on function public.wip_point_add_qty(uuid, numeric) from public, anon;
grant execute on function public.wip_point_add_qty(uuid, numeric) to authenticated;

comment on function public.wip_point_add_qty(uuid, numeric) is
  'บวกยอดคงเหลือของจุด WIP (คอลัมน์ current_qty เท่านั้น) สำหรับผู้ถือ heijunka:operate — '
  'ล็อกแถวกันกดพร้อมกัน และคืน capped=true เมื่อยอดชนเพดาน max_qty';
