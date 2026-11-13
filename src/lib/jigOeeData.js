/* 🏭 โหลดข้อมูล OEE รายจิ๊ก (ข้อมูลเครื่องจาก Node-RED + ใบผลิต/NG/CT ของ ESM) — ใช้ร่วม /line-oee + /oee-analytics
   📄 docs/modules/integration-hub.md §OEE รายจิ๊ก · สูตร = src/utils/machineOee.js (ไฟล์นี้ "โหลด+ประกอบ" อย่างเดียว ไม่คิดสูตร)

   ตัวเชื่อม 3 ตัว: เวลา (กรอบกะ ESM) · เครื่อง (machine_tag_map → machines.id) · พาร์ท (prod_orders.machine_no ตอนเปิดใบ)
   🔴 อ่านไม่ได้ = คืน `errors[]` ให้จอเขียนบอก ห้ามคืนลิสต์ว่างเงียบ · ตารางฝั่ง DR อ่านด้วย anon (กฎเหล็ก supabaseDR)
   ⚠️ egress: เลือกคอลัมน์ · ช่วงหยุดดึงเฉพาะกรอบที่ถาม · ชิ้นดึงรายชั่วโมงผ่าน RPC · ย้อนหลังหลายกะใช้ rpc rollup */
import { supabaseDR } from '../supabaseClient';
import { fetchAllRows } from '../utils/fetchAllRows';
import { fetchByIds } from '../utils/fetchByIds';
import { loadMachinesMaster } from '../utils/useMachines';
import { loadCtProducts, loadCtKanban } from '../utils/oeeMasters';
import { buildCtMap, defectQty, defectQtyAll, QBIN_EMBED } from '../utils/oee';
import { machineKey } from '../utils/machineNo';
import { SESSION_STATUSES_REAL } from '../utils/sessionStatus';
import {
  shiftBounds, aggregateStops, aggregateFromRollup, machineShiftOee, jigCt, stateSegments, hourlyBuckets, stopList, stopPareto,
} from '../utils/machineOee';

const EV_COLS = 'source_id, machine_tag, started_at, ended_at, duration_sec, state, reason_code, reason_text, is_minor';
/** สถานะสดเก่ากว่านี้ = ต้นทางเงียบ ⇒ การ์ดเขียนว่า "สถานะสดขาด" ไม่โชว์เหมือนยังสด */
export const LIVE_STALE_MS = 3 * 60000;

/** จิ๊กที่ผูกกับ Node-RED แล้ว (+ ทะเบียนเครื่อง) · lineNames = จำกัดไลน์ (null = ทุกไลน์) */
export async function loadLinkedJigs(lineNames = null) {
  const errors = [];
  const [tm, machines] = await Promise.all([
    supabaseDR.from('machine_tag_map').select('source_id, tag, machine_id').not('machine_id', 'is', null),
    loadMachinesMaster().catch(() => null),
  ]);
  if (tm.error) errors.push('การผูกเครื่องกับ Node-RED');
  if (!machines) errors.push('ทะเบียนเครื่อง');
  const byId = new Map((machines || []).map(m => [m.id, m]));
  const want = lineNames ? new Set(lineNames) : null;
  const jigs = (tm.data || []).map(t => {
    const m = byId.get(t.machine_id);
    return m ? { sourceId: t.source_id, tag: t.tag, machineId: m.id, machineNo: m.machine_no, machineName: m.machine_name || null, lineName: m.line_name || null } : null;
  }).filter(j => j && (!want || want.has(j.lineName)))
    // คีย์ (ต้นทาง, tag) ไม่ซ้ำโดย unique ฝั่ง DB อยู่แล้ว — กันซ้ำอีกชั้นไม่ให้การ์ด/แถวโผล่ 2 ครั้ง
    .filter((j, i, arr) => arr.findIndex(x => x.sourceId === j.sourceId && x.tag === j.tag) === i)
    .sort((a, b) => String(a.machineNo).localeCompare(String(b.machineNo), 'th', { numeric: true }));
  return { jigs, errors };
}

