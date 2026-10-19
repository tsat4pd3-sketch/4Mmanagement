# หลักฐาน/ตัวเลขเบื้องหลัง "กฎเหล็กการเขียน DB จาก client"

> กฎอยู่ใน `CLAUDE.md` §กฎเหล็กการเขียน DB จาก client (11 ข้อ) — ไฟล์นี้เก็บ**ของที่วัดได้จริง**
> ที่เคยอยู่ใน CLAUDE.md แล้วทำให้ไฟล์ชนเพดาน 120 KB (ย้ายออก 2026-09-25 · ตัวกฎไม่ถูกตัดแม้แต่ข้อเดียว)

## ข้อ 3 — RLS ที่ hardcode role array แคบกว่าสิทธิ์บนจอ

วัดจริง 2026-09-04 · 5 ตารางที่ policy hardcode `admin/mgr/sv`:
`machine_points` · `machine_flow_links` · `wip_buffer_points` · `skill_sub_items` · `shift_merge_events`
— แคบกว่าสิทธิ์ที่หน้า `/permissions` แจกให้จริง (`dept_admin` · `sale`/`mtn`/`planner_store` ·
`document_control`) ⇒ **คนเหล่านี้เห็นปุ่มแต่เขียนได้ 0 แถว โดยไม่มี error**

และ `operator_special_tasks` **ไม่มี UPDATE policy เลย** ⇒ เปลี่ยนงานนอกไลน์ของคนเดิมพัง `42501` ทุก role

แก้ด้วย migration `20260904_rls_match_ui_permissions.sql`

## ข้อ 7-8 — realtime/poll ที่ไม่มีเพดาน

audit เต็ม: `docs/POLLING-AUDIT-2026-09-15.md`

- `debounce(reload, 1500)` = "รอให้เงียบ 1.5 วิ" ซึ่ง **วันทำงานจริงไม่มีช่วงเงียบ**
  ⇒ จอโหลดใหม่ทุกครั้งที่ใครก็ตามในโรงงานแตะข้อมูล **ไม่มีขีดจำกัดบน**
- `setTimeout(load, 400)` ต่อ event ยิ่งแย่ — แต่ละ event ตั้งนาฬิกาของตัวเอง = N event N โหลด
- realtime message ~200 bytes เฉพาะตอนมีของเปลี่ยน — **ถูกกว่า poll ทั้งก้อนเป็นร้อยเท่า**
- audit 15/09: **11 จอมี realtime แล้ว เขียนคนละแบบทั้ง 11 จอ และไม่มีจอไหนมีเพดานจริงเลย**
  ⇒ จึงทำ `useLiveBoard()` ให้ประกอบมาแล้วทั้งชุด

## ข้อ 11 — egress

audit เต็ม: `docs/EGRESS-AUDIT-2026-09-17.md` · `mtn_orders` มี **116 คอลัมน์**
⇒ `select('*')&limit=1000` = **1.59 MB/ครั้ง** = เกือบครึ่งของ egress ฝั่ง DR จากคิวรีเดียว
· รูปผัง PNG (lossless) = **8.4 MB/ใบ**

---

## 📚 ตัวเต็มของกฎทั้ง 11 ข้อ (ยกมาจาก CLAUDE.md 2026-09-30)

CLAUDE.md เหลือ "หัวข้อ + สิ่งที่ต้องทำ" ของแต่ละข้อ (ชนเพดาน 120 KB) — คำอธิบายยาว/เคสจริง
ของแต่ละข้ออยู่ข้างล่างนี้ **ไม่มีข้อไหนถูกตัดออก**

### (ฉบับเต็ม) กฎเหล็กการเขียน DB จาก client (ตกผลึกจาก full QC audit 2026-09-03..04 — คลาสบั๊กที่เจอซ้ำทุกรอบ)

1. **supabase-js ไม่ throw** — คืน `{ data, error }` เสมอ ⇒ `try { await supabase… } catch {}` = โค้ดตาย · `const { data } = await …` = กลืน error 100% (คิวรีล้มแล้วจอขึ้นเหมือน "ไม่มีข้อมูล") · **ทุก insert/update/delete ต้องอ่าน `error`** — helper กลาง `checkWrite(await …, 'ป้ายงาน')` ใน `src/utils/dbWrite.js` (toast แดง + คืน false) · จุด delete-then-insert ต้องหยุดก่อน insert เมื่อ delete ล้ม
2. **RLS ปฏิเสธ UPDATE/DELETE = "สำเร็จ 0 แถว ไม่มี error"** (มีแต่ INSERT ที่โยน 42501) ⇒ ปุ่มที่ผลลัพธ์สำคัญต้อง `.select('id')` แล้ว**นับแถว** ห้ามขึ้น toast เขียวจาก `!error` อย่างเดียว
3. **policy RLS ต้อง `has_perm('<คีย์เดียวกับปุ่มบนจอ>')` ห้าม hardcode role array** — role array ที่เขียนมือจะ**แคบกว่าสิทธิ์ที่ `/permissions` แจก** เสมอ ⇒ คนมีปุ่มแต่เขียนได้ 0 แถวเงียบ · **ตารางใหม่ต้องมี policy ครบทั้ง 4 cmd ที่ client ใช้ — `upsert` ต้องมี UPDATE** · 📄 5 ตารางที่เคยพลาด + migration → `docs/modules/db-write-rules.md`
4. **stale-response race** — จอที่ยิงคิวรีตาม state (เลือกกะ/วัน/ไลน์) แล้ว user สลับก่อนคำตอบเก่ากลับมา ⇒ คำตอบเก่าเขียนทับจอใหม่ (เคยเกิด: Daily Report เขียนข้อมูลผิดกะ · รอบ 3) — ทุก effect ที่ await แล้ว set state ต้องมี guard (`let alive = true` + cleanup / เทียบ request id / เทียบ ref ปัจจุบัน) ก่อน set
   · **ตัวช่วยกลาง (05/10):** `useLatestRequest()` (`src/utils/useLatestRequest.js` · เทส `latestRequest.test.mjs`) — `const live = begin()` ต้นตัวโหลด แล้ว `if (!live()) return` หลังทุก await · คำขอใหม่/unmount = คำขอเก่าหมดสิทธิ์ · `begin` identity คงที่ ใส่ deps ได้ · ใช้แล้วที่ SQDCM/WorkforceInsight/MorningMeeting/Energy/OEEAnalytics/LineOeeBoard/Dashboard/FactoryMap ทบทวน/GroupOverview
