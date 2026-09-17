# OJT — ใบแจ้งการอบรมสอนงาน FM-HRM-004 (paperless · 2026-07-20)

> แยกออกจาก `CLAUDE.md` 2026-09-16 (ด่าน context เต็ม 120 KB) · โหลด**เฉพาะเมื่อแตะโมดูลนี้**
> แก้ไฟล์นี้แทน CLAUDE.md เมื่อกฎของโมดูลเปลี่ยน

| Table | คำอธิบาย | Fields สำคัญ |
|-------|---------|-------------|
| `ojt_trainings` | หัวใบอบรม OJT (หน้า `/ojt-training` · migration `20260714_ojt_training.sql`) | train_date, time_from/to, location, dept/section/department, for_new/for_review/for_method_change, topic, scope, trainer_name, duration_min, maker/approver/hr (name+sig_url — เลือกจาก profiles ที่มี signature_url), status (open/completed) |
| `ojt_training_attendees` | ผู้เข้าอบรมต่อใบ (snapshot ชื่อ/รหัส กัน master เปลี่ยน) | training_id (FK cascade), employee_id, emp_code/emp_name, pre_score/post_score (0-4), sign_url (เซ็นบนจอ → bucket `signatures` path ของ user ที่บันทึก), eval_agree, evaluator_name, sort_order |
