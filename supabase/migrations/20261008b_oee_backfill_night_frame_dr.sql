/* ══════════════════════════════════════════════════════════════════════════════════════════
   DR project — "Product DB" (eyhclzkifitbhbljgoav)
   Backfill ค่า OEE ของกะที่ **เลขเปลี่ยนจริง** หลังแก้กรอบกะ (ต่อจาก 20261008_night_shift_frame…)

   🔴 กฎที่ยังยืนอยู่: "ค่าที่ stamp ตอนปิดกะคือความจริงสูงสุดของกะที่ปิดแล้ว —
      ห้ามคำนวณใหม่ด้วย master ปัจจุบัน" (`docs/modules/oee.md`)
      ⇒ ปกติห้าม backfill เพราะ CT/นโยบายพัก/flow_mode ดริฟท์ = ได้เลขที่ไม่เคยมีใครเห็น

   ✅ ทำไมกะนี้ทำได้: **พิสูจน์แล้วว่า master ไม่ดริฟท์** — จำลองกรอบกะแบบเก่า
      (เลื่อน work_date ถอย 1 วัน ⇒ `shiftStartDate()` คืนกรอบเดิมเป๊ะ) แล้วรัน
      `computeSessionOee` ตัวจริง **ทำซ้ำค่าที่ stamp ไว้ได้ทั้ง A และ P ที่ทศนิยม 2 ตำแหน่ง**
      ⇒ ส่วนต่างที่เหลือมาจาก "กรอบกะผิด" ข้างเดียว ไม่ใช่ master ⇒ แก้ได้แบบพิสูจน์ได้

   กะเดียวที่เข้าเงื่อนไข — Assy LWR 25/09 (3585b77f) :
     เดิม A 83.33 = 275/330 เป๊ะ = **ทาง fallback ระดับกะ** เพราะกรอบกะเก่า (25/09 00:30-08:00)
     ไม่คลุม `confirmed_at` ของใบใดเลย (ของจริงอยู่ 26/09 02:34-07:22) ⇒ หน้าต่าง MAT หลุดหมด
     `totalNetAvailByMat = 0` ⇒ ตกไปใช้ `runMin/netAvail`
     กรอบที่ถูก ⇒ ทาง per-MAT (`oee.js` บรรทัด 1273) ทำงานตามที่ออกแบบ ⇒ **A 82.16**
     P/Q ไม่ขยับ (91.31 / 100)
   ══════════════════════════════════════════════════════════════════════════════════════════ */

create table if not exists archive.fix_20261008b_oee_backfill (
  session_id uuid primary key,
  old_oee_a numeric, old_oee_p numeric, old_oee_q numeric, old_oee numeric,
  new_oee_a numeric, new_oee_p numeric, new_oee_q numeric, new_oee numeric,
  fixed_at  timestamptz not null default now()
);
alter table archive.fix_20261008b_oee_backfill enable row level security;
comment on table archive.fix_20261008b_oee_backfill is
  'ค่า OEE ก่อน backfill ของ migration 20261008b (กรอบกะดึกผิด) — ใช้ย้อนกลับ';

insert into archive.fix_20261008b_oee_backfill
  (session_id, old_oee_a, old_oee_p, old_oee_q, old_oee, new_oee_a, new_oee_p, new_oee_q, new_oee)
select s.id, s.oee_a, s.oee_p, s.oee_q, s.oee, 82.16, 91.31, 100.00, 75.02
from public.production_sessions s
where s.id = '3585b77f-1d68-4981-a1a8-e27354414cfa'
  and s.oee_a = 83.33            -- ยังไม่เคย backfill (รันซ้ำ = ไม่เข้า)
on conflict do nothing;

update public.production_sessions s
   set oee_a = r.new_oee_a, oee_p = r.new_oee_p, oee_q = r.new_oee_q, oee = r.new_oee
  from archive.fix_20261008b_oee_backfill r
 where s.id = r.session_id and s.oee_a = r.old_oee_a and s.oee = r.old_oee;

/* ══════════════════════════════════════════════════════════════════════════════════════════
   §กะที่ตั้งใจ **ไม่** backfill

   🚫 **Laser LWR 30/09 (560eee45) — stamp P 97.51 · คำนวณใหม่ได้ 100.00 — ห้ามเขียนทับ**
      ส่วนต่างนี้ **ไม่ได้มาจากบั๊กกรอบกะ**: จำลองกรอบกะแบบเก่าก็ยังได้ 100.00
      ต้นเหตุคือใบ `ec420e98` (13 ชิ้น) ที่ **เปิด+คอนเฟิร์มวันที่ 07/10** คือกรอกย้อนหลัง
      *หลังปิดกะไปแล้ว* ⇒ ตอนปิดกะมี 357 ชิ้น · วันนี้มี 370 ⇒ เขียน 100.00 ลงไป
      = "คำนวณกะที่ปิดแล้วใหม่ด้วยข้อมูลปัจจุบัน" = ผิดกฎตรงๆ · ของเดิมคือความจริงของกะนั้น

   ✅ Laser GOR 23/09 · Assy LWR 30/09 — คำนวณใหม่ได้เท่าเดิมทุกตัว ⇒ ไม่ต้องแตะ
   ✅ LINE C 05/10 — `shift_min=1` · `oee_*` null ทั้งแถว (กะเปิดผิดแล้วปิดทิ้ง) ⇒ ไม่มีอะไรให้แก้

   §วิธีย้อนกลับ (DR — "Product DB")
     update public.production_sessions s
        set oee_a=r.old_oee_a, oee_p=r.old_oee_p, oee_q=r.old_oee_q, oee=r.old_oee
       from archive.fix_20261008b_oee_backfill r
      where s.id=r.session_id and s.oee_a=r.new_oee_a;
   ══════════════════════════════════════════════════════════════════════════════════════════ */
