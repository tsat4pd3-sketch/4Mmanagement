-- รวม encoding ของ "ทีมช่าง" ให้เหลือแบบเดียว: เก็บ key เสมอ (Main project) — 2026-08-06
-- คู่กับ 20260806_unify_team_encoding_dr.sql (ดูเหตุผลเต็มในไฟล์นั้น)
--
-- ฝั่ง Main มี 2 ที่ที่เก็บทีมเป็น "ชื่อ":
--   telegram_channels.team  — ห้อง Telegram ของทีมไหน (edge ใช้ route ใบซ่อม)
--   profiles.mtn_teams[]    — ทีมที่ user สังกัด (ตั้งที่ /add-user)
--
-- ⚠️ mtn_teams (ตาราง map ชื่อ↔รหัส) อยู่ฝั่ง DR — cross-project join ไม่ได้
--    จึงเขียน map ตรงนี้ให้ตรงกับ mtn_teams.dept_name ปัจจุบัน
--    เพิ่ม/เปลี่ยนชื่อทีมใน mtn_teams ภายหลัง ไม่ต้องแก้ไฟล์นี้ (แปลงครั้งเดียวจบ — ของใหม่เขียน key อยู่แล้ว)
--
-- ปลอดภัย: edge function (send-mtn-notification / mtn-daily-summary) normalize ทั้ง 2 แบบ
--          และ teamsForUser() ฝั่งเว็บก็ normalize → อ่านได้ทั้งก่อนและหลังรัน
-- idempotent: แปลงเฉพาะแถวที่ยังเป็นชื่อ

create or replace view _team_map(name_low, key) as
select * from (values
  ('mtn', 'maintenance'),
  ('jig mtn', 'jig_maintenance'),
  ('die mtn', 'die_maintenance'),
  ('production', 'production')
) v(name_low, key);

-- 1) ห้อง Telegram ที่แท็กทีมไว้
update telegram_channels c set team = m.key
from _team_map m
where c.team is not null and lower(trim(c.team)) = m.name_low and c.team <> m.key;

-- 2) ทีมที่ user สังกัด (array) — แปลงทีละสมาชิก ค่าที่ไม่รู้จักคงไว้ (ไม่ทิ้งข้อมูลเงียบ)
update profiles p
set mtn_teams = sub.arr
from (
  select p2.id,
         array_agg(coalesce(m.key, t) order by ord) as arr
  from profiles p2
  cross join lateral unnest(p2.mtn_teams) with ordinality as u(t, ord)
  left join _team_map m on m.name_low = lower(trim(u.t))
  where p2.mtn_teams is not null and array_length(p2.mtn_teams, 1) > 0
  group by p2.id
) sub
where p.id = sub.id and p.mtn_teams is distinct from sub.arr;

drop view _team_map;

-- ตรวจหลังรัน:
--   select distinct team from telegram_channels;
--   select distinct t from profiles, unnest(mtn_teams) t;