5. **`.in(ids)` ยาว = URL เกินเพดาน proxy → คืนค่าว่างเงียบ** ⇒ ผ่าน `fetchByIds` (chunk) · **เพดาน 1000 แถว/คิวรี** ⇒ ตารางที่โตได้ห้าม `select()` เปล่า ต้อง filter/paginate
6. **claim สถานะ (compare-and-swap) ก่อนเขียน ledger ⇒ ledger ล้มต้องคืนสถานะ** (กฎเหล็ก 7 ใน `docs/modules/demand-flow-tower.md`)
7. **realtime handler ต้องมี "เพดาน" ไม่ใช่ debounce · และต้องกรองว่า "เรื่องนี้ของฉันไหม"** (audit `docs/POLLING-AUDIT-2026-09-15.md` — มีตัวเลขที่วัดจริง) — `debounce(reload, 1500)` = "รอให้เงียบ 1.5 วิ" ซึ่ง**วันทำงานจริงไม่มีช่วงเงียบ** ⇒ จอโหลดใหม่ทุกครั้งที่ใครก็ตามในโรงงานแตะข้อมูล ไม่มีขีดจำกัดบน · **ใช้ `coalesce(fn, LIVE.x)` จาก `src/utils/liveRefresh.js` เท่านั้น ห้าม debounce/`setTimeout` เอง** (`setTimeout(load, 400)` ต่อ event ยิ่งแย่ — แต่ละ event ตั้งนาฬิกาของตัวเอง = N event N โหลด) · ระดับ `LIVE.ALARM/PAGE/BOARD` อยู่ใน `src/utils/refreshRates.js` ห้ามใส่ ms ดิบ · **subscribe แบบไม่มี `filter:` = ทุกเครื่องในโรงงานโหลดใหม่เมื่อไลน์ไหนก็ตามขยับ** ให้กรองฝั่ง server เสมอเมื่อรู้ขอบเขต — ⚠️ **DELETE กรองด้วยคอลัมน์ที่ไม่ใช่ pk ไม่ได้** (REPLICA IDENTITY default → `old` มีแค่ pk ⇒ event ถูกตัดทิ้งเงียบ) ให้แยก subscribe DELETE ไม่กรอง **ห้ามแก้ด้วย `REPLICA IDENTITY FULL`**
8. **จอที่มี realtime แล้ว — poll ต้องข้ามรอบเมื่อไม่มีอะไรเปลี่ยน** ใช้ `makeIdleGate(LIVE.FLOOR)` (`liveRefresh.js`): ยิงจริงเฉพาะเมื่อมี realtime event ค้าง หรือครบ hard floor 2 ชม. · handler เรียก `touch()` · ทุกตัวโหลดเรียก `loaded()` · `.subscribe(st => st === 'SUBSCRIBED' && g.touch())` (reconnect = อาจพลาด event) · **ห้ามใช้กับจอที่ไม่มี realtime** (ไม่มีใคร touch = เหลือแต่ floor = จอค้าง) — จอแบบนั้นให้**เพิ่ม realtime ก่อน** · **จอใหม่ใช้ `useLiveBoard(load, { tables, topic })` (`src/utils/useLiveBoard.js`) บรรทัดเดียวจบ ห้ามประกอบเองทีละชิ้น** (เขียนมือแล้วตกหล่นทุกครั้ง) · 📄 ตัวเลขที่วัดจริง → `docs/modules/db-write-rules.md`
9. **`useCallback`/`useEffect` ที่ยิง DB ห้ามมี object/array ใน deps** — พ่อ `setState(arr)` ใบใหม่ที่เนื้อเหมือนเดิม = ลูกยิงคิวรีซ้ำฟรีๆ (เกิดจริง: `StoreLotQueue` ยิงซ้ำวันละหลายร้อยรอบ) ให้แปลงเป็น string/primitive ก่อนเสมอ · **บั๊กคลาสนี้ build/lint/เทส/หน้าจอผ่านหมด เห็นได้จาก log เท่านั้น**
10. **สมมติฐานเรื่องสิทธิ์ที่เขียนในคอมเมนต์ "มีอายุ"** — migration ทีหลังเปิดหน้าให้ role ใหม่ได้เสมอ ห้ามพึ่ง "หน้านี้ admin-only อยู่แล้ว" เป็นด่านของแผง/ตาราง (บทเรียน cost_center_rates · wip_buffer_points · line_setup)
11. **🔴 egress คิดเป็น "ไบต์" ไม่ใช่ "จำนวน request" — `select('*')` บนตารางกว้างคือตัวกินจริง** (`mtn_orders` 116 คอลัมน์ × 1000 แถว = **1.59 MB/ครั้ง**) · **จอรายการเลือกเฉพาะคอลัมน์ที่ใช้จริง · ใบเต็มดึงตอนเปิดทีละใบ** (`.eq('id', id)`) — มีด่าน `regressionGuards` · **รูปผังห้ามเป็น PNG** ใช้ `compressLayoutImage()` (`src/utils/layoutImage.js`) = WebP 2560px **ห้ามลดความละเอียด เคยเบลอ** · 📄 ตัวเลข → `docs/modules/db-write-rules.md`

---

## ข้อ 12 — helper ที่คืนค่าเปล่า ห้ามแกะ `{ data }` (2026-10-02 · ย้ายรายละเอียดมา 10-05)

ของกลางที่โหลดทะเบียนให้ (`loadPairMap` · `loadOpInfo` · `loadProductsMaster` · `loadProductionLines`)
**คืน "ก้อนข้อมูล" ตรงๆ ไม่ได้ห่อ `{ data, error }`** ⇒ เขียน `const { data } = await loadPairMap()`
ได้ `undefined` **เงียบสนิท** (ไม่มี error ให้จับ · build/lint/เทสผ่านหมด)

**เคสจริง:** ผังรวมโรงงานโชว์ `0/0` อยู่ **7 วัน** ก่อนมีคนทัก — ไม่มีใครรู้ว่าจอตาย
เพราะหน้าจอขึ้น "ไม่มีข้อมูล" ซึ่งดูเหมือนกะที่ยังไม่เปิด

**กติกา:** รับค่าตรงๆ (`const pairMap = await loadPairMap(...)`) · มีด่านใน `regressionGuards`
🔴 **`catch {}` แล้วโชว์ "ไม่มีข้อมูล" = จอโกหก** — โหลดไม่สำเร็จต้องเขียนบนจอว่าโหลดไม่สำเร็จ
(หลักเดียวกับ §read ที่ลงแคช ข้างล่าง)

## 🔴 read ที่ลงแคช — "โหลดไม่สำเร็จ" ห้ามถูกเก็บเป็น "ไม่มีข้อมูล" (2026-10-04 · feedback หน้างาน)

