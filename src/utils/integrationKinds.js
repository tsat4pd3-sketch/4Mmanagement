import { tr } from './i18n.js';
/* 🔌 ศูนย์เชื่อมต่อ — ทะเบียน "ชนิดข้อมูล" ที่ต้นทาง (Node-RED ฯลฯ) ส่งเข้า ESM ได้ (2026-11-11)
   📄 docs/modules/integration-hub.md

   🔴 ที่เดียวที่ประกาศ "ปลายทางในโค้ด" ของชนิดในตัว — จอ /integrations · ตัว gen flow (nodeRedFlow.js) อ่านจากที่นี่
   🔁 27/11 (คำสั่ง user "เพิ่มชนิดไม่ควร hardcode ควรเป็น modal CRUD"): ทะเบียนจริง = ตาราง `integration_kinds` (DR)
      · ชนิดในตัว (is_builtin) = รายการข้างล่าง — DB แก้ได้แค่ชื่อ/ไอคอน/คำอธิบาย (`mergeKinds` ทับให้) · ห้ามลบ
      · ชนิดที่เพิ่มเอง = เซนเซอร์ทั่วไป (temp/vibration ฯลฯ) → body `sensors` → `sensor_readings` (7 วัน) + `sensor_daily`
      · edge `integration-admin` อ่านตารางเดียวกัน (ไม่มีรายชื่อซ้ำในโค้ดแล้ว)
   🔴 หลักการ: ต้นทางส่ง "ข้อเท็จจริง" (ค่า/เวลา/จำนวน) · สูตร/การตัดสินอยู่ที่ ESM
      ⇒ ไม่มีชนิด "เลข OEE ของต้นทาง" ในทะเบียนนี้โดยตั้งใจ (docs/SCADA_REALTIME_DESIGN.md §1)
   status: 'live' = ESM รับได้แล้ว · 'planned' = ออกแบบไว้ ยังไม่มีปลายทางรับ (จอต้องบอก ห้ามให้ติ๊กแล้วเงียบ) */

export const INTEGRATION_KINDS = [
  { key: 'energy_readings', label: 'ค่าไฟรายนาที', icon: '⚡', status: 'live', module: 'energy',
    body: 'readings', dest: 'energy_live · energy_readings', home: '/energy?tab=live',
    help: 'kW สูงสุด · เลขมิเตอร์ kWh · V · A ต่อตู้ ทุก 1 นาที' },
  { key: 'energy_events', label: 'เหตุการณ์ไฟฟ้า', icon: '🔔', status: 'live', module: 'energy',
    body: 'events', dest: 'energy_events', home: '/energy?tab=live',
    help: 'เกินลิมิต / ไม่สมดุล ที่ต้นทางตัดสิน · ซ้ำ = ข้าม · เก็บ 30 วัน' },
  { key: 'energy_daily', label: 'ยอดไฟรายวัน', icon: '📅', status: 'live', module: 'energy',
    body: 'daily', dest: 'energy_daily', home: '/energy?tab=live',
    help: 'เติมวันที่ ESM มีข้อมูลไม่ครบ (เฉพาะวันที่ผ่านไปแล้ว)' },
  { key: 'energy_limits', label: 'ลิมิตตู้ไฟ', icon: '🎚️', status: 'live', module: 'energy',
    body: 'limits', dest: 'energy_live_meters', home: '/energy?tab=live',
    help: 'ต้นทางเป็นเจ้าของลิมิต · ESM ตามเองเมื่อค่าเปลี่ยน' },
  { key: 'machine_state', label: 'สถานะเครื่อง (ช่วงหยุด)', icon: '🏭', status: 'live', module: 'oee',
    body: 'states', dest: 'machine_state_events', home: null,
    help: 'ช่วงหยุด + เหตุผลที่กดหน้าเครื่อง · เฟสเดินคู่: เทียบกับที่คนลง ยังไม่เข้าสูตร OEE · เก็บ 90 วัน' },
  { key: 'piece_count', label: 'นับชิ้น', icon: '🔢', status: 'live', module: 'oee',
    body: 'pieces', dest: 'machine_counters', home: null,
    help: 'ชิ้นต่อนาทีจากเครื่อง (+NG ที่กดหน้าเครื่อง) — เทียบกับยอดที่คนลง · ยังไม่เข้าสูตร OEE · เก็บ 90 วัน' },
  { key: 'machine_live', label: 'สถานะสดของเครื่อง', icon: '🟢', status: 'live', module: 'oee',
    body: 'live', dest: 'machine_live_state', home: '/line-oee',
    help: 'ตอนนี้เครื่องอยู่สถานะไหน มาตั้งแต่เมื่อไหร่ (ข้อความตามต้นทาง) · 1 แถว/เครื่อง ทับทุกนาที' },
];

