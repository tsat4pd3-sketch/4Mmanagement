/* ═══════════════════════════════════════════════════════════════════════════
   ความน่าเชื่อถือของอุปกรณ์รายตัว — Downtime · MTTR · MTBF          2026-09-11

   ที่มา (คำขอทีม MTN ผ่าน user): "สรุป Downtime และ MTTR MTBF ในโหมดของเครื่องจักร
   เอาไว้เปรียบเทียบกับโปรแกรมจากส่วนกลาง"
   คำสั่ง user: **นับจากเครื่องจริง (downtime_logs) ไม่เอาใบแจ้งซ่อม** และ
   **ต้องแยกได้ว่าเป็น เครื่อง / จิ๊ก / แม่พิมพ์** (machines.equipment_kind)

   ── ทำไมนับจาก downtime ไม่ใช่ใบ MO ──────────────────────────────────────
   ใบ MO 90 วัน = 271 ใบ · downtime ที่ระบุเครื่อง = 7,102 ครั้ง (ตรวจฐานจริง 2026-09-11)
   เครื่องหยุดจริงเยอะกว่าใบซ่อมหลายเท่า (หยุดสั้นๆ ช่างแก้เองไม่เปิดใบ)
   ⇒ ถ้านับจากใบ MO จะได้ MTBF ที่ "สวยเกินจริง" — ไม่ตรงกับที่หน้างานเจอ
   **แลกมาด้วย:** MTTR จาก downtime = เวลาที่ "ไลน์หยุด" (รวมเวลารอช่าง)
   ไม่ใช่ "เวลาที่ช่างลงมือซ่อม" — ต้องเขียนกำกับบนจอเสมอ ห้ามปล่อยให้เข้าใจผิด

   ── กับดักข้อมูลจริงที่ต้องรับมือ (วัดจากฐาน 2026-09-11) ──────────────────
   `downtime_logs.machine_no` เป็น **ข้อความที่คนหน้างานพิมพ์เอง** ไม่ใช่ FK
     · 297 คีย์ (หลัง normalize) จับคู่ทะเบียนได้ 142 = 6,105 จาก 7,108 แถว (86%)
     · ที่เหลือพิมพ์เป็นชื่อเล่น: "เลเซอร์08" · "SW10" · "LWR" · "LASER"
   ⇒ **ห้ามซ่อนตัวที่จับคู่ไม่ได้** (ข้อมูลหายเงียบ) — แสดงต่อ + ติดป้าย "ไม่อยู่ในทะเบียน"
     + บอกจำนวนบนหัวตาราง ให้คนไปแก้ที่ต้นทาง (ทะเบียนเครื่อง / สอนคนกรอก)

   ⚠️ **prefix-match ใช้ได้เฉพาะคีย์ที่ไม่ชน** — แม่พิมพ์ 24 ตัวชื่อขึ้นต้นเหมือนกัน
      ต่างแค่ OP10/OP20/… ("BMP END FACE RPA RH/LH - N1WB-… (OP10: FORM)")
      ตัดหลัง "/" แล้วยุบรวมเป็นตัวเดียวหมด = ตัวเลขมั่วทันที
      → เก็บ prefix index เฉพาะคีย์ที่ map ไปเครื่องเดียว (ชน = ทิ้งทั้งคีย์)

   ⚠️ ทุกฟังก์ชันในไฟล์นี้ต้อง **pure** (ไม่ import supabase) — ผู้เรียกส่งข้อมูลมาให้
   ═══════════════════════════════════════════════════════════════════════════ */

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

/** คีย์เทียบเลขอุปกรณ์ — ตัดตัวคั่น/ช่องว่างทิ้ง เก็บ A-Z 0-9 และไทย
 *  (หน้างานพิมพ์ "SP-78" บ้าง "SP78" บ้าง · "เลเซอร์08" ก็ต้องจับเป็นคีย์เดียวกันได้) */
export const normEquipKey = (s) =>
  String(s ?? '').trim().toUpperCase().replace(/[^A-Z0-9฀-๿]/g, '');

/** คีย์ "ส่วนหน้า" — ทะเบียนเก็บ "SP-78/NF56" แต่คนกรอกพิมพ์แค่ "SP-78"
 *  ⚠️ ใช้เป็น fallback เท่านั้น และเฉพาะเมื่อไม่ชนกับเครื่องอื่น (ดูหัวไฟล์) */
export const baseEquipKey = (s) => normEquipKey(String(s ?? '').split('/')[0]);

