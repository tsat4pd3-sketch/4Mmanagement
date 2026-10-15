# 📱 Mobile UX/UI Review — ESM (2026-07-10)

รีวิวความพร้อมใช้งานบน**มือถือ (โทรศัพท์ ≤768px แนวตั้ง)** ทั้ง 33 หน้า + component กลาง
โดยยึดหลัก: **ทุกการแก้ต้องเป็นแบบ additive เท่านั้น** (media query `≤768px`, branch `isMobile`,
wrapper div) — **ห้ามเปลี่ยนการ render ฝั่ง desktop/TV แม้แต่พิกเซลเดียว**

> รีวิวนี้เป็น snapshot ณ วันที่ตรวจ — เมื่อแก้รายการไหนแล้วให้ติ๊ก/ลบออก และถ้าสร้าง pattern
> mobile ใหม่ที่ใช้หลายหน้า ต้องอัพเดท `docs/UI-CONVENTIONS.md` ตามกฎเดิม

---

## 🆕 รอบ handheld — 2026-10-15 (แจก PDA 13 เครื่องให้ทุกหน่วยงานใช้จริง)

**วิธีตรวจ:** `audit/handheldsweep.mjs` จอ **360×640** + touch · 83 หน้า · **202 มุมมอง (ทุกแท็บ)** · กดเปิดโมดัล 114 ครั้ง
+ ถ่ายจอไล่เลื่อนดูด้วยตา ~25 หน้าที่หน้างานใช้ (DailyReport · Checkin · MO · Daily Checker/AM/LPA/Poka-Yoke/BBS ·
QC · LineStock · RackCenter · Transport · StoreMonitor · ScrapReport · Manpower · operator · Login …)
**ภาพรวม:** หน้าพัง 0 · โมดัลล้นจอ/ปุ่มบันทึกไปไม่ถึง **0 ใน 114 โมดัล** · แถบ sticky ค้างทับ 0 — งานมือถือรอบก่อนๆ ได้ผลจริง
ปัญหาที่เหลือเป็นเรื่อง "ใช้สะดวกไหม" มากกว่า "ใช้ได้ไหม"

### ✅ แก้แล้วในรอบนี้
| อาการ | ที่ | แก้ |
|---|---|---|
| ชิป "เลื่อนลงดูต่อ ▾" ค้างกลางล่างตลอดการเลื่อน **ทับปุ่มเขียวท้ายการ์ด** (✔ จ่าย Packaging · ผ่าน/ไม่ผ่าน) | `ScrollHint.jsx` (ทุกหน้า) | ซ่อนเมื่อเลื่อนเองเกิน 80px (ต่อตัวเลื่อน · เปลี่ยนหน้า/เปิดโมดัลใหม่ขึ้นใหม่) |
| checkbox 13×13px ใส่ถุงมือกดไม่โดน (7 หน้า) | `index.css` `pointer:coarse` | ≥ 20×20px เฉพาะจอสัมผัส |
| ชื่อหน้ายาว ⇒ ไอคอนลอยบรรทัดเดียว ชื่อตกบรรทัดล่าง (ScrapReport · AM · RackCenter · Improvements) | `PageHeader.jsx` (ทุกหน้า) | h2 `nowrap` ชื่อตัดบรรทัดข้างไอคอน |
| `<Segmented>` 4 ตัวเลือก wrap แล้วแถวบนเหลือช่องว่าง แถวล่างลอย (Improvements · ถังเหลือง/แดง) | `index.css` `.seg` ≤768 | ปุ่มยืดเต็มแถวแบบตาราง |
| ตัวนับ "(30 วัน)" ของ `<TimeRangeBar>` ตกขอบขวา (วันที่ 2 ช่อง ≈388px > 360) | `TimeRangeBar.jsx` | แถววันที่ `flexWrap` |
| การ์ด KPI 4 ใบเรียง 1 ใบ/แถว กินจอแรกทั้งจอ | `StoreMonitor.jsx` | `flex-basis` 170→140 = 2 ใบ/แถว (desktop ยัง 4) |
| กราฟ OEE Trend `minWidth:380` ยื่นพ้นจอ | `LineOeeBoard.jsx` | `min(380px,100%)` |
| ชิปชื่อไลน์ nowrap ยื่นพ้นจอ (แท็บ WIP ค้างระหว่างขั้น) | `WipBetweenSteps.jsx` | ยอมตัดบรรทัด |
| ป้าย ⏱ เวลาปัจจุบัน/ชั่วโมงท้ายแกนยื่นพ้นบอร์ด (ช่วงใกล้ 08:00) | `CustomerDemand.jsx` | ท้ายแกน >95% พับเข้าด้านใน |

