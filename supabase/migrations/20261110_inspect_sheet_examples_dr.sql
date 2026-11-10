/* 📋 "ใบตรวจที่ทำครบตามแพทเทิน" — ไว้ให้จอตั้งค่าชี้ตัวอย่างจริงได้  (DR · 2026-11-10)

   คำสั่ง user: *"แพทเทินการสร้างใบตรวจแต่ละเครื่อง ควรมีตัวอย่างมั้ย — เริ่มจากรูปหลักภาพใหญ่
   มุมที่ 1 และปักหมุดแต่ละจุดในมุมที่ 1 พร้อมภาพขยาย แล้วค่อยไปมุมที่ 2"*

   🔑 **ตัวอย่างต้องมาจากข้อมูลจริง ห้าม hardcode ชื่อเครื่องในโค้ด** — ใบต้นแบบเปลี่ยนได้
   วัดจริง 10/11 (5,255 จุด / 286 ใบ) — มาตรฐานต่างกันมากระหว่างทีม:
     | ทีม | ใบ | จุด | ไม่ปักเลย | %ปัก | %รูปขยาย |
     |---|---|---|---|---|---|
     | jig_maintenance | 157 | 3,469 | 0 | 93% | **98%** |
     | production (AM) | 82 | 888 | 7 | 96% | 44% |
     | die_maintenance | 31 | 774 | **24** | **14%** | **0%** |
     | maintenance | 16 | 124 | 6 | 66% | **0%** |
   ⇒ ชิ้นส่วนมีครบอยู่แล้ว (หลายมุม · หมุดผูกมุม · รูปขยายรายจุด) แต่ไม่มีใครรู้ว่า "ครบ" หน้าตายังไง

   คืนใบที่ครบจริง (ปักหมุดครบ + รูปขยายครบ + ≥5 จุด) เรียงดีที่สุดก่อน · ทีมเดียวกันขึ้นก่อน
   ตัวอย่างผลจริง: HDF-02 (20 มุม/19 จุด) · BD-03 BENDING (15/15) — ทั้งคู่ของทีม AM

   🔴 อ่านอย่างเดียว ไม่เขียนอะไร · ฝั่ง DR วิ่งด้วย role **anon** เสมอ ⇒ GRANT ให้ anon
      (กฎเหล็ก CLAUDE.md §Supabase Projects — ห้ามทำเป็น TO authenticated = พังทั้งระบบ)
   🔴 เป็น "ตัวบอก" ไม่ใช่ "ด่าน" — จอเอาไปโชว์เฉยๆ อ่านไม่ได้ก็แค่ไม่โชว์บรรทัดตัวอย่าง

   ⏪ ย้อนกลับ: drop function public.fn_inspect_sheet_examples(text, int);                */
create or replace function public.fn_inspect_sheet_examples(
  p_department text default null, p_limit int default 3)
returns table (
  equipment_id uuid, equipment_name text, department text,
  frames int, cps int, pinned int, with_photo int, same_team boolean)
language sql
stable
security invoker
set search_path = public
as $fn$
  with sheet as (
    select c.equipment_id, c.department,
           count(*)::int                                            as cps,
           count(*) filter (where k.x_pos is not null)::int         as pinned,
           count(*) filter (where k.image_path is not null)::int    as with_photo
      from checklists c
      join jig_checkpoints k on k.checklist_id = c.id
     group by c.equipment_id, c.department
  )
  select s.equipment_id,
         j.name,
         s.department,
         coalesce((select count(*)::int from jig_images i where i.jig_id = s.equipment_id), 0),
         s.cps, s.pinned, s.with_photo,
         (p_department is not null and s.department = p_department)
    from sheet s
    join jigs j on j.id = s.equipment_id
   where s.cps >= 5                      -- ใบจิ๋วไม่ใช่ตัวอย่างที่ดี
     and s.pinned = s.cps                -- ปักหมุดครบทุกจุด
     and s.with_photo >= s.cps           -- มีรูปขยายครบทุกจุด
   order by (p_department is not null and s.department = p_department) desc,
            coalesce((select count(*)::int from jig_images i where i.jig_id = s.equipment_id), 0) desc,
            s.cps desc,
            j.name
   limit greatest(1, least(coalesce(p_limit, 3), 10));
$fn$;

revoke all on function public.fn_inspect_sheet_examples(text, int) from public;
grant execute on function public.fn_inspect_sheet_examples(text, int) to anon, authenticated;
