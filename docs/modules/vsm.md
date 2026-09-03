# Value Stream Mapping — `/vsm` (เฟส 1 · 2026-08-13)

> ย้ายมาจาก `CLAUDE.md` (2026-09-03 — แยกไฟล์เพื่อลด context) · โหลด**เฉพาะเมื่อแตะโมดูลนี้** · แก้ไฟล์นี้แทน CLAUDE.md เมื่อกฎของโมดูลเปลี่ยน


หน้า VSM (`VSM.jsx`, กลุ่มวิเคราะห์ & รายงาน) — เลือกสินค้าสำเร็จรูป (mat เบอร์ 1) + เดือน แล้ว
**ระบบสร้างแผนผังสายธารคุณค่าจากข้อมูลจริง** ตามมาตรฐานสากล (Learning to See) ให้ตรงกับใบกระดาษเดิมของบริษัท
· ออกแบบเต็ม + ตารางที่มาของทุกช่อง: **`docs/VSM-DESIGN.md`**

- **ช่องเกือบทั้งใบ generate ได้จากข้อมูลที่มีอยู่แล้ว** — CT (`dr_products`) · %OEE (กะที่ปิดแล้ว ผ่าน `wavg` ถ่วงเวลารับภาระ)
  · **C/O จาก downtime ที่จัดหมวด `six_big_loss='setup'`** (ผลพลอยได้จากงาน Lean 2026-08-05) · LOT (`kanban_standards`)
  · คน (`stdManpower`) · คงคลัง (view `line_stock_summary`) · Order/วัน (`customer_forecasts` ÷ วันทำงานจากปฏิทินบริษัท)
  · AT (`shift_min` − พักตามนโยบาย) · TT · PLT/PT/%VA
- **⚠️ สูตร %VA — ตัวหารคูณ AT ไม่ใช่ 86,400:** `VA = PT` · **`NVA = PLT(วัน) × AT(วินาที/วัน)`** · `%VA = VA÷(VA+NVA)×100`
  ถอดกลับจากใบจริง 2 ใบแล้วตรงเป๊ะทั้งคู่ (81 × 56,400 + 48,162 = 4,616,562 = ตัวหารที่พิมพ์ในใบ)
  ถ้าใช้ 86,400 จะได้ %VA ต่ำกว่าใบจริงเกือบเท่าตัว — **สูตรอยู่ `src/lib/vsmModel.js` จุดเดียว**
- **🔀 Routing master (ตารางใหม่ `part_routings` · DR):** ระบบไม่เคยมีชั้น "ลำดับกระบวนการ" (`bom_items` บอกแค่ FG→ลูก 1 ชั้น)
  → จัดการที่ **Product Master → แท็บ 🔀 Routing** (พาร์ท → ขั้น 1,2,3 → ไลน์/เครื่อง/จุดพัก) · สิทธิ์ `routing:manage`
  · **ค่าว่างในแถว routing = "ให้ระบบไปหาจากข้อมูลจริง"** กรอกทับเฉพาะตอนค่าจริงไม่ตรง
  · **พาร์ทที่ยังไม่ลง routing ไม่ตัน** — ใช้ไลน์เดียวจาก Product Master ไปก่อน (`is_fallback`) **แล้วขึ้นเตือนบนจอเสมอ ห้ามเงียบ**
- **⚠️ WIP กลางทางระบบไม่ได้เก็บ — ต้องกรอกเอง** (ช่องขอบส้ม + ▲ เส้นประบนผัง + เตือนว่า "PLT จะต่ำกว่าความจริง")
  · เช่นเดียวกับ **รอบส่ง supplier (7:1:1)** และ **งานจ้างนอก** — ระบบไม่มีข้อมูล **ห้ามเดาเลขให้**
