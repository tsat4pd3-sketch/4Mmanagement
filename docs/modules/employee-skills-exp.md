# Employee Skills & EXP Farming (ย้ายฝั่ง server ทั้งหมด — 2026-07-13)

> ย้ายมาจาก `CLAUDE.md` (2026-09-03 — แยกไฟล์เพื่อลด context) · โหลด**เฉพาะเมื่อแตะโมดูลนี้** · แก้ไฟล์นี้แทน CLAUDE.md เมื่อกฎของโมดูลเปลี่ยน


ระบบสะสม EXP ทักษะพนักงานจากการทำงานจริง — **ห้ามเขียนคะแนน `employee_skills` จาก client นอกเหนือจาก
2 flow ที่อนุญาต** (แก้สกิลใน modal พนักงาน + อนุมัติ/ปฏิเสธ level up ใน `/operator`) ทุกการเพิ่มคะแนน
อัตโนมัติต้องเป็นฟังก์ชันฝั่ง DB เท่านั้น · migration: `20260713_skill_farming_server_side.sql` (Main)

### กลไก (SQL functions บน Main project — ซอร์สอยู่ใน migration ข้างบน)

| Function | รันโดย | ทำอะไร |
|---|---|---|
| `fn_daily_skill_farm(p_work_date?)` | pg_cron `daily-skill-farm` ทุกวัน 01:20 UTC (**08:20 ไทย** — หลังจบกรอบวันงาน 08:00) | +1 EXP/วัน ต่อ (พนักงาน, สกิล) ที่มาทำงานจริงที่สถานีที่มี `station_requirements.min_score >= 70` · cap 3 ชั้น: min_score / เพดานขั้น 24-49-74-99 / หยุดเมื่อมี `pending_level` · dedup ด้วย `last_daily_farm_date` (วันละครั้งเสมอ ไม่ว่าจะเรียกกี่รอบ) |
| `fn_weekly_skill_update(p_week_start?)` | pg_cron `weekly-skill-update` จันทร์ 01:05 UTC (**08:05 ไทย**) + ปุ่ม 🔄 ใน `/operator` (สิทธิ์ `skills:run_weekly_update`) | ทำงาน ≥3 วัน/สัปดาห์ที่สถานีที่ต้องการสกิล → +2 (cap เพดานขั้น) · ชนเพดาน → สร้าง `skill_level_up_requests` + ตั้ง `pending_level` (หยุด farm จนกว่าจะ approve/reject) · ไม่ได้ทำงานเลยทั้งสัปดาห์ → decay −2 (floor 25) · **idempotent: สัปดาห์เดียวกันประมวลผลครั้งเดียว** (กันใน `skill_update_runs` — เรียกซ้ำได้ข้อความ "ประมวลผลไปแล้ว") |

### Level Up flow

```
farm ชนเพดานขั้น (24/49/74/99) → คำขอ level up (to_level = 25/50/75/100) + pending_level
   → อนุมัติใน /operator แท็บ ⬆️: to_level < 100 = can('skills','approve_levelup') (sv/mgr/admin)
                                  to_level = 100 = can('skills','approve_levelup_100') (mgr/admin) + บังคับแนบเอกสารอบรม
   → approved: score = to_level, pending_level = null · rejected: pending_level = null (farm ต่อจากคะแนนเดิม)
```

### กฎเหล็กของระบบนี้ (บั๊กที่เคยเกิด — ห้ามทำซ้ำ)

- **ห้ามคืน daily farming ฝั่ง client** — เดิมอยู่ใน Checkin.jsx handleSave: กดบันทึกซ้ำ = +1 ซ้ำไม่จำกัด,
  เหมาพนักงานทุกไลน์ทั้งโรงงาน (query ไม่ scope), และข้ามด่านอนุมัติ 25/50/75 ได้เอง → พนักงานสกิลอัพเร็วผิดปกติทั้งระบบ
- **RPC ฝั่ง skill ทุกตัวต้อง guard สิทธิ์ในตัวฟังก์ชัน** (เช็ค `auth.uid()` + role จาก profiles — cron ที่ไม่มี JWT ผ่านได้)
  และ **revoke EXECUTE จาก anon/PUBLIC** — เดิม anon key (ฝังใน JS bundle สาธารณะ) ยิง `fn_weekly_skill_update` ซ้ำได้ไม่ต้อง login
- **job อัตโนมัติต้อง idempotent เสมอ** — เดิมเรียกซ้ำ = +2/−2 ซ้ำ · pattern: กันด้วย `skill_update_runs` (weekly)
  หรือ dedup รายแถว (`last_daily_farm_date` — daily)
