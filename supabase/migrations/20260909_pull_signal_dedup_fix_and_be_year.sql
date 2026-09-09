-- ══ 🔧 แก้ 2 บั๊กที่เจอวันแรกที่ใช้จริง (2026-09-09 · user ทัก "ไม่มีรายละเอียดให้ดู") ════════
-- Target project: DR (eyhclzkifitbhbljgoav) — "Product DB" ในจอ Supabase
--
-- ① **แถวหลักฐานไม่เคยถูกบันทึกเลย** (`customer_pull_signals` = 0 แถว ทั้งที่ batch บอก 7 แถว)
--    ต้นเหตุ: unique index เดิมใช้ **expression** `coalesce(supplier_ref, customer_part_no)`
--    แต่ client ส่ง `onConflict=source,ship_to,supplier_ref,pulled_at` (คอลัมน์ล้วน)
--    ⇒ Postgres หา constraint ที่ตรงไม่เจอ → **42P10** → upsert ล้มทั้งก้อน → แท็บประวัติกางออกมาว่าง
--    ⇒ เปลี่ยนเป็น **คอลัมน์ล้วน `(source, ship_to, customer_part_no, pulled_at)`**
--       (`customer_part_no` เป็น NOT NULL และเป็นคีย์ธุรกิจจริงที่ใช้รวมยอดอยู่แล้ว —
--        `supplier_ref` เป็น optional ต่างหาก จึงไม่เหมาะเป็นคีย์)
--    **บทเรียน: `onConflict` ของ PostgREST แมตช์ได้เฉพาะ unique index ที่เป็นคอลัมน์ล้วน
--      — index ที่มี expression/partial จะล้มแบบ 42P10 ทุกครั้ง**
--
-- ② **ไฟล์จริงส่งมาเป็นปี พ.ศ.** (`Start Time = 2569-09-09T06:00:00`) — ต่างจากไฟล์ตัวอย่างวันแรก (2026)
--    ระบบเก็บตรงตัว ⇒ `due_date = 2569-09-09` = **ใบล่องหน 543 ปี ไม่มีวันโผล่บนชาร์ต**
--    แก้ที่ตัวอ่านแล้ว (`toCeYear` ใน src/utils/pullSignal.js · ปี ≥ 2400 → −543 + เตือนบนจอ)
--    ไฟล์นี้ตามเก็บ **ข้อมูลที่หลุดไปแล้ว** ให้กลับมาอยู่ในปีที่ถูก

/* ── ① index กันซ้ำ: expression → คอลัมน์ล้วน ─────────────────────────────────────── */
drop index if exists public.customer_pull_signals_dedup_idx;
create unique index if not exists customer_pull_signals_dedup_idx
  on public.customer_pull_signals (source, ship_to, customer_part_no, pulled_at);
comment on index public.customer_pull_signals_dedup_idx is
  'กันนำเข้าไฟล์ซ้ำ (user โหลดทุก 2 ชม. ช่วงเวลาคาบเกี่ยวกันได้) — ⚠️ ต้องเป็นคอลัมน์ล้วนเสมอ ห้ามใส่ expression/partial ไม่งั้น onConflict ของ PostgREST ล้ม 42P10 แล้วแถวหลักฐานหายเงียบ';

/* ── ② ตามเก็บข้อมูลที่บันทึกด้วยปี พ.ศ. ก่อนแก้ตัวอ่าน ────────────────────────────────
   ขอบเขต: เฉพาะแถวที่ **ปี ≥ 2400 เท่านั้น** (เป็นไปไม่ได้ในข้อมูลจริง) และเฉพาะสายที่มาจาก e-SMART
   ⇒ ไม่มีทางแตะใบ 862/คีย์มือ · idempotent (รันซ้ำได้ แถวที่แก้แล้วไม่เข้าเงื่อนไขอีก) */
update public.customer_pull_batches
   set work_date    = (work_date - interval '543 years')::date,
       window_start = window_start - interval '543 years',
       window_end   = window_end   - interval '543 years'
 where extract(year from work_date) >= 2400;

update public.customer_pull_signals
   set work_date = (work_date - interval '543 years')::date,
       pulled_at = pulled_at - interval '543 years'
 where extract(year from pulled_at) >= 2400;

-- ใบส่งที่ถูกสร้างด้วยวันที่ พ.ศ. — **แตะเฉพาะ source='esmart'** (ใบพวกนี้เกิดจากตัวอ่านที่บั๊ก)
-- ⚠️ ไม่แตะ status: ใบที่หัวหน้ากด "เตรียมของแล้ว" ไปแล้วต้องคงสถานะเดิม แค่ย้ายวันให้ถูก
update public.customer_shipping_orders
   set due_date = (due_date - interval '543 years')::date
 where source = 'esmart' and extract(year from due_date) >= 2400;

/* ══ ตรวจหลังรัน — ทั้ง 3 ตารางต้องได้ 0 แถว ════════════════════════════════════════
select count(*) from public.customer_pull_batches   where extract(year from work_date) >= 2400;
select count(*) from public.customer_pull_signals   where extract(year from pulled_at) >= 2400;
select count(*) from public.customer_shipping_orders where source='esmart' and extract(year from due_date) >= 2400;

   ══ ROLLBACK ═══════════════════════════════════════════════════════════════════
   ① index กลับเป็นแบบเดิม (ไม่แนะนำ — เป็นตัวที่ทำให้บันทึกไม่ติด):
      drop index if exists public.customer_pull_signals_dedup_idx;
      create unique index customer_pull_signals_dedup_idx on public.customer_pull_signals
        (source, ship_to, coalesce(supplier_ref, customer_part_no), pulled_at);
   ② ย้อนวันที่ (บวก 543 กลับ) — **ไม่แนะนำ** ปีนั้นไม่มีอยู่จริงในทางธุรกิจ
      ถ้าจำเป็นให้เลือกเฉพาะ id ที่ต้องการ ไม่ใช่ update ทั้งชุด
══════════════════════════════════════════════════════════════════════════════════ */
