# UX Laws Audit — 6 กฎจากรีล @motion_ui_interface · ESM ทุกหน้า (2026-11-13)

วิธีวัด: harness `audit/` ทุกหน้า 89 หน้า · role admin · 2 ความกว้าง (1500px / 390px) · ข้อมูล mock (ตัวเลขที่ขึ้นกับข้อมูลจริงอาจต่าง) + grep โค้ด
**อ่านอย่างเดียว ไม่ได้แก้อะไร** — ทุกข้อมีตัวเลขก่อน แล้วค่อยตัดสินใจว่าจะแก้ข้อไหน

| กฎ | สถานะ | ตัวเลข | ที่ต้องดู |
|---|---|---|---|
| 01 Closure — การ์ดถัดไปต้องโผล่ | 🟢 ส่วนใหญ่ผ่าน | มือถือ 390px: แถวเลื่อนแนวนอน 44 แถว (ไม่นับตาราง) · โผล่ ≥8% = 39 แถว · **ตัดพอดีขอบ/ไม่โผล่ 5 แถว ใน 4 หน้า** | DailyChecker (แถบแท็บหัวเพจ โผล่แค่ 5%) · GroupOverview · Management · ProductionPlan (2 แถว) |
| 02 Figure-ground — หรี่ฉากหลัง modal | 🟡 มีแต่ไม่เท่ากัน | มี token `--scrim` (0.55) ใช้แค่ **2 ที่** · class `.overlay` (0.78) ใช้ 26 ไฟล์ · **เขียน rgba เองอีก 120 จุด / 70 ไฟล์ · ค่าความมืด 11 แบบ** (0.5→0.88: 0.6 ×64 · 0.55 ×30 · 0.5 ×7 · 0.7 ×4 · 0.65 ×4 · 0.72 ×3 · 0.88/0.85/0.68 ×2 · 0.78/0.66 ×1) | ทุก modal ที่ประกาศ backdrop เอง — modal เดียวกันคนละหน้าอาจมืดไม่เท่ากัน |
| 03 Banner blindness — ของสำคัญห้ามหน้าตาเหมือนโฆษณา | 🟢 ผ่าน | NoticeBar = แถบแบน + ขอบซ้าย (หน้าตาเหมือนเนื้อหา ไม่ใช่กล่องสีจัด) · ตอนโหลดมีแถบค้าง 5 หน้า หน้าละ 1 แถบ · ไม่มีหน้าไหนซ้อน ≥2 แถบบนสุด | Checkin · DailyReport · Energy · QrLabels · ShiftOrganize (ทั้งหมดผูกข้อมูลจริง ไม่ใช่ป้ายถาวร) |
| 04 Parkinson — เติมสิ่งที่ระบบรู้ให้ก่อน | 🟢 ส่วนใหญ่ผ่าน | ช่องวันที่ว่างตอนโหลด **3/34** (CompanyCalendar · EventLog · Register) · ชื่อผู้บันทึก/ผู้แจ้งมาจาก login (`fullName` 91 ไฟล์ ไม่มีช่องให้พิมพ์ชื่อตัวเอง) · select ว่าง 88/131 = ตัวกรอง "ทั้งหมด" ไม่ใช่ฟอร์ม | ฟอร์มใน modal (เปิดหลังกด) ยังไม่ได้วัด — ต้องไล่ทีละฟอร์มถ้าจะทำต่อ |
| 05 Connectedness — ขั้นตอนต้องมีเส้นเชื่อม | 🟢 ผ่าน | ของกลาง `StepFlow` (✓—✓—⑦—○ มีเส้นเชื่อม) ใช้ 16 ไฟล์ · วาดเองแต่มีเส้นเชื่อมแล้ว 1 (AnnouncementMockup `FlowBar`) · `OverseasTravelMockup` ADMIN_STEPS เป็น checklist ไม่ใช่ flow · ที่เหลือที่ชื่อ "steps/Stepper" เป็นตาราง routing หรือปุ่ม +/− ไม่เข้าข่าย | — |
| 06 Choice overload — ตัวเลือกน้อยลงตอนแรก | 🔴 ตกหลายจุด | **แท็บหัวเพจ > 7 (เกินกฎ UI-CONVENTIONS §… "แท็บ ≤ 7")**: ProductMaster **13** · LineStock **12** · QualityControl **10** (DailyChecker 7 · Report 7 พอดีเพดาน) · **แถบกรองมี control ≥ 9**: MtnRepair **25** · ProgramUpdate 15 · operator 13 · WorkforceInsight 12 · HeijunkaKanban/OrderTrace/QrLabels 11 · LineStock/QualityControl 10 · MtnAnalysis/ProductHistory 9 · **select ที่มี > 15 ตัวเลือก 34 ช่อง / 28 หน้า** (มากสุด 21 = ช่องขอบเขตส่วนงาน/ผัง — มี optgroup แล้ว) · ปุ่มเหนือ fold มากสุด ScrapReport 64 (60 อยู่ในแถวตาราง) · Improvements 49 · ProductMaster 43 | ดูรายละเอียดด้านล่าง |

## รายละเอียดกฎ 06 (จุดที่ตก)

**แท็บหัวเพจ**
- ProductMaster 13: Parts Master · BOM · BOM ซ้ำ 2 ใบ · ของลม(phantom) · Product · Routing · Packaging · Kanban Std · ลูกค้า · Supplier · หน่วยนับ · ทบทวน CT · Export — 5 แท็บหลังเป็น "ทะเบียนย่อย/เครื่องมือ" ยุบเป็นกลุ่มเดียวได้
- LineStock 12: ขาออก · ขาเข้า · ค้างตัด SAP · คลังพัก/ผลต่าง · Stock · ตรวจนับ/เฟิร์ม · WIP ค้าง · จุดเรียกเติม · พื้นที่ SAP · รอบจัดส่ง · บอร์ดเวลา · กฎรับเข้า
- QualityControl 10: Dashboard · ใบตรวจ · SPC · NCR · ใบซ่อมรอตรวจ · ถังเหลือง · เคลม · ใบเบิกทดสอบ · CAPA/8D · เครื่องมือวัด

