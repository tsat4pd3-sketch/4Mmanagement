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

---

# §v2 — EXP farming v2: วัด "ความสามารถ" แทน "การมาทำงาน" (2026-09-24)

> คำสั่ง user: *"ยังไม่ได้ mass จริง อยากให้ได้ความมาตรฐาน ถ้าจะออโต้"*
> เหตุผล/งานวิจัยเบื้องหลัง + ตารางเวลาต่อขั้น → `docs/SKILL-EXP-ALGORITHM-DESIGN.md` (อ่านก่อนปรับเกณฑ์)

## ปัญหาของ v1 (วัดจริง 24/09/2026)

สูตรเดิมมี input ตัวเดียวคือ `daily_production_logs.is_present` — ไม่มียอดผลิต ไม่มีของเสีย
ไม่มีผลสอบ · และให้ `+1/วัน` **เท่ากันทั้ง 4 ช่วงขั้น** ทั้งที่ 0→25 กับ 75→100 คนละเรื่องกัน

| วัด | ค่า |
|---|---|
| คนถือระดับ ≥75 ("แก้ปัญหาได้") | 88 คน (356 แถวสกิล) |
| ในนั้นมีประวัติ OJT | 25 คน (28%) |
| ใบอนุมัติขึ้น 75 ที่แนบเอกสาร | **0 จาก 168 ใบ** |
| เวลาเลื่อนขั้นจริง (วัด 4 เคส 50→75) | 27 วันปฏิทิน / 21 วันมาทำงาน — **เท่ากันทุกขั้น** |
| คนหนึ่งนั่งกี่สถานีใน 90 วัน | 5.6 สถานี (อยู่สถานีหลัก 60% ของวัน) |

## โครงสร้าง

| ของ | ที่อยู่ | หน้าที่ |
|---|---|---|
| `skill_exp_config` (Main) | 1 แถว id=1 | **ค่าเกณฑ์ทุกตัว** — n_ref · band_cum_0..3 · ประตู · decay · `is_enabled` |
| `station_output_rollup` (Main) | ไลน์×วัน×กะ | ยอดผลิต/ของเสีย/เหตุการณ์ sync จาก DR |
| `employee_skill_evidence` (Main) | คน×สกิล | หลักฐานสะสม + `shadow_score` + `gate_missing` |
| `station_requirements.n_ref` | ต่อสถานี | รอบอ้างอิงเฉพาะสถานี (null = ใช้ default) |
| edge `sync-station-output` | Main (verify_jwt=false) | DR → rollup · cron 08:10 ไทย |
| `fn_skill_exp_rebuild(date)` | Main | **คำนวณใหม่ทั้งก้อน** · cron 08:25 ไทย |
| `fn_skill_exp_apply()` | Main | เอา shadow_score ไปใช้จริง (เฉพาะเมื่อ `is_enabled`) |
| `fn_skill_reeval_pending(bool)` | Main | ประเมินคิวค้างตามเกณฑ์ใหม่ (dry run เป็น default) |
| `src/utils/skillExp.js` | frontend | **ตัวช่วยแสดงผลเท่านั้น ไม่คำนวณคะแนน** |
| `src/components/SkillEvidencePanel.jsx` | frontend | แผงหลักฐานในการ์ดคำขอเลื่อนขั้น (`/operator?tab=levelup`) |

## กฎเหล็กของ v2 (ห้ามทำซ้ำสิ่งที่ v1 พลาด)

- 🔴 **rebuild ทั้งก้อนทุกคืน ไม่ใช่บวกสะสมทีละวัน** — idempotent โดยโครงสร้าง
  บั๊กคลาส "รันซ้ำแล้วบวกซ้ำ" (ที่ v1 ต้องกันด้วย `last_daily_farm_date`/`skill_update_runs`) เกิดไม่ได้เลย
- 🔴 **`shadow_score = null` แปลว่า "ประเมินไม่ได้" ไม่ใช่ "ได้ 0"** — ไลน์ที่ยังไม่มีข้อมูลยอดผลิต
  (24/09: 101 จาก 551 แถว = 18%) ต้องไม่ถูกกดคะแนนเป็น 0 · `fn_skill_exp_apply` ข้ามแถวพวกนี้
  · จอต้องเขียนตรงๆ ว่าประเมินไม่ได้ **ห้ามโชว์ 0**
- 🔴 **`band = least(ประตู, ปริมาณ, ขั้นปัจจุบัน)`** — ตัว `cur_band` คือสิ่งที่กัน "ข้ามขั้นเอง"
  ขึ้น 25/50/75/100 ต้องผ่านคนอนุมัติเสมอ (จุดที่ทำให้ระบบอัตโนมัติยังตอบ ISO 9001 §7.2 ได้)
- 🔴 **`certified_level` (ระดับที่อนุมัติไปแล้ว) เป็น "พื้น"** — v2 ไม่ลดคะแนนใครต่ำกว่าระดับที่เคยอนุมัติ
  ⇒ คะแนนเฟ้อจากอดีตถูก **แช่ไว้ ไม่ถูกรีเซ็ต** และขึ้นต่อไม่ได้จนกว่าหลักฐานจะครบ (`verified=false`)