กฎเหล็กข้อ 1 (`supabase-js ไม่ throw`) เขียนไว้สำหรับ **write** — ฝั่ง **read ที่ผลลัพธ์ลง
`cachedMaster`** ไม่เคยมีใครคุม จึง drift ไป **11 จุด** แล้วระเบิดที่หน้างาน

### เคสจริง 30/09 — คุณนพดล พงษ์ก๋าแก้ว (supervisor PD1 · `/daily-report`)

> *"จะเปิดผลิตงาน 068 แต่ในรายการผลิตไลน์ 250T ไม่มีรายการให้เลือก
> **ลองเอา User คนอื่นเข้าเปิด มีรายการให้เปิด**"*

ตรวจข้อมูลจริงแล้ว **ปกติทุกอย่าง** — MAT `20063134` ผูก `LINE C ( 200&250 Ton )` ·
`is_active` · มี `kanban_standards` ตั้งแต่ 4 ส.ค. · สิทธิ์เขา (PD1) ครอบคลุมไลน์นั้น ·
วันนั้นเขาเปิด-ปิดกะบนไลน์นี้ได้ทั้ง 2 กะ

**ลูกโซ่:**
```
(await supabaseDR.from('kanban_standards').select(…)).data || []
         ↑ คิวรีล้ม (เน็ตสะดุด/timeout/RLS) → data = null → || [] → ได้ []
cachedMaster เห็นเป็น "สำเร็จ ได้ 0 แถว" → lsWrite([]) ทับของดีใน localStorage
                                          → เครื่องนั้นเห็นลิสต์ว่างต่ออีก 4 ชม. (MASTER_TTL)
                                          → ไม่มีข้อความอะไรบนจอเลย
```
เครื่องอื่นที่โหลดติด จึงเห็นครบ ⇒ **"ผมไม่เห็น แต่ User คนอื่นเห็น"** ตรงเป๊ะ

### กติกาตั้งแต่ 2026-10-04

1. **loader ของ `cachedMaster` ต้องห่อด้วย `mrows(await …)`** (`src/utils/masterCache.js`)
   **ห้าม `.data || []`** — มีด่าน `master-cache-swallow`
2. **`mrows` มีข้อยกเว้นเดียว = `42P01`/`42703`** (ตาราง/คอลัมน์ยังไม่ apply migration) → คืน `[]`
   ตามเดิม · ที่เหลือ **โยน `MasterLoadError`** · เขียนไว้เพราะหลาย picker *ตั้งใจ* ถอยไปโหมด
   "พิมพ์เองพร้อมป้าย" เมื่อตารางยังไม่มี — **ห้ามเปลี่ยนพฤติกรรมนั้น**
3. **ล้มเหลว = ไม่ `lsWrite` · `at: 0` (รอบหน้ายิงใหม่ทันที) · คืนของเก่าแม้หมด TTL** (`lsAny`)
   — ของเก่าเกิน 4 ชม. ยังดีกว่าลิสต์ว่าง · **คืน `?? []` เสมอ ห้าม `undefined`** (ผู้เรียก `.map()` ต่อ)
4. **ล้มเหลวต้องเห็นบนจอ** — `onMasterLoadFail()` ผูก toast ใน `main.jsx` (รวบ 1 ข้อความ/10 วิ ·
   โหลดทะเบียน 7 ตัวพร้อมกันตอนเน็ตหลุด = 7 toast ซ้อน)

### ของที่แก้ไปแล้ว (11 + 5 จุด)

`DailyReport` (7) · `QAInspectionSetup` · `HeijunkaKanban` · `PmCoordination` · `PlannerSales`
· `useCostCenters` · `useDiePressLines` · `useStorageLocations` · `useSuppliers` · `useColumnHistory`

---

## § ส่ง SQL ให้ user รันเอง — เคสที่เคยพลาด (ย้ายมาจาก CLAUDE.md 2026-10-05 ตามกฎรับเข้า)

กฎย่ออยู่ใน CLAUDE.md แล้ว (วาง SQL เต็มๆ · ระบุ project · แนบคิวรีเช็คผล) — ที่นี่เก็บ**ว่าทำไม**:

**user รันผ่าน Supabase SQL Editor บนเว็บเท่านั้น — ไม่มี CLI/terminal และเปิดไฟล์ในรีโปไม่ได้**

| เคยเกิดจริง | ผล |
|---|---|
| บอกแค่ชื่อไฟล์ migration ไป | user ก๊อป **path** ไปวางใน SQL Editor → `42601 syntax error at or near "supabase"` |
| ส่งคำสั่ง CLI ให้ (07/09) | user ก๊อป `supabase functions deploy` ไปวางใน **SQL Editor** |
| คิวรีเช็ค NPI (ตาราง Main) ถูกรันบน "Product DB" (07/09) | `42P01 relation does not exist` ทั้งที่ migration ลง MAIN สำเร็จแล้ว ⇒ ต้องบอก**ทั้งชื่อในจอและ project id** |

⇒ ให้ user ทำเฉพาะสิ่งที่ทำได้จากเว็บ: **SQL Editor · secrets ใน dashboard · เมนูในแอป**
· migration ที่ย้อนได้ + edge function → **AI session ลงเองผ่าน MCP แล้วคิวรีตรวจกลับ** (`docs/modules/edge-functions.md`)

### 🔴 ขอบเขตของ MCP Supabase — รู้ไว้ก่อนเขียน migration (วัดจริง 2026-10-09)

| สิ่งที่สั่ง | ผล |
|---|---|
| `select` / `insert` / `update` (DML) ก้อนใหญ่หลาย statement | ✅ ผ่าน |
| DDL **statement เดียว** (`create policy`, `alter table`) | ✅ ผ่าน |
| DDL **หลาย statement ในก้อนเดียว** | ❌ ค้างจน timeout 60s |
| คำสั่งที่ถูกตีว่า "ทำลาย" — **`drop policy` / `drop table` / `drop column` / `delete` ไม่มี where** | ❌ ค้าง (รอ user ยืนยันซึ่งไม่มีทางมาถึง session) |

**ค้าง ≠ ลงไปครึ่งๆ** — ทุกครั้งที่ timeout ก้อนถูก rollback สะอาด (วัดด้วยคิวรีตรวจกลับทั้ง 3 รอบ)
และ**ไม่ใช่ lock contention** (`pg_stat_activity … wait_event_type='Lock'` = 0) ⇒ **ห้ามสรุปว่าลงแล้ว
ห้ามสั่งซ้ำมั่ว — timeout แล้วให้คิวรีถามสถานะจริงก่อนทุกครั้ง**

