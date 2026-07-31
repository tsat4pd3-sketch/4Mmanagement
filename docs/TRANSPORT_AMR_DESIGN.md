# Transport / AMR Management — Design Note (store logistics)

> สถานะ: **ร่างออกแบบ (ยังไม่ลงมือ)** · 2026-07-21 · โจทย์จาก user
> เฟส 1 = คนขับมอเตอร์ไซค์ลากของ (ปัจจุบัน) · แผนใช้ AMR จริงภายในปีนี้
> ขอบเขต: **store → เติมของให้ไลน์ผลิต** + **รับภาชนะเปล่ากลับ Rack Center** · รอบเวลาเป็นหลัก (เผื่อ on-demand)

---

## 1. ของที่ "ทำรอไว้แล้ว" — โครง transport มีเกือบครบ (อย่าทำซ้ำ)

ระบบ store ปัจจุบันจำลองการขนส่งภายในเป็น **"รอบเวลา (delivery rounds) + สลับสถานะ"** — มี backbone ครบ ขาดแค่ "ใครขน" กับ "งานรวมศูนย์"

| ชิ้นส่วน | ตาราง/โค้ด | สถานะ |
|---|---|---|
| **รอบจัดส่ง (milk-run รอบเวลา)** | `kanban_delivery_rounds` (line+shift+round_no, cutoff→prep→delivery, `points_count`×`time_per_point_min`) · `LineStock.jsx` DeliveryRoundsTab | ✅ มีแล้ว = "รอบเวลา" ที่ user พูดถึง |
| **สถานะรอบ + ยืนยันส่ง/รับ** | `getRoundStatus` (HeijunkaKanban.jsx:70) ⬜รอ→⏳เตรียม→🔴ค้างส่ง→📦ส่งแล้ว→✔️รับครบ/⚠️ไม่ครบ · `confirmRound`/`submitReceive` | ✅ มีแล้ว |
| **บอร์ดเวลา 24 ชม.** | `DeliveryTimeBoardTab` (LineStock) + `DeliveryTimelineBoard` (Heijunka, ดันผ่านเบรค) | ✅ มีแล้ว |
| **จัดสรร demand ลงรอบ (heijunka leveling)** | HeijunkaKanban.jsx:1539-1720 | ✅ มีแล้ว |
| **คำขอภาชนะ/แร็ค + prepare→deliver→receive + SLA** | `rack_requests` · `internal_delivery_sla` (kind='rack') · `RackCenter.jsx` | ✅ มีแล้ว = ครึ่งหนึ่งของ "รับภาชนะเปล่า" |
| **คิวงาน store รวม (Unified Store Board)** | `UnifiedStoreBoard` (Heijunka) รวม FG/child lot/purchase/raw/rack/WIP | ✅ มีแล้ว |
| **คิวเติม/รับเข้าอื่นๆ** | `packaging_withdrawal_requests`, `wip_replenish_requests`, `purchase_requests`, `child_lot_requests`, `raw_withdrawal_requests` | ✅ มีแล้ว |
| **สร้างคิวอัตโนมัติจากแผนผลิต** | trigger `fn_explode_child_demand` + `fn_post_confirmed_output` | ✅ มีแล้ว — **เป็นตัวป้อนงานขน อย่าคำนวณซ้ำ** |

**Half-built / เตรียมไว้ต่อ (hook สำหรับ transport):**
- `kanban_delivery_rounds.points_count` × `time_per_point_min` = แค่ตัวเลข "จำนวนจุด × นาที/จุด" **ยังไม่มีตารางว่าจุดส่งคือที่ไหน ลำดับอะไร** → hook ทำ route/stop จริง
- `internal_delivery_sla.kind` เป็น generic แต่ใช้แค่ `'rack'` → hook ทำ SLA รวมทุกชนิดงานขน
- `container_types.category/supplier` มีคอลัมน์แต่ยังไม่ใช้
- `rack_requests` มี timestamp ครบทุกสเตป (prepared/delivered/received_at) แต่**ยังไม่มีหน้าวิเคราะห์ cycle-time**
- `shift:'all'` ในรอบ = dead (allocation คีย์ด้วย day/night เท่านั้น)

---

