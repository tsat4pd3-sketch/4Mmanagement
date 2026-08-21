-- ══ QA FME — ด่านความสมเหตุสมผลของคาบตรวจ Middle ════════════════════════════════
-- Target project: MAIN (ewhdfqwfwofivojtsizn) · ต้องรันหลัง 20260820_qa_fme_middle_by_lot.sql
--
-- ที่มา (dry-run จริง 2026-08-21): พาร์ท FG หลายตัวตั้ง `kanban_standards.lot_size = 1`
-- ซึ่งเป็นค่า placeholder ไม่ใช่ขนาดล็อตจริง → คาบตรวจ Middle = 1 ชิ้น
-- = เรียก QA ทุกชิ้นจนชนเพดาน `mid_max_per_run` ทุกรอบ
-- วัดจริง: 4 พาร์ท (20058498 · 10100385 · 10100401 · 10100335) สร้างงานตรวจ 46 จาก 91 รายการ
--
-- กติกา: คาบที่คำนวณได้ **ต่ำกว่า mid_min_pcs = ถือว่า master ยังใช้ไม่ได้**
--   → ไม่ตั้ง Middle ให้พาร์ทนั้น แล้วรายงานออกมาใน `middle_lot_too_small` พร้อมค่าที่คำนวณได้
--   (ห้ามเดาค่าแทนคน — "สั่งครั้งละกี่ชิ้น" เป็นการตัดสินใจของ planner · และห้ามเงียบ)
--
-- ⚠️ ไม่กระทบ override รายพาร์ท (`qa_fme_part_rules.mid_every_pcs`) — ค่านั้นคนตั้งเอง เชื่อตามนั้น
-- edge function อ่านแบบ `cfg.mid_min_pcs ?? 10` → ยังไม่รัน migration นี้ก็ทำงานได้ (ใช้ 10)

alter table qa_fme_config add column if not exists mid_min_pcs int not null default 10;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'qa_fme_config_mid_min_chk') then
    alter table qa_fme_config add constraint qa_fme_config_mid_min_chk
      check (mid_min_pcs between 1 and 10000);
  end if;
end $$;

comment on column qa_fme_config.mid_min_pcs is
  'คาบตรวจ Middle ที่คำนวณจาก lot_size ต่ำกว่าค่านี้ = ถือว่า master ยังตั้งไม่ถูก → ไม่ตั้ง Middle แล้วรายงานให้ไปแก้ (ตั้ง 1 = ยอมรับทุกค่า)';
