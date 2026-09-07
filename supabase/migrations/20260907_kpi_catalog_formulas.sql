-- ══ ทะเบียน KPI: เติมสูตร/หน่วย/ที่มา ตามคำตอบ user 2026-09-07 (Main) ══
-- ที่มา: user ตอบคำถามจาก docs/OBEYA-KPI-SOURCES.md §5.5 หลังอ่านฟอร์ม KPI Evaluation ของบริษัท
--   1. PPM        = งานเสีย ÷ ยอดที่ผลิต            (ระบบ: ยอดที่ผลิตทั้งหมด = สแกนดี + เสีย — สูตรเดิมไม่เปลี่ยน)
--   2. DL / OH    = ต้นทุนแรงงาน / ค่าโสหุ้ย ÷ Sale from product   (กรอกมือ — บัญชี/SAP)
--   3. CSAT       = คะแนนที่ได้จากลูกค้า              (กรอกมือ)
--   4. Safety     = คะแนน/สรุปจากหน่วยงานความปลอดภัย   (กรอกมือ · safety_events = บันทึกหน้างานประกอบ)
--   5. Inventory  = มูลค่าสต็อกคงคลัง (บาท) จาก monthly report ของบัญชี (กรอกมือ)
-- กติกา:
--   · เติมเฉพาะแถวที่ formula_text ยัง null — แถวที่ doc_control/ผู้ใช้แก้เองแล้ว ไม่ทับ (backward-compatible)
--   · unit เติมเฉพาะเมื่อยัง null · direction ไม่แตะ (ตั้งไว้แล้วตอน seed 20260901_kpi_line_group.sql)
--   · Training ยังไม่รู้นิยาม (ใบใช้ "TS Academy" % สะสมผ่านอบรม — รอ user ยืนยัน) → ไม่เติม
--   · ไม่มี DDL — รันซ้ำได้ (idempotent) · rollback = ไม่จำเป็น (ค่าเดิมคือ null)

update public.kpi_catalog c
set formula_text = coalesce(c.formula_text, v.formula_text),
    scope_text   = case when c.scope_text is null or c.scope_text like 'บอร์ด OBEYA —%' or c.scope_text like 'ระบบคำนวณให้%'
                        then v.scope_text else c.scope_text end,
    unit         = coalesce(c.unit, v.unit)
from (values
  ('Direct Labor',          'ต้นทุนแรงงานทางตรง ÷ ยอดขายจากสินค้า (Sale from product) × 100', '%',   'กรอกมือ — ข้อมูลจากบัญชี/SAP (Data from SAP)'),
  ('Overhead',              'ค่าโสหุ้ย ÷ ยอดขายจากสินค้า (Sale from product) × 100',          '%',   'กรอกมือ — ข้อมูลจากบัญชี/SAP (Data from SAP)'),
  ('Inventory Balance',     'มูลค่าสต็อกคงคลัง (บาท) ตาม monthly report ของบัญชี',            'บาท', 'กรอกมือ — บัญชีสรุปส่ง monthly report ทุกเดือน'),
  ('Customer Satisfaction', 'คะแนนความพึงพอใจที่ได้รับจากลูกค้า (%)',                          '%',   'กรอกมือ — คะแนนจากลูกค้า'),
  ('OEE',                   'OEE กะที่ปิดแล้ว ถ่วงน้ำหนักด้วยเวลารับภาระ (wavg · A×P×Q)',        '%',   'ระบบคำนวณให้จากกะที่ปิดแล้ว · เป้าจากทะเบียนเป้า OEE (oee_targets)'),
  ('PPM',                   'ของเสีย ÷ ยอดที่ผลิตทั้งหมด (สแกนดี + เสีย) × 1,000,000 · ไม่รวมงานทดลอง', 'PPM', 'ระบบคำนวณให้จาก defect_logs (line-mode)'),
  ('Safety',                'คะแนน/สรุปเหตุการณ์ความปลอดภัยประจำเดือน จากหน่วยงานความปลอดภัย',  null,  'กรอกมือ — สรุปจากหน่วยงานความปลอดภัย · บันทึกหน้างานใน /obeya (safety_events) เป็นข้อมูลประกอบ')
) as v(name, formula_text, unit, scope_text)
where lower(btrim(c.name)) = lower(btrim(v.name));

-- ตรวจผล: ควรเห็น formula_text ครบ 7 แถว (Training ยัง null โดยตั้งใจ)
-- select name, unit, formula_text, scope_text from public.kpi_catalog order by sort_order;