### ✅ รอบ 2 (2026-10-15 · user: *"อย่ายุ่ง UX/UI จอคอม เน้นมือถือ · นายต้อง lead เรา"*)
มาตรฐานกลาง → **`docs/MOBILE-UX-STANDARD.md`** · พิสูจน์จอคอมต่าง 0 พิกเซลด้วย `audit/desktopdiff.mjs`
- แถบล่าง 4 ช่อง (หน้าหลัก · สแกน · ค้นหาเมนู · เมนู) แทน ☰ ลอยมุมซ้ายบน
- ตัวกรองพับทุกหน้า (`MobileFilterFold`) → ข้อเสนอ 1 ด้านล่าง ✅ — `/mtn-repair` ปุ่ม "แจ้งซ่อมใหม่" ขึ้นจอแรก
- หน้าหลัก: ⭐ ใช้บ่อย (ปุ่มใหญ่ 2 คอลัมน์) ขึ้นก่อน · ตัดแบนเนอร์/นาฬิกา/วันที่
- เช็คชื่อ & PPE: การ์ดต่อคน + ปุ่มใหญ่ มางาน/หมวก/รองเท้า/ถุงมือ/OT + ปุ่มบันทึกเกาะล่าง → ข้อเสนอ 2 ✅
- Daily Report: ลิสต์กะพับเป็นปุ่ม "กะที่เลือก · เปลี่ยนกะ" (เลิกเลื่อนซ้อน) → ข้อเสนอ 3 ✅
- LPA: ปุ่มตอบ Y/N/N/A/T เต็มแถว 44px + ปุ่มบันทึกเกาะล่าง
- รอบแรก (ด้านบน) ที่เคยกระทบจอคอม 1 จุด (ป้ายชั่วโมงท้ายแกน CustomerDemand) → ล็อกเป็นมือถือเท่านั้นแล้ว

### 🟡 ข้อเสนอ — (รอบแรก — ข้อ 1-3 ทำแล้วในรอบ 2) (กระทบหน้าตาหลายหน้า)
1. **แถบกรองกินจอแรกบนมือถือ** — `/mtn-repair` ปุ่มหลัก "➕ แจ้งซ่อมใหม่" อยู่ใต้ตัวกรอง ~1.3 จอ
   (ช่วงเวลา + 5 dropdown + กะ + ค้นหา) · เสนอ: บนจอ ≤768 `<TimeRangeBar>`/`<FilterBar>` พับเป็นแถบเดียว
   "🔎 ตัวกรอง (ตั้งไว้ N) ▾" + สรุปช่วงวันที่ — **ของหลัง `.spacer` (จำนวน/ปุ่มหลัก) โชว์เสมอ** · แก้ที่ component กลางที่เดียว
2. **เช็คชื่อ & PPE (`/checkin`) บนมือถือ** — แบนเนอร์อธิบาย 2-3 กล่องดันรายชื่อลงจอที่ 2 · ตารางคอลัมน์ PPE ต้องปัดขวา
   เสนอ: มือถือพับแบนเนอร์เป็นแถบบรรทัดเดียว + มุมมองการ์ดต่อคน (pattern Skill Matrix ใน Report)
3. **Daily Report Live** — ลิสต์กะเป็นกล่องเลื่อนซ้อนสูง ~170px เหนือรายละเอียด (เลื่อน 2 ชั้นบนจอ 640px)
   เสนอ: มือถือให้ลิสต์กะพับได้/เลือกกะแล้วพับเหลือชื่อกะที่เลือก