## 2. ช่องว่างจริง (สิ่งที่ transport/AMR ต้องเติม)

1. **ไม่มี entity "คนขับ/รถ/AMR" เลย** — การส่งเป็นแค่ประทับชื่อ `*_by` + เวลา ไม่ใช่ "งานที่ถูกมอบหมายให้ใคร" → นี่คือช่องว่าง #1 ของเฟส 1
2. **ไม่มีงานขนรวมศูนย์ (transport job)** — การเคลื่อนของกระจายอยู่ตามตาราง request แต่ละใบ ไม่มีคิวเดียวที่คนขับเปิดดู "งานฉันวันนี้"
3. **ขา "คืนภาชนะเปล่า" ยังไม่ถูก track** — Rack Center track แค่ "ขอภาชนะ" ไม่ได้ track การขนเปล่ากลับ
4. **ไม่มี route/stop จริง** — `points_count` เป็นแค่ตัวเลข
5. **SLA/overdue มี 2 กลไกแยกกัน** (รอบเวลา vs internal_delivery_sla เฉพาะ rack) — ควรรวม

---

## 3. หลักการออกแบบ

- **ต่อยอด ไม่รื้อ** — consume คิวที่มีอยู่ (`kanban_deliveries`, `rack_requests`, `wip_replenish_requests`, `purchase_requests`, `packaging_withdrawal_requests`) ไม่คำนวณ demand ซ้ำ (trigger ทำให้แล้ว)
- **AMR-ready ตั้งแต่เฟส 1** — entity "ผู้ขน" ออกแบบให้รองรับทั้ง **คน (มอไซ)** และ **AMR** ในตารางเดียว (`kind`) → เฟส 3 แค่เพิ่ม Edge Function auto-assign + sync สถานะจาก fleet manager ไม่ต้องแก้ schema/หน้าจอหลัก
- **ทำตาม convention** — DR project (anon-open), Andon (แดงกระพริบเท่านั้น/เหลืองนิ่ง), การ์ดสูงเท่ากัน, ฟอนต์ ≥11-12px, สิทธิ์ผ่าน `can()`, วันที่ผ่าน `getWorkDate()`/`work_date_bangkok()`

---

## 4. เฟส 1 — Transport Dispatch (คนขับมอไซ) — proposed scope

### 4.1 Data model (เพิ่มใหม่ + generalize ของเดิม)

**เพิ่ม (DR):**
- `transport_carriers` — ผู้ขน: `id, code, name, kind('human'|'amr'), status('available'|'busy'|'offline'|'charging'|'error'), phone/note, is_active` (เฟส 1 = คนขับมอไซ · เฟส 3 = AMR ตารางเดียวกัน)
- `transport_jobs` — งานขน 1 ใบ (unified): `id, work_date, kind('replenish'|'empty_return'|'rack'|'wip'|'purchase_in'|'other'), source_station, dest_station, ref_kind, ref_id (ผูกคิวต้นทาง กันซ้ำ), mat/qty/container สรุป, carrier_id, priority, status('pending'|'assigned'|'picking'|'delivering'|'done'|'cancelled'), requested_at, sla_due_at, assigned_at, picked_at, delivered_at, สร้างโดย/note`
- `transport_stations` (option/เฟส 1.5) — จุดพัก: `code, name, kind('store'|'line'|'rack_center'|'dock'|'fg_wh'|'charging'), pos_top/left (วางผัง)` — เฟส 1 ใช้ชื่อไลน์/store ตรงๆ ก่อนก็ได้

**Generalize ของเดิม:**
- `internal_delivery_sla.kind` — ใช้หลาย kind จริง (replenish/rack/wip/…) แทน 'rack' อย่างเดียว
- `kanban_delivery_rounds` — เพิ่ม `carrier_id` (รอบนี้ใครขน) — reuse points_count เดิม

### 4.2 Workflow