/** ใบผลิตของจิ๊กในช่วง (กะที่ไม่ใช่โมฆะ) + NG ที่คนลงของใบเหล่านั้น */
async function loadOrdersAndNg(jigs, { fromDate, toDate, workDate = null, shift = null }) {
  const errors = [];
  const nos = [...new Set(jigs.map(j => j.machineNo).filter(Boolean))];
  if (!nos.length) return { orders: [], defects: [], errors };
  const o = await fetchAllRows(supabaseDR, 'prod_orders',
    'id, mat_no, machine_no, qty, qty_ok, status, opened_at, confirmed_at, production_sessions!inner(work_date, shift, line_name, status)',
    (q0) => {
      let q = q0.in('machine_no', nos).in('production_sessions.status', SESSION_STATUSES_REAL);
      q = workDate ? q.eq('production_sessions.work_date', workDate) : q.gte('production_sessions.work_date', fromDate).lte('production_sessions.work_date', toDate);
      if (shift) q = q.eq('production_sessions.shift', shift);
      return q.order('id');
    });
  if (o.error) { errors.push('ใบผลิต'); return { orders: [], defects: [], errors }; }
  const orders = (o.data || []).filter(r => r.status !== 'cancelled');
  const d = await fetchByIds(orders.map(r => r.id), part => supabaseDR.from('defect_logs')
    .select(`id, prod_order_id, qty_ng, qty_suspect, is_trial, ${QBIN_EMBED}`).in('prod_order_id', part));
  if (d.error || d.truncated) errors.push('NG ที่คนลง');
  return { orders, defects: d.rows || [], errors };
}

async function loadCtMapSafe() {
  const [prods, kstds] = await Promise.all([loadCtProducts().catch(() => null), loadCtKanban().catch(() => null)]);
  return { ctMap: buildCtMap({ kanbanStds: kstds || [], products: prods || [] }), failed: !prods || !kstds };
}

const ordersOfJig = (orders, jig, workDate, shift) => orders.filter(o =>
  machineKey(o.machine_no) === machineKey(jig.machineNo)
  && (!workDate || (o.production_sessions?.work_date === workDate && o.production_sessions?.shift === shift)));

function ngPeopleOf(orders, defects) {
  if (!orders.length) return { ngPeople: null, ngAll: null };
  const ids = new Set(orders.map(o => o.id));
  const mine = defects.filter(d => ids.has(d.prod_order_id) && !d.is_trial);
  return { ngPeople: mine.reduce((s, d) => s + defectQty(d), 0), ngAll: mine.reduce((s, d) => s + defectQtyAll(d), 0) };
}

/**
 * 1 กะ ละเอียด (การ์ดจอหน้าไลน์ + ดูลึกรายเครื่อง)
 * @returns `{ jigs: [{ ...jig, win, events, hourly, orders, ctInfo, oee, segments, buckets, stops, pareto }], errors }`
 */
