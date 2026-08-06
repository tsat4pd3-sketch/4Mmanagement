-- เพิ่มแผนก "ทั่วไป" ใต้ PD4 (คำสั่ง user: PD4 มี 3 แผนก = GOR, LWRBAR, ทั่วไป) · Main · 2026-07-22
-- "ทั่วไป" = พนักงานระดับวิศวกร/ช่าง/หัวหน้าส่วน ที่ไม่เข้า GOR/LWRBAR
-- labor_type = indirect (dept-level override — PD4 section = direct แต่ทั่วไป = สนับสนุน)
-- idempotent: ไม่เพิ่มซ้ำถ้ามีแล้ว
insert into public.org_nodes (kind, name, parent_id, sort_order, is_active, labor_type)
select 'department', 'ทั่วไป', s.id, 99, true, 'indirect'
from public.org_nodes s
where s.kind = 'section' and s.code = 'PD4'
  and not exists (
    select 1 from public.org_nodes d
    where d.kind = 'department' and d.parent_id = s.id and d.name = 'ทั่วไป'
  );
