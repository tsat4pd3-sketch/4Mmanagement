# 🎨 UI Conventions — ESM Design System กลาง

> **ทุก session ที่แก้ UI ต้องอ่านไฟล์นี้ก่อนลงมือ และเมื่อสร้าง/เปลี่ยน pattern ที่ใช้ร่วมกันหลายหน้า ต้องอัพเดทไฟล์นี้ในคอมมิทเดียวกัน**
> เหตุผล: หลาย session ทำงานขนานกัน ถ้าไม่มีมาตรฐานกลาง จะได้ UI คนละทรง (เคยเกิดแล้ว: จุดเครื่องจักรฝั่ง MTN ทำเป็นเหลี่ยม ขณะที่ระบบหลักเป็นวงกลม)

อัพเดทล่าสุด: 2026-07-11 (ปุ่ม 🏷️ ป้ายชื่อ 3 สถานะ · ลำดับจุด คน→เครื่องจักร→WIP · mobile: useIsMobile hook / time board เลื่อนแนวนอนบนมือถือ / mgrid·tbtn / pointer-drag)

---

## 1. จุด/Marker บนผังไลน์ (Floor-map markers) — ใช้ทุกหน้าที่มีผัง

**รูปแบบเดียวเท่านั้น: วงกลม + ป้ายชื่อใต้ (circle + name pill)** — ห้ามทำเป็นกล่องเหลี่ยม

| ชนิดจุด | วงกลม | ไอคอน/เนื้อหาในวงกลม | ป้ายใต้ (pill) |
|---|---|---|---|
| คน (มีคนประจำ) | เส้นขอบสีตามระดับ skill fit | รูปพนักงาน (objectFit: cover) หรืออักษรแรก | ชื่อสถานี · fit% badge ต่อท้ายอีกป้าย |
| คน (สถานีว่าง) | เส้นประ สีเทา — เป็น drop target | "+" | ชื่อสถานี |
| เครื่องจักร | ขอบ amber `#f59e0b` — ขนาด 0.6×MK | ⚙️ | machine_no (+ป้ายรอง: ชื่อเครื่อง/สาเหตุ downtime) |
| เครื่องจักร (Downtime ค้าง) | class `dt-alarm-blink` ขอบ/พื้นแดง | 🚨 หรือ ⚙️ | machine_no + สาเหตุ + นาทีที่ค้าง |
| WIP | ขอบเขียว `#22c55e` (แดงเมื่อ `current < min`) — 0.6×MK | 📦 (packaging) / 🧱 (material) | point_name + ป้ายจำนวน `cur/min–max` |
| จุดงาน (LineSetup) | ขอบขาว/เขียวเมื่อเลือก | 📍 | station_name เต็ม (+💰 ถ้ามีค่าฝีมือ) |
| เครื่องจักร/อุปกรณ์ (ผัง MTN – สถานะ PM) | ขอบ**สีตามสถานะ PM** (แดงเกินกำหนด / ส้มใกล้ครบ / เขียวปกติ / ม่วงยังไม่ตรวจ) — SUB (density-aware) · จุด**เกินกำหนด**ป้ายโชว์เสมอ | ⚙️ | machine_no/jig_no (+ป้ายรอง: ชื่อเครื่อง) |

**ป้าย (pill) spec:** `background: rgba(0,0,0,0.75-0.78)` · `borderRadius: 4` · ตัวหนังสือขาว bold · `whiteSpace: nowrap` + `overflow: hidden` + `textOverflow: ellipsis` · `maxWidth ≈ 1.8–2 × เส้นผ่านศูนย์กลางวงกลม`

### สูตรขนาด — ใช้ util กลาง `src/utils/markerScale.js` เท่านั้น (2026-07-10)
```js
const { MK, SUB, showSubPills, ... } = markerScale(renderedMapWidth, { machineCount });
// MK  = จุดคน/จุดงาน (max(34, min(84, w*0.055)))
// SUB = เครื่องจักร/WIP — density-aware: ≤18 เครื่อง 0.6×MK · 19-32 → 0.5× · >32 → 0.42×
// showSubPills = ป้ายชื่อหมุดรองซ่อนอัตโนมัติเมื่อ >18 เครื่อง (หน้าต้องมีปุ่ม 🏷️ ป้ายชื่อ ให้ override)
```