- **เก็บเป็น snapshot** (`vsm_maps.data` jsonb) ไม่คำนวณสดตอนเปิดดู — VSM คือภาพ ณ ช่วงเวลาหนึ่ง (ใบจริงเขียน *Information on July 25*)
  ถ้าคำนวณสด ใบที่อนุมัติไปแล้วจะเปลี่ยนตัวเลขเองเงียบๆ · กด **"↻ ดึงข้อมูลใหม่"** เพื่อ regenerate เอง
- **ผังเป็น auto-layout จากโมเดล ไม่ใช่ลากวางอิสระ** → regenerate แล้วจัดผังใหม่ให้เอง · สัญลักษณ์ทั้งชุดอยู่ `SYMBOLS`
  ใน `src/components/VsmCanvas.jsx` **จุดเดียว — legend สร้างจาก registry เดียวกัน ห้ามวาดสัญลักษณ์ซ้ำที่อื่น**
- **⚠️ สัญลักษณ์ที่อยู่ใน legend ต้องถูกวาดจริงบนผังด้วย** — เคยพลาด: legend โฆษณา 15 ตัว แต่ผังวาดจริง 3 ตัว
  (feeder/supermarket/kanban/pull/info-flow ไม่เคยถูกวาด · `model.feeders` คำนวณไว้แล้วแต่ canvas ไม่เรียก
  · supplier โชว์แค่รายแรก) = legend โกหกคนอ่าน · ตอนนี้วาดครบ: สายป้อน (พาร์ทลูกที่ไม่ใช่สายหลัก วาดเหนือสายหลัก
  แล้วชี้ลงกล่องแรก) · ผู้ส่งมอบทุกราย (เกิน 3 ขึ้น "+ อีก N ราย") · **จุดคงคลังที่มี kanban วาดเป็น supermarket +
  ลูกศรดึง + การ์ดคัมบัง** (ไม่มี kanban = สามเหลี่ยม I + ลูกศรผลัก) · เส้นข้อมูล electronic (หยัก) vs manual (ตรง)
  · กล่องจ้างนอกสีม่วง + ชื่อผู้รับจ้าง
- **รอบส่ง supplier/ลูกค้า (7:1:1 · 1:4:2) ระบบไม่มีข้อมูล** → กรอกในหน้า เก็บที่ `overrides.__supplier_pattern` /
  `__customer_pattern` — **ห้ามเดาให้**
- **พิมพ์ได้ 2 ใบ — ทั้งคู่ A3 แนวนอน บังคับจบใน 1 หน้า:**
  1. **📋 A3 Report (Toyota/Denso)** `src/lib/vsmA3Print.js` — เอกสารเล่าเรื่องหน้าเดียวตาม PDCA:
     ซ้าย ① ความเป็นมา → ② สภาพปัจจุบัน (**ผัง VSM + ข้อเท็จจริงที่ระบบสรุปให้เอง**) ·
     ขวา ③ เป้าหมาย → ④ สาเหตุราก → ⑤ มาตรการ → ⑥ แผนดำเนินการ (ใคร/อะไร/เมื่อไหร่) → ⑦ ติดตามผล
     · เนื้อหาเก็บใน `vsm_maps.data.a3` (ไม่ต้อง migration) กรอกที่ปุ่ม ✍️ เนื้อหา A3
     · **`currentConditionFacts(model)` สรุปเฉพาะ "ข้อเท็จจริง" จากข้อมูล** (PLT/%VA/Takt · ขั้นที่ C/T เกิน Takt ·
       คงคลังกินเวลามากสุด · OEE ต่ำสุด · C/O สูงสุด) — **ส่วนที่เป็นการวิเคราะห์/สาเหตุ ระบบไม่เดาให้**
  2. **🖨️ ใบ VSM** `src/lib/vsmPrint.js` — ใบผังอย่างเดียวตามฟอร์มเดิมของบริษัท
