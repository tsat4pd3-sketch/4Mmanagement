-- ─────────────────────────────────────────────────────────────────────────────
-- 💰 Cost Center = "ตัวกรอง/ป้าย" ไม่ใช่หน่วยเก็บ KPI — ขอบเขต KPI ของรหัสที่มีหน่วยเจ้าของ = หน่วยเจ้าของ     (Main project · ewhdfqwfwofivojtsizn)
-- 2026-10-15 · user: "ระบบ filter มี 2 ช่องขัดกันไปมา ทำให้ค่าที่กรอกไว้รวน — audit + แก้ให้ดี"
--
-- ── ต้นเหตุ (audit_log 06–14/10) ────────────────────────────────────────────
--   หน้า ⚙️ KPI มี 2 ช่องกรอง: หน่วยงาน (PD1) + Cost Center (2140461000 · PD1) ซึ่ง**เป็นหน่วยเดียวกัน**
--   แต่ kpi_definitions / kpi_month_notes / kpi_board_layouts เก็บ `scope_kind='cost_center'` แยกจาก `section:PD1`
--   ⇒ สลับช่องกรองแล้ว KPI ชุดหนึ่งหาย อีกชุดกลายเป็น "ค่ารวมจากหน่วยลูก: CC 2140461000" ทั้งที่เป็นตัวเอง
--   · PD1: นิยาม 9 ตัวถูกย้ายไป cost_center (แก้ไขขณะกรองด้วยรหัส 09/10 + 14/10 09:02) · 14/10 16:39 มีคนกด "ตั้ง KPI ระดับนี้"
--     จากแผงลูกจนเกิดเปลือกเปล่า 7 ตัวซ้ำที่ section:PD1 (ไม่มีค่า/เป้า) · layout + หมายเหตุรายเดือน 10 แถวก็ไปอยู่ที่รหัส
--   · JIG MTN: ADMIN สร้างชุด 11 ตัวที่ cost_center:2140563100 (06/10 14:57 · ไม่ผูกทะเบียน) ซ้ำกับชุดทางการของ department:JIG MTN
--     (ค่า มิ.ย.–ต.ค. ของ MBD/MTBF/MTTR/MO เท่ากันทุกเดือน)
--
-- ── กติกาใหม่ (ฝั่ง JS: `canonicalScope()` ใน src/utils/orgScope.js · ฝั่ง DB: trigger ข้างล่าง) ────────
--   เก็บ/เทียบ KPI ด้วย "หน่วยเจ้าของรหัส" เสมอ · รหัสที่ไม่มีหน่วยเจ้าของในผัง (กำพร้า) ยังเก็บเป็น cost_center ได้
--
-- ── ลำดับ: ซ่อมข้อมูลก่อน แล้วค่อยติด trigger · **apply แล้ว 15/10 ผ่าน MCP ทีละก้อน** (ตรวจผลแล้ว: ไม่เหลือ cost_center ที่มีเจ้าของ) ─────────
-- ROLLBACK ท้ายไฟล์
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ A. PD1 (cost_center 2140461000 ↔ section PD1) ═══════════════════════════

-- A1. เปลือกเปล่าที่เกิดจากบั๊ก (14/10 16:39–16:40 · ไม่มีค่า/แผน/เป้า) — ต้องพ้นทางก่อนย้ายตัวจริงกลับ (unique: year+scope+catalog)
--     ⚠️ ลงจริง 15/10 ผ่าน MCP: คำสั่ง DELETE ค้างจน timeout (แม้ `delete … where false`) ⇒ ใช้ update แทน: ปลดคีย์ unique (catalog_id=null) + ปิด + ติดป้าย
--     แล้วให้ user ลบทิ้งเองใน SQL Editor (บล็อก "ให้ user รัน" ท้ายไฟล์) · fail-closed: ถ้ามีใครกรอกค่าใส่เปลือกไปแล้ว แถวนั้นจะไม่ถูกแตะ และ A2 จะชน unique → หยุด ให้คนดู
update public.kpi_definitions d
   set is_active = false, catalog_id = null, name = '[เปลือกซ้ำ 14/10 ลบได้] ' || d.name
 where d.year = 2026 and d.scope_kind = 'section' and d.scope_value = 'PD1' and d.is_active
   and d.id::text like any (array['53059b5d%','00106171%','00bc87c3%','64b12c42%','b826d20e%','7c079ad2%','010416c8%'])
   and d.target is null and d.target_value is null and d.commitment is null
   and not exists (select 1 from public.kpi_manual_entries e where e.kpi_id = d.id)
   and not exists (select 1 from public.kpi_month_plans p where p.kpi_id = d.id);