### ปุ่ม 🏷️ ป้ายชื่อ — 3 สถานะ คุมทุกชนิดจุด (2026-07-11)
หน้า Management + LineSetup ใช้ state `pillMode` เดียวกัน (WYSIWYG) กดวน: **อัตโนมัติ → โชว์ทุกป้าย → ซ่อนป้าย**
- `auto` (default): ป้ายจุดงาน (คน) โชว์เสมอ · ป้ายเครื่องจักร/WIP ตาม `showSubPills` (ซ่อนเมื่อผังแน่น)
- `all`: โชว์ทุกป้ายทุกชนิด · `none`: ซ่อนทุกป้ายรวมทั้งจุดงาน (ผังโล่งดูเฉพาะตำแหน่ง)
- ป้ายที่**โชว์เสมอทุกสถานะ**: เครื่อง Downtime ค้าง, WIP ต่ำกว่า min, หมุดที่กำลังเลือก/แก้ไข/ลากวางคน (ต้องเห็น fit preview)
- ปุ่มแสดงชื่อสถานะปัจจุบันบนตัวปุ่มเสมอ (🏷️ ป้ายอัตโนมัติ / โชว์ทุกป้าย / ซ่อนป้าย) — อย่าทำปุ่ม toggle เงียบที่ label ไม่เปลี่ยน
- เหตุ: เดิมปุ่มเป็น boolean "บังคับโชว์หมุดรอง" โผล่เฉพาะผังแน่น ผู้ใช้เข้าใจว่าเป็นสวิตช์เปิด-ปิดชื่อทั้งผัง แล้วงงว่า "ทำไมมีผลแค่เครื่องจักร"

### ลำดับชนิดจุดมาตรฐาน: คน → เครื่องจักร → WIP (2026-07-11)
ทุกที่ที่แสดงชนิดจุดเรียงกัน (แท็บ LineSetup, ปุ่ม filter MAN/MACHINE/WIP บน Management, legend ฯลฯ)
ต้องเรียง **คน/จุดงาน → เครื่องจักร → WIP** ตามลำดับ 4M (Man, Machine, Material) — ห้ามสลับ (เคยหลุด: แท็บ LineSetup เรียง จุดงาน→WIP→เครื่องจักร ขัดกับปุ่ม filter ที่ Management)
- **ห้ามตั้งสูตรเองในหน้า** — ทุกหน้าที่วาดผัง (Setup + ทุกหน้าโชว์) เรียก util นี้ → **WYSIWYG: ตอน setup เห็นขนาด/ป้ายเหมือนตอนแสดงผลจริงทุกหน้า** (เคยพัง: setup ใช้ 0.75× ป้ายเดียว / Management ใช้ 0.6× + ป้ายรอง → ตอนวางดูไม่ทับ ตอนโชว์ทับเละ)
- ป้ายที่**ห้ามซ่อนแม้โหมดแน่น**: เครื่องที่กำลัง Downtime (alarm), WIP ต่ำกว่า min, หมุดที่กำลังเลือก/แก้ไข
- ฟอนต์ห้ามต่ำกว่า 11px เพื่อแก้ป้ายทับกัน — ให้ซ่อนป้าย (ดูจาก tooltip/คลิกการ์ดรายละเอียด) แทนการย่อฟอนต์

### กติกาที่ต้องมีเสมอ
1. **Anchor = ศูนย์กลางวงกลมต้องตรงพิกัดจริงเป๊ะ** — wrapper ที่ใส่ `translate(-50%,-50%)` ต้องสูงเท่า*วงกลมเท่านั้น* และ**ป้าย/badge ทุกอันต้องเป็น `position:absolute; top:100%` ห้อยใต้** (ห้ามใส่ใน flex column ปกติ — จะทำให้จุดกึ่งกลางเลื่อนขึ้นครึ่งป้าย marker ลอยเหนือตำแหน่งจริง/ตกขอบบน — เคยพังที่ Management มาแล้ว) · pos_top/pos_left เป็น % ของรูปจริง ระวัง letterbox จาก object-fit: contain ต้องคูณ offset+rendered size
2. **De-overlap**: marker ที่ทับกันให้ผลักออกจากกันในพิกเซลจริง + วาดเส้นประโยงกลับตำแหน่งจริง (ดู Dashboard modal / Management เป็นต้นแบบ) — ห้ามแก้ตำแหน่งใน DB
3. **Edge clamp**: ตำแหน่ง*แสดงผล*ต้องถูก clamp ไม่ให้วงกลม+ป้ายตกขอบรูป — เผื่อซ้าย/ขวา/บน `size*0.55`, ล่าง `size*1.35` (มีป้ายห้อย) — ตำแหน่งจริงใน DB ไม่เปลี่ยน
4. Hover card แสดงเฉพาะอุปกรณ์ที่ hover ได้จริง: `window.matchMedia('(hover: hover)').matches` — จอทัชให้ใช้ modal ที่มีปุ่มปิด + popup ทุกชนิดต้องมีทางปิดเสมอ (✕/auto-hide — กติกา backdrop click ดู section 5)

