# 🎨 UI Conventions — ESM Design System กลาง

> **ทุก session ที่แก้ UI ต้องอ่านไฟล์นี้ก่อนลงมือ และเมื่อสร้าง/เปลี่ยน pattern ที่ใช้ร่วมกันหลายหน้า ต้องอัพเดทไฟล์นี้ในคอมมิทเดียวกัน**
> เหตุผล: หลาย session ทำงานขนานกัน ถ้าไม่มีมาตรฐานกลาง จะได้ UI คนละทรง (เคยเกิดแล้ว: จุดเครื่องจักรฝั่ง MTN ทำเป็นเหลี่ยม ขณะที่ระบบหลักเป็นวงกลม)

อัพเดทล่าสุด: 2026-07-14 (ใหม่ §5.1 หมุดจุดตรวจใช้ `CalloutPin` — ลูกศรชี้จุดจริง + วงเลขหลบข้าง ไม่บังจุด · §6.5 ห้ามเหลือขอบข้างว่างบน landscape · บอร์ดเวลา: HH:00 + ชิป ⏳ ไม่ระบุเวลา · ปุ่ม 🏷️ โชว์/ซ่อน สองสถานะ · pillMaxW/subPillMaxW · ลำดับจุด คน→เครื่องจักร→WIP · mobile: useIsMobile hook / time board เลื่อนแนวนอนบนมือถือ / mgrid·tbtn / pointer-drag)
อัพเดท 2026-07-15: §5.1 viewer วางจุดต้องซูมได้ (default เต็มความกว้างกรอบ ไม่ใช่ขนาดไฟล์)
อัพเดท 2026-07-21: ใหม่ §5.3 dropdown ลำดับชั้นองค์กรต้อง cascade + ล้างตัวลูกเมื่อเปลี่ยนตัวแม่

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

**ป้าย (pill) spec:** `background: rgba(0,0,0,0.75-0.78)` · `borderRadius: 4` · ตัวหนังสือขาว bold · `whiteSpace: nowrap` + `overflow: hidden` + `textOverflow: ellipsis` · `maxWidth` ใช้ `pillMaxW`/`subPillMaxW` จาก markerScale — **ห้ามผูกกับขนาดวงกลมล้วนๆ**: วงเล็ก (ผังแน่น) เคยทำป้ายแคบจนเหลือ "S…"/"0…" อ่านไม่ออก = มีป้ายไปก็ไร้ประโยชน์ (ขั้นต่ำ ~88-96px พออ่าน 8-10 ตัวอักษร)

### สูตรขนาด — ใช้ util กลาง `src/utils/markerScale.js` เท่านั้น (2026-07-10)
```js
const { MK, SUB, pillFont, subPillFont, pillMaxW, subPillMaxW, ... } = markerScale(renderedMapWidth, { machineCount });
// MK  = จุดคน/จุดงาน (max(34, min(84, w*0.055)))
// SUB = เครื่องจักร/WIP — density-aware: ≤18 เครื่อง 0.6×MK · 19-32 → 0.5× · >32 → 0.42×
// pillMaxW/subPillMaxW = ความกว้างสูงสุดป้ายชื่อ มีขั้นต่ำ 96/88px ให้อ่านชื่อออกเสมอ
```
- **ห้ามตั้งสูตรเองในหน้า** — ทุกหน้าที่วาดผัง (Setup + ทุกหน้าโชว์) เรียก util นี้ → **WYSIWYG: ตอน setup เห็นขนาด/ป้ายเหมือนตอนแสดงผลจริงทุกหน้า** (เคยพัง: setup ใช้ 0.75× ป้ายเดียว / Management ใช้ 0.6× + ป้ายรอง → ตอนวางดูไม่ทับ ตอนโชว์ทับเละ)
- ฟอนต์ห้ามต่ำกว่า 11px เพื่อแก้ป้ายทับกัน — ให้ผู้ใช้กดซ่อนป้าย (ดูจาก tooltip/คลิกการ์ดรายละเอียด) แทนการย่อฟอนต์

### ปุ่ม 🏷️ ป้ายชื่อ — โชว์/ซ่อน สองสถานะเท่านั้น คุมทุกชนิดจุด (2026-07-11)
ทุกหน้าที่มีผัง (Management / LineSetup / MachineFloorMap) ใช้ boolean `showPills` **default = โชว์**:
- โชว์: ป้ายชื่อทุกจุด (คน/เครื่องจักร/WIP) แสดงหมด · ซ่อน: ผังโล่งเห็นเฉพาะวงกลม
- ป้ายที่**โชว์เสมอแม้กดซ่อน**: เครื่อง Downtime ค้าง, WIP ต่ำกว่า min, PM เกินกำหนด (ผัง MTN), หมุดที่กำลังเลือก/แก้ไข/ลากวางคน (ต้องเห็น fit preview)
- label บนปุ่มบอก action ที่จะเกิดเมื่อกด: กำลังโชว์ → "🏷️ ซ่อนป้าย" · กำลังซ่อน → "🏷️ โชว์ป้าย" — อย่าทำปุ่ม toggle เงียบที่ label ไม่เปลี่ยน
- ประวัติ: เคยเป็น boolean "บังคับโชว์หมุดรอง" โผล่เฉพาะผังแน่น (ผู้ใช้งง "ทำไมมีผลแค่เครื่องจักร") → เคยแก้เป็น 3 สถานะ auto/all/none (ผู้ใช้ตัดสิน: เกินจำเป็น) → สรุปเหลือ โชว์/ซ่อน — **อย่าเพิ่มโหมด auto ซ่อนตามความแน่นกลับมา**

