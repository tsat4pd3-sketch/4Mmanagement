# 📱 Mobile UX/UI Review — ESM (2026-07-10)

รีวิวความพร้อมใช้งานบน**มือถือ (โทรศัพท์ ≤768px แนวตั้ง)** ทั้ง 33 หน้า + component กลาง
โดยยึดหลัก: **ทุกการแก้ต้องเป็นแบบ additive เท่านั้น** (media query `≤768px`, branch `isMobile`,
wrapper div) — **ห้ามเปลี่ยนการ render ฝั่ง desktop/TV แม้แต่พิกเซลเดียว**

> รีวิวนี้เป็น snapshot ณ วันที่ตรวจ — เมื่อแก้รายการไหนแล้วให้ติ๊ก/ลบออก และถ้าสร้าง pattern
> mobile ใหม่ที่ใช้หลายหน้า ต้องอัพเดท `docs/UI-CONVENTIONS.md` ตามกฎเดิม

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
| **Management** | สูง | 🟢/🟡 | fixed filter ปุ่ม top-right อาจชน ☰/🔔 (:916) | media ปรับตำแหน่งเฉพาะ ≤768 |
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

**เฟส 2 — หน้าใช้งานหน้างานจริง (มือถือ-need สูง):**
6. `DailyReport.jsx:1699` session sidebar → isMobile `'1fr'`
7. `OEEAnalytics.jsx:669,:749,:913` → media `1fr`
8. Time boards §2.1 (InternalTimeBoard + CustomerDemand + Heijunka + Dashboard LEFT_W)

**เฟส 3 — Component กลาง + สองแพน:**
9. `MachineFloorMap.jsx` pointer events (§2.2)
10. `QAInspectionSetup.jsx:506`, `ProductMaster.jsx:1170,:1937` two-pane → stack
11. Modal grids (QualityControl / PMSetup / operator / Register / LineStock)

**เฟส 4 — Polish:**
12. Touch target กลาง `@media (pointer:coarse)` (§2.4)
13. `Management.jsx:916` / `DeptHub.jsx:169` ตำแหน่ง fixed/absolute บนจอแคบ

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