4. ช่องกรอกสูง 22–27px ในตารางตั้งค่า (CustomerDemand Ship-to · DailyPM ลงทะเบียน · OBEYA ตั้งค่า KPI) —
   งานตั้งค่าที่ทำบนคอม ไม่เร่ง

### ❓ ต้องเช็คกับเครื่องจริง (harness วัดไม่ได้)
- รุ่น/เวอร์ชัน Android + Chrome/WebView ของ handheld — ถ้า WebView เก่ากว่า Chromium 105 กฎขยายพื้นที่กดปุ่ม
  (`:has()`) จะถูกทิ้งทั้งบล็อก (ไม่พัง แต่ปุ่มเล็กกลับไปกดยาก)
- ปุ่มสแกนข้างเครื่อง (keyboard-wedge) ส่ง Enter ท้ายรหัส — picker กลางกันแล้ว (`initialActiveRow`) แต่ช่องที่ไม่ใช่ picker ควรลองจริง
- คีย์บอร์ดเปิดบนจอ 640px เหลือพื้นที่ ~300px — ฟอร์มยาวในโมดัลเลื่อนได้ (วัดแล้ว) แต่ควรลองกรอกจริง 1 รอบ

---

## 1. สิ่งที่ดีอยู่แล้ว (ไม่ต้องแตะ)

- **App shell ผ่านเกณฑ์แล้ว**: sidebar เป็น overlay + backdrop บนมือถือ, ปุ่ม ☰/🔔 ขนาด 34-36px,
  viewport meta ถูกต้อง, `.modal { width:min(480px,94vw) }`, font scale ≤768/≤480 ใน index.css
- หน้าที่**พร้อมใช้บนมือถือแล้ว** (🟢): `Login`, `DeptHub`, `DailyPM`, `Management`
  (tap-to-assign แทน drag + bottom sheet — ต้นแบบ mobile ที่ดีที่สุดของโปรเจค), `PMCheckData`
  (master-detail ≤860px), `Report` (แท็บ Skill Matrix / MultiSkill มี card view <768px แล้ว,
  tab bar เลื่อนได้, ตารางครอบ overflowX ครบ), `AddUser`, `PlannerSales`, `RundownStock`
  (sticky col + scroll = pattern ตารางกว้างบนมือถือที่ถูกต้อง), `Dashboard` (มี useIsMobile ครบเกือบหมด)
- โค้ดส่วนใหญ่ "รู้กับดัก" `input{width:100%}` แล้ว — กำหนด width เอง + มี comment กำกับหลายจุด

---

## 2. ปัญหาร่วมทั้งระบบ (แก้ครั้งเดียวได้หลายหน้า)

### 2.1 🔴 บอร์ดแกนเวลา 24 ชม. อ่านไม่ได้บนจอแคบ — กระทบ 5 หน้า
Convention §6 บังคับ "24 ชม.ในจอเดียว ไม่มี scroll แนวนอน" ซึ่ง**เป็นไปไม่ได้บนจอ 390px**
(พื้นที่แกน ≈ 248px = ~10px/ชั่วโมง บล็อก minWidth 48 ทับกันเละ):
- `src/components/InternalTimeBoard.jsx` (`LEFT_W:130` :21, block minWidth :113) → กระทบ **LineStock**, **RackCenter**
- `src/pages/CustomerDemand.jsx:280-371` — Shipping Chart เขียน inline ซ้ำ logic เดิม ปัญหาเดียวกัน
- `src/pages/HeijunkaKanban.jsx:236-485` — DeliveryTimelineBoard (ครึ่งละ 12 ชม. ~20px/ชม. ยังแน่น)
- `src/pages/Dashboard.jsx:1084` — Heijunka `LEFT_W=175` บีบไทม์ไลน์เหลือ ~150px

**วิธีแก้ (additive):** เพิ่ม branch `isMobile` — เฉพาะ ≤768px ครอบบอร์ดด้วย
`overflowX:'auto'` + กำหนด `minWidth` ภายใน (~760px = 1 ชม.≈28px) + ลด `LEFT_W`→96
desktop ยังเต็มจอเดียวตาม §6 เหมือนเดิม · แก้ที่ `InternalTimeBoard` ได้ 2 หน้าฟรี
แล้ว patch จุด inline ที่เหลือ (ระยะยาวควร refactor CustomerDemand มาใช้ component กลางตาม §6)
**ควรบันทึกข้อยกเว้นนี้ลง UI-CONVENTIONS §6 ด้วย** ("มือถือ ≤768px อนุญาต scroll แนวนอน")