-- A2. ตัวจริง (มีค่า 9 เดือน + เป้า) ย้ายกลับหน่วยเจ้าของ — id คงเดิม ⇒ ค่า/แผน/row_key ใน layout ไม่หลุด
update public.kpi_definitions d
   set scope_kind = 'section', scope_value = 'PD1', section = 'PD1'
 where d.year = 2026 and d.scope_kind = 'cost_center' and d.scope_value = '2140461000'
   and d.id::text like any (array['6033b270%','faa1d80e%','98f9377b%','e41f4010%','f95f354d%','e66e2e8f%','e078ba8e%']);

-- A3. %RM: ตัวที่ section:PD1 มีค่า 8 เดือนแต่ไม่มีเป้า · ตัวที่รหัสมีเป้าแต่ไม่มีค่า ⇒ รวมเป้าเข้าตัวที่มีค่า แล้วปิดตัวที่รหัส
update public.kpi_definitions p
   set target = coalesce(nullif(p.target,''), c.target), target_value = coalesce(p.target_value, c.target_value),
       target_compare = coalesce(p.target_compare, c.target_compare),
       commitment = case when coalesce(nullif(p.commitment,''), '-') = '-' then c.commitment else p.commitment end,
       commit_value = coalesce(p.commit_value, c.commit_value), commit_compare = coalesce(p.commit_compare, c.commit_compare)
  from public.kpi_definitions c
 where p.id::text like '15456465%' and c.id::text like '384747d8%' and p.year = 2026 and c.year = 2026;
update public.kpi_definitions set is_active = false where id::text like '384747d8%' and scope_kind = 'cost_center';
-- A4. Customer Satisfaction: ซ้ำ 2 ตัว ไม่มีค่าทั้งคู่ เป้าเท่ากัน ⇒ ปิดตัวที่รหัส
update public.kpi_definitions set is_active = false where id::text like '22c97ab9%' and scope_kind = 'cost_center';

-- A5. layout: ของรหัส (14/10 09:16) ใหม่กว่าของ section (09/10) ⇒ คัดลอกลำดับของรหัสทับแถว section:PD1 (ลบแถวรหัสไม่ได้ผ่าน MCP — ให้ user ลบ)
update public.kpi_board_layouts s set row_keys = c.row_keys
  from public.kpi_board_layouts c
 where s.year = 2026 and s.scope_kind = 'section' and s.scope_value = 'PD1'
   and c.year = 2026 and c.scope_kind = 'cost_center' and c.scope_value = '2140461000';
-- A6. หมายเหตุรายเดือน 10 แถว (dloh/rm) → หน่วยเจ้าของ
update public.kpi_month_notes set scope_kind = 'section', scope_value = 'PD1' where scope_kind = 'cost_center' and scope_value = '2140461000';

-- ═══ B. JIG MTN (cost_center 2140563100 ↔ department JIG MTN) ════════════════
-- ชุดที่รหัส = สำเนาไม่ผูกทะเบียน ซ้ำกับชุดทางการ (ค่าเดือนเดียวกันเท่ากันทุกตัว) ⇒ ปิดทั้งชุด (ไม่ลบ · ค่าที่ติดอยู่ยังเปิดดูได้จาก audit/ประวัติ)
update public.kpi_definitions set is_active = false
 where year = 2026 and scope_kind = 'cost_center' and scope_value = '2140563100' and is_active;

-- ═══ C. DIE MTN layout ที่รหัส 2140561100 → department:DIE MTN (ยังไม่มีของหน่วย) ═════
update public.kpi_board_layouts l set scope_kind = 'department', scope_value = 'DIE MTN'
 where l.year = 2026 and l.scope_kind = 'cost_center' and l.scope_value = '2140561100'
   and not exists (select 1 from public.kpi_board_layouts x where x.year = 2026 and x.scope_kind = 'department' and x.scope_value = 'DIE MTN');