- **pg_cron ใช้ UTC** — เวลาไทยต้อง −7 ชม. (เคยตั้ง `5 8 * * 1` แล้วได้จันทร์ 15:05 ไทยแทน 08:05)
- คะแนนที่เฟ้อไปแล้วจากบั๊กเก่า**ไม่ได้ถูก reset อัตโนมัติ** — supervisor/manager ปรับมือได้จากแท็บ ⚙️ กำหนดสกิลใน `/operator`
  (weekly decay จะค่อยๆ ดึงคะแนนคนที่ไม่ได้ทำงานจริงลงเอง)

### Export ฟอร์ม Skill Matrix (ตามฟอร์มกระดาษ Thai Summit — 2026-07-16)

ระบบ export ฟอร์มทักษะได้ 2 แบบใน `/report` (แท็บสกิลอยู่ `/skills-report`) ให้เหมือนฟอร์มกระดาษของบริษัท:

- **สรุปทั้งไลน์** (`MULTI SKILL OF OPERATORS`, รหัส FM-PD1-017) — แท็บ 🏅 Multi-Skill Form · ตารางพนักงาน × สกิล แต่ละช่องเป็น**วงกลมแบ่ง 4 ส่วน 5 ระดับ** (0-24/25-49/50-74/75-99/100 = `MS_LEVELS`+`scoreToLevel`+`skillGaugeSvgStr`) · ลายเซ็น จัดทำ/ตรวจสอบ/อนุมัติ ดึงจาก `profiles` ตาม role ของไลน์ · A3 landscape
- **รายบุคคล** (`ใบประเมินทักษะฯ`, รหัส F-PRS-P1-119) — แท็บ 📊 Skill Matrix → คลิกพนักงาน → ปุ่ม 🖨️ ใน radar panel (`buildIndividualSkillHtml`) · มี radar SVG (`buildRadarSvg`), รูป+3 ลายเซ็น, ตารางหัวข้อย่อยต่อสกิล + คะแนน 4 ระดับ, สรุป/legend/เกณฑ์/หมายเหตุ · A4 portrait
- **โหมด Hybrid (สำคัญ):** ระบบเก็บแค่คะแนนเดียว 0-100 ต่อสกิล — ใบรายบุคคลจึง (ก) เอา**ข้อความหัวข้อย่อย**จาก `skill_sub_items` (ถ้าสกิลไม่มี → fallback 1 แถว = ชื่อสกิล) (ข) **ค่าติ๊ก 4 ระดับรายแถว derive จากคะแนน** (`distributeLevels` กระจายระดับให้เฉลี่ย ≈ score/25 เหมือนฟอร์มกระดาษที่หัวข้อเป็นสเต็ป 25%) (ค) **% สรุปกลุ่ม/radar/โดยรวม ใช้คะแนนจริง** (เที่ยงตรง ไม่ปัดเป็น 25) · ถ้าวันหน้าจะเก็บผลประเมินรายหัวข้อจริง (ไม่ derive) ต้องเพิ่มตารางผลประเมิน + UI กรอก แล้วเปลี่ยนที่มาของค่าติ๊ก
- **โลโก้ Thai Summit** = ไฟล์ทางการ `src/assets/TS logo.png` (ตัวเดียวกับ App/Login/DailyReport/OJT/LPA/MtnRepair ใช้ — import เป็น `tsLogoUrl`) · **override ได้ด้วยรูปที่อัปโหลดใน `/doc-forms` (`doc_forms.logo_url`)** → เป๊ะ 100% · **pattern มาตรฐานทุกฟอร์มพิมพ์:** handler แปลงเป็น dataURL ผ่าน `urlToDataUrl(docFormSync(key).logo_url || tsLogoUrl)` แล้วส่งเข้า builder (`tsLogoHtml(logoUrl)`) — **ห้าม hardcode/วาดโลโก้เอง** (เคยพลาดวาดกล่อง T/S แยก ไม่ตรงตราจริง)
- **ใบรายบุคคลบังคับ ≤ 1 หน้า A4 เสมอ (2026-07-21):** พนักงานสกิลเยอะ (เช่น LINE APRON ASSY ~20 สกิล) ตารางยาวเกินหน้า → สคริปต์ `fitOnePage()` วัดความสูงจริงเทียบ 287mm แล้วตั้ง **`el.style.zoom`** ให้พอดี 1 หน้า (ใช้ `zoom` ไม่ใช่ `transform: scale` — transform เป็นภาพลวงตา ไม่ลดกล่อง layout → print ยังนับหลายหน้า · zoom ลด layout จริง Chrome นับหน้าถูก) · เคสสกิลน้อยไม่ย่อ คงขนาดเต็ม · รอ `document.fonts.ready` ก่อนวัด กัน webfont ทำความสูงเพี้ยน — **pattern นี้ reuse ได้กับฟอร์มพิมพ์อื่นที่ต้อง fit 1 หน้าแบบ dynamic**
- helper: ใบ Multi-Skill (`buildMultiSkillHtml`) ยังอยู่ใน `src/pages/Report.jsx` · **ใบรายบุคคลย้ายไป `src/lib/individualSkillPrint.js`** แล้ว (2026-08-06 — `/operator` เรียกใบเดียวกัน) · หัวข้อย่อยจัดการที่ `/operator` ⚙️ ปุ่ม 📝 (`SkillSubItemsModal`)