### 2.2 🔴 `MachineFloorMap.jsx` — ลาก marker ได้เฉพาะเมาส์ + ไม่มี zoom
- `startDrag` ผูก `window mousemove/mouseup` เท่านั้น (:66-77), marker `onMouseDown` (:133)
  → **ลากบน touchscreen ไม่ทำงานเลย** (วางครั้งแรกผ่าน onClick ยังได้)
- เช่นเดียวกับ `LineSetup.jsx` (:791, :840, :908) ที่เป็น mouse-only ทั้ง 3 แท็บ
- หมุดบนผังที่ render แคบจะเล็กกว่า 40px + ป้ายซ่อนอัตโนมัติ → แตะเลือกยาก, ไม่มี pinch-zoom

**วิธีแก้ (additive):** เปลี่ยน/เพิ่มเป็น **pointer events** (`onPointerDown` + `setPointerCapture`
+ `touchAction:'none'` ขณะลาก) — pattern เดียวกับที่ `PMCheckData` JigSpinCheck ทำถูกแล้ว (:139-160)
desktop พฤติกรรมเดิมเป๊ะ · เรื่อง zoom เป็น optional (การแก้ผังเป็นงาน desktop โดยธรรมชาติ —
มือถือขอแค่ "ดูได้ แตะดูรายละเอียดได้" ก็พอ)

### 2.3 🔴 Grid หลายคอลัมน์แบบ fix ที่ไม่ยุบบนจอแคบ (รายจุด — ดูตาราง §3)
pattern ที่พังซ้ำ: `gridTemplateColumns:'240px 1fr'` (two-pane) หรือ `'1fr 1fr 1fr'` (ฟอร์มใน modal)
โดยไม่มี media query → บนจอ 390px คอลัมน์เนื้อหาเหลือ ~130px
**วิธีแก้:** branch `vw<768 ? '1fr' : <ของเดิม>` หรือใส่ class + rule ใน index.css เฉพาะ ≤768px

### 2.4 🟡 Touch targets เล็ก (ต่ำกว่า ~40px) — ปุ่มไอคอน ✏️/🗑️/✕ ในตารางเกือบทุกหน้า
padding 4-6px fontSize 11 ≈ สูง 24-28px · **วิธีแก้:** rule กลางใน index.css เช่น
`@media (pointer:coarse) { .icon-btn { min-width:40px; min-height:40px } }` แล้วทยอยติด class

### 2.5 🟡 กับดัก `input{width:100%}` ที่ยังหลงเหลือ
- `DailyReport.jsx:4342` — object `sel` ไม่ตั้ง width → date/select ในแถบ filter ยืดเต็มแถว
- `Dashboard.jsx:783` — date input ใน picker ไม่ตั้ง width
(จุดอื่นป้องกันแล้ว: OEEAnalytics:574, Checkin:1069, DailyPM:372, Dashboard:1130)

---

## 3. สรุปรายหน้า — เรียงตาม (ความจำเป็นบนมือถือ × ความรุนแรง)