### ลำดับชนิดจุดมาตรฐาน: คน → เครื่องจักร → WIP (2026-07-11)
ทุกที่ที่แสดงชนิดจุดเรียงกัน (แท็บ LineSetup, ปุ่ม filter MAN/MACHINE/WIP บน Management, legend ฯลฯ)
ต้องเรียง **คน/จุดงาน → เครื่องจักร → WIP** ตามลำดับ 4M (Man, Machine, Material) — ห้ามสลับ (เคยหลุด: แท็บ LineSetup เรียง จุดงาน→WIP→เครื่องจักร ขัดกับปุ่ม filter ที่ Management)

### กติกาที่ต้องมีเสมอ
1. **Anchor = ศูนย์กลางวงกลมต้องตรงพิกัดจริงเป๊ะ** — wrapper ที่ใส่ `translate(-50%,-50%)` ต้องสูงเท่า*วงกลมเท่านั้น* และ**ป้าย/badge ทุกอันต้องเป็น `position:absolute; top:100%` ห้อยใต้** (ห้ามใส่ใน flex column ปกติ — จะทำให้จุดกึ่งกลางเลื่อนขึ้นครึ่งป้าย marker ลอยเหนือตำแหน่งจริง/ตกขอบบน — เคยพังที่ Management มาแล้ว) · pos_top/pos_left เป็น % ของรูปจริง ระวัง letterbox จาก object-fit: contain ต้องคูณ offset+rendered size
2. **De-overlap**: marker ที่ทับกันให้ผลักออกจากกันในพิกเซลจริง + วาดเส้นประโยงกลับตำแหน่งจริง (ดู Dashboard modal / Management เป็นต้นแบบ) — ห้ามแก้ตำแหน่งใน DB
3. **Edge clamp**: ตำแหน่ง*แสดงผล*ต้องถูก clamp ไม่ให้วงกลม+ป้ายตกขอบรูป — เผื่อซ้าย/ขวา/บน `size*0.55`, ล่าง `size*1.35` (มีป้ายห้อย) — ตำแหน่งจริงใน DB ไม่เปลี่ยน
4. Hover card แสดงเฉพาะอุปกรณ์ที่ hover ได้จริง: `window.matchMedia('(hover: hover)').matches` — จอทัชให้ใช้ modal ที่มีปุ่มปิด + popup ทุกชนิดต้องมีทางปิดเสมอ (✕/auto-hide — กติกา backdrop click ดู section 5)
5. **จุด/marker วางได้เฉพาะบนผังที่เป็น "ผังจริง" ของไลน์นั้น** (2026-07-16) — pos_top/pos_left ผูกกับผังของไลน์ที่จุดนั้นสังกัด · เวลาแสดงผังของไลน์ (โดยเฉพาะไลน์แม่ที่ view รวมไลน์ย่อย) ต้องวาดเฉพาะจุดของไลน์ที่ "ผังจริง" (ของตัวเอง → ไล่ขึ้นไลน์แม่ที่มีผัง) ตรงกับผังที่กำลังแสดง · **ไลน์ย่อยที่มีผังเป็นของตัวเอง = ห้ามเอาจุดไปวางทับผังไลน์แม่ (คนละรูป จะทับกัน/ผิดตำแหน่ง)** ส่วนไลน์ย่อยที่ไม่มีผัง (ยืมรูปไลน์แม่) จุดของมันวางบนผังไลน์แม่ได้ · ต้นแบบ: Dashboard `layoutLineNamesForCard` (ข้ามลูกที่มีผังเอง) / Management `belongsToShownMap` (resolve ผังจริงต่อจุดแล้วเทียบกับผังที่แสดง)
6. **⚠️ ห้ามใช้ `backdrop-filter: blur()` กับ marker/ป้าย/การ์ดที่วาดซ้ำหลายอันบนผัง/บอร์ด (2026-07-15)** — `backdrop-filter` บังคับ browser re-render + gaussian-blur พื้นหลังใต้ทุก element **ทุกเฟรม** พอมี marker หลายสิบจุด (คน/สถานี/เครื่อง/การ์ดพนักงานใน pool) GPU ของ Smart TV รับไม่ไหว **เปิดแป๊บเดียวค้างทั้งเครื่อง** (เคยเกิดที่ /management + /dashboard บน TV) → ใช้ `background: rgba(0,0,0,0.75-0.88)` ทึบแทน (อ่านออกเท่ากันบนบอร์ดมืด) · backdrop-filter ใช้ได้เฉพาะ overlay ของ modal ที่มีชิ้นเดียวและเปิดชั่วคราว ไม่ใช่ element ที่ render ซ้ำ · หลักเดียวกันกับ animation ที่กระพริบ `box-shadow` (แพง) — จำกัดเฉพาะ Andon แดงที่จำเป็น อย่าใส่ element ที่โผล่ตลอด
7. **โหมดเบาจอ TV — `data-perf="lite"` (2026-07-15):** App.jsx ตั้ง `data-perf="lite"` บน `<html>` อัตโนมัติเมื่อ `role === 'display'` (บัญชีที่รันบนจอ TV/บอร์ด GPU อ่อน) · `index.css` override animation ที่กระพริบ `box-shadow` (dt-alarm-blink, person-alarm-red, mo-card-alert, now-line/now-chip glow) ให้กระพริบด้วย **สี/ขอบอย่างเดียว** + ซ่อน `#noise-overlay` — Andon แดงยังกระพริบตามกฎ §2 แต่ไม่รีดเพนต์เบลอ · เพิ่ม animation box-shadow ใหม่ที่ไหน ให้เพิ่ม lite override คู่กันเสมอ

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
- จุดสถานะ "ระบบทำงาน/Live" (เช่น AUTO REFRESH บน OEE, จุดเขียวหน้า Hub): **นิ่ง+เรืองแสง** ห้ามกระพริบ —
  กระพริบสงวนให้สถานะแดงเท่านั้น (กวาดแก้แล้ว 2026-07-12: oee-pulse, hub-glow → นิ่ง)
