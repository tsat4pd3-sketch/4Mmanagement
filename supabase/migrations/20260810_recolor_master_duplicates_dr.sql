-- ล้างสีซ้ำในตาราง master ที่มีช่องสี (DR project) — 2026-08-10 คำสั่ง user "จัดสีใหม่ให้เลย"
-- แถวแรกของแต่ละสี (ตาม sort_order) เก็บสีเดิม · ตัวซ้ำได้สีใหม่ที่ไม่ชนใครในตาราง
-- ประเภทชื่อมี "อื่น" ได้โทนเทา (คงความหมาย อื่นๆ=เทา) · guard เขียนเฉพาะแถวที่ยังเป็นสีเดิม (ไม่ทับสีที่ user เพิ่งแก้)
-- ตารางที่ตรวจแล้วสีไม่ซ้ำ ไม่แตะ: mtn_teams, mtn_spare_categories, pm_checkpoint_categories, process_types, machine_automation_levels, machine_operation_modes

-- machine_types: 27 แถวที่สีซ้ำ → สีใหม่ไม่ซ้ำ (guard: เขียนเฉพาะแถวที่ยังเป็นสีเดิม)
update machine_types t set color = v.new_color
from (values
  ('001bf729-3f7b-4683-a8d3-dcd46432fdcc', '#f59e0b', '#f97316'),
  ('7c1e0d8d-806d-4e82-8dd8-8119f71be2b5', '#a855f7', '#eab308'),
  ('e78ace58-b5ac-4d8d-9bd2-7d6a439cc306', '#6b7280', '#10b981'),
  ('31ea7dfb-04d1-4e33-9da3-009ca005461e', '#4d9fff', '#14b8a6'),
  ('105751ae-7863-4056-be75-ca41173482f6', '#22c55e', '#0ea5e9'),
  ('b27d135d-b09d-46c4-9983-4668491a8f74', '#ef4444', '#3b82f6'),
  ('254c7139-26b4-4aa8-b09f-b7cb4d02c6c4', '#ef4444', '#6366f1'),
  ('3877a2f1-3b9a-46c0-bdfa-69ab4c0f1e9b', '#06b6d4', '#8b5cf6'),
  ('aeea88f1-ab4e-42e3-b7ed-4c68cccd9018', '#4d9fff', '#d946ef'),
  ('5dacb448-9cfa-4a5b-91a9-d88f7012dad8', '#ef4444', '#f43f5e'),
  ('4d49b307-3e0c-4c8d-a004-21e53562052e', '#22c55e', '#fb923c'),
  ('b8713b84-303b-4e29-87cc-0b738797c8a9', '#4d9fff', '#facc15'),
  ('48373ad8-52f2-4ffa-8c9c-495726f69311', '#4d9fff', '#4ade80'),
  ('3e28c17e-0361-4606-b675-6b3c66e0ce6b', '#ef4444', '#2dd4bf'),
  ('2d7d8990-ca54-4799-8723-5f9e2bf41cc6', '#4d9fff', '#38bdf8'),
  ('8702947c-3a8f-4db7-a1a2-2892d5e00f23', '#6b7280', '#a78bfa'),
  ('f170b584-fc72-486c-869f-bc21688fd0a7', '#ef4444', '#e879f9'),
  ('d7cbd88f-36ad-48cf-bc45-af8705a0148a', '#f59e0b', '#f87171'),
  ('70bc662c-c710-4b06-8d12-7144b7b405a1', '#06b6d4', '#94a3b8'),
  ('c4a79214-adc1-4510-a3d1-68ca88f8acf7', '#a855f7', '#c32222'),
  ('5a6e1905-d0b2-42dc-be6d-90fdefd79a43', '#22c55e', '#3cdd6b'),
  ('5ffe1c7a-7ac0-437d-aa64-b0b387dc06cf', '#f59e0b', '#a95ae2'),
  ('b5a86e2e-d19a-48da-94e9-faffd2fda19e', '#f59e0b', '#c3af22'),
  ('e1c707b4-4cfd-4233-a9ba-b854bfb87dd3', '#ef4444', '#3cc2dd'),
  ('d337d6dc-e58b-46e3-925a-b0f0cd779cab', '#ef4444', '#e25aa4'),
  ('47c2fd9b-b416-4668-a007-19cd016e1933', '#22c55e', '#4ac322'),
  ('62441dcd-d441-4581-a8e4-b487e7294360', '#4d9fff', '#433cdd')
) as v(pk, old_color, new_color)
where t.id = v.pk::uuid and lower(t.color) = v.old_color;