**แถบกรอง**
- MtnRepair 25 control: ช่วง 4 + ย้อนหลัง 4 + วันที่ 2 (= TimeRangeBar มาตรฐาน 10) + หน่วยงาน · ไลน์ · สถานะ · กะ 3 ปุ่ม · ประเภท · ขั้น · งาน PR · ค้นหา · Excel · แจ้งซ่อมใหม่ · ⓘ → ตัวกรองเฉพาะทาง 7 ช่องต่อจาก TimeRangeBar
- ProgramUpdate 15: ย้อนหลัง 4 + วันที่ 2 + หมวด 7 ปุ่ม + ค้นหา
- operator 13: ส่วนงาน · แผนก · กลุ่ม · ทีม + สถานะจ้าง 3 ปุ่ม + ชนิดคน 3 ปุ่ม + Direct/Indirect 2 ปุ่ม + ค้นหา (3 แกนกรองซ้อนกัน)

**ข้อสังเกต:** TimeRangeBar มาตรฐานกิน 10 control เองทุกหน้า (ช่วง 4 · ย้อนหลัง 4 · วันที่ 2) — ถ้าจะลด "ตัวเลือกตอนแรก" ทั้งระบบ จุดเดียวที่มีผลทุกหน้าคือแถบนี้

## รายละเอียดกฎ 01 (มือถือ 390px · 5 แถวที่ไม่โผล่)
| หน้า | element | กว้าง | เลื่อนได้ถึง | ลูก | โผล่ |
|---|---|---|---|---|---|
| DailyChecker | แถบแท็บหัวเพจ (ph-chrome) | 370 | 786 | 5 | 5% |
| GroupOverview | div | 340 | 611 | 9 | ตัดพอดีขอบ |
| Management | div | 366 | 372 | 15 | ล้นแค่ 6px |
| ProductionPlan | div ×2 | 340 | 943 | 22 | ตัดพอดีขอบ |

## รายละเอียดกฎ 02
- `src/index.css` มีของกลาง 2 ตัวที่ค่าไม่ตรงกันเอง: `--scrim: rgba(0,0,0,0.55)` (04/11) กับ `.overlay { background: rgba(0,0,0,0.78) }`
- ค่าที่เขียนมือมากสุดคือ 0.6 (64 จุด) — ไม่มีค่าไหนตรงกับ token
- รีลแนะนำ ~70% · ธีมมืดของเรา 0.55 อาจอ่อนไป (วัดจริง: contrast ที่เหลือของหน้าหลังฉากยังไม่ได้วัด)

## ข้อจำกัดของการวัดรอบนี้
- ข้อมูล mock ⇒ จำนวนแถว/ตัวเลือกใน select บางช่องต่างจากของจริง (เช่น ไลน์จริง 49 แถว)
- ยังไม่ได้เปิด modal ทุกตัวเพื่อวัดความมืดจริง (ใช้ค่าจากโค้ดแทน) และยังไม่ได้วัดฟอร์มที่อยู่ใน modal (กฎ 04)

## ผลวัด modal / popup ของจริง (runtime · 2026-11-13 · ทุกหน้า × ทุกแท็บหัวเพจ × กดทุกปุ่ม ≤40 ปุ่ม/มุมมอง ข้ามปุ่มพิมพ์/ดาวน์โหลด)

- เปิดได้ **298 รายการ ใน 53 หน้า**: modal มี backdrop **225** · native `confirm()/alert()` ของเบราว์เซอร์ **58** · popover/เมนูลอยไม่มี backdrop 15
- **ความมืด backdrop (วัดจาก computed style):** 0.6 ×93 · 0.55 ×64 · 0.78 ×48 · 0.7 ×8 · 0.68 ×4 · 1 ×3 · 0.5 ×3 · 0 ×2
  - alpha 1.0 ×3 = โหมดเต็มจอ (MorningMeeting Meeting mode · Obeya TV mode) ตั้งใจทึบ · alpha 0 ×2 (MorningMeeting Action) = ตัววัดจับชั้นนอก ของจริงมีชั้นใน 0.7 + blur — ไม่ใช่ปัญหา