/** ปลายทางของชนิดที่เพิ่มเอง (เซนเซอร์ทั่วไป) — ทุกตัวใช้ปลายทางเดียวกัน แยกด้วย kind_key */
export const SENSOR_DEST = { status: 'live', module: 'sensor', body: 'sensors', dest: 'sensor_readings · sensor_daily', home: null };
export const SENSOR_KEEP_DAYS = 7;

/**
 * รวมชนิดในตัว (โค้ด) + ทะเบียนจาก DB
 * @param {Array|null} rows  แถว integration_kinds · null = อ่านไม่ได้ ⇒ คืนชนิดในตัวตามโค้ด (จอต้องเขียนบอก)
 * @returns {Array} ชนิดทั้งหมด เรียง sort_order (ชนิดในตัวที่ DB ไม่มีแถว = ยังอยู่ ตามโค้ด)
 */
export function mergeKinds(rows) {
  if (!Array.isArray(rows)) return INTEGRATION_KINDS.map(k => ({ ...k, builtin: true }));
  const byKey = new Map(rows.map(r => [r.key, r]));
  const txt = (v) => (v == null || String(v).trim() === '' ? null : String(v));
  const builtin = INTEGRATION_KINDS.map((k, i) => {
    const r = byKey.get(k.key);
    return { ...k, builtin: true, label: txt(r?.label) || k.label, icon: txt(r?.icon) || k.icon, help: r ? txt(r.help) : k.help,   // มีแถว = ใช้ตาม DB (ล้างแล้ว = ว่างจริง) · ไม่มีแถว = ตามโค้ด
      sort_order: r?.sort_order ?? i + 1 };
  });
  const codeKeys = new Set(INTEGRATION_KINDS.map(k => k.key));
  const custom = rows.filter(r => !codeKeys.has(r.key) && !r.is_builtin).map(r => ({
    ...SENSOR_DEST, key: r.key, label: txt(r.label) || r.key, icon: txt(r.icon) || '📈', unit: txt(r.unit),
    help: txt(r.help) || '', builtin: false, custom: true, sort_order: r.sort_order ?? 0,
  }));
  return [...builtin, ...custom].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.key.localeCompare(b.key));
}

export const kindOf = (key, kinds = INTEGRATION_KINDS) => kinds.find(k => k.key === key) || null;

/** ชนิดที่ไม่รู้จัก ไม่ทิ้งเงียบ — คืนป้าย "ไม่รู้จัก" ให้จอเขียน */
export function kindLabel(key, kinds = INTEGRATION_KINDS) {
  const k = kindOf(key, kinds);
  return k ? `${k.icon} ${tr(k.label)}` : `❓ ${key} ${tr('(ไม่รู้จัก)')}`;
}

/** สถานะต้นทางจากเวลารับล่าสุด — 'paused' | 'never' | 'online' | 'stale'
 *  ไม่เคยได้รับ ≠ ขาดการติดต่อ · เกณฑ์ขาด = ไม่มีค่าใหม่เกิน `staleMin` นาที (ตัวส่งปกติยิงทุก 1 นาที) */
export const SOURCE_STALE_MIN = 3;
export function sourceStatus(src, nowMs = Date.now(), staleMin = SOURCE_STALE_MIN) {
  if (!src) return 'never';
  if (src.is_paused) return 'paused';
  const t = Date.parse(src.last_ok_at || '');
  if (!Number.isFinite(t)) return src.last_seen_at ? 'stale' : 'never';
  return nowMs - t > staleMin * 60000 ? 'stale' : 'online';
}

/** แถบสุขภาพ 24 ชม. — 1 ช่องต่อชั่วโมง (เก่า→ใหม่) จาก integration_hourly
 *  ชั่วโมงที่ไม่มีแถว = ok 0 (ไม่ได้รับเลย) · ชั่วโมงปัจจุบันเทียบกับนาทีที่ผ่านไปแล้วเท่านั้น
 *  @returns {Array<{hourMs:number, ok:number, fail:number, expect:number, ratio:number|null}>} */
export function healthBars(rows, nowMs = Date.now(), hours = 24, perHour = 60) {
  const H = 3600000;
  const cur = Math.floor(nowMs / H) * H;
  const by = new Map((rows || []).map(r => [Math.floor(Date.parse(r.hour_at) / H) * H, r]));
  const out = [];
  for (let i = hours - 1; i >= 0; i--) {
    const hourMs = cur - i * H;
    const r = by.get(hourMs);
    const expect = i === 0 ? Math.max(1, Math.floor((nowMs - hourMs) / 60000)) : perHour;
    const ok = Number(r?.ok_count) || 0, fail = Number(r?.fail_count) || 0;
    out.push({ hourMs, ok, fail, expect, ratio: Math.min(1, ok / expect) });
  }
  return out;
}
