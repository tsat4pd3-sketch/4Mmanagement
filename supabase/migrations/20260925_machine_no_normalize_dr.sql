-- ── DR project "Product DB" (eyhclzkifitbhbljgoav) ──
-- ══ 🏷️ เลขเครื่องเขียนหลายแบบในคอลัมน์เดียวกัน → ยุบให้ตรงทะเบียน `machines` ═════════
-- 2026-09-25 · ต่อจากงานจัดประเภท downtime (24/09) ที่เจอต้นเหตุจริงของ "แท่งซ้ำ"
--
-- ปัญหาที่วัดได้ (ทั้งตาราง ไม่ใช่แค่ 180 วัน):
--   `SW10` กับ `SW-10` · `LS10` กับ `LS-10` · `RB 102` กับ `RB-102` = **เครื่องเดียวกัน**
--   แต่พาเรโต/KPI/MTBF ทุกจอ join ด้วย machine_no เป็น text ⇒ แตกเป็นคนละแท่ง คนละตัวหาร
--   downtime_logs 494 แถว / 85 ค่า (SW10 เดี่ยวๆ 125 แถว) · mtn_orders 2 · pm_coordination_plans 1
--
-- 🔴 ขอบเขต = **รูปแบบการเขียนเท่านั้น** (ตัวพิมพ์ · ช่องว่าง · ขีด · เลข 0 นำหน้า)
--   ห้ามแตะทับศัพท์/ชื่อย่อ (`เลเซอร์04` · `Laser4` · `LWR` · `ปืนรีเวท`) — นั่นคือ**เดาว่าเป็นเครื่องไหน**
--   ซึ่งทะเบียนเองก็ขัดกัน (มี `LS-11` ชื่อ "Laser" อยู่ใต้ไลน์ HYDROFORM) ⇒ 227 ค่าที่เหลือ
--   ต้องให้คนตัดสิน ไม่ใช่ migration · ตรรกะเดียวกันฝั่ง client = `src/utils/machineNo.js`
--
-- 🔴 คีย์ที่ทะเบียนเองเขียน 2 แบบ = **ข้าม ไม่ยุบ** (n>1) — ตอนนี้มี 2 คีย์:
--   `RB-79` vs `RB79` · `H BRACE LH … (OP30: PIERCE : 200T)` vs `… :200T)` (ต่างที่ช่องว่าง)
--   ระบบไม่มีทางรู้ว่าอันไหนคือตัวจริง → แจ้ง user ให้ลบตัวซ้ำในทะเบียนก่อน
--
-- ไม่มี trigger บน 3 ตารางนี้ (ตรวจ pg_trigger แล้ว = 0) ⇒ update ไม่ปลุกอะไรต่อ

create schema if not exists archive;

-- ── 1) คีย์เทียบเลขเครื่อง (ใช้ซ้ำได้ ไม่ผูกกับ migration นี้) ─────────────────────────
--   ตรงกับ machineKey() ใน src/utils/machineNo.js — แก้ที่ไหนต้องแก้คู่กัน
create or replace function public.machine_key(txt text) returns text
language sql immutable parallel safe as $$
  select regexp_replace(
           upper(regexp_replace(coalesce(txt,''), '[^A-Za-z0-9฀-๿]', '', 'g')),
           '^([A-Z฀-๿]+)0*([0-9]+)$', '\1\2')
$$;
comment on function public.machine_key(text) is
  'คีย์เทียบ machine_no แบบไม่สนตัวพิมพ์/ช่องว่าง/ขีด/0 นำหน้า — คู่กับ src/utils/machineNo.js (2026-09-25)';

-- ── 2) สำรองแถวที่จะถูกแก้ (schema archive — ห้ามไว้ public) ──────────────────────────
create table if not exists archive.machine_no_normalize_20260925 (
  tbl text not null, row_id uuid not null, old_machine_no text, new_machine_no text,
  moved_at timestamptz not null default now(),
  primary key (tbl, row_id)
);