**ยืนยันซ้ำกับ `alter table … drop column` (12/10 · `scrap_report_items.image_path`)** — ลอง 4 ครั้ง
ค้าง 60 วิแล้ว rollback ทุกครั้ง · พิสูจน์ว่า**ไม่ใช่ statement ช้าและไม่ใช่การรอ lock**: ตั้ง
`lock_timeout='3s'` + `statement_timeout='10s'` แล้ว**ยังค้าง 60 วิ** (ถ้า statement ทำงานจริงต้องถูกฆ่าที่ 10 วิ)
· ไม่มี view/rule depend · ไม่มี transaction อื่นค้าง · `add column`/`comment on column` บนตารางเดียวกันผ่านฉลุย
⇒ 🔴 **เจอกลุ่มนี้อย่าลองซ้ำให้เสียเวลา — วาง SQL ให้ user รันใน SQL Editor พร้อมคิวรีเช็คผลทันที**
(เคสนี้ user รันแล้วเช็คกลับได้ 0 ภายในนาทีเดียว เร็วกว่าที่ AI session ลองเองไป 4 รอบ)

⇒ **วิธีเขียน migration ให้ AI session ลงเองได้:** แยกเป็นก้อน DML + DDL ทีละ statement ·
ส่วนที่ต้อง `drop` **แยกออกมาเป็นบรรทัดเดียวให้ user รัน** พร้อมคิวรีตรวจกลับ
· 💡 `create policy` ตัวใหม่ก่อนแล้วค่อย `drop` ตัวเก่า = ปลอดภัยกว่า **เพราะ policy ของ cmd
เดียวกันถูก OR กัน** ⇒ ช่วงที่มี 2 ตัวพร้อมกัน สิทธิ์ไม่เคยแคบลง ไม่มีช่วงที่ "เขียนไม่ได้เลย"
(ถ้า `drop` ก่อน แล้ว `create` ค้าง = ตารางไม่มี policy เขียน = ทั้งระบบเขียนตารางนั้นไม่ได้)

---

## 🔢 `checkWriteRows()` — นับแถวจริง ไม่ใช่แค่เช็ค error (2026-10-06 · QC audit)

**ปัญหาที่เจอ:** กฎข้อ 2 บอกไว้ตั้งแต่ต้นว่า RLS ที่ปฏิเสธ UPDATE/DELETE คืน "0 แถว ไม่มี error"
⇒ ปุ่มที่ผลลัพธ์สำคัญต้องนับแถว แต่ **ไม่มีของกลางให้ใช้** ⇒ แต่ละคนเขียนเอง แล้วคลาดกันคนละแบบ

**วัด 06/10:** `checkWrite(…)` ห่อ UPDATE/DELETE อยู่ **61 จุด** · ในนั้น **7 จุด** ต่อ `.select('id')`
ไว้แล้ว (= ตั้งใจนับแถว) แต่ส่งผลเข้า `checkWrite` ซึ่ง **ไม่เคยอ่าน `data`**
⇒ `.select('id')` นั้นเสียเปล่า และ **ผู้เขียนเชื่อว่าตัวเองกันบั๊กคลาสนี้แล้ว** — อันตรายกว่าไม่เช็คเลย
เพราะไม่มีใครกลับมาดูอีก

7 จุดนั้น: `OrgAssignmentsPanel` ×3 (Main) · `QaCheckSheet` ×2 (Main) · `CtReview` ×2 (DR)

**ของกลางใหม่** `checkWriteRows(res, label, { min = 1, zeroMsg })` ใน `src/utils/dbWrite.js`
· 0 แถว = toast แดงบอกว่า "ระบบไม่ได้แก้แถวไหนเลย" + ชี้สาเหตุที่พบบ่อย (สิทธิ์ / แถวถูกลบไปแล้ว)
· `zeroMsg` = ข้อความเจาะจงเมื่อรู้สาเหตุ (เช่น `ไม่พบสินค้า <MAT> ใน Product Master`)
· ไม่ได้ต่อ `.select()` = `console.warn` แล้วถอยไปเช็คแค่ error (**ห้ามทำปุ่มพังเพราะเรื่องนี้**)

**2 ด่านคู่กัน** (`regressionGuards`):
| ด่าน | จับอะไร |
|---|---|
| `checkwrite-rows-not-plain` | ต่อ `.select()` แล้วส่งเข้า `checkWrite` (เจตนานับแถว แต่ไม่ได้นับ) |
| `checkwriterows-needs-select` | เรียก `checkWriteRows` โดยไม่ต่อ `.select()` |

🔴 **ด่านที่ 2 ตรวจได้เฉพาะคิวรีที่เป็น chain ในวงเล็บเดียวกัน** (`.from(` อยู่ใน argument) —
ที่เก็บผลใส่ตัวแปรก่อน (`const res = await …; checkWriteRows(res, …)`) มองไม่เห็น `.select()`
⇒ ข้ามไป ดีกว่าได้ false positive (เจอทันทีที่เขียนด่าน: `CapacityBoard` ต่อ `.select('key')` ไว้แล้ว)

### ✅ ไล่ครบแล้ว 2026-10-12 — 49 จุด ⇒ แปลง 40 · ตั้งใจไม่แปลง 8 (+1 ตัวอย่างในคอมเมนต์ `dbWrite.js`)

**ไม่แปลงเหมา** — เกณฑ์ตัดสินรายจุดคือ *"0 แถว แปลว่าอะไร"*:
- **แปลง** เมื่อ 0 แถว = งานที่คนกดไม่เกิดขึ้นจริง และจอ/ขั้นถัดไปเดินต่อเหมือนสำเร็จ
  (แก้แถวที่เพิ่งอ่านมาด้วย `.eq('id', …)` · ผูกของที่เพิ่ง insert กลับเข้าพ่อแม่ · ปุ่ม toggle · ลบของบนผัง)
- **ไม่แปลง** เมื่อ 0 แถว = เรื่องปกติของข้อมูล ⇒ นับแถวจะกลายเป็น **toast แดงหลอกหน้างาน**

**8 จุดที่ตั้งใจไม่แปลง (มีคอมเมนต์กำกับในโค้ดทุกจุด — ห้ามแปลงทีหลังโดยไม่อ่าน):**