```
คิวที่มีอยู่ (rounds/rack/wip/purchase/packaging)
   → รวมเป็น transport_jobs (pending)  [ผูก ref_kind/ref_id กันซ้ำ]
   → หัวหน้า store / auto มอบงานให้ carrier (assigned)
   → คนขับเปิดมือถือ "งานฉัน" → กดรับ (picking) → ส่งถึง (delivering→done)
       · replenish: done → issue เข้า line_stock (เหมือน confirmRound เดิม)
       · empty_return: ขน "ภาชนะเปล่า" จากไลน์ → Rack Center (ขาที่ขาดตอนนี้)
   → เกิน sla_due_at และยังไม่ done = 🔴 กระพริบ (Andon) · ยังไม่ assign = 🟡 นิ่ง
```

### 4.3 หน้าจอ (เฟส 1)
- **Dispatch Board (จอ TV store)** — คิวงานรวม + สถานะ carrier + Andon เลยเวลา (reuse InternalTimeBoard/DeliveryTimelineBoard เดิม)
- **มือถือคนขับ "งานฉัน"** — list งาน assigned → ปุ่ม รับ/ส่งถึง (สแกน/กด) จับเวลาอัตโนมัติ
- **จับคู่ "คืนภาชนะเปล่า"** — ต่อ flow rack_requests: เพิ่ม job kind `empty_return` (ไลน์ → Rack Center)
- **KPI** — lead time (assigned→done), on-time %, งาน/คน/กะ (จาก timestamp ที่ track อยู่แล้ว — RackCenter capture ไว้แต่ยังไม่วิเคราะห์)

---

## 5. เฟส 2-3 (outlook)
- **เฟส 2** — dispatch engine (คิว priority + เลือก carrier ว่างใกล้สุด) + fleet board + route/stop จริง (ขยาย points → transport_stations เรียงลำดับ)
- **เฟส 3** — เชื่อม AMR จริง: Edge Function ↔ Fleet Manager (REST/MQTT) auto-assign job ให้ carrier kind='amr' + sync battery/ตำแหน่ง/สถานะ · **ไม่แตะ schema/หน้าหลัก** เพราะ carrier/job รองรับ amr แล้ว

---

## 5.5 บทเรียนจาก Toyota TPS (ไปดูงานจริง · 8 บอร์ด · 2026-07-21)

TPS ของจริงยืนยันว่าการขนส่งภายใน = **kanban circulation บน "รอบเวลาตายตัว" (定時定量 TEI-TEI / Teiki-bin milk run)** ขับด้วยการ์ดจริงที่วิ่งผ่าน Kanban Post + Okamochi (heijunka box) แยกบทบาทชัด 3 หน้าที่ + มี catalog ความผิดปกติมาตรฐาน

