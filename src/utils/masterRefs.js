/* ══ masterRefs — "ใครยังอ้างแถวทะเบียนนี้อยู่" ก่อนลบ (ทะเบียนกลางฝั่ง DR) ══════════════════
   (2026-10-18 · ปิดช่องว่างที่เหลือจาก audit ปุ่มลบทะเบียน — เดิม 6 ทะเบียนนี้ลบได้ทันที
    โดย**ไม่เคยนับปลายทางเลย** ขณะที่ `cost_centers` มีด่านแล้วตั้งแต่ 2026-10-06)

   CLAUDE.md §Database Schema: *"ทะเบียนที่จับคู่ด้วย **ข้อความ** (ไม่ผูก FK) — ลบ/เปลี่ยนชื่อแถว
   ต้องไล่เช็คและไล่แก้ปลายทางในคราวเดียว · **นับไม่ครบ = ห้ามลบ (fail-closed)**"*
   ต้นแบบ: `src/utils/orgNodeRefs.js` (ผังองค์กร) · `src/utils/processTypeRefs.js` (กระบวนการ)

   ─────────────────────────────────────────────────────────────────────────────────────────
   🔴 **ลิสต์ปลายทางวัดจากฐานจริง ห้ามเขียนจากความจำ** (กฎเดียวกับ orgNodeRefs)
   วิธีวัด (18/10 · DR `eyhclzkifitbhbljgoav`): ไล่ **ทุกคอลัมน์ text ของทุกตารางใน schema
   `public` (147 ตาราง · 1,020 คอลัมน์)** แล้วนับแถวที่ค่า "เท่ากับคีย์ของทะเบียน" พอดี
   (`to_jsonb(row)` + `jsonb_each_text` ต่อ `keys` — สแกนตารางละรอบเดียว)

   ⚠️ **ผลสแกนดิบใช้ตรงๆ ไม่ได้ — ทะเบียนพูดภาษาเดียวกันหลายตัว** ตัวที่ตัดออกและเหตุผล:
     · `die_press_lines` ชื่อชนกับ **ชื่อไลน์ผลิต** (`production_lines`) ⇒ สแกนเจอ
       production_sessions.line_name 586 · stock_receipts.source_line 758 ·
       line_stock_transactions 623 · pm_daily_alerts 216 · mtn_orders.line_name 186 …
       **ทั้งหมดเป็นไลน์ผลิต ไม่ใช่กลุ่มเครื่องปั๊ม** ⇒ ไม่นับ
     · `machines.line_name` นับเฉพาะ **`equipment_kind='die'`** — วัด 18/10: die 268/268 แถว
       (100%) ถือชื่อจากทะเบียนนี้ · machine 78/270 · jig 23/184 = ไลน์ผลิตที่ชื่อชนกัน
     · `customers.code` ชนกับ `suppliers.code` (บริษัทเดียวเป็นได้ทั้งลูกค้าและผู้ขาย) ⇒
       purchase_requests.supplier/parts_master.supplier/bom_items.supplier **นับเป็นของ
       suppliers เท่านั้น** ไม่นับให้ customers และกลับกัน
     · `monitoring_shipments.sheet` (1,231) = **ชื่อชีทบอร์ด** ที่ตั้งตามลูกค้า ไม่ใช่ช่องอ้างลูกค้า ⇒ ไม่นับ
     · ป้าย (`label`) ของ `die_op_types`/`die_set_kinds` เป็นคำไทยกลาง ("อื่นๆ" ฯลฯ) ชนกับ
       mtn_orders.problem_characteristic 328 · problem_group 12 · dr_defect_types.name_th …
       ⇒ 2 ทะเบียนนี้จับคู่ด้วย **`key` เท่านั้น ห้ามใช้ label**
     · `audit_log` = ประวัติ ไม่ใช่การอ้างอิงที่ยังมีผล ⇒ ไม่นับ (ลบทะเบียนไม่ทำให้ประวัติผิด)

   🔴 `repair_wi_registry` **ไม่มีคอลัมน์ไหนในฐานเก็บเลข WI เลย** (สแกนได้ 0) — ปลายทางจริงคือ
      **ข้อความใน `fix_action`** ที่ปุ่มชิปเติมให้ว่า "ซ่อมตาม WI-PD3-018"
      (`components/ProblemFixModal.jsx` → `defect_logs` / `downtime_logs`)
      ⇒ ต้องนับแบบ **substring** และ `wi_no` ใส่หลายเล่มคั่น `,` ได้ ⇒ แยกก่อนค้นทุกเล่ม
      (วัด 18/10: ยังไม่มีใครใช้ชิปนี้ ทุกเล่ม 0 — ด่านจึงยังไม่เคยบล็อกจริง แต่ต้องมีไว้ก่อน)

   🔴 **นับไม่ได้ = `partial: true` ห้ามตอบ 0** — ลบย้อนไม่ได้ ⇒ จอต้องไม่ลบไว้ก่อน
      (`42P01` ตารางไม่มี / `42703` คอลัมน์ไม่มี = ยังไม่ apply migration ของปลายทางนั้น
       ⇒ ปลายทางนั้นยังไม่มีข้อมูลจริง ถือว่า 0 ได้ · error อื่น = ไม่รู้ = `partial`)
   ══════════════════════════════════════════════════════════════════════════════════════════ */

