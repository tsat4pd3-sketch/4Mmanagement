-- 📸 snapshot นโยบายพักที่ใช้คิด %A/%P ตอนปิดกะ — project: DR ("Product DB" · eyhclzkifitbhbljgoav)
-- เหตุ (11/11): %A/%P ที่ stamp ไว้คิดจากทะเบียนที่แก้ได้ภายหลัง (break_policies · break_line_rules ·
--   ปฏิทินวันหยุด · process_type ของไลน์) ⇒ กดคำนวณใหม่คนละวันได้เลขไม่เท่าเดิม
--   เคสจริง: restamp 5 กะ มิ.ย.-ก.ย. (10/11) ไม่มีกะไหนได้ค่าเดิม เพราะนโยบายพักถูกแก้ 20/10 + 05/11
--   ⇒ ออดิทเทียบ "เลขที่เก็บ" กับ "เลขที่คำนวณได้" ไม่ตรง = เสียความน่าเชื่อถือทั้งระบบ
-- กติกา: เก็บ **input ไม่ใช่ผลลัพธ์** (เก็บช่วงพักสำเร็จรูป = แก้เวลาเริ่ม/เลิกกะแล้วคิดใหม่ไม่ได้)
-- 🔴 nullable ไม่มี default ⇒ กะที่ปิดไปแล้ว = null = ถอยไปอ่านทะเบียนสดเหมือนเดิมเป๊ะ (ย้อนได้)
-- เจ้าของกฎฝั่งโค้ด: src/utils/oee.js §snapshot (makeBreakSnapshot / readBreakSnapshot)
alter table public.production_sessions
  add column if not exists break_snapshot jsonb;

comment on column public.production_sessions.break_snapshot is
  '📸 นโยบายพัก+กฎพักรายไลน์+process_type ที่ใช้คิด %A/%P ตอนปิดกะ (oee.js makeBreakSnapshot · v1) · null = กะเก่าก่อน 11/11 ⇒ คำนวณใหม่ใช้ทะเบียนสด';

notify pgrst, 'reload schema';