**Component กลาง (2026-07-10):** `src/components/MachineFloorMap.jsx` — ผัง object-fit:contain + marker วงกลม+ป้าย ตามสูตร MK/edge-clamp ข้างบนครบ (โหมด read-only และ editable: คลิกวาง/ลากย้าย/✕ ถอด). หน้า `/mtn-layout` (`MtnMachineLayout.jsx`) ใช้ component นี้ทั้งมุมมองไลน์ผลิตและ Facility — **ขอบวงกลมใช้สีสถานะ PM** (จงใจต่างจาก amber ในตารางข้อ 1 เพราะทั้งผังสื่อสาร "สถานะ" เป็นหลัก) หน้าใหม่ที่ต้องการผัง+marker ให้ reuse `MachineFloorMap` แทนเขียนใหม่
- **prop `height`** ใช้บังคับผังให้ fit จอเดียว (เช่น `clamp(360px, calc(100vh - 260px), 1100px)`) — ถ้าส่ง height, component จะปิด flex-grow ให้เอง (flex:1 basis 0% จะชนะ height ใน column ทำให้ล้นจอ — เคยพลาดมาแล้ว)
- **จุดที่ไม่เข้าฟิลเตอร์ (dim)**: opacity 0.1 + ไม่แสดงป้ายชื่อ — ให้เห็นชัดว่าถูกกรองออก (0.28 เดิมแยกไม่ออกจากจุดปกติ = ฟิลเตอร์ดูเหมือนไม่ทำงาน)

หน้าอ้างอิง (ต้นแบบที่ทำถูกแล้ว): `Dashboard.jsx` (modal ผังขยาย + ผังย่อ), `Management.jsx`, `LineSetup.jsx`, `MtnMachineLayout.jsx`

---

## 2. ไฟ Andon — สีตามความรุนแรง (ห้ามแดงหมด)

| ระดับ | เงื่อนไข | การแสดงผล |
|---|---|---|
| 🔴 แดง | เครื่องจักร Downtime **ยังค้างอยู่** | กระพริบ (`dt-alarm-blink`) + ขอบแดง — เท่านั้นที่กระพริบ |
| 🟡 เหลือง | มีรายการ**รออนุมัติ/รอดำเนินการ** (เช่น 4M pending) หรือ DT เพิ่งปิด | ขอบ/ป้ายเหลือง `#f59e0b` นิ่ง |
| 🟢 เขียว | ทุกอย่างอนุมัติแล้ว / ปกติ | เขียว `#22c55e` |

- ป้ายนับ 4M บนการ์ด: 🚨 แดงเฉพาะเมื่อมี pending, อนุมัติครบ = 🟡
- ป้าย alarm ต้อง**คลิกได้** → เปิด Andon panel เจาะรายละเอียด (ดูต้นแบบใน Dashboard)
- สถานะรายการ 4M: approved=เขียว / pending·pending_qa=เหลือง / rejected=แดง
- CSS กลาง (2026-07-09): `.dt-alarm-blink` `.dt-alarm-banner` `.dt-alarm-icon` (แดงกระพริบ) ·
  `.person-alarm-red` (แดงกระพริบ) · `.person-alarm-amber` (เหลือง **นิ่ง+เรืองแสง**) — ใช้ของกลาง ห้ามเขียน keyframes ใหม่ต่อหน้า
- จุดเครื่องจักรบนผัง: กระพริบเฉพาะรายการ downtime ที่**ยังเปิดค้าง** (เครื่องหยุดจริง) — ปิดรายการ = ดับทันที
  (`src/utils/downtimeAlarm.js` เป็น source of truth ห้ามเพิ่มเงื่อนไขเวลาอื่น เช่น "เพิ่งบันทึกใน X นาที")

---

## 3. การ์ด (Cards) ใน grid

- การ์ดในหมวด/แถวเดียวกันต้อง**สูงเท่ากัน**: wrapper `height: 100%` + การ์ด `height: 100%` + `minHeight` เดียวกัน + `display:flex; flexDirection:column; justifyContent:space-between`
- ทั้งการ์ด**ไม่ใช่**จุดคลิก — action ต้องเป็นปุ่ม/ป้ายเฉพาะจุดที่เห็นชัด (เช่นปุ่ม "ดูไลน์ย่อย ▾")
- แถวขยายลูก (nested) ให้ทำเป็น panel เต็มแถว `gridColumn: '1 / -1'` ขอบประ + หัวข้อบอกว่าเป็นลูกของอะไร ไม่ปนใน grid เดียวกับการ์ดหลัก