/**
 * ทำดัชนีเทียบเลขอุปกรณ์จากทะเบียน `machines`
 * @returns {{exact:Map, prefix:Map, collisions:number}}
 *   exact  = คีย์เต็ม → เครื่อง (ชนกันแทบไม่มี เพราะ machine_no unique)
 *   prefix = คีย์ส่วนหน้า → เครื่อง **เฉพาะที่ไม่ชน** · ชน = ไม่ใส่ (ห้ามเดา)
 */
export function buildEquipIndex(machines = []) {
  const exact = new Map();
  const prefixAll = new Map();
  for (const m of machines) {
    const k = normEquipKey(m?.machine_no);
    if (k && !exact.has(k)) exact.set(k, m);
    const p = baseEquipKey(m?.machine_no);
    if (!p) continue;
    if (!prefixAll.has(p)) prefixAll.set(p, []);
    prefixAll.get(p).push(m);
  }
  const prefix = new Map();
  let collisions = 0;
  for (const [p, list] of prefixAll) {
    if (list.length === 1) prefix.set(p, list[0]);
    else collisions++;
  }
  return { exact, prefix, collisions };
}

/**
 * เลขที่คนกรอก → เครื่องในทะเบียน
 * @returns {{machine:object|null, via:'exact'|'prefix'|null, key:string}}
 *   ไม่เจอ = `machine: null` **ห้ามเดา** (จอแสดงเป็น "ไม่อยู่ในทะเบียน")
 */
export function resolveEquip(rawNo, index) {
  const key = normEquipKey(rawNo);
  if (!key || !index) return { machine: null, via: null, key };
  const hit = index.exact?.get(key);
  if (hit) return { machine: hit, via: 'exact', key };
  const p = index.prefix?.get(key);
  if (p) return { machine: p, via: 'prefix', key };
  return { machine: null, via: null, key };
}

/* ── นาที downtime — สูตรเดียวกับ DeptDashboard/AdoptionOutlook (ห้ามเขียนใหม่) ── */
export const dtMinutes = (d) =>
  d?.duration_min != null
    ? (Number(d.duration_min) || 0)
    : (d?.started_at && d?.ended_at
        ? Math.max(0, (new Date(d.ended_at) - new Date(d.started_at)) / 60000)
        : 0);
/** ยังไม่ปิด = ไม่รู้ว่านานเท่าไหร่ (ห้ามตีเป็น 0 นาทีแล้วเอาไปเฉลี่ย) */
export const isOpenDt = (d) => !d?.ended_at && d?.duration_min == null;
/** หยุดตามแผน (PM/เปลี่ยนรุ่น) ≠ เครื่องเสีย — ไม่นับเป็น failure ของ MTBF */
export const isPlannedDt = (d) => (d?.dr_downtime_types?.category ?? d?.dt_category) === 'planned';

/** "HH:MM(:SS)" → นาทีจากเที่ยงคืน · คืน null ถ้าอ่านไม่ออก */
const timeToMin = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * ชั่วโมงเดินเครื่องของแต่ละไลน์ (นาที) จากกะที่เปิดจริง
 *
 * ⚠️ **ยุบกะคู่ขนานก่อนบวก** — 1 ไลน์เปิดหลายใบในกะเดียวกันได้ (ผลิตหลายรุ่นพร้อมกัน)
 *    บวกตรงๆ = เวลาเดินเครื่องเกินจริงเป็นเท่าตัว → MTBF สวยเกิน
 *    ⇒ key = ไลน์+วัน+กะ แล้วเอา shift_min มากสุดของคีย์นั้น
 * ⚠️ `shift_min` ว่าง/0 → ถอยไปคำนวณจาก start_time-end_time (ข้ามวันได้)
 *    ยังไม่ได้อีก = **ไม่นับกะนั้น** + นับใส่ `unknownShifts` ให้จอบอกว่าเวลาต่ำกว่าจริง
 */
export function operatingMinutesByLine(sessions = []) {
  const best = new Map();      // "line|date|shift" → นาที
  let unknownShifts = 0;
  for (const s of sessions) {
    const line = String(s?.line_name ?? '').trim();
    if (!line) continue;
    let min = num(s?.shift_min);
    if (!min || min <= 0) {
      const a = timeToMin(s?.start_time), b = timeToMin(s?.end_time);
      min = a != null && b != null ? (b > a ? b - a : b + 1440 - a) : null;
    }
    if (!min || min <= 0) { unknownShifts++; continue; }
    const k = `${line}|${s?.work_date ?? ''}|${s?.shift ?? ''}`;
    best.set(k, Math.max(best.get(k) ?? 0, min));
  }
  const byLine = new Map();
  for (const [k, min] of best) {
    const line = k.split('|')[0];
    byLine.set(line, (byLine.get(line) ?? 0) + min);
  }
  return { byLine, unknownShifts };
}

