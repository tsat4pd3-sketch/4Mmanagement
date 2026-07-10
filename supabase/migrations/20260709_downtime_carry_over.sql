-- DR project (eyhclzkifitbhbljgoav): Downtime ตัดยอดข้ามกะ
-- เคสเครื่องยังซ่อมไม่เสร็จตอนปิดกะ: รายการของกะนี้ถูกปิดด้วยเวลาปิดกะ (carry_over = true)
-- แล้วกะถัดไปของไลน์เดียวกันสร้างรายการต่อเนื่องอัตโนมัติ (carried_from_id ชี้กลับรายการเดิม)
-- หมายเหตุ: เพิ่มคอลัมน์อย่างเดียว ไม่แตะ RLS policy (ตารางนี้ client อ่านผ่าน anon เสมอ — ดู CLAUDE.md)

ALTER TABLE downtime_logs
  ADD COLUMN IF NOT EXISTS carry_over boolean NOT NULL DEFAULT false;

ALTER TABLE downtime_logs
  ADD COLUMN IF NOT EXISTS carried_from_id uuid REFERENCES downtime_logs(id) ON DELETE SET NULL;

-- ใช้ตอนเปิดกะใหม่: หา Downtime ที่ตัดยอดไว้และยังไม่มีรายการต่อเนื่อง
CREATE INDEX IF NOT EXISTS idx_downtime_logs_carry_over ON downtime_logs (session_id) WHERE carry_over = true;
CREATE INDEX IF NOT EXISTS idx_downtime_logs_carried_from ON downtime_logs (carried_from_id) WHERE carried_from_id IS NOT NULL;