---

## 4. ตัวหนังสือ (จอโรงงาน/TV เป็นหลัก)

- **ขั้นต่ำ 11-12px** — ห้ามใช้ 6-10px แม้พื้นที่จะแคบ (เคยไล่แก้ทั้ง Dashboard มาแล้ว: สเกล 6→8 … 16→18)
- ชิป/ป้าย 12-13px · ข้อความรอง 14-15px · หัวข้อ 15px+ · ตัวเลขใหญ่ในการ์ด 34px+ (wide 42px+)
- responsive ใช้ `isWide`/`isUltra` ternary หรือสเกลจากขนาด container — ไม่ใช้ vw กับ marker
- **branch มือถือใช้ hook กลาง `src/utils/useIsMobile.js`** (≤768px + listener อัพเดทตอนหมุนจอ) —
  หน้าใหม่/แก้ใหม่ห้ามเขียน `window.innerWidth <= 768` แบบคำนวณครั้งเดียวเอง (2026-07-11)
  และ branch มือถือต้องเป็น **additive เท่านั้น**: จอ >768px ต้อง render เหมือนโค้ดเดิมเป๊ะ
- **CSS class กลางสำหรับมือถือ/จอทัช (2026-07-11 — อยู่ใน index.css):**
  - `className="mgrid"` — ฟอร์ม grid หลายคอลัมน์ (`1fr 1fr`, `1fr 1fr 1fr` ฯลฯ มักอยู่ใน modal)
    → จอ ≤600px ยุบเป็นคอลัมน์เดียวอัตโนมัติ (`!important` ชนะ inline เฉพาะจอแคบ) —
    modal/ฟอร์มใหม่ที่มี grid หลายคอลัมน์**ต้องติด class นี้เสมอ**
  - `className="tbtn"` — ปุ่มไอคอนเล็กในตาราง (✏️ 🗑️ ✕ 💾) → จอทัช (`pointer:coarse`)
    ขยาย hit area ≥40px · เมาส์ไม่เปลี่ยน
- **ลาก marker/หมุดต้องใช้ pointer events** (`onPointerDown` + window `pointermove/pointerup/pointercancel`
  + `touchAction:'none'` บน element ระหว่างโหมดแก้ไข) — ห้ามใช้ mouse events อย่างเดียว
  ไม่งั้นจอทัชลากไม่ได้ · ต้นแบบ: `MachineFloorMap.jsx` (2026-07-11), JigSpinCheck ใน `PMCheckData.jsx`
  · ข้อยกเว้นที่ตั้งใจ: `LineSetup.jsx` ยังเป็น mouse-only (desktop authoring tool — มือถือดูผังได้อย่างเดียว)

---

## 5. Modal & Popup

### Modal ที่มีฟอร์มกรอกข้อมูล (คำสั่ง user 2026-07-09)
- **ห้ามปิดจากการคลิกพื้นหลัง (backdrop)** — เผลอแตะแล้วข้อมูลที่พิมพ์อยู่หายทั้งฟอร์ม ปิดได้จากปุ่ม ✕ / ยกเลิก เท่านั้น
- popup ที่**แสดงผลอย่างเดียว** (ไม่มี input) ปิดจากคลิกนอกกรอบ/auto-hide ได้ตามเดิม
- ต้นแบบ: `QualityControl.jsx`, `QAInspectionSetup.jsx` (Modal กลาง), `PMCheckData.jsx` (HistoryModal)

### Modal ที่โชว์รูปผัง
- ต้อง fit **จอเดียว ไม่มี scroll**: `width: fit-content; maxWidth: 97vw; maxHeight: 97vh; overflow: hidden` + รูป `maxWidth/maxHeight + width/height: auto` (จำกัดสองแกน)
- **หน้าที่แสดง layout เดี่ยวเพื่อ visualize** (เช่น ผังเครื่องจักร PM) บนจอ landscape (PC/tablet/TV) รูปผังต้องเห็นครบใน viewport เดียว **ห้ามให้ต้อง scroll ลงไปดูครึ่งล่าง**: จำกัด `maxHeight: calc(100vh - ความสูง header จริง)` + `width: auto` แล้วจัดกึ่งกลาง
- **ห้ามใช้ object-fit บน img ที่มี marker ทับ** — กล่อง img ต้องเท่ารูปจริงเสมอ ไม่งั้นพิกัด % เพี้ยน
- **Hover/คลิกจุดเครื่องจักร และ WIP ต้องเปิดการ์ดรายละเอียดจากฐานข้อมูล** (คอนเซปเดียวกับ hover การ์ดสกิลพนักงาน): เครื่องจักร → machines + machine_types + รูป/ข้อมูลจาก jigs ที่ลิงก์ผ่าน machine_id (bucket `jig-images`) · WIP material → parts_master ตาม mat_no (มี image_url) · เปิดด้วยคลิก (จอทัชใช้ได้) ปิดด้วย ✕/คลิกนอกกรอบ