- **⚠️ "จบใน 1 หน้า" ต้องใช้ `el.style.zoom` ห้ามใช้ `transform: scale`** — transform เป็นภาพลวงตา ไม่ลดกล่อง
  layout เบราว์เซอร์ยังนับหลายหน้า (บทเรียนเดียวกับใบประเมินรายบุคคล F-PRS-P1-119) · วัดหลัง `document.fonts.ready`
- **ใบพิมพ์ clone `outerHTML` ของ SVG ตัวจริงบนจอไปใช้ ไม่วาด layout ใหม่**
  (กฎ CLAUDE.md: ห้ามจำลอง layout ใบจริงมาไว้ในตัวพิมพ์) — หน้าจอ render SVG ซ้ำแบบชุดสีสว่างซ่อนไว้สำหรับพิมพ์
  · เลขฟอร์ม/Rev/ช่องเซ็น/โลโก้/แนวกระดาษ อ่านจากทะเบียน doc_key **`vsm`** (`layout_locked=false` เปลี่ยนแนวกระดาษได้จริง)
- **Scope มาตรฐาน:** leader = family ไลน์ตัวเอง · role อื่น = ตาม `sections` — **ตัวเลือกสินค้าก็ scope ด้วย**
- **⚡ แท็บ "สายธารสด (Realtime)" (2026-08-19 · คำสั่ง user "อัพเกรดเป็น VSM realtime"):** หน้า `/vsm` เป็น 2 แท็บผ่าน `PageHeader`+`useTabParam` — `doc` (เอกสาร snapshot เดิม พฤติกรรมเดิมทุกอย่าง) / `live` (มุมมองสด)
  - **ไม่แตะกฎ snapshot** — ใบที่บันทึก/พิมพ์ยังเป็น snapshot เท่านั้น · โหมดสด**ไม่บันทึก/ไม่พิมพ์** (บอกบนจอ) — **ห้ามเอาค่าสดไป stamp ทับใบ VSM**
  - โครงค่ามาตรฐาน (CT/C-O/%OEE เฉลี่ย/AT/TT/BOM/routing) = ข้อมูล**เดือนปัจจุบัน**ผ่าน `fetchRaw` (query ชุดเดียวกับปุ่ม generate — refactor ให้ใช้ร่วมกัน ห้าม duplicate) โหลด**ครั้งเดียวต่อ FG** · ชั้นสด = **`src/lib/vsmLive.js` (pure · เทส 7 เคส `src/lib/__tests__/vsmLive.test.mjs`)**: สถานะไลน์ down/run/closed/idle · OEE กะปัจจุบันผ่าน `computeLiveOee` (null + เหตุผล ตามกฎ "ประเมินไม่ได้ = null ห้ามเป็น 0") · OEE กะปิดแล้ววันนี้ = ค่า stamp ผ่าน `wavg`+`wLoad` · NG ผ่าน `sumDefectQty(rows,'line')` (query join `dr_defect_types(excl_from_q)`) · ยอดวันนี้ต่อขั้น = สูตรบังคับ `confirmed ? (qty_ok ?? qty) : (qty_actual ?? 0)` · Andon ผ่าน `isOpenDT/isPlannedDT` — planned ค้างไม่แดง แต่โชว์แยกแบบสงบ (ห้ามซ่อน)
  - **▲ คงคลัง → PLT/%VA ในโหมดสด rebuild จาก `line_stock_summary` ปัจจุบัน** (สูตรเดิมใน vsmModel — WIP กลางทางยังไม่มีข้อมูล จอเตือนว่า PLT อาจต่ำกว่าจริง)
  - refresh ตามกฎ egress: **realtime channel `vsm-live` (4 ตารางใน publication) เป็นหลัก + `usePolling(RATE.BOARD)` กันเหนียว** (แท็บซ่อน = หยุดยิง DB) · query สดกรอง `.in('line_name', chainLines)`/`.in('session_id', ids)` payload เล็ก · query พลาด = flag `partial` ขึ้นแถบส้ม **ห้ามเงียบ**
  - `VsmCanvas` รับ prop `live` (additive — ไม่ส่ง = render เดิมเป๊ะ ใบพิมพ์ clone จากแท็บเอกสารจึงไม่กระทบ): ขอบกล่อง **แดงกระพริบ (SMIL `<animate>` — Andon แดงเท่านั้นที่กระพริบ) = DT ค้าง** · เขียว = กำลังผลิต · เส้นประจาง = ยังไม่เปิดกะ + `<title>` tooltip · สี/ป้ายสถานะรวมศูนย์ที่ `LIVE_STATUS` ใน vsmLive.js **ห้ามนิยามซ้ำ**
  - **`isOpenDT/isPlannedDT/isAlarmingDT/dtElapsedMin` ย้ายไป `src/utils/downtimeRules.js` (pure)** — `downtimeAlarm.js` re-export ให้ import เดิม (Dashboard/Management/DeptHub) ใช้ได้เหมือนเดิม · เหตุผล: lib ที่รันใน node:test ห้ามลาก supabaseClient (`import.meta.env` พังนอก Vite) · **นิยาม Andon แก้ที่ downtimeRules.js ที่เดียว**
  - **ไม่มี migration/permission ใหม่** — read-only ใช้ `page:/vsm` เดิม (เลี่ยงกับดัก seed `enum_range`)