| จุด | ทำไม 0 แถวถึงปกติ |
|---|---|
| `App.markAllRead` / `markOne` (notifications) | "อ่านแล้ว" เป็นสถานะส่วนตัว โหลดใหม่ก็เห็นของจริง · `markAllRead` เป็น `.in()` หลายแถว = สำเร็จบางส่วนได้ (นับแถวบอกไม่ได้ว่าใบไหนพลาด) |
| `LineSetup` ปลดพนักงานออกจากไลน์ที่ลบ | ไลน์ที่ไม่มีพนักงานผูกอยู่เลยมีจริง |
| `LineSetup` ล้างทักษะของจุดงานที่ลบ | จุดงานที่ยังไม่ตั้งทักษะมีจริง (ตัวที่นับแถวคือการลบจุดงานเอง — ทำไว้แล้ว) |
| `PlannerSales` → `kanban_standards.p_no` | พาร์ทที่ไม่มีแถว kanban มีจริง (write-through best-effort) |
| `PlannerSales` → `customer_forecasts` re-point | ยังไม่มี forecast ของเลขลูกค้านั้นก็ได้ |
| `ProductMaster` sync รูปให้ variant (`.eq('name')`) | พาร์ทที่ไม่มี variant ชื่อเดียวกันมีจริง |
| `MtnRepair` ล้างค่าแรงเดิมของใบ | บันทึกครั้งแรกยังไม่มีค่าแรงเดิม (ที่ต้องกันคือ error → ห้าม insert ต่อ ⇒ `delOk`) |

**กลุ่มที่แปลงแล้วและ "แพงที่สุดถ้าพลาด"** (เหตุผลเขียนไว้ที่โค้ดแต่ละจุด):
- `DailyReport` ผูกคู่ RH/LH 5 จุด — ไม่ผูก = เวลามาตรฐานของ %P **เบิ้ล** (กฎ "ชิ้น ≠ shot")
- `DailyReport` ปิดใบต้นทางเป็น `imported` 3 จุด — ไม่ปิด = ยกยอดซ้ำรอบหน้า = **เป้านับซ้ำ**
- `DailyReport` เวลาเริ่ม/ปิดต่อ MAT 4 จุด — ฐานเวลาของ %A/%P ที่กำลัง stamp ลงกะ
- `DailyReport` + `ProductMaster` ปิดสินค้าเลขเดิมตอน EC — ไม่ปิด = **2 เลข active พร้อมกัน**
- `QaClaims`/`QaCheckSheet` ผูก CAPA/NCR/ถังแดงกลับเข้าใบ — ของถูกสร้างแล้ว ผูกไม่ติด = ใบกำพร้า
- `MtnRepair` ยอดรวมค่าแรง · `RoutingPanel` สลับลำดับขั้น (ค้างที่ `seq` ติดลบ) ·
  `TransportMapEditor` ตัดถนน (ลบไม่สำเร็จแล้ว insert ต่อ = ถนนทับกัน 3 เส้น → เปลี่ยนเป็น `return null`)

🔑 **ใช้ `min` ให้ตรงความหมาย ไม่ใช่ default 1 เสมอ** — `BbsCheck` ปิดข้อตกลงที่เอาออก ใช้ `{ min: gone.length }`
(ปิดไม่ครบ = ข้อกลับมาโผล่ในใบรอบหน้า) · `LineSetup` ปลดไลน์ลูกใช้ `{ min: childCount }` ·
`QAInspectionSetup` ถอดตำแหน่ง balloon ใช้ `{ min: cnt }`

## 🔎 2 คลาสที่ "ด่านเดิมจับไม่ได้" — อุดแล้ว 2026-10-06 (QC audit)

### 1. `write-result-discarded` — write ที่ซ่อนหลัง `if (…)` / ใน one-liner
ด่านเดิมจับเฉพาะรูป `^\s*await supabase…` (ต้นบรรทัดล้วน) ⇒ รูปพวกนี้ลอดมาได้ทั้งหมด:
```js
if (oldIds.length) await supabaseDR.from('part_routings').update(…);          // หลัง if
else if (!m.plan_end && …) await supabase.from('npi_tooling_plans').update(…); // หลัง else if
const delLink = async (it) => { if (!confirm(…)) return; await supabaseDR…;  }; // one-liner
```
**วิธีตัดสินของด่านใหม่: ดูตัวอักษรที่ไม่ใช่ช่องว่าง "ตัวสุดท้ายก่อน `await`"**
`{` `;` `}` `)` หรือคำ `else` ⇒ ตำแหน่ง statement = **ผลถูกทิ้ง** ·
`=` `(` `?` `:` `,` `[` `>` / คำ `return` ⇒ ผลถูกรับไว้แล้ว
(🔴 ห้ามกลับไปใช้วิธี strip วงเล็บ — วงเล็บซ้อน + template literal ภาษาไทยทำ regex พลาดเงียบ:
`if (!window.confirm(\`ลบ ${'${x}'}?\`))` ทำให้ `\([^()]*\)` ไม่แมตช์ แล้วจุดนั้นหลุดด่าน)
· ข้อยกเว้นที่ถูกต้อง = ต่อ `.then(ok, err)` (best-effort ที่ตั้งใจ ไม่ใช่กลืนเงียบ)

**7 จุดที่เจอ/แก้แล้ว** — ที่หนักสุด:
| จุด | ผลที่เกิด |
|---|---|
| `PeRoutingSuggest` เส้นทาง rollback | ขึ้น toast "คืนชุดเดิมให้แล้ว" โดยไม่เคยเช็ค ⇒ คืนล้ม = **ข้อความยืนยันเท็จ** ทั้งที่ routing ของพาร์ทนั้นหายทั้งชุด |
| `ProductMaster.delLink` / `delMaster` | ปุ่มลบจริง · RLS ปฏิเสธ = 0 แถว ไม่มี error ⇒ แถวเดิมวาดกลับมา ไม่มีอะไรบอกว่าทำไม ⇒ กดซ้ำ/คิดว่าจอค้าง |
| `RoutingPanel` เรียง `seq` หลังลบ | ล้มเงียบ ⇒ เลขกระโดด/ซ้ำ แล้วไปชน `unique (mat_no, seq)` ครั้งถัดไปแบบงงๆ |
| `Energy` ล้างค่าในช่องตาราง | `load()` วาดค่าเดิมกลับมาเงียบ |
| `NpiTooling` เติมวันจบแผน | แผน tooling ไม่มีวันจบ ⇒ ไฟสี/สรุป NPI คิดจากข้อมูลไม่ครบ |
| `ProductMaster` เติมรูปให้ `dr_products` | รูปไม่ขึ้นบนจอที่อ่าน `dr_products` โดยไม่มีร่องรอย |

