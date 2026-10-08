/* ══ costCenterRefs — "ใครยังใช้รหัส cost center นี้อยู่" ก่อนลบออกจากทะเบียน ══════════════
   (2026-10-08 · เคสจริง 06/10: ลบ 31 แถวที่ "ชื่อว่าง น่าจะไม่ได้ใช้" — 29 แถวในนั้น
   บัญชีตั้ง activity rate ปี 2026 ไว้ครบ และ `cost_center_rates.note` คือชื่อหน่วยจริงจากใบ SAP
   ⇒ แผงทะเบียนลบทันทีโดย**ไม่เคยนับปลายทางเลย** มีแต่ข้อความเตือนในกล่อง confirm)

   `cost_centers.code` เป็น**ทะเบียนที่จับคู่ด้วยข้อความ ไม่ผูก FK** ⇒ ลบแล้วไม่มีใครเตือน
   CLAUDE.md §Database Schema: *"ลบ/เปลี่ยนชื่อแถวทะเบียน ต้องไล่เช็คและไล่แก้ปลายทางในคราวเดียว
   · **นับไม่ครบ = ห้ามลบ (fail-closed)**"* — ต้นแบบของกฎนี้คือ `src/utils/orgNodeRefs.js`

   🔴 **ปลายทางมี 3 ทาง ไม่ใช่ 2** — เช็คแค่ "ไลน์/ผังมีใครชี้ไหม" คือสาเหตุที่ 29 รหัสหลุด:
     production_lines.cost_center  → ไลน์ผลิต (ของจริงในโรงงาน)
     org_nodes.cost_center         → โหนดผังองค์กร (ส่วน/แผนก/กลุ่ม)
     cost_center_rates.cost_center → 🔴 **ค่าแรงมาตรฐานที่บัญชีส่งมา** = ตัวคูณของ "เงินที่ประหยัดได้" ทุกจอ
     kpi_definitions / kpi_month_notes / kpi_base_inputs  (scope_kind='cost_center')
                                   → นิยาม KPI / หมายเหตุ / ค่าตั้งต้น ที่ผูกขอบเขตเป็นรหัสนี้
   ⚠️ ปลายทางทุกตัวอยู่ **Main project** (client `supabase`) — ห้ามส่ง `supabaseDR` เข้ามา

   🔴 **นับไม่ได้ = `partial: true` ห้ามตอบ 0** (การลบย้อนไม่ได้)
      `42P01`/`42703` = ตาราง/คอลัมน์ยังไม่มี ⇒ ปลายทางนั้นยังไม่มีข้อมูลจริง ถือว่า 0 ได้ · error อื่น = ไม่รู้
   ══════════════════════════════════════════════════════════════════════════════════════════ */

/** [ตาราง, ป้ายบนจอ, คอลัมน์ที่เก็บรหัส, eq เพิ่ม] — เรียงตามที่คนต้องเห็นก่อน */
export const COST_CENTER_REF_TABLES = [
  ['cost_center_rates', 'Activity Rate (ค่าแรงมาตรฐานจากบัญชี)', 'cost_center', null],
  ['production_lines', 'ไลน์ผลิต', 'cost_center', null],
  ['org_nodes', 'ผังองค์กร', 'cost_center', null],
  ['kpi_definitions', 'นิยาม KPI', 'scope_value', ['scope_kind', 'cost_center']],
  ['kpi_month_notes', 'หมายเหตุ KPI รายเดือน', 'scope_value', ['scope_kind', 'cost_center']],
  ['kpi_base_inputs', 'ค่าตั้งต้น KPI', 'scope_value', ['scope_kind', 'cost_center']],
];

/** error code ที่แปลว่า "ปลายทางนั้นยังไม่มีในฐาน" ⇒ นับเป็น 0 ได้จริง ไม่ใช่ "ไม่รู้" */
const SCHEMA_GAP = ['42P01', '42703'];

/**
 * นับว่ามีแถวไหนยังใช้รหัสนี้อยู่บ้าง
 * @param {object} client supabase (Main เท่านั้น)
 * @param {string} code   cost_centers.code
 * @returns {Promise<{counts:{table:string,label:string,n:number}[], total:number, partial:boolean}>}
 */
export async function loadCostCenterRefs(client, code) {
  const key = String(code ?? '').trim();
  if (!client || !key) return { counts: [], total: 0, partial: true };
  const res = await Promise.all(COST_CENTER_REF_TABLES.map(([t, , col, extra]) => {
    let q = client.from(t).select('*', { count: 'exact', head: true }).eq(col, key);
    if (extra) q = q.eq(extra[0], extra[1]);
    return q;
  }));
  const counts = [];
  let partial = false;
  res.forEach((r, i) => {
    const [table, label] = COST_CENTER_REF_TABLES[i];
    if (r.error) {
      if (!SCHEMA_GAP.includes(r.error.code)) partial = true;
      return;                                   // ปลายทางยังไม่มี = ข้าม (นับเป็น 0)
    }
    const n = r.count ?? 0;
    if (n > 0) counts.push({ table, label, n });
  });
  return { counts, total: counts.reduce((s, c) => s + c.n, 0), partial };
}

/**
 * ข้อความ "ลบไม่ได้เพราะ…" — คืน `null` เมื่อลบได้จริง (นับครบ และไม่มีใครใช้)
 * ⚠️ ผู้เรียกต้องเช็ค `!== null` แล้ว return ก่อนยิง delete เสมอ
 */
export function costCenterBlockMessage(code, refs) {
  if (!refs) return 'ยังตรวจการใช้งานไม่เสร็จ — ลองอีกครั้ง';
  if (refs.partial) {
    return `ยังลบ "${code}" ไม่ได้ — ตรวจไม่ครบว่ามีอะไรยังใช้อยู่ (คิวรีนับล้ม) · ลองใหม่อีกครั้ง`;
  }
  if (!refs.counts.length) return null;
  const parts = refs.counts.map(c => `${c.label} ${c.n.toLocaleString()} รายการ`);
  return `ลบไม่ได้: รหัส "${code}" ยังถูกใช้อยู่ — ${parts.join(' · ')}`
       + ' · ถ้าบัญชีเลิกใช้รหัสนี้แล้ว ให้กด "ปิดใช้" แทนการลบ (ค่าเดิมยังอ่านออก และเลือกใหม่ไม่ได้)';
}
