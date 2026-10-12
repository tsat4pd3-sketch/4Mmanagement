/* ══ ทำโมฆะกะที่เปิดผิด: LINE C ( 200&250 Ton ) · work_date 2026-10-05 · กะดึก 07:40 ══
   project: DR "Product DB" (eyhclzkifitbhbljgoav)

   ทำไม (วัดจริง 12/10):
     กะนี้ถูกเปิดเป็น "กะดึก start_time 07:40" (created_at 2026-10-05 00:40:59Z = 07:40 ไทย
     คือ 20 นาทีก่อนกะเช้า) แล้วปิดอีก 1 นาทีต่อมา ⇒ `shift_min = 1`
     · ใบผลิต 0 · downtime 0 · ของเสีย 0 · qty_ok 0 · `oee_*` null ทั้งแถว
     = เปิดผิดแล้วปิดทิ้ง ไม่ใช่กะจริง แต่ยังถูกนับเป็น "วันที่มีการผลิต" ของไลน์นั้น

   วิธี: `status = 'void'` + เหตุผล (เก็บประวัติไว้ ห้าม delete — กฎ sessionStatus.js)
     · ด่านฝั่ง DB (trigger `trg_session_void_guard`) จะ raise เองถ้ากะมีข้อมูล ⇒ ที่นี่ไม่ต้องเช็คซ้ำ
       แต่ยังใส่เงื่อนไขในคำสั่งไว้ให้ migration นี้ปลอดภัยต่อการรันซ้ำ/รันผิดแถว
     · `voided_at` trigger เติมเอง

   🔁 rollback (ปลอดภัย ย้อนได้เต็ม — ไม่มีคอลัมน์/ตารางถูกเปลี่ยนโครงสร้าง):
     update public.production_sessions
        set status = 'closed', void_reason = null, voided_at = null
      where id = 'e7700b2c-3b1e-403c-bc23-d67963a4280d' and status = 'void';
   ═══════════════════════════════════════════════════════════════════════════════ */

update public.production_sessions s
   set status      = 'void',
       void_reason = 'เปิดผิด: ตั้งเป็นกะดึก start_time 07:40 (ก่อนกะเช้า 20 นาที) แล้วปิดทันทีใน 1 นาที · ไม่มีใบผลิต/downtime/ของเสีย/ยอดผลิตเลย — ทำโมฆะ 2026-10-12 (เก็บแถวไว้เป็นประวัติ)'
 where s.id = 'e7700b2c-3b1e-403c-bc23-d67963a4280d'
   and s.status = 'closed'
   and s.shift_min <= 1
   and coalesce(s.qty_ok, 0) = 0
   and coalesce(s.actual_qty, 0) = 0
   and not exists (select 1 from public.prod_orders   o where o.session_id = s.id)
   and not exists (select 1 from public.downtime_logs d where d.session_id = s.id)
   and not exists (select 1 from public.defect_logs   f where f.session_id = s.id);