/** error code ที่แปลว่า "ปลายทางนั้นยังไม่มีในฐาน" ⇒ นับเป็น 0 ได้จริง ไม่ใช่ "ไม่รู้" */
const SCHEMA_GAP = ['42P01', '42703'];

const txt = v => String(v ?? '').trim();
const uniq = arr => [...new Set(arr.map(txt).filter(Boolean))];

/** แยก `wi_no` ที่ใส่หลายเล่มคั่นด้วย , หรือ / หรือเว้นวรรคยาว */
export const splitWiNos = v => uniq(String(v ?? '').split(/[,;/]+/));

/**
 * ทะเบียน → วิธีจับคู่ปลายทาง
 *   keysOf(row) = ค่าที่ปลายทาง "อาจ" เก็บไว้ (สะกดเก่าด้วย — ลบแถวแล้วค่าเหล่านี้กลายเป็นกำพร้าทั้งชุด)
 *   targets     = [table, column, label, opts?]  ·  opts.eq = ตัวกรองขอบเขต (เช่น equipment_kind)
 *   mode        = 'eq' (default) | 'contains'
 */
export const MASTER_REF_SPECS = {
  customers: {
    label: 'ลูกค้า',
    keysOf: r => uniq([r?.code, r?.name, ...(Array.isArray(r?.aliases) ? r.aliases : [])]),
    targets: [
      ['prod_orders', 'customer', 'ใบผลิต'],
      ['mtn_orders', 'customer', 'ใบแจ้งซ่อม'],
      ['dr_products', 'customer', 'สินค้า'],
      ['kanban_calc_params', 'customer', 'พารามิเตอร์คัมบัง'],
      ['ship_to_plants', 'customer_name', 'โรงปลายทาง'],
      ['monitor_boards', 'customer', 'บอร์ด Monitoring'],
      ['customer_forecasts', 'customer', 'ฟอร์คาสต์'],
    ],
  },
  suppliers: {
    label: 'ผู้ขาย/ผู้รับจ้าง',
    keysOf: r => uniq([r?.code, r?.name]),
    targets: [
      ['purchase_requests', 'supplier', 'ใบขอซื้อ'],
      ['bom_items', 'supplier', 'รายการ BOM'],
      ['parts_master', 'supplier', 'ทะเบียนพาร์ท'],
      ['mtn_spare_parts', 'supplier', 'คลังอะไหล่'],
      ['part_routings', 'vendor_name', 'ขั้นตอนการผลิต'],
      ['container_types', 'supplier', 'ชนิดภาชนะ'],
    ],
  },
  die_press_lines: {
    label: 'กลุ่มเครื่องปั๊ม',
    keysOf: r => uniq([r?.code, r?.name]),
    targets: [
      ['die_sets', 'line_name', 'ชุดแม่พิมพ์'],
      ['machines', 'line_name', 'ทะเบียนแม่พิมพ์', { eq: { equipment_kind: 'die' } }],
    ],
  },
  die_op_types: {
    label: 'ประเภทงาน OP',
    keysOf: r => uniq([r?.key]),           // 🔴 key เท่านั้น — label เป็นคำไทยกลาง ชนกับที่อื่น
    targets: [['equipment_die', 'op_type', 'แม่พิมพ์']],
  },
  die_set_kinds: {
    label: 'รูปแบบชุดแม่พิมพ์',
    keysOf: r => uniq([r?.key]),           // 🔴 key เท่านั้น (เหตุผลเดียวกับ die_op_types)
    targets: [['die_sets', 'kind', 'ชุดแม่พิมพ์']],
  },
  repair_wi_registry: {
    label: 'WI ซ่อม',
    mode: 'contains',
    keysOf: r => splitWiNos(r?.wi_no),
    targets: [
      ['defect_logs', 'fix_action', 'วิธีแก้ในใบของเสีย'],
      ['downtime_logs', 'fix_action', 'วิธีแก้ในใบเครื่องหยุด'],
    ],
  },
};