export async function loadJigShift({ lineNames = null, workDate, shift, nowMs = Date.now(), jigFilter = null }) {
  const win = shiftBounds(workDate, shift);
  if (!win) return { jigs: [], errors: ['วัน/กะไม่ถูกต้อง'] };
  const linked = await loadLinkedJigs(lineNames);
  let jigs = linked.jigs;
  if (jigFilter) jigs = jigs.filter(jigFilter);
  const errors = [...linked.errors];
  if (!jigs.length) return { jigs: [], errors };
  const end = Math.min(win.endMs, nowMs);
  const srcIds = [...new Set(jigs.map(j => j.sourceId))];
  const isNow = nowMs >= win.startMs && nowMs < win.endMs;
  const [evR, hrR, od, ct, lvR] = await Promise.all([
    fetchAllRows(supabaseDR, 'machine_state_events', EV_COLS, q => q.in('source_id', srcIds).in('machine_tag', jigs.map(j => j.tag))
      .lt('started_at', new Date(win.endMs).toISOString()).gte('started_at', new Date(win.startMs - 12 * 3600000).toISOString())
      .order('started_at').order('machine_tag')),
    Promise.all(srcIds.map(sid => supabaseDR.rpc('fn_machine_counter_hourly', {
      p_source: sid, p_from: new Date(win.startMs).toISOString(), p_to: new Date(win.endMs).toISOString(),
    }).then(r => ({ sid, ...r })))),
    loadOrdersAndNg(jigs, { workDate, shift }),
    loadCtMapSafe(),
    // สถานะสด — มีความหมายเฉพาะกะที่กำลังเดิน · ตารางยังไม่มี/อ่านไม่ได้ = ไม่โชว์สถานะสด (การ์ดถอยไปสถานะล่าสุดที่รู้ + บอก)
    isNow ? supabaseDR.from('machine_live_state').select('source_id, machine_tag, state_code, state_text, since, alarm_text, onplan_text, unplan_text, production_enable, received_at')
      .in('source_id', srcIds).in('machine_tag', jigs.map(j => j.tag)) : Promise.resolve({ data: [] }),
  ]);
  if (evR.error) errors.push('ช่วงหยุดของเครื่อง');
  if (lvR.error) errors.push('สถานะสดของเครื่อง');
  if (hrR.some(r => r.error)) errors.push('นับชิ้นจากเครื่อง');
  errors.push(...od.errors);
  if (ct.failed) errors.push('CT ของพาร์ท');
  const hourlyAll = hrR.flatMap(r => (r.data || []).map(x => ({ ...x, source_id: r.sid })));
  const out = jigs.map(j => {
    const events = (evR.data || []).filter(e => e.source_id === j.sourceId && e.machine_tag === j.tag);
    const hourly = hourlyAll.filter(h => h.source_id === j.sourceId && h.machine_tag === j.tag);
    const orders = ordersOfJig(od.orders, j);
    const ctInfo = jigCt(orders, ct.ctMap);
    const { ngPeople, ngAll } = ngPeopleOf(orders, od.defects);
    const pieces = hourly.length ? hourly.reduce((s, h) => s + (Number(h.qty) || 0), 0) : null;
    const ngMachine = hourly.reduce((s, h) => s + (Number(h.ng) || 0), 0);
    const w = { startMs: win.startMs, endMs: end };
    const oee = machineShiftOee({ agg: aggregateStops(events, w), pieces, ngMachine, ngPeople, elapsedSec: Math.max(0, (end - win.startMs) / 1000), ct: ctInfo.ct });
    if (ctInfo.why && !oee.why.includes(ctInfo.why)) oee.why.unshift(ctInfo.why);
    const last = events.length ? events[events.length - 1] : null;
    const lv = (lvR.data || []).find(r => r.source_id === j.sourceId && r.machine_tag === j.tag);
    const live = lv ? {
      text: [lv.state_text, lv.alarm_text, lv.unplan_text, lv.onplan_text].filter(t => t && t !== 'None').join(' · ') || (lv.state_code != null ? `สถานะ ${lv.state_code}` : 'ไม่ทราบ'),
      sinceMs: lv.since ? Date.parse(lv.since) : null, receivedMs: Date.parse(lv.received_at),
      stale: nowMs - Date.parse(lv.received_at) > LIVE_STALE_MS, productionEnable: lv.production_enable,
    } : null;
    return {
      ...j, win, endMs: end, events, hourly, orders, ctInfo, ngAll, oee, live,
      segments: stateSegments(events, w),
      buckets: hourlyBuckets({ hourly, events, startMs: win.startMs, endMs: win.endMs, nowMs, ct: ctInfo.ct }),
      stops: stopList(events, w), pareto: stopPareto(events, w),
      lastEventAt: last ? Date.parse(last.ended_at || last.started_at) : null,
      lastPieceHour: hourly.length ? Date.parse(hourly[hourly.length - 1].hour_at) : null,
      confirmedQty: orders.reduce((s, o) => s + (o.status === 'confirmed' ? Number(o.qty_ok ?? o.qty) || 0 : 0), 0),
      planQty: orders.reduce((s, o) => s + (Number(o.qty) || 0), 0),
    };
  });
  return { jigs: out, errors };
}

/**
 * หลายกะ (รายงานย้อนหลัง) — rollup ฝั่ง DB · คืนแถวราย จิ๊ก × วันทำงาน × กะ
 * @returns `{ rows: [{ ...jig, workDate, shift, oee, ctInfo, orders }], jigs, errors }`
 */
