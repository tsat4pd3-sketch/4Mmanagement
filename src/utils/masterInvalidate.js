/* ── masterInvalidate — "แก้ master ตารางไหน แล้วต้องล้าง cache คีย์ไหนบ้าง" จุดเดียว ──────
   (2026-09-15 · งานลด egress รอบ 4 — เตรียมรับจอ/แท็บเล็ต ~40 เครื่อง)

   ═══ ทำไมต้องมี ═══════════════════════════════════════════════════════════════
   🔴 **audit 15/09 พบว่า `invalidateProducts()` / `invalidateMachines()` / ฯลฯ ที่เขียนไว้
      ใน `useProducts.js` · `useMachines.js` · ฯลฯ — ไม่มีหน้าไหนเรียกเลยสักหน้า**
   ⇒ แก้ทะเบียนสินค้า/เครื่องจักรแล้ว picker ทั้งระบบยังเห็นของเก่าได้ถึง 4 ชม. (MASTER_TTL)
      เป็นบั๊กที่มีอยู่แล้วในของจริง ไม่ใช่ของใหม่ที่เพิ่งเกิดจากงานรอบนี้

   และปัญหาโครงสร้างที่ทำให้มันเกิด: **1 ตาราง ถูก cache ไว้หลายคีย์** คนละหน้าคนละ shape
   เช่น `dr_products` มีถึง 8 คีย์ (picker · ct · ct_pair · link · full · fx_products · pn_index · op_items)
   ⇒ ใครแก้สินค้าแล้วเรียก `invalidateMaster('dr_products:picker')` ตัวเดียวก็ยัง**ค้างอีก 7 คีย์**
   ⇒ ต้องมีทะเบียน "ตาราง → คีย์ทั้งหมด" ที่เดียว แล้วทุกจุดบันทึกเรียก `invalidateTable(<ตาราง>)`

   ═══ กฎ ═══════════════════════════════════════════════════════════════════════
   1. **เพิ่มคีย์ `cachedMaster('<คีย์ใหม่>')` ที่ไหนก็ตาม → ต้องลงทะเบียนในไฟล์นี้ด้วย**
      มีเทสในด่าน `npm run build` ไล่หาคีย์ทุกตัวใน src/ แล้วเทียบกับทะเบียนนี้ — ตกแล้ว build ไม่ผ่าน
      (ถ้าไม่มีด่านนี้ ทะเบียนจะล้าสมัยภายในไม่กี่สัปดาห์ เหมือนที่ invalidate* เคยล้าสมัยมาแล้ว)
   2. **ทุกจุดที่ insert/update/delete ตาราง master ต้องเรียก `invalidateTable()` หลังบันทึกสำเร็จ**
      (สำเร็จ = เช็ค error แล้ว — ล้าง cache ทั้งที่เขียนไม่ติด = ยิง DB ซ้ำฟรีๆ)
   3. คีย์ที่**ไม่ผูกกับตาราง master ตัวใดตัวหนึ่ง** ให้ใส่ `UNMANAGED` พร้อมเหตุผล                */
import { invalidateMaster } from './masterCache.js';   // ใส่ .js ให้ครบ — เทส (node ESM) import ไฟล์นี้ตรงๆ

