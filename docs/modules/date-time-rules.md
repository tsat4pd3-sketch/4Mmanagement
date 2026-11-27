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

## 🌐 ภาษา — ปี/ชื่อเดือน/ชื่อวันตามโหมดภาษา (2026-11-24 · คำสั่ง user *"โหมด en เป็น ค.ศ. แต่โหมดไทยเป็น พ.ศ."*)

**วัดก่อนแก้ (harness โหมด EN · 24/11):** วันที่ไทยยังโชว์ 94 ชุด (`4 ส.ค. 69` · `วันอังคารที่ 4 ส.ค. 2569` · `อัปเดต 61 วันก่อน`) — ที่มา 2 ทาง
1. `toLocale*String('th-TH', …)` กระจาย 179 จุด / 113 ไฟล์ (pages · components · utils · lib) — th-TH ให้ปี พ.ศ. + เดือนไทยเสมอ
2. อาร์เรย์ตัวย่อเดือนไทย `['ม.ค.',…]` ประกาศซ้ำ 12 ไฟล์ · บางตัว `y + 543` บางตัว ค.ศ. · ตัวกลาง `fmtDateLabel/fmtDateMedium` เดือนไทย + **ปี ค.ศ. 2 หลัก** (ขัดกฎ)

**กฎ:**
- `dateLocale()` (`src/utils/i18n.js`) = `'th-TH'` ในโหมดไทย · `'en-GB'` ในโหมดอังกฤษ ⇒ ทุก `toLocaleString/toLocaleDateString/toLocaleTimeString` ที่โชว์บนจอใช้ตัวนี้ (ด่าน `date-locale-no-th-TH`) · ใช้กับตัวเลขก็ได้ (คอมม่าเหมือนกัน)
- `monthsShort()` / `yearDisplay(ceYear)` / `MONTHS_SHORT_TH` (`src/utils/dateFormat.js`) — ชื่อเดือนและปีตามภาษา · **ห้ามประกาศอาร์เรย์ 'ม.ค.' เองในหน้า** (ด่าน `date-no-hand-month-array` · ยกเว้น parser `kpiBaseImport.js`/`askBot.js`) · `fmtDateMedium` = `04 ส.ค. 69` / `04 Aug 26`
- 🔴 **`src/lib` (ใบพิมพ์ · Excel · PPTX) ไม่เข้าด่าน — ยังไทย/พ.ศ. เสมอ** (เอกสารควบคุมของโรงงาน) · ใบพิมพ์ KPI ใน `KpiMonthly` ใช้ `MONTHS_SHORT_TH` ตรงๆ
- **ตัวกลาง `fmtDate/fmtDateFull/fmtDateTime/fmtDateTimeFull` (เลขล้วน · 193 จุด) ตามภาษาด้วย** (user เคาะ "เอาเลย" 24/11) — ไทย `05/08/69` · `05/08/2569` · EN `05/08/26` · ปีผ่าน `yearDisplay()` ที่เดียว
  ⚠️ **ผลข้างเคียงที่รับไว้:** ใบพิมพ์/Excel/CSV ใน `src/lib` ที่ใช้ตัวกลาง (4 ไฟล์) จะออกปีตาม**โหมดที่คนกดอยู่** (EN = ค.ศ.) · Excel อาจตีความ `05/08/69` เป็น 1969 ถ้าเปิดเป็นวันที่ — ถ้าเอกสารไหนต้องยึด พ.ศ. เสมอ ให้ตรึง lang ที่จุดนั้น (ยังไม่มีเคสขอ)
- หลังแก้: 161 จุดใน pages/components/utils สลับตามภาษา · อาร์เรย์เดือน 12 ไฟล์ยุบเข้าตัวกลาง · ด่าน 2 ตัว + เทส `dateLocale.test.mjs`

**กับดัก:** ไฟล์ใน `src/utils` ที่ node test import ตรง ต้องเขียน `from './i18n.js'` (มี `.js`) — `'./i18n'` ผ่าน vite แต่ node test ล้ม 6 ไฟล์

