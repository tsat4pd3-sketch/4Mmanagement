-- 2026-10-19 · MAIN (ewhdfqwfwofivojtsizn) · สลับนิยาม KPI การเงินที่มีอยู่เป็น provider='formula'
-- (user 15/10: "DL ของแต่ละส่วนงานกรอกยอดเงินอย่างเดียว ระบบเอาไปหารกับยอดขายให้" · 19/10 ส่งไฟล์บัญชีจริง "01 Report Monthly FS" มาแล้ว)
-- ปลอดภัยเพราะ applyFormulaEntries(): เดือนที่ตัวเลขฐานยังไม่ครบ = ใช้ค่ากรอกมือเดิม + ช่องยังกรอกมือได้ (formulaMonthMode)
-- · สูตรที่ใช้กำลังคนประมาณจากทะเบียน ไม่ทับค่าที่กรอกไว้ ⇒ บอร์ดไม่เปลี่ยนจนกว่าจะนำเข้าตัวเลขฐานจริง
-- data-only (ไม่มี schema) · rollback: update กลับเป็น provider='manual', provider_config=null ตาม id ข้างล่าง
-- ไม่แตะ "Inventory Balance" (BIG PRESS faa1d80e · หน่วย Day แต่ formula_text ว่าเป็นมูลค่าบาท — กำกวม ให้เจ้าของตัดสิน)

begin;

-- DL+OH → dloh_pct  (= (dl+oh) ÷ Sales from product × 100)
update public.kpi_definitions set provider = 'formula', provider_config = jsonb_build_object('formula', 'dloh_pct')
 where is_active and year = 2026 and coalesce(provider, 'manual') <> 'formula'
   and id in ('132430ef-15b6-4683-8d7b-d3940ecf9eb2', 'a52f0bdf-a4e6-41f4-aca0-dca9bf29bd24', '938541b0-100a-4f9a-bad5-983b887dbc04',
              '4c8efcd9-5ee8-4604-91b4-562c68ccb8ff', '9f961a9c-d2f6-4388-a6ae-29eecca00278', 'bc7a9633-dc36-47bb-b91c-69d77a4165ec',
              '6033b270-f7ee-4cf9-a363-69ced7df5809', '5f713d83-41ce-4aaf-bca4-ff6bd77cddf9', '478fcbeb-d47f-42f7-a740-c1c12226d583',
              '47ea8b46-63a3-408c-8258-ce2e76d2dd52', '39d0910d-0166-4298-8dc9-012f81e7e59a');

-- %RM / Raw Material Control → rm_pct
update public.kpi_definitions set provider = 'formula', provider_config = jsonb_build_object('formula', 'rm_pct')
 where is_active and year = 2026 and coalesce(provider, 'manual') <> 'formula'
   and id in ('d02840ab-1188-41f7-bc88-296b5db45cd9', '15456465-6a97-4c40-ab76-5a50f2b3378c', '37044a02-e6e5-428a-9451-86c5f1491533',
              '3ba1dc9f-fa14-4a53-a775-8a1033f0b4db', 'b755086d-e7d5-4bc4-88b7-a29a627e414f');

-- DSI → inventory_day
update public.kpi_definitions set provider = 'formula', provider_config = jsonb_build_object('formula', 'inventory_day')
 where is_active and year = 2026 and coalesce(provider, 'manual') <> 'formula'
   and id in ('43bcb05e-70d2-4247-a9eb-20dc9e318569', 'c2ba1032-ea16-43bd-9de9-455423810e3d', '57583de3-3008-4c29-8b7d-351149f9ccc1');

-- Annual Sale(s) Per Head → sale_per_head (Σ Total Sales ม.ค.→เดือนนี้ ÷ กำลังคน ÷ 1e6 — ตามใบ 5.Manpower แถว "Sale All / Head (All)")
update public.kpi_definitions set provider = 'formula', provider_config = jsonb_build_object('formula', 'sale_per_head')
 where is_active and year = 2026 and coalesce(provider, 'manual') <> 'formula'
   and id in ('6f1aa716-6797-4a1a-9597-de926d18f8c1', 'e078ba8e-2265-4271-a41b-b28acc9db5d0', 'b9510965-48ab-47c1-bee2-1b0c0de52063',
              '9c800328-cb5b-4211-89d5-921abf58af0b', '24c85168-6904-4d20-8ba0-1914a50c203b');

commit;

-- ตรวจผล (คาด 24 แถว · เดิม 0)
-- select provider_config->>'formula' f, count(*) from public.kpi_definitions where is_active and year = 2026 and provider = 'formula' group by 1;

-- rollback (ย้อนทั้งชุด):
-- update public.kpi_definitions set provider = 'manual', provider_config = null
--  where id in (<24 id ข้างบน>);
