# ROLLBACK — backfill ยอดผลิต + %P/%Q/OEE ของ 34 กะที่ `actual_qty` ไม่ตรงใบผลิต (2026-10-12)

**ฝั่ง:** DR project — ชื่อในจอ Supabase **"Product DB"** · `eyhclzkifitbhbljgoav`
**ตาราง:** `public.production_sessions` · คอลัมน์ `actual_qty` · `qty_ok` · `oee_p` · `oee_q` · `oee`
**ไม่แตะ:** `oee_a` (ไม่ขึ้นกับยอด) · `shift_min` · `ct_snapshot` · `qty_ng/suspect/repair` · ใบผลิต/downtime/ของเสีย

## ทำอะไร · ทำไม

34 กะ (01/07 – 05/10/2026) มี `actual_qty` ไม่ตรงผลรวมใบผลิต เพราะใบถูกแก้ยอดหลังปิดกะ
แล้วมีคนกด "แก้เวลากะ + คำนวณ OEE ใหม่" ซึ่ง**รุ่นก่อน 12/10 ไม่ re-stamp ยอด** ⇒ แถวขัดแย้งกันเอง
(ยอด 1,000 แต่ %P คิดจาก 1,100) · โค้ดถูกแก้แล้ว (`oee-restamp-needs-qty`) แต่แถวเก่าไม่ย้อนให้

## วิธีคิดค่าใหม่ — **ห้ามใช้ CT จาก master ปัจจุบัน** (ENGINEERING-PRINCIPLES §7)

- `actual_qty` = `qty_ok` = Σ ใบผลิตด้วย `sessionProducedQty()` (ข้อเท็จจริง ไม่พึ่ง master)
- **%A ไม่แตะ** — ไม่ขึ้นกับยอด
- **%P สเกลจากค่าที่ stamp ไว้เอง** `P_new = min(100, P_old × shots_new / shots_old)`
  · `shots` ไม่ใช่ "ชิ้น" — ยุบคู่ RH/LH ด้วย **`collapsePairShots()` ตัวจริงจาก `utils/pairTotals.js`**
  · `shots_old` = คู่ RH/LH → ยอดเดิม ÷ 2 · MAT เดียว (หรือหลาย MAT ที่ CT เท่ากันทุกตัวตาม `ct_snapshot`) → ยอดเดิม
  · ใช้ได้เฉพาะเมื่อ **CT เท่ากันทุก MAT ในกะนั้น** ⇒ CT ตัดกันในอัตราส่วน = ไม่ต้องรู้ค่า CT เลย
- **%Q ถอด "ของเสียที่เข้า %Q จริง" ออกจากค่า Q เดิม** (`ngQ = total_old × (1 − Q_old)`) แล้วคิดบนยอดใหม่
  🔴 **ห้ามคิดจาก `qty_ng` ดิบ** — 08/09 LASER-789 `qty_ng`=1 แต่ Q ที่ stamp = 100 เป๊ะ
  (ของเสียใบนั้นถูกกันออกจาก %Q — งานทดลอง/`excl_from_q`) คิดจาก `qty_ng` จะได้ 99.9 = ผิด
- `OEE_new = A × P_new × Q_new`

**2 กะที่คิด %P ใหม่ไม่ได้ — แก้เฉพาะยอด คง OEE เดิมไว้:**
- `2026-07-01 LINE APRON ASSY กะดึก` — ยอดเดิม **0** ⇒ หาอัตราส่วนไม่ได้ (0→596)
- `2026-08-03 Line 61 กะดึก` — 2 MAT ที่ไม่ใช่คู่ RH/LH และไม่มี `ct_snapshot` ⇒ ไม่รู้ CT รายตัว (361→363)

⚠️ **2 กะที่ค่าลดลง** (ยอดเดิมสูงกว่าใบผลิต — น่าจะมีใบถูกลบทีหลัง):
`14/08 Assy LWR` 249→245 ชิ้น · OEE 100 → 98.39 · `14/08 LASER EXPORT` 501→450 ชิ้น · OEE 72.88 → 65.46

## วิธีย้อน (คืนค่าเดิมทั้ง 34 แถว — รันใน SQL Editor ของ **"Product DB"**)