| หน้า | ต้องใช้บนมือถือ? | สถานะ | ปัญหาเด่น (file:line) | วิธีแก้ (additive) |
|---|---|---|---|---|
| **DailyReport** | สูง (ปิดกะ/บันทึก DT หน้างาน) | 🔴 | sidebar sessions `'220px 1fr'` ไม่ยุบ (:1699) · filter `sel` โดน trap width (:4342) | isMobile → `'1fr'` · เพิ่ม `width:'auto'` ใน sel |
| **OEEAnalytics** | กลาง (ดูผลบนฟลอร์) | 🔴 | grid วิเคราะห์ fix `'0.8fr 1.3fr 1.5fr'` (:749), `'1.4fr 1fr'` (:669), `'1fr 1fr'` (:913) ไม่ยุบ → กราฟถูกตัด | media ≤768 → `1fr` (ResponsiveContainer จะกว้างเต็มแถวเอง) |
| **ShiftOrganize** | กลาง (leader จัดกะ) | 🔴 | ตารางกะรายสัปดาห์ (กว้าง ~610px) **ไม่มี overflow wrapper** (:286) ล้นถูกตัด | ครอบ `overflowX:'auto'` (ตารางรอง :382,:445 ทำแล้ว) |
| **HeijunkaKanban** | กลาง | 🔴 | view-toggle 6 ปุ่มไม่ wrap ล้นจอ (:1814) · timeline board (§2.1) | เพิ่ม `flexWrap`/`overflowX` · §2.1 |
| **ProductMaster** | ต่ำ (master data) | 🔴 | tab bar 6 แท็บไม่ scroll — แท็บขวาสุดกดไม่ถึง (:424) · two-pane `'minmax(240px,300px) 1fr'` ไม่ยุบ (:1170, :1937) | `overflowX:'auto'` ที่ tab bar · media → `1fr` |
| **QAInspectionSetup** | ต่ำ (งานตั้งค่า) | 🔴 | layout `'minmax(230px,290px) 1fr'` ไม่ยุบ (:506) → คอลัมน์ขวาเหลือ ~130px ใช้ไม่ได้ | media ≤820 → `'1fr'` + ปิด sticky sidebar (:508) |
| **LineStock** | กลาง (สโตร์) | 🔴/🟡 | tab bar ไม่ wrap (:1197) · modal grid `'1fr 1fr 1fr'` (:859) · time board (§2.1) | flexWrap · media → `1fr` · §2.1 |
| **RackCenter** | กลาง | 🟡 | time board (§2.1) · ปุ่ม advance/✕ เล็ก (:337,:342) | §2.1 · §2.4 |
| **CustomerDemand** | กลาง | 🔴 | Shipping Chart inline (§2.1, :280-371) · ปุ่มตารางเล็ก (:644-747) | §2.1 · §2.4 |
| **Checkin** | สูง (เช็คชื่อหน้างาน) | 🟡 | Export modal `width:380` fix ล้นจอเล็ก (:1587) · ตาราง minWidth 820 เลื่อนหนัก (:1135 — เลื่อนได้แล้ว) | `'min(380px,94vw)'` · (option) card view ต่อคนแบบ Report Skill Matrix |
| **Dashboard** | สูง | 🟡 | Heijunka `LEFT_W=175` (:1084) · date input trap (:783) | isMobile → LEFT_W 96 / scroll · ตั้ง width |
| **Management** | สูง | 🟢 ✅ | ~~บอร์ด Heijunka บีบ + ผังคนตกจอ~~ แก้แล้ว 2026-07-11 (map-first): มือถือบอร์ดพับเป็นแถบสรุป default (จำใน localStorage `mg_board_open_mobile`), กางแล้วเลื่อนแนวนอน + ป้าย sticky, legend ยุบเข้าปุ่ม ℹ️, Pool ว่างยุบเหลือแถบเดียว | — |
| **QualityControl** | ต่ำ | 🟡 | grid ใน modal `'1fr 1fr 1fr'` (:1214), `'2fr 1fr 1fr'` (:1048) ไม่ยุบ · select `minWidth:320` (:506) | media → `1fr` · `min(320px,100%)` |
| **PMSetup** | ต่ำ | 🟡 | modal grid `1fr 1fr` หลายจุดไม่ยุบ (:124,:239,:725-736) · page padding fix (:71) | media → `1fr` |
| **PMSchedule** | กลาง | 🟡 | `S.page` padding `'28px 32px'` fix (:27) — ที่เหลือ scroll ได้แล้ว | media ลด padding 14 |
| **MtnMachineLayout** | ต่ำ-กลาง | 🟡 | พึ่ง MachineFloorMap (§2.2) · หมุดเล็ก/ไม่มี zoom | §2.2 |
| **Register** | กลาง | 🟢/🟡 | field-pair `'1fr 1fr'` แคบ (:154,:179) | media ≤480 → `1fr` |
| **operator** | กลาง | 🟢/🟡 | modal grid `1fr 1fr` (:857,:1066) · hover-scale เป็นแค่ cosmetic | media → `1fr` |
| **CompanyCalendar** | ต่ำ | 🟢/🟡 | เซลล์วันแตะเล็ก (~24px สูง, :196-217) | เพิ่มความสูงเซลล์เฉพาะ pointer:coarse |
| **OrgSetup** | ต่ำ | 🟢/🟡 | icon btn ~20px (:287) | §2.4 |
| **MachineDatabase** | ต่ำ | 🟢/🟡 | ปุ่มแก้ไข/✕ เล็ก (:206-207) | §2.4 |
| **NotificationConfig** | ต่ำ | 🟢/🟡 | ปุ่ม ~34px | §2.4 |
| **PermissionsManagement** | desktop | 🟡 | matrix scroll เยอะ (โดยธรรมชาติ) · padding fix (:165) | ไม่จำเป็นต้องแก้ |
| **LineSetup** | desktop (ดูอย่างเดียว) | ดู 🟢 / แก้ 🔴 | ลากวาง mouse-only (:791,:840,:908) — มี isMobile ให้ "ดูผัง" แล้ว | ยอมรับเป็น desktop authoring tool (หรือเพิ่ม pointer events ตาม §2.2) |
| **EventLog / PMCheckData / Report / DailyPM / DeptHub / Login / AddUser / PlannerSales / RundownStock** | — | 🟢 | จุดย่อยมาก (เช่น Report OT panel :473, DeptHub top bar absolute :169) | ตามรายงานย่อย |