### Popup/Modal ต้อง "ขยายกว้าง" ก่อนยอมสูงเกินจอ (2026-07-10)
- จอ landscape (PC/tablet/TV): modal ที่เนื้อหายาว **ห้ามทำทรงแคบสูงแล้วให้ scroll แนวตั้ง** — ให้ขยายกว้าง `width: min(96vw, 1400-1500px)` แล้วจัดเนื้อหาเป็น **2 คอลัมน์** (`gridTemplateColumns: '1fr 1fr'` เมื่อจอ ≥1100px; header/ปุ่มยืนยัน full-width ด้วย `gridColumn: '1 / -1'`) · `maxHeight: 94vh + overflowY: auto` เป็นแค่ fallback สุดท้าย
- ต้นแบบ: modal ตรวจสอบคำขอปิดกะ / ปิดกะ ใน `DailyReport.jsx`

### Section ยาวในหน้า ต้องย่อ/ขยายได้ (minimize/maximize)
- section รายการยาว (Prod Orders, Downtime, งานเสีย ฯลฯ) ต้องมีปุ่มพับ ▼ ที่หัว section (หัวแสดงชื่อ+จำนวนเสมอ) — จำสถานะใน `localStorage` (`dr_live_collapse_<section>` ฯลฯ) · default = ขยาย ยกเว้น section ว่าง
- ลด vertical overflow ของหน้าหลักให้เห็นภาพรวมได้ในจอเดียว แล้วค่อยกดขยายส่วนที่สนใจ

## 5.1 Balloon จุดตรวจบน drawing/รูปอ้างอิง (QA `/qa-setup` · PM Setup)

คนละอย่างกับ marker บนผังไลน์ (section 1) — อันนี้คือหมุดเลขจุดตรวจบนแบบชิ้นงาน/รูปอุปกรณ์:

- รูปทรง: **วงกลม/pill ป้ายเลข** `minWidth` + `padding + borderRadius: 999` เพื่อรองรับ label หลายตัวอักษร (H35, A1, 1.3) — ห้าม fix width วงกลมจนตัวอักษรล้น · ฟอนต์ ≥ 11px (ตามข้อ 4)
- **ขนาดสเกลตามความกว้างรูปที่ RENDER จริง** (สูตรเดียวกับ MK ของผังไลน์ แต่เพดานเล็กกว่า) — วัดด้วย `ResizeObserver` บน wrapper:
  ```js
  const BK = Math.round(Math.max(20-24, Math.min(36-44, renderedImgWidth * 0.04)));
  // ฟอนต์เลขใน balloon = max(11, BK*0.42-0.45) · ขอบขาว = max(2, BK*0.07)
  ```
- **Edge clamp**: ตำแหน่ง*แสดงผล*ต้อง clamp ไม่ให้ balloon ตกขอบรูป (เผื่อ `BK*0.7` ทุกด้าน; anchor แบบห้อยลง `translate(-50%,-100%)` เผื่อหัวบน `BK+4px`) — **ค่าจริงใน DB ไม่เปลี่ยน**
- **หัก letterbox เสมอ (2026-07-10)**: `<img objectFit:'contain'>` ที่โดน `maxHeight`/สัดส่วน container บีบจะเกิดแถบว่างซ้าย-ขวา/บน-ล่าง → **% ของ container ≠ % ของรูปจริง** ห้ามวาง balloon เป็น % ของ container ตรงๆ — ต้องวัดกล่องรูปจริง (naturalWidth/Height เทียบกล่อง render) ได้ `{ox, oy, rw, rh}` แล้ววาง balloon ใน layer `position:absolute; left:ox; top:oy; width:rw; height:rh` (ใช้ % ของ layer นี้) และ**การแปลงตำแหน่งคลิกวาง pin ต้องวัดจาก layer เดียวกัน** · ใช้ hook กลาง `src/utils/useImgBox.js` (คณิตเดียวกับ `MachineFloorMap.jsx`) — ทั้ง 3 renderer ฝั่ง PM ใช้แล้ว และ `maxHeight` ของรูป **default = 300 เท่ากัน** (จอวางกับจอดูเห็นสัดส่วนเดียวกัน) · ข้อยกเว้น: จอตรวจ (`JigSpinCheck`) โหมด desktop 2 คอลัมน์รับ prop `maxH` ให้สูงขึ้นได้ (เช่น 460) เพราะรูปอยู่คอลัมน์กว้าง — pin ยังตรงเพราะหัก letterbox แล้ว (ไม่มีโมเดล 3D แล้ว — เหลือแค่รูป spin)
- พิกัดเก็บเป็น **% ของรูป** (`pos_x/pos_y` 0–100 ฝั่ง QA, `x_pos/y_pos` 0–1 ฝั่ง PM)
  - **anchor ฝั่ง QA = `translate(-50%,-50%)`** (จุดกึ่งกลาง balloon = พิกัด — ดู `QAInspectionSetup.jsx`)
  - **anchor ฝั่ง PM = `translate(-50%,-100%)`** (map-pin: ปลายล่าง balloon = พิกัด) — ใช้เหมือนกัน**ทั้ง 3 renderer**: ตอนวาง (`SpinAnnotator.jsx`), ตอนตั้งค่า (`PMSetup.jsx`), ตอนตรวจ/ดูผล (`PMCheckData.jsx`) เพราะทั้งหมดอ่าน `jig_checkpoints.x_pos/y_pos` ตัวเดียวกัน — **ห้ามแก้ anchor แค่ไฟล์เดียว** ไม่งั้น pin จะเลื่อนครึ่งความสูงระหว่างจอวางกับจอดู (แก้ต้องแก้พร้อมกันทั้ง 3)