### 2. `backdrop-close-form-modal` — modal ที่ปิดด้วย `setX(null)`
ด่าน `modal-closes-on-backdrop` เดิมจับเฉพาะ `onClick={onClose}` ⇒ รูป
`onClick={() => setXxx(null)}` ลอดมาได้ · เจอจริงที่ `DailyReport` modal "📞 เรียกช่างด่วน"
ที่มีปุ่มเลือกทีมช่าง + `<input type="file" capture>` ⇒ เผลอแตะนอกกรอบบนแท็บเล็ตหน้าไลน์
= ทีมที่เลือก + **รูปที่ถ่ายไว้หายหมด** ต้องถ่ายใหม่

🔴 **ด่านใหม่ไม่มี allow list โดยเจตนา — ดูเนื้อในจริงว่ามีช่องกรอกไหม**
ขอบเขต overlay หาจาก `</div>` ตัวแรกที่ย่อหน้า ≤ บรรทัดเปิด (JSX ในรีโปนี้ย่อหน้าสม่ำเสมอ)
วัดจริง 06/10: 18 overlay ที่ใช้รูปนี้ — **17 ตัวเป็น popup ดูอย่างเดียว** (zoom รูป/กราฟ/drill/
ประวัติ) ซึ่ง UI §5 อนุญาตให้ปิดจาก backdrop อยู่แล้ว ⇒ ถ้าใช้ allow list ต้องเขียน 17 รายการ
ที่ไม่ได้บอกอะไร แล้วตัวที่ 18 ที่มีฟอร์มจริงก็ยังหลุดได้อยู่ดี
⚠️ **window แบบนับบรรทัดตายตัวใช้ไม่ได้** — ลองแล้วล้นไปโมดัลถัดไป (FactoryMap `storeZoneModal`
จบบรรทัด 3564 แต่ `<select>` ที่เจอเป็นของโมดัล `assignFor` ที่เริ่ม 3567 = false positive)

---

## 🔎 รอบกวาด "ล้มเงียบ" ทั้งรีโป (2026-10-13 · user: *"ไล่เช็คอีกทีว่ามีจุดอื่นที่ล้มเงียบแบบนี้อยู่ไหม"*)

### สิ่งที่วัดได้ (ตัวสแกนไล่ทุกคำสั่งที่แตะ supabase ทั้งรีโป ไม่ใช่ grep บรรทัดเดียว)

| คลาส | ทั้งหมด | มีตัวเช็ค | ไม่มี |
|---|---|---|---|
| คำสั่ง **เขียน** (insert/update/upsert/delete) | **642** | 642 — อ่าน error 464 · `checkWriteRows` 53 · `checkWrite` 36 · เช็คผ่านตัวแปรผล 53 | **0** |
| คำสั่ง **อ่าน** (select) | **1047** | 874 (83%) | 173 กลืน error |
| `catch {}` ว่าง | 8 | — | 5 เป็น exceljs/jsPDF (ไม่ใช่ DB) · 3 เป็นคอมเมนต์ของบั๊กที่แก้แล้ว |

**ฝั่งเขียนปิดครบแล้วจริง** — 34 จุดที่ตัวสแกนสงสัยไล่ดูด้วยตาทุกจุด มีตัวเช็คหมด
(ส่วนใหญ่เป็น ternary `แก้ : เพิ่ม` ที่ `checkWrite(...)` ห่ออยู่ชั้นนอก ⇒ regex 3 บรรทัดมองไม่เห็น)

### 🔴 คลาสใหม่ที่เจอ — **"อ่านไม่ได้" แล้วเอาไปตัดสินใจเขียน/ลบ (fail-open)**

173 จุดที่กลืน error ส่วนใหญ่เป็นจอที่แค่โชว์ว่าง — คัดเฉพาะที่**ผลการอ่านถูกใช้ตัดสินใจเขียน/ลบ**
(ตัวที่ทำข้อมูลเสีย ไม่ใช่แค่จอว่าง) เหลือ 7 → เป็นของจริง 5:

| จุด | อ่านล้มแล้วเกิดอะไร | แก้เป็น |
|---|---|---|
| `LineSetup.jsx` ลบไลน์ + ลบรูปผัง (2 จุด) | `{ data: sharers }` ล้ม = `undefined` ⇒ `!undefined?.length` เป็น **true** ⇒ **ลบไฟล์ผังที่ไลน์อื่นยืมใช้ ถาวร** (ไลน์แม่-ลูกยืมผัง URL เดียวกันเป็นเรื่องปกติ ⇒ ผังหายทั้งตระกูล) | นับไม่ได้ = **ไม่ลบ** + toast บอก (fail-closed · ต้นแบบ `orgNodeRefs.js`) |
| `Management.jsx` ใบ 4M Man อัตโนมัติ | `{ data: dup }` ล้ม ⇒ "ยังไม่มีใบ" ⇒ สร้างซ้ำทุกครั้งที่ย้ายจุดคนเดิม (ขัดกฎ "ตัวสร้างอัตโนมัติต้องกันใบซ้ำ") | เช็คซ้ำไม่ได้ = **ไม่สร้างใบ** + toast |
| `CustomerDemand.jsx` คัดลอกค่ามาตรฐาน | ล้มแล้วจอขึ้น "ยังไม่มีค่ามาตรฐานให้คัดลอก" = **จอโกหก** คนไปตั้งใหม่ทั้งชุด | แยก error ออกจาก "ว่างจริง" |
| `ProductMaster.jsx` EC → `parts_master` | `{ data }` ของเลขเดิมล้ม ⇒ `oldPm = null` เงียบ ⇒ MAT ใหม่ไม่สืบทอด uom/กล่อง/supplier **และแถวเลขเดิมไม่ถูกติดโน้ต EC** = บั๊กที่วัดเจอ 05/10 กลับมาเป๊ะ | ธง `oldPmUnread` + toast บอกให้ไปทำมือ |

### ✅ 5 จุดที่ดูเหมือนบั๊ก แต่เช็คกับ RLS/ดัชนีจริงแล้ว **ไม่ใช่** (บันทึกไว้กันคนมาแก้ซ้ำ)

