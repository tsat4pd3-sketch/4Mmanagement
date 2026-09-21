-- ─────────────────────────────────────────────────────────────────────────────
-- ย้ายแจ้งเตือน "Telegram อย่างเดียว" เข้าระบบในแอปให้ครบ   (Main project)
-- 2026-09-17 · คำสั่ง user: "จากการแจ้งเตือน telegram ให้ย้ายเข้าระบบเราทั้งหมด
--                            สิทธิ์หรือช่องทางก็ไปอ้างอิงจาก telegram"
--
-- ที่มา: 14/61 เรื่องที่เปิดอยู่ มี `channel_ids` (Telegram) แต่ `inapp_roles` ว่าง
--   ⇒ ปิด Telegram เมื่อไหร่ 14 เรื่องนี้หายเงียบทันที (หลายตัวคือเรื่องด่วนที่สุด:
--     Downtime · เรียกช่าง MTN · Daily PM แดง · สโตร์หยิบผิดพาร์ท)
--
-- 🔗 ผู้รับในแอป = ถอดจาก "ห้อง Telegram" ที่เรื่องนั้นส่งเข้าอยู่แล้ว
--   วิธีถอด: ดูกฎที่ตั้งครบทั้ง 2 ขาอยู่แล้ว แล้วเอา role ที่ห้องนั้นใช้ **≥50% ของกฎในห้อง**
--   เป็น "ผู้ฟังประจำห้อง" (+ `admin` ทุกห้าง เพราะเป็น role ที่เห็นทุกอย่างอยู่แล้ว):
--     🔧 Smart Maintenance     → admin · manager · supervisor · mtn       (mtn 67% · mgr/sv 60%)
--     🚚 Smart Logistic        → admin · manager · planner_store · sale   (100/100/88/75%)
--     🔍 Smart Quality         → admin · manager · qa                     (100/100/88%)
--     🏭 Smart Production      → admin · manager · supervisor · leader    (100/75/75/50%)
--     📝 Report Technician PD3 → admin · manager · supervisor · leader    (75/75/75/50%)
--     🧑‍🏭 Smart Manpower       → admin · manager · supervisor            (100/100/100%)
--
-- 🔴 2 ข้อยกเว้นที่ **ตั้งใจไม่ทำตาม Telegram** — เพราะปริมาณต่างกันคนละโลก:
--   ห้องแชทรับ 149 ข้อความ/วันได้ แต่กระดิ่ง+เสียง+push ส่วนตัว 149×61 = 9,100 ครั้ง/วัน
--   = กลบแจ้งเตือนจริงทั้งระบบ + เสี่ยง egress (เคยโดน Supabase ล็อกทั้ง org มาแล้ว)
--   · `downtime` (149/วัน) และ `downtime_recovered` → **supervisor · leader + match_section**
--     · ตัด admin/manager เพราะ `notify_recipients()` **ยกเว้น admin/manager จากการกรองส่วนงาน**
--       ⇒ ใส่แล้วได้ทุกใบทั้งโรงงาน (149/วัน เต็มๆ)
--     · 🔴 **ตัด `mtn` ด้วย — ช่างซ่อม 13/13 คนไม่มี `section`** (ใช้ `mtn_teams[]` แทนตามดีไซน์)
--       ⇒ RPC ปล่อยผ่านคนที่ไม่มี section ทุกส่วนงาน = ช่างทุกคนได้ DT ทุกใบ กรองไม่ได้เลย
--       ช่างรับผ่าน `downtime_call_mtn` (เรียกช่าง) + `downtime_open_15min` (ค้างเกินเกณฑ์) ซึ่งเป็น
--       "เรื่องที่ต้องลงมือ" แทน · **ก่อนจะใส่ role `mtn` ในกฎที่กรองด้วย section ต้องเช็คข้อนี้เสมอ**
--     · วัดหลังแก้: downtime = 4-9 คน/ใบ (PD3 = 24) ≈ 1,500 แถว/วัน — ถ้ารกให้ปิด `downtime`
--       ในแอปที่ /notification-config แล้วเหลือแค่ 2 ตัวข้างบน (Telegram ไม่กระทบ)
--   · Telegram ของ 2 เรื่องนี้ยังส่งครบเหมือนเดิม ไม่ได้ตัดอะไรออกจากห้อง
--
-- `inapp_match_section` ตาม convention เดิมของหมวดนั้น: เรื่องผูกไลน์/เครื่อง = true ·
--   สรุปทั้งโรงงาน/รายรอบ = false (logistic ทั้งหมวดเป็น false อยู่แล้ว — planner/sale
--   หลายคนไม่ได้ตั้ง section ถ้าเปิด match จะกรองจนไม่เหลือใคร)
--
-- ⚠️ นี่คือ "เพิ่มช่องทาง" ไม่ใช่ "ย้าย" — Telegram ยังส่งเหมือนเดิมทุกเรื่อง
--    ตั้งใจให้รันขนาน 2 ขา แล้วค่อยปิด Telegram ทีละเรื่องที่ /notification-config
-- ย้อนได้: คืนค่าจาก bk_notification_rules_inapp_20260917 (เก็บ 3 คอลัมน์ก่อนแก้)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.bk_notification_rules_inapp_20260917 as
select event_key, inapp_roles, inapp_match_section
  from public.notification_rules where false;

