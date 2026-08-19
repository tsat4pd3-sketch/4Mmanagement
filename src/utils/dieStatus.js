import { supabaseDR } from '../supabaseClient';

/* ═══ dieStatus — source of truth "สถานะแม่พิมพ์" (DIE MAINTENANCE) ═══════════════════════
   ใช้กับ /die-registry (แท็บ 🗺️ ผังจัดเก็บ + 📊 สถานะ) — 2026-08-19

   สถานะมี 2 แกน **ห้ามยุบรวม**:
   • แกน manual (`equipment_die.die_status`) — คนหน้างานตั้งเอง: แม่พิมพ์อยู่ไหน/พร้อมแค่ไหน
     null = "ยังไม่ระบุ" โดยตั้งใจ (worklist ให้ไล่เก็บ — ห้าม default เป็น ready แทนหน้างาน)
   • แกน derive จากใบซ่อม MO (`mtn_orders` ที่ยังไม่ปิด) — คำนวณสดเสมอ ไม่เก็บซ้ำใน DB
     (เก็บซ้ำเมื่อไหร่ 2 แหล่ง drift กันแน่ — หลักเดียวกับ "ห้ามให้ระบบภายนอกคำนวณ OEE เอง")

   เพิ่มสถานะใหม่ = เพิ่ม entry ที่นี่ที่เดียว (DB ไม่มี check constraint โดยตั้งใจ) ·
   key ใน DB ที่โค้ดไม่รู้จัก → dieStatusMeta คืนก้อนสีเทาพร้อม key ดิบ (fail-visible ไม่หายเงียบ)
═══════════════════════════════════════════════════════════════════════════════════════════ */

export const DIE_STATUSES = [
  { key: 'ready',       icon: '✅', label: 'พร้อมใช้ (จัดเก็บ)',      color: '#22c55e', bg: 'rgba(34,197,94,0.14)',   desc: 'อยู่ในคลัง พร้อมขึ้นเครื่องผลิต' },
  { key: 'in_use',      icon: '🏭', label: 'ติดตั้งบนเครื่องปั๊ม',      color: '#3b82f6', bg: 'rgba(59,130,246,0.14)',  desc: 'ขึ้นเครื่องใช้งานผลิตอยู่ — ช่องจัดเก็บบนผังว่างชั่วคราว' },
  { key: 'maintenance', icon: '🔧', label: 'ซ่อม/เจียร/PM ภายใน',     color: '#f59e0b', bg: 'rgba(245,158,11,0.14)',  desc: 'อยู่ระหว่างซ่อม เจียรคมตัด หรือ PM โดยทีม DIE MTN' },
  { key: 'external',    icon: '🚚', label: 'ส่งซ่อม/ปรับปรุงภายนอก',   color: '#a855f7', bg: 'rgba(168,85,247,0.14)',  desc: 'ส่งออกไปซ่อม/modify ที่ผู้รับจ้างภายนอก' },
  { key: 'trial',       icon: '🧪', label: 'รอ Try-out / ปรับแต่ง',    color: '#eab308', bg: 'rgba(234,179,8,0.14)',   desc: 'ซ่อม/แก้เสร็จแล้ว รอลองปั๊มยืนยันคุณภาพก่อนปล่อยใช้จริง' },
  { key: 'retired',     icon: '⛔', label: 'เลิกใช้ / รอจำหน่าย',      color: '#8b8b96', bg: 'rgba(139,139,150,0.14)', desc: 'พาร์ทเลิกผลิต/แม่พิมพ์หมดสภาพ — เก็บรอตัดจำหน่าย' },
];

export const DIE_STATUS_UNSET = {
  key: null, icon: '❔', label: 'ยังไม่ระบุสถานะ', color: '#6b7280', bg: 'rgba(107,114,128,0.16)',
  desc: 'ยังไม่มีใครบันทึกสถานะ — เป็นงานที่ต้องไล่เก็บ ไม่ใช่ค่าปกติ',
};

export function dieStatusMeta(key) {
  if (!key) return DIE_STATUS_UNSET;
  return DIE_STATUSES.find(s => s.key === key)
    // key ที่โค้ดไม่รู้จัก (เช่นเพิ่มจากที่อื่นในอนาคต) — โชว์ key ดิบสีเทา ห้ามแสดงเป็น "ยังไม่ระบุ"
    || { key, icon: '❓', label: key, color: '#6b7280', bg: 'rgba(107,114,128,0.16)', desc: 'สถานะที่โค้ดเวอร์ชันนี้ไม่รู้จัก' };
}