/** ตาราง → คีย์ cache ทุกตัวที่ "เนื้อมาจากตารางนั้น" (ตารางเดียวมีได้หลายคีย์คนละ shape) */
export const KEYS_BY_TABLE = {
  dr_products: [
    'dr_products:picker',        // useProducts (picker กลาง)
    'dr_products:ct',            // FactoryMap · LineOeeBoard (mat_no + cycle_time)
    'dr_products_ct_pair',       // QaFmeBoard
    'dr_products_link',          // QaFmeQueue
    'pn_index:src',              // CapaEffectiveness (mat_no → p_no)
    'fx_products',               // FixtureRegistry
    'dr_products:full',          // DailyReport load() — แถวเต็ม (ตัวหนัก 107 KB)
    'dr_products:matname',       // LineSetup (mat_no + ชื่อ + ไลน์)
    'dr_products:qa',            // QAInspectionSetup
    'dr_products:heijunka',      // HeijunkaKanban (CT)
    'dr_products:pno',           // PlannerSales (เลขลูกค้า)
    'customers:master',          // useCustomers — รายชื่อลูกค้าดึงมาจาก dr_products.customer ด้วย
  ],
  machines: [
    'machines:picker',           // useMachines (picker กลาง)
    'machines:idline',           // FactoryMap loadManpower/loadPM
    'machines:kind',             // MtnAndonBoard
    'machines:supply',           // FactoryMap loadSupply
    'machines:full',             // DailyReport load() — แถวเต็ม (ตัวหนักสุด 368 KB)
    'machines:pmcoord',          // PmCoordination
  ],
  kanban_standards: ['kanban_standards:ct', 'kanban_standards:full'],   // :full = DailyReport (164 KB)
  break_policies:  ['break_policies:active'],
  dr_downtime_types: ['dr_downtime_types:active'],
  dr_defect_types:   ['dr_defect_types:active'],
  production_lines: [
    'production_lines',          // useProductionLines (picker กลาง)
    'production_lines:scope',
    'fx_lines',                  // FixtureRegistry
    'factory_map',               // FactoryMiniMap — รูปผัง/ภูมิภาคผูกกับไลน์
    'factory_line_regions',
    'production_lines:dr',       // DailyReport load()
    'production_lines:flow',     // DailyReport — flow_mode/parallel_stations
  ],
  storage_locations: ['storage_locations:v2'],   // :v2 = รอบที่เพิ่ม line_names (bump คีย์ตอนเปลี่ยน shape)
  die_press_lines:   ['die_press_lines:master'],
  suppliers:         ['suppliers:master'],
  cost_centers:      ['cost_centers:master'],
  qa_instruments:    ['qa_instruments:picker'],
  parts_master:      ['part_registry:main'],
  profiles:          ['people:profiles'],
  employees:         ['people:employees'],
  facility_supply_links: ['facility_supply_links'],
};

/** คีย์ที่ไม่ผูกกับตาราง master ตัวใดตัวหนึ่ง — ตั้งใจให้หมดอายุตาม TTL เท่านั้น */
export const UNMANAGED = [
  // รายชื่อไลน์ "ที่เคยมีกะ" — งอกเองเมื่อเปิดกะไลน์ใหม่ ไม่มีหน้าไหนแก้โดยตรง
  'production_sessions:line_names_ever',
];

/** คีย์ที่สร้างแบบ dynamic (template literal) — เทสข้ามให้ เพราะ grep หาค่าจริงไม่ได้ */
export const DYNAMIC_PREFIXES = ['hist:'];   // useColumnHistory(`hist:${table}.${column}`)

/**
 * ล้าง cache ทุกคีย์ที่ได้มาจากตารางนี้ — เรียก**หลังบันทึกสำเร็จ**เท่านั้น
 * @param {...string} tables ชื่อตาราง (ส่งหลายตัวได้ เช่น บันทึกทีเดียวกระทบ 2 ตาราง)
 */
export function invalidateTable(...tables) {
  tables.forEach((t) => {
    const keys = KEYS_BY_TABLE[t];
    if (!keys) {
      // ตารางที่ยังไม่ได้ลงทะเบียน = เขียนโค้ดผิด ไม่ใช่เรื่องปกติ — ดังไว้ใน console ห้ามเงียบ
      console.warn('[masterInvalidate] ยังไม่ได้ลงทะเบียนตาราง', t, '— cache อาจค้าง ดู src/utils/masterInvalidate.js');
      return;
    }
    keys.forEach(invalidateMaster);
  });
}

export default invalidateTable;
