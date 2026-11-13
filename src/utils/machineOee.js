/* 🏭 OEE รายจิ๊ก/เครื่อง จากข้อมูลเครื่อง (Node-RED ผ่านศูนย์เชื่อมต่อ) — สูตรของ ESM (2026-11-13 · คำสั่ง user "ทำให้หมด")
   📄 docs/modules/integration-hub.md §OEE รายจิ๊ก · ข้อเท็จจริงจาก src/utils/machineFacts.js

   🔴 ต้นทางส่ง "ข้อเท็จจริง" (ช่วงหยุด · ชิ้นต่อนาที) — **ESM เป็นเจ้าของสูตร** ไม่รับ % จากต้นทาง
   🔴 เลขชุดนี้ = OEE "รายจิ๊ก" แยกจาก OEE ไลน์ที่ stamp ตอนปิดกะ (oee.js · computeSessionOee) — **ห้ามเอาไปทับ/เฉลี่ยรวม**
   🔴 ไม่รู้ = null ไม่ใช่ 0 · ทุก null ต้องมีเหตุผลใน `why` ให้จอเขียนบอก

   นิยามเวลา (ต่อจิ๊ก ต่อกะ · วินาที):
     elapsed   = กรอบกะที่ผ่านไปแล้ว (ตัดที่ "ตอนนี้")
     excluded  = ไม่มีแผน (no_plan) + หยุดตามแผน (planned_stop: พัก/Tip dressing) + ขาดการสื่อสาร (comm_loss — ไม่รู้ ⇒ กันออก+บอก)
     planned   = elapsed − excluded                                  ← ตัวหาร A
     downLoss  = Alarm (fault) + หยุดนอกแผน (unplanned) + รอ/Idle ที่ "ไม่ใช่หยุดสั้น"   ← เสีย A
     operating = planned − downLoss                                  ← ตัวหาร P
     minorLoss = หยุดสั้น (is_minor) ของ fault/unplanned                ← เสีย P (micro-stop · SCADA doc §4)
     ⚠️ idle ที่เป็นหยุดสั้น = จังหวะโหลดงานระหว่างรอบ ⇒ นับเป็นเวลาเดิน (ตรงกับจอ Node-RED: Idle≥2 นาที 33 น. = ของเรา 33.4 น.)
   P = ชิ้นทั้งหมด (รวม NG) × CT ÷ operating   · CT = ของ MAT ในใบผลิตที่เปิดบนจิ๊กนี้ (`prod_orders.machine_no`)
     ไม่มีใบบนจิ๊กในกะ / MAT ไม่มี CT = P null (ห้ามใช้ ideal ของต้นทางแทน — CT เป็น master ของ ESM)
   Q = (ชิ้น − NG ที่คนลง) ÷ ชิ้น · NG ที่คนลง = defect_logs ของใบบนจิ๊ก (defectQty — กฎ "ของสงสัยยังไม่ใช่ของเสีย")
     NG ที่กดหน้าเครื่อง = โชว์คู่ (ข้อมูลเสนอ) ไม่ใช้คิด · ไม่มีใบ = Q null (ไม่รู้ว่าคนตัดสินอะไร)
   OEE = A × P × Q (ทุกตัวต้องไม่ null) */

