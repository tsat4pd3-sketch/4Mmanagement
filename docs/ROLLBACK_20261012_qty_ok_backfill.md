# ROLLBACK — backfill `production_sessions.qty_ok` ให้ตรง `actual_qty` (2026-10-12)

**ฝั่ง:** DR project — ชื่อในจอ Supabase **"Product DB"** · `eyhclzkifitbhbljgoav`
**ตาราง:** `public.production_sessions` · **คอลัมน์เดียว:** `qty_ok` (ไม่แตะ `actual_qty` / `qty_ng` / `oee*`)

## ทำอะไร

26 กะเก่า (25/06 – 03/08/2026) ถือ `qty_ok ≠ actual_qty` ซึ่งเป็นมรดกของกติกาเดิม
**"ยอดดี = ยอดผลิต − NG"** ที่ถูกเปลี่ยนไปเมื่อ **2026-08-02** เป็น
**"ยอดดี = ยอดผลิต"** (การ์ดที่สแกน = ของดีล้วน · NG คือของที่ผลิตเพิ่มต่างหาก ไม่หักซ้ำ)
⇒ โค้ดปัจจุบันเขียน `qty_ok = actual_qty` เสมอ (ทั้ง `handleCloseSession` และ `handleSaveTimes`)
แถวเก่าจึงเป็นนิยามคนละชุดกับทั้งปี · user สั่งให้ไล่แก้ให้ตรงกัน (12/10)

**ตรวจก่อนแก้:** ทั้ง 26 แถว `actual_qty` = Σ ใบผลิต (`sessionProducedQty` สูตรปัจจุบัน) **ตรงเป๊ะทุกแถว**
⇒ ตัวที่เพี้ยนคือ `qty_ok` อย่างเดียว · **ไม่กระทบ %Q/OEE** (Q มาจาก `defect_logs` ไม่ได้อ่าน `qty_ok`)

รูปแบบส่วนต่าง: 23 แถว `gap = qty_ng` พอดี (ตามกติกาเดิม) · 3 แถวเป็นค่าค้างอื่น
(25/06 HYDROFORM `qty_ok`=0 · 16/07 LASER-345 ดึก −56 · 03/08 Assy LWR −18)

## วิธีย้อน (คืนค่าเดิมทุกแถว — รันใน SQL Editor ของ "Product DB")

```sql
update production_sessions as s set qty_ok = v.old_ok
from (values
  ('cdc7e921-f784-4761-9e04-49ff1a0ac3b4'::uuid,   0),
  ('e046b517-b4ce-4a54-8d67-6e99725a2e4b'::uuid, 540),
  ('835bbca0-34d6-47fe-8a7c-89fefc752b93'::uuid, 548),
  ('e8f58c22-4b9d-4fb6-b4e3-57a78b770296'::uuid, 536),
  ('4a612bbe-a97c-4703-8bae-7ca2198a67ac'::uuid, 542),
  ('6cac17ad-afd3-44cf-8ca5-c074fc0af3c2'::uuid, 453),
  ('086753b9-45df-4196-9768-2e372c942ed3'::uuid, 188),
  ('8d090e68-d6a2-489f-8063-62051d6e5a0c'::uuid, 483),
  ('bd0cc711-1323-491f-b7fc-23c5a12f19bd'::uuid, 507),
  ('bb5cf3e8-56f9-4770-b365-f0f95e1cbdfe'::uuid, 495),
  ('f4642b60-9ebd-498c-b8fb-bf6cd710d245'::uuid, 379),
  ('69ab553b-0fc3-4ae4-b518-69c95740b146'::uuid, 498),
  ('c04a586d-e49a-4e56-9e46-bba2c82497f1'::uuid, 494),
  ('ab8e2c8b-2588-4c07-a9bc-66d56791350f'::uuid, 373),
  ('dd830d18-a254-4ca2-b049-7260eb429199'::uuid, 483),
  ('faef55ec-c51a-46c5-b9c7-700a684dfd97'::uuid, 498),
  ('637db242-1145-49df-99e7-e0322c314276'::uuid, 493),
  ('785aa549-34db-4c64-9f30-e045ca1b9a05'::uuid, 497),
  ('0a50afec-82c9-4dc0-b2e4-9b55fb6ff2ab'::uuid, 532),
  ('718b09f3-df6b-4220-9d29-be56dd7a71f4'::uuid, 485),
  ('200028ae-944a-4afa-9a6d-333455b1b95a'::uuid, 499),
  ('35a47303-e95e-41ef-bd82-75d1ef70c7f6'::uuid, 482),
  ('880b187c-048c-4dff-8952-e72d75908895'::uuid, 796),
  ('ff9b834f-f4c2-417a-9257-912c242d33c1'::uuid, 869),
  ('f0d065c9-bb00-44b2-8447-8899a1933891'::uuid, 261),
  ('1f00861a-0cb7-4681-9a11-b96bebd7af2a'::uuid, 325)
) as v(id, old_ok)
where s.id = v.id;
```

**แถวที่ 27 (แก้ไปก่อนหน้านี้ในรอบเดียวกัน):**
```sql
-- Line 60 · 02/09/2026 กะเช้า — ใบสุดท้ายค้างสถานะ imported ถือ qty_actual 8
update production_sessions set qty_ok = 454 where id = 'd90bb296-3359-4242-a559-01a8b6daefe0';
```

## คิวรีเช็คผล (รันใน "Product DB")

```sql
select count(*) rows_left
from production_sessions
where status in ('closed','pending_close') and coalesce(actual_qty,0) <> coalesce(qty_ok,0);
-- หลัง backfill ต้องได้ 0 · หลัง rollback ต้องได้ 27
```

📄 ที่มา + ตัวเลขเต็ม → `docs/modules/oee.md` §"ยอดผลิตของกะ" มีสูตรเดียว