| จุด | ทำไมไม่ใช่ |
|---|---|
| `MonitoringUpload.jsx` ลบ forecast/ออเดอร์ก่อน insert ใหม่ | RLS ของ `customer_forecasts` + `customer_shipping_orders` = **`ALL / public / true`** ⇒ DELETE ถูกปฏิเสธเงียบไม่ได้ · และ delete ล้ม → `ok=false` → ไม่ insert ต่อ |
| `LineSetup.jsx:446` ลบไลน์ไม่นับแถว | policy = `has_perm('line_setup:delete') OR has_perm('line_setup:edit')` และปุ่มเปิดด้วย `canDel` (fallback = edit) ⇒ คนที่เห็นปุ่มผ่าน policy เสมอ |
| `QAInspectionSetup.jsx` ป้าย balloon (2 จุด) | ทั้งการลากและปุ่มคืนค่าถูกปิดด้วย `canManage` ⇒ คนไม่มี `qa:manage` กดไม่ถึง |
| `LineStock.jsx` กันรอบจัดส่งซ้ำ | unique index `(line_name, shift, round_no)` ⇒ ซ้ำแล้วได้ `23505` ซึ่งโค้ดโชว์ให้ |
| `ProductMaster.jsx` เช็ค `exist` ก่อน insert | `parts_master.mat_no` เป็น unique ⇒ ซ้ำแล้ว error เด้ง ไม่เงียบ |

> 🔴 **บทเรียน: "0 แถวเงียบได้ไหม" ตอบจาก RLS/ดัชนี ไม่ใช่จากหน้าตาโค้ด**
> 4 ใน 9 จุดที่สแกนชี้ หายไปเมื่อเปิด `pg_policies` + `pg_index` ดูของจริง — เขียนด่าน/แก้โค้ดจากหน้าตาโค้ดล้วน
> = เสียเวลาแก้ของที่ไม่พัง และทำให้ toast แดงโผล่ในเคสปกติ (ซึ่งแย่กว่าไม่เช็ค)

### 🔴 ทะเบียนของ picker — ลิสต์ว่าง 2 ความหมาย (13 hook)

`useCustomers` `useSuppliers` `useProductionLines` `useStorageLocations` `useDiePressLines` `useChildParts`
`useInstruments` `useDieSetKinds` `useCostCenters` `usePartOptions` `useColumnHistory` `useOrgScope` `useOrgDepts`

เดิมทุกตัวลงท้าย `.catch(() => {})` แล้วคืน `[]` ⇒ หน้างานเปิดช่องเลือกเห็นว่าง → สรุปว่า
"ยังไม่ได้ลงทะเบียน" → ไปสร้างซ้ำ · `useProductionLines` เป็นตัวอ่านทะเบียนไลน์ตัวเดียวที่อนุญาต
⇒ ล้มทีเดียว dropdown ไลน์ว่างทั้งแอปโดยจอไม่บอกเหตุ

**สิ่งที่มีอยู่แล้วก่อนรอบนี้ (อย่าทำซ้ำ):** `cachedMaster` กลืน error เป็นของเดิม + ตั้ง `at:0` ให้ยิงใหม่
+ ยิง `failSink` → **`main.jsx` ขึ้น toast แดงรวบ 1 ข้อความ/10 วิ** ⇒ "มีอะไรล้ม" ระดับแอป **มีคนบอกแล้ว**

**ช่องว่างที่เหลือจริง 3 อย่าง — รอบนี้แก้:**
1. **`usePartOptions`** — `return { sets: a.data || [], qaParts: b.data || [] }` อยู่บรรทัดที่ 6 ของ loader
   ⇒ หลบด่าน `master-cache-swallow` (เดิมดู 2 บรรทัด) ⇒ `cachedMaster` **ไม่เห็น error** ⇒ toast กลางไม่ขึ้น
   = เงียบสนิท + ลิสต์ว่างถูก cache 4 ชม. → แก้เป็น `mrows()` + **ขยายด่านเป็น 500 ตัวอักษร
   แต่หยุดเมื่อเจอ `throw`/`mrows`/ปลาย loader** (ไม่งั้น `useProducts`/`useMachines`/`usePeople`/`partImages`
   ที่ `throw` ไว้ก่อนแล้วถูกจับผิด = ด่านที่ false positive = ด่านที่คนอยากปิด)
2. **`useOrgScope` + `useOrgDepts`** — ไม่ผ่าน `cachedMaster` โดยตั้งใจ (ผังแก้ที่ `/org-setup` ต้องเห็นทันที
   ไม่รอ TTL 4 ชม.) ⇒ **toast กลางไม่ครอบมาถึง** และ `setNodes(error ? [] : …)` อ่าน error แล้วโยนทิ้ง
   ⇒ `ready` เป็น true ด้วย ⇒ จอ OBEYA/KPI สรุปว่า "ผังมีแค่นี้" → คืน `failed` ให้จอเขียนบอก
3. **toast ผ่านไปแล้วหาย และไม่บอกว่า*ช่องที่กำลังเพ่งอยู่*คือช่องที่ล้ม** → `useMasterRows` + `loadFail`

**ของกลางใหม่:** `src/utils/useMasterRows.js` → `{ rows, failed, stale, message, loading, reload }`
อ่านผลล้มจากทะเบียนต่อคีย์ (`masterLoadState(key)` ใน `masterCache.js`) เพราะ **`cachedMaster` ไม่ throw**
⇒ รอ `catch` = ไม่มีวันรู้ · `stale: true` = "มีของ แต่เป็นของเก่าที่เก็บไว้"
**hook ทุกตัวคง default export เดิม (คืนแถวล้วน)** ⇒ จุดเรียกเดิม 100+ จุดไม่ต้องแก้ · ช่องเลือกใช้ `use*State()`

**ด่านใหม่:** `registry-loader-no-silent-catch` — `scan: ['src/utils']` จับ `loadXxx()….catch(() => {})`
⚠️ **ตั้งใจไม่ทำทั้งรีโป** — นอก `src/utils` มีอีก 9 จุด (`loadPmTeams` 5 หน้า · `loadProfilesPeople`
· `loadProcessTypes` · `loadCompanyCalendar`) ที่ยังไม่ได้แก้ ⇒ ทำทั้งรีโปต้องใส่ `allow` 9 รายการ
= ด่านที่มีข้อยกเว้นเยอะจนคนอยากปิด · **งานค้าง: ไล่ 9 จุดนั้นแล้วขยายด่านเป็น `src`**

---

## 🗑️ ด่านนับปลายทางก่อนลบ "ทะเบียนที่จับคู่ด้วยข้อความ" — ปิดครบ 7/7 (2026-10-18)

`src/components/SimpleMasterPanel.jsx` มี prop `onBeforeDelete` (fail-closed) มาตั้งแต่ 06/10
แต่ไล่ดู 18/10 แล้วพบว่า **ใช้จริงแค่ `cost_centers` ตัวเดียว** — อีก 6 ทะเบียนกดลบได้ทันที
โดยไม่เคยนับปลายทางเลย ทั้งที่ปลายทางเก็บเป็น **text ไม่ผูก FK** ⇒ ลบแล้วไม่มีใครเตือน