- **ข้อยกเว้นที่ตั้งใจ (2026-07-12):** `pulse-ring` วงแหวน**น้ำเงิน**บนสถานีว่างใน Management โหมดมือถือ
  ขณะเลือกคนเพื่อวาง — เป็น interaction affordance (บอกจุดที่ drop ได้) ไม่ใช่ไฟสถานะ Andon จึงกระพริบได้
  เงื่อนไข: ใช้สีน้ำเงินเท่านั้น (ไม่ชนสีสถานะ เขียว/เหลือง/แดง) และหยุดทันทีที่วางเสร็จ/ยกเลิก

---

## 3. การ์ด (Cards) ใน grid

- การ์ดในหมวด/แถวเดียวกันต้อง**สูงเท่ากัน**: wrapper `height: 100%` + การ์ด `height: 100%` + `minHeight` เดียวกัน + `display:flex; flexDirection:column; justifyContent:space-between`
- ทั้งการ์ด**ไม่ใช่**จุดคลิก — action ต้องเป็นปุ่ม/ป้ายเฉพาะจุดที่เห็นชัด (เช่นปุ่ม "ดูไลน์ย่อย ▾")
- แถวขยายลูก (nested) ให้ทำเป็น panel เต็มแถว `gridColumn: '1 / -1'` ขอบประ + หัวข้อบอกว่าเป็นลูกของอะไร ไม่ปนใน grid เดียวกับการ์ดหลัก
- **การ์ด KPI/สถิติ ให้ติด class กลาง `kpi-lift`** (2026-07-14 — อยู่ใน index.css): hover ยกการ์ด -4px + เงา
  เฉพาะอุปกรณ์มีเมาส์จริง (`@media (hover:hover)`) — ห้ามเขียน hover lift เองต่อหน้า · ตัวเลขวิ่ง count-up
  ทำได้ (ดู `useCountUp` ใน DeptHub) — เป็น animation ตอนค่าเปลี่ยน ไม่ใช่ไฟกระพริบ ไม่ขัด Andon §2

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
- **CSS กลาง `.modal-2col` (2026-07-21 — อยู่ใน index.css):** ฟอร์มใน modal ติด class นี้ + แบ่งลูกเป็น `.m2c-col` (คอลัมน์) / `.m2c-span` (เต็มแถว เช่น แถวปุ่มบันทึก) → จอ ≥1100px เป็น grid 2 คอลัมน์อัตโนมัติ จอแคบยุบเป็นคอลัมน์เดียว — modal ฟอร์มยาวใหม่ให้ใช้ class นี้แทนเขียน grid เอง (ต้นแบบ: modal แก้ไขพนักงานใน operator.jsx) · กวาดแก้แล้ว 2026-07-21: CAPA/8D + NCR (QualityControl), จ่าย/ปรับ stock + รอบจัดส่ง (LineStock), PMSetup, Improvements, แก้เวลากะ (DailyReport)

### Section ยาวในหน้า ต้องย่อ/ขยายได้ (minimize/maximize)
- section รายการยาว (Prod Orders, Downtime, งานเสีย ฯลฯ) ต้องมีปุ่มพับ ▼ ที่หัว section (หัวแสดงชื่อ+จำนวนเสมอ) — จำสถานะใน `localStorage` (`dr_live_collapse_<section>` ฯลฯ) · default = ขยาย ยกเว้น section ว่าง
- ลด vertical overflow ของหน้าหลักให้เห็นภาพรวมได้ในจอเดียว แล้วค่อยกดขยายส่วนที่สนใจ
- ถ้า section ว่างตอน mount แล้วข้อมูลมาทีหลัง (โหลด async) ให้เก็บเฉพาะ "override ของ user" ใน state — default เป็นค่าสด จะได้กางเองเมื่อข้อมูลมา (pattern `CollapseCard` ใน ProductHistory.jsx)

### ตาราง/ลิสต์ข้อมูลเยอะ ต้องเป็น drill-down hierarchy (2026-07-30 — คำสั่ง user)
รายการดิบหลักร้อยแถวขึ้นไป **ห้าม render แบนทั้งก้อน** — จัดเป็นชั้น "สรุป → เจาะ" (ต้นแบบ: ตารางใบผลิต `ProductHistory.jsx` วัน → ไลน์·กะ → รายใบ):
- **ระดับบนสุด = ระดับที่ user ดูบ่อยสุด** (เช่น รายวัน — "รายใบไม่ได้เน้นดูบ่อย รายวันสำคัญสุด") · คลิกแถวเพื่อแตกชั้นถัดไป ▸/▾ นำหน้า · ชั้นลึกลง indent เพิ่ม (`paddingLeft` +24-28/ชั้น) + สลับพื้น `var(--bg2)` ให้เห็นระดับ
- **แถวสรุปทุกชั้นโชว์ aggregate ครบ** (จำนวน/เป้า/ผลิตได้/NG ฯลฯ) — อ่านจบได้โดยไม่ต้องเจาะ ห้ามบังคับ user คลิกเพื่อเห็นตัวเลขรวม
- **จำกัดจำนวนแถวระดับบนที่แสดงครั้งแรก** + ปุ่ม "▼ แสดงอีก N (ทั้งหมด M)" — ห้ามตัดข้อมูลเงียบๆ และห้ามปล่อย DOM หลายร้อยแถวโดยไม่จำเป็น
- **ตัวเลือก entity (ลิสต์เลือกสินค้า/พนักงาน/เครื่อง) ที่ยาว:** จัดกลุ่มตามลำดับชั้นที่มีความหมาย (เช่น ตามไลน์) + หัวกลุ่ม sticky + เลื่อนในกรอบ `maxHeight` — ห้ามเป็น chip กองรวม · เลือกแล้ว**พับลิสต์อัตโนมัติ** และต้องมีปุ่มย้อนกลับชัดเจนบนการ์ดที่เลือก ("✕ ปิด — เลือกใหม่") ไม่ใช่แถบตัวหนังสือเล็กๆ

