-- ─────────────────────────────────────────────────────────────────────────────
-- `notifications.event_key` — รู้ว่าแต่ละแถวมาจากกฎไหน  (Main project)
-- 2026-09-17 · ต่อจาก `notif_rule_reach` (ป้ายราคาในหน้า /notification-config)
--
-- ปัญหาที่เจอตอนทำป้ายราคา: จะบอกว่า "เรื่องนี้กินกี่แถว/วัน · คนอ่านกี่ %" ต้องนับจาก
-- `notifications` ย้อนหลัง — แต่ไม่มีคอลัมน์บอกว่าแถวไหนมาจาก event ไหน เลยต้องเดาจาก
-- `title = notification_rules.label` ⇒ **วัดจริง: 46,307 จาก 54,154 แถว (86%) จับคู่ไม่ได้**
-- เพราะตัวส่งบางตัว (send-mtn-notification) ตั้ง title เอง เช่น "🛠️ แจ้งซ่อมใหม่ — Line 60 · -"
-- ไม่ได้ใช้ label ⇒ **ป้ายราคาจะโชว์ว่าใบซ่อม (3,052 แถว/วัน = 79% ของทั้งระบบ) ราคา 0**
-- = ชี้ทางผิดแรงกว่าไม่มีป้ายเลย
--
-- แก้ที่ trigger ฝั่ง DB (แพทเทิร์นเดียวกับ `notifications.link` 2026-09-16) เพราะ
-- `send-notification` 59 KB / `send-mtn-notification` 30 KB — `docs/modules/edge-functions.md`
-- ห้าม deploy ไฟล์ใหญ่ผ่าน MCP และ user ไม่มี CLI · trigger ตัวเดียวครอบทุกตัวส่ง
--
-- `notification_rules.title_match` = LIKE pattern (data-driven — admin แก้เองได้ทีหลัง)
--   ใช้เมื่อ title ไม่ตรง label · seed จาก prefix จริงของใบซ่อม 9 ขั้น (วัดจากฐาน 30 วัน)
--   ⚠️ เพิ่มตัวส่งใหม่ที่ตั้ง title เอง ต้อง seed `title_match` ด้วย ไม่งั้นป้ายราคาของเรื่องนั้นจะเป็น 0
--
-- ย้อนได้: drop column ทั้ง 2 + คืน fn_notification_fill_link เวอร์ชันก่อนหน้า (อยู่ใน
--   20260916_notification_rules_link.sql) — แถวเก่าที่ backfill ไปไม่กระทบใคร (คอลัมน์ใหม่ล้วน)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.notifications      add column if not exists event_key  text;
alter table public.notification_rules add column if not exists title_match text;

comment on column public.notifications.event_key is
  'กฎที่ทำให้เกิดแถวนี้ (notification_rules.event_key) — trigger trg_notification_fill_link เติมให้ · ใช้วัดราคา/ยอดอ่านต่อเรื่องที่ /notification-config';
comment on column public.notification_rules.title_match is
  'LIKE pattern ของ title สำหรับตัวส่งที่ไม่ได้ใช้ label เป็นหัวข้อ (เช่น send-mtn-notification) — ใช้จับคู่ย้อนกลับเป็น event_key';

-- seed: prefix จริงของใบซ่อมแต่ละขั้น (นับจากฐาน 30 วัน — ครอบ 39,632 แถว)
update public.notification_rules r set title_match = v.pat
from (values
  ('mtn_reported',   '🛠️ แจ้งซ่อมใหม่%'),
  ('mtn_assigned',   '📋 รับงานซ่อม%'),
  ('mtn_repaired',   '🔧 ซ่อมเสร็จ%'),
  ('mtn_checked',    '🔎 ตรวจหลังซ่อมแล้ว%'),
  ('mtn_qa',         '🧪 ยืนยันคุณภาพแล้ว%'),
  ('mtn_handover',   '🤝 รับมอบงานซ่อม%'),
  ('mtn_closed',     '✅ ปิดใบแจ้งซ่อม%'),
  ('mtn_qa_skipped', '⏭ ข้าม%'),
  ('mtn_approved',   '✍️ ผจก.แผนกที่แจ้งอนุมัติแล้ว%')
) as v(event_key, pat)
where r.event_key = v.event_key and r.title_match is distinct from v.pat;

/* trigger เดิม + เติม event_key
   ลำดับ: label ตรงเป๊ะก่อน → ไม่ตรงค่อยใช้ title_match (pattern ยาวสุดชนะ = เจาะจงสุด)
   แล้วค่อยหา link จากกฎที่จับคู่ได้ (ครอบคลุมกว่าเดิมที่ใช้ label อย่างเดียว) */
create or replace function public.fn_notification_fill_link()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_link text;
begin
  if new.event_key is null and new.title is not null then
    select r.event_key into new.event_key
      from notification_rules r where r.label = new.title limit 1;
    if new.event_key is null then
      select r.event_key into new.event_key
        from notification_rules r
       where r.title_match is not null and new.title like r.title_match
       order by length(r.title_match) desc limit 1;
    end if;
  end if;

  if new.link is not null then return new; end if;

  if new.ref_table = 'mtn_orders' and new.ref_id is not null then
    new.link := '/mtn-repair?mo=' || new.ref_id::text;
    return new;
  end if;

  if new.ref_table is null and new.event_key is not null then
    select r.link into v_link from notification_rules r
     where r.event_key = new.event_key and r.link is not null limit 1;
    new.link := v_link;
  end if;
  return new;
end;
$$;

-- backfill ประวัติ (ครั้งเดียว) — ให้ป้ายราคามีตัวเลขทันทีไม่ต้องรอสะสมใหม่
update public.notifications n set event_key = r.event_key
  from public.notification_rules r
 where n.event_key is null and r.label = n.title;

update public.notifications n set event_key = r.event_key
  from public.notification_rules r
 where n.event_key is null and r.title_match is not null and n.title like r.title_match;
