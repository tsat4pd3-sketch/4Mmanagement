/* ═══ คืนไลน์ "SPARE PART" + แก้โหนดผังที่ชี้ไลน์ผิด (2026-10-30) ═══
   Main project (ewhdfqwfwofivojtsizn) · ตามที่ user เคาะ หลังหัวหน้าส่วน PD2 แจ้งว่า "SPARE PART หายไป"

   ── สิ่งที่เกิดขึ้นจริง (จาก audit_log · row_pk=12) ────────────────────────────
   แถว id 12 ถูกตั้งชื่อใหม่หลายรอบ:
     21/05/26 สร้างเป็น "LINE ASSY FORD UP375"  →  01/10 เปลี่ยนชื่อเป็น "SPARE PART"
     →  30/10 09:19 เปลี่ยนชื่อเป็น "Assembly Line B - FORD"
   ⇒ **แถวนี้คือไลน์ประกอบ FORD มาตลอด** · ชื่อ "SPARE PART" ถูกแปะไว้ 29 วัน (01/10–30/10)
   ⇒ การเปลี่ยนชื่อวันนี้ = คืนชื่อจริงของแถว **ไม่ใช่การแย่งแถวของ SPARE PART**

   🔴 **จึงห้ามย้ายประวัติของแถว 12 ไปไลน์ใหม่** (พิสูจน์แล้วว่าเป็นของ FORD ทั้งหมด):
     · ตารางกะ 189 แถว — สร้างก่อน 01/10 ทุกแถว (`created_at >= 2026-10-01` = 0 แถว)
     · ใบ 4M 3 ใบ — สร้าง 27/05/26 · จุดงาน 7 จุด + ผังไลน์ — สร้าง 30/10 (ของ FORD)
   ✅ ของยุค "SPARE PART" จริงๆ มีแค่ `station_output_rollup` 2 แถว (work_date 01/10, 07/10)
      ซึ่งจับคู่ด้วย **ชื่อ** ⇒ พอมีไลน์ชื่อ SPARE PART อีกครั้ง จะกลับมาจับคู่ได้เอง ไม่ต้องแตะ

   ── ① คืนไลน์ SPARE PART เป็นไลน์ใหม่ (ไม่มีประวัติติดมา) ──────────────────────
   วางเป็น **ไลน์หลักใน PD2** ตามที่หัวหน้าส่วนตั้งใจ ("ถอดออกมาเป็นระดับไลน์หลัก")
   · `line_type` เว้นว่างไว้ให้เจ้าของไลน์เลือกเอง (ทะเบียนมีตะกร้ารับไลน์ที่ยังไม่ตั้งชนิด)

   ── ② แก้โหนดผังที่ชี้ไลน์ผิด ────────────────────────────────────────────────
   30/10 09:27 โหนด Line A1 (ใต้ A-GM) และ Line C1 (ใต้ C-Suzuki) ถูกตั้งให้ชี้
   `ref_line_id = 52` = **Line D6 - Sub Assembly** และถือ cost center ของ D6 ทั้งคู่
   ⇒ รหัส `2140674106` มีเจ้าของ 3 โหนด = **ผิดสมมติฐานหลักของชั้นสิทธิ์แกน CC**
     ("org_nodes.cost_center ไม่ซ้ำกันเลย" — `utils/ccScope.js`) · เป็นรหัสเดียวในผังที่ซ้ำ
   ⇒ ล้างทั้ง `ref_line_id` และ `cost_center` ของ 2 โหนดนี้ (ยังไม่มีไลน์จริงให้ผูก)
     **ไม่เดาว่าควรชี้ไลน์ไหน** — ให้เจ้าของผังมาผูกเองที่ /org-setup

   ↩️ ย้อนกลับ: ค่าเดิมเก็บครบใน `archive.org_node_ref_fix_20261030`
        update public.org_nodes o set ref_line_id = a.old_ref_line_id, cost_center = a.old_cost_center
          from archive.org_node_ref_fix_20261030 a where a.id = o.id;
      · ลบไลน์ที่สร้าง: delete from public.production_lines where name = 'SPARE PART' and id > 58;
   ♻️ รันซ้ำได้ (มี guard ทั้ง 2 ขั้น)                                                   */

create schema if not exists archive;

create table if not exists archive.org_node_ref_fix_20261030 (
  id                 uuid primary key,
  name               text,
  old_ref_line_id    int,
  old_cost_center    text,
  fixed_at           timestamptz not null default now()
);

-- ① ไลน์ SPARE PART (ไลน์หลักใน PD2) — สร้างเฉพาะตอนที่ยังไม่มีชื่อนี้
insert into public.production_lines (name, section, parent_line_name, unit_kind, is_active)
select 'SPARE PART', 'PD2', null, 'production', true
where not exists (
  select 1 from public.production_lines where btrim(name) = 'SPARE PART'
);

-- ② โหนดผังที่ชี้ Line D6 ทั้งที่อยู่คนละแผนก
insert into archive.org_node_ref_fix_20261030 (id, name, old_ref_line_id, old_cost_center)
select o.id, o.name, o.ref_line_id, o.cost_center
from public.org_nodes o
where o.is_active and o.kind = 'line'
  and o.name in ('Line A1', 'Line C1')
  and o.ref_line_id = 52
on conflict (id) do nothing;

update public.org_nodes o
   set ref_line_id = null, cost_center = null, updated_at = now()
  from archive.org_node_ref_fix_20261030 a
 where a.id = o.id
   and o.ref_line_id is not null;