- 🔴 **ยอดผลิตหารตามจำนวนคนในกะ** — DR ไม่มีคอลัมน์ผูกยอดผลิต/ของเสียกับ "คน" เลย
  ระดับหยาบสุดที่ attribute ได้คือ **ไลน์×กะ** · จอต้องเขียนกำกับว่าเป็นค่าเฉลี่ยของกะ ไม่ใช่ผลงานรายคน
- 🔴 **คุณภาพเป็น "ประตู" ไม่ใช่แต้มลบ** — ของเสียเป็นของทั้งสาย โทษรายคนไม่ได้
  ข้อมูลไม่พอ (`ng_ratio is null`) = **ผ่าน** (ห้ามลงโทษเพราะเราไม่มีข้อมูล)
- 🔴 **นับเหตุผิดปกติเป็น "จำนวนวันที่อยู่ตอนเกิดเหตุ" ไม่ใช่จำนวนใบ** — นับใบได้เฉลี่ย 123 ใบ/คน
  ⇒ ประตูผ่านฟรี ไม่ได้วัดอะไรเลย
- 🔴 **ตัวเลขเกณฑ์ทุกตัวอยู่ใน `skill_exp_config` ห้าม hardcode ใน SQL/JS** — กัน drift 2 ที่
  (`skillExp.js` รับ cfg เป็น argument เสมอ)

## กับดักที่เจอจริงตอนทำ (24/09)

1. **PostgREST `limit=20000` ชนะ `max-rows` 1000 ไม่ได้** และตอบ 200 OK พร้อมข้อมูลไม่ครบ
   → backfill รอบแรกได้ 1,000 แถวเป๊ะ ทั้งที่มี 1,318 · **พังเงียบ ไม่มี error**
   แก้ด้วย `Range: from-to` + `Range-Unit: items` วนทีละหน้า · **มีด่าน `regressionGuards` แล้ว**
2. **`production_sessions.product_id` เป็นคอลัมน์ร้าง = null ทั้งตาราง** (0/1,318 ตั้งแต่ 18/06)
   → `parts_seen` ว่างหมด ประตูความหลากหลายตกทั้งโรงงาน · รุ่นที่ผลิตอยู่ที่ **`prod_orders.mat_no`**
   ⚠️ **ยังมี 3 หน้าอ่านคอลัมน์นี้อยู่จริง** (DailyReport:7244 · HeijunkaKanban:1819 · ProductMaster:317)
   = ได้ null เสมอ ฟีเจอร์ปลายทางเงียบอยู่ — **ยังไม่ได้แก้ อยู่คนละโมดูล** (ดูรายการยกเว้นในด่าน)
3. **ชื่อไลน์ 2 ฝั่งไม่ตรง** (DR "SP-70 & 71" · Main "SP-70&71") → `norm_line_key()`
   · 24/09 match ได้ 24 จาก 34 ไลน์ DR — 10 ไลน์ปั๊มไม่มี workstation ใน Main (ไม่มีสกิลผูก = ไม่กระทบ)
4. **`employee_skill_evidence` ไม่มีคอลัมน์ `id`** (PK คู่) → เรียก `fetchByIds` ต้องส่ง `orderBy: 'employee_id'`

## ลำดับเปิดใช้ (ตอนนี้อยู่ขั้น 1)

1. **shadow** (ปัจจุบัน) — `is_enabled=false` · v2 คำนวณคู่ขนาน v1 ยังคุมคะแนนจริง
   ดูเทียบได้ที่ `/operator?tab=levelup` (ทุกการ์ดคำขอมีแผงหลักฐาน)
2. เคลียร์คิวค้างด้วยปุ่ม **🧪 ประเมินคิวใหม่** (dry run ก่อน แล้วยืนยัน)
3. กดปุ่ม **⚪ EXP v2: โหมดทดลอง** → ใช้จริง · ปิดกลับได้ทุกเมื่อ (`update skill_exp_config set is_enabled=false`)

## งานที่ออกแบบไว้แล้วแต่ยังไม่ทำ (ห้ามหยิบไปทำเองจนกว่า user สั่ง)

- **หลักฐานความผิดปกติราย *คน* จริงๆ** — `downtime_logs.fix_by` / `defect_logs.fix_by` มีอยู่แล้ว
  แต่กรอกแค่ **132 จาก 9,784 ใบ (1.3%)** ⇒ ยังใช้เป็นประตูไม่ได้ · เมื่อหน้างานกรอกครบแล้ว
  ให้ sync ชื่อผู้แก้เข้า rollup แล้วเปลี่ยน `n_abnormal` จาก "วันที่อยู่ตอนเกิดเหตุ" เป็น "ครั้งที่แก้เอง"
- **`gate_25_needs_ojt`** — default `false` เพราะมีประวัติ OJT แค่ 66 จาก 231 คน · เปิดเมื่อ OJT ลงระบบครบ
- **`employees` ↔ `profiles` ยังไม่มีคอลัมน์เชื่อม** — `is_trainer` จึงเทียบด้วย `ojt_trainings.trainer_name`
  = ชื่อ (เสี่ยงสะกดต่าง) · ถ้าวันหน้าเพิ่ม `employees.profile_id` ให้เปลี่ยนมาเทียบ uid
