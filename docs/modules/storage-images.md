# Storage & รูปภาพ (กติกาสำคัญ — 2026-07-09)

> ย้ายมาจาก `CLAUDE.md` (2026-09-03 — แยกไฟล์เพื่อลด context) · โหลด**เฉพาะเมื่อแตะโมดูลนี้** · แก้ไฟล์นี้แทน CLAUDE.md เมื่อกฎของโมดูลเปลี่ยน


- **อัปโหลดรูปทุกหน้าต้องผ่าน `ImageCropModal`** — รูปนิ่งถูก crop + บีบเป็น JPEG 480px q0.85 (~100KB) อัตโนมัติ
  - **ข้อยกเว้นที่ตั้งใจ (crop ไม่เหมาะ):** รูปที่ต้องเห็นทั้งใบ/คมชัด ให้**บีบก่อนอัปโหลดแทน** — รูป jig/checkpoint (PMSetup), รูปหลักฐาน 4M/QA/เอกสาร level-up (Management/Report/operator: helper `resizeImage` 1280px q0.85) · drawing ฝั่ง QA: **รูปบีบ 2560px/2.5MB/q0.9** (สเปคเดียวกับผัง — ต้องซูมอ่าน dimension ได้ · user ยืนยัน 2026-07-12 ว่าบีบได้), **PDF เท่านั้นที่ส่งดิบ** (≤20MB) · **ห้ามอัปโหลดรูปดิบโดยไม่บีบเลย**
  - **รูปผัง/layout (LineSetup, MtnMachineLayout) บีบเบากว่ารูปอื่น: 2560px / 2.5MB / q0.9** (2026-07-10) — layout มีจำนวนน้อยทั้งระบบ (≤20 รูป) แต่ต้องซูมอ่านรายละเอียดผังได้ **ห้ามลดกลับไป 1600px/0.5MB** เคยบีบแรงจนเบลอใช้งานไม่ได้ (รูปเดิมที่เบลอไปแล้วต้องอัปโหลดต้นฉบับซ้ำ ระบบไม่มีต้นฉบับเก็บไว้)