### กราฟแท่งรายวัน/ไทม์ซีรีส์ (2026-07-30 — คำสั่ง user)
- **แกนวันต่อเนื่อง ห้ามข้ามวันที่ไม่มีข้อมูล** — วันว่างแสดงเป็นตอเทาเตี้ย + tooltip "ไม่มีการผลิต" (เห็นช่วงหยุดคาตา ไม่หลอกว่าผลิตติดกัน) · cap จำนวนแท่ง (~400) กันช่วงยาวทำหน้าค้าง
- **สีตามความหมายมาตรฐาน: เขียว (`var(--accent)`) = ของดี · แดง = NG** ซ้อนบนแท่งเดียวกัน (สเกลจากยอดรวม) + **legend ใต้กราฟเสมอ**
- **กราฟต้องมี caption อธิบายว่าความสูง/สีหมายถึงอะไร** — กราฟที่ต้องเดาความหมาย = ไม่ผ่าน · รายการน้อย (≤20 แท่ง) โชว์ตัวเลขบนหัวแท่งเลย ไม่ต้องรอ hover (จอทัชไม่มี hover — ข้อ 4)
- ป้ายวันใต้แท่งฟอนต์ ≥11px — ถ้าแน่นให้เว้นแท่งเว้นป้าย ไม่ใช่ลดฟอนต์

## 5.1 Balloon จุดตรวจบน drawing/รูปอ้างอิง (QA `/qa-setup` · PM Setup)

คนละอย่างกับ marker บนผังไลน์ (section 1) — อันนี้คือหมุดเลขจุดตรวจบนแบบชิ้นงาน/รูปอุปกรณ์:

- รูปทรง: **วงกลม/pill ป้ายเลข** `minWidth` + `padding + borderRadius: 999` เพื่อรองรับ label หลายตัวอักษร (H35, A1, 1.3) — ห้าม fix width วงกลมจนตัวอักษรล้น · ฟอนต์ ≥ 11px (ตามข้อ 4)
- **ขนาดสเกลตามความกว้างรูปที่ RENDER จริง** (สูตรเดียวกับ MK ของผังไลน์ แต่เพดานเล็กกว่า) — วัดด้วย `ResizeObserver` บน wrapper:
  ```js
  const BK = Math.round(Math.max(20-24, Math.min(36-44, renderedImgWidth * 0.04)));
  // ฟอนต์เลขใน balloon = max(11, BK*0.42-0.45) · ขอบขาว = max(2, BK*0.07)
  ```
- **Edge clamp**: ตำแหน่ง*แสดงผล*ต้อง clamp ไม่ให้ balloon ตกขอบรูป (เผื่อ `BK*0.7` ทุกด้าน; anchor แบบห้อยลง `translate(-50%,-100%)` เผื่อหัวบน `BK+4px`) — **ค่าจริงใน DB ไม่เปลี่ยน**
- **หัก letterbox เสมอ (2026-07-10)**: `<img objectFit:'contain'>` ที่โดน `maxHeight`/สัดส่วน container บีบจะเกิดแถบว่างซ้าย-ขวา/บน-ล่าง → **% ของ container ≠ % ของรูปจริง** ห้ามวาง balloon เป็น % ของ container ตรงๆ — ต้องวัดกล่องรูปจริง (naturalWidth/Height เทียบกล่อง render) ได้ `{ox, oy, rw, rh}` แล้ววาง balloon ใน layer `position:absolute; left:ox; top:oy; width:rw; height:rh` (ใช้ % ของ layer นี้) และ**การแปลงตำแหน่งคลิกวาง pin ต้องวัดจาก layer เดียวกัน** · ใช้ hook กลาง `src/utils/useImgBox.js` (คณิตเดียวกับ `MachineFloorMap.jsx`) — ทั้ง 3 renderer ฝั่ง PM ใช้แล้ว · **WYSIWYG จอวาง↔จอตรวจ มาจาก useImgBox (หัก letterbox) ไม่ได้พึ่ง maxHeight เท่ากัน** ดังนั้น maxHeight ปรับให้เหมาะกับพื้นที่/แนวรูปได้อิสระ (ดูบล็อก "รูป spin แนวตั้ง" ด้านล่าง) — pin ยังตรงเสมอ (ไม่มีโมเดล 3D แล้ว — เหลือแค่รูป spin)
- พิกัดเก็บเป็น **% ของรูป** (`pos_x/pos_y` 0–100 ฝั่ง QA, `x_pos/y_pos` 0–1 ฝั่ง PM) — **ค่าที่เก็บคือ "จุดจริง" ที่ต้องตรวจเสมอ** (ไม่ใช่ตำแหน่งวงเลข)
- **หมุด = callout ไม่ใช่วงทับจุด (2026-07-14 — คำสั่ง user: วงเลขบังจุดที่จะตรวจ):** ใช้ component กลาง **`src/components/CalloutPin.jsx`** ทุก renderer (QA + PM) — วาด **ลูกศร/จุดเป้าที่พิกัดจริง + เส้นชี้ + วงเลขหลบไปด้านข้าง** (offset อัตโนมัติ หลบขอบรูป: ใกล้ขวา→ซ้าย, ใกล้บน→ล่าง) วงเลขจึงไม่บังจุด · วงเลขคือตัวคลิก/ลาก · จุด+เส้น+ลูกศร `pointerEvents:none`
  - **เลิกใช้ anchor เดิม** (QA `translate(-50%,-50%)` / PM `translate(-50%,-100%)`) — CalloutPin คุมตำแหน่งเองจาก `xPct/yPct` (จุดจริง) + `layerW/layerH` (กล่องรูป) · **ห้ามกลับไปวางวงเลขทับพิกัดตรงๆ**
  - ใช้แล้วครบ**ทั้ง 4 renderer**: `SpinAnnotator.jsx` (วาง), `PMSetup.jsx` (ตั้งค่า), `PMCheckData.jsx` (ตรวจ/ดูผล — JigSpinCheck), `QAInspectionSetup.jsx` (QA drawing) — **แก้ CalloutPin ที่เดียว มีผลทุกหน้า** · หน้าใหม่ที่มีหมุดจุดตรวจให้ reuse component นี้ ห้ามวาดหมุดเอง
  - **ต้องเด้งบนพื้นหลังทุกสี (2026-07-24 — คำสั่ง user: ลูกศรจมกับภาพ):** CalloutPin วาดเส้นชี้เป็น 2 ชั้น (casing มืด `rgba(0,0,0,0.55)` ใต้ + เส้นสีทับ) + `filter: drop-shadow` ที่ svg + ลูกศรมีขอบขาวหนา — กันเส้น/ลูกศรสีกลืนกับรูปเครื่องจักร (เช่น marker เขียวบนพื้นเขียว) · ปรับความเข้มที่ CalloutPin จุดเดียว