/**
 * สรุปความน่าเชื่อถือรายอุปกรณ์
 *
 * @param {object} p
 * @param {Array}  p.downtimes  แถว downtime_logs (ควร join dr_downtime_types มาด้วยเพื่อแยก planned)
 * @param {Array}  p.machines   ทะเบียน machines (ต้องมี machine_no · equipment_kind · line_name)
 * @param {Array}  p.sessions   production_sessions ในช่วงเดียวกัน (ใช้หาเวลาเดินเครื่อง)
 * @param {Function} [p.lineFamilyOf] (lineName) => string[] ชื่อไลน์ในครอบครัว (แม่+ลูก)
 *        ไม่ส่ง = ใช้ชื่อไลน์ตรงตัว · กะมักเปิดบนไลน์ลูก แต่เครื่องลงทะเบียนที่ไลน์แม่
 * @param {Function} [p.sessionLineOf] (sessionId) => lineName — ใช้เดาไลน์ให้เครื่องนอกทะเบียน
 *
 * @returns {{rows:Array, summary:object}}
 *   row: { key, machineNo, machineName, kind, kindKnown, lineName, inMaster, via,
 *          stops, openStops, closedStops, dtMin, mttrMin|null,
 *          opMin|null, upMin|null, mtbfMin|null, availPct|null,
 *          plannedStops, plannedMin, lastAt, topCause }
 *   ⚠️ ค่าที่คำนวณไม่ได้ = **null เสมอ ห้ามเป็น 0** (0 = "ไม่เคยเสียเลย" คนละเรื่องกับ "ไม่รู้")
 */
export function machineReliability({
  downtimes = [], machines = [], sessions = [],
  lineFamilyOf = null, sessionLineOf = null,
} = {}) {
  const index = buildEquipIndex(machines);
  const { byLine, unknownShifts } = operatingMinutesByLine(sessions);

  const acc = new Map();   // key → row ระหว่างสะสม
  let noMachineNo = 0;

  for (const d of downtimes) {
    const raw = String(d?.machine_no ?? '').trim();
    if (!raw) { noMachineNo++; continue; }          // ไม่ระบุเครื่อง — นับไว้บอกบนจอ
    const { machine, via, key: typedKey } = resolveEquip(raw, index);
    if (!typedKey) { noMachineNo++; continue; }
    /* 🔴 จัดกลุ่มด้วย "เครื่องในทะเบียน" ไม่ใช่ข้อความที่พิมพ์ — ไม่งั้นเครื่องเดียวกัน
       ที่คนพิมพ์คนละแบบ ("SP-78" · "SP78" · "SP-78/NF56") กลายเป็นคนละแถว
       แล้วทั้ง MTTR และ MTBF เพี้ยนทั้งคู่ (จำนวนครั้งถูกหารออกเป็นหลายก้อน) */
    const key = machine ? normEquipKey(machine.machine_no) : typedKey;

    let r = acc.get(key);
    if (!r) {
      r = {
        key,
        machineNo: machine?.machine_no || raw,     // ไม่อยู่ในทะเบียน = โชว์ตามที่คนกรอก
        machineName: machine?.machine_name || '',
        kind: machine?.equipment_kind ?? null,
        kindKnown: !!machine,
        lineName: machine?.line_name || (sessionLineOf ? (sessionLineOf(d?.session_id) || '') : ''),
        inMaster: !!machine, via,
        stops: 0, openStops: 0, closedStops: 0, dtMin: 0,
        plannedStops: 0, plannedMin: 0,
        lastAt: null, _causes: {}, _rawNos: new Set(),
      };
      acc.set(key, r);
    }
    r._rawNos.add(raw);
    if (!r.lineName && sessionLineOf) r.lineName = sessionLineOf(d?.session_id) || '';

    const mins = dtMinutes(d);
    const cause = d?.dr_downtime_types?.name_th || d?.dt_name || 'ไม่ระบุประเภท';
    if (isPlannedDt(d)) {
      r.plannedStops++; r.plannedMin += mins;
      continue;                                     // หยุดตามแผนไม่ใช่ "เครื่องเสีย"
    }
    r.stops++;
    r._causes[cause] = (r._causes[cause] || 0) + 1;
    if (isOpenDt(d)) r.openStops++;
    else { r.closedStops++; r.dtMin += mins; }
    const at = d?.started_at ? new Date(d.started_at).getTime() : null;
    if (at && (!r.lastAt || at > r.lastAt)) r.lastAt = at;
  }

  const rows = [];
  for (const r of acc.values()) {
    // เวลาเดินเครื่อง = ชั่วโมงกะของ "ครอบครัวไลน์" ที่เครื่องนั้นสังกัด
    let opMin = null;
    if (r.lineName) {
      const fam = lineFamilyOf ? lineFamilyOf(r.lineName) : [r.lineName];
      const names = fam && fam.length ? fam : [r.lineName];
      let sum = 0, hit = false;
      for (const n of names) { const v = byLine.get(n); if (v != null) { sum += v; hit = true; } }
      if (hit) opMin = sum;
    }
    const upMin = opMin != null ? Math.max(0, opMin - r.dtMin - r.plannedMin) : null;
    rows.push({
      key: r.key, machineNo: r.machineNo, machineName: r.machineName,
      kind: r.kind, kindKnown: r.kindKnown, lineName: r.lineName,
      inMaster: r.inMaster, via: r.via,
      rawNos: [...r._rawNos],
      stops: r.stops, openStops: r.openStops, closedStops: r.closedStops,
      dtMin: Math.round(r.dtMin),
      // MTTR = เฉลี่ยเฉพาะครั้งที่ปิดแล้ว (ครั้งที่ยังเปิดค้าง ไม่รู้ความยาว ห้ามเอามาเฉลี่ย)
      mttrMin: r.closedStops > 0 ? Math.round(r.dtMin / r.closedStops) : null,
      opMin: opMin != null ? Math.round(opMin) : null,
      upMin: upMin != null ? Math.round(upMin) : null,
      // MTBF = เวลาที่เดินได้จริง ÷ จำนวนครั้งที่เสีย (รวมครั้งที่ยังเปิดค้าง — มันเสียไปแล้ว)
      mtbfMin: upMin != null && r.stops > 0 ? Math.round(upMin / r.stops) : null,
      availPct: opMin && opMin > 0 ? +(((upMin ?? 0) / opMin) * 100).toFixed(1) : null,
      plannedStops: r.plannedStops, plannedMin: Math.round(r.plannedMin),
      lastAt: r.lastAt,
      topCause: Object.entries(r._causes).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    });
  }
  rows.sort((a, b) => b.dtMin - a.dtMin || b.stops - a.stops);

  const matched = rows.filter(r => r.inMaster).length;
  return {
    rows,
    summary: {
      equipCount: rows.length,
      matched, unmatched: rows.length - matched,
      totalStops: rows.reduce((s, r) => s + r.stops, 0),
      totalDtMin: rows.reduce((s, r) => s + r.dtMin, 0),
      openStops: rows.reduce((s, r) => s + r.openStops, 0),
      noMachineNo,                // downtime ที่ไม่ได้ระบุเครื่องเลย
      unknownShifts,              // กะที่หาชั่วโมงไม่ได้ → เวลาเดินเครื่องต่ำกว่าจริง
      prefixCollisions: index.collisions,
    },
  };
}

