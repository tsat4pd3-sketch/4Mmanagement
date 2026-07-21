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

## 6. Open decisions (รอเคาะก่อนลงมือ)
1. **มอบงาน** — เฟส 1 ให้หัวหน้า store มอบเอง หรือ auto-assign ตามรอบ/ไลน์ที่คนขับรับผิดชอบ?
2. **หน่วยงาน** — คนขับ 1 คน = 1 กะ/หลายไลน์? ต้องผูก carrier กับ line/section ไหม (scope)?
3. **empty_return** — สร้าง job อัตโนมัติเมื่อยืนยันรับของ (ไปพร้อมกล่องเปล่า) หรือคนขับ/ไลน์กดเรียกเอง?
4. **เริ่มจากจุดไหน** — (ก) ชั้น carrier + assign บนรอบ/คิวที่มีอยู่ (เล็ก เห็นผลเร็ว) → (ข) Dispatch Board รวม → (ค) มือถือคนขับ → (ง) empty_return → (จ) KPI