---

## 4. แผนแก้แนะนำ (เรียงเป็นเฟส — ทุกเฟส build ผ่าน + desktop เดิมเป๊ะ)

**เฟส 1 — Quick wins (แก้เล็ก ผลชัด ไม่มีความเสี่ยง): ✅ ทำแล้ว 2026-07-11**
1. ✅ `ShiftOrganize.jsx` ครอบตารางกะรายสัปดาห์ด้วย `overflowX:'auto'`
2. ✅ `ProductMaster.jsx` tab bar เพิ่ม `overflowX:'auto', maxWidth:'100%'` + ปุ่ม nowrap
3. ✅ `LineStock.jsx` tab bar + `HeijunkaKanban.jsx` view toggle → `flexWrap:'wrap'`
   (⚠️ tab bar LineStock ใช้ overflowX ไม่ได้ — ปุ่มมี `marginBottom:-2` ซ้อนเส้นใต้ container,
   overflow-x:auto จะบังคับ overflow-y:auto ไปด้วยแล้ว clip ส่วนที่จงใจล้น/เกิด scrollbar บน desktop)
4. ✅ `Checkin.jsx` Export modal → `width:'min(380px,94vw)'`
5. ✅ trap width: `DailyReport.jsx` object `sel` + `Dashboard.jsx` date picker → `width:'auto'`
   (ใช้ `width:'auto'` ทั้งคู่ ไม่ fix ตัวเลข — คงขนาดตามเนื้อหาเท่า desktop เดิม)

**เฟส 2 — หน้าใช้งานหน้างานจริง (มือถือ-need สูง): ✅ ทำแล้ว 2026-07-11**
6. ✅ `DailyReport.jsx` session sidebar → isMobile `'1fr'` (สร้าง hook กลาง `src/utils/useIsMobile.js`)
7. ✅ `OEEAnalytics.jsx` grid 3 จุด → isMobile `'1fr'`
8. ✅ Time boards: InternalTimeBoard + CustomerDemand + HeijunkaKanban + Dashboard —
   มือถือเลื่อนแนวนอน + ป้ายซ้าย sticky (บันทึกเป็นข้อยกเว้นใน UI-CONVENTIONS §6 แล้ว)

**เฟส 3 — Component กลาง + สองแพน: ✅ ทำแล้ว 2026-07-11**
9. ✅ `MachineFloorMap.jsx` pointer events + `touchAction:'none'` (ลากหมุดบนจอทัชได้ —
   ครอบคลุม MtnMachineLayout อัตโนมัติ) · `LineSetup.jsx` **ตั้งใจข้าม** (desktop authoring tool)