- 1 part/อุปกรณ์มี**หลายรูป/หลายเฟรมได้** — balloon ต้องผูกกับรูปที่มันอยู่ (`drawing_id`/`image_id`) ลบรูป = ถอดตำแหน่ง balloon แต่**ห้ามลบตัวจุดตรวจ** · ฝั่ง PM รองรับ 360° spin (หลายเฟรม/อุปกรณ์) ผ่าน component กลาง `src/components/SpinAnnotator.jsx` — pin ผูกกับเฟรมที่วาง (`image_id`), ลากรูปหมุนเฟรม, reuse component นี้แทนเขียน annotator ใหม่
- **หน้าตรวจ PM (`PMCheckData` — JigSpinCheck) 2026-07-10:** รูปหลายมุม (spin) + auto-play ▶/⏸ · **หมุด sync กับ checklist**: สีหมุด = สถานะตรวจจริง (เขียว OK/แดง NG/เหลืองเฝ้าระวัง/ยังไม่ตรวจ=สีหมวด) เปลี่ยนสด, คลิกหมุด↔ไฮไลต์+เลื่อนแถวเช็ค, คลิกแถว→หมุนไปเฟรมของจุดนั้น · **ฟิลเตอร์แผนก = ความรับผิดชอบตามชนิดอุปกรณ์** (ผลิต=ทุกชนิด Autonomous · mtn=machine · jig mtn=jig · die mtn=die) กรองรายการอุปกรณ์ ไม่ใช่แค่เปลี่ยน checklist · **responsive**: จอ ≤860px = master-detail (ลิสต์/ฟอร์มทีละอัน + ปุ่มกลับ) · จอ ≥1180px = 2 คอลัมน์ (รูปซ้าย sticky · เช็คขวา) · desktop กว้างปกติไม่แตะ
- เลขจุดตรวจแบบ text เรียงด้วย natural sort (`localeCompare(..., { numeric: true })`) — H2 มาก่อน H10
- สี: จุด control พิเศษ (Rank M/SC) = แดง/amber, จุดทั่วไป = น้ำเงิน `#4d9fff`, กำลังวางตำแหน่ง = amber
- ชื่อแผ่น drawing ฝั่ง QA ให้เลือกจาก **view มาตรฐาน** (Front/Back/Top/Bottom View, Side View LH/RH, Isometric, Section, Detail) ผ่าน picker — พิมพ์เองได้เฉพาะกรณีพิเศษ

## 5.2 ฟอร์ม master data ต้องมี picker จากฐานที่มีอยู่

ฟิลด์ที่ข้อมูลมีอยู่แล้วในฐานอื่น ให้มี**ช่องค้นหา-เลือกเติมอัตโนมัติ** ไม่ปล่อยให้พิมพ์ซ้ำ (พิมพ์เองได้เป็น fallback):
- เพิ่ม Part ฝั่ง QA → ดึงจาก `dr_products` + `bom_items` (ดู `QAInspectionSetup.jsx`)
- เพิ่มอุปกรณ์ฝั่ง PM → ดึงจาก machine master (ดู `PMSetup.jsx` addMode workstation)
- รูปชิ้นงานที่อัพไว้ใน Product Master (`dr_products.image_url`) ให้ดึงมาแสดงซ้ำได้เลย ไม่อัพใหม่