with reg as (
  select public.machine_key(machine_no) k, min(machine_no) canon, count(distinct machine_no) n
  from public.machines where machine_no is not null and btrim(machine_no) <> '' group by 1
), ok as (select k, canon from reg where n = 1),
src as (
  select 'downtime_logs' tbl, id, machine_no from public.downtime_logs
  union all select 'mtn_orders', id, machine_no from public.mtn_orders
  union all select 'pm_coordination_plans', id, machine_no from public.pm_coordination_plans
)
insert into archive.machine_no_normalize_20260925 (tbl, row_id, old_machine_no, new_machine_no)
select s.tbl, s.id, s.machine_no, o.canon
from src s join ok o on o.k = public.machine_key(s.machine_no)
where s.machine_no is not null and s.machine_no <> o.canon
on conflict (tbl, row_id) do nothing;

-- ── 3) ยุบค่าให้ตรงทะเบียน (อ่านจากตารางสำรอง = แก้เฉพาะแถวที่สำรองไว้แล้วเสมอ) ────────
update public.downtime_logs t set machine_no = b.new_machine_no
  from archive.machine_no_normalize_20260925 b
 where b.tbl = 'downtime_logs' and b.row_id = t.id and t.machine_no = b.old_machine_no;

update public.mtn_orders t set machine_no = b.new_machine_no
  from archive.machine_no_normalize_20260925 b
 where b.tbl = 'mtn_orders' and b.row_id = t.id and t.machine_no = b.old_machine_no;

update public.pm_coordination_plans t set machine_no = b.new_machine_no
  from archive.machine_no_normalize_20260925 b
 where b.tbl = 'pm_coordination_plans' and b.row_id = t.id and t.machine_no = b.old_machine_no;

-- ── เช็คผลหลังรัน ────────────────────────────────────────────────────────────────────
--   -- ก) จำนวนแถวที่ยุบ (ควรได้ 494 / 2 / 1 ณ 2026-09-25)
--   select tbl, count(*) from archive.machine_no_normalize_20260925 group by 1;
--   -- ข) ยอดรวมต้องไม่ขยับ (ก่อนรัน: 9933 แถว / 252036.0 นาที)
--   select count(*), sum(coalesce(duration_min,0)) from downtime_logs;
--   -- ค) ต้องไม่เหลือค่าที่ต่างจากทะเบียนแค่รูปแบบ = 0
--   with reg as (select public.machine_key(machine_no) k, min(machine_no) canon,
--                       count(distinct machine_no) n from machines
--                 where machine_no is not null and btrim(machine_no)<>'' group by 1),
--        ok as (select k,canon from reg where n=1)
--   select count(*) from downtime_logs d join ok o on o.k = public.machine_key(d.machine_no)
--    where d.machine_no <> o.canon;
--
-- ── ROLLBACK ─────────────────────────────────────────────────────────────────────────
--   update public.downtime_logs t set machine_no = b.old_machine_no
--     from archive.machine_no_normalize_20260925 b
--    where b.tbl='downtime_logs' and b.row_id=t.id and t.machine_no = b.new_machine_no;
--   update public.mtn_orders t set machine_no = b.old_machine_no
--     from archive.machine_no_normalize_20260925 b
--    where b.tbl='mtn_orders' and b.row_id=t.id and t.machine_no = b.new_machine_no;
--   update public.pm_coordination_plans t set machine_no = b.old_machine_no
--     from archive.machine_no_normalize_20260925 b
--    where b.tbl='pm_coordination_plans' and b.row_id=t.id and t.machine_no = b.new_machine_no;
--   -- ฟังก์ชัน machine_key ปล่อยไว้ได้ (ไม่มีใครพึ่งพา = ไม่กระทบ) หรือ:
--   -- drop function if exists public.machine_key(text);
