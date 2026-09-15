/* ═══════════════════════════════════════════════════════════════════════════
   Backfill เวลา "รับงาน / ซ่อมเสร็จ" จากใบ MO → ใบหยุดเครื่อง (downtime_logs)
   (DR project — eyhclzkifitbhbljgoav "Product DB")                2026-09-15

   ที่มา: user จะประชุมกับทีมช่างเรื่อง "รับงานก่อน ค่อยซ่อม เพื่อให้เห็น MTTA"
   และจะเปิดจอโชว์ตอนประชุม ⇒ ต้องมีข้อมูลย้อนหลังให้เห็นภาพก่อน

   ปัญหาเดิม: `downtime_logs.call_mtn_ack_at` **ไม่เคยถูกเขียนเลยสักแถว** (0/8,429)
   ทั้งที่ใบ MO เก็บเวลาไว้ครบอยู่แล้ว (90 วัน: accept_at 304 · repair_done_at 298
   · ผูกกับ downtime ผ่าน source_downtime_id 238 ใบ) — แค่ไม่เคยส่งค่ากลับ
   ⇒ แท็บ ⚙️ รายอุปกรณ์ แยก "รอช่าง (MTTA) vs ซ่อมจริง" ไม่ได้เลย

   โค้ดฝั่งแอปส่งเวลากลับให้แล้วตั้งแต่ 14/09 (MtnRepair ขั้น 2 และ 3 → syncDowntimeTimes)
   ไฟล์นี้เติมของเก่าย้อนหลังครั้งเดียว

   กติกา:
   • เติมเฉพาะช่องที่ยังว่าง (`is null`) — ค่าที่หน้างานกดเองจริงชนะเสมอ
   • 1 downtime อาจมีหลายใบ MO (เปิดซ้ำ) → เอาใบที่รับงานก่อนสุด (distinct on + order)
   • **ไม่กรองว่าเวลาอยู่ในช่วง started_at..ended_at หรือไม่** — เก็บตามที่กดจริง
     แล้วให้ `repairPhases()` ฝั่งแอปเป็นคนตัดแถวที่เวลาไม่เรียงออกเอง (ห้ามซ่อมข้อมูลให้สวย)
   • ใบที่กดทุกสเต็ปรวดเดียวตอนปิดงาน (ซ่อมจริง < 2 นาที) จะถูกติดธง oneShot ฝั่งแอป
     และ**ไม่ถูกนำมาเฉลี่ย** แต่ยังโชว์จำนวนบนจอ

   ย้อนกลับ: update downtime_logs set call_mtn_ack_at = null, fix_at = null
             where id in (...) — ไม่จำเป็น เพราะเติมเฉพาะช่องว่าง
   ═══════════════════════════════════════════════════════════════════════════ */

with pick as (
  select distinct on (o.source_downtime_id)
         o.source_downtime_id as dt_id, o.accept_at, o.report_at
    from mtn_orders o
   where o.source_downtime_id is not null and o.accept_at is not null
   order by o.source_downtime_id, o.accept_at
)
update downtime_logs d
   set call_mtn_ack_at = pick.accept_at,
       call_mtn        = true,
       call_mtn_at     = coalesce(d.call_mtn_at, pick.report_at)
  from pick
 where d.id = pick.dt_id
   and d.call_mtn_ack_at is null;

with pick as (
  select distinct on (o.source_downtime_id)
         o.source_downtime_id as dt_id, o.repair_done_at
    from mtn_orders o
   where o.source_downtime_id is not null and o.repair_done_at is not null
   order by o.source_downtime_id, o.repair_done_at
)
update downtime_logs d
   set fix_at = pick.repair_done_at
  from pick
 where d.id = pick.dt_id
   and d.fix_at is null;