## 6. บอร์ดเวลา (Time boards) — Heijunka / Shipping Chart / Rack Center / Store

pattern ร่วมของทุกบอร์ดที่วางรายการบนแกนเวลา (เพิ่ม 2026-07-10):

- **กรอบวันงาน 08:00 → 08:00 วันถัดไป** เต็ม 24 ชม.ในจอเดียว ไม่มี scroll แนวนอน —
  เวลาก่อนตี 8 = ช่วงกะดึกของวันงานเดิม (นาทีแบบ wrap: h<8 บวก 1440) ใช้ helper
  `frameMin`/`frameMinFromIso` จาก `src/utils/timeFrame.js`
  - **ข้อยกเว้นมือถือ ≤768px (2026-07-11):** จอแคบเกินกว่าจะอัด 24 ชม. (เหลือ ~10px/ชม. อ่านไม่ออก)
    → อนุญาตให้บอร์ด**เลื่อนแนวนอน**เฉพาะมือถือ: ครอบส่วนตารางด้วย `overflowX:'auto'` + inner
    `minWidth` (~780px เต็มวัน / ~620px ครึ่งวัน) + ลดป้ายซ้ายเหลือ ~96px + ป้ายซ้าย
    `position:'sticky', left:0` (ใส่ background ทึบ) — ตรวจด้วย hook กลาง `src/utils/useIsMobile.js`
    **desktop ห้ามมี scroll เหมือนเดิม** · ทำแล้วใน: InternalTimeBoard, CustomerDemand (Shipping
    Chart), HeijunkaKanban (DeliveryTimelineBoard), Dashboard (Heijunka board)
- **เส้นเวลาปัจจุบัน**: class `.now-line` (playhead ชมพู #ec4899 กระพริบเรืองแสง —
  สีชมพูจงใจไม่ซ้ำสีสถานะใดๆ) + ป้ายเวลา `.now-chip` (⏱ HH:MM) ลอยบนหัวตาราง —
  สอง class นี้อยู่ใน `index.css` ห้ามวาดเส้นเองด้วยสีอื่น
- **เงาเวลาเบรค**: แถบลายเฉียง `repeating-linear-gradient(45deg, rgba(148,163,184,0.18) …)`
  + ขอบประซ้าย/ขวา จากตาราง `break_policies` (DR, is_active) — แปลงเป็นช่วงนาทีบนกรอบ
  ด้วย `breaksToFrame()` ใน `src/utils/timeFrame.js` · ชี้เมาส์เห็นชื่อช่วงพัก
- **เวลาชนกันแยกเลนอัตโนมัติ** (รายการห่างกัน < 40 นาทีถือว่าชน) — ห้ามวางทับกัน
- **ย่อ/ขยายรายแถว**: คลิกชื่อปลายทาง/ลูกค้า → โหมดย่อเหลือจุดสถานะ 9px ตามตำแหน่งเวลา
- **คลิกบล็อก → popup** รายละเอียด + ปุ่ม action (ตามข้อ 1.4: ต้องมีทางปิดเสมอ)
- ฟอนต์: ป้ายชั่วโมงบนแกน/ป้ายรอง ≥ 11px · ตัวเลขเวลาในบล็อก 12px (ตามข้อ 4)
- บอร์ดภายในโรงงาน (ปลายทาง = ไลน์) ให้ใช้ component กลาง
  `src/components/InternalTimeBoard.jsx` — อย่าเขียนบอร์ดใหม่จากศูนย์

- **โครงบอร์ด Heijunka 2 กะ "พาร์ทละ 1 บล็อก"** (2026-07-09): ป้าย+รูปพาร์ทใหญ่ 1 อันครอบ 2 แถบเวลา
  (☀️ 08–20 บน / 🌙 20–08 ล่าง) หัวชั่วโมงแสดงเวลาคู่บน-ล่างในคอลัมน์เดียวกัน —
  ห้ามกลับไปวาดแยกบล็อกเช้า/ดึกซ้ำป้ายพาร์ท (ต้นแบบ: Heijunka บน Dashboard และหน้าจัดการไลน์)
- **Downtime/สาเหตุดีเลย์บนบอร์ดต้องผูกกับ sub-line ของใบงานนั้น** (`line_name`) ห้ามจับคู่ด้วยเวลาทับซ้อนอย่างเดียว
  (เคยพัง: เหตุของ Line 61 โผล่เป็นสาเหตุบนแถวของ Line 60)

