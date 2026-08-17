-- ลักษณะปัญหา 2 ชั้น (กลุ่ม → หัวข้อย่อย) + แยก "ใครเห็น" ออกจาก "ใครเป็นเจ้าของ"
-- Project: DR (eyhclzkifitbhbljgoav) · 2026-08-11
--
-- ═══ ที่มา 2 เรื่อง ═══
-- (1) feedback จากทีมงาน (Nuttchon) หลังลองใช้จริง:
--     "ลักษณะปัญหาถ้าใส่ทั้งหมดมันเยอะ พนักงานเลือกลำบาก · ช่องรายละเอียดที่กรอก Auto
--      ข้อมูลซ้ำกับช่องเดิม · เสนอให้ลักษณะปัญหาเป็น Group ใหญ่ แล้วรายละเอียดเป็นหัวข้อย่อย"
--     → นับจริง: DIE MTN เห็น 29 ตัวใน dropdown เดียว (ของแม่พิมพ์ 22 + ของกลาง 7)
--
-- (2) คำสั่ง user เรื่องการมองเห็นข้ามทีม:
--     "ช่างที่เจอปัญหาก่อนใครคือช่างฝ่ายผลิต ทุกปัญหาต้องส่งถึง/ต้องเห็นได้ทั้งหมด
--      แม่พิมพ์แยกไป DIE MTN ได้ชัดเจน แต่ JIG MTN กับ MTN ค่อนข้างคลุมเครือ
--      มีแค่ JIG Fixture ที่ JIG รับผิดชอบแน่ๆ เรื่องอื่นทับซ้อนกับ MTN ในบางเคส"
--
-- ═══ หลักที่ได้ ═══
--   `team`         = **เจ้าของ** (ใครแก้แถวนี้ได้)  ← กฎ ownership เดิม ไม่เปลี่ยน
--   `shared_teams` = **ทีมอื่นที่เห็นด้วย** (เห็นในฟอร์มแจ้งซ่อม แต่แก้ไม่ได้)  ← ใหม่
--   ทีม AM (production) = **เห็นทุกแถวเสมอ** — เป็นกฎในโค้ด ไม่ใช่ข้อมูล
--     (ความจริงเชิงกระบวนการ: ผลิตเจอปัญหาก่อนใคร ถ้าต้องมาติ๊ก shared ทีละแถวจะตกหล่นแน่)
--
-- ⚠️ ห้ามยุบ 2 คอลัมน์นี้เป็นตัวเดียว — "เห็น" กับ "แก้" คนละเรื่อง
--    ยุบแล้วจะได้อย่างใดอย่างหนึ่ง: ล็อกแน่นจนผลิตไม่เห็น หรือ หลวมจนใครก็แก้ของทีมอื่น

-- ── (1) กลุ่มของลักษณะปัญหา ────────────────────────────────────
alter table public.mtn_problem_types add column if not exists group_name text;
create index if not exists mtn_problem_types_group_idx on public.mtn_problem_types (group_name);

comment on column public.mtn_problem_types.group_name is
  'กลุ่มใหญ่ของลักษณะปัญหา (เช่น "ระบบลม") — null = ยังไม่จัดกลุ่ม จะไปรวมอยู่กลุ่ม "อื่นๆ" ในฟอร์ม';

-- เก็บกลุ่มลงใบซ่อมด้วย ไม่งั้นพาเรโต้ระดับกลุ่มทำไม่ได้ (KPI จัดกลุ่มด้วยข้อความ snapshot)
alter table public.mtn_orders add column if not exists problem_group text;

-- ── (2) ทีมอื่นที่เห็นแถวนี้ได้ (นอกจากเจ้าของ) ─────────────────
alter table public.mtn_problem_types add column if not exists shared_teams text[];
alter table public.mtn_item_types    add column if not exists shared_teams text[];

comment on column public.mtn_problem_types.shared_teams is
  'ทีมอื่นที่เห็นรายการนี้ด้วย (mtn_teams.key) — เห็นได้แต่แก้ไม่ได้ · เจ้าของยังเป็น team
   ใช้กับเคสที่งานทับซ้อน เช่น JIG MTN ↔ MTN · ทีม AM เห็นทุกแถวอยู่แล้วไม่ต้องใส่';

-- ── (3) ติดกลุ่มให้ลิสต์แม่พิมพ์ที่ seed ไว้เมื่อวาน ────────────
--     แบ่งตามที่ seed มาอยู่แล้ว (20260810_mtn_die_master_lists.sql เรียงเป็นกลุ่มในตัวอยู่แล้ว)
--     ⚠️ ไม่แตะลิสต์ของ JIG MTN / MTN — ให้ทีมนั้นจัดกลุ่มเอง (กฎ "ใครเป็นเจ้าของ คนนั้นแก้")
update public.mtn_problem_types set group_name = 'คมตัด / ชิ้นส่วนหลัก'
 where team = 'die_maintenance' and characteristic in
 ('พันช์ บิ่น/แตก','พันช์ สึก/ทื่อ','ดาย บิ่น/แตก','ดาย สึก/ทื่อ','ถึงรอบเจียร/ลับคม');

update public.mtn_problem_types set group_name = 'อาการที่ชิ้นงาน'
 where team = 'die_maintenance' and characteristic in
 ('ชิ้นงาน มีครีบ','ชิ้นงาน ยับ/ย่น','ชิ้นงาน แตก/ฉีก','ชิ้นงาน เป็นรอย/ขีดข่วน','ชิ้นงาน ผิดขนาด/เยื้องศูนย์');

update public.mtn_problem_types set group_name = 'การไหลของชิ้นงาน/เศษ'
 where team = 'die_maintenance' and characteristic in ('เศษติดแม่พิมพ์','ชิ้นงานติดแม่พิมพ์');

update public.mtn_problem_types set group_name = 'ชิ้นส่วนกลไก'
 where team = 'die_maintenance' and characteristic in
 ('สปริง หัก/ล้า','แก๊สสปริง รั่ว/แรงตก','สตริปเปอร์ ชำรุด/ติดขัด','ไกด์โพสต์/ไกด์บุช สึก-ฝืด',
  'โลเคเตอร์/พินกำหนดตำแหน่ง ชำรุด','ลิฟเตอร์ ชำรุด','แคมสไลด์ ติดขัด');

update public.mtn_problem_types set group_name = 'ระบบประกอบของแม่พิมพ์'
 where team = 'die_maintenance' and characteristic in
 ('เซนเซอร์แม่พิมพ์ ชำรุด','ระบบหล่อลื่น ผิดปกติ','โบลท์/แคลมป์ยึดแม่พิมพ์ คลาย');

-- ── (4) ของกลางเดิม จัดกลุ่มตามระบบ (เห็นทุกทีมอยู่แล้ว) ───────
update public.mtn_problem_types set group_name = 'ระบบลม'
 where team is null and characteristic in ('ลมรั่ว','กระบอกลม ชำรุด');
update public.mtn_problem_types set group_name = 'ไฟฟ้า / ควบคุม'
 where team is null and characteristic in ('ระบบไฟฟ้า ชำรุด','เซนเซอร์ ชำรุด','ปรับ Poka-yoke','เครื่องมาร์ค ชำรุด');

-- Rollback:
--   alter table public.mtn_problem_types drop column group_name, drop column shared_teams;
--   alter table public.mtn_item_types    drop column shared_teams;
--   alter table public.mtn_orders        drop column problem_group;
--   (โค้ดฝั่งเว็บอ่านแบบ tolerant — ไม่มีคอลัมน์ = ทำงานแบบเดิม ลิสต์ชั้นเดียว)
