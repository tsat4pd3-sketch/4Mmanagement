---
name: vsm-tsat-reference
description: Reference สไตล์ใบ VSM จริงของโรงงาน TSAT (ถอดจากใบตัวอย่างที่ user แชร์ 2026-08-20 — BUMPER REINF P703 REDBACK · MB3B 8C306 BC current+future state) ใช้ทุกครั้งที่แตะโมดูล VSM (/vsm · vsmModel.js · VsmCanvas.jsx · vsmPrint/vsmA3Print · vsmLive.js) เพื่อให้ผัง/ใบพิมพ์/ฟีเจอร์ใหม่ "ตรงใจ" กับใบที่โรงงานทำมือ Trigger เมื่อ: ทำงานเกี่ยวกับ VSM, Value Stream Map, สายธารคุณค่า, MCT, kaizen burst, future state, /vsm
---

# VSM สไตล์ TSAT — reference จากใบจริงของโรงงาน

> ที่มา: user แชร์ภาพใบ VSM จริง 4 ใบ (2026-08-20) เป็น reference ให้ระบบทำได้ตรงใจ:
> 1. **BUMPER REINF** · N1WB-17AB35-AD-PIA01 (10092454) · Model P703 REDBACK · FORD — current state
> 2. ใบเดียวกัน ฉบับแปะ **annotation ปัญหา** (sticky เหลือง มีเลขกำกับ ①②③…)
> 3. **MB3B 8C306 BC** (S0086955) · Model P703 · FORD — current state พร้อม **kaizen burst แดง** + MCT = 8.97 Days 4 min 17 second
> 4. ใบเดียวกัน **VSM Future state** — MCT = 7.18 Days 12 min 24 second · %VA = 0.18%
>
> อ่านคู่กับ `docs/VSM-DESIGN.md` (สูตร/ที่มาข้อมูล) — skill นี้คือ "หน้าตา/ธรรมเนียมการเขียนใบ"
> ⚠️ ภาพต้นฉบับไม่ได้อยู่ใน repo (แชร์ในแชท) — ข้อความที่ถอดไว้ด้านล่างคือเท่าที่อ่านชัด ห้ามแต่งเติมส่วนที่ไม่รู้

## 1. โครงหน้ากระดาษ (ทุกใบเหมือนกัน)

```
[Title ใหญ่ ซ้ายบนสุด]  "VSM Current state" (น้ำเงิน) / "VSM Future state"
[หัวพาร์ท ซ้าย]          Part Name / Part No. (มีเลข SAP ภายในกำกับในวงเล็บ) / Model / Customer
[โลโก้ลูกค้า ขวาบน]      เช่น Ford + AutoAlliance (ใบที่ส่งลูกค้า 2 ราย)
[กล่องข้อมูล ขวาบน]      "Information on <เดือน ปี>" · Working day N days ·
                        Order X pcs/month · Order Y pcs/day  (บางใบมี AT/TT ด้วย)
[แถวบนกลาง]             SALE & PLANNING → PRODUCTION CONTROL → SAP
[ซ้าย]  supplier (TSAP) + รอบส่ง "2 1 2" + ข้อความอิสระ "Delivery Mon,Tue,Fri Round 1 13:00 pm"
[ขวา]   customer (TTMA / FTM 1 1 3 / AAT 1 1 3) + "Delivery everyday" — ลูกค้า 2 ราย = 2 กล่องซ้อน
[กลาง]  สายกระบวนการ + data box + ▲ คงคลัง + supermarket/PW/PK + Store Raw / Store
[ล่าง]  บันไดเวลา (ขั้นบนวัน = NVA · ขั้นล่างเวลางาน = VA)
[มุมล่างขวา] สรุป PLT · PT · MCT (แดงใหญ่) · %VA
```

## 2. เส้นการไหลข้อมูล (สังเกตจากใบจริง)

- ข้อความกำกับเส้นที่โรงงานใช้จริง: **"Forecast 6 months"** · **"Order 2 days early"** /
  "Order 2 weeks early" · **"Monthly forecast"** · **"Daily order by JIT CAL"** · "Daily order" ·
  "Weekly schedule" — generate ใบใหม่ให้ใช้คำพวกนี้ ไม่ประดิษฐ์คำใหม่
- เส้นวาดทรง "หลังคา" (ขึ้นจากกล่องบน โค้งลงหาปลายทาง) — electronic = หยัก · manual = ตรง
  (ตรงกับ `InfoLine` ใน VsmCanvas แล้ว)

## 3. ตัวเลขสรุป — ธรรมเนียมสำคัญที่สุด

- **MCT (Manufacturing Cycle Time) คือ headline ของใบ** — ตัวแดงใหญ่สุดในหน้า
  รูปแบบ: `MCT = <PLT> Days <m> min <s> second` (เช่น "MCT = 8.97 Days 4 min 17 second")
  = PLT (วัน) ต่อด้วย PT ที่แตกเป็น นาที+วินาที · ใบเก่าบางใบเขียน "MCT = 52.85 days 8 min"