-- dr_defect_types: 17 แถวที่สีซ้ำ → สีใหม่ไม่ซ้ำ (guard: เขียนเฉพาะแถวที่ยังเป็นสีเดิม)
update dr_defect_types t set color = v.new_color
from (values
  ('3c95238e-bcec-4545-9e33-04f980dd18ee', '#ef4444', '#eab308'),
  ('5f492067-5ebd-47cf-88bf-d3a377dc7959', '#ef4444', '#84cc16'),
  ('049a5fc5-0895-4a43-a302-c48538390673', '#ef4444', '#22c55e'),
  ('e3cf734b-05d8-4dbe-be3c-7f5a4f1dcbba', '#ef4444', '#10b981'),
  ('13374291-7c20-4ec9-a3b0-bbb8a804ce02', '#ef4444', '#14b8a6'),
  ('fc782ffa-9978-4ed8-80ca-dcff3faa6b5a', '#ef4444', '#06b6d4'),
  ('a900dfde-c1f7-4698-8188-64b3ff6b7d1f', '#ef4444', '#0ea5e9'),
  ('243fc00e-7ed9-4c79-bd10-4c1e00069738', '#ef4444', '#3b82f6'),
  ('19969fbe-676e-483e-99ae-0f9876c681f0', '#ef4444', '#6366f1'),
  ('f4c8859d-01fd-4f6f-9b4f-818104ac855a', '#ef4444', '#8b5cf6'),
  ('b462f6ee-4b7b-4c39-9905-61b5dd788ebe', '#ef4444', '#a855f7'),
  ('51a7868f-5dc9-4fec-a557-fcb6a2a4b652', '#ef4444', '#d946ef'),
  ('c1877505-ba0c-46a0-9d40-4951eb0e7ff0', '#ef4444', '#ec4899'),
  ('7e3da54e-c6db-4224-ba18-4f014bb5aa89', '#ef4444', '#f43f5e'),
  ('18a30a58-395f-41a5-8afb-271706420b1d', '#ef4444', '#fb923c'),
  ('8573a203-cdb7-46cf-89e5-a91eb6747c4a', '#ef4444', '#facc15'),
  ('6b19176b-5559-42d3-8ee7-bab436144a03', '#ef4444', '#4ade80')
) as v(pk, old_color, new_color)
where t.id = v.pk::uuid and lower(t.color) = v.old_color;