> ### ⚠️ กฎเหล็ก — รูปจากกล้องมือถือเป็น HEIC/HEIF ได้เสมอ ทุกจุดที่รับไฟล์รูปต้องผ่าน `toDecodableImage()` (2026-08-25 · feedback หน้างาน)
> **เคสจริง:** หัวหน้าส่วนใช้ Samsung ที่ตั้งกล้องเป็น "รูปภาพประสิทธิภาพสูง (HEIF)" → แนบรูปใบซ่อมไม่ได้
> แล้ว**ลดความละเอียดกล้องต่ำสุดก็ไม่หาย** เพราะปัญหาคือ Chrome decode HEIC ไม่ได้ **ไม่เกี่ยวกับขนาดไฟล์**
> ซ้ำร้าย ข้อความ error เดิมเขียนว่า "…หรือรูปใหญ่เกินไป" → ผู้ใช้เข้าใจผิดทั้งกระบวนการ แล้วมาขอ "เพิ่มความจุรูป" ซึ่งไม่ใช่ทางแก้
> - **`src/utils/heicToJpeg.js` เป็นเจ้าของเรื่องนี้จุดเดียว** — `isHeicFile(file)` / `toDecodableImage(file)` / `HEIC_FAIL_MSG`
>   **ห้ามเขียนตัวเช็ค/ตัวแปลง HEIC ซ้ำในหน้าใดๆ** · เทส `src/utils/__tests__/heicToJpeg.test.mjs`
> - **ลำดับในตัวแปลง (ห้ามสลับ):** ไม่ใช่ HEIC → คืนไฟล์เดิม · เบราว์เซอร์ decode เองได้ (Safari/iOS) → คืนไฟล์เดิม **ไม่โหลด wasm**
>   · decode ไม่ได้ (Chrome/Android) → **lazy import `heic2any`** แปลงเป็น JPEG · แปลงไม่ได้ → โยน `HEIC_FAIL_MSG` (บอกวิธีตั้งกล้อง) **ห้ามเงียบ**
> - **⚠️ `heic2any` ต้อง dynamic import เท่านั้น** (1.35MB / 345KB gzip เป็น chunk แยก · วัดแล้ว bundle หลักเพิ่มแค่ 0.09 kB
>   และไม่อยู่ใน initial load) — import แบบ static จะไปฝังทุกหน้า (กฎเดียวกับ pptxgenjs / xlsx / exceljs)
> - **⚠️ ต้องเช็คนามสกุลไฟล์ด้วย ไม่ใช่ดูแต่ MIME** — Android/Chrome หลายรุ่นส่ง `type` เป็นค่าว่าง/`application/octet-stream` กับไฟล์ `.heic`
> - **⚠️ แปลงให้เร็วที่สุดที่ต้น handler** — โค้ดที่ derive `ext`/ชนิดจากชื่อไฟล์ต่อจากนั้นจะได้ค่าถูกต้องตาม (ไฟล์ที่แปลงแล้วเป็น `.jpg`)
>   แปลงทีหลังจะได้ไฟล์ JPEG แต่ตั้งชื่อบน storage เป็น `.heic`
> - **จุดที่ผ่านเกตแล้ว (ครบทุกทางเข้ารูปในระบบ):** `resizeImage.js` (MtnRepair/Improvements/PEDocs/Report/Management/operator)
>   · `ImageCropModal` (รูปพนักงาน/โปรไฟล์/สินค้า/อะไหล่/PMSetup frames) · LineSetup ผังไลน์ · FactoryMap ผังโรงงาน
>   · MtnMachineLayout โซน facility · PMSetup รูปจุดตรวจ · QAInspectionSetup drawing · DieLayout/RackMap `compressPlan`
>   → **เพิ่มจุดรับไฟล์รูปใหม่ต้องเรียก `toDecodableImage()` ก่อนเสมอ**
> - ข้อความบนจอห้ามพูดเรื่อง "ขนาด/ใหญ่เกินไป" กับปัญหา decode — ต้องชี้ "ฟอร์แมต + วิธีตั้งกล้องเป็น JPEG"
>   (Samsung: ตั้งค่ากล้อง → รูปแบบภาพ → ปิด HEIF · iPhone: ตั้งค่า → กล้อง → รูปแบบ → "เข้ากันได้มากที่สุด")
> - **ยังไม่ทำ:** ตัวบีบรูปสาย "ผัง/drawing" (2560px/q0.9) ยังกระจาย 7 จุด (`imageCompression` 5 จุด + `compressPlan` ที่ก๊อปกัน 2 ไฟล์)
>   — ควรยุบเป็น util เดียวเมื่อไปแตะจุดนั้นครั้งหน้า (ตอนนี้เกต HEIC เข้าครบแล้วทุกจุด จึงไม่เร่ง)
- **GIF (รูปขยับ) ถูกส่งทั้งไฟล์โดยไม่แปลง** เพื่อคงการเคลื่อนไหว (วาดลง canvas จะเหลือเฟรมแรกเฟรมเดียว = การขยับหายเงียบๆ) — จำกัด ≤ 2MB **ทุกจุดที่รับ GIF** (ImageCropModal + LineSetup) **ห้ามถอด cap ออก** (GIF ไม่จำกัดขนาดเฉลี่ย ~4MB เคยกินครึ่ง bucket)
- **เปลี่ยน/ลบรูปแล้วต้องลบไฟล์เก่าจาก storage เสมอ** (ลบ**หลัง** DB update สำเร็จเท่านั้น + best-effort ห้ามทำ flow หลักพัง) — ทำแล้วใน: DeptHub.jsx (รูปโปรไฟล์ user — bucket `avatars` **แยกจาก employee-photos โดยเจตนา** เพราะ cleanup-orphan-photos สแกน employee-photos เทียบ employees/line_layouts เท่านั้น ไฟล์ avatar ที่ไปอยู่ที่นั่นจะโดนลบ · migration `20260714_profiles_avatar.sql`), operator.jsx (รูปพนักงาน), LineSetup.jsx (ผังไลน์ ทั้งตอนเปลี่ยนผัง/ตอนลบไลน์/**ปุ่ม 🗑 ลบรูปผัง** (2026-08-04 — เคสเผลออัพรูปทับ ลบแล้วไลน์ลูกกลับไปยืมผังไลน์แม่อัตโนมัติ · เช็ค sharers ก่อนลบไฟล์) — เฉพาะผังของตัวเอง **ห้ามลบผังที่ยืมแสดงจากไลน์แม่**), ProductMaster.jsx (dr_products + parts_master ทั้งตอนเปลี่ยนรูปและตอนลบสินค้า — มี guard ไม่ลบรูปที่สินค้า/พาร์ทอื่นแชร์ URL เดียวกัน), QAInspectionSetup.jsx (replace/delete drawing + ลบทั้งโฟลเดอร์ตอนลบ part), PMSetup.jsx (ลบ jig = ลบรูปทั้งชุด frame-*/cp-*), SignatureModal.jsx (ลายเซ็นเก่า — เฉพาะโฟลเดอร์ user ตัวเอง), Management.jsx (รูปหลักฐาน OJT แนบทับ = ลบรูปเดิม), MtnMachineLayout.jsx (รูปโซน facility), Improvements.jsx (รูป before/after ทั้งตอนเปลี่ยนและตอนลบโปรเจค) · หน้าใหม่ที่มีการเปลี่ยนรูปต้องทำแบบเดียวกัน ไม่งั้นไฟล์กำพร้าสะสม (เคยค้าง 117 ไฟล์ / 100MB เพราะอัปโหลดชื่อใหม่ `emp_<timestamp>` โดยไม่ลบของเดิม)
- **อุปกรณ์ PM ใช้ "รูปหลายมุม (spin)" เท่านั้น — ไม่มีโมเดล 3D แล้ว** (ถอดออก 2026-07-10 เพราะเกินจำเป็น + dep หนัก three/occt wasm 7.6MB): PMSetup อัปหลายรูปมุมต่างๆ (SpinAnnotator) ปักหมุดจุดตรวจต่อเฟรม, หน้าตรวจ (JigSpinCheck) ปัดหมุน+auto-play+หมุด sync checklist 
> #### ⚠️ ความถี่การตรวจ — ค่าที่ UI ให้เลือก ต้องตรงกับที่ DB รับ (2026-08-21 · feedback "เลือกรายไตรมาสแล้วเซฟไม่ได้")
> `FREQ_LABEL` (`src/lib/pmSchedule.js`) มี 5 ค่า **daily · weekly · monthly · quarterly · periodic**
> แต่ check constraint ของ `checklists.frequency` ในฐานจริงไม่รู้จัก `'quarterly'` → **UI ให้กดได้ แต่ DB ปฏิเสธ**
> (`checklists` สร้างนอก migration folder จึงไม่มีนิยามในรีโปให้ตรวจ — ไฟล์ `20260701_add_pm_maintenance_module.sql` เป็นของตาราง `pm_checklists` ที่ DEPRECATED ไปแล้ว **อย่าอ่านเป็นนิยามของ `checklists`**)
> - migration `20260821_checklists_frequency_values.sql` (DR · รันซ้ำได้) — ลบ check constraint ของคอลัมน์ `frequency` ทุกตัวโดยไม่ต้องรู้ชื่อ (วนจาก `pg_constraint`) แล้วสร้างใหม่ให้ครอบทุกค่าใน `FREQ_LABEL` · แถวที่ค่านอกลิสต์ → `'periodic'`
> - **⚠️ เพิ่มค่าใน `FREQ_LABEL` เมื่อไหร่ ต้องมาเติมที่ constraint นี้ด้วยเสมอ**
> - **บทเรียนที่ใหญ่กว่าตัวบั๊ก:** `setChecklistFrequency` เดิม `throw` → **จุดตรวจที่พิมพ์มาทั้งหมดหายไปด้วย** ทั้งที่ปัญหาอยู่แค่ค่าเดียว · ตอนนี้แยกเป็น non-fatal (จุดตรวจบันทึกสำเร็จ + ขึ้นข้อความว่าอะไรไม่ถูกบันทึกและต้องรัน migration ไหน + **ไม่ปิดโมดัล** ให้อ่านทัน) — **ฟิลด์เสริมที่ DB อาจปฏิเสธ ห้ามลากงานหลักล้มไปด้วย** (pattern เดียวกับ `close_approve_note`) · จุดตรวจเป็น `delete → insert` = กดบันทึกซ้ำปลอดภัย
>
> #### ⚠️ กฎเหล็ก — ภาพรวม = "แผนที่" · โคลสอัพ = "รูปเจาะจุด" ห้ามอัปโคลสอัพเป็นเฟรมแยก (2026-08-21 · feedback หน้างาน)
> **2 เรื่องที่ทีมงานแจ้งหลังใช้จริง แก้แล้วทั้งคู่:**
> 1. **🔴 เลิก auto-crop แล้ว** — `addFrames` เดิม center-crop 3:4 ทันทีที่เลือกรูป (`utils/cropPortrait.js`) → **ผู้ใช้เลือกไม่ได้ว่าจะเก็บส่วนไหน จุดตรวจริมภาพโดนตัดทิ้ง** แก้ไม่ได้เลยนอกจากไปครอบในแอปอื่นก่อน · ตอนนี้เข้า **`ImageCropModal`** (ลาก/ซูมเลือกกรอบเอง · เลือกหลายไฟล์ = ครอบทีละใบเป็นคิว `cropQueue`) ตามกติกาที่มีอยู่แล้วว่า *"อัปโหลดรูปทุกหน้าต้องผ่าน ImageCropModal"* — **PMSetup เคยเป็นจุดเดียวที่แหกกฎนี้** · ลบ `utils/cropPortrait.js` แล้ว
>    - **`ImageCropModal` มี prop ใหม่ `allowFull`** = ติ๊ก "ใช้ทั้งรูป (ไม่ครอบ)" สำหรับรูปภาพรวมที่จุดกระจายทั้งภาพ · **default ปิด** → จุดที่เรียกอยู่เดิม (รูปพนักงาน/โปรไฟล์) ไม่เปลี่ยนพฤติกรรม
>    - **เฟรมต่างสัดส่วนกันได้แล้ว ไม่พัง** — `useImgBox` หัก letterbox อยู่แล้ว pin จึงตรงเสมอ (ผลข้างเคียง: สลับเฟรมใน spin กล่องรูปจะกว้างไม่เท่ากัน — ยอมรับได้ แลกกับการไม่ตัดข้อมูลทิ้ง)
> 2. **🔍 หมุดบนภาพรวม แตะแล้วซูมดูรูปเจาะจุดได้** — เดิมหน้างานอัปรูปมุมแคบเป็น "เฟรม" แยก แล้ว**คนตรวจไม่รู้ว่าจุดนั้นอยู่ตรงไหนของเครื่อง** · ใช้ **`jig_checkpoints.image_path` ที่มีอยู่แล้ว (ไม่ต้อง migration)** เป็นรูปโคลสอัพต่อจุด → หมุดที่มีรูปขึ้น badge 🔍 · แตะ = เปิด `CpZoom` (lightbox ในแอป) เห็นเลขจุด+ชื่อ+เกณฑ์
>    - **`CalloutPin` รับ prop `badge`** (จุดเล็กมุมวงเลข) — additive ไม่ส่ง = เหมือนเดิม ใช้ได้ทั้ง QA drawing/PM
>    - **`CpImage` เปิดซูมในแอป ห้ามกลับไป `<a target="_blank">`** — หน้างานใช้มือถือ เปิดแท็บใหม่ = เด้งออกจากใบตรวจที่กรอกค้างอยู่
>    - รูปเจาะจุดบีบ **1280px / 0.3MB** (เดิม 900px/0.2MB — เล็กไปจนซูมแล้วดูไม่ออก) · **ไม่ crop โดยตั้งใจ** (ข้อยกเว้นในกฎ Storage: รูปที่ต้องเห็นทั้งใบให้ "บีบ" ไม่ใช่ "ครอบ")
>    - `SpinAnnotator` มีกล่องอธิบายวิธีใช้ที่ถูกอยู่บนจอ + หมุดที่ยังไม่มีรูปเจาะจุดบอกใน tooltip
>
· คอลัมน์ vestigial `jigs.model_path`/`model_format` และ bucket `jig-images` (cap 40MB + mime GLB) ยังคงอยู่จาก migration เดิม (additive ไม่กระทบ) แต่**ไม่มีโค้ดใช้แล้ว** — ถ้าจะรื้อ 3D กลับมาให้ดู git history (`src/lib/model3d.js`, `src/components/Model3DViewer.jsx`)
> ### ⚠️ กฎเหล็ก — จอที่ refresh เอง ต้อง `usePolling` และ master ต้อง `cachedMaster` (2026-08-19)
> **Supabase เตือนโควต้าหมด grace period (18 ส.ค. 2026) — ตัวที่ทะลุคือ Egress ไม่ใช่ DB/Storage**
> (วัดจริง: DB Main 35MB / DR 53MB จาก 500MB · Storage 233MB จาก 1GB — ทั้งคู่ไม่ถึง 25%)
> **ต้นเหตุ: จอสด poll ทุก 30 วิ ตลอด 24 ชม. แล้วดึง "ตาราง master ทั้งตาราง" มาใหม่ทุกรอบ**
> วัด payload จริง (JSON ดิบ ก่อน gzip) ที่ FactoryMap ดึงซ้ำทุก 30 วิ:
> `machines` **107 KB (565 แถว)** · `dr_products` 10 KB · `facility_supply_links` 8.6 KB · `kanban_standards` 6.4 KB
> = **133 KB ทุก 30 วิ → 16 MB/ชม. → ~11.8 GB/เดือน ต่อจอเดียว** ทั้งที่โควต้าทั้งเดือนมี **5 GB**
> (ข้อมูลพวกนี้เปลี่ยนเดือนละไม่กี่ครั้ง — จ่าย egress ไปโดยไม่ได้ความสดอะไรเลย)
>
> **2 กติกาบังคับสำหรับหน้าที่ refresh เอง:**
> 1. **`usePolling(fn, ms)` / `visibleInterval(fn, ms)` (`src/utils/usePolling.js`) แทน `setInterval` เสมอ**
>    — แท็บถูกซ่อน (สลับแอป/ล็อกจอ/ย่อหน้าต่าง) = **หยุดยิง DB** · กลับมาเห็นจอแล้วข้อมูลเก่าเกินรอบ = รีเฟรชทันที
>    · จอ TV ที่เปิดค้าง = visible ตลอด → **ความสดเท่าเดิมเป๊ะ** · ใช้ `visibleInterval` เมื่อ effect นั้นมี realtime channel/timer อื่นปนอยู่
> 2. **ตาราง master ต้องผ่าน `cachedMaster(key, loader, ttl)` (`src/utils/masterCache.js`, TTL 10 นาที)**
>    — `dr_products` `kanban_standards` `machines` `break_policies` `facility_supply_links` ฯลฯ
>    · **ห้ามเอามา cache ข้อมูลการผลิตสด** (session/order/downtime/defect/mtn_orders) จอจะโกหก
>    · แก้ master แล้วจอสดเห็นช้าได้ถึง 10 นาที (refresh หน้าเว็บล้าง cache ทันที) — หน้าที่แก้ master เองเรียก `invalidateMaster(key)` ได้
> 3. **กรองฝั่ง server ห้ามดึงมากรองในเบราว์เซอร์** — เดิม `loadSupply` ดึง `mtn_orders` ทั้งตารางมากรอง `status` เอง
>    (`status` เป็น NOT NULL default `'pending'` → `.not('status','in','("closed","rejected")')` ให้ผลเท่าเดิมเป๊ะ ตรวจแล้ว)
>
> 4. **⚠️ ห้ามใส่ตัวเลข ms ดิบในหน้าใดๆ — ความถี่ทุกจอรวมศูนย์ที่ `src/utils/refreshRates.js`**
>    (เดิมกระจาย 13 จุด ตั้งกันเอง 30/60 วิ ปนกัน ไม่มีใครรู้ว่ารวมแล้วกินเท่าไหร่)
>
> | ระดับ | ค่า | ใช้กับ | เหตุผล |
> |---|---|---|---|
> | `RATE.ANDON` | 5 นาที | FactoryMap loadStatus/loadSupply | **realtime เป็นช่องทางหลัก** อันนี้กันเหนียว — ยังเร็วกว่าเกณฑ์แจ้งเตือน (15 นาที) 3 เท่า |
> | `RATE.BOARD` | 5 นาที | Management บอร์ดยอดผลิต · FactoryMap กำลังคน | ตามงานได้ ช้าไม่กี่นาทีไม่ทำให้ตัดสินใจผิด |
> | `RATE.ANALYTIC` | 10 นาที | Dashboard · DeptHub · LineStock · RundownStock · StoreMonitor · Transport · OEEAnalytics | ดูเพื่อวางแผน ไม่ใช่วิ่งไปแก้เดี๋ยวนี้ |
> | `RATE.BACKUP` | 15 นาที | DowntimeSiren · Management dt alarm · DailyPM | มี realtime push อยู่แล้ว interval เป็นแค่กันเหนียว |
> | `RATE.SLOW` | 30 นาที | FactoryMap loadPM | แผน PM ไม่เปลี่ยนระหว่างวัน |
> | `MASTER_TTL` | **4 ชม.** | `cachedMaster` ทุกตัว | master เปลี่ยนเดือนละไม่กี่ครั้ง · refresh หน้าเว็บล้าง cache ทันที |
>
> #### ⚠️ 2 หลักที่ต้องเข้าใจก่อนไปแตะตัวเลขพวกนี้
> **(ก) การแจ้งเตือนจริง ไม่ได้พึ่ง polling ของจอเลย — อย่าเอา polling ไปทำหน้าที่แจ้งเตือน**
> Telegram + ไซเรน + Web Push มาจาก edge **`downtime-open-scan` (pg_cron ฝั่ง server ทุก 5 นาที)** ยิงเมื่อ downtime ค้างเกิน **`dt_alert_config.open_alert_min` = 15 นาที** · ไซเรนบนจอมาจาก realtime · ปุ่ม "เรียกช่าง" ยิงทันที
> → **polling ของจอทำแค่ "เปลี่ยนสีบนผัง"** · ในเมื่อเกณฑ์เตือนคือ 15 นาที การ poll ทุก 30-60 วิ **ไม่ได้ทำให้ใครรู้เร็วขึ้นเลย แค่เปลืองโควต้า** (เหตุผลที่ ANDON ยืดจาก 30 วิ → 5 นาทีได้โดยไม่เสียอะไร)
> **(ข) realtime มาก่อน · poll เป็นตัวกันเหนียว** — push ส่งเฉพาะแถวที่เปลี่ยน (~200 bytes) ถูกกว่า poll ทั้งชุด (22 KB) เป็นร้อยเท่า **และเร็วกว่าด้วย**
> จอที่มี realtime: Dashboard · Management · DailyPM · DowntimeSiren · **FactoryMap (เพิ่ม 2026-08-19 — เดิม polling ล้วน 0 channel จึงต้องตั้ง 30 วิ)**
> **⚠️ ตารางที่ subscribe ต้องอยู่ใน publication `supabase_realtime` ไม่งั้น subscription เงียบไม่ทำงานและไม่มี error ใดๆ** — `mtn_orders` เคยตกหล่น (migration `20260819_realtime_mtn_orders.sql` · **apply แล้ว**) · ตอนนี้ครบ 5: `downtime_logs` `prod_orders` `defect_logs` `production_sessions` `mtn_orders`
>
> #### 🔴🔴 กฎเหล็ก — subscribe realtime ต้องผ่าน **`liveChannel(client, name)`** ห้ามเรียก `client.channel('ชื่อคงที่')` (2026-08-26 · feedback หน้างาน)
> *"หน้า line management เปิดไปเปิดมา โชว์สกิลพนักงาน ซักพักหน่วงๆ ละค้างไปเลย"* — **ไม่ใช่เรื่องกราฟ/การ์ดสกิล**
> เป็นบั๊ก realtime ที่ **สะสมทุกครั้งที่ effect re-run** และซ่อนอยู่ใน **12 จุดทั่วแอป**
> 2 พฤติกรรมของ supabase-js ที่มาบรรจบกัน (ยืนยันจากซอร์สใน `node_modules`):
> - `client.channel(topic)` **dedupe ตามชื่อ topic** — เจอตัวเดิมใน `client.channels` = **คืนตัวเดิม**
> - `client.removeChannel(ch)` เป็น **async** — `await ch.unsubscribe()` (รอ server ack ของ `phx_leave`
>   1 round trip หรือจนกว่าจะ timeout ~10 วิ) แล้ว**ค่อย** `teardown()` ซึ่งเป็นจังหวะที่ถูกถอดออกจริง
>
> React cleanup ไม่ await → ลำดับที่เกิดจริงตอนเปลี่ยนไลน์/เปลี่ยนกะ/นำทางกลับเข้าหน้า:
> `removeChannel(ch)` (ยังค้างในลิสต์) → `channel('ชื่อเดิม')` **คืนตัวที่กำลังจะตาย** → `.on().on()`
> **push binding เพิ่มเสมอ (`_on` ไม่มี dedupe)** → `.subscribe()` ไม่ทำอะไร (re-join เฉพาะตอน closed)
> ⇒ **สลับไลน์ N ครั้ง = N ชุด binding บน channel เดียว** · DB event เข้า 1 ครั้ง เรียก callback N ตัว
> (คนละ closure คนละ debounce timer) → N query + N setState + N render → **หน่วงขึ้นเรื่อยๆ จนค้าง**
> · closure เก่ายังถือ scope เดิม → `setState` ของไลน์เก่า **เขียนทับไลน์ที่กำลังดูอยู่** (Andon โชว์ผิดไลน์)
>
> - **`src/utils/liveChannel.js`** ตั้ง topic ไม่ซ้ำต่อการ subscribe 1 ครั้ง (prefix ยังเป็นชื่อเดิม อ่านออกใน devtools)
> - **`postgres_changes` ชื่อ topic เป็นแค่ตัวระบุฝั่ง client** (ตัวกรองตาราง/เงื่อนไขส่งไปใน payload ตอน join) → ตั้งไม่ซ้ำได้ปลอดภัย
> - **⚠️ `broadcast`/`presence` ห้ามใช้ liveChannel** — topic คือ "ห้อง" ที่ 2 ฝั่งต้องตรงกัน
>   (รีโมทจอ `esm-remote-<code>` ใน `RemoteReceiver`/`RemoteControl` — **2 จุดนี้ตั้งใจคงชื่อคงที่ ห้ามแตะ**)
> - **⚠️ `[]` deps ไม่ใช่ข้ออ้าง** — ตรวจแล้ว **ไม่มีสักจุดที่ deps ว่าง** (ทุกจุดพึ่ง state/useCallback) และ
>   ต่อให้ deps ว่างจริง การนำทางออก-เข้าหน้าเร็วๆ ก็ชน race เดียวกัน
> - เทสล็อกไว้แล้ว `src/utils/__tests__/liveChannel.test.mjs` — จำลอง client ตามพฤติกรรมจริง
>   แล้วพิสูจน์ทั้ง 2 ทาง: ชื่อคงที่ = binding ทบเป็น 10 หลังสลับ 5 ครั้ง · `liveChannel` = คงที่ 2 เสมอ
>
> **งบ (แผน ~15 จอ): จอที่เปิดหน้าหนักสุด ≈ 0.24 GB/เดือน/จอ → 15 จอ ≈ 3.6 GB** เหลือให้มือถือ/PC ~1.4 GB
> เกินงบให้ยืด `ANDON`/`ANALYTIC` ก่อน — **อย่าลด realtime** (ถูกและเร็วกว่า ตัดออกต้องกลับไป poll ถี่ซึ่งแพงกว่ามาก) · **ยืดเกิน 10 นาทีไม่คุ้ม**
> **ผลรวม: FactoryMap จาก ~18.4 MB/ชม. เหลือ ~0.33 MB/ชม. = ลด 98%**
>
> **ทำแล้ว:** FactoryMap (4 loop) · Management (2) · Dashboard · DailyPM · DeptHub · DowntimeSiren · LineStock · RundownStock · StoreMonitor · Transport · OEEAnalytics
> **ตัวจับเวลาที่เป็นแค่นาฬิกา (`setNow`/`setNowMs`/`setNowForBoard`/`setFrameIdx`) ไม่ต้องแตะ** — ไม่ยิง DB ไม่กิน egress
> **แนวทางที่ถูกที่สุดคือ realtime + poll ห่างๆ เป็นตัวสำรอง** (Dashboard/DailyPM ทำแบบนี้อยู่แล้ว — push เฉพาะแถวที่เปลี่ยน กิน egress น้อยกว่า poll มาก) · จอใหม่ให้ทำตาม pattern นี้
>
> #### 📊 งบ Free tier ครบทุกลิมิต (ตรวจ 2026-08-19 · แผน 15 จอ) — เช็คตัวนี้ก่อนเพิ่มของหนักๆ
> **⚠️ Egress ของ Supabase เป็น "unified" — รวม DB + Storage + Realtime + Edge Function ในถังเดียว 5 GB**
> (เคยเข้าใจผิดว่า realtime อยู่นอกถัง — ไม่ใช่ · แต่ push ยังถูกกว่า poll เป็นร้อยเท่าอยู่ดี)
>
> | ลิมิต Free | เพดาน | คาดใช้ที่ 15 จอ | เหลือ |
> |---|---|---|---|
> | **Egress (รวมทุกอย่าง)** | 5 GB/เดือน | **~3.8 GB** (poll 3.6 + realtime 0.16) | 🟡 24% |
> | Realtime messages | 2,000,000/เดือน | ~315,000 | ✅ 84% |
> | Realtime concurrent | 200 | ~25 (15 จอ + มือถือ/PC) | ✅ 88% |
> | Edge Function calls | 500,000/เดือน | ~19,500 (cron 3 ตัว + แจ้งเตือน) | ✅ 96% |
> | DB ต่อ project | 500 MB | Main 35 · DR 53 | ✅ 90%+ |
> | Storage | 1 GB | 233 MB | ✅ 77% |
> | MAU | 50,000 | <300 | ✅ 99% |
> | Active projects | 2 | 2 (Main + DR) | ⚠️ **เต็ม — สร้าง project ที่ 3 ไม่ได้** |
>
> **ที่มาของ realtime estimate:** write บนตารางที่ subscribe ≈ 700 events/วัน
> (prod_orders เปิดใบ 154 + แก้ยอด 82 · downtime 118 · sessions 18 · defect 2 · mtn 0 — เฉลี่ย 7 วัน)
> × 15 จอ = ~10,500 msg/วัน · **โตตามจำนวนจอแบบเชิงเส้น** เพิ่มจอเยอะๆ ให้คำนวณใหม่
>
> **⚠️ ตัวที่ตึงที่สุดคือ Egress (24% ของงบ) — ก่อนเพิ่มจอ/หน้า/realtime channel ให้ประเมินตรงนี้ก่อนเสมอ**
> **`/version.json` ไม่นับ** — 25 bytes เสิร์ฟจาก **Render static site** คนละถังกับ Supabase (Render free 100 GB)