ของใหม่: **`src/utils/masterRefs.js`** (`MASTER_REF_SPECS` · `loadMasterRefs` ·
`masterBlockMessage` · `masterDeleteGuard`) + ด่าน `regressionGuards` ข้อ
"🗑️ ทะเบียนข้อความ (SimpleMasterPanel) ต้องส่ง onBeforeDelete"

| ทะเบียน (DR) | จอ | จับคู่ด้วย | ปลายทางที่นับ (วัด 18/10) |
|---|---|---|---|
| `customers` | `/products?tab=customers` | code · name · **ทุก alias** | prod_orders **1,974** · mtn_orders 600 · dr_products 378 · kanban_calc_params 153 · ship_to_plants 18 · monitor_boards 4 · customer_forecasts 2 |
| `suppliers` | `/products?tab=suppliers` | code · name | purchase_requests **16,552** · bom_items 1,052 · parts_master 516 · mtn_spare_parts 118 · part_routings 2 · container_types 0 |
| `die_press_lines` | `/equipment?tab=die` | code · name | machines (`equipment_kind='die'`) **268** · die_sets 96 |
| `die_op_types` | `/equipment?tab=die` | **`key` เท่านั้น** | equipment_die 186 |
| `die_set_kinds` | `/equipment?tab=die` | **`key` เท่านั้น** | die_sets 2 |
| `repair_wi_registry` | `/qa` แท็บถังแดง | **substring ของ `wi_no` ทุกเล่ม** | defect_logs.fix_action 0 · downtime_logs.fix_action 0 |
| `cost_centers` (Main) | `/mtn-analysis` แผงเรต | code | — (`utils/costCenterRefs.js` ตัวเดิม ไม่แตะ) |

### 🔴 วิธีวัด และ **ทำไมผลสแกนดิบใช้ตรงๆ ไม่ได้**

วัดด้วยการไล่ **ทุกคอลัมน์ text ของทุกตารางใน schema `public` ฝั่ง DR (147 ตาราง ·
1,020 คอลัมน์)** แล้วนับแถวที่ค่าเท่ากับคีย์ของทะเบียนพอดี (`to_jsonb(row)` +
`jsonb_each_text` join ชุดคีย์ — สแกนตารางละรอบเดียว) **ห้ามเขียนลิสต์จากความจำ**
(กฎเดียวกับ `orgNodeRefs.js`) · ⚠️ MCP timeout 60 วิ ⇒ ต้องแบ่งก้อนเรียงตามจำนวนแถว
และตารางกว้าง-ยาว (`prod_orders` 21k) ต้องสแกนด้วยลิสต์คอลัมน์ตรงๆ แทน `to_jsonb`

**แต่ทะเบียนหลายตัวพูดภาษาเดียวกัน** ⇒ สแกนดิบให้ false positive เป็นพัน:

| ที่สแกนเจอ | ทำไม**ไม่**นับ |
|---|---|
| production_sessions.line_name 586 · stock_receipts.source_line 758 · line_stock_transactions 623 · pm_daily_alerts 216 · mtn_orders.line_name 186 · purchase_requests.dest_line 106 … | เป็น **ชื่อไลน์ผลิต** (`production_lines`) ที่ชนกับชื่อกลุ่มเครื่องปั๊ม ไม่ใช่การอ้างทะเบียนนี้ |
| machines.line_name 438 (ทั้งตาราง) | กรองเหลือ `equipment_kind='die'` → 268 · วัดแล้ว die **268/268 = 100%** ถือชื่อจากทะเบียนนี้ · machine 78/270 · jig 23/184 = ไลน์ผลิตชนชื่อ |
| purchase_requests.supplier แมตช์ `customers.code` 1,342 · parts_master.supplier 50 · bom_items.supplier 54 | บริษัทเดียวเป็นได้ทั้งลูกค้าและผู้ขาย ⇒ ช่อง supplier **นับให้ `suppliers` เท่านั้น** (และกลับกัน dr_products.customer ไม่นับให้ suppliers) |
| monitoring_shipments.sheet **1,231** | เป็น **ชื่อชีทบอร์ด** ที่ตั้งตามลูกค้า ไม่ใช่ช่องอ้างลูกค้า |
| mtn_orders.problem_characteristic 328 · problem_group 12 · dr_defect_types.name_th · improvements.problem_label · jig_checkpoints.group_name · fixture_point_kinds.* | ชนกับ **`label`** ของ `die_op_types`/`die_set_kinds` ซึ่งเป็นคำไทยกลาง ("อื่นๆ" ฯลฯ) ⇒ 2 ทะเบียนนี้จับคู่ด้วย **`key` เท่านั้น** (มีด่าน) |
| `audit_log` 69k แถว | ประวัติ ไม่ใช่การอ้างอิงที่ยังมีผล — ลบทะเบียนไม่ทำให้ประวัติผิด |

### 🔴 `repair_wi_registry` — ปลายทางเป็น "ข้อความในใบ" ไม่ใช่คอลัมน์อ้างอิง

สแกนทั้งฐานแล้ว **ไม่มีคอลัมน์ไหนเก็บเลข WI เลย (0)** เพราะชิปใน `ProblemFixModal`
เติมเป็นประโยค `"ซ่อมตาม WI-PD3-018"` ลงใน `fix_action` ของ `defect_logs`/`downtime_logs`
⇒ ต้องนับแบบ **substring** และ `wi_no` ใส่หลายเล่มคั่น `,` ได้ ⇒ `splitWiNos()` แยกก่อนค้นทุกเล่ม
· วัด 18/10 ยังไม่มีใครใช้ชิปนี้ (ทุกเล่ม 0) — ด่านจึงยังไม่เคยบล็อกจริง **แต่ต้องมีไว้ก่อน**
เพราะวันที่มีคนใช้แล้วมาลบทะเบียน จะไม่มีใครรู้ว่าใบไหนอ้างเล่มที่หายไป

### กติกาสำหรับทะเบียนใหม่

1. เพิ่ม spec ใน `MASTER_REF_SPECS` โดย**วัดปลายทางจากฐานจริง** (วิธีข้างบน) ห้ามเขียนจากความจำ
2. ส่ง `onBeforeDelete={masterDeleteGuard(supabaseDR, '<ทะเบียน>')}` ที่แผง (ด่าน build เช็คให้)
3. ชื่อที่โชว์ในข้อความอยู่คอลัมน์อื่น → ส่ง `nameOf` เป็นอาร์กิวเมนต์ที่ 3 (เช่น `r => r?.label`)
4. **นับไม่ได้ = `partial: true` ห้ามตอบ 0** · `42P01`/`42703` = ปลายทางยังไม่ apply migration ⇒ นับ 0 ได้จริง
