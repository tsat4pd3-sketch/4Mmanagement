-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- แยกมิติ "ตำแหน่งงาน" ออกจาก "ชุดสิทธิ์ (role)" — role ตอบว่าใช้ระบบทำอะไรได้
-- ส่วน position คือตำแหน่งจริงในโรงงาน (หัวหน้าแผนก/วิศวกร/เจ้าหน้าที่/ช่างเทคนิค ฯลฯ)
-- ใช้แสดงตัวตน/รายงาน/ช่องลายเซ็น — ไม่มีผลต่อ permission ใดๆ (ดู CLAUDE.md "Role System")
-- additive + nullable → rollback โค้ดได้โดยไม่ต้อง drop คอลัมน์
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS position text;

COMMENT ON COLUMN public.profiles.position IS
  'ตำแหน่งงานจริง (แสดงผล/รายงาน/ลายเซ็น) — ไม่เกี่ยวกับสิทธิ์ สิทธิ์ใช้ role + role_permissions';