-- dr_downtime_types: 40 แถวที่สีซ้ำ → สีใหม่ไม่ซ้ำ (guard: เขียนเฉพาะแถวที่ยังเป็นสีเดิม)
update dr_downtime_types t set color = v.new_color
from (values
  ('a8d45a9c-7b66-4bf1-bfaf-dec3e76bec69', '#ef4444', '#10b981'),
  ('62014aba-845e-488e-b66f-d71ce73dce21', '#f97316', '#3b82f6'),
  ('aa3aff7b-c79b-4af9-857d-a532da84507f', '#f59e0b', '#d946ef'),
  ('8d643ce1-f2a1-422d-9057-8459a6dfdeb4', '#a855f7', '#facc15'),
  ('bf13c8d6-a0df-4b05-86e9-e9f5ee895f25', '#8b5cf6', '#2dd4bf'),
  ('de23b1ac-dce6-4807-a8cd-6d3c8409df08', '#ec4899', '#a78bfa'),
  ('514ad52c-51ba-4aa2-b78a-637c32d413e5', '#fb923c', '#e879f9'),
  ('57badd2c-829b-4842-a352-65e80e4ed5d7', '#fbbf24', '#f87171'),
  ('949606bd-5e48-40b8-ab2e-8b5dda1cbd43', '#eab308', '#c32222'),
  ('cae00395-4933-46db-8675-0f1dee257fe4', '#4ade80', '#3cdd6b'),
  ('49ceb939-730d-4808-935f-ec0a8aaf23ec', '#34d399', '#a95ae2'),
  ('13633220-4b2c-4667-a6ed-8b42bfd3acb0', '#14b8a6', '#c3af22'),
  ('961f2ca6-5bff-4795-9efa-cb3303f2bef2', '#06b6d4', '#3cc2dd'),
  ('948351f0-e265-4765-bf2b-12445fc9266c', '#0ea5e9', '#e25aa4'),
  ('c3151a4e-e66c-47b4-8ce2-e64a8afa0471', '#94a3b8', '#6b7280'),
  ('01721283-7b83-426e-bb28-219aafd09a71', '#94a3b8', '#64748b'),
  ('80bb01ab-e942-481b-b983-e581c8bfba04', '#ef4444', '#4ac322'),
  ('fd3860dd-fde6-4842-b705-17b6bc1150e2', '#ef4444', '#433cdd'),
  ('6c2c9915-6194-445c-a53b-de63b6e53ddf', '#ef4444', '#e2885a'),
  ('f5559c67-6994-4545-a92b-eb4630b69957', '#ef4444', '#22c387'),
  ('edd57215-2047-446b-894e-a7fccc61ffc1', '#ef4444', '#cf3cdd'),
  ('15c7d6ae-c634-423d-86d0-070c92c3163c', '#ef4444', '#c5e25a'),
  ('70035327-ec87-4028-b227-d74b42c436b3', '#ef4444', '#2272c3'),
  ('997eb4ed-4481-4db2-a72f-c5a8c98faddb', '#ef4444', '#dd3c5d'),
  ('d0a5ecf2-dc5a-48ef-ae1c-dc95ab71cb65', '#ef4444', '#5ae266'),
  ('7c593965-ff3e-48e2-87cf-8e4820610d10', '#ef4444', '#5f22c3'),
  ('81c53d13-08b1-476e-9b08-aba5abe295cf', '#ef4444', '#dda73c'),
  ('623ffd3d-338b-4ef3-a9f8-361e800feca6', '#ef4444', '#5ae2dd'),
  ('7a21f99e-eb7f-4237-b095-942a65dea1d8', '#ef4444', '#c3229b'),
  ('1daf7b6b-15e2-48ca-b55a-5ca8342598a4', '#ef4444', '#85dd3c'),
  ('5b2a30a5-20d5-4746-aeed-c9d0b5b159d7', '#ef4444', '#5a71e2'),
  ('bc638d20-61e2-42b3-8c1e-833075a4d74b', '#ef4444', '#c33722'),
  ('49421914-9ec5-4fde-876f-9c896cfdb91b', '#ef4444', '#3cdd7f'),
  ('f60ac28e-8490-429d-b565-f6f53e8dc2a0', '#ef4444', '#bb5ae2'),
  ('ff029b30-c9b8-43a2-b133-cd6bb2034de6', '#ef4444', '#c3c322'),
  ('9278c7be-3820-4f5d-ac21-27e471b81368', '#ef4444', '#3caddd'),
  ('d8709244-0f3c-452c-ba1a-71115660c50b', '#ef4444', '#e25a92'),
  ('e633b445-1018-4b6e-a592-ed6c3e544558', '#ef4444', '#36c322'),
  ('e57c668f-ecac-49aa-ae7f-c3efd256893b', '#ef4444', '#573cdd'),
  ('216cf309-764b-4699-ad93-f0d4885fd8ba', '#ef4444', '#e2995a')
) as v(pk, old_color, new_color)
where t.id = v.pk::uuid and lower(t.color) = v.old_color;