- **Quota Free plan (ต่อ project):** DB 500MB · Storage 1GB · Egress 5GB/เดือน — **ตรวจล่าสุด 2026-08-17: Main DB 34MB (~7%) · DR DB 51MB (~10%)** (2026-08-05: Main 27MB · DR 33MB · Storage Main ~165MB 17% · DR ~63MB 6%) → พนักงาน ≤300 คน + อัตราข้อมูลโตปัจจุบัน อยู่ได้อีกหลายปี ถ้าใกล้เต็มค่อยอัป Pro ($25/เดือน = DB 8GB + Storage 100GB) โดยไม่ต้องย้ายระบบ
  - **ตรวจขนาดเป็นระยะ:** `select pg_size_pretty(pg_database_size(current_database()))` และหาตัวหนักด้วย `pg_stat_user_tables` (⚠️ อย่า join กับ `pg_tables` — คอลัมน์ `schemaname` ชนกัน ใช้ตัวเดียวพอ)
- **⚠️ ตัวกิน DB ที่ไม่ใช่ข้อมูลงาน — เช็คก่อนตกใจว่า DB โต (2026-08-05):** DR เคยพุ่งไป 72MB โดย **43MB เป็น log ขยะล้วน** ไม่ใช่ข้อมูลธุรกิจ:
  - `cron.job_run_details` (log ผลรัน pg_cron) — DR รัน cron ถี่มาก (downtime-open-scan ทุก 5 นาที · pm-daily-scan + shipping-phase-scan ทุก 10 นาที) = **~500 แถว/วัน ≈ 1 MB/วัน → ปีละ ~350MB** ถ้าไม่ล้าง · **แก้แล้ว: มี cron `purge-cron-logs` ลบเก่ากว่า 7 วันทุกวัน 18:00 UTC (01:00 ไทย)** — migration `20260805_purge_cron_logs.sql`
  - `net._http_response` (buffer ผลตอบกลับ pg_net) — pg_net ลบแถวเองแต่**ไม่คืนพื้นที่** เกิด bloat (เคย 16MB จากแถวจริงแค่ 145) · ถ้าโตอีกให้ `vacuum full net._http_response`
  - **2 ตารางนี้ไม่มีโค้ดไหนอ่านเลย** ลบ/vacuum ได้ปลอดภัย — `cron.job_run_details` เป็นแค่ log ผลการรัน (ตารางตั้งเวลาคือ `cron.job` คนละตัว ไม่กระทบ) · cron ทุกตัวยิง http แบบ fire-and-forget ไม่มีใคร collect ผล
  - **VACUUM FULL รันใน migration/transaction ไม่ได้** ต้องรันเป็นคำสั่งเดี่ยว (DELETE เฉยๆ Postgres ไม่คืนพื้นที่)
- **ตัวกิน Storage:** `employee-photos` (Main) 151MB จาก 206 ไฟล์ — แต่ **37 ไฟล์กิน 131MB (87%)** คือ GIF/PNG ยักษ์ 4.7-5.3MB ที่อัปก่อนมี cap 2MB + โฟลเดอร์ `layouts/` (ผัง 16 ไฟล์ 23MB — **ตั้งใจ ห้ามบีบเพิ่ม** ต้องซูมอ่านผังได้) · รูปพนักงานปกติ 144 ไฟล์ ≤200KB (บีบทำงานถูกต้อง)

---