> ### ⚠️ การ์ดสรุปทักษะรายบุคคล = component กลาง `src/components/SkillRadarPanel.jsx` (2026-08-06)
> เดิมการ์ด radar อยู่ใน Report.jsx (ชื่อ `OperatorRadarPanel`) กดดูได้เฉพาะแท็บ 📊 Skill Matrix → หน้า **ฐานข้อมูลพนักงาน (`/operator`) กดดูไม่ได้** ทั้งที่มีคอลัมน์คะแนนสกิลอยู่แล้ว (คำสั่ง user: "หน้าฐานข้อมูล กดดูแบบหน้า skill matrix ไม่ได้หรอ")
> - **ทางเข้า:** `/skills-report` แท็บ Skill Matrix · `/operator` แท็บฐานข้อมูลพนักงาน — **คลิกทั้งแถว**เหมือนกันทั้งคู่ (คอลัมน์จัดการของ `/operator` ใส่ `stopPropagation` ไว้ ปุ่ม ✏️/🚫 จึงทำงานเหมือนเดิม — **ตารางที่มีปุ่ม action ในแถวแล้วจะเพิ่ม row click ต้องกันแบบนี้เสมอ**)
> - **props:** `emp` (ต้อง select `employee_skills(skill_name, score)` มาด้วย) · `skillDefs` · `subItemsByskill` (จาก `skill_sub_items` — ใช้ตอนพิมพ์ ไม่ส่ง = 1 แถว/สกิล) · `lines` · `onClose`
> - **จุดใหม่ที่อยากโชว์สกิลรายคนให้ reuse ตัวนี้ ห้ามก๊อป modal ใหม่** · `/operator` โหลดแบบ `lazy()` (recharts มาเฉพาะตอนเปิดการ์ด ไม่ถ่วงตอนเปิดหน้า)
> - **⚠️ กับดัก: component พิมพ์เอกสารที่ถูก reuse ต้องเรียก `await loadDocForms()` เองในฟังก์ชันพิมพ์** — `docFormSync()` อ่าน cache ระดับ module ที่ว่างจนกว่าจะมีใครเรียก `loadDocForms()` · หน้าเดิม (Report.jsx) เรียกไว้ระดับ module แต่หน้าใหม่ที่ reuse เป็น lazy chunk คนละก้อน **ไม่ได้เรียก = ใบพิมพ์ได้ fallback ในโค้ดเสมอ เลขฟอร์ม/Rev/ช่องลายเซ็นไม่ตรงกับที่ตั้งใน `/doc-forms` แบบเงียบๆ** (เจอจาก QC audit 2026-08-06) · **พึ่ง `loadDocForms()` ของหน้าแม่ไม่ได้ — ฟังก์ชันพิมพ์ที่อยู่ใน component ร่วมต้องโหลดเองก่อนอ่านค่า** (เรียกซ้ำคืน cache ทันที ไม่เปลือง)
> - **สเกลสกิล/หมวด/gauge = `src/utils/skillLevels.js` จุดเดียว** (`SKILL_LEVELS`/`getLevel`/`getBandCeiling`/`SKILL_GATES`/`SKILL_CAT_META`/`groupSkillsByCategory`/`MS_LEVELS`/`scoreToLevel`/`skillGaugeSvgStr`) — เดิมนิยามซ้ำใน Report.jsx กับ operator.jsx แล้ว drift (operator มี `desc`/`band` + หมวด `allowance_skill` ที่ Report ไม่มี) · **ห้ามนิยาม SKILL_LEVELS/หมวดสกิล ซ้ำในหน้าใดๆ อีก**
> - **`groupSkillsByCategory(defs)` default = 4 หมวดทักษะ ไม่รวม `allowance_skill`** (ใบเซอร์ค่าฝีมือเป็น มี/ไม่มี ไม่ใช่ระดับทักษะ → ไม่เข้า matrix/radar โดยตั้งใจ) · ต้องการรวมให้ส่ง `SKILL_CAT_META_FULL` เป็น arg ที่สอง (หน้าตั้งค่าสกิล/โมดัลแก้ไขพนักงานใน `/operator` ใช้แบบนี้)

---