```sql
update production_sessions as s
set actual_qty = v.aq, qty_ok = v.aq, oee_p = v.p, oee_q = v.q, oee = v.oee
from (values
  ('e2fb9e72-15ea-4005-8d04-e070f5a0e854'::uuid, 0, 89.88, 100, 77.48),
  ('dd9b1e10-cbf4-4ee6-aba9-8ff5dff229f0'::uuid, 433, 94.7, 100, 77.28),
  ('b1c8d903-5346-4168-a9e8-164c51348e0b'::uuid, 361, 91.83, 100, 73.95),
  ('11ddc85a-c22b-4a22-8d6e-b095bce67fc7'::uuid, 249, 100, 100, 100),
  ('b0cfd511-24c3-4c4f-a91e-2b0ccc43ea2b'::uuid, 501, 79.52, 100, 72.88),
  ('958f6758-3006-4ce3-8b17-bbee4c4ca463'::uuid, 1000, 87.17, 100, 87.17),
  ('791b7e3e-1b91-4661-b278-d5e1c4d20e91'::uuid, 1000, 90.78, 100, 90.78),
  ('f9a2de8a-8c0b-4cc4-b22b-dc9826a40ec9'::uuid, 1000, 85.42, 99.9, 84.14),
  ('b3caecf6-1de6-41de-91f5-223062ed494c'::uuid, 500, 68.18, 100, 68.18),
  ('6738dcd7-056b-41ce-8498-5b0b4cc352da'::uuid, 1000, 84.85, 99.9, 84.77),
  ('1a918b27-b42d-4726-898e-ec21767e0228'::uuid, 1000, 88.28, 100, 88.28),
  ('9933643b-edce-4dc2-bd65-7fb26ed0c1b8'::uuid, 1000, 78.51, 100, 77.11),
  ('13bc7195-1188-4e09-9584-f1acc5a23720'::uuid, 1000, 95.21, 100, 91.25),
  ('b1de4e64-da5d-4da9-81aa-268522b20a0a'::uuid, 1000, 85.19, 99.9, 71.9),
  ('69fb22f3-4dd4-482b-b81e-040cd0cc4e9e'::uuid, 1000, 87.72, 100, 71.84),
  ('68e5b78d-64aa-436f-8b56-e07d63ae1cb4'::uuid, 1000, 77.64, 100, 73.11),
  ('e1f8d485-538c-4aad-8a82-a87c4427229a'::uuid, 1000, 94.09, 100, 89.08),
  ('2740db0d-b5c1-4cf3-991f-42f6d60118b2'::uuid, 1000, 100, 100, 80.17),
  ('0172e06d-6b1c-4a7f-a8f0-4938b575b832'::uuid, 1000, 100, 100, 83.1),
  ('0581de0d-b963-4ea4-8077-6a5fd30b1cbe'::uuid, 1000, 94.28, 100, 91.25),
  ('dede3fb6-f4c2-4739-adb4-f8f1b4dcb5b5'::uuid, 1000, 100, 100, 87.93),
  ('244f4320-4ea3-4ebd-b22e-c397ae073a8e'::uuid, 1000, 100, 100, 85.34),
  ('4c9587e0-6b6d-422c-ae49-e2fd6867520c'::uuid, 1000, 90.43, 100, 81.46),
  ('b2c77cf6-2075-4cc1-a66a-ea37877cf0c6'::uuid, 1000, 100, 100, 87.29),
  ('f6ae9117-62c4-454c-8c46-783a35410140'::uuid, 1000, 100, 100, 84.07),
  ('555e7971-4ec9-4172-84c5-13ad78f03a77'::uuid, 450, 100, 100, 100),
  ('7e1f6599-b5e0-4977-b5ce-4b0eb448a229'::uuid, 1000, 73.77, 100, 71.38),
  ('a99605be-987b-432e-ba6b-f0e08a964e84'::uuid, 424, 88.74, 100, 73.97),
  ('ac581a6c-af99-4516-aa00-a76b6555598b'::uuid, 1000, 79.62, 100, 76.95),
  ('042301f0-7c7e-4861-983f-88f6b26e394e'::uuid, 1000, 95.35, 100, 70.62),
  ('560eee45-cdfd-4028-8b43-9ced7e439acb'::uuid, 357, 97.51, 100, 97.51),
  ('ace6bbec-6456-421d-a1e9-4567c9aafeb0'::uuid, 800, 90.09, 100, 70.92),
  ('c7d7afe7-c180-4010-b442-2aad20e1f042'::uuid, 800, 93.56, 100, 91.65),
  ('7b2dfa1d-cc33-441f-a686-23eb1f5c46e8'::uuid, 350, 63.87, 100, 58.33)
) as v(id, aq, p, q, oee)
where s.id = v.id;
```

## คิวรีเช็คผล (รันใน "Product DB")

```sql
select count(*) rows_left
from production_sessions s
where s.status = 'closed'
  and coalesce(s.actual_qty,0) <> coalesce((
        select sum(case when p.status='confirmed' then coalesce(p.qty_ok,p.qty,0)
                        else coalesce(p.qty_actual,0) end)
        from prod_orders p where p.session_id = s.id), 0);
-- หลัง backfill ต้องได้ 0 · หลัง rollback ต้องได้ 34
```

📄 ที่มา + วิธีคิด → `docs/modules/oee.md` §"ยอดผลิตของกะ" มีสูตรเดียว
📄 รอบก่อนหน้า (คอลัมน์ `qty_ok`) → `docs/ROLLBACK_20261012_qty_ok_backfill.md`