-- ═══ D. trigger กันเกิดซ้ำ — รหัสที่มีหน่วยเจ้าของเดียวในผัง ถูกเขียนเป็น cost_center = แปลงเป็นหน่วยเจ้าของให้เอง ═══
--   (ฝั่ง JS แปลงอยู่แล้วผ่าน canonicalScope · ตัวนี้เป็นด่านชั้น DB กัน client เก่า/ทางอื่น)
--   · รหัสที่ไม่มีเจ้าของ หรือมีหลายเจ้าของ (ผังตั้งซ้ำ) = ปล่อยไว้ ไม่เดา
--   · kpi_definitions ที่ is_active=false ไม่แตะ (แถวที่ปิดไปแล้วย้ายไม่ได้ — จะชน unique กับตัวจริง)
create or replace function public.fn_kpi_scope_canon() returns trigger language plpgsql as $$
declare k text; v text; sec text; n int;
begin
  if new.scope_kind is distinct from 'cost_center' or new.scope_value is null then return new; end if;
  if tg_table_name = 'kpi_definitions' and new.is_active = false then return new; end if;
  select count(*) into n from public.org_nodes o
   where o.is_active and o.cost_center = new.scope_value and o.kind in ('section','department');
  if n <> 1 then return new; end if;
  select o.kind, coalesce(o.code, o.name),
         case when o.kind = 'section' then coalesce(o.code, o.name)
              else (select coalesce(p.code, p.name) from public.org_nodes p where p.id = o.parent_id and p.kind = 'section') end
    into k, v, sec
    from public.org_nodes o
   where o.is_active and o.cost_center = new.scope_value and o.kind in ('section','department');
  new.scope_kind := k; new.scope_value := v;
  if tg_table_name = 'kpi_definitions' then new.section := sec; end if;
  return new;
end $$;

create trigger trg_kpi_def_scope_canon before insert or update on public.kpi_definitions
  for each row execute function public.fn_kpi_scope_canon();   -- ชื่อเรียงก่อน trg_kpi_def_scope_sync ⇒ วิ่งก่อน
create trigger trg_kpi_notes_scope_canon before insert or update on public.kpi_month_notes
  for each row execute function public.fn_kpi_scope_canon();
create trigger trg_kpi_layout_scope_canon before insert or update on public.kpi_board_layouts
  for each row execute function public.fn_kpi_scope_canon();
create trigger trg_kpi_base_scope_canon before insert or update on public.kpi_base_inputs
  for each row execute function public.fn_kpi_scope_canon();

-- ═══ ให้ user รันเองใน SQL Editor (Main · "MAIN" · ewhdfqwfwofivojtsizn) — แถวตายที่ MCP ลบไม่ได้ ═══
--   delete from kpi_definitions where year = 2026 and name like '[เปลือกซ้ำ 14/10 ลบได้] %' and is_active = false and catalog_id is null;   -- 7 แถว
--   delete from kpi_board_layouts where year = 2026 and scope_kind = 'cost_center' and scope_value = '2140461000';                        -- 1 แถว
--
-- ตรวจผล:
--   select scope_kind, scope_value, count(*) from kpi_definitions where year=2026 and is_active group by 1,2 order by 1,2;   -- ไม่ควรมี cost_center ที่มีเจ้าของ
--   select scope_kind, scope_value from kpi_board_layouts;  select scope_kind, scope_value, count(*) from kpi_month_notes group by 1,2;
--
-- ROLLBACK:
--   drop trigger if exists trg_kpi_def_scope_canon on kpi_definitions; drop trigger if exists trg_kpi_notes_scope_canon on kpi_month_notes;
--   drop trigger if exists trg_kpi_layout_scope_canon on kpi_board_layouts; drop trigger if exists trg_kpi_base_scope_canon on kpi_base_inputs;
--   drop function if exists fn_kpi_scope_canon();
--   update kpi_definitions set is_active=true where year=2026 and scope_kind='cost_center' and scope_value in ('2140563100') ; -- JIG ชุดสำเนา
--   update kpi_definitions set is_active=true where id::text like any(array['384747d8%','22c97ab9%']);
--   update kpi_definitions set scope_kind='cost_center', scope_value='2140461000' where id::text like any(array['6033b270%','faa1d80e%','98f9377b%','e41f4010%','f95f354d%','e66e2e8f%','e078ba8e%']);
--   update kpi_month_notes set scope_kind='cost_center', scope_value='2140461000' where scope_kind='section' and scope_value='PD1' and row_key in ('dloh','rm');
--   update kpi_board_layouts set scope_kind='cost_center', scope_value='2140461000' where year=2026 and scope_kind='section' and scope_value='PD1';
--   update kpi_definitions set is_active=true, name=replace(name,'[เปลือกซ้ำ 14/10 ลบได้] ','') where name like '[เปลือกซ้ำ 14/10 ลบได้] %'; -- (catalog_id คืนไม่ได้ · เปลือกไม่มีข้อมูล สร้างใหม่จากจอได้)
