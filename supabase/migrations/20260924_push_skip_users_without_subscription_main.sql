-- ── Main project (ewhdfqwfwofivojtsizn) — ชื่อในจอ Supabase: "MAIN" ──
-- fn_notify_push: ไม่ยิง Edge Function ให้คนที่ยังไม่เปิด Push + แนบ subscription ไปกับ body
-- 2026-09-24 · งานลด egress/จำนวน request
--
-- ═══ วัดจริงก่อนแก้ (23/09/2026) ════════════════════════════════════════════════
--   `push_subscriptions`   5,929 ครั้ง/วัน  (5,627 มาจาก Edge Runtime)
--   `notification_settings` 5,402 ครั้ง/วัน (ทั้งหมดมาจาก Edge Runtime)
--   รวม **11,331 = 25.3% ของ REST ฝั่ง Main ทั้งวัน** — มากกว่าทุก endpoint ที่คนเปิดใช้จริง
--
--   ต้นเหตุ: trigger นี้ยิง `send-push` **1 ครั้งต่อ 1 แถวใน notifications** โดยไม่ดูก่อนเลย
--   ว่าผู้รับเปิด Push ไหม · ของจริง 24 ชม.: แจ้งเตือน 1,377 แถว แต่ผู้รับมี subscription
--   แค่ **389 แถว (28%)** ⇒ **988 ครั้ง (72%) ยิงทิ้งเปล่า** และแต่ละครั้งยังอ่าน 2 ตาราง
--   เต็มๆ ก่อนจะตอบ sent:0 — คือไปตรวจทีหลังทั้งที่ตรวจก่อนได้ด้วยคิวรีในตัว DB เอง
--
-- ═══ ที่แก้ ═══════════════════════════════════════════════════════════════════
--   1. `exists(...)` ก่อนยิง — ไม่มี subscription = ไม่ต้องเรียก Edge Function เลย
--      (อ่านในตัว DB เอง ผ่าน index ไม่ผ่าน PostgREST ⇒ ไม่นับเป็น request/egress)
--   2. แนบ `subs` (endpoint/p256dh/auth) ไปกับ body — ฝั่ง Edge จะได้ไม่ต้องคิวรีซ้ำ
--      ⚠️ ส่งเฉพาะคีย์ของ "ตัวรับ" ซึ่งเป็นค่าสาธารณะของเบราว์เซอร์ปลายทาง
--         **ห้ามส่ง VAPID private key ผ่าน body** (นั่นเป็นความลับของฝั่งผู้ส่ง)
--
-- ═══ เข้ากันได้ทั้ง 2 ทาง (deploy คนละจังหวะได้ ไม่พัง) ══════════════════════════
--   • ฟังก์ชันเวอร์ชันเก่า + trigger ใหม่ → `subs` ที่แนบมาถูกมองข้าม แล้วไปคิวรีเองเหมือนเดิม
--   • ฟังก์ชันใหม่ + trigger เก่า        → ไม่มี `subs` ในบอดี้ ก็คิวรีเองเหมือนเดิม
--
-- ═══ ผลข้างเคียงที่ตั้งใจ ═════════════════════════════════════════════════════
--   คนที่ "เพิ่งกดเปิด Push" จะได้รับตั้งแต่แจ้งเตือนถัดไปทันที (trigger อ่านสดทุกครั้ง)
--   และคนที่ไม่เคยเปิด จะไม่มี log invocation ให้สับสนอีก
--
-- rollback: ใช้บล็อก `create or replace` ท้ายไฟล์นี้ (คัดลอกของเดิมจาก
--           20260916_notifications_link.sql) — ย้อนได้ทันที ไม่กระทบข้อมูล

create or replace function public.fn_notify_push()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_subs jsonb;
begin
  -- รวม subscription ของผู้รับไว้ก้อนเดียว (คนละ 1-2 เครื่อง) — null = ยังไม่เปิด Push
  select jsonb_agg(jsonb_build_object(
           'id', p.id, 'endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth', p.auth))
    into v_subs
    from public.push_subscriptions p
   where p.user_id = NEW.user_id;

  -- ไม่มีเครื่องให้ส่ง = จบตรงนี้ ไม่ต้องปลุก Edge Function (72% ของแถวตกกรณีนี้)
  if v_subs is null then return NEW; end if;

  perform net.http_post(
    url := 'https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object(
      'user_id', NEW.user_id, 'title', NEW.title, 'body', NEW.body,
      'type', NEW.type, 'ref_table', NEW.ref_table, 'ref_id', NEW.ref_id,
      'link', NEW.link,
      'subs', v_subs
    )
  );
  return NEW;
-- ⚠️ ห้ามถอด exception block — การแจ้งเตือนส่งไม่ออก ต้องไม่ทำให้ insert notifications ล้ม
exception when others then return NEW;
end;
$function$;

-- ── rollback (คัดลอกไปรันถ้าต้องย้อน) ──────────────────────────────────────────
-- create or replace function public.fn_notify_push()
-- returns trigger language plpgsql security definer set search_path to 'public'
-- as $function$
-- begin
--   perform net.http_post(
--     url := 'https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-push',
--     headers := jsonb_build_object('Content-Type','application/json'),
--     body := jsonb_build_object(
--       'user_id', NEW.user_id, 'title', NEW.title, 'body', NEW.body,
--       'type', NEW.type, 'ref_table', NEW.ref_table, 'ref_id', NEW.ref_id,
--       'link', NEW.link)
--   );
--   return NEW;
-- exception when others then return NEW;
-- end;
-- $function$;
