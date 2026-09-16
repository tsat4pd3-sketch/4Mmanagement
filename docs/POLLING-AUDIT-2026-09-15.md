# Audit — ระบบที่ "ดึงข้อมูลตลอดเวลา" มีอะไรบ้าง (2026-09-15)

> คำสั่ง user: *"อยากไห้เช็คเรื่องระบบที่ดึงตลอดเวลา มีอะไรบ้าง บางอย่างไม่จำเป็น ถ้าไม่มีอะไร trigger หรือ input เข้ามา"*
> บริบท: จะติดจอ **10 จอ (เฟส 1)** + **แท็บเล็ตมือถือ 10 เครื่อง** + **เฟส 2 อีก ~20 เครื่อง** ≈ **40 เครื่องเปิดค้าง**
> และจะ **ยกเลิก Pro กลับไป Free (5 GB/เดือน)** ⇒ ต้องคุมให้ได้ **≤ ~4 MB/เครื่อง/วัน**

---

## 1. สรุปสั้น — ตัวกิน egress ตัวจริงไม่ใช่ "รอบ poll"

ทุกรอบที่ผ่านมาเราไปยืด `RATE` (รอบ poll) ซึ่ง**มีเพดานอยู่แล้ว** (ตอนนี้ 15-60 นาที)
แต่ตัวที่ยิงจริงบนจอที่มี realtime คือ **handler ของ realtime ซึ่งไม่เคยมีเพดานเลย**

วัดจาก edge log จริง **15/09 (วันจันทร์ ทำงานปกติ) 20 ชม.** — หลังยืด RATE เป็น 15 นาทีไปแล้ว:

| path | requests | ควรเป็นเท่าไหร่ถ้ามาจาก poll อย่างเดียว |
|---|---:|---|
| `prod_orders` | **6,876** | ~80/เครื่อง/วัน |
| `production_sessions` | **6,107** | ~80 |
| `downtime_logs` | **5,240** | ~80 |
| `dr_products` | 1,486 | (master — ควรเป็น 0 เพราะ cache แล้ว) |
| `defect_logs` | 1,082 | ~80 |
| `line_stock_summary` | 999 | |
| `child_lot_requests` / `storage_locations` / `v_demand_flow_blocks` | 705 / 710 / 703 | **0** (ดู §4) |

⇒ **เกือบทั้งหมดมาจาก realtime ไม่ใช่ poll**

### ทำไม — `debounce` ไม่ใช่ `เพดาน`

ทุกจอเขียนเหมือนกันหมด: `debounce(reload, 1500)` = "รอให้เงียบ 1.5 วิ แล้วค่อยโหลด"
วันทำงานจริง 20 ไลน์บันทึกงานตลอดเวลา ⇒ **แทบไม่มีช่วงเงียบเกิน 1.5 วิเลย**
⇒ จอโหลดใหม่**ทุกครั้งที่ใครก็ตามในโรงงานแตะข้อมูล** ไม่มีขีดจำกัดบน