- **PT เขียนเป็น "X min Y second"** ไม่ใช่วินาทีดิบ (เช่น "PT = 6 min 7 second")
- %VA = `VA/(VA+NVA) × 100` — เขียนสูตรกำกับบนใบเสมอ (ตัวหาร NVA = PLT × AT — ดู VSM-DESIGN §6)
- ค่า %VA ต่ำมาก (0.07–0.87%) เป็นปกติของ VSM — **ห้ามทำ UI ตีความเป็นสีแดง/ผิดปกติ**
- ➡ ในระบบ: formatter `fmtMinSec`/`fmtMct` อยู่ `src/lib/vsmModel.js` จุดเดียว (เพิ่ม 2026-08-20)
  ใช้ทั้ง VsmCanvas + หน้า /vsm — ห้ามเขียน format ซ้ำ

## 4. การชี้ปัญหาบนใบ current state (2 แบบที่โรงงานใช้)

1. **Kaizen burst — รูประเบิด/ดาวแฉกสีแดง** ปักบนจุดที่เป็นปัญหา พร้อมข้อความสั้น
   ตัวอย่างจริงที่อ่านได้: "Set control kanban system" · **"C/T > T/T"** (ปักบนกล่องกระบวนการที่
   cycle time เกิน takt) · เรื่อง loading rack / dolly plan
2. **Sticky เหลืองมีเลขกำกับ ①②③** แปะทับใบเดิม — โน้ตปัญหา/ข้อสังเกตรายจุด
   และไฮไลต์สีเหลือง/ชมพูบนค่าที่เป็นประเด็น (เช่นวง PK, ยอดคงคลังที่บวม)

➡ ตอนทำ **เฟส 2 (future state + kaizen burst ผูก /improvements)** ให้ยึด 2 แบบนี้:
   burst = สัญลักษณ์ดาวแฉกแดง + ข้อความสั้น · เกณฑ์อัตโนมัติที่เสนอได้เลยคือ **C/T > T/T**
   (ข้อมูลมีครบในโมเดลแล้ว — เสนอให้คนยืนยัน ห้ามปักเอง)

## 5. Future state (ใบที่ 4)

- เป็น **ใบแยกทั้งใบ โครงเดียวกับ current** ไม่ใช่ overlay — title เปลี่ยนเป็น "VSM Future state"
- ตัวเลขเทียบกันตรงมุมเดิม: current MCT 8.97 Days → future 7.18 Days · %VA ใหม่
- โครงสายถูก "จัดใหม่" ตามมาตรการ (คงคลังกลางทางหาย/ลด, รวมขั้น) — ไม่ใช่แค่เปลี่ยนตัวเลข
- ➡ ระบบมี `state: current/future/ideal` ใน vsm_maps แล้ว — เฟส 2 ให้ future state
  ก๊อปโครงจาก current แล้วแก้ + เทียบ MCT/PLT/%VA สองใบคู่กัน (ดู VSM-DESIGN §5 เฟส 2/4)

## 6. รายละเอียดอื่นที่ใบจริงมี (เก็บไว้เทียบตอนต่อยอด)

- **Sub Assembly แยกสายชัดเจน** แล้วไหลเข้า Main Assembly (มีป้ายชื่อ "Sub Assembly" /
  "Main Assembly" กำกับกลุ่ม) — ของเราวาด feeder เหนือสายหลัก + ป้าย mat ✓ แต่ยังไม่มีป้ายกลุ่ม
- เส้นทางขนส่งภายใน (dolly/rack) วาดเป็น **เส้นประหนาสีดำ** ระหว่างจุด
- ▲ คงคลังเขียนทั้ง จำนวนชิ้น และ จำนวนวัน (ตรงกับ `InvPoint` แล้ว) · ฝั่ง raw material
  เขียนเป็นหน่วยจริง (Kg/coil) — ระบบใช้ `parts_master.uom` ✓
- supplier/customer pattern ตัวเลข 3 ตัว ("2 1 2", "1 4 3", "1 1 3") = รอบส่ง — ระบบเก็บใน
  `overrides.__supplier_pattern`/`__customer_pattern` (คนกรอก — ระบบไม่มีข้อมูล ห้ามเดา) ✓
- ข้อความ delivery อิสระ ("Delivery Mon,Tue,Fri Round 1 13:00 pm") — ปัจจุบันยัดใน pattern
  field ได้ (ช่องเป็น free text)

## 7. สถานะ align ของระบบ ณ 2026-08-20

| ธรรมเนียมจากใบจริง | ระบบ |
|---|---|
| หัวพาร์ท + Information box + working day/order | ✅ |
| SALE & PLANNING / SAP + เส้น electronic/manual | ✅ (ข้อความกำกับตรงชุดคำจริง) |
| supplier/customer + pattern + supermarket/PW/PK/ladder | ✅ |
| PLT / PT / %VA + สูตรกำกับ | ✅ |
| **MCT headline + PT เป็น min/sec** | ✅ เพิ่ม 2026-08-20 (`fmtMct`/`fmtMinSec` ใน vsmModel.js) |
| Kaizen burst + future state + เทียบ current/future | ❌ เฟส 2 (แผนใน VSM-DESIGN §5) |
| ป้ายกลุ่ม Sub/Main Assembly · โลโก้ลูกค้าบนใบ · sticky annotation | ❌ ยังไม่ทำ (ต่อยอดเมื่อ user ขอ) |

**กติกาเดิมที่ห้ามลืมเวลาไล่ตามใบ:** สูตรทุกตัวอยู่ vsmModel/utils กลาง · ช่องไม่มีข้อมูล = บอกว่าไม่มี
ห้ามเดา · เอกสารบันทึกเป็น snapshot · สัญลักษณ์นิยามที่ `SYMBOLS` เดียว legend ต้องตรงกับที่วาดจริง