const H = 3600000;
const BKK = 7 * H;
const tms = (v) => {
  if (v == null || v === '') return null;
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/** กรอบกะ ESM เป็น epoch ms — เช้า 08–20 · ดึก 20–08 (เวลาไทยตรงๆ) */
export function shiftBounds(workDate, shift) {
  const base = Date.parse(`${workDate}T00:00:00+07:00`);
  if (!Number.isFinite(base) || !(shift === 'day' || shift === 'night')) return null;
  const s = base + (shift === 'night' ? 20 : 8) * H;
  return { startMs: s, endMs: s + 12 * H };
}

export const DOWN_STATES = ['fault', 'unplanned', 'idle'];          // เสีย A (เมื่อไม่ใช่หยุดสั้น)
export const MINOR_LOSS_STATES = ['fault', 'unplanned'];           // หยุดสั้นที่นับเสีย P
export const EXCLUDED_STATES = ['no_plan', 'planned_stop', 'comm_loss'];

/** ตัดช่วง [s,e) ให้อยู่ในกรอบ [a,b) — คืนวินาที */
const clipSec = (s, e, a, b) => Math.max(0, (Math.min(e, b) - Math.max(s, a)) / 1000);

/** แถวช่วงหยุด (machine_state_events) → ก้อนรวม `{ [state]: { sec, minorSec, n, minorN } }` ในกรอบ */
export function aggregateStops(events = [], { startMs, endMs }) {
  const agg = {};
  for (const ev of events || []) {
    const s = tms(ev?.started_at);
    if (s == null) continue;
    const e = tms(ev.ended_at) ?? (ev.duration_sec != null && Number.isFinite(Number(ev.duration_sec)) ? s + Number(ev.duration_sec) * 1000 : null);
    if (e == null || !(e > s)) continue;
    const sec = clipSec(s, e, startMs, endMs);
    if (!(sec > 0)) continue;
    const a = (agg[ev.state] ||= { sec: 0, minorSec: 0, n: 0, minorN: 0 });
    const first = s >= startMs && s < endMs;
    if (ev.is_minor) { a.minorSec += sec; if (first) a.minorN++; } else { a.sec += sec; if (first) a.n++; }
  }
  return agg;
}

/** แถวจาก rpc fn_machine_shift_facts (state, is_minor, sec, n) → ก้อนรวมรูปเดียวกับ aggregateStops */
export function aggregateFromRollup(rows = []) {
  const agg = {};
  for (const r of rows || []) {
    const a = (agg[r.state] ||= { sec: 0, minorSec: 0, n: 0, minorN: 0 });
    if (r.is_minor) { a.minorSec += Number(r.sec) || 0; a.minorN += Number(r.n) || 0; }
    else { a.sec += Number(r.sec) || 0; a.n += Number(r.n) || 0; }
  }
  return agg;
}

const g = (agg, st, k = 'sec') => Number(agg?.[st]?.[k]) || 0;

/**
 * CT (วินาที/ชิ้น) ของจิ๊กในกะ จากใบผลิตบนจิ๊ก
 * @returns `{ ct, mats, mixed, why }` · หลาย MAT CT ต่างกัน = ใช้ค่าถ่วงตามจำนวนชิ้นที่คนยืนยัน (mixed=true ให้จอบอก)
 */
export function jigCt(orders = [], ctMap = {}) {
  const mats = [...new Set((orders || []).map(o => o?.mat_no).filter(Boolean))];
  if (!mats.length) return { ct: null, mats, mixed: false, why: 'no_order' };
  const known = mats.filter(m => Number(ctMap?.[m]) > 0);
  if (!known.length) return { ct: null, mats, mixed: false, why: 'no_ct' };
  const cts = [...new Set(known.map(m => Number(ctMap[m])))];
  if (cts.length === 1) return { ct: cts[0], mats, mixed: false, why: known.length < mats.length ? 'partial_ct' : null };
  let w = 0, sum = 0;
  for (const o of orders) {
    const c = Number(ctMap?.[o?.mat_no]);
    const q = Number(o?.qty_ok ?? o?.qty) || 0;
    if (c > 0 && q > 0) { w += q; sum += q * c; }
  }
  return { ct: w > 0 ? sum / w : Math.max(...cts), mats, mixed: true, why: 'mixed_ct' };
}

/**
 * OEE ของจิ๊ก 1 ตัว 1 กะ
 * @param {object} p
 *   agg       ก้อนรวมช่วงหยุด (aggregateStops / aggregateFromRollup)
 *   pieces    ชิ้นทั้งหมดจากเครื่อง (รวม NG) · null = ไม่มีข้อมูลนับชิ้น
 *   ngMachine NG ที่กดหน้าเครื่อง · ngPeople NG ที่คนลง (null = ไม่มีใบ ⇒ ไม่รู้)
 *   elapsedSec กรอบกะที่ผ่านไป · ct วินาที/ชิ้น (null = ไม่รู้)
 */
export function machineShiftOee({ agg = {}, pieces = null, ngMachine = 0, ngPeople = null, elapsedSec, ct = null }) {
  const why = [];
  const excludedSec = EXCLUDED_STATES.reduce((s, st) => s + g(agg, st) + g(agg, st, 'minorSec'), 0);
  const commLossSec = g(agg, 'comm_loss') + g(agg, 'comm_loss', 'minorSec');
  const plannedSec = Math.max(0, (Number(elapsedSec) || 0) - excludedSec);
  const loss = {
    fault: g(agg, 'fault'), unplanned: g(agg, 'unplanned'), idle: g(agg, 'idle'),
    minorFault: g(agg, 'fault', 'minorSec'), minorUnplanned: g(agg, 'unplanned', 'minorSec'),
    minorIdle: g(agg, 'idle', 'minorSec'),
  };
  const downSec = Math.min(plannedSec, loss.fault + loss.unplanned + loss.idle);
  const operatingSec = Math.max(0, plannedSec - downSec);
  const minorSec = Math.min(operatingSec, loss.minorFault + loss.minorUnplanned);
  const counts = {
    alarm: Number(agg?.fault?.n) || 0, alarmMinor: Number(agg?.fault?.minorN) || 0,
    unplanned: Number(agg?.unplanned?.n) || 0, idle: Number(agg?.idle?.n) || 0,
    minor: (Number(agg?.fault?.minorN) || 0) + (Number(agg?.unplanned?.minorN) || 0),
  };
  if (commLossSec > 0) why.push('comm_loss');

  const A = plannedSec > 0 ? operatingSec / plannedSec : null;
  if (A == null) why.push('no_planned_time');

  let P = null, idealSec = null, pOver = false;
  if (pieces == null) why.push('no_pieces');
  else if (!(ct > 0)) why.push('no_ct');
  else if (!(operatingSec > 0)) why.push('no_operating');
  else {
    idealSec = pieces * ct;
    const raw = idealSec / operatingSec;
    pOver = raw > 1.001;
    P = Math.min(1, raw);
  }

  let Q = null, good = null;
  if (pieces != null && pieces > 0 && ngPeople != null) {
    good = Math.max(0, pieces - ngPeople);
    Q = good / pieces;
  } else if (pieces != null && pieces > 0) why.push('no_people_q');

  const oee = A != null && P != null && Q != null ? A * P * Q : null;

  /* ⏬ น้ำตกเวลา (วินาที) — ก้อนสุดท้าย = เวลาที่ได้ของดี · ต้องรู้ CT ถึงแตก "ช้ากว่า CT" กับ "เสียเป็น NG" ได้ */
  const fallSpeed = idealSec != null ? Math.max(0, operatingSec - minorSec - idealSec) : null;
  const ngLossSec = idealSec != null && good != null ? Math.max(0, (pieces - good) * ct) : null;
  const waterfall = {
    plannedSec, fault: loss.fault, unplanned: loss.unplanned, idle: loss.idle, operatingSec,
    minorSec, speedSec: fallSpeed, netSec: idealSec, ngSec: ngLossSec,
    fullySec: idealSec != null && ngLossSec != null ? Math.max(0, idealSec - ngLossSec) : null,
  };

  const faultTotalN = counts.alarm + counts.alarmMinor;
  const faultTotalSec = loss.fault + loss.minorFault;
  return {
    A, P, Q, oee, pOver, why,
    plannedSec, excludedSec, commLossSec, downSec, operatingSec, minorSec, idealSec,
    pieces, good, ngMachine: Number(ngMachine) || 0, ngPeople, ct,
    avgCycleSec: pieces > 0 && operatingSec > 0 ? operatingSec / pieces : null,
    mttrMin: faultTotalN > 0 ? faultTotalSec / 60 / faultTotalN : null,
    mtbfMin: faultTotalN > 0 ? operatingSec / 60 / faultTotalN : null,
    counts, loss, waterfall,
  };
}

/** ข้อความภาษาไทยของเหตุที่ตัวเลขเป็น null — จอต้องเขียนบอก ห้ามโชว์ 0 */
export const WHY_TEXT = {
  no_order: 'ไม่มีใบผลิตบนจิ๊กนี้ในกะ — ตอนเปิดใบให้เลือกเครื่องนี้ ESM ถึงรู้ CT และ NG',
  no_ct: 'พาร์ทในใบยังไม่ได้ตั้ง CT — คิด %P ไม่ได้',
  partial_ct: 'บางพาร์ทในใบยังไม่ได้ตั้ง CT',
  mixed_ct: 'มีหลายพาร์ท CT ต่างกัน — ใช้ CT ถ่วงตามยอดที่คนยืนยัน',
  no_pieces: 'ยังไม่มีข้อมูลนับชิ้นจากเครื่อง',
  no_operating: 'ยังไม่มีเวลาเดินเครื่อง',
  no_planned_time: 'ไม่มีเวลาแผนผลิต (ไม่มีแผน/พักทั้งช่วง)',
  no_people_q: 'ไม่มีใบผลิตบนจิ๊ก — ยังไม่รู้ NG ที่คนตัดสิน (%Q)',
  comm_loss: 'มีช่วงขาดการสื่อสาร — กันออกจากเวลาแผน (ไม่นับเป็นเสีย)',
};

/** แถบสถานะตลอดกะ — ช่องว่างระหว่างช่วงหยุด = เดินเครื่อง · คืน `[{ startMs, endMs, kind }]` เรียงเวลา
 *  kind: run | minor | fault | unplanned | idle | planned_stop | no_plan | comm_loss | other */
export function stateSegments(events = [], { startMs, endMs }) {
  const segs = [];
  const evs = (events || []).map(ev => {
    const s = tms(ev?.started_at);
    const e = s == null ? null : (tms(ev.ended_at) ?? (ev.duration_sec != null ? s + Number(ev.duration_sec) * 1000 : null));
    return s != null && e != null && e > s ? { s: Math.max(s, startMs), e: Math.min(e, endMs), ev } : null;
  }).filter(x => x && x.e > x.s).sort((a, b) => a.s - b.s);
  let cur = startMs;
  for (const x of evs) {
    if (x.s > cur) segs.push({ startMs: cur, endMs: x.s, kind: 'run' });
    const st = x.ev.state;
    const kind = x.ev.is_minor && MINOR_LOSS_STATES.includes(st) ? 'minor'
      : x.ev.is_minor && st === 'idle' ? 'run' : st;
    const s = Math.max(x.s, cur);
    if (x.e > s) {
      const last = segs[segs.length - 1];
      if (last && last.kind === kind && last.endMs >= s) last.endMs = Math.max(last.endMs, x.e);
      else segs.push({ startMs: s, endMs: x.e, kind, reason: x.ev.reason_text || null, code: x.ev.reason_code ?? null });
      cur = Math.max(cur, x.e);
    }
  }
  if (endMs > cur) segs.push({ startMs: cur, endMs, kind: 'run' });
  // รวมช่วง run ที่ติดกัน (idle สั้นถูกนับเป็น run)
  const out = [];
  for (const sg of segs) {
    const last = out[out.length - 1];
    if (last && last.kind === sg.kind && last.endMs >= sg.startMs && sg.kind === 'run') last.endMs = sg.endMs;
    else out.push({ ...sg });
  }
  return out;
}

/** รายชั่วโมงของกะ — ชิ้น/NG จากเครื่อง · เวลาแผนต่อชั่วโมง · เป้า = เวลาแผน ÷ CT · OEE ชั่วโมง = ชิ้นดี×CT ÷ เวลาแผน
 *  hourly = แถวจาก rpc fn_machine_counter_hourly ของจิ๊กนี้ · events = ช่วงหยุด */
export function hourlyBuckets({ hourly = [], events = [], startMs, endMs, nowMs, ct = null }) {
  const end = Math.min(endMs, nowMs ?? endMs);
  const out = [];
  for (let h = startMs; h < endMs; h += H) {
    const he = h + H;
    const row = (hourly || []).find(r => tms(r.hour_at) === h);
    const elapsed = Math.max(0, (Math.min(he, end) - h) / 1000);
    let excl = 0;
    for (const ev of events || []) {
      if (!EXCLUDED_STATES.includes(ev?.state)) continue;
      const s = tms(ev.started_at);
      const e = tms(ev.ended_at) ?? (s != null && ev.duration_sec != null ? s + Number(ev.duration_sec) * 1000 : null);
      if (s != null && e != null) excl += clipSec(s, e, h, Math.min(he, end));
    }
    const plannedSec = Math.max(0, elapsed - excl);
    const qty = row ? Number(row.qty) || 0 : null;
    const ng = row ? Number(row.ng) || 0 : null;
    out.push({
      hourMs: h, future: h >= end, qty, ng, plannedSec,
      target: ct > 0 ? Math.floor(plannedSec / ct) : null,
      oee: ct > 0 && plannedSec > 0 && qty != null ? Math.min(1, ((qty - (ng || 0)) * ct) / plannedSec) : null,
    });
  }
  return out;
}

/** รายการหยุด (ไม่รวมหยุดสั้น/idle สั้น และไม่มีแผน) ล่าสุดก่อน */
export function stopList(events = [], { startMs, endMs, limit = 200 } = {}) {
  return (events || []).filter(ev => !ev?.is_minor && ev?.state !== 'no_plan').map(ev => {
    const s = tms(ev.started_at);
    const e = tms(ev.ended_at) ?? (s != null && ev.duration_sec != null ? s + Number(ev.duration_sec) * 1000 : null);
    return s != null && e != null && e > startMs && s < endMs ? { startMs: s, endMs: e, min: (e - s) / 60000, state: ev.state, code: ev.reason_code ?? null, text: ev.reason_text || null } : null;
  }).filter(Boolean).sort((a, b) => b.startMs - a.startMs).slice(0, limit);
}

/** Pareto เวลาที่เสีย (A-loss + หยุดสั้น) แยกตามสถานะ+สาเหตุ — นาที มาก→น้อย */
export function stopPareto(events = [], { startMs, endMs }) {
  const m = new Map();
  for (const ev of events || []) {
    if (!DOWN_STATES.includes(ev?.state)) continue;
    if (ev.is_minor && ev.state === 'idle') continue;              // idle สั้น = จังหวะโหลดงาน ไม่ใช่เสีย
    const s = tms(ev.started_at);
    const e = tms(ev.ended_at) ?? (s != null && ev.duration_sec != null ? s + Number(ev.duration_sec) * 1000 : null);
    if (s == null || e == null) continue;
    const sec = clipSec(s, e, startMs, endMs);
    if (!(sec > 0)) continue;
    const label = ev.is_minor ? 'หยุดสั้น (< 2 นาที)' : `${ev.state}|${ev.reason_code ?? ''}|${ev.reason_text || ''}`;
    const r = m.get(label) || { key: label, state: ev.is_minor ? 'minor' : ev.state, code: ev.is_minor ? null : (ev.reason_code ?? null), text: ev.is_minor ? null : (ev.reason_text || null), min: 0, n: 0 };
    r.min += sec / 60; r.n++;
    m.set(label, r);
  }
  return [...m.values()].sort((a, b) => b.min - a.min);
}

/** 🔢 ทศนิยม → % ปัด 1 ตำแหน่ง (null คงเป็น null) */
export const pct1 = (v) => (v == null ? null : Math.round(v * 1000) / 10);
export { BKK };
