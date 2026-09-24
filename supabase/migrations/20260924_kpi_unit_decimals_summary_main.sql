-- ═══ 🔢 หน่วย · ทศนิยม · วิธีรวม 12 เดือน — ตั้งได้ 2 ชั้น · Main (ewhdfqwfwofivojtsizn) ═══
-- 2026-09-24 · คำสั่ง user: ถามว่า "ตั้งค่าหน่วย/ทศนิยม/average-total ได้ที่ไหน ตั้งต่อจากทะเบียนหรือควรแยก"
--   แล้วเคาะว่า **"2 ชั้น"**
--
-- ก่อนหน้านี้:
--   · หน่วย   — อยู่ที่ `kpi_catalog.unit` ชั้นเดียว · ช่องกรอกอยู่ใน "โมดัลแก้นิยามรายปี"
--               แต่ **เขียนย้อนกลับทะเบียนเงียบๆ** ⇒ แก้หน่วยของ PD3 = เปลี่ยนให้ทุกแผนกทุกปี โดยไม่มีคำเตือน
--   · ทศนิยม  — คอลัมน์ `kpi_catalog.decimals` มีอยู่ **แต่ไม่มีช่องกรอก และไม่มีจอไหนอ่านเลย**
--               (grep ทั้งรีโป = 0) ทุกจอ hardcode `maximumFractionDigits: 2` และ `unit === 'PPM' ? 0 : 1`
--   · วิธีรวม  — **ไม่มีคอลัมน์** · `manualAvg()` เฉลี่ยตายตัวทุกแถว ⇒ Scrap ที่ต้อง "รวมทั้งปี"
--               โชว์ 271.4 แทน 1,628 · PPM โชว์ 287.3 แทน 276 (เทียบเด็ค Management Review H1 FY2026)
--
-- กติกา 2 ชั้นที่ตกลง:
--   🔒 **วิธีรวม 12 เดือน = ของตัวตน KPI → ทะเบียนอย่างเดียว ห้าม override รายแถว**
--      (PPM คิดจากยอดรวมทั้งปีเสมอ · Scrap รวมเสมอ · Sales/Head สะสมเสมอ ไม่ว่าแผนกไหน
--       ปล่อยให้ตั้งเองรายแผนก = แผนกหนึ่งเฉลี่ย อีกแผนกรวม แล้วเอาเลขมาเทียบกันไม่ได้)
--   🔓 **หน่วย + ทศนิยม = ทะเบียนตั้งค่าตั้งต้น · นิยามรายแถว override ได้ (ว่าง = ตามทะเบียน)**
--      หลักฐานว่าต้อง override ได้: MTBF ใบ JIG ใช้ "นาที" เด็คใช้ "ชม." · DSI มี 2 หน่วยทางการ (วัน / MB)
--
-- Rollback:
--   alter table public.kpi_catalog     drop column if exists summary_mode;
--   alter table public.kpi_definitions drop column if exists decimals;
--   -- `kpi_definitions.unit` มีอยู่เดิม ไม่ได้เพิ่มในไฟล์นี้ (แค่เริ่มมีจอเขียน/อ่าน)

begin;

/* ── 1) วิธีรวม 12 เดือน — อยู่ที่ทะเบียน (ของตัวตน KPI) ────────────────────────────────
   คีย์ต้องตรงกับ `KPI_SUMMARY_MODES` ใน src/utils/kpiSetup.js เป๊ะ
   `rate` = คำนวณจากยอดรวมทั้งปี (Σ ตัวตั้ง ÷ Σ ตัวหาร) — ใช้กับ PPM
   ⚠️ แถวกรอกมือไม่มียอดดิบให้หาร ⇒ จอจะโชว์ค่าเฉลี่ยพร้อมป้าย "≈" **ห้ามโชว์เฉยๆ เหมือนเป็นค่าทางการ** */
alter table public.kpi_catalog
  add column if not exists summary_mode text not null default 'average';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kpi_catalog_summary_mode_chk') then
    alter table public.kpi_catalog add constraint kpi_catalog_summary_mode_chk
      check (summary_mode in ('average', 'sum', 'max', 'as_of', 'rate'));
  end if;
end $$;

comment on column public.kpi_catalog.summary_mode is
  'วิธีรวม 12 เดือนของ KPI ตัวนี้ (average/sum/max/as_of/rate) — ของตัวตน KPI ห้าม override รายแถว';

/* ── 2) ทศนิยม override รายแถว (null = ใช้ของทะเบียน) ─────────────────────────────────── */
alter table public.kpi_definitions
  add column if not exists decimals smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kpi_definitions_decimals_chk') then
    alter table public.kpi_definitions add constraint kpi_definitions_decimals_chk
      check (decimals is null or (decimals >= 0 and decimals <= 6));
  end if;
end $$;

comment on column public.kpi_definitions.decimals is
  'ทศนิยมเฉพาะแถวนี้ — null = ใช้ kpi_catalog.decimals';
comment on column public.kpi_definitions.unit is
  'หน่วยเฉพาะแถวนี้ — null = ใช้ kpi_catalog.unit (MTBF ใบ JIG ใช้ "นาที" แต่เด็คใช้ "ชม.")';

/* ── 3) ย้ายวิธีรวมที่ฝากไว้ชั่วคราวใน provider_config เข้าคอลัมน์จริง ─────────────────────
   ตอน seed เด็ค H1 FY2026 (23/09) ยังไม่มีคอลัมน์นี้ จึงเก็บไว้ที่ `provider_config->>'summary'`
   ไฟล์นี้ย้ายเข้าที่ถูก แล้ว**ลบคีย์ที่ฝากไว้ทิ้ง** — ห้ามมี 2 แหล่งความจริง
   ⚠️ 1 catalog ใช้ร่วมหลายแผนก ⇒ ถ้าแต่ละแผนกฝากค่าไว้ไม่ตรงกัน เอา "ค่าที่พบบ่อยสุด" แล้วเรียงคีย์กันผลสุ่ม */
with pick as (
  select d.catalog_id, d.provider_config ->> 'summary' as mode, count(*) n
    from public.kpi_definitions d
   where d.catalog_id is not null
     and d.provider_config ->> 'summary' in ('average', 'sum', 'max', 'as_of', 'rate')
   group by 1, 2
), best as (
  select distinct on (catalog_id) catalog_id, mode
    from pick order by catalog_id, n desc, mode
)
update public.kpi_catalog c
   set summary_mode = b.mode, updated_at = now()
  from best b
 where c.id = b.catalog_id and c.summary_mode is distinct from b.mode;

update public.kpi_definitions
   set provider_config = nullif(provider_config - 'summary', '{}'::jsonb)
 where provider_config ? 'summary';

commit;