| บอร์ดที่ดู | แก่น | เรามีแล้ว / ควรเพิ่ม |
|---|---|---|
| **Kanban Route** (แผนภาพวงกลม 11 สเตป + K/B Mat'l loop) | ทั้งระบบเป็น **วงจรปิด route ตายตัว** · 3 บทบาท **Kanban Man (pink) / Production (blue) / Logistic (orange)** · มี **TEI-TEI System Flow** (ตารางเวลา cut-off ล่วงหน้า 1 กะ · หน้าต่างส่งถูกกฎหมายรถบรรทุกบล็อก 06-10, 16-20) | 🆕 route + stop จริง + บทบาท |
| **Kanban Collection Post + Okamochi** (Pattern A/B/C/D × ช่องเวลา 1-11, ธงสี, break time ฝังในpitch) | leveling box ตามเวลา · **เก็บ kanban คืนทุก 2 ชม.** (fixed pitch) · มี route map + P-Q chart + Pattern Group + lot cycle (a:b:c) | ✅ heijunka leveling into rounds · 🆕 kanban post view + return-every-N-hrs |
| **Manpower/Assignment + LOTO** (Day/White/Yellow, "GO TO line", present/absent) | จัดคน→ไลน์ต่อกะแบบ visual | ✅ = ยืนยันแนวจอ 1 (carrier→line ต้นกะ) |
| **Real-time per-part KPI** (JI JI KOKUKOKU · Cycle/Setup/Stop/Eff · Pareto · White/Yellow) + Production Control Board (GSPH/EFF) | KPI ราย part-number รายกะ + List of Problem | ✅ OEE/Report เรามีคล้าย |
| **🎯 Abnormality case of TEI-TEI (17 เคส)** | ตาราง: เคสผิดปกติ → จุด → การกระทำ → **ผล (Shortage/Over stock)** + รูป OK/NG | 🆕 **เพชร — ทำเป็น Abnormality Monitor อัตโนมัติ** |

**สิ่งที่ควรหยิบมา (เรียงตามคุณค่า):**
1. **🎯 Abnormality Monitor** — encode subset ของ 17 เคสที่ detect ได้จากข้อมูลเรา → auto-andon: เช่น (2) kanban คืน < cut-off, (3-4) คืน ≠ แผน, (11) stock เกิน 1 pack (over), (12-13) order/รับ ก่อน/ช้ากว่าเวลา, (15) **ยอดบน board ≠ actual stock**, (16) ลากเกินระบบ >2 lot, (17) part ไม่เต็ม pallet แต่ใส่ kanban → แต่ละเคสจบด้วย **Shortage/Over stock** ชัดเจน
2. **Teiki-bin route + stops จริง** — ยก `points_count` (แค่ตัวเลข) → **stop เรียงลำดับบน route** + route map + collection timetable (pitch เช่นทุก 2 ชม.) — ตรงกับที่ AMR ต้องเดินเส้นทางพอดี
3. **ขา return-kanban / ภาชนะเปล่า = ครึ่งหนึ่งของวงจร** — ยืนยัน `empty_return` ที่วางไว้ ต้อง first-class ไม่ใช่ของแถม
4. **3 บทบาท** — Logistic (คนขับ) / Kanban Man (คนคัดแยก-จ่ายคัมบังที่ store) / Production — แยกสิทธิ์/หน้าจอ
5. **หน้าต่างเวลาส่งถูกบล็อก** (เบรค + เงื่อนไขจริง) — board ดันผ่าน + config ช่วงห้ามส่ง
6. (ภายหลัง) **heijunka pattern/pitch + lot cycle (a:b:c) + P-Q** ใน kanban-calc

## 5.7 Audit ความซ้ำซ้อนทั้งโมดูล Logistic-Store (2026-07-21)

ตรวจ 6 หน้า (Store management / Kanban Board+ทุกแท็บ / Rack Center / Planner&Sales / Rundown / Delivery) — **เจอซ้ำซ้อนจริงเยอะ** โดยเฉพาะ write-path ซ้ำ (เสี่ยง drift/แข่งกันเขียน)

**🔴 HIGH (เขียนซ้ำ 2 ที่ — เสี่ยงข้อมูลเพี้ยน):**
- **D1 · advance `rack_requests`** อยู่ทั้ง `RackCenter.advance()` (มี realtime+cancel+SLA) **และ** `HeijunkaKanban.advanceRack()` (ไม่มี) → เลื่อนสถานะจาก 2 จอ = แข่งกันเขียน + พฤติกรรมต่างแล้ว
- **D2 · issue `packaging_withdrawal_requests`** ซ้ำ RackCenter + HeijunkaKanban
- **D5 · round-status คำนวณ 2 ก๊อป** `getRoundStatus` (Heijunka) vs `statusOf` (LineStock) — **เพี้ยนแล้วที่ขอบ frame** (Heijunka เช็ค past/future work-day, LineStock ไม่เช็ค → กะเดียวกันโชว์สถานะต่างกัน 2 หน้า)

**🟡 MED (view เดียวกันวาดหลายรอบ):**
- **D6/D7 · บอร์ดรอบส่ง วาด 4-5 ที่ในหน้าเดียว** (PlannerStrip / StoreBoardView / DeliveryTimelineBoard / DeliveryRoundsPanel / UnifiedStoreBoard.fg) + LineStock timeboard · "🏪 Store Board" ≈ "ตู้ Kanban รวม › FG"
- **D3/D4 · คิว rack/packaging** โผล่ทั้ง RackCenter และ UnifiedStoreBoard
- **D9 · overdue projection** ซ้ำ (CustomerDemand/Rundown/Planner) · **D10 · on-hand** อ่าน 4 ที่

**⚪ LOW (helper copy-paste):** `custLabel` ×3 · work-date logic ×5 (ทั้งที่มี `getWorkDate()` แล้ว — ผิดกฎ) · addMinutes ×2 · part normalize กระจาย

**4 กลไก overdue/SLA แยกกัน:** round-time · `internal_delivery_sla` (rack) · customer walkback · rundown due-date — #1,#2 คือเรื่องเดียวกัน (ส่งภายในช้า) ทำคนละโมเดล

**แผนยุบรวม (เรียงตามคุ้ม/เสี่ยง):**
1. **round-status → `utils/deliveryRounds.js`** (export `getRoundStatus`) LineStock import ใช้ — เล็ก เสี่ยงต่ำ แก้ bug เพี้ยนขอบ frame เลย
2. **helper → utils** (`getWorkDate`/custLabel/addMinutes/normalize) — เสี่ยงต่ำ
3. **rack/packaging: RackCenter เป็นเจ้าของเดียว** — ลบ `advanceRack`/`issuePkg` ใน Heijunka, แท็บ rack ใน Unified ลิงก์ไป `/rack-center` หรือ import action ร่วม — เสี่ยงกลาง คุ้มสูง (ปิด write ซ้ำ)
4. **retire `StoreBoardView`** ยุบเข้า Unified + reuse `InternalTimeBoard` แทน timeline ที่เขียนเอง

**อย่ายุบ (คนละโดเมนจริง):** Delivery(customer_shipping_orders) vs รอบส่งภายใน · Planner-forecast vs Rundown-balance vs Delivery-chart · KanbanCalc(วางแผนจำนวนใบ) vs allocation(net demand วันนี้) · ledger `line_stock_transactions` (คนละ type: issue/consume/adjust)

> **ผลต่อ Transport/AMR:** ถ้าเพิ่ม transport แบบไม่ยุบก่อน = บอร์ดที่ 6 ซ้อนของซ้ำเดิม · ควร **ยุบ round-status + rack/packaging ให้เหลือเจ้าของเดียวก่อน** แล้วสร้าง transport job รวมบนฐานที่สะอาด (transport = ตัวรวม queue พวกนี้พอดี)

**✅ สถานะการยุบรวม (2026-07-21):**
- **D5 round-status → `src/utils/deliveryRounds.js`** — DONE · `getRoundStatus` + helpers (`addMinutes`/`timeStrToMs`/`dayFrameMs`/`roundDeliveryMin`) รวมมาที่นี่ · HeijunkaKanban + LineStock import จากไฟล์นี้ · แก้บั๊กเพี้ยนขอบ frame (LineStock เดิมไม่เช็ควันย้อนหลัง/ล่วงหน้า) — **หน้าใหม่ที่โชว์สถานะรอบส่งต้อง import จาก util นี้ ห้ามเขียน statusOf เอง**
- **D1/D2 rack advance + packaging issue → RackCenter เจ้าของเดียว** — DONE · ลบ `advanceRack`/`issuePkg` ใน HeijunkaKanban · แท็บ rack ใน Unified Store Board = อ่านอย่างเดียว + ปุ่มลิงก์ "🗃️ จัดการที่ Rack Center →" · เลื่อนสถานะ/จ่าย packaging ทำที่ `/rack-center` เท่านั้น (กันแข่งกันเขียน)
- ยังเหลือ (ภายหลัง): D6/D7 retire `StoreBoardView` (ยุบเข้า Unified) · helper copy-paste (custLabel/work-date/normalize → utils)

## 6. Open decisions (รอเคาะก่อนลงมือ)
1. **มอบงาน** — เฟส 1 ให้หัวหน้า store มอบเอง หรือ auto-assign ตามรอบ/ไลน์ที่คนขับรับผิดชอบ?
2. **หน่วยงาน** — คนขับ 1 คน = 1 กะ/หลายไลน์? ต้องผูก carrier กับ line/section ไหม (scope)?
3. **empty_return** — สร้าง job อัตโนมัติเมื่อยืนยันรับของ (ไปพร้อมกล่องเปล่า) หรือคนขับ/ไลน์กดเรียกเอง?
4. **เริ่มจากจุดไหน** — (ก) ชั้น carrier + assign บนรอบ/คิวที่มีอยู่ (เล็ก เห็นผลเร็ว) → (ข) Dispatch Board รวม → (ค) มือถือคนขับ → (ง) empty_return → (จ) KPI
