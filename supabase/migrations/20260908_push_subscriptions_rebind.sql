-- Web Push — ผูก subscription กับผู้ใช้ปัจจุบันใหม่ได้ (rebind by endpoint) · Main project ewhdfqwfwofivojtsizn
-- ที่มา (feedback หน้างาน 2026-09-08): หัวหน้ากะบน Samsung เปิด "📲 แจ้งเตือนเข้ามือถือ" แล้วแต่ไม่เคยเด้ง MO
--   • ฝั่งเว็บเคย upsert ด้วย `onConflict:'endpoint', ignoreDuplicates:true` = INSERT … ON CONFLICT DO NOTHING
--     → endpoint เดิมที่มีแถวอยู่แล้ว (มือถือใช้ร่วมกัน / ล้าง-สมัครใหม่แล้ว key เปลี่ยน) **ไม่อัพเดตอะไรเลยและไม่มี error**
--     แถวเก่าค้าง user_id/p256dh/auth เดิม → push ส่งไปหาคนผิด หรือ 401/410 แล้วถูกลบ = เงียบทั้งสาย
--   • ตาราง push_subscriptions (20260730_web_push.sql) มี policy แค่ select/insert/delete ของ user เอง
--     **ไม่มี UPDATE policy** และแถวของ user อื่นแตะไม่ได้ → ฝั่ง client rebind เองไม่ได้ผ่าน RLS ธรรมดา
-- ทางเลือกที่พิจารณา: (A) เพิ่ม UPDATE/DELETE policy ให้แตะแถวของคนอื่นตาม endpoint — เปิดกว้างเกิน
--   (ใครก็ลบ subscription คนอื่นได้ถ้ารู้ endpoint) · (B) RPC SECURITY DEFINER ผูกแถวกับ auth.uid() เสมอ ← เลือก B
--   (endpoint เป็นของ browser instance นั้นจริงๆ — คนที่ถือ endpoint อยู่ในมือคือคนที่ login บนเครื่องนั้น)
-- backward-compatible: ไม่แตะโครงตาราง/policy เดิม · โค้ดเก่า (upsert ตรง) ยังใช้ได้ · ย้อน = drop function

-- RPC: สมัคร/ผูกใหม่ทีเดียวจบ (1 round trip) — คืน id ของแถวที่ผูกกับผู้ใช้ปัจจุบัน
create or replace function public.upsert_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text default null
) returns uuid
language plpgsql security definer
set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'endpoint/p256dh/auth required' using errcode = '22023';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id    = excluded.user_id,      -- มือถือใช้ร่วมกัน: คนที่ login ล่าสุดเป็นเจ้าของ endpoint นี้
        p256dh     = excluded.p256dh,       -- key หมุนใหม่ (browser rotate / สมัครใหม่) → ต้องทับ ไม่งั้นส่งไป 401/410
        auth       = excluded.auth,
        user_agent = excluded.user_agent
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.upsert_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.upsert_push_subscription(text, text, text, text) to authenticated;

-- ตรวจผลหลังรัน (MAIN):
--   select proname, prosecdef from pg_proc where proname = 'upsert_push_subscription';   -- 1 แถว prosecdef = true
--   select count(*) from push_subscriptions;                                              -- ยอดเดิม ไม่เปลี่ยน