10. ✅ `QAInspectionSetup` + `ProductMaster` (BOM/Packaging) two-pane → isMobile `'1fr'` + ปิด sticky
11. ✅ Modal grids → class กลาง `mgrid` (≤600px ยุบ 1 คอลัมน์): QualityControl(6) PMSetup(7)
    operator(3) Register(2) LineStock(4) MachineDatabase(1) Report(1) QAInspectionSetup(3)
    + SPC select `minWidth:'min(320px,100%)'` + page padding fix เป็น clamp()
    (PMSchedule/PMSetup/MtnMachineLayout/PermissionsManagement)

**เฟส 4 — Polish: ✅ ทำแล้ว 2026-07-11**
12. ✅ Touch target: class กลาง `tbtn` (`pointer:coarse` ≥40px) ติดแล้ว: OrgSetup(3)
    MachineDatabase(2) LineStock(2) RackCenter(1) operator(2) + `.cal-day` ปฏิทิน ≥34px
13. ✅ `DeptHub` top bar → `.hub-topbar` static บน ≤768px ·
    `Management` ปุ่ม filter ลอย **ตั้งใจข้าม** — คำนวณตำแหน่งแล้วไม่ทับ ☰/🔔 บนจอ 390px
    (filter อยู่ x≈212-332, ☰ x≈14-48, 🔔 x≈340-376) และหน้านี้ mobile-optimized อยู่แล้ว
    เปลี่ยนตำแหน่งเสี่ยงกว่าปล่อยไว้ — รอ feedback จากเครื่องจริงก่อน

**เก็บตกรอบ 2 (จาก feedback รูปถ่ายหน้างานจริง) — ✅ ทำแล้ว 2026-07-11:**
14. ✅ `Management` แนวทาง "ก. Map-first + พับ section" บนมือถือ:
    - บอร์ด Heijunka **default พับ**เป็นแถบสรุป (📊 ชื่อไลน์ · ⚠️ ดีเลย์ N ใบ / ● Live) แตะกาง —
      จำสถานะใน `localStorage.mg_board_open_mobile` → ผังคนได้พื้นที่เกือบเต็มจอ
    - บอร์ดตอนกาง: เลื่อนแนวนอน + ป้ายพาร์ท sticky ซ้าย (pattern เดียวกับ Dashboard — ปิดงานตกหล่นเฟส 2)
    - legend สถานะ 7 ชิป ยุบเข้าปุ่ม ℹ️ ในหัวบอร์ด (เฉพาะมือถือ)
    - Pool ว่างทั้งสองส่วน → ยุบเหลือแถบบรรทัดเดียว
    - desktop/TV ทุกจุด render เหมือนเดิม (ไม่มีโหมดพับบน desktop)

**หลังแก้แต่ละเฟส:** อัพเดท `docs/UI-CONVENTIONS.md` ถ้าเกิด pattern ใหม่
(โดยเฉพาะข้อยกเว้น scroll แนวนอนของ time board §6 บนมือถือ) + อัพเดทไฟล์นี้

---

## 5. ข้อสังเกตเชิงสถาปัตยกรรม

- โปรเจคยังไม่มี hook `useIsMobile` กลาง — Dashboard/Management/PMCheckData/Report ต่างเขียนเอง
  (บางที่ไม่มี resize listener เช่น `LineSetup.jsx:51`, `App.jsx:728` คำนวณครั้งเดียว)
  → ควรสร้าง `src/utils/useIsMobile.js` ตัวเดียว (matchMedia + listener) แล้วให้หน้าใหม่ใช้ร่วม
  และบันทึกเป็น convention ใน UI-CONVENTIONS
- pattern ที่พิสูจน์แล้วว่าดี ควรใช้เป็นต้นแบบเวลาแก้หน้าอื่น:
  - **tap-to-assign + bottom sheet** → `Management.jsx`
  - **master-detail จอแคบ** → `PMCheckData.jsx` (≤860px)
  - **card view แทนตาราง matrix** → `Report.jsx` Skill Matrix (vw<768)
  - **ตารางกว้าง + sticky first col + scroll** → `RundownStock.jsx`
  - **pointer-drag ที่ touch ได้** → JigSpinCheck ใน `PMCheckData.jsx:139-160`