export async function loadJigReport({ lineNames = null, fromDate, toDate, nowMs = Date.now() }) {
  const linked = await loadLinkedJigs(lineNames);
  const errors = [...linked.errors];
  const jigs = linked.jigs;
  if (!jigs.length) return { rows: [], jigs, errors };
  const fromMs = Date.parse(`${fromDate}T08:00:00+07:00`);
  const toMs = Math.min(Date.parse(`${toDate}T08:00:00+07:00`) + 24 * 3600000, nowMs);
  const srcIds = [...new Set(jigs.map(j => j.sourceId))];
  const [facts, hrs, od, ct] = await Promise.all([
    Promise.all(srcIds.map(sid => supabaseDR.rpc('fn_machine_shift_facts', { p_source: sid, p_from: new Date(fromMs).toISOString(), p_to: new Date(toMs).toISOString() }).then(r => ({ sid, ...r })))),
    Promise.all(srcIds.map(sid => supabaseDR.rpc('fn_machine_counter_hourly', { p_source: sid, p_from: new Date(fromMs).toISOString(), p_to: new Date(toMs).toISOString() }).then(r => ({ sid, ...r })))),
    loadOrdersAndNg(jigs, { fromDate, toDate }),
    loadCtMapSafe(),
  ]);
  if (facts.some(r => r.error)) errors.push('ช่วงหยุดของเครื่อง (สรุปรายกะ)');
  if (hrs.some(r => r.error)) errors.push('นับชิ้นจากเครื่อง');
  errors.push(...od.errors);
  if (ct.failed) errors.push('CT ของพาร์ท');
  const keyOf = (wd, sh) => `${wd}|${sh}`;
  const shiftOfHour = (ms) => {
    const local = new Date(ms + 7 * 3600000);
    const h = local.getUTCHours();
    const wd = new Date(ms + 7 * 3600000 - 8 * 3600000);
    return keyOf(`${wd.getUTCFullYear()}-${String(wd.getUTCMonth() + 1).padStart(2, '0')}-${String(wd.getUTCDate()).padStart(2, '0')}`, h >= 8 && h < 20 ? 'day' : 'night');
  };
  const rows = [];
  for (const j of jigs) {
    const f = (facts.find(r => r.sid === j.sourceId)?.data || []).filter(r => r.machine_tag === j.tag);
    const h = (hrs.find(r => r.sid === j.sourceId)?.data || []).filter(r => r.machine_tag === j.tag);
    const keys = new Set([...f.map(r => keyOf(r.work_date, r.shift)), ...h.map(r => shiftOfHour(Date.parse(r.hour_at)))]);
    for (const k of keys) {
      const [wd, sh] = k.split('|');
      if (wd < fromDate || wd > toDate) continue;
      const win = shiftBounds(wd, sh);
      if (!win) continue;
      const hh = h.filter(r => shiftOfHour(Date.parse(r.hour_at)) === k);
      const orders = ordersOfJig(od.orders, j, wd, sh);
      const ctInfo = jigCt(orders, ct.ctMap);
      const { ngPeople } = ngPeopleOf(orders, od.defects);
      const end = Math.min(win.endMs, nowMs);
      const oee = machineShiftOee({
        agg: aggregateFromRollup(f.filter(r => keyOf(r.work_date, r.shift) === k)),
        pieces: hh.length ? hh.reduce((s, r) => s + (Number(r.qty) || 0), 0) : null,
        ngMachine: hh.reduce((s, r) => s + (Number(r.ng) || 0), 0), ngPeople,
        elapsedSec: Math.max(0, (end - win.startMs) / 1000), ct: ctInfo.ct,
      });
      if (ctInfo.why && !oee.why.includes(ctInfo.why)) oee.why.unshift(ctInfo.why);
      rows.push({ ...j, workDate: wd, shift: sh, oee, ctInfo, orders, open: end < win.endMs });
    }
  }
  rows.sort((a, b) => (a.workDate === b.workDate ? (a.shift === b.shift ? String(a.machineNo).localeCompare(String(b.machineNo)) : a.shift === 'night' ? -1 : 1) : a.workDate < b.workDate ? 1 : -1));
  return { rows, jigs, errors };
}

/** รวมหลายกะ/หลายจิ๊กเป็นก้อนเดียว — ถ่วงด้วยเวลา (ไม่เฉลี่ย % ตรงๆ) · ใช้สูตรเดียวกับรายกะ */
export function combineJigRows(rows = []) {
  const s = { plannedSec: 0, operatingSec: 0, idealSec: 0, pieces: 0, good: 0, ngMachine: 0, minorSec: 0, faultN: 0, faultSec: 0, hasP: true, hasQ: true, idealKnownOpSec: 0 };
  for (const r of rows) {
    const o = r.oee;
    s.plannedSec += o.plannedSec; s.operatingSec += o.operatingSec; s.minorSec += o.minorSec;
    s.pieces += o.pieces || 0; s.ngMachine += o.ngMachine || 0;
    s.faultN += (o.counts.alarm || 0) + (o.counts.alarmMinor || 0); s.faultSec += (o.loss.fault || 0) + (o.loss.minorFault || 0);
    if (o.idealSec != null) { s.idealSec += o.idealSec; s.idealKnownOpSec += o.operatingSec; } else if (o.operatingSec > 0) s.hasP = false;
    if (o.good != null) s.good += o.good; else if ((o.pieces || 0) > 0) s.hasQ = false;
  }
  const A = s.plannedSec > 0 ? s.operatingSec / s.plannedSec : null;
  const P = s.idealKnownOpSec > 0 ? Math.min(1, s.idealSec / s.idealKnownOpSec) : null;
  const Q = s.pieces > 0 && s.hasQ ? s.good / s.pieces : null;
  return {
    ...s, A, P, Q, oee: A != null && P != null && Q != null ? A * P * Q : null,
    partialP: !s.hasP && P != null, partialQ: !s.hasQ,
    mttrMin: s.faultN ? s.faultSec / 60 / s.faultN : null, mtbfMin: s.faultN ? s.operatingSec / 60 / s.faultN : null,
  };
}
