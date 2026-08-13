-- ลิสต์ "ชนิดอุปกรณ์" + "ลักษณะปัญหา" ของแม่พิมพ์ (DIE MTN) ในฟอร์มแจ้งซ่อม MO
-- Project: DR (eyhclzkifitbhbljgoav) · 2026-08-10
--
-- ที่มา (ทีมงานแจ้งทางแชท 2026-08-10):
--   "ชนิดอุปกรณ์ และลักษณะปัญหา ของแม่พิมพ์ครับ — ต้องเพิ่ม List เข้าไปเป็นของแม่พิมพ์โดยเฉพาะ"
--
-- ปัญหา: seed ตั้งต้น (20260714_mtn_work_order.sql) มาจากระบบ AppSheet ของ JIG MTN ล้วน
--   ชนิดอุปกรณ์ 7 ตัว = JIG / ROBOT HANDLING / ROBOT SPOT WELD / ROBOT ARC WELD /
--                       STATIONARY / CONVEYOR / NUT FEEDER   ← ไม่มีแม่พิมพ์
--   ลักษณะปัญหา 21 ตัว = โลเคเตอร์/แคลมป์/กระบอกลม/โรบอท/นัทฟีดเดอร์ ← เรื่อง jig fixture ล้วน
--   → ทีม DIE MTN เปิดฟอร์มแจ้งซ่อมแล้ว "ไม่มีอะไรให้เลือกที่ตรงกับงานตัวเอง"
--
-- วิธี: ใช้แกน `team` ที่มีอยู่แล้ว (20260806_mtn_master_team_scope.sql)
--   team = 'die_maintenance' → เห็นเฉพาะทีม DIE MTN (filterByTeam ใน src/utils/mtnTeams.js)
--   แถวเดิมยังเป็น null (= ใช้ร่วมทุกทีม) ไม่ถูกแตะ → ทีม JIG/MTN เห็นเหมือนเดิมเป๊ะ
--
-- ⚠️ ชนิดอุปกรณ์ทุกตัวขึ้นต้นด้วย "DIE"
--    เพื่อให้ `teamForItem()` fallback เดาทีมถูก (ชื่อมี DIE → die_maintenance)
--    แม้ในกรณีที่คอลัมน์ team ยังไม่ apply — ดู src/utils/mtnTeams.js บรรทัด "if (s.includes('DIE'))"
--
-- ⚠️ ชนิดแม่พิมพ์อิงค่าที่มีจริงในระบบ ไม่ได้ตั้งลอยๆ
--    die_sets.kind = tandem / progressive / transfer / single (backfill 2026-08-10: 92 ชุด)
--
-- sort_order เริ่ม 101 เพื่อไม่ชนของเดิม (1-19, 99)
-- idempotent: รันซ้ำไม่เกิดแถวซ้ำ (where not exists — ตารางไม่มี unique constraint บนชื่อ)
-- ปรับ/ลบ/เพิ่มเองได้ที่ /mtn-repair → ⚙️ ข้อมูลตั้งต้น (เลือกทีม DIE MTN) โดยไม่ต้องแก้โค้ด

-- ── ชนิดอุปกรณ์ของแม่พิมพ์ ──────────────────────────────────
insert into public.mtn_item_types (name, team, sort_order)
select v.name, 'die_maintenance', v.ord
from (values
  ('DIE TANDEM',      101),   -- แม่พิมพ์แทนเด็ม (ปั๊มต่อเนื่องหลายเครื่อง)
  ('DIE PROGRESSIVE', 102),   -- แม่พิมพ์โปรเกรสซีฟ (ปั๊มต่อเนื่องในชุดเดียว)
  ('DIE TRANSFER',    103),   -- แม่พิมพ์ทรานสเฟอร์
  ('DIE SINGLE',      104),   -- แม่พิมพ์เดี่ยว (OP เดียว)
  ('DIE SET (ไม่ระบุชนิด)', 105)
) as v(name, ord)
where not exists (
  select 1 from public.mtn_item_types t where upper(t.name) = upper(v.name)
);