- **รูป spin ฝั่ง PM = แนวตั้งเป็นหลัก (ถ่ายจากมือถือ) — container หุ้มรูปพอดี (2026-07-24 — คำสั่ง user):** `JigSpinCheck`/`SpinAnnotator` เดิม `<img width:100% maxHeight:300>` ทำให้รูปแนวตั้งมีแถบเทาข้างเสียพื้นที่ · เปลี่ยนเป็น container `width:fit-content; margin:0 auto` + img `maxWidth:100%; maxHeight: min(<maxH>px, 76vh)` (ไม่ใส่ width:100%) → รูปหุ้มพอดีกึ่งกลาง ไม่มีแถบข้าง + สูงได้เต็มจอมือถือ · `maxH`: JigSpinCheck 2 คอลัมน์ 560 / เดี่ยว 480 · SpinAnnotator 520 · **pin ยังตรงเพราะ useImgBox หัก letterbox** (ตอนนี้ letterbox ≈ 0)
- 1 part/อุปกรณ์มี**หลายรูป/หลายเฟรมได้** — balloon ต้องผูกกับรูปที่มันอยู่ (`drawing_id`/`image_id`) ลบรูป = ถอดตำแหน่ง balloon แต่**ห้ามลบตัวจุดตรวจ** · ฝั่ง PM รองรับ 360° spin (หลายเฟรม/อุปกรณ์) ผ่าน component กลาง `src/components/SpinAnnotator.jsx` — pin ผูกกับเฟรมที่วาง (`image_id`), ลากรูปหมุนเฟรม, reuse component นี้แทนเขียน annotator ใหม่
- **หน้าตรวจ PM (`PMCheckData` — JigSpinCheck) 2026-07-10:** รูปหลายมุม (spin) + auto-play ▶/⏸ · **หมุด sync กับ checklist**: สีหมุด = สถานะตรวจจริง (เขียว OK/แดง NG/เหลืองเฝ้าระวัง/ยังไม่ตรวจ=สีหมวด) เปลี่ยนสด, คลิกหมุด↔ไฮไลต์+เลื่อนแถวเช็ค, คลิกแถว→หมุนไปเฟรมของจุดนั้น · **ฟิลเตอร์แผนก = ความรับผิดชอบตามชนิดอุปกรณ์** (ผลิต=ทุกชนิด Autonomous · mtn=machine · jig mtn=jig · die mtn=die) กรองรายการอุปกรณ์ ไม่ใช่แค่เปลี่ยน checklist · **responsive**: จอ ≤860px = master-detail (ลิสต์/ฟอร์มทีละอัน + ปุ่มกลับ) · จอ ≥1180px = 2 คอลัมน์ (รูปซ้าย sticky · เช็คขวา) · desktop กว้างปกติไม่แตะ
- **Viewer วางจุดต้องซูมได้ (2026-07-15 — user: รูปเล็กจนวางจุดไม่ได้):** รูปในหน้า setup/วางจุด **ห้าม render ที่ขนาดไฟล์ธรรมชาติ** (ไฟล์เล็ก/แนวตั้งจะจิ๋ว) — ค่าเริ่มต้น = **เต็มความกว้างกรอบ** (`width: 100%` ของ viewport) + toolbar ซูม ➖/%/➕ (100–400%, step 50%) + ปุ่ม "↺ พอดีกรอบ" · viewport `maxHeight ~75vh; overflow: auto` เลื่อนดูส่วนอื่นได้ · เปลี่ยนแผ่น → รีเซ็ตซูม · พิกัดคลิก/หมุดยังถูกทุกระดับซูมเพราะคำนวณ % จาก wrapper ที่สเกลไปด้วยกัน (BK ก็สเกลตาม ResizeObserver ปกติ) — ต้นแบบ: `QAInspectionSetup.jsx`
- เลขจุดตรวจแบบ text เรียงด้วย natural sort (`localeCompare(..., { numeric: true })`) — H2 มาก่อน H10
- สี: จุด control พิเศษ (Rank M/SC) = แดง/amber, จุดทั่วไป = น้ำเงิน `#4d9fff`, กำลังวางตำแหน่ง = amber
- ชื่อแผ่น drawing ฝั่ง QA ให้เลือกจาก **view มาตรฐาน** (Front/Back/Top/Bottom View, Side View LH/RH, Isometric, Section, Detail) ผ่าน picker — พิมพ์เองได้เฉพาะกรณีพิเศษ

## 5.2 ฟอร์ม master data ต้องมี picker จากฐานที่มีอยู่