- **📋 worklist "ข้อมูลที่ VSM ยังขาด" (2026-08-20 · คำขอ user หลัง audit):** แผงบนแท็บเอกสารแทนบล็อก warning เดิม — ข้อความชุดเดียวกับ `model.warnings` (single source: การตรวจอยู่ `buildVsmModel` ที่เดียว) + **ปุ่มลิงก์ "ไปลงข้อมูลที่ต้นทาง"** ผ่าน `src/lib/vsmGaps.js` (จับคู่ `warning.code` → ลิงก์) · **เพิ่ม warning ใหม่ในโมเดลต้องใส่ `code` + เติม `FIX` ใน vsmGaps ด้วย** — code ที่ไม่รู้จักยังแสดง (ไม่มีลิงก์) ห้ามหายเงียบ · เพิ่ม warning รวม 2 ตัว: `no_oee` (ขั้นที่ไลน์ไม่มีกะปิดเดือนนั้น) + `no_setup` (C/O ไม่มี downtime หมวด setup) · routing ชี้ไป **`/pe-docs?set=<id>` เมื่อ FG มีชุด PFC** (จับคู่ `pe_doc_sets.mat_no` ก่อน แล้ว `matchDocSet` ด้วย p_no) · ครบทุกช่อง = ขึ้น ✅ ห้ามซ่อนแผง · **ProductMaster แท็บผูก URL แล้ว (`useTabParam` — `/products?tab=routing` deep-link ได้)**
- **⚠️ ข้อความบนผัง (เส้นข้อมูล/กล่อง SALE & PLANNING) ต้องมาจาก `model.info` ที่นับจากข้อมูลจริง ห้าม hardcode claim (2026-08-20 · user ทัก "อย่ามั่ว ไม่รู้ก็บอกไม่รู้"):** เดิม canvas พิมพ์ "Forecast 12 เดือน (EDI 830)"/"Order รายวัน (EDI 862)"/"แผนผลิตรายวัน" ตายตัวทั้งที่ Order/month ของพาร์ทนั้น = "—" · ตอนนี้ `buildVsmModel` นับให้: `forecastMonths`/`forecastSource` (EDI 830/กรอกมือ) · `orderCount`/`orderSource` (EDI 862/คีย์มือ — fetchRaw ต้อง select `source` ด้วย) · `planDays` (วันที่มีกะปิดจริงของไลน์ในสาย) → ไม่มีข้อมูล = เขียน "ยังไม่มีในระบบ" สี NVA · เส้นสั่งซื้อ supplier = "สั่งซื้อ (ยังไม่มีข้อมูลในระบบ)" จนกว่าจะมีข้อมูลใบสั่งซื้อจริง · snapshot เก่าที่ไม่มี field ใหม่ fallback จาก `demandSource` ห้ามตีความ undefined เป็น "ไม่มี" · **`ctForMat` (utils/oee) คืน 0 เมื่อไม่รู้ — `processBox` แปลง CT/LOT ≤ 0 เป็น null** (เคยโชว์ "C/T 0s" เหมือนค่าจริงและไม่เข้า worklist) · กันวาดทับ: แถวสายป้อนเริ่มใต้คอลัมน์ supplier เสมอ (`supBottom`) · W ขั้นต่ำ 1080 (สายสั้นเคยทำกล่องลูกค้าจมหลังกล่อง Order/day) · ป้ายเส้น manual ใช้ `labelPos` (default ทับกล่องต้นทาง)
- **🔀 ปุ่ม "เสนอ routing เข้า VSM" ใน `/pe-docs` แท็บ Flow (2026-08-20):** แปลง OP ของ PFC → ร่าง `part_routings` — **ระบบเสนอ คนตรวจ/ติ๊ก/แก้ แล้วกดยืนยันถึง insert** (กฎ AI intake) · ตัวแปลง pure `src/utils/peRouting.js` (เทส 5 เคส): `process`/`inspection` = ขั้น · **`storage` = wip_label ของขั้นก่อนหน้า** (ไม่ใช่กล่อง) · incoming_insp/transport/rework ข้ามแบบรายงาน (ห้ามตัดเงียบ) · MAT ผูกด้วย `resolveMatForSet` (set.mat_no → เทียบ p_no normalize · **กำกวม = ให้คนเลือก ห้ามเดา**) · มี routing เดิม = confirm แล้ว**ปิดชุดเดิม (is_active=false เก็บประวัติ) ก่อน insert** — insert พลาดต้องกู้ชุดเดิมกลับ · สิทธิ์ปุ่ม = `routing:manage` (ไม่ seed key ใหม่) · UI `src/components/PeRoutingSuggest.jsx`
- **📎 reference สไตล์ใบจริงของโรงงาน = skill `vsm-tsat-reference` (`.claude/skills/vsm-tsat-reference/SKILL.md` · 2026-08-20 — ถอดจากใบตัวอย่าง 4 ใบที่ user แชร์)** — งานที่แตะ VSM ให้โหลด skill นี้ก่อนเสมอ · quick win ที่ทำแล้วตามใบ: **MCT (PLT+PT) headline ตัวแดง + PT รูปแบบ "X min Y second"** ทั้งบนผัง/การ์ดสรุป/ใบพิมพ์ — format ผ่าน `fmtMct`/`fmtMinSec` ใน `src/lib/vsmModel.js` จุดเดียว **ห้ามเขียน format ซ้ำ** · ที่ยังไม่ทำ (เฟส 2 ตามใบ): kaizen burst แดง (เกณฑ์เสนออัตโนมัติ C/T > T/T) + future state เทียบ current
- migration: `20260813_part_routings.sql` + `20260813_vsm_maps.sql` (DR) · `20260813_vsm_permission.sql` (Main) — **apply แล้วทั้ง 3 · 2026-08-13**
- **⚠️ กับดักที่เจอตอน apply (จดไว้กัน session ถัดไปเสียเวลา):** `permission_catalog` ใช้คอลัมน์
  **`(resource, action, label, group_name, sort)` ไม่ใช่ `permission_key`/`category`** (key ที่โค้ดเช็คคือ `resource:action`
  ที่ประกอบขึ้นมา) · `doc_forms.sig_blocks` เป็น **jsonb ไม่ใช่ text[]** (ต้อง `'[...]'::jsonb`)
- **ยังไม่ทำ (เฟส 2-4):** Future state + kaizen burst ผูก `/improvements` · รอบส่ง supplier · เทียบ current vs future อัตโนมัติ

---
