# วันที่/เวลา — ตัวอย่างโค้ด + เหตุผลเต็ม (Date/Time utilities)

> ย้ายมาจาก `CLAUDE.md` §Patterns & Utilities (2026-09-30 — CLAUDE.md ชนเพดาน 120 KB)
> **ตัวกฎยังอยู่ใน CLAUDE.md ครบ** ไฟล์นี้เก็บตัวอย่างโค้ด ✅/❌ + รายละเอียดฝั่ง SQL

## ของเดิมจาก CLAUDE.md (ยกมาทั้งดุ้น)

> ⚠️ **กฎสำคัญ — ห้ามใช้ `new Date().toISOString()` เพื่อหาวันที่งาน**  
> `toISOString()` คืนค่า UTC ซึ่งต่างจากเวลาไทย (UTC+7) ทำให้วันที่คลาดเคลื่อน  
> ให้ใช้ฟังก์ชันด้านล่างเท่านั้น และต้องใช้เหมือนกันทุกหน้า

```js
// ✅ ใช้ทุกครั้งที่ต้องการ work_date สำหรับ query DB
getWorkDate()
// → คืน "YYYY-MM-DD" แบบ local time
// → ถ้าเวลาปัจจุบัน < 08:00 ให้นับเป็นวันก่อนหน้า (งานกะดึกข้ามวัน)

// ✅ ใช้ detect กะปัจจุบัน
getCurrentShift()
// → "day"   เมื่อ 08:00–19:59
// → "night" เมื่อ 20:00–07:59

// ✅ ใช้แสดงผลเวลา (ไม่ใช่สำหรับ query)
new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })

// ❌ ห้ามใช้เพื่อหาวันที่งาน
new Date().toISOString()          // UTC — ผิดสำหรับไทย
new Date().toISOString().slice(0,10)  // อาจได้วันที่ผิด
```

```js
getShiftInfo()  // object { shift, label } — กะเช้า 08:00-20:00 / กะดึก 20:00-08:00
```

> ⚠️ **กฎวันทำงาน (คำสั่ง user 2026-07-21): ทุกการคำนวณที่เกี่ยวกับ "วันทำงาน" ต้องอ้างอิงปฏิทินบริษัทก่อน ห้ามใช้ค่าคงที่ (22/26 วัน)** — ใช้ helper กลาง `countWorkingDaysInMonth(monthKey, fallback)` ใน `src/utils/companyCalendar.js` (เรียก `loadCompanyCalendar()` ก่อน) หรือ logic เดียวกัน: จ-ศ ไม่มาร์ค = ทำงาน · มาร์คเป็นวันหยุดทุกชนิด (ot15/ot2/shutdown75) = หยุด · เสาร์/อาทิตย์มาร์ค working = ทำงาน · 📄 จุดที่ใช้แล้ว + 2 บั๊กที่เคยเจอ → `docs/modules/shift-ot.md`

> **ฝั่ง SQL (DR project)** มี helper กลาง `work_date_bangkok()` (migration `20260714_work_date_bangkok_fallback.sql`)
> = work date ไทยตัด 08:00 — trigger/function/default ใหม่ฝั่ง DR ที่ต้องการวันที่งาน **ให้ใช้ตัวนี้
> ห้ามใช้ `current_date`** (คือ UTC — เพี้ยนช่วง 07:00-07:59 ไทย เคยเป็นบั๊กใน fn_post_confirmed_output)