ฟิลด์ที่ข้อมูลมีอยู่แล้วในฐานอื่น ให้มี**ช่องค้นหา-เลือกเติมอัตโนมัติ** ไม่ปล่อยให้พิมพ์ซ้ำ (พิมพ์เองได้เป็น fallback):
- เพิ่ม Part ฝั่ง QA → ดึงจาก `dr_products` + `bom_items` (ดู `QAInspectionSetup.jsx`)
- เพิ่มอุปกรณ์ฝั่ง PM → ดึงจาก machine master (ดู `PMSetup.jsx` addMode workstation)
- รูปชิ้นงานที่อัพไว้ใน Product Master (`dr_products.image_url`) ให้ดึงมาแสดงซ้ำได้เลย ไม่อัพใหม่

## 5.3 Dropdown ลำดับชั้นองค์กร ต้อง cascade เสมอ (2026-07-21 — คำสั่ง user)

ทุกชุด select ที่ไล่ระดับ **Section → แผนก/Dept → Group/Line → Team** (ทั้ง filter bar และฟอร์มใน modal):

1. **ตัวเลือกของตัวลูกต้องถูกกรองด้วยตัวแม่ที่เลือกอยู่** — ห้ามโชว์ list แบนรวมทุก section:
   - แผนกจาก `org_nodes`: กรองด้วย `parent_id` ของ section node (ต้อง select `parent_id` มาด้วย —
     บั๊กจริงที่เคยเกิด: hook ดึงแค่ `code, name` เลย cascade ไม่ได้ทั้งหน้า Report 5 จุด)
   - Line จากแผนก: `l.name === department || l.parent_line_name === department` (สูตร Register)
   - Line จาก section: `l.section === section`
2. **เปลี่ยนตัวแม่ = ล้างค่าตัวลูกที่เลือกค้าง** (`setChild('')`) — ไม่งั้นค่าค้างนอก scope กรองแล้วได้ผลว่างเปล่า ผู้ใช้งงว่าข้อมูลหาย
3. ตัวเลือกที่มาจากข้อมูลจริง (เช่น distinct จาก employees) ให้กรองตามตัวแม่ก่อนค่อย distinct — ได้ตัวเลือกที่ match แถวจริงเสมอ + ไม่มีชื่อซ้ำข้าม section
4. ข้อยกเว้น (ตั้งใจไม่ cascade): ฟอร์ม**กำหนด scope ของ user** (AddUser — เลือกหลาย section + line อิสระ) และ toggle เลือก "section หรือ line อย่างใดอย่างหนึ่ง" (ShiftOrganize merge)
5. **ระดับ Group/กลุ่ม ในฟอร์มลงทะเบียน/แก้พนักงาน = ดึงจาก `org_nodes` kind='line' (2026-07-22)** ไม่ใช่ `production_lines` ตรงๆ — org group ผูก production_line ผ่าน `ref_line_id` → ตอนเลือกกลุ่มให้ตั้ง `employees.line_id = group.ref_line_id` (production/ผัง/scope ยังทำงาน) · **fallback เป็น `production_lines` (`filterLinesByDept`) เฉพาะเมื่อผังยังไม่มีกลุ่มใต้แผนกนั้น** · ทำแล้ว: Register + operator edit modal
6. **`employees.section/department/group_name` เป็น free text ไม่ผูก FK** → drift ได้ · **ตัวกรอง (filter bar) ที่ดึง distinct จาก employees ต้องจัดกลุ่ม 2 optgroup: "ในผังองค์กร" (ค่าที่ตรง org_nodes) + "⚠ นอกผัง (ต้องจัดข้อมูล)" (ค่าที่พนักงานกรอกแต่ไม่มีในผัง)** และ**โชว์เฉพาะค่าที่มีพนักงานจริง** (ทุกตัวเลือกเจอคนแน่นอน — กันหัวหน้าหาคนไม่เจอ) · ทำแล้ว: operator filter bar (Dept + Group)

ต้นแบบที่ถูก: `Register.jsx` (ฟอร์ม + group จาก org_nodes kind='line'), `OEEAnalytics.jsx` TargetDashboard (filter bar), `Report.jsx` hook `useOrgDepts` → `deptsOf(section)`, `operator.jsx` (filter bar Dept+Group แบบ ในผัง/นอกผัง + modal cascade org_nodes)

---

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
- **ป้ายชั่วโมงบนแกนเป็นรูปแบบ `HH:00`** (ทุก 2 ชม.) ไม่ใช่เลขเปล่า — และป้ายตัวสุดท้าย
  (08:00 เช้าวันถัดไป ที่ตำแหน่ง 100%) ต้อง `translateX(-100%)` ให้ชิดในกรอบ
  ไม่งั้นโดนตัดครึ่งเหลือ "0" (2026-07-11)
- **รายการที่ไม่ระบุเวลา ห้ามจอดที่ตำแหน่งปลอมบนแกน** (เคยจอดที่ 99% แล้วตกขอบ+กองสูงคนละเลน) —
  รวมเป็น**ชิปเดียวท้ายแถว** `⏳ N ไม่ระบุเวลา` ขอบประ amber (เขียว ✅ เมื่อเสร็จครบ)
  คลิกดูรายละเอียด/tooltip ลิสต์รายการ (ต้นแบบ: Shipping Chart ใน CustomerDemand.jsx — 2026-07-11)
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

## 6.5 การใช้พื้นที่จอ landscape — ห้ามเหลือขอบข้างว่างเยอะ (คำสั่ง user 2026-07-14)

- **container หลักของทุกหน้า (รวมหน้าออกแบบใหม่ทุกหน้าต่อจากนี้) ต้องใช้ความกว้างจอให้เต็มที่**:
  `maxWidth: 'min(96-97vw, 1800-2400px)'` (ตาม .page-content = 1800 หรือกว้างกว่าสำหรับหน้า board/hub)
  — **ห้าม fix แคบระดับ 900-1100px** แล้วปล่อยขอบซ้าย-ขวาว่างเป็นแถบใหญ่บนจอ desktop/TV
  (user ปฏิเสธ design แบบนั้นชัดเจนจาก screenshot หน้า hub ที่ maxWidth 1060 บนจอ 1920)