/**
 * นับว่ามีแถวไหนยังอ้างแถวทะเบียนนี้อยู่บ้าง
 * @param {object} client supabaseDR (ปลายทางทุกตัวอยู่ DR)
 * @param {string} reg    ชื่อทะเบียน (คีย์ของ MASTER_REF_SPECS = ชื่อตาราง)
 * @param {object} row    แถวที่กำลังจะลบ
 * @returns {Promise<{counts:{table,label,n}[], total:number, partial:boolean}>}
 *   `partial: true` = นับไม่ครบ ⇒ **ผู้เรียกต้องไม่ลบ**
 */
export async function loadMasterRefs(client, reg, row) {
  const spec = MASTER_REF_SPECS[reg];
  if (!client || !spec) return { counts: [], total: 0, partial: true };
  const keys = spec.keysOf(row);
  if (!keys.length) return { counts: [], total: 0, partial: true };   // ไม่รู้คีย์ = ไม่รู้ว่าใครใช้

  const contains = spec.mode === 'contains';
  // 'contains' ต้องยิงต่อคีย์ (ilike ทีละค่า) · 'eq' ยิงครั้งเดียวด้วย .in()
  const jobs = [];
  for (const [table, col, label, opts] of spec.targets) {
    const base = () => {
      let q = client.from(table).select('*', { count: 'exact', head: true });
      for (const [k, v] of Object.entries(opts?.eq || {})) q = q.eq(k, v);
      return q;
    };
    if (contains) keys.forEach(k => jobs.push({ table, label, q: base().ilike(col, `%${k}%`) }));
    else jobs.push({ table, label, q: base().in(col, keys) });
  }

  const res = await Promise.all(jobs.map(j => j.q));
  const byTable = new Map();
  let partial = false;
  res.forEach((r, i) => {
    const { table, label } = jobs[i];
    if (r.error) {
      if (!SCHEMA_GAP.includes(r.error.code)) partial = true;
      return;                                   // ปลายทางยังไม่มี = ข้าม (นับเป็น 0)
    }
    const n = r.count ?? 0;
    if (n > 0) byTable.set(table, { table, label, n: (byTable.get(table)?.n || 0) + n });
  });
  const counts = [...byTable.values()].sort((a, b) => b.n - a.n);
  return { counts, total: counts.reduce((s, c) => s + c.n, 0), partial };
}

/**
 * ข้อความ "ลบไม่ได้เพราะ…" — คืน `null` เมื่อลบได้จริง (นับครบ และไม่มีใครใช้)
 * ⚠️ ผู้เรียกต้องเช็ค `!== null` แล้ว return ก่อนยิง delete เสมอ
 */
export function masterBlockMessage(reg, name, refs) {
  const what = MASTER_REF_SPECS[reg]?.label || 'แถวนี้';
  if (!refs) return `ยังตรวจการใช้งานของ ${what} ไม่เสร็จ — ลองอีกครั้ง`;
  if (refs.partial) {
    return `ยังลบ "${name}" ไม่ได้ — ตรวจไม่ครบว่ามีอะไรยังใช้อยู่ (คิวรีนับล้ม) · ลองใหม่อีกครั้ง`;
  }
  if (!refs.counts.length) return null;
  const parts = refs.counts.map(c => `${c.label} ${c.n.toLocaleString()} รายการ`);
  return `ลบไม่ได้: ${what} "${name}" ยังถูกใช้อยู่ — ${parts.join(' · ')}`
       + ' · แก้ค่าปลายทางให้ชี้ที่อื่นก่อน หรือกด "ปิดใช้งาน" แทนการลบ (ค่าเดิมยังอ่านออก)';
}

/**
 * ตัวสำเร็จสำหรับ `<SimpleMasterPanel onBeforeDelete>` — นับปลายทางแล้วคืนข้อความ/null
 * `nameOf` = ชื่อที่เอาไปเขียนในข้อความ (ทะเบียนที่ชื่ออยู่คอลัมน์อื่นให้ส่งเข้ามา)
 * ⚠️ คิวรีล้ม/โยน = SimpleMasterPanel ไม่ลบ (fail-closed ตามสัญญาของ prop)
 */
export const masterDeleteGuard = (client, reg, nameOf = r => r?.name) =>
  async (row) => masterBlockMessage(reg, nameOf(row) || '—', await loadMasterRefs(client, reg, row));
