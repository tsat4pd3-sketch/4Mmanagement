/*  ═══════════════════════════════════════════════════════════════════════════════════════
    BACKFILL — กะที่ "ผลิตของดีไม่ได้เลย แต่มีของเสีย" ต้องได้ %Q = 0 ไม่ใช่ 100
    project: DR / "Product DB"  (eyhclzkifitbhbljgoav)          วันที่: 2026-09-17
    ═══════════════════════════════════════════════════════════════════════════════════════

    ต้นเหตุ (แก้ในโค้ดแล้ว — computeOEE ใน DailyReport.jsx):
      const Q = totalProduced > 0 ? totalProduced / (totalProduced + ngQty) : 1;
                                                                             ^^^ ← ตรงนี้
      ⇒ กะที่ **ทำออกมาเสียล้วน ไม่มีของดีสักชิ้น** ถูก stamp %Q = 100.00 (กลับหัวกับความจริง)
      เคสหนักสุด: LASER EXPORT 08/07 กะดึก — ของดี 0 ชิ้น ของเสีย 32 ชิ้น ⇒ stamp Q = 100.00

    แก้เป็น: ของดี 0 + ของเสีย > 0 → Q = 0 (วัดได้จริง)
             ของดี 0 + ของเสีย 0   → null (ไม่มีอะไรให้ประเมิน ห้ามให้เลขไปถ่วงค่าเฉลี่ย)
    หลักเดียวกับ %A/%P ที่โปรเจคยึดอยู่แล้ว: **"0" กับ "ยังไม่รู้" คนละเรื่อง ห้ามปนกัน**

    ขอบเขต: 17 กะ (03/07–15/07) · ทุกกะ actual_qty = 0 และมีของเสียที่ไม่ใช่งานทดลอง
    · `oee_p` กับ `oee` ของทั้ง 17 กะเป็น null อยู่แล้ว (ไม่มียอดผลิต → คำนวณ %P ไม่ได้)
      ⇒ **migration นี้แตะแค่ `oee_q` คอลัมน์เดียว** · %A ไม่แตะ (ยังตอบได้ ไม่ต้องใช้ยอดผลิต)
    · ไม่ต้องใช้ CT เลย ⇒ พิสูจน์ได้ 100% ไม่เหมือน backfill %P (ดู 20260917_oee_imported_qty_backfill_dr.sql)

    ── ROLLBACK ────────────────────────────────────────────────────────────────────────────
      update production_sessions ps set oee_q = b.old_q
        from oee_q_zero_output_backfill_20260917 b where b.session_id = ps.id;
    ═══════════════════════════════════════════════════════════════════════════════════════ */

begin;

create table if not exists oee_q_zero_output_backfill_20260917 (
  session_id    uuid primary key,
  old_q         numeric,
  new_q         numeric,
  ng_nontrial   integer,     -- ของเสียที่ไม่ใช่งานทดลอง (ตัวที่ทำให้ Q ต้องเป็น 0)
  backfilled_at timestamptz not null default now()
);

insert into oee_q_zero_output_backfill_20260917 (session_id, old_q, new_q, ng_nontrial)
select s.id, s.oee_q, 0,
       (select coalesce(sum(coalesce(d.qty_ng,0) + coalesce(d.qty_suspect,0)), 0)
          from defect_logs d
         where d.session_id = s.id and not coalesce(d.is_trial, false))
  from production_sessions s
 where s.status = 'closed'
   and coalesce(s.actual_qty, 0) = 0
   and s.oee_q = 100
   and exists (select 1 from defect_logs d
                where d.session_id = s.id and not coalesce(d.is_trial, false)
                  and coalesce(d.qty_ng,0) + coalesce(d.qty_suspect,0) > 0)
on conflict (session_id) do nothing;

update production_sessions ps
   set oee_q = b.new_q
  from oee_q_zero_output_backfill_20260917 b
 where b.session_id = ps.id
   and ps.status = 'closed';

commit;

/* ── ตรวจผลหลังรัน ─────────────────────────────────────────────────────────────────────
select count(*) as แก้แล้ว, sum(ng_nontrial) as ของเสียรวม
  from oee_q_zero_output_backfill_20260917;

-- ต้องไม่เหลือกะไหนที่ "ของดี 0 + มีของเสีย" แล้วยังได้ %Q = 100
select count(*) as ต้องเป็นศูนย์ from production_sessions s
 where s.status='closed' and coalesce(s.actual_qty,0)=0 and s.oee_q = 100
   and exists (select 1 from defect_logs d where d.session_id=s.id and not coalesce(d.is_trial,false)
                 and coalesce(d.qty_ng,0)+coalesce(d.qty_suspect,0) > 0);
─────────────────────────────────────────────────────────────────────────────────────── */
