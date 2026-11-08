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
export function amTargetsByRun(tg = [], run) {
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
    } else if (!ks.length || run.noMno > 0) {
      required.push({ ...t, byLine: true });
    } else {
      notRunning.push(t);
    }
  }
  return { required, notRunning, mode: run.noMno > 0 ? 'mixed' : 'machine', noMnoOrders: run.noMno };
}