- เนื้อหาที่จำนวนชิ้น fix (เช่นการ์ด 6 ใบ) ให้จัดคอลัมน์ตาม breakpoint ให้**สมดุลและเต็มแถว**
  (เช่น ≥1200px = 3 คอลัมน์ 2 แถว · ≥1900px = 6 คอลัมน์แถวเดียว) แทน auto-fill ที่ทิ้งการ์ดเศษ 1-2 ใบท้ายแถว
- ฟอร์ม/หน้าที่เนื้อหาเป็นคอลัมน์เดียวโดยธรรมชาติ (Login, Register) เป็นข้อยกเว้น — จัดกลางได้ตามเดิม

## 6.6 เอกสารพิมพ์/Export ทุกตัวต้องผ่านระบบ Doc Control (2026-07-30 — คำสั่ง user)

**เอกสารที่ออกจากระบบทุกชนิด** (ฟอร์มพิมพ์ทางการ, ใบรายงาน, สรุปประชุม, Excel export, รายงานภายใน) **ต้องอยู่ในทะเบียนเอกสารกลาง `/doc-forms` (ตาราง `doc_forms` + `doc_form_revisions` — Main project)** ห้ามมีเอกสาร export ที่ไม่มี doc_key และห้ามสร้างระบบทะเบียนแยกใหม่:

- **สร้างเอกสาร export ใหม่ = seed แถว `doc_forms` ใน migration เสมอ** (doc_key ใหม่ + form_name) — ยังไม่มีเลขฟอร์มทางการก็ seed ไว้ก่อน (form_code = null) ให้ doc_control มาเติมทีหลังจากหน้า `/doc-forms` โดยไม่ต้องแก้โค้ด
- **โค้ดพิมพ์อ่านค่าจากทะเบียนผ่าน `src/utils/docForms.js` เท่านั้น** — `getDocForm(key, {fallback})` / `docFormSync(key)` / `fullCode()` / `getDocFormRevisions(key)` · **fallback ค่าเดิมในโค้ดเสมอ** (ทะเบียนล่ม/แถวหาย = ฟอร์มหน้าตาเดิม ไม่พัง)
- **2 ระดับการ wire:**
  - **ฟอร์มทางการ** (มี layout กระดาษ เช่น FM-xxx): วาดหัวฟอร์ม/ช่องลายเซ็น/footer เองตาม layout โดยดึงเลขฟอร์ม/Rev/Effective/sig_blocks/legend/issued_by จาก `getDocForm` — จำนวนช่องลายเซ็นต้องเท่า layout เดิม (เปลี่ยนได้เฉพาะข้อความ)
  - **รายงานภายใน** (ไม่มี layout ฟอร์มทางการ เช่น สรุปช่วงเวลา/สรุปประชุม): ห่อ html ก่อน `window.open`+print ด้วย **`withDocFoot(html, doc_key)`** — ทะเบียนยังไม่ตั้งเลขฟอร์ม = ไม่เติมอะไร (หน้าตาเดิมเป๊ะ), ตั้งเมื่อไหร่แถบ "เลขฟอร์ม · Effective" โผล่ท้ายเอกสารอัตโนมัติ
- **โลโก้**: `urlToDataUrl(docFormSync(key).logo_url || tsLogoUrl)` — ห้าม hardcode/วาดโลโก้เอง
- **ห้าม hardcode เลขฟอร์ม/Rev/Effective ในโค้ด** นอกเหนือจาก fallback default ที่ส่งเข้า `getDocForm`
- Revision History ของเอกสารแก้ที่ `/doc-forms` (modal แก้ไข → ตาราง 📜) — ฟอร์มที่พิมพ์ตารางประวัติ rev (เช่น Changing Point) อ่านผ่าน `getDocFormRevisions`
- ตารางเก่า `document_controls`/`document_control_revisions` เลิกใช้แล้ว (ยุบเข้าทะเบียนกลาง 2026-07-30) — ห้ามเขียนเพิ่ม

## 6.7 Editor ผัง/Floorplan ทุกตัวต้องมี Undo/Redo (2026-08-03 — คำสั่ง user)

หน้าตั้งค่าผังที่คลิกวาด/ลาก/ลบแล้ว**เขียนลง DB ทันที** (ไม่มีปุ่ม save รวม) เผลอพลาดทีเดียวข้อมูลหายจริง — ต้องมี Undo/Redo เสมอ:

- **hook กลาง `src/utils/useUndoHistory.js`** — undo แบบ snapshot: หน้าให้ `snapOf()` (ก้อนข้อมูลปัจจุบัน deep copy) + `applySnapshot(snap)` (diff ปัจจุบัน vs snapshot แล้ว**เขียนย้อนลง DB** insert/update/delete ตามลำดับ FK) · hook จัดการสแตค 40 ชั้น + ปุ่ม disabled + คีย์ลัด Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y (ข้ามตอน focus ช่องพิมพ์) ให้เอง
- **จุดที่ต้องเรียก `pushHistory()` = "ก่อน" mutation แรกของทุก action** (วาง/ลบ/บันทึกฟอร์ม/เชื่อมเส้น) · การพิมพ์ต่อเนื่อง (ชื่อจุด) ส่ง tag เดิม → coalesce ใน 1.2 วิ ไม่ push ทุกตัวอักษร · การลากย้าย: ถ่าย snapshot ตอน pointerdown เก็บใน dragRef แล้ว `pushSnapshot(snap)` ตอนปล่อยเมื่อขยับจริง
- **เปลี่ยน context (สลับไลน์/โซน/ผังคนละแผ่น) → `hist.clear()`** — snapshot ข้ามผังใช้ไม่ได้ ห้ามให้ undo ไปลบของผังอื่น
- ปุ่มใช้ `undoBtnStyle(enabled)` จากไฟล์เดียวกัน: `↩️ Undo` `↪️ Redo` วางในแถบเครื่องมือของโหมดแก้ไข (แสดงเฉพาะตอนมีสิทธิ์แก้)
- **ใช้แล้วที่:** TransportMapEditor (ถนน/จุดจอด AMR — node+edge), FactoryMap setupMode (polygon กรอบไลน์), MtnMachineLayout facility (จุดอุปกรณ์บนโซน — เพิ่ม/ลบโซน+อัปรูปไม่เข้า history เพราะไฟล์ storage ย้อนไม่ได้ ใช้ confirm แทน), LineSetup (จุดงาน+ทักษะ/WIP/เครื่องจักร/เส้น flow ของไลน์ที่เลือก)
- editor ผังตัวใหม่ในอนาคต**ต้องใช้ hook นี้ตั้งแต่แรก** — ห้ามเขียน undo เองเฉพาะหน้า

