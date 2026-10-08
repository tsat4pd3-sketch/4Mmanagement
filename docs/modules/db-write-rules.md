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

**ยังเหลือ 54 จุด** ที่ `checkWrite` ห่อ UPDATE/DELETE โดยไม่นับแถว — **ไม่แปลงเหมาทั้งหมด**
เพราะหลายจุด 0 แถวเป็นเรื่องปกติ (touch แบบ best-effort · ผูกของที่อาจหายไปแล้ว)
แปลงมั่ว = toast แดงหลอกหน้างาน ⇒ **ต้องอ่านบริบทรายจุด** · 42 จุดในนั้นเป็นรูป `.eq('id', …)`
(= แก้แถวที่เพิ่งอ่านมา) ซึ่งเป็นกลุ่มที่ควรแปลงก่อนเมื่อมีคนไล่ต่อ

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