หน้าอ้างอิง: `HeijunkaKanban.jsx` (ต้นแบบ now-line/เงาเบรค), `CustomerDemand.jsx`
(Shipping Chart), `RackCenter.jsx` + `LineStock.jsx` (ใช้ InternalTimeBoard)

---

## 7. เบ็ดเตล็ดที่เคยกัด

- `index.css` ตั้ง `input{width:100%}` ทั้งแอป — input ใน flex row ต้องกำหนด width เอง (checkbox/radio มี rule ยกเว้น `width:auto` แล้ว — ห้ามลบ)
- พื้นที่ว่างแนวบนของทุกหน้า: `main` ใช้ `paddingTop: 14` (ไม่ใช่ 60) — มีแค่ icon cluster fixed มุมขวาบน; แถบควบคุมที่ชิดขวาบนของหน้า ให้เผื่อ `paddingRight` ~52px กันชนไอคอน
- ปุ่มพับ sidebar อยู่**ในหัว sidebar** (ปุ่ม ⟨ ข้างโลโก้) — ปุ่มลอย ☰ โชว์เฉพาะตอนพับ ห้ามมีปุ่มลอยทับเนื้อหา
- เข้าโมดูลจากหน้าหลัก (DeptHub) → sidebar กาง**เฉพาะหมวดของโมดูลที่กด** หมวดอื่นพับอัตโนมัติ (2026-07-10) — การ์ดใน DeptHub ผูกหมวดผ่าน `navGroups` + เรียก `focusSidebarGroups()` จาก App.jsx · เพิ่มการ์ด/หมวดใหม่ต้องใส่ `navGroups` ด้วยเสมอ (ชื่อต้องตรงกับ `NAV_GROUP_ORDER`) · user ยังพับ/กางเองต่อได้ตามปกติ
- ชิปเมนูย่อยบนการ์ด DeptHub **ดึงจาก `NAV_ITEMS` อัตโนมัติ** ผ่าน `navItemsForGroups(navGroups, role)` (กรองสิทธิ์เหมือน sidebar) และ**คลิกเข้าหน้านั้นได้เลย** (2026-07-10) — **ห้ามพิมพ์รายชื่อเมนูซ้ำใน DeptHub** เพิ่มเมนูใหม่ใน NAV_ITEMS แล้วชิปบนการ์ดอัพเดทเองทั้งหน้า (เคยมี list มือแล้ว drift ไม่ตรงกับ sidebar)
- สิทธิ์ action ใช้ `can(resource, action, role)` จาก `src/utils/permissions.js` — ห้าม hardcode `['admin',...].includes(role)` เพิ่ม (ดู docs/PERMISSIONS-DESIGN.md)
- วันที่งาน: `getWorkDate()` เท่านั้น (ก่อน 08:00 = วันก่อนหน้า) ห้าม `toISOString()`
- อัปโหลดรูป: ผ่าน `ImageCropModal` (รูปนิ่งบีบอัตโนมัติ · GIF ส่งทั้งไฟล์ ≤2MB คงการขยับ — ห้ามถอด cap) — ยกเว้นรูปที่ crop ไม่เหมาะ (ผัง/drawing/หลักฐาน) ให้บีบก่อนอัปโหลดแทน ห้ามส่งรูปดิบ + เปลี่ยน/ลบรูปแล้วลบไฟล์เก่าจาก storage เสมอ (2026-07-10 — รายชื่อหน้า+ข้อยกเว้นดู CLAUDE.md "Storage & รูปภาพ")
- หน้าที่ query ตาม section: กรองด้วย `sections` array จาก UserContext (`inSectionScope` / `.in('section', ...)`) ไม่ใช่ `section` เดี่ยว (2026-07-09 — ดู CLAUDE.md "Section/Line/Team Scoping")

---

## วิธีอัพเดทไฟล์นี้

เมื่อ session ไหนสร้าง/เปลี่ยน pattern ที่กระทบมากกว่า 1 หน้า (marker, สี alarm, รูปแบบการ์ด, ฟอนต์มาตรฐาน, modal ฯลฯ):
1. แก้โค้ดให้สอดคล้องกับ convention เดิม — ถ้าจำเป็นต้องเปลี่ยน convention ให้แก้**ทุกหน้า**ที่ใช้ pattern นั้นด้วย
2. อัพเดท section ที่เกี่ยวข้องในไฟล์นี้ + วันที่ "อัพเดทล่าสุด" ในคอมมิทเดียวกัน
3. ถ้าเพิ่ม pattern ใหม่ ให้เพิ่ม section ใหม่พร้อมระบุหน้าอ้างอิง (ต้นแบบ)
