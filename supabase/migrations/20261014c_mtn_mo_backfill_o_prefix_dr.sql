-- backfill `O-` ให้เลข MO เก่าของทีม MTN ที่ "ออกจากระบบ"  (DR · eyhclzkifitbhbljgoav)
-- 2026-10-14 · คำสั่ง user: *"backfill เลข mo เก่าของ mtn ด้วย ที่ออกจากระบบ เพิ่ม O- ให้หมด"*
--
-- ═══ ทำไมต้อง backfill ═══════════════════════════════════════════════════════
-- `O-` (ตั้งใน 20261014b) แยก "ใบที่ออกจากระบบ" ออกจาก **เล่มกระดาษที่ทีม MTN เขียนเลขเอง**
-- ถ้าเติมแต่ใบใหม่ จะมี 2 ยุคในทะเบียนเดียวกัน: ใบก่อน 14/10 ไม่มี `O-` · หลังจากนั้นมี
-- ⇒ คนที่ถือเล่มกระดาษอ่านใบเก่าแล้วแยกไม่ออกว่าเป็นของระบบหรือของเล่ม = เป้าหมายของ `O-` พัง
--
-- ═══ 🔴 พิสูจน์ก่อนว่า "ทุกใบที่จะแตะ เป็นใบของระบบจริง" ═════════════════════════
-- `mo_seq` เขียนโดย RPC `mtn_assign_mo_no()` **ที่เดียว** ⇒ มี `mo_seq` = ระบบออกให้
-- วัดจริง 14/10 (ทีม maintenance · ใบที่มีเลขแล้ว 35 ใบ): **มี `mo_seq` ครบ 35/35**
--   · `MTN.%`  24 ใบ (รูปแบบรายเดือนปัจจุบัน)
--   · `MAI-%`   7 ใบ (ยุคที่ `mtn_teams.mo_code` lookup พลาด → ถอยไป 3 ตัวแรกของ key)
--   · `BM-160726-01` 1 ใบ (รูปแบบยุคแรกสุด 16/07)
--   · `O-%`     3 ใบ (ออกหลัง 20261014b แล้ว — ข้ามไป)
-- ⇒ **ไม่มีเลขที่คนพิมพ์มือเก็บอยู่ในระบบเลย** จึงไม่มีทางเติม `O-` ทับเลขของเล่มกระดาษ
--   (เงื่อนไข `mo_seq is not null` ข้างล่าง = ด่านกันไว้ ถ้าวันหน้ามีช่องให้พิมพ์เลขมือ
--    ใบพวกนั้นจะไม่มี `mo_seq` ⇒ migration นี้รันซ้ำก็ไม่แตะ)
--
-- ═══ ทำไม "เติมหน้า" ไม่ใช่ "ออกเลขใหม่" ═══════════════════════════════════════
-- เลขเดิมยังเป็น substring ⇒ ค้นด้วย `MTN.2026/09-3` บนจอยังเจอใบเดิม และกระดาษที่พิมพ์
-- ไปแล้วยังตามรอยได้ · ตรงกับที่ user เคาะไว้ตอนเลือกรูปแบบ: *"ไม่ใช่เอาของเดิมออก แต่เพิ่มเข้าไป"*
-- ตรวจแล้วว่าปลอดภัย (14/10): `mo_no` มีอยู่ในตาราง `mtn_orders` **ที่เดียว** ·
-- ใบที่จะแตะ **ไม่มี snapshot เลย** (0 แถวใน `mtn_mo_snapshots`) ⇒ ไม่มีใบที่ออกเลขแล้วถูกแก้เนื้อ ·
-- ไม่มีข้อความใน notifications / event_comments / improvements อ้างเลขพวกนี้
--
-- ⚠️ ย้อนกลับ: ดูท้ายไฟล์ (สำเนาเต็มอยู่ใน schema `archive` ไม่ใช่ `public` — กฎ CLAUDE.md §/schema)

create schema if not exists archive;

-- ── 1) สำรองก่อนแตะ (id + เลขเดิม เท่าที่ใช้ย้อน) ─────────────────────────────
--    ไม่ก๊อปทั้งแถว — เลขคือสิ่งเดียวที่ migration นี้เปลี่ยน · ตารางกว้างสำรองทั้งใบ
--    = ข้อมูลจริงนอนซ้ำอีกชุดโดยไม่มีใครใช้
create table if not exists archive._bak_20261014_mtn_mo_no as
select id, mo_no as mo_no_before, mo_seq, status, report_at, now() as backed_up_at
  from public.mtn_orders
 where mtn_dept = 'maintenance'
   and coalesce(mo_no, '') <> ''
   and mo_no not like 'O-%'
   and mo_seq is not null;

-- ── 2) เติม `O-` ───────────────────────────────────────────────────────────────
--    🔴 เงื่อนไขต้องตรงกับขั้นสำรองเป๊ะ (ไม่งั้นสำรองไม่ครอบของที่แก้)
--    idempotent: `not like 'O-%'` ⇒ รันซ้ำไม่กลายเป็น `O-O-`
update public.mtn_orders
   set mo_no = 'O-' || mo_no, updated_at = now()
 where mtn_dept = 'maintenance'
   and coalesce(mo_no, '') <> ''
   and mo_no not like 'O-%'
   and mo_seq is not null;

-- ── คิวรีเช็คผลหลัง apply (ต้องได้ 0 ทั้ง 2 คอลัมน์) ──────────────────────────
--   select count(*) filter (where mo_no not like 'O-%')  as ยังไม่มี_O,
--          count(*) filter (where mo_no like 'O-O-%')    as ซ้ำซ้อน
--     from public.mtn_orders
--    where mtn_dept = 'maintenance' and coalesce(mo_no,'') <> '' and mo_seq is not null;
--
--   -- เทียบกับสำเนา: ทุกแถวต้องจับคู่ได้ และเลขใหม่ = 'O-' + เลขเดิม
--   select count(*) as ไม่ตรง
--     from archive._bak_20261014_mtn_mo_no b join public.mtn_orders o on o.id = b.id
--    where o.mo_no <> 'O-' || b.mo_no_before;
--
-- ── ย้อนกลับ ──────────────────────────────────────────────────────────────────
--   update public.mtn_orders o set mo_no = b.mo_no_before, updated_at = now()
--     from archive._bak_20261014_mtn_mo_no b where b.id = o.id;
--   (ใบที่ออกเลขหลัง 14/10 ไม่อยู่ในสำเนา ⇒ ไม่ถูกย้อน — ถูกต้อง เพราะ RPC ออก `O-` ให้ตั้งแต่เกิด
--    จะให้ RPC เลิกเติม `O-` ด้วย ต้องรัน 20261014_mtn_mo_no_parity.sql ทับ)
