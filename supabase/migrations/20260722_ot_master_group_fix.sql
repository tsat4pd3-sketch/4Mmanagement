-- ย้ายสิทธิ์ ot_master:manage (จองรถ OT master — สายรถ/งาน OT) จากหมวด "รายงาน/คุณภาพ" → "ฝ่ายผลิต"
-- (จองรถ OT เป็นงานธุรการ/ฝ่ายผลิต ไม่เกี่ยวคุณภาพ — จัดผิดหมวดตอน retire manage_master_data · 2026-07-22)
-- cosmetic เท่านั้น: เปลี่ยนแค่หมวดที่แถวโผล่ในตารางจัดการสิทธิ์ ไม่กระทบสิทธิ์/พฤติกรรม
update public.permission_catalog
  set group_name = 'ฝ่ายผลิต', sort = 17
  where resource = 'ot_master' and action = 'manage';