- **contrast ที่เหลือของข้อความหน้าหลังฉาก** (ธีมมืด text #e6e9ef บน bg #0f1115 = 15.5:1 ก่อนหรี่): 0.5 → 4.3:1 · 0.55 → 3.6:1 · 0.6 → 3.1:1 · 0.68 → 2.3:1 · 0.7 → 2.2:1 · 0.78 → 1.6:1 (รีลแนะนำ ≈2.5:1 ที่ 70%)
  ⇒ **69% ของ modal (0.55/0.6 รวม 157 ตัว) ยังเหลือ contrast 3.1–3.6:1** = หน้าหลังยังอ่านออก แย่งสายตา · 0.78 (`.overlay` 48 ตัว) หรี่จนเหลือ 1.6:1 = มืดกว่าที่แนะนำ
- **blur:** มี 66 / ไม่มี 159 (blur(4px) 58 · blur(3px) 8) — modal แบบเดียวกันบางตัวเบลอ บางตัวไม่เบลอ
- **z-index:** 2000 ×159 · 3000 ×26 · 2400 ×12 · 1000 ×5 · 1900 ×5 · 1250 ×4 · 2100 ×4 · 2300 ×3 — 8 ค่าต่างกัน (modal ซ้อน modal ลำดับไม่การันตี)
- **ที่มาของ backdrop:** (เขียน style เอง) ×99 · modal-scroll ×76 · overlay ×50
- **หน้าที่ modal ในหน้าเดียวกันมืดไม่เท่ากัน (14 หน้า):** Checkin [0.55, 0.6] · CustomerDemand [0.55, 0.78] · DailyChecker [0.55, 0.6] · DieRegistry [0.55, 0.6] · EquipmentHub [0.55, 0.6, 0.78] · LayerProcessAudit [0.55, 0.6] · LineStock [0.55, 0.6] · MorningMeeting [0, 1] · OEEAnalytics [0.55, 0.68] · Obeya [0.55, 0.6, 0.68, 1] · PMSchedule [0.5, 0.6] · PmHub [0.5, 0.55, 0.6, 0.7] · QAInspectionSetup [0.6, 0.7] · operator [0.6, 0.78]
- **native `confirm()` 58 จุด ใน 27 หน้า** (หน้าตาเบราว์เซอร์ ไม่มีการหรี่ ไม่ตามธีม ไม่แปลภาษา): ProductMaster 7 · ScrapReport 6 · LineStock 5 · QualityControl 5 · operator 4 · LayoutSetup 3 · DailyChecker 2 · LineSetup 2 · Obeya 2 · OrgSetup 2 · PMSetup 2 · PlannerSales 2
- **dialog ขนาดเต็มจอ 10 ตัว** (⤢ ขยายกราฟ · TV/Meeting mode · ฟอร์มแก้พนักงาน operator 1360×828 · OjtTraining ✏️ สูง 2007px ต้องเลื่อน) — ของตั้งใจ ยกเว้น 2 ฟอร์มหลังที่สูงเกินจอ
- **ข้อจำกัด:** ปุ่มในตารางนับเฉพาะป้ายแรกที่ไม่ซ้ำ · modal ที่ต้องกรอกฟอร์มก่อนถึงจะเปิด (ขั้นที่ 2) ยังไม่ถึง · ตัวตรวจ "มีปุ่มปิด" ไม่น่าเชื่อถือ (จับชั้นผิด) จึงไม่รายงาน

### ตารางราย modal (หน้า · แท็บ · ปุ่มที่กด · alpha · blur · z · contrast ที่เหลือ · ขนาดกล่อง)

| หน้า | แท็บ | ปุ่ม | alpha | blur | z | contrast | กล่อง |
|---|---|---|---|---|---|---|---|
| AddUser |  | เพิ่มผู้ใช้ใหม่ | 0.78 | blur(4px) | 2000 | 1.6 | 920×846 |
| AddUser |  | แก้ไข | 0.78 | blur(4px) | 2000 | 1.6 | 920×846 |
| Checkin |  | ยืมพนักงาน | 0.6 | - | 2000 | 3.1 | 520×353 |
| Checkin |  | บันทึก | 0.55 | - | 2000 | 3.6 | 380×409 |
| CustomerDemand | Shipping Chart | อัพโหลด e-SMART | 0.78 | blur(4px) | 2400 | 1.6 | 1100×186 |
| CustomerDemand | Shipping Chart | เพิ่ม order ด่วน | 0.55 | - | 2000 | 3.6 | 460×430 |
| DailyChecker | Poka-Yoke Chec | เพิ่มอุปกรณ์ | 0.55 | - | 3000 | 3.6 | 560×446 |
| DailyChecker | Poka-Yoke Chec | ✏️ | 0.55 | - | 3000 | 3.6 | 560×422 |
| DailyChecker | Layer Process  | เซ็นใหม่ | 0.6 | - | 3200 | 3.1 | 620×281 |
| DailyReport | Live กะนี้ | ▼LINE APRON ASSY (HYDR | 0.78 | blur(4px) | 2000 | 1.6 | 480×419 |
| DailyReport | Live กะนี้ | LINE APRON ASSY (HYDRO | 0.78 | blur(4px) | 2000 | 1.6 | 1440×846 |
| DailyReport | ประวัติ | ออกใบรายงานปัญหา | 0.78 | blur(4px) | 2200 | 1.6 | 520×291 |
| DailyReport | ตั้งค่า | + เพิ่มประเภท | 0.78 | blur(4px) | 2000 | 1.6 | 440×989 |
| DeptDashboard |  | ⤢ ขยาย | 0.68 | - | 1250 | 2.3 | 1468×828 |
| DieRegistry | Registry | + Add set | 0.55 | - | 2000 | 3.6 | 720×614 |
| DieRegistry | Registry | SP-11 | 0.55 | - | 2000 | 3.6 | 720×776 |
| DieRegistry | Registry | SP-12 | 0.55 | - | 2000 | 3.6 | 720×776 |
| DieRegistry | Registry | SP-13 | 0.55 | - | 2000 | 3.6 | 720×776 |
| DieRegistry | Registry | SP-14 | 0.55 | - | 2000 | 3.6 | 720×776 |
| DieRegistry | Registry | SP-15 | 0.55 | - | 2000 | 3.6 | 720×776 |
| DieRegistry | Registry | SP-16 | 0.55 | - | 2000 | 3.6 | 720×776 |
| DieRegistry | Registry | SP-17 | 0.55 | - | 2000 | 3.6 | 720×776 |
| DieRegistry | Registry | SP-18 | 0.55 | - | 2000 | 3.6 | 720×776 |
| DieRegistry | Registry | SP-19 | 0.55 | - | 2000 | 3.6 | 720×776 |
| DieRegistry | Registry | SP-20 | 0.55 | - | 2000 | 3.6 | 720×776 |
| DieRegistry | Registry | SP-21 | 0.55 | - | 2000 | 3.6 | 720×776 |
| DieRegistry | Registry | SP-22 | 0.55 | - | 2000 | 3.6 | 720×776 |
| DieRegistry | Registry | SP-23 | 0.55 | - | 2000 | 3.6 | 720×776 |
| DieRegistry | Registry | ROBOT HANDLING / SPOT  | 0.55 | - | 2000 | 3.6 | 720×776 |
| DieRegistry | Registry | SP-25 | 0.55 | - | 2000 | 3.6 | 720×776 |
| DieRegistry | Registry | ✏️ | 0.55 | - | 2000 | 3.6 | 720×614 |
| DieRegistry | Storage map | Scan die label | 0.6 | - | 2400 | 3.1 | 440×483 |
| DieRegistry | Storage map | ➕ New map | 0.6 | - | 2000 | 3.1 | 440×246 |
| DieRegistry | Storage map | ⚙️ | 0.6 | - | 2000 | 3.1 | 440×246 |
| DocFormsRegistry |  | Edit | 0.55 | - | 3000 | 3.6 | 940×828 |
| EquipmentHub | Machines | Manage machine types | 0.78 | blur(4px) | 2100 | 1.6 | 460×765 |
| EquipmentHub | Machines | + Add machine | 0.78 | blur(4px) | 2000 | 1.6 | 420×831 |
| EquipmentHub | Die | + Add set | 0.55 | - | 2000 | 3.6 | 720×614 |
| EquipmentHub | Die | SP-11 | 0.55 | - | 2000 | 3.6 | 720×776 |
| EquipmentHub | Die | SP-12 | 0.55 | - | 2000 | 3.6 | 720×776 |
| EquipmentHub | Die | SP-13 | 0.55 | - | 2000 | 3.6 | 720×776 |
| EquipmentHub | Die | SP-14 | 0.55 | - | 2000 | 3.6 | 720×776 |
| EquipmentHub | Die | SP-15 | 0.55 | - | 2000 | 3.6 | 720×776 |
| EquipmentHub | Die | SP-16 | 0.55 | - | 2000 | 3.6 | 720×776 |
| EquipmentHub | Die | SP-17 | 0.55 | - | 2000 | 3.6 | 720×776 |
| EquipmentHub | Die | SP-18 | 0.55 | - | 2000 | 3.6 | 720×776 |
| EquipmentHub | Die | SP-19 | 0.55 | - | 2000 | 3.6 | 720×776 |
| EquipmentHub | Die | SP-20 | 0.55 | - | 2000 | 3.6 | 720×776 |
| EquipmentHub | Die | SP-21 | 0.55 | - | 2000 | 3.6 | 720×776 |
| EquipmentHub | Die | SP-22 | 0.55 | - | 2000 | 3.6 | 720×776 |
| EquipmentHub | Die | SP-23 | 0.55 | - | 2000 | 3.6 | 720×776 |
| EquipmentHub | Die | ROBOT HANDLING / SPOT  | 0.55 | - | 2000 | 3.6 | 720×776 |
| EquipmentHub | Die | SP-25 | 0.55 | - | 2000 | 3.6 | 720×776 |
| EquipmentHub | Die | ✏️ | 0.55 | - | 2000 | 3.6 | 720×614 |
| EquipmentHub | Spare parts st | Import / update | 0.6 | - | 2000 | 3.1 | 820×297 |
| EquipmentHub | Spare parts st | Category | 0.6 | - | 2000 | 3.1 | 560×810 |
| EquipmentHub | Spare parts st | ➕ Add spare part | 0.6 | - | 2000 | 3.1 | 760×828 |
| EquipmentHub | Spare parts st | ➕ | 0.6 | - | 2000 | 3.1 | 420×333 |
| EquipmentHub | Spare parts st | ➖ | 0.6 | - | 2000 | 3.1 | 420×333 |
| EquipmentHub | Spare parts st | ⚖ | 0.6 | - | 2000 | 3.1 | 420×383 |
| EquipmentHub | Spare parts st | 📜 | 0.6 | - | 2000 | 3.1 | 660×810 |
| EquipmentHub | Spare parts st | ✏️ | 0.6 | - | 2000 | 3.1 | 760×828 |
| EquipmentHub | Spare parts st | ➕ New map | 0.6 | - | 2000 | 3.1 | 440×406 |
| EquipmentHub | Spare parts st | ⚙️ | 0.6 | - | 2000 | 3.1 | 440×406 |
| GroupOverview |  | 🔩 TSAT184.5 | 0.6 | - | 2000 | 3.1 | 520×418 |
| GroupOverview |  | 🔩 TSAT482.5 | 0.6 | - | 2000 | 3.1 | 520×358 |
| GroupOverview |  | 🧩 TSPT187.8 | 0.6 | - | 2000 | 3.1 | 520×418 |
| GroupOverview |  | 🏍️ TSMC187.2 | 0.6 | - | 2000 | 3.1 | 520×418 |
| GroupOverview |  | 🔩 TSLA82.6 | 0.6 | - | 2000 | 3.1 | 520×418 |
| GroupOverview |  | 🔩 TSESA79.2 | 0.6 | - | 2000 | 3.1 | 520×418 |
| GroupOverview |  | 🔩 TSRF72.6 | 0.6 | - | 2000 | 3.1 | 520×418 |
| GroupOverview |  | 🧩 TSPT283.3 | 0.6 | - | 2000 | 3.1 | 520×418 |
| GroupOverview |  | 🏍️ TSMC279.9 | 0.6 | - | 2000 | 3.1 | 520×418 |
| GroupOverview |  | 🧩 TSPT-VN74 | 0.6 | - | 2000 | 3.1 | 520×418 |
| GroupOverview |  | 🏍️ TSMC-ID82.1 | 0.6 | - | 2000 | 3.1 | 520×418 |
| GroupOverview |  | 🔩 TSCN88.7 | 0.6 | - | 2000 | 3.1 | 520×418 |
| Improvements |  | Add improvement projec | 0.78 | blur(4px) | 2000 | 1.6 | 1150×828 |
| Improvements |  | PE | 0.78 | blur(4px) | 2000 | 1.6 | 480×774 |
| Improvements |  | A3 | 0.78 | blur(4px) | 2000 | 1.6 | 900×664 |
| Improvements |  | Edit | 0.78 | blur(4px) | 2000 | 1.6 | 1150×828 |
| Integrations | Source | + Add connection | 0.78 | blur(4px) | 2000 | 1.6 | 560×457 |
| LayerProcessAudit | Save inspectio | Sign again | 0.6 | - | 3200 | 3.1 | 620×275 |
| LayerProcessAudit | Question | เพิ่มคำถาม (เฉพาะไลน์  | 0.55 | - | 3000 | 3.6 | 640×339 |
| LineStock | Outbound (stor | + จ่ายพาร์ทเข้าไลน์ | 0.6 | - | 2000 | 3.1 | 900×407 |
| LineStock | Holding / vari | Propose clearance resu | 0.6 | - | 2300 | 3.1 | 480×342 |
| LineStock | Stock | + จ่ายพาร์ทเข้าไลน์ | 0.6 | - | 2000 | 3.1 | 900×407 |
| LineStock | WIP between st | 📋 นับจริง | 0.55 | - | 2000 | 3.6 | 420×232 |
| LineStock | SAP area / war | + Add storage code | 0.6 | - | 2000 | 3.1 | 480×585 |
| LineStock | SAP area / war | ✏️ | 0.6 | - | 2000 | 3.1 | 480×648 |
| LineStock | SAP area / war | ➕ Add zone | 0.55 | - | 3000 | 3.6 | 680×344 |
| LineStock | SAP area / war | ➕ ห้องคอมเพรสเซอร์ | 0.55 | - | 3000 | 3.6 | 680×344 |
| LineStock | SAP area / war | ✏️ Edit | 0.55 | - | 3000 | 3.6 | 680×375 |
| LineStock | Delivery round | + Add delivery round | 0.6 | - | 2000 | 3.1 | 760×548 |
| LineStock | Delivery round | ✏️ | 0.6 | - | 2000 | 3.1 | 760×548 |
| MachineDatabase |  | Manage machine types | 0.78 | blur(4px) | 2100 | 1.6 | 460×765 |
| MachineDatabase |  | + Add machine | 0.78 | blur(4px) | 2000 | 1.6 | 420×831 |
| Management |  | 🏷 | 0.78 | blur(4px) | 2000 | 1.6 | 360×1228 |
| Management |  | Machine | 0.78 | blur(4px) | 2000 | 1.6 | 420×530 |
| Management |  | Material | 0.78 | blur(4px) | 2000 | 1.6 | 420×530 |
| Management |  | Method | 0.78 | blur(4px) | 2000 | 1.6 | 420×530 |
| ManpowerBoard | Manpower chart | Board settings | 0.6 | - | 1000 | 3.1 | 960×828 |
| ManpowerBoard | Layout map | Board settings | 0.6 | - | 1000 | 3.1 | 960×828 |
| ManpowerBoard | 4M status tags | Board settings | 0.6 | - | 1000 | 3.1 | 960×828 |
| ManpowerBoard | Plan vs actual | Board settings | 0.6 | - | 1000 | 3.1 | 960×828 |
| ManpowerBoard | Slot change hi | Board settings | 0.6 | - | 1000 | 3.1 | 960×828 |
| Monitoring | ไลน์ปั๊ม (2) | Create FG board from o | 0.78 | blur(4px) | 2000 | 1.6 | 760×385 |
| Monitoring | FG รายแร็ค (1) | Create FG board from o | 0.78 | blur(4px) | 2000 | 1.6 | 760×385 |
| Monitoring | Weekly demand | Create FG board from o | 0.78 | blur(4px) | 2000 | 1.6 | 760×385 |
| Monitoring | วัตถุดิบ (R402 | Create FG board from o | 0.78 | blur(4px) | 2000 | 1.6 | 760×385 |
| Monitoring | งานส่งชุบ (1) | Create FG board from o | 0.78 | blur(4px) | 2000 | 1.6 | 760×385 |
| Monitoring | FG ทุกตัว (862 | Create FG board from o | 0.78 | blur(4px) | 2000 | 1.6 | 760×385 |
| MorningMeeting |  | Meeting mode | 1 | - | 200 | 1 | None×None |
| MorningMeeting |  | Action | 0 | - | 2000 | 15.5 | None×None |
| MorningMeeting |  | Add action | 0 | - | 2000 | 15.5 | None×None |
| MtnAnalysis | QC 7 Tools (by | ⤢ Expand | 0.68 | - | 1250 | 2.3 | 1468×828 |
| MtnRepair | MO List | + New repair request | 0.55 | - | 3000 | 3.6 | 640×828 |
| NPI | Board | + Project | 0.78 | blur(4px) | 2000 | 1.6 | 680×632 |
| NPI | Parts & PPAP | + Project | 0.78 | blur(4px) | 2000 | 1.6 | 680×632 |
| NPI | Drawings & ECI | + Project | 0.78 | blur(4px) | 2000 | 1.6 | 680×632 |
| NPI | Tooling | + Project | 0.78 | blur(4px) | 2000 | 1.6 | 680×632 |
| NPI | Job | + Project | 0.78 | blur(4px) | 2000 | 1.6 | 680×632 |
| NPI | Template | + Project | 0.78 | blur(4px) | 2000 | 1.6 | 680×632 |
| NPI | Template | ✏️ Template | 0.78 | blur(4px) | 2000 | 1.6 | 560×385 |
| NPI | Template | + Template | 0.78 | blur(4px) | 2000 | 1.6 | 560×364 |
| NPI | Template | + Phase | 0.78 | blur(4px) | 2000 | 1.6 | 520×299 |
| OEEAnalytics | Today's overvi | Set target | 0.55 | - | 2000 | 3.6 | 760×828 |
| OEEAnalytics | Today's overvi | Monthly report | 0.55 | - | 2000 | 3.6 | 640×651 |
| OEEAnalytics | Trend / histor | Set target | 0.55 | - | 2000 | 3.6 | 760×828 |
| OEEAnalytics | Trend / histor | Monthly report | 0.55 | - | 2000 | 3.6 | 640×651 |
| OEEAnalytics | Trend / histor | ⤢ Expand | 0.68 | - | 1250 | 2.3 | 1468×828 |
| OEEAnalytics | Root cause ana | Set target | 0.55 | - | 2000 | 3.6 | 760×828 |
| OEEAnalytics | Root cause ana | Monthly report | 0.55 | - | 2000 | 3.6 | 640×651 |
| Obeya | Unit KPI Board | + Log safety incident | 0.6 | - | 3000 | 3.1 | 720×771 |
| Obeya | Unit KPI Board | TV mode | 1 | - | 1010 | 1 | None×None |
| Obeya | Unit KPI Board | 🔍 | 0.6 | - | 1900 | 3.1 | 1280×800 |
| Obeya | SQDCM Board (W | + Add action | 0.6 | - | 2000 | 3.1 | 520×556 |
| Obeya | SQDCM Board (W | TV mode | 1 | - | 1010 | 1 | None×None |
| Obeya | SQDCM Board (W | 🔍 | 0.6 | - | 1900 | 3.1 | 1280×800 |
| Obeya | SQDCM Board (W | ▶ | 0.6 | - | 1900 | 3.1 | 1280×800 |
| Obeya | SQDCM Board (W | D ส่งมอบ | 0.6 | - | 1900 | 3.1 | 1280×800 |
| Obeya | SQDCM Board (W | OEE เทียบเป้า | 0.6 | - | 1900 | 3.1 | 1280×800 |
| Obeya | Unit Open Acti | ⤢ Expand | 0.68 | - | 1250 | 2.3 | 1468×828 |
| Obeya | KPI Setup / En | ＋🎯 | 0.55 | - | 2000 | 3.6 | 560×548 |
| Obeya | KPI Setup / En | ＋ Add KPI | 0.55 | - | 2000 | 3.6 | 680×828 |
| Obeya | KPI Setup / En | ทะเบียนชื่อ KPI (15) | 0.55 | - | 2000 | 3.6 | 760×810 |
| Obeya | KPI Setup / En | Group standard | 0.55 | - | 2000 | 3.6 | 1000×676 |
| Obeya | KPI Setup / En | ✏️ | 0.55 | - | 2000 | 3.6 | 680×828 |
| Obeya | KPI Setup / En | ＋ Set at this level | 0.55 | - | 2000 | 3.6 | 680×828 |
| OjtTraining |  | Create training record | 0.55 | - | 3000 | 3.6 | 1150×789 |
| OjtTraining |  | ✏️ | 0.55 | - | 3000 | 3.6 | 1150×2007 |
| OrderTrace | From productio | 📷 | 0.6 | - | 2400 | 3.1 | 440×503 |
| OrgSetup | Manage units | ➕ | 0.78 | blur(4px) | 2000 | 1.6 | 420×572 |
| OrgSetup | Manage units | ✏️ | 0.78 | blur(4px) | 2000 | 1.6 | 420×572 |
| OrgSetup | Manage units | ＋ New rate | 0.78 | blur(4px) | 2000 | 1.6 | 560×438 |
| OrgSetup | Manage units | ➕ Add rate (pick code  | 0.78 | blur(4px) | 2000 | 1.6 | 560×438 |
| PEDocs | คลัง PFMEA (15 | New set from master | 0.78 | blur(4px) | 2000 | 1.6 | 860×719 |
| PEDocs | คลัง PFMEA (15 | New document set | 0.78 | blur(4px) | 2000 | 1.6 | 640×694 |
| PMCheckData |  | 📷 | 0.6 | - | 2400 | 3.1 | 440×483 |
| PMSchedule |  | Set cycle / next PM da | 0.5 | - | 2000 | 4.3 | 520×516 |
| PMSchedule |  | Scan machine | 0.6 | - | 2400 | 3.1 | 440×483 |
| PMSetup |  | + Add equipment | 0.7 | blur(4px) | 2000 | 2.2 | 1286×795 |
| PMSetup |  | Edit | 0.7 | blur(4px) | 2000 | 2.2 | 1286×795 |
| PlannerSales | Calculate kanb | Preview & Apply | 0.6 | - | 2000 | 3.1 | 680×734 |
| PmCoordination |  | Create new plan | 0.55 | - | 2000 | 3.6 | 760×658 |
| PmHub | Inspect equipm | 📷 | 0.6 | - | 2400 | 3.1 | 440×483 |
| PmHub | PM plan | Set cycle / next PM da | 0.5 | - | 2000 | 4.3 | 520×516 |
| PmHub | PM plan | Scan machine | 0.6 | - | 2400 | 3.1 | 440×483 |
| PmHub | Advance (plann | Coordination plan | 0.55 | - | 2000 | 3.6 | 760×658 |
| PmHub | Coordination | Create new plan | 0.55 | - | 2000 | 3.6 | 760×658 |
| PmHub | Checkpoint set | + Add equipment | 0.7 | blur(4px) | 2000 | 2.2 | 1286×795 |
| PmHub | Checkpoint set | Edit | 0.7 | blur(4px) | 2000 | 2.2 | 1286×795 |
| PokaYokeCheck |  | Add equipment | 0.55 | - | 3000 | 3.6 | 560×440 |
| PokaYokeCheck |  | ✏️ | 0.55 | - | 3000 | 3.6 | 560×416 |
| ProcessSetup |  | + Add process | 0.6 | - | 3000 | 3.1 | 560×289 |
| ProductMaster | 1️⃣ 🗂 Parts Ma | + Add product | 0.6 | - | 2000 | 3.1 | 560×810 |
| ProductMaster | 1️⃣ 🗂 Parts Ma | EC | 0.6 | - | 2000 | 3.1 | 560×810 |
| ProductMaster | 1️⃣ 🗂 Parts Ma | Edit | 0.6 | - | 2000 | 3.1 | 560×810 |
| ProductMaster | 1️⃣ 🗂 Parts Ma | + Add MAT.NO | 0.6 | - | 2100 | 3.1 | 380×275 |
| ProductMaster | 2️⃣ 📦 BOM | Open a BOM sheet for a | 0.6 | - | 2300 | 3.1 | 540×765 |
| ProductMaster | 3️⃣ 🔩 Products | + Add product | 0.6 | - | 2000 | 3.1 | 560×810 |
| ProductMaster | 3️⃣ 🔩 Products | EC | 0.6 | - | 2000 | 3.1 | 560×810 |
| ProductMaster | 3️⃣ 🔩 Products | Edit | 0.6 | - | 2000 | 3.1 | 560×810 |
| ProductMaster | 3️⃣ 🔩 Products | + Add MAT.NO | 0.6 | - | 2100 | 3.1 | 380×275 |
| ProductMaster | Packaging | จัดการภาชนะ (Container | 0.6 | - | 2000 | 3.1 | 760×810 |
| ProductMaster | Kanban Std | Edit | 0.6 | - | 2000 | 3.1 | 420×533 |
| ProductionPlan | Work Orders (L | Book machine for trial | 0.78 | blur(4px) | 2000 | 1.6 | 680×587 |
| QAInspectionSetup | Inspection Sta | ＋ | 0.6 | blur(3px) | 3000 | 3.1 | 560×630 |
| QAInspectionSetup | Inspection Sta | Inspection points & dr | 0.7 | blur(4px) | 2000 | 2.2 | 1286×795 |
| QAInspectionSetup | Inspection Sta | Edit part | 0.6 | blur(3px) | 3000 | 3.1 | 560×699 |
| QAInspectionSetup | Inspection Sta | Copy to another part | 0.7 | blur(4px) | 2000 | 2.2 | 960×637 |
| QAInspectionSetup | Inspection Sta | Edit / add checkpoint | 0.7 | blur(4px) | 2000 | 2.2 | 1286×795 |
| QAInspectionSetup | Inspection Sta | ✏️ | 0.7 | blur(4px) | 2000 | 2.2 | 1286×795 |
| QualityControl | Check sheet | ✕ | 0.6 | - | 2400 | 3.1 | 440×483 |
| QualityControl | SPC / Cp-Cpk | + Add control point | 0.6 | blur(3px) | 3000 | 3.1 | 560×602 |
| QualityControl | SPC / Cp-Cpk | Edit | 0.6 | blur(3px) | 3000 | 3.1 | 560×671 |
| QualityControl | Defect NCR | Open new NCR | 0.6 | blur(3px) | 3000 | 3.1 | 960×505 |
| QualityControl | Yellow bin awa | 🔧 ลงผลซ่อม | 0.6 | blur(4px) | 2000 | 3.1 | 460×337 |
| QualityControl | Customer claim | Log new claim | 0.6 | - | 2500 | 3.1 | 980×563 |
| QualityControl | Test requisiti | ＋ New requisition | 0.6 | - | 3000 | 3.1 | 1020×707 |
| QualityControl | CAPA / 8D | Open new CAPA | 0.6 | blur(3px) | 3000 | 3.1 | 1400×643 |
| QualityControl | Measuring tool | + Add measuring tool | 0.6 | blur(3px) | 3000 | 3.1 | 620×536 |
| QualityControl | Measuring tool | ✏️ | 0.6 | blur(3px) | 3000 | 3.1 | 620×536 |
| RackCenter | Status board | Scan | 0.6 | - | 2000 | 3.1 | 420×191 |
| RackCenter | Status board | Call container | 0.6 | - | 2000 | 3.1 | 420×409 |
| RackCenter | Timeline board | Scan | 0.6 | - | 2000 | 3.1 | 420×191 |
| RackCenter | Timeline board | Call container | 0.6 | - | 2000 | 3.1 | 420×409 |
| RackCenter | SLA | Scan | 0.6 | - | 2000 | 3.1 | 420×191 |
| RackCenter | SLA | Call container | 0.6 | - | 2000 | 3.1 | 420×409 |
| Rfq | RFQ list | + RFQ | 0.78 | blur(4px) | 2000 | 1.6 | 760×626 |
| Rfq | Won / lost | + RFQ | 0.78 | blur(4px) | 2000 | 1.6 | 760×626 |
| ScanLanding |  | Home | 0.6 | - | 2400 | 3.1 | 440×483 |
| ScanLanding |  | Scan now | 0.6 | - | 2400 | 3.1 | 440×483 |
| ScanLanding |  | Open scanner camera | 0.6 | - | 2400 | 3.1 | 440×510 |
| ScanLanding |  | OK | 0.6 | - | 2400 | 3.1 | 440×483 |
| ScrapReport | Defect report | + New order | 0.6 | - | 3000 | 3.1 | 1180×509 |
| ScrapReport | Defect report | ✏️ | 0.6 | - | 3000 | 3.1 | 1180×828 |
| ScrapReport | Yellow bin / r | + Add entry | 0.6 | - | 2000 | 3.1 | 720×828 |
| ScrapReport | Yellow bin / r | 🔧 ลงผลซ่อม | 0.6 | blur(4px) | 2000 | 3.1 | 460×337 |
| ScrapReport | Yellow bin / r | ✏️ | 0.6 | - | 2000 | 3.1 | 720×828 |
| ShiftOrganize |  | Pre-fill shifts | 0.78 | blur(4px) | 2300 | 1.6 | 860×655 |
| ShiftOrganize |  | Add item | 0.78 | blur(4px) | 2000 | 1.6 | 480×430 |
| ShiftOrganize |  | Create shift-merge eve | 0.78 | blur(4px) | 2000 | 1.6 | 480×515 |
| Transport | คนขับ/ยานพาหนะ | Add driver | 0.5 | - | 2000 | 4.3 | 440×810 |
| operator | People | ✏️ | 0.78 | blur(4px) | 2000 | 1.6 | 1360×828 |
| operator | Level Up15 | Not approved | 0.6 | - | 3000 | 3.1 | 400×234 |

### native confirm()/alert()

| หน้า | ปุ่ม | ข้อความ |
|---|---|---|
| Checkin | คืน | คืน LINE APRON ASSY (HYDROFORM) ชุดที่ 7 — งานทดสอ |
| CompanyCalendar | ตั้งค่าทั้งปี | ตั้งค่า 52 วัน (ทุกวันในสัปดาห์ที่เลือก ทั้งปี 202 |
| CustomerDemand | ลบ | ลบ code "CODE-1" (undefined)?

ข้อมูล order/foreca |
| DailyChecker | ลบ | ลบอุปกรณ์ "LINE APRON ASSY (HYDROFORM) ชุดที่ 1 —  |
| DailyChecker | ลบผลตรวจนี้ | ลบผลตรวจ 12/11/2569 กะดึก (Shift 02) ชั้น Leader? |
| DieRegistry | ✎ | หมายเหตุสถานะ (เช่น ซ่อมคมตัด OP20 / ส่งบริษัท xxx |
| EquipmentHub | Delete | ลบอะไหล่ "LINE APRON ASSY (HYDROFORM) ชุดที่ 10 —  |
| FlowTower | Set lot | ตั้งขนาดล็อตของ 10101001 = 200 ชิ้น (1 กล่อง)?

คว |
| Improvements | Delete | ลบโปรเจค "หัวข้อทดสอบ 1"? |
| LayerProcessAudit | Delete this inspection | ลบผลตรวจ 12/11/2569 กะดึก (Shift 02) ชั้น Leader? |
| LayoutSetup | ✕ | ลบกรอบไลน์ "LINE APRON ASSY (HYDROFORM) ชุดที่ 3 — |
| LayoutSetup | Delete this map image | ลบรูปผังของ "LINE APRON ASSY (HYDROFORM) ชุดที่ 1  |
| LayoutSetup | Delete workstation | ยืนยันการลบจุดงานนี้? |
| LineSetup | Delete this map image | ลบรูปผังของ "LINE APRON ASSY (HYDROFORM) ชุดที่ 1  |
| LineSetup | Delete workstation | ยืนยันการลบจุดงานนี้? |
| LineStock | 🏷️ แปะรหัสคลังย้อนหลัง | แปะรหัสคลังให้รายการเก่าที่ยังไม่มีมุม SAP (15 แถว |
| LineStock | ลบรหัสคลังนี้ | ลบรหัส P401 · LINE APRON ASSY (HYDROFORM) ชุดที่ 1 |
| LineStock | Delete this item | ยืนยันลบรอบจัดส่งนี้? |
| LineStock | Closed | ปิดกฎ "undefined → undefined"?

⚠️ ปิดแล้ว ใบผลิตท |
| LineStock | Delete | ลบกฎ "undefined → undefined"? |
| MtnRepair | Delete | ลบรายการนี้? |
| NotificationConfig | Delete | ลบห้อง "LINE APRON ASSY (HYDROFORM) ชุดที่ 1 — งาน |
| Obeya | 📋 Copy KPI set from an | คัดลอกชุด KPI จากปีไหนมาปี 2569?
(ใส่ปี พ.ศ. เช่น  |
| Obeya | Deactivate | ปิดใช้งาน KPI "Raw Material Control"?
ค่าที่กรอกไว |
| OjtTraining | Delete | ลบใบอบรม "" ? (รายชื่อ+ลายเซ็นพนักงานในใบนี้จะถูกล |
| OrgSetup | 🟢 | ปิดใช้งาน "LINE APRON ASSY (HYDROFORM) ชุดที่ 1 —  |
| OrgSetup | Delete this item | ลบ "(ไม่ทราบชื่อ) — ?" ? |
| PMSetup | Change to AM | เปลี่ยน "MTN (ซ่อมบำรุง)" จาก PM → AM?

AM = พนักง |
| PMSetup | Delete | ลบ "LINE APRON ASSY (HYDROFORM) ชุดที่ 1 — งานทดสอ |
| PlannerSales | Skip | ข้ามไฟล์ undefined — เหตุผล (เช่น ไฟล์ซ้ำ/นำเข้ามื |
| PlannerSales | Delete | ลบชุดข้อมูล "undefined" (undefined แถว)? ข้อมูลที่ |
| PmHub | Delete | ลบ "LINE APRON ASSY (HYDROFORM) ชุดที่ 1 — งานทดสอ |
| PokaYokeCheck | Delete | ลบอุปกรณ์ "LINE APRON ASSY (HYDROFORM) ชุดที่ 1 —  |
| ProductMaster | ✕ | ปิดใช้งานสินค้านี้?

สินค้าจะถูกซ่อนจากรายการ แต่เ |
| ProductMaster | ✕ | ปิดใช้งานสินค้านี้?

สินค้าจะถูกซ่อนจากรายการ แต่เ |
| ProductMaster | Disable | ปิดใช้ "CODE-1" ?

รายการนี้จะไม่โผล่ในตัวเลือกให้ |
| ProductMaster | Disable | ปิดใช้ "CODE-1" ?

รายการนี้จะไม่โผล่ในตัวเลือกให้ |
| ProductMaster | Disable | ปิดใช้ "CODE-1" ?

รายการนี้จะไม่โผล่ในตัวเลือกให้ |
| ProductMaster | ✓ Approve | อนุมัติปรับ CT ของ 90101001

— → 45 วินาที/ชิ้น

C |
| ProductMaster | ✕ Reject | ปฏิเสธข้อเสนอของ 90101001 — เหตุผล (บังคับ) |
| ProductionPlan | Disable | ปิดใช้ "CODE-1" ?

รายการนี้จะไม่โผล่ในตัวเลือกให้ |
| QualityControl | Delete | ลบผลวัดชุดนี้? |
| QualityControl | ✅ งานดี | ยืนยันเซ็น — ผลพิจารณา "ตรวจแล้วใช้ได้" — 124 ชิ้น |
| QualityControl | 🔧 ส่งซ่อม | ยืนยันเซ็น — ผลพิจารณา "ส่งซ่อม" — 124 ชิ้น

ใบถัง |
| QualityControl | 🔴 เสียแน่ → ถังแดง | ยืนยันเซ็น — ผลพิจารณา "เสียแน่ — ซ่อมไม่ได้" 124  |
| QualityControl | 🔴 ย้ายลงถังแดง | ย้าย 8 ชิ้นลงถังแดง?

PANEL ASSY-COWL SIDE INNER R |
| ScrapReport | ✅ งานดี | ยืนยันเซ็น — ผลพิจารณา "ตรวจแล้วใช้ได้" — 124 ชิ้น |
| ScrapReport | 🔧 ส่งซ่อม | ยืนยันเซ็น — ผลพิจารณา "ส่งซ่อม" — 124 ชิ้น

ใบถัง |
| ScrapReport | 🔴 เสียแน่ → ถังแดง | ยืนยันเซ็น — ผลพิจารณา "เสียแน่ — ซ่อมไม่ได้" 124  |
| ScrapReport | 🔴 ย้ายลงถังแดง | ย้าย 8 ชิ้นลงถังแดง?

PANEL ASSY-COWL SIDE INNER R |
| ScrapReport | 🔴 | ย้าย 1 ชิ้นลงถังแดง?

PANEL ASSY-COWL SIDE INNER R |
| ScrapReport | Delete | ลบรายการ PANEL ASSY-COWL SIDE INNER RH ชิ้นที่ 1 ( |
| ShiftOrganize | Delete this per-person | ยืนยันลบรายการเปลี่ยนกะรายบุคคลนี้? |
| ShiftOrganize | Delete this shift merg | ยืนยันลบเหตุการณ์ยุบกะนี้? |
| operator | 🚫 | ปิดใช้งานพนักงาน: LINE APRON ASSY (HYDROFORM) ชุดท |
| operator | Run Weekly Update | รัน Weekly Skill Update สำหรับสัปดาห์ที่แล้ว?
(ปกต |
| operator | Re-evaluate queue | ประเมินคำขอค้าง undefined ใบตามเกณฑ์ใหม่:
  ✅ ผ่าน |
| operator | EXP v2: โหมดทดลอง | เปิดสูตร EXP v2 กับคะแนนจริง?

คะแนนจะถูกคำนวณใหม่ |

## ✅ แก้แล้ว — กฎ 02 ม่านหลัง modal (2026-11-13 · คำสั่ง user "แก้ backdrop ให้เป็น token เดียว 0.7 + blur ทั้งระบบ")
- `index.css`: `--scrim` 0.55 → **0.7** · เพิ่ม `--scrim-blur: blur(4px)` · `.overlay` ใช้ token (+ `-webkit-backdrop-filter`)
- โค้ดที่เขียน `rgba(0,0,0,0.x)` เอง **127 จุด / 75 ไฟล์** → `var(--scrim)` + blur · ด่าน `scrim-token-only`
- **วัดซ้ำหลังแก้** (12 หน้าที่มี modal มากสุด · กดทุกปุ่ม): overlay 100 ตัว → **97 ตัว = 0.7 + blur(4px)** · 3 ตัวที่เหลือ = โหมดเต็มจอ TV/ประชุม (ทึบตั้งใจ `var(--bg)`)
- contrast ที่เหลือของหน้าหลังฉาก (ธีมมืด) ทุก modal = **2.2:1** (เดิมกระจาย 1.6–3.6:1)
