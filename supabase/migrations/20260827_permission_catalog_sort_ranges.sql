-- ═══ permission_catalog: จัดเลข sort ให้อยู่ในช่วงของหมวด — 2026-08-27 ══════════════
-- โปรเจค: Main (ewhdfqwfwofivojtsizn)
--
-- COSMETIC ล้วน: เปลี่ยนเฉพาะ sort (ลำดับที่แถวโผล่ในแท็บ "สิทธิ์การทำงาน" ของ /permissions)
-- **ไม่แตะ role_permissions — สิทธิ์ของทุก role คงเดิมทุกช่อง**
--
-- ที่มา: ตรวจผลหลังรัน 20260827_permission_catalog_nav_audit_regroup.sql พบ 2 จุดหลุดช่วง
--   1. 'Logistic - Store'      ควรอยู่ 5xx แต่ lo = 69  (หลุดไปข้างหน้าสุดของทั้งตาราง)
--   2. 'คุณภาพ & วิศวกรรม'     ควรอยู่ 7xx แต่ hi = 806 (แถว PE เดิมค้างช่วง 8xx)
--
-- ยังไม่พังตอนนี้ (หมวดอื่นไม่ชน) แต่ (ก) แถว Logistic ตัวนั้นลอยไปโผล่บนสุดผิดหมวด
-- (ข) ช่วง 8xx ที่ค้างไว้จะชนทันทีถ้าวันหน้ามีคนเพิ่มหมวดใหม่
--
-- กติกาเดิม: ช่วง sort ต่อหมวด — ภาพรวม 1xx · ฝ่ายผลิต 2xx · วิเคราะห์ 3xx · พนักงาน 4xx
--            Logistic 5xx · ซ่อมบำรุง 6xx · คุณภาพ & วิศวกรรม 7xx · ตั้งค่า 9xx
--            (8xx ว่างไว้ หลังยุบหมวด PE เข้าคุณภาพ)
--
-- Rollback: ไม่มีค่าเดิมเก็บไว้ (เป็นเลขลำดับแสดงผลล้วน) — ถ้าต้องย้อน ให้รันสคริปต์นี้ซ้ำ
--           หลังแก้ฐานเลขในบล็อก case ตามที่ต้องการ

-- ① renumber 2 หมวดที่หลุดช่วง โดย "คงลำดับสัมพัทธ์เดิม" ไว้
with fixed as (
  select ctid,
         case group_name when 'Logistic - Store' then 500 else 700 end
           + 5 * row_number() over (
               partition by group_name
               order by sort nulls last, resource, action) as new_sort
    from public.permission_catalog
   where group_name in ('Logistic - Store', 'คุณภาพ & วิศวกรรม')
)
update public.permission_catalog p
   set sort = f.new_sort
  from fixed f
 where p.ctid = f.ctid
   and p.sort is distinct from f.new_sort;

-- ② ตรวจผล — ทุกหมวดต้องอยู่ในช่วงร้อยของตัวเอง + ไม่มี sort ซ้ำในหมวดเดียวกัน
--    ที่ควรได้: Logistic 505–550 · คุณภาพ & วิศวกรรม 705–750 · dup = 0 ทุกแถว
select group_name, count(*) n, min(sort) lo, max(sort) hi,
       count(*) - count(distinct sort) as dup
  from public.permission_catalog
 group by 1 order by lo;