/* สถานะ MO ที่ถือว่า "ยังค้างอยู่" — ตรงกับ STATUS_META ใน MtnRepair.jsx (ทุกตัวที่ไม่ใช่ closed/rejected)
   returned (ตีกลับ) นับว่าค้าง: ใบยังไม่จบ ผู้แจ้งต้องส่งใหม่ */
export const OPEN_MO_STATUSES = ['pending', 'assigned', 'repairing', 'repaired', 'checked', 'qa', 'handover', 'returned'];

/* ป้ายสถานะ MO แบบย่อ — mirror STATUS_META ใน MtnRepair.jsx (หน้าเพจเป็น lazy chunk
   import ข้ามมาไม่ได้ จะลากทั้งหน้าแจ้งซ่อมเข้ามาใน chunk นี้) · เพิ่มสถานะใหม่ต้องอัพเดท 2 ที่ */
export const MO_STATUS_LABEL = {
  pending: '📣 รอรับงาน', assigned: '🔧 รับงานแล้ว/รอซ่อม', repairing: '🔧 กำลังซ่อม',
  repaired: '🔎 รอตรวจหลังซ่อม', checked: '🧪 รอคุณภาพ/รับมอบ', qa: '🤝 รอรับมอบ',
  handover: '✍️ รออนุมัติปิด', returned: '↩️ ตีกลับ (ผิดแผนก)',
};

const normNo = (s) => String(s || '').trim().toUpperCase();

/** map: machine_no (normalized) → ใบ MO ค้างของเครื่องนั้น (เรียงใบใหม่ก่อน) */
export function buildOpenMoMap(openMos) {
  const m = {};
  for (const o of (openMos || [])) {
    const k = normNo(o.machine_no);
    if (k) (m[k] ||= []).push(o);
  }
  Object.values(m).forEach(a => a.sort((x, y) => String(y.report_at || '').localeCompare(String(x.report_at || ''))));
  return m;
}

/** ใบ MO ค้างของแม่พิมพ์ตัวนี้ (die = แถว machines) — [] เมื่อไม่มี */
export const openMosOf = (die, moMap) => moMap[normNo(die?.machine_no)] || [];

/** เจียรครบเกณฑ์แล้วหรือยัง (regrind_limit ไม่ตั้ง = ประเมินไม่ได้ → false ไม่เดา) */
export const regrindOver = (ext) =>
  ext?.regrind_limit != null && Number(ext.regrind_count || 0) >= Number(ext.regrind_limit);

/**
 * สี/พฤติกรรมหมุดบนผัง — ลำดับความสำคัญ: MO ค้าง (แดง — เรื่องจริงจากระบบซ่อม) ชนะสถานะ manual
 * blink เฉพาะ MO ที่ยังไม่มีคนรับงาน (pending) ตามกติกา Andon: กระพริบ = ต้องมีคนไปกดรับเดี๋ยวนี้
 * (MO ที่รับแล้ว = มีเจ้าภาพ → แดงนิ่ง)
 */
export function dieMarkerState(die, moMap) {
  const mos = openMosOf(die, moMap);
  if (mos.length) {
    return {
      color: '#ef4444', blink: mos.some(o => o.status === 'pending'),
      label: mos.some(o => o.status === 'pending') ? '📣 ใบซ่อมรอรับงาน' : '🔧 มีใบซ่อมค้าง',
      mos,
    };
  }
  const st = dieStatusMeta(die.ext?.die_status);
  return { color: st.color, blink: false, label: `${st.icon} ${st.label}`, mos: [] };
}

/**
 * บันทึกสถานะ manual — upsert ส่วนขยาย equipment_die (แถวอาจยังไม่มีถ้า backfill ข้ามตัวนั้น)
 * ⚠️ tolerant: ยังไม่ apply migration 20260819_die_layout_status.sql → error 42703
 *    caller ต้องเอา error ไปแจ้งผู้ใช้ **ห้ามเงียบ** (ดูข้อความสำเร็จรูปใน MIGRATION_HINT)
 */
export async function saveDieStatus({ machineId, status, note, byName }) {
  return supabaseDR.from('equipment_die').upsert({
    machine_id: machineId,
    die_status: status || null,
    status_note: note?.trim() || null,
    status_updated_at: new Date().toISOString(),
    status_updated_by_name: byName || null,
  }, { onConflict: 'machine_id' });
}

export const MIGRATION_HINT =
  'ยังไม่ได้ apply migration 20260819_die_layout_status.sql (DR project) — แจ้ง admin รันใน SQL Editor ก่อน จึงจะใช้ผัง/สถานะแม่พิมพ์ได้';