insert into public.bk_notification_rules_inapp_20260917 (event_key, inapp_roles, inapp_match_section)
select event_key, inapp_roles, inapp_match_section
  from public.notification_rules
 where is_enabled
   and coalesce(array_length(channel_ids,1),0) > 0
   and coalesce(array_length(inapp_roles,1),0) = 0
   and not exists (select 1 from public.bk_notification_rules_inapp_20260917 b
                    where b.event_key = notification_rules.event_key);

update public.notification_rules r set
  inapp_roles         = v.roles,
  inapp_match_section = v.match_sec,
  updated_at          = now()
from (values
  -- ── 🔧 Smart Maintenance ────────────────────────────────────────────────
  ('pm_daily_red',        array['admin','manager','supervisor','mtn'],        true),
  ('pm_daily_orange',     array['admin','manager','supervisor','mtn'],        true),
  ('pm_daily_green',      array['admin','manager','supervisor','mtn'],        true),
  ('downtime_call_mtn',   array['admin','manager','supervisor','mtn'],        true),
  -- ── 🏭 Smart Production ─────────────────────────────────────────────────
  ('prod_close',          array['admin','manager','supervisor','leader'],     true),
  -- 🔴 ข้อยกเว้นปริมาณ (ดูหัวไฟล์) — แพทเทิร์นเดียวกับ mtn_reported
  ('downtime',            array['supervisor','leader'],                       true),
  ('downtime_recovered',  array['supervisor','leader'],                       true),
  -- ── 🔍 Smart Quality ────────────────────────────────────────────────────
  ('four_m_status',       array['admin','manager','qa'],                      false),
  -- ── 🧑‍🏭 Smart Manpower ──────────────────────────────────────────────────
  ('checkin_summary',     array['admin','manager','supervisor'],              true),
  -- ── 🚚 Smart Logistic (หมวดนี้ไม่กรอง section — สโตร์/เซลล์ทำทั้งโรงงาน) ──
  ('kanban_round_cutoff', array['admin','manager','planner_store','sale'],    false),
  ('shipping_shipped',    array['admin','manager','planner_store','sale'],    false),
  ('wip_part_below_min',  array['admin','manager','planner_store','sale'],    false),
  ('wip_pick_blocked',    array['admin','manager','planner_store','sale'],    false),
  ('wip_request_placed',  array['admin','manager','planner_store','sale'],    false)
) as v(event_key, roles, match_sec)
where r.event_key = v.event_key
  and coalesce(array_length(r.inapp_roles,1),0) = 0;   -- ไม่แตะกฎที่มีคนตั้งผู้รับไว้แล้ว

-- `downtime_open_15min` = ตัวที่ "ต้องลงมือ" จริง (เปิดค้างเกินเกณฑ์) แต่ยังไม่มีผู้รับในแอปเลย
-- ไม่ได้อยู่ใน 14 ข้อข้างบนเพราะยังไม่ได้ผูกห้อง Telegram — เปิดให้ทีมหน้างานด้วยแพทเทิร์นเดียวกัน
update public.notification_rules
   set inapp_roles = array['supervisor','leader','mtn'], inapp_match_section = true, updated_at = now()
 where event_key = 'downtime_open_15min'
   and coalesce(array_length(inapp_roles,1),0) = 0;
