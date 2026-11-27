/* ⚙️ B1 ฝั่งตัวเตือน — "เครื่องไหนต้องตรวจ AM กะนี้" = เครื่องที่มีใบผลิตสแกนในกะนี้ (2026-11-05)
   🔴 ต้องตรงกับจอทุกข้อ: `amMachineKeys()` / `runningMachinesByLine()` / `amTargetsByRun()` ใน src/lib/pmDailyStatus.js
      และ `machineKey()` ใน src/utils/machineNo.js — ไฟล์นี้เป็นสำเนาแบบ JS ล้วน (Deno import ไฟล์ src/ ไม่ได้)
      ด่าน: src/utils/__tests__/pmDailyScanParity.test.mjs เทียบผลกับฝั่งจอบนชุดข้อมูลเดียวกัน
      แก้ที่หนึ่ง = ต้องแก้อีกที่ ไม่งั้นจอเขียว แต่ตัวเตือนยิงส้ม (หรือกลับกัน) */

export function machineKey(s) {
  const up = String(s ?? '').normalize('NFC').toUpperCase().replace(/[^A-Z0-9฀-๿]/g, '');
  return up.replace(/^([A-Z฀-๿]+)0*([0-9]+)$/, '$1$2');
}

export function amMachineKeys(no) {
  const s = String(no ?? '').trim();
  if (!s) return [];
  const parts = [s, ...s.split(/[/,]/)];
  return [...new Set(parts.map(machineKey).filter(Boolean))];
}

/** ใบผลิตของครอบครัวไลน์ → { orders, noMno, keys: {machineKey: เวลาเปิดใบแรก} } */
export function runOfOrders(orders = []) {
  const m = { orders: 0, noMno: 0, keys: {} };
  for (const o of orders) {
    m.orders++;
    const ks = amMachineKeys(o.machine_no);
    if (!ks.length) { m.noMno++; continue; }
    for (const k of ks) {
      const at = o.at || null;
      if (!(k in m.keys) || (at && (!m.keys[k] || at < m.keys[k]))) m.keys[k] = at;
    }
  }
  return m;
}

/** แยกทะเบียนจุดตรวจเป็น required (ต้องตรวจ · startAt = เวลาเปิดใบแรกของเครื่อง) / notRunning (ไม่เดิน = ไม่ต้องตรวจ) */
export function amTargetsByRun(tg = [], run, { mateKeysOf = null } = {}) {
  if (!run || !run.orders) return { required: tg, notRunning: [], mode: 'line', noMnoOrders: 0 };
  const keyN = Object.keys(run.keys || {}).length;
  if (!keyN) return { required: tg.map(t => ({ ...t, byLine: true })), notRunning: [], mode: 'line_no_mno', noMnoOrders: run.noMno };
  const required = [], notRunning = [];
  for (const t of tg) {
    const ks = amMachineKeys(t.machine_no);
    const hit = ks.filter(k => k in run.keys);
    if (hit.length) {
      const ats = hit.map(k => run.keys[k]).filter(Boolean).sort();
      required.push(ats.length ? { ...t, startAt: ats[0] } : { ...t });
      continue;
    }
    // 🧩 สถานี AM (23/11) — เพื่อนร่วมสถานีมีใบผลิต = ตัวนี้ต้องตรวจด้วย (robot ไม่เคยอยู่บนใบผลิต)
    const mates = (mateKeysOf ? mateKeysOf(t.jig_id) : null) || [];
    const mh = mates.filter(k => k in run.keys);
    if (mh.length) {
      const ats = mh.map(k => run.keys[k]).filter(Boolean).sort();
      required.push(ats.length ? { ...t, startAt: ats[0], viaStation: true } : { ...t, viaStation: true });
    } else if (!ks.length || run.noMno > 0) {
      required.push({ ...t, byLine: true });
    } else {
      notRunning.push(t);
    }
  }
  return { required, notRunning, mode: run.noMno > 0 ? 'mixed' : 'machine', noMnoOrders: run.noMno };
}

/** 🧩 เพื่อนร่วมสถานี AM → machineKey ของเพื่อน (สำเนา `stationMateKeysFn` ฝั่งจอ · null = ไม่มีข้อมูลสถานี) */
export function stationMateKeysFn(amStations, machineNoOf) {
  if (!amStations || !Array.isArray(amStations.stations) || !Array.isArray(amStations.members)) return null;
  const active = new Set(amStations.stations.filter(s => s && s.is_active !== false).map(s => s.id));
  const byStation = new Map(), stationOf = new Map();
  for (const m of amStations.members) {
    if (!m || !active.has(m.station_id)) continue;
    if (!byStation.has(m.station_id)) byStation.set(m.station_id, []);
    byStation.get(m.station_id).push(m.jig_id);
    stationOf.set(m.jig_id, m.station_id);
  }
  return (jigId) => {
    const sid = stationOf.get(jigId);
    if (!sid) return [];
    return [...new Set(byStation.get(sid).filter(id => id !== jigId).flatMap(id => amMachineKeys(machineNoOf(id))))];
  };
}