/** สรุปรวมตามชนิดอุปกรณ์ (เครื่อง/จิ๊ก/แม่พิมพ์/facility) — MTTR ถ่วงน้ำหนักด้วยจำนวนครั้ง */
export function summarizeByKind(rows = []) {
  const by = new Map();
  for (const r of rows) {
    const k = r.kindKnown ? (r.kind || 'machine') : '_unknown';
    const e = by.get(k) || { kind: k, equip: 0, stops: 0, dtMin: 0, closedStops: 0, upMin: 0, hasUp: false };
    e.equip++; e.stops += r.stops; e.dtMin += r.dtMin; e.closedStops += r.closedStops;
    if (r.upMin != null) { e.upMin += r.upMin; e.hasUp = true; }
    by.set(k, e);
  }
  return [...by.values()].map(e => ({
    ...e,
    mttrMin: e.closedStops > 0 ? Math.round(e.dtMin / e.closedStops) : null,
    mtbfMin: e.hasUp && e.stops > 0 ? Math.round(e.upMin / e.stops) : null,
  })).sort((a, b) => b.dtMin - a.dtMin);
}

/** นาที → "2 ชม. 15 น." อ่านง่ายบนจอหน้างาน · null = "—" (ไม่รู้ ไม่ใช่ 0) */
export function fmtDur(min) {
  if (min == null || Number.isNaN(min)) return '—';
  const m = Math.round(min);
  if (m < 60) return `${m} น.`;
  const h = Math.floor(m / 60), rest = m % 60;
  if (h < 24) return rest ? `${h} ชม. ${rest} น.` : `${h} ชม.`;
  const dd = Math.floor(h / 24), hh = h % 24;
  return hh ? `${dd} วัน ${hh} ชม.` : `${dd} วัน`;
}