## 7. เบ็ดเตล็ดที่เคยกัด

- `index.css` ตั้ง `input{width:100%}` ทั้งแอป — input ใน flex row ต้องกำหนด width เอง (checkbox/radio มี rule ยกเว้น `width:auto` แล้ว — ห้ามลบ)
- พื้นที่ว่างแนวบนของทุกหน้า: `main` ใช้ `paddingTop: 14` (ไม่ใช่ 60) — มีแค่ icon cluster fixed มุมขวาบน; แถบควบคุมที่ชิดขวาบนของหน้า ให้เผื่อ `paddingRight` ~52px กันชนไอคอน
- **กัน overlap มุมขวาบน + ลำดับ z-index (audit ทั้งระบบ 2026-07-21):** `NotificationBell` เป็น `position:fixed top:10 right:14 zIndex:1200` **ทุกหน้า** ลอยทับแถบบนขวา ~50px ของทุกหน้า — กติกาที่ทุกหน้าต้องทำตาม:
  - **หัว header/toolbar แถวแรก**ที่มีปุ่ม/select ชิดขวา (มักเป็น `justifyContent:space-between`) → **ต้องใส่ `paddingRight: 52`** ไม่งั้นปุ่มขวาสุดมุดใต้ 🔔 (เคยพลาด: DailyReport/OjtTraining/ShiftOrganize — แก้ 2026-07-21)
  - **float ปุ่มควบคุมเฉพาะหน้ามุมขวาบน** ให้เรียง**แนวตั้งใต้ 🔔** (คอลัมน์เดียวกัน `right:14`, เริ่ม `top:54`, ปุ่ม 36×36 เท่ากันหมด) **แล้ว content ของหน้าเว้น `paddingRight:52`** ไม่ให้ลอดใต้คอลัมน์นั้น — ห้ามวางแนวนอนคร่อมหัว header/บอร์ด (เคยพลาด: Management filter cluster `[👤][⚙️][📦][ซ่อนป้าย]` วางแนวนอน fixed คร่อมหัวบอร์ด Heijunka → เปลี่ยนเป็นคอลัมน์แนวตั้งใต้ bell + board เว้น paddingRight, 2026-07-21)
  - **ปุ่ม ☰ เปิดเมนู (มุมซ้ายบน ตอนพับ sidebar) ใช้เครื่องหมายเดียวกับ 🔔**: 36×36 `top:10` radius8 bg3 border2 — ให้ 2 มุมบนสมมาตรกัน
  - **modal ทุกตัว `zIndex ≥ 2000`** (ต้องเหนือ 🔔 z1200) ไม่งั้น bell วาดทับ modal บังปุ่มปิด (เคยพลาด: PMSchedule DayModal z1000 — แก้ 2026-07-21) · popup เกาะ cell (stock/shipping) ใช้ z1300 + click-catcher z998
  - **ป้าย sticky ซ้ายของ time board (มือถือ) ต้อง `zIndex:6`** เหนือ playhead (`.now-line` z4 / `.now-chip` z5) ไม่งั้น now-line วาดทับป้ายพาร์ท (เคยพลาด: Dashboard mobile board z3 — แก้ 2026-07-21)
  - ladder รวม: content 1-15 · sticky time-board label 6 · float/bell 500-1300 (🔔=1200) · modal 2000-3200 · popup/siren/tooltip 3000-4000
- **จุดสถานะเปิด/ปิด — `<ToggleDot on={bool} />` (component กลาง 2026-07-21):** ปุ่ม toggle แบบ on/off (show/hide, กรองเปิด/ปิด, edit-mode) ทุกหน้า **ต้องแปะจุดสถานะมุมล่างขวา** (เขียว=เปิด/แสดง · เทา=ปิด/ซ่อน) ให้ดูออกทันทีที่เดียวทั้งระบบ — `src/components/ToggleDot.jsx` · ปุ่มแม่ต้อง `position:relative` · บนพื้นที่ไม่ใช่ var(--bg) ส่ง prop `ring` = สีพื้น (เช่น rail = `var(--bg2)`) · **ใช้แล้วที่:** Management (filter MAN/MACHINE/WIP + 🏷️), LineSetup (🏷️ ป้าย + 🔗 เชื่อมต่อ), FactoryMap (✏️ แก้ผัง), operator (ดูพนักงานปิดใช้งาน), Report (⚙️ OT master + เอกสาร), Checkin (Preview กะดึก + เฉพาะกะนี้), MorningMeeting (📷 ท่ามือ), LineStock (⏳ รออนุมัติ) · **ปุ่ม toggle on/off ใหม่ให้แปะ ToggleDot เสมอ** — ยกเว้น header collapse ที่มี chevron ▲/▼ อยู่แล้ว (chevron บอกสถานะพอ) และ 1-of-N tab (ไม่ใช่ on/off)
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
