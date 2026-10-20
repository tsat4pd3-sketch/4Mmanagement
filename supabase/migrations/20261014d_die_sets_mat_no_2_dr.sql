-- ═══════════════════════════════════════════════════════════════════════════════
-- ชุดแม่พิมพ์ผูกได้ 2 MAT (งานคู่ RH/LH)  · project: DR "Product DB" (eyhclzkifitbhbljgoav)
-- คำสั่ง user 2026-10-14: "แม่พิมพ์ปั๊มออกคู่ ซ้ายขวา ก็ควรเลือก mat สองตัวนะ"
-- ═══════════════════════════════════════════════════════════════════════════════
-- เดิม die_sets.mat_no เป็นช่องเดียว ⇒ gang die ที่ปั๊ม RH+LH ลงทะเบียนได้ข้างเดียว
-- ผลที่ตามมา (วัดจากโค้ด ไม่ใช่สมมติฐาน):
--   · ProdLotPlanner:160,218  `dies.filter(d => d.mat_no === mat)` ⇒ ล็อตของอีกฝั่ง
--     **หาแม่พิมพ์ไม่เจอ** → ไม่รู้ die_height_mm → คิดเวลาเปลี่ยนรุ่นไม่ได้ (pressSetup คืน unknown)
--   · DieLayout:107 ผูกชุด → ไลน์ผ่าน mat ⇒ ชุดที่ลงอีกฝั่งไว้ไม่รู้ว่าอยู่ไลน์ไหน
--
-- ⚠️ ไม่ใช่ตัวเดียวกับ dr_products.pair_mat_no:
--   pair_mat_no = "พาร์ทนี้คู่กับใคร" (Product Master เป็นเจ้าของ · ใช้ยุบ shot ใน OEE)
--   mat_no/_2   = "แม่พิมพ์ชุดนี้ทำพาร์ทอะไร" (ทะเบียนแม่พิมพ์เป็นเจ้าของ)
--   สองชุดนี้ควรสอดคล้องกัน — ไม่ตรง = จอเตือน (dieSetPairState) **ห้ามเขียนทับให้เอง**
--
-- blast radius: คอลัมน์ใหม่ nullable ไม่มี default ⇒ ทุกแถวเดิม null = พฤติกรรมเดิมเป๊ะ
--   (dieSetMats() คืนลิสต์ 1 ตัวเท่าเดิม · dieMakesMat() ตอบเท่า `=== mat` ทุกกรณี)
-- rollback: alter table public.die_sets drop column mat_no_2;
-- ═══════════════════════════════════════════════════════════════════════════════

alter table public.die_sets add column if not exists mat_no_2 text;

comment on column public.die_sets.mat_no_2 is
  'MAT ตัวที่ 2 ที่ชุดนี้ปั๊มออกมาพร้อมกัน (งานคู่ RH/LH) · null = ชุดนี้ทำพาร์ทเดียว · '
  'อ่านผ่าน dieSetMats()/dieMakesMat() ใน src/utils/dieSetMats.js เท่านั้น ห้ามเทียบ mat_no ตรงๆ';
