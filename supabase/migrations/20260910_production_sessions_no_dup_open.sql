-- ══════════════════════════════════════════════════════════════════════════
-- กะผลิต — ห้ามมี "กะที่ยังไม่ปิด" ซ้ำกันใน ไลน์+วันที่+กะ เดียวกัน        2026-09-10
-- Project: DR (eyhclzkifitbhbljgoav · ชื่อในจอ "Product DB")
--
-- ที่มา (feedback หน้างาน 10/09 · หัวหน้ากลุ่ม Assy LWR ส่งรูปมาทาง LINE):
--   "กะกลางคืนส่งยอดต่อกะ เข้านี้ 25 ตัว · ตอนเข้าเปิดกะมาไม่โชว์ขึ้น · แต่กะกลางคืนมันมีเปิดกะ มา 2 อัน"
--   ไล่แล้วเจอว่า Assy LWR กะดึก 09/09 ถูกเปิด **2 กะ** ห่างกัน 0.12 วินาที
--   ยอดยก 10 ชิ้นของใบ 0133259280 ถูกรับเข้ากะซ้ำ (ไม่ใช่กะเช้าวันถัดไป) ⇒ กะเช้า 10/09 ไม่เห็นยอดค้างเลย
--
-- ทำไมกะซ้ำถึงเกิด — 2 ทาง (แก้ที่โค้ดทั้งคู่ในคอมมิทเดียวกัน):
--   1) Checkin.jsx: เช็คชื่อทั้งไลน์แม่ (LWR BAR/HYDROFORM) + ไลน์ลูก (Assy LWR/LASER E50) พร้อมกัน
--      ⇒ ไลน์แม่ถูก expand เป็นลูก แล้วไลน์ลูกที่ถูกเช็คเองก็เข้าคิวอีกรอบ ⇒ ลูป insert 2 แถว
--      (**ไม่ใช่ผู้ใช้กดซ้ำ** — วัดจริง LASER E50 ซ้ำเกือบทุกวันตั้งแต่ 13/08 · 15 วัน)
--   2) DailyReport.jsx `handleOpenSession`: ด่านกันซ้ำเป็น read-then-insert (TOCTOU)
--      ⇒ กดปุ่ม 2 ครั้งติด/สองแท็บ = ผ่านทั้งคู่ (วัดจริง Line 61 10/09 ห่างกัน 2.9 มิลลิวินาที)
--
-- ⚠️ ทำไม index นี้เป็น **partial** เฉพาะ open/pending_close
--   เพราะ "ปิดกะแล้วเปิดกะใหม่ของวัน+กะเดิม" (เช่น เปิดต่อทำ OT) เป็นพฤติกรรมที่ใช้อยู่จริง
--   ⇒ ล็อกทั้งตารางจะพังของเดิม · เงื่อนไขนี้ = กฎเดียวกับที่ handleOpenSession เช็คอยู่แล้วเป๊ะ
--   (แปลว่า index นี้ห้ามเฉพาะสิ่งที่แอปถือว่าผิดอยู่แล้ว — ไม่ปิดทางไหนใหม่)
--
-- ⚠️ ต้องล้างแถวที่ชนก่อน ไม่งั้น create index ล้ม — วัดจริง 10/09 เหลือชนกันคู่เดียว:
--   LASER E50 · 2026-09-10 · day → 2 กะ open ทั้งคู่ (08:09:09.607 / 08:09:09.808)
--   แถวที่ลบ 034f972b-d779-4ef4-84e0-33115b39ff22 (แถวหลัง) **ว่างเปล่าจริง**:
--   prod_orders 0 · downtime_logs 0 · defect_logs 0 · kanban_scans 0 · kanban_targets 0 · qty ทั้งหมด null
--   ⇒ ไม่มีข้อมูลผลิตหาย (กะที่คนใช้งานจริงคือ 92ddb4a8 แถวแรก)
-- ══════════════════════════════════════════════════════════════════════════

-- 1) ล้างกะซ้ำที่ว่างเปล่า (เงื่อนไขบังคับว่าต้องไม่มีลูกจริงๆ — ถ้ามีข้อมูลจะไม่ลบ)
delete from public.production_sessions s
where s.id = '034f972b-d779-4ef4-84e0-33115b39ff22'
  and not exists (select 1 from public.prod_orders    x where x.session_id = s.id)
  and not exists (select 1 from public.downtime_logs  x where x.session_id = s.id)
  and not exists (select 1 from public.defect_logs    x where x.session_id = s.id)
  and not exists (select 1 from public.kanban_scans   x where x.session_id = s.id)
  and not exists (select 1 from public.kanban_targets x where x.session_id = s.id);

-- 2) ด่านจริงฝั่ง DB — กันได้แม้สองคำขอวิ่งพร้อมกัน (ที่ read-then-insert ฝั่ง client กันไม่ได้)
create unique index if not exists production_sessions_one_open_per_line_shift
  on public.production_sessions (line_name, work_date, shift)
  where status in ('open', 'pending_close');

comment on index public.production_sessions_one_open_per_line_shift is
  '1 ไลน์ + 1 วัน + 1 กะ มี "กะที่ยังไม่ปิด" ได้ครั้งละ 1 กะเท่านั้น (2026-09-10) — '
  'กะที่ปิดแล้วไม่นับ จึงยังเปิดกะใหม่ทับวัน+กะเดิมได้ตามเดิม · client แปลง error 23505 '
  'เป็นข้อความ "ไลน์นี้มีกะเปิดอยู่แล้ว" ทั้งใน DailyReport.handleOpenSession และ Checkin.handleConfirmOpenShift';

-- ตรวจผลหลังรัน (DR · Product DB):
--   select indexname from pg_indexes where tablename='production_sessions';   -- ต้องเห็น index ตัวนี้
--   select line_name, work_date, shift, count(*) from production_sessions
--    where status in ('open','pending_close') group by 1,2,3 having count(*)>1;  -- ต้องได้ 0 แถว
--
-- Rollback:
--   drop index if exists public.production_sessions_one_open_per_line_shift;
--   (แถวที่ลบใน (1) เป็นกะว่างไม่มีข้อมูลลูก — ถ้าต้องการคืน ให้เปิดกะใหม่จากหน้า Daily Report ได้เลย)