-- ── ลักษณะปัญหาของแม่พิมพ์ ─────────────────────────────────
--    จัดกลุ่ม: ชิ้นส่วนแม่พิมพ์ชำรุด → อาการที่ชิ้นงาน → ระบบประกอบ
insert into public.mtn_problem_types (characteristic, detail, team, sort_order)
select v.c, v.d, 'die_maintenance', v.ord
from (values
  -- คมตัด / ชิ้นส่วนหลัก
  ('พันช์ บิ่น/แตก',            '(Punch-บิ่น,แตก,หัก,คมเสียหาย)',                          101),
  ('พันช์ สึก/ทื่อ',             '(Punch-สึกหรอ,คมทื่อ,ต้องลับคม)',                         102),
  ('ดาย บิ่น/แตก',              '(Die Block-บิ่น,แตก,ร้าว)',                               103),
  ('ดาย สึก/ทื่อ',               '(Die Block-สึกหรอ,คมทื่อ,ระยะคลีแรนซ์เปลี่ยน)',            104),
  ('ถึงรอบเจียร/ลับคม',          '(Regrind-ครบรอบเจียร,คมไม่ได้ขนาด)',                      105),
  -- อาการที่ปรากฏบนชิ้นงาน
  ('ชิ้นงาน มีครีบ',             '(Burr-ครีบเกินสเปค,คมตัดสึก,คลีแรนซ์ไม่เหมาะสม)',          106),
  ('ชิ้นงาน ยับ/ย่น',            '(Wrinkle-แรงกดโฮลเดอร์,ระยะดึงขึ้นรูป)',                   107),
  ('ชิ้นงาน แตก/ฉีก',            '(Crack,Split-วัสดุฉีกขณะขึ้นรูป)',                        108),
  ('ชิ้นงาน เป็นรอย/ขีดข่วน',     '(Scratch-ผิวแม่พิมพ์,เศษโลหะติดผิว)',                     109),
  ('ชิ้นงาน ผิดขนาด/เยื้องศูนย์',  '(Out of Spec,Misalign-ตำแหน่งเจาะ,ระยะไม่ได้)',           110),
  -- การไหลของชิ้นงาน/เศษ
  ('เศษติดแม่พิมพ์',             '(Scrap Jam-เศษค้างในดาย,ท่อทิ้งเศษตัน)',                   111),
  ('ชิ้นงานติดแม่พิมพ์',          '(Part Sticking-ชิ้นงานไม่หลุดจากพันช์/ดาย)',               112),
  -- ชิ้นส่วนกลไก
  ('สปริง หัก/ล้า',              '(Spring-หัก,ล้า,แรงกดตก)',                                113),
  ('แก๊สสปริง รั่ว/แรงตก',        '(Gas Spring-รั่ว,ความดันตก)',                            114),
  ('สตริปเปอร์ ชำรุด/ติดขัด',     '(Stripper-ไม่ปลดชิ้นงาน,ติดขัด)',                         115),
  ('ไกด์โพสต์/ไกด์บุช สึก-ฝืด',   '(Guide Post,Guide Bush-สึก,ฝืด,ติด)',                     116),
  ('โลเคเตอร์/พินกำหนดตำแหน่ง ชำรุด', '(Locating Pin-หัก,สึก,ตำแหน่งเคลื่อน)',               117),
  ('ลิฟเตอร์ ชำรุด',             '(Lifter-ไม่ยกชิ้นงาน,ติดขัด)',                            118),
  ('แคมสไลด์ ติดขัด',            '(Cam Slide-ฝืด,ติด,เคลื่อนไม่สุดระยะ)',                    119),
  -- ระบบประกอบของแม่พิมพ์
  ('เซนเซอร์แม่พิมพ์ ชำรุด',      '(Die Sensor-ตรวจจับผิดพลาด,สายขาด)',                      120),
  ('ระบบหล่อลื่น ผิดปกติ',        '(Lubrication-น้ำมันไม่จ่าย,หัวฉีดตัน)',                    121),
  ('โบลท์/แคลมป์ยึดแม่พิมพ์ คลาย', '(Clamp,Bolt-คลายตัว,หลวม,แม่พิมพ์ขยับ)',                  122)
) as v(c, d, ord)
where not exists (
  select 1 from public.mtn_problem_types t where t.characteristic = v.c
);

-- หมายเหตุ: ไม่ seed "อื่นๆ" ของแม่พิมพ์ — ใช้แถว 'อื่นๆ' เดิมที่เป็น common (team null) ร่วมกัน
--            ไม่งั้นทีม DIE จะเห็น "อื่นๆ" สองตัวในลิสต์เดียว
--
-- Rollback:
--   delete from public.mtn_item_types    where team = 'die_maintenance' and sort_order between 101 and 105;
--   delete from public.mtn_problem_types where team = 'die_maintenance' and sort_order between 101 and 122;
--   (ปลอดภัย: ใบซ่อมเก็บ item_type/problem_characteristic เป็น "ข้อความ snapshot"
--    ลบ master แล้วใบเก่ายังอ่านออกเหมือนเดิม — ดูกฎ NAME_CASCADE ใน CLAUDE.md)