FactoryMap 1 รอบ = 26 KB ⇒ จอเดียว ~150 MB/วัน ⇒ **10 จอ = 1.5 GB/วัน**
(โควต้า Free = 5 GB/**เดือน** — หมดใน 3 วัน)

**และมันแย่ลงตามจำนวนเครื่อง × จำนวนไลน์ที่เดิน** — ไม่ใช่ตามจำนวนเครื่องอย่างเดียว
นี่คือเหตุผลที่ต้องแก้ก่อนติดจอ ไม่ใช่หลังติด

---

## 2. ทะเบียนตัวที่ "ดึงตลอดเวลา" ทั้งระบบ

### 2.1 🔴 กลุ่ม A — realtime แล้วโหลดใหม่ (ไม่มีเพดาน) ← **ต้นเหตุ · แก้แล้ว 2026-09-15**

| ไฟล์ | trigger จากตาราง | ของเดิม | โหลดอะไร |
|---|---|---|---|
| `FactoryMap.jsx` | downtime · prod_orders · defect · sessions · mtn_orders | debounce 1.5s | `loadStatus` **26 KB** |
| `Dashboard.jsx` | 4 ตารางเดียวกัน | debounce 1.5s | `fetchProdStatus` |
| `DailyReport.jsx` | 4 ตารางเดียวกัน **ไม่กรองไลน์** | debounce 600ms | 4 ตัวโหลด |
| `VSM.jsx` | 4 ตารางเดียวกัน | debounce 1.5s | `loadLive` |
| `FlowTower.jsx` | prod_orders · sessions | **ไม่มี debounce เลย** | `load` |
| `MtnRepair.jsx` | mtn_orders | **ไม่มี debounce เลย** | `select('*').limit(1000)` |
| `RackCenter.jsx` | rack_requests | **ไม่มี debounce เลย** | `load` |
| `Management.jsx` | downtime · sessions | debounce 1s | DT alarm |
| `DailyPM.jsx` | inspections · prod_orders · sessions | debounce 1.5s | `load` |
| `MtnAndonBoard.jsx` | downtime | **`setTimeout(load,400)` ต่อ event** | `load` |
| `DowntimeSiren.jsx` | downtime | **`setTimeout(fetchAlerts,400)` ต่อ event** | `fetchAlerts` |

> ⚠️ `setTimeout(load, 400)` ต่อ event **ไม่ใช่ debounce** — แต่ละ event ตั้งนาฬิกาของตัวเอง
> ⇒ 10 event = โหลด 10 รอบ ห่างกัน 400 ms (แย่กว่าไม่ใส่อะไรเลยด้วยซ้ำ เพราะดูเหมือนมีการป้องกัน)

### 2.2 🟡 กลุ่ม B — timer poll (`RATE`) — ยิงทุกรอบไม่ว่ามีอะไรใหม่หรือไม่

หยุดยิงเมื่อแท็บถูกซ่อน (`usePolling`/`visibleInterval`) — **แต่จอ TV visible ตลอด 24 ชม.**

| หน้า/คอมโพเนนต์ | loop | tier | มี realtime คู่ด้วยไหม |
|---|---|---|---|
| `FactoryMap` | `loadStatus` (sessions·prod_orders·downtime·defect·dr_products·kanban_standards·break_policies) | ANDON 15m | ✅ |
| `FactoryMap` | `loadManpower` (employees·daily_production_logs·workstations·production_lines·station_assignment_logs) | BOARD 15m | ❌ |
| `FactoryMap` | `loadPM` (machines·jigs·checklists·pm_plans·pm_coordination_*) | SLOW 60m | ❌ |
| `FactoryMap` | `loadSupply` (mtn_orders·machines·facility_supply_links) | ANDON 15m | ✅ |
| `FactoryMap` | `loadDieZones` (equipment_die·die_storage_areas·mtn_orders·machines) | ANALYTIC 20m | ✅ |
| `FactoryMap` | `loadStoreZones` (line_stock_summary·storage_zones·parts_master·kanban_standards) | ANALYTIC 20m | ❌ |
| `Dashboard` | `fetchAll` | ANALYTIC 20m | ✅ (เฉพาะส่วนผลิต) |
| `Management` | `fetchLineProd` · DT alarm | BOARD 15m · BACKUP 30m | ✅ |
| `LineOeeBoard` | `load` | BOARD 15m | ❌ **ไม่มี realtime เลย** |
| `DeptHub` · `OEEAnalytics` · `StoreMonitor` · `Transport` · `RundownStock` · `TvBoard` · `LineStock` · `FlowTower` | `load` | ANALYTIC 20m | ส่วนใหญ่ ❌ |
| `DailyPM` · `DowntimeSiren` | `load`/`fetchAlerts` | BACKUP 30m | ✅ |
| `MtnAndonBoard` | `load` | ANDON 15m | ✅ |
| `QaFmeBoard` · `ProdProgressStrip` | `load` | BOARD 15m | ❌ |
| `QaFmeQueue` · `StoreWaitCards` | `load` | ANALYTIC 20m | ❌ |
| `VSM` | `loadLive` | BOARD 15m (เฉพาะแท็บ live) | ✅ |

**⚠️ FactoryMap จอเดียว = 6 loop แตะ ~23 ตาราง** — งบเดิมปี ส.ค. ประเมินไว้ "0.24 GB/จอ"
เพราะ**นับแค่ loop เดียว** นั่นคือที่พลาดมาตั้งแต่ต้น

### 2.3 ⚪ กลุ่ม C — ตัวจับเวลาที่ **ไม่ยิง DB** (ไม่ต้องแตะ)

นาฬิกา/ตัวนับบนจอ: `Management`·`RackCenter`·`HeijunkaKanban`·`LineStock` (30 วิ) ·
`LineOeeBoard`·`DeptHub`·`Dashboard` (1 วิ) · `DailyPM` (1 นาที) · `MtnAndonBoard`·`QaFmeQueue` (30 วิ) ·
`DowntimeSiren` (1 นาที + ลูปเสียง) · `PMCheckData` (สไลด์รูป 650 ms) · `App.jsx` idle-logout (30 วิ, localStorage)

### 2.4 ⚪ กลุ่ม D — ตัวที่ทำงานทุกหน้า (global)

| ตัว | ความถี่ | กิน Supabase ไหม |
|---|---|---|
| `main.jsx` version check (`/version.json` 25 bytes) | 2 ชม. | ❌ Render static — คนละโควต้า |
| `App.jsx` notifications | **realtime push อย่างเดียว** ไม่มี poll | ถูกอยู่แล้ว ✅ |
| `App.jsx` role_permissions sync | realtime | ✅ |
| Service Worker | ไม่มี fetch handler | ❌ |

---

## 3. ตอบคำถามตรงๆ — "อันไหนไม่จำเป็นถ้าไม่มี trigger/input"

| # | ที่ไม่จำเป็น | สถานะ |
|---|---|---|
| 1 | จอโหลดใหม่เพราะ **ไลน์อื่น** ขยับข้อมูล (DailyReport ไม่เคยกรอง session) | ✅ แก้แล้ว — กรองฝั่ง server ด้วย `session_id` |
| 2 | จอโหลดใหม่ **หลายรอบในนาทีเดียว** เพราะ event รัว | ✅ แก้แล้ว — `coalesce()` ใส่เพดานจริง |
| 3 | `StoreLotQueue` ยิง 4 คิวรีซ้ำทุกครั้งที่พ่อ re-render | ✅ แก้แล้ว (§4) |
| 4 | **timer poll ยิงทั้งที่ไม่มีอะไรเปลี่ยนเลย** (คืน/เสาร์อาทิตย์/ช่วงพัก) | ✅ แก้แล้วบนจอที่มี realtime — `makeIdleGate` (§5.6) · จอที่ยังไม่มี realtime ดู §6 |
| 5 | `dr_products` 1,486 req/วัน ทั้งที่ cache แล้ว | 🔎 ต้องไล่ว่าใครยังไม่ผ่าน `cachedMaster` |

---

## 4. บั๊ก re-render loop ที่เจอระหว่าง audit — `StoreLotQueue`

`child_lot_requests` 705 · `storage_locations` 710 · `v_demand_flow_blocks` 703 req/วัน
เลขเท่ากันเป๊ะ = มาจาก `load()` ตัวเดียวใน `src/components/StoreLotQueue.jsx`

**ต้นเหตุ:** `famSet` เป็น `useMemo(..., [lines, lineName])` และ `load` เป็น `useCallback(..., [lineName, famSet])`
พ่อ (`DailyReport`) เรียก `setLines(ln || [])` ทุกครั้งที่ realtime สั่งโหลดใหม่
⇒ ได้ array **ใบใหม่ที่เนื้อเหมือนเดิมเป๊ะ** ⇒ `famSet` ใหม่ ⇒ `load` ใหม่ ⇒ effect ยิงซ้ำ ⇒ **4 คิวรีฟรีๆ**

**แก้:** แปลงเป็น string key ก่อน (`famKey`) แล้วให้ `famSet` และ `load` ผูกกับ key
→ เนื้อเหมือน = key เหมือน = ไม่โหลดซ้ำ

> 📌 **กฎที่ตกผลึก:** `useCallback`/`useEffect` ที่ยิง DB **ห้ามมี object/array อยู่ใน deps**
> ถ้าค่าที่สนใจคือ "เนื้อ" ให้แปลงเป็น string/primitive ก่อนเสมอ
> (บั๊กคลาสนี้ build ผ่าน · lint ผ่าน · เทสผ่าน · หน้าจอทำงานถูกต้องทุกอย่าง — เห็นได้จาก log เท่านั้น)

---

## 5. สิ่งที่แก้ไปแล้วในรอบนี้

1. **`src/utils/liveRefresh.js` (ใหม่)** — `coalesce(fn, minGapMs)` = เพดานความถี่จริง
   · event แรกยังไวเท่าเดิม (settle 600 ms) · รอบถัดไปในช่วงเพดานถูกยุบรวมเป็นรอบเดียว
   · **ไม่มี event = ไม่ยิงเลยสักครั้ง** ← นี่คือข้อได้เปรียบเหนือ poll ทั้งหมด
   · เทส 7 เคสใน `src/utils/__tests__/liveRefresh.test.mjs` (อยู่ในด่าน `npm run build`)
2. **`LIVE` tier ใน `refreshRates.js`** — `ALARM 5s` / `PAGE 15s` / `BOARD 60s`
   (ห้ามใส่ ms ดิบตอนเรียก — กฎเดียวกับ `RATE`)
3. **แทน debounce/`setTimeout` ด้วย `coalesce` ครบทั้ง 11 จุดในตาราง §2.1**
4. **`DailyReport` กรอง realtime ฝั่ง server ด้วย `session_id`**
   ⚠️ DELETE กรองไม่ได้ (REPLICA IDENTITY default → `old` มีแค่ pk) จึงแยก subscribe ไม่กรอง
   **ห้ามแก้ด้วย `REPLICA IDENTITY FULL`** — ทุก UPDATE จะส่งแถวเก่าเต็มใบใน WAL
5. **`StoreLotQueue` famKey** (§4)
6. **`makeIdleGate(LIVE.FLOOR)` — poll ข้ามรอบเมื่อไม่มีอะไรเปลี่ยน**
   เอกสาร `refreshRates.js` เขียนมาตั้งแต่ ส.ค. ว่า *"realtime มาก่อน · poll เป็นตัวกันเหนียว"*
   แต่**โค้ดไม่เคยทำตาม** — poll ยังยิงเต็มทุกรอบคู่ไปกับ realtime = จ่ายสองต่อ
   ตอนนี้ tick ที่ไม่มี event เข้ามาเลย = **ไม่มี network สักไบต์** (เช็คในเครื่องล้วน)
   · ยิงจริงเมื่อ: มี realtime event ค้างยังไม่ได้โหลด **หรือ** ครบ `LIVE.FLOOR` (2 ชม.)
   · channel กลับมา `SUBSCRIBED` (reconnect) → `touch()` ทันที เพราะอาจพลาด event ระหว่างหลุด
   · ใช้แล้วที่: `FactoryMap` (loadStatus+loadSupply+loadDieZones) · `DailyPM` ·
     `Management` (DT alarm) · `MtnAndonBoard` · `DowntimeSiren`
   ⚠️ **ห้ามใช้กับจอที่ไม่มี realtime** — ไม่มีใครมา `touch()` = เหลือแต่ floor = จอค้าง

**ผลที่คาด:** ตัดรอบโหลดที่เสียเปล่าออกเกือบหมดทั้งวันทำงานและวันหยุด
(ตัวเลขจริงต้องดู log 16/09 เทียบกับ 15/09 — **ยังไม่ได้วัด อย่าเพิ่งเชื่อตัวเลขนี้**)

> 🧪 **บทเรียนจากรอบนี้ — `node audit/crashsweep.mjs` จับของจริงอีกครั้ง**
> ตอนย้าย `usePolling` รวม 3 loader ขึ้นไปไว้ใต้ `loadStatus` → deps อ้าง `loadSupply`/`loadDieZones`
> ที่ประกาศทีหลัง = **TDZ `Cannot access 'loadSupply' before initialization` = FactoryMap จอขาวทั้งหน้า**
> `npm run build` ผ่าน · lint ผ่าน · เทส 669 เคสผ่านหมด — เห็นจาก crashsweep อย่างเดียว

---

## 6. ยังเหลือ (เรียงตามผลตอบแทน)

### 6.1 จอที่ยัง poll ล้วน (ไม่มี realtime) — ใส่ realtime ก่อน แล้วค่อยใส่ idleGate
`LineOeeBoard` (จอ TV ที่จะติดเพิ่ม!) · `QaFmeBoard` · `QaFmeQueue` · `ProdProgressStrip` ·
`StoreWaitCards` · `DeptHub` · `TvBoard` · `LineStock` · `StoreMonitor` · `Transport` ·
`RundownStock` · `OEEAnalytics` · `FactoryMap.loadManpower/loadPM/loadStoreZones`

realtime message = ~200 bytes เฉพาะตอนมีของเปลี่ยนจริง · poll = ทั้งก้อนทุกรอบตลอด 24 ชม.
⇒ **ใส่ realtime ถูกกว่า poll เป็นร้อยเท่าและเร็วกว่าด้วย** (กฎนี้อยู่ใน refreshRates.js แล้ว)

### 6.2 `live_pulse` — ทางสำรองสำหรับจอที่ทำ realtime ไม่ไหว
ตาราง `live_pulse(scope, rev)` ฝั่ง DR + statement-level trigger บนตารางร้อน
→ จอ poll "เลข rev" (~200 bytes) ก่อน ถ้าไม่เปลี่ยนก็**ไม่ต้องดึงของหนัก 26 KB เลย**

ข้อบังคับถ้าทำ:
- trigger ต้อง **statement-level** (`FOR EACH STATEMENT`) ไม่ใช่ row-level — bulk update จะได้ไม่ bump พันครั้ง
- ฟังก์ชัน bump ต้อง `exception when others then null` — **pulse ล้มเหลวห้ามทำให้การบันทึกงานผลิตล้มตาม**
- ฝั่ง client อ่าน pulse ไม่ได้/ไม่ครบ = **ยิงของจริงตามปกติ** (fail-open — ห้ามโกหกว่า "ไม่มีอะไรเปลี่ยน")
- รอบแรกหลังเปิดหน้าต้องโหลดจริงเสมอ ไม่ผ่าน gate

### 6.3 ลด payload ต่อรอบ
- `prod_orders` 17 KB/รอบใน `loadStatus` = 65% ของก้อน — ทำ view/RPC สรุปต่อ session
  ⚠️ **ห้ามย้ายสูตร OEE ไป SQL** — `src/utils/oee.js` เป็นเจ้าของสูตรจุดเดียวเสมอ (กฎ SCADA)
- `DailyReport` ยังใช้ `machines.select('*')` (368 KB → ~208 KB ถ้าตัดคอลัมน์ที่ไม่ใช้)

### 6.4 ไล่ต่อ
- ✅ **แก้แล้ว** — `dr_products` 1,486 req/วัน มาจาก `DailyReport.load()` ที่ไม่เคย cache เลย (ดู §7)


---

## 7. 🔴 ตัวใหญ่ที่สุด — `DailyReport.load()` ดึง master 640 KB ใหม่ทุก realtime event (แก้แล้ว 2026-09-15)

`load()` ดึง **master 7 ตาราง แบบ `select('*')` โดยไม่ cache เลยสักตัว**:

| ตาราง | ขนาด | req/วัน (15/09) |
|---|---:|---:|
| `machines` | **368 KB** | 714 |
| `kanban_standards` (+ join dr_products) | **164 KB** | 569 |
| `dr_products` | **107 KB** | 1,486 |
| `break_policies` · `dr_downtime_types` · `dr_defect_types` · `production_lines` ×2 | | 643 · 478 · 478 |

**และ `load()` ถูกเรียกจาก realtime ของ `production_sessions`** ⇒ มีคนเปิด/ปิดกะที่ไลน์ไหนก็ตาม
ทุกเครื่องที่เปิดหน้านี้ดึง master ใหม่ทั้งชุด ~640 KB ทั้งที่ทะเบียนพวกนี้เปลี่ยนเดือนละไม่กี่ครั้ง
(หน้านี้คือหน้าที่คนเปิดมากที่สุดในระบบ และเป็นหน้าที่แท็บเล็ตหน้าไลน์ 10 เครื่องจะเปิดค้าง)

### 7.1 ทำไมไม่เคยมีใครแก้ — บั๊กซ้อนที่เจอระหว่างทาง

> 🔴 **`invalidateProducts()` · `invalidateMachines()` · `invalidateProductionLines()` ฯลฯ
> ที่เขียนไว้ใน `src/utils/use*.js` — ไม่มีหน้าไหนเรียกเลยสักหน้า**

เป็นบั๊กที่**มีอยู่แล้วในของจริง** ไม่ใช่ของใหม่: แก้ทะเบียนสินค้า/เครื่องจักรแล้ว picker ทั้งระบบ
ยังเห็นของเก่าได้ถึง 4 ชม. · แปลว่า "cache master" ถูกหลีกเลี่ยงมาตลอดเพราะล้างไม่ได้จริง

**ปัญหาโครงสร้างที่ทำให้มันเกิด:** 1 ตารางถูก cache ไว้**หลายคีย์** คนละหน้าคนละ shape
(`dr_products` มี 8 คีย์: picker · ct · ct_pair · link · full · fx_products · pn_index · customers)
⇒ เรียก `invalidateMaster('dr_products:picker')` ตัวเดียวก็ยังค้างอีก 7 คีย์ ⇒ ไม่มีใครกล้าใช้

### 7.2 วิธีแก้

1. **`src/utils/masterInvalidate.js` (ใหม่)** — ทะเบียน **"ตาราง → คีย์ cache ทั้งหมด"** ที่เดียว
   `invalidateTable('dr_products')` ล้างครบทุกคีย์ในทีเดียว
   · ตารางที่ไม่ได้ลงทะเบียน → `console.warn` **ห้ามเงียบ**
2. **เทสในด่าน `npm run build`** — ไล่หา `cachedMaster('<คีย์>')` ทุกตัวใน `src/` แล้วเทียบกับทะเบียน
   **คีย์ใหม่ที่ไม่ลงทะเบียน = build ไม่ผ่าน** (ไม่มีด่าน = ทะเบียนล้าสมัยภายในไม่กี่สัปดาห์ เหมือนที่ `invalidate*` เคยเป็น)
3. **`DailyReport.load()` ผ่าน `cachedMaster` ครบทั้ง 8 คิวรี** (รวม `production_lines` รอบที่ 2 ที่ยิงซ้ำในรอบเดียวกัน)
4. **หน้าที่แก้ทะเบียนเรียก `invalidateTable()`** — วางไว้ใน**ตัวโหลดของหน้า** (`load()`/`fetchLines()`)
   ไม่ใช่ไล่แปะทีละปุ่ม: ทุก save/delete เรียกตัวโหลดต่อทันทีอยู่แล้ว ⇒ ครอบคลุมทุกปุ่มโดยไม่ตกหล่น
   **การไล่แปะทีละจุดคือวิธีที่ทำให้ `invalidateProducts()` เดิมตกหล่นจนไม่มีใครเรียกเลย**
   · ทำแล้วที่ `ProductMaster` · `MachineDatabase` · `LineSetup` · `DailyReport` (ตัวแก้ทะเบียนในหน้า)

**ผล:** master 640 KB ถูกดึง **≤ 6 ครั้ง/วัน/เครื่อง** (TTL 4 ชม.) แทนที่จะทุก realtime event


---

## 8. 🔴 realtime publication ไม่ครบ — subscribe ไปก็ไม่มีอะไรวิ่งมา (แก้แล้ว 2026-09-15)

ไล่เทียบ "ตารางที่โค้ด subscribe" กับ "ตารางที่อยู่ใน `supabase_realtime` publication" แล้วพบว่า**ไม่ตรงกันเลย**

| project | ก่อนแก้ | โค้ด subscribe |
|---|---|---|
| **MAIN** | **`role_permissions` ตารางเดียว** | 15 ตาราง |
| **Product DB (DR)** | 8 ตาราง | 11 ตาราง |

### ผลที่ตามมา (บั๊กเงียบสนิท — ไม่มี error โค้ดดูถูกทุกบรรทัด)

- 🔴 **กระดิ่งแจ้งเตือนไม่เคยเด้งเอง** — `App.jsx` subscribe `notifications` (filter `user_id`) และ**ไม่มี poll สำรอง**
  ⇒ ต้องรีเฟรชหน้าถึงจะเห็นแจ้งเตือนใหม่ ตลอดมา
- 🔴 `/rack-center` — คอมเมนต์เขียนว่า "live refresh เมื่อมีไลน์อื่นกดเปลี่ยนสถานะ" → **ไม่เคยทำงาน**
- 🔴 `/daily-pm` — "ตรวจเสร็จ (inspections) refresh ทันที" → **ไม่เคยทันที**
- NPI / QA (ncr·capa·claims·fme) / LPA / OJT / PE / feedback / wip_replenish — subscribe ไว้ทั้งหมด ไม่มีอะไรวิ่งมา

### ทำไมเรื่องนี้สำคัญกับ egress

วัดจาก Usage 15/09: **Egress 1.578 GB (Product DB 1.35 = 85%)** แต่
**Realtime Messages ใช้ไป 22,314 จากโควต้า 5,000,000/เดือน = <1%**
⇒ realtime แทบไม่มีต้นทุน · poll แพงมาก
⇒ **ตารางที่ไม่ได้ publish = บังคับให้จอต้อง poll ทั้งก้อนอย่างเดียว**

migration: `20260915_realtime_publication_main.sql` · `20260915_realtime_publication_dr.sql` (**apply แล้ว**)
⚠️ `line_stock_summary` เป็น **view** → publish ไม่ได้ (`22023 not supported for views`)
จอสโตร์จึงใช้ `line_stock_transactions` (ledger ที่ป้อน view นั้น) เป็นตัวปลุกแทน — ครอบคลุมเท่ากัน

> 📌 **กฎที่ตกผลึก:** เพิ่ม `.on('postgres_changes', { table: 'x' })` ที่ไหนก็ตาม
> **ต้องเช็คว่า `x` อยู่ใน publication แล้วหรือยัง** — ไม่อยู่ = subscribe เงียบ ไม่มี error ให้เห็น
> `select tablename from pg_publication_tables where pubname='supabase_realtime';`

---

## 9. 🔴 deploy ระหว่างวัน = ล้าง cache ของทุกเครื่องทั้งโรงงาน (แก้แล้ว 2026-09-15)

> คำถามจาก user ตรงเป๊ะ: *"หรือเพราะเราแก้ระหว่างวันบ่อยๆ ละพนักงานก็เปิดใช้กันหลายจอแล้ว เลยทำไห้รีเฟรชเรื่อยๆ"*

**วัดแล้ว — ใช่ และเป็นตัวใหญ่:** นับคิวรี `profiles` (ยิง 1 ครั้งต่อ 1 การเปิดแอป) วันที่ 15/09

| เวลา (ไทย) | แอป boot ใหม่ |
|---|---:|
| 07:00 | 120 |
| 08:00 | 329 |
| 09:00 | 332 |
| 10:00 | **367** |
| 11:00 | 344 |
| 12:00 | 131 |

**~340 ครั้ง/ชั่วโมง** ในเวลาทำงาน (1,372 ครั้งใน 4 ชม.)

การ reload หลัง deploy **ถูกต้องแล้ว** — fix ต้องไปถึงจอ (version-guard + `vite:preloadError` ใน `main.jsx`
มีไว้เพราะจอ TV เปิดค้างไม่มีใครกด F5 · ห้ามถอด)
**ที่ผิดคือ "ทุก reload ต้องโหลด master ใหม่ทั้งชุด"** — `masterCache` ผูกคีย์ไว้กับ `VITE_BUILD_ID`
⇒ deploy ทีเดียว = localStorage cache ของทุกเครื่องเป็นโมฆะ ⇒ boot ถัดไปดึง master ~640 KB ใหม่หมด
⇒ deploy วันละหลายรอบ × เครื่องที่เปิดค้างทั้งโรงงาน × 340 boot/ชม.

**แก้:** `BUILD_STAMP` → **`CACHE_EPOCH`** (ค่าคงที่ที่ **เปลี่ยนด้วยมือเท่านั้น**)
- deploy เฉยๆ **ไม่ล้าง cache อีกต่อไป** — โค้ดใหม่ยังไปถึงจอเหมือนเดิม แต่ไม่ลากค่า egress ไปด้วย
- ⚠️ **แก้ `select` ของ `cachedMaster` (เพิ่ม/ลบคอลัมน์) เมื่อไหร่ ต้องบวก `CACHE_EPOCH` ในคอมมิทเดียวกัน**
  ไม่งั้นเครื่องที่มี cache เก่าอ่านโครงเก่าได้ถึง 4 ชม.
- การแก้ **เนื้อข้อมูล** (แก้ทะเบียนสินค้า/เครื่อง) ไม่ต้องแตะ epoch — ใช้ `invalidateTable()` (§7)


---

## 10. ✅ วัดผลจริง 16/09 — ลด 66% (เทียบช่วงเดียวกัน 07:00–09:00 วันทำงานทั้งคู่)

**ตัวปรับฐาน:** จำนวนเปิดแอป 449 (15/09) → 404 (16/09) = **−10%** ⇒ ปริมาณการใช้งานพอๆ กัน
การลดของ request จึงไม่ได้มาจาก "คนใช้น้อยลง"

| ตาราง (Product DB) | 15/09 | 16/09 | |
|---|---:|---:|---|
| `production_sessions` | 3,892 | 1,312 | −66% |
| `downtime_logs` | 3,737 | 813 | **−78%** |
| `prod_orders` | 3,655 | 1,236 | −66% |
| `dr_products` | 915 | 310 | −66% |
| `machines` | 479 | 115 | −76% |
| `kanban_standards` | 387 | 56 | **−86%** |
| `break_policies` · `dr_downtime_types` · `dr_defect_types` | 393 · 341 · 341 | หลุด top 22 | |
| **รวม top 22** | **19,964** | **6,716** | **−66%** |

MAIN: 6,991 → 3,851 (−45%)

> ⚠️ **แก้ความเข้าใจผิดของ audit รอบแรก:** วันที่ 14/09 บันทึกไว้ว่า "74% ของ traffic มาจาก
> **เครื่องเดียว** IP 171.103.218.222" — ตรวจซ้ำ 16/09 พบว่า IP นั้นมี **user-agent 7 แบบ**
> ⇒ เป็น **IP ขาออกของเครือข่ายโรงงาน (NAT)** ไม่ใช่เครื่องเดียว
> ข้อสรุปเรื่องสาเหตุและวิธีแก้ไม่เปลี่ยน แต่ **ห้ามใช้ IP เป็นตัวนับ "เครื่อง" ในโรงงานนี้**
> (ทุกเครื่องในออฟฟิศออกมาเป็น IP เดียวกัน) — ถ้าต้องนับเครื่องจริง ให้นับจาก user-agent + คิวรี `profiles`

### สิ่งที่แก้เพิ่มรอบ 16/09 (จากตัวที่ยังค้างใน §6.4)

1. **`LinePartCallPanel` — บั๊ก re-render loop ที่หนักกว่า `StoreLotQueue`** (8 คิวรีต่อรอบ)
   `upNames`/`famNames` เป็น array ใน deps ของตัวโหลด · พ่อ (DailyReport) ส่ง prop `lines` ใบใหม่ทุกครั้ง
   ⇒ วัดได้ `line_delivery_points` 210 · `line_part_levels` 210 · `storage_locations` 195 req/2 ชม.
   **เลขเท่ากันเป๊ะ = ลายเซ็นของบั๊กคลาสนี้** → เปลี่ยนเป็น `upKey`/`famKey` (string)
2. **`LineWipPanel`** — คลาสเดียวกัน (`upNames` ใน deps) · เป็นลูกของ DailyReport เหมือนกัน
3. **cache master ที่ยังเรียกตรง** — `LineSetup` · `QAInspectionSetup` · `HeijunkaKanban` ·
   `PlannerSales` · `PmCoordination` (5 คีย์ใหม่ ลงทะเบียนใน `masterInvalidate` แล้ว)
   ⚠️ **`DieRegistry` ตั้งใจไม่ cache** — หน้านั้นอ่าน `pdRes.error` เพื่อขึ้นแถบเตือน
   `cachedMaster` กลืน error แล้วคืน `[]` ⇒ จะกลายเป็น "ไม่มีสินค้า" เงียบๆ (ห้ามล้มเหลวเงียบ)
   · หน้าเปิดไม่บ่อย ไม่ใช่ตัวกิน egress — **แลกความเงียบกับ request ไม่กี่ครั้งไม่คุ้ม**

> 📌 **ลายเซ็นที่ใช้จับบั๊กคลาสนี้ได้เร็วที่สุด:** ใน log ถ้าเห็น **ตารางหลายตัวมี req เท่ากันเป๊ะ**
> (เช่น 210/210/195) = มาจาก `load()` ตัวเดียวที่ยิงซ้ำ ไม่ใช่ผู้ใช้หลายคน → ไล่ deps ของตัวโหลดนั้น
