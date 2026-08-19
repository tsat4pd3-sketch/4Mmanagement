/**
 * vsmLive — ชั้นข้อมูล "สด" (realtime layer) ทับโมเดล VSM · pure ไม่แตะ DB/DOM
 *
 * ใช้กับแท็บ ⚡ สายธารสด ใน /vsm: โมเดลโครงสร้าง (CT/C-O/AT/%OEE เดือนนี้) มาจาก
 * `buildVsmModel` ตามเดิม — ไฟล์นี้เติม "สถานะตอนนี้" ต่อกล่องกระบวนการ:
 *   สถานะไลน์ (down/run/closed/idle) · OEE กะปัจจุบัน · ยอดผลิตวันนี้ · downtime ค้าง
 *
 * ⚠️ กฎเหล็ก (เหมือน vsmModel): ตัวเลขทุกตัวมาจาก util กลาง ห้ามเขียนสูตรใหม่ที่นี่
 *   - OEE สด → `computeLiveOee` (utils/oee.js §4) — กะเปิด <10 นาที/ยังไม่ผลิต/ไม่มี CT
 *     คืน null + เหตุผล **ห้ามแปลงเป็น 0** (กฎ "ประเมินไม่ได้ = null")
 *   - OEE กะที่ปิดแล้ววันนี้ → ค่า stamp ผ่าน `wavg`+`wLoad` (ห้าม mean-of-percentages)
 *   - NG → `sumDefectQty(rows,'line')` จาก defect_logs (ไม่รวมงานทดลอง — กฎ %Q)
 *   - ผลิตได้ระหว่างกะ → `confirmed ? (qty_ok ?? qty) : (qty_actual ?? 0)` (สูตรบังคับ CLAUDE.md)
 *   - Andon → `isOpenDT`/`isPlannedDT` (utils/downtimeRules.js) — planned ไม่แดง แต่ห้ามซ่อน
 *
 * ⚠️ ชั้นนี้เป็น "มุมมองสด" เท่านั้น — ห้ามเอาไป stamp/บันทึกทับ snapshot ของใบ VSM
 */
// ⚠️ ใส่นามสกุล .js เพราะไฟล์นี้ถูกรันตรงด้วย node:test (Vite ก็รับได้) — ทุกตัวเป็น pure module
import { computeLiveOee, wavg, wLoad, sumDefectQty } from '../utils/oee.js';
import { parallelUnitsOf, isParallelLine } from '../utils/lineTypes.js';
import { isOpenDT, isPlannedDT, dtElapsedMin } from '../utils/downtimeRules.js';

const num = v => (v == null || v === '' ? null : (Number.isFinite(+v) ? +v : null));
const lk = s => String(s || '').trim().toLowerCase();

/** จัดกลุ่มแถวตาม session_id */
const bySession = rows => {
  const m = {};
  (rows || []).forEach(r => { if (r.session_id != null) (m[r.session_id] ||= []).push(r); });
  return m;
};

/**
 * สร้าง live layer
 * @param boxes     กล่องกระบวนการจากโมเดล (model.chain + feeder boxes) — ต้องมี key/line/matNo
 * @param sessions  production_sessions ของ "วันงานนี้" ของไลน์ในสาย
 *                  (ต้อง select: id, line_name, work_date, shift, shift_min, start_time, status, oee)
 * @param orders    prod_orders ของ session พวกนั้น (session_id, mat_no, status, qty, qty_ok, qty_actual, qty_target, qty_ng, machine_no?)
 * @param downtimes downtime_logs ของ session พวกนั้น (session_id, machine_no, description, started_at,
 *                  ended_at, duration_min, created_at, dr_downtime_types(name_th, category))
 * @param defects   defect_logs ของ session พวกนั้น (session_id, qty_ng, qty_suspect, is_trial, dr_defect_types(excl_from_q))
 * @param ctMap     จาก buildCtMap (utils/oee.js)
 * @param lines     production_lines (name, flow_mode, parallel_stations) — ใช้หา N เครื่องขนาน
 */
export function buildVsmLive({
  boxes = [], sessions = [], orders = [], downtimes = [], defects = [],
  ctMap = {}, lines = [], nowMs = Date.now(),
}) {
  const ordBy = bySession(orders);
  const dtBy = bySession(downtimes);
  const dfBy = bySession(defects);

  const lineRowByName = {};
  (lines || []).forEach(l => { lineRowByName[lk(l.name)] = l; });

  const sessByLine = {};
  (sessions || []).forEach(s => { (sessByLine[lk(s.line_name)] ||= []).push(s); });

  /* ── สถานะสดต่อ "ไลน์" (ไลน์เดียวโผล่หลายขั้นใน routing = ใช้ก้อนเดียวกัน) ── */
  const lineCache = {};
  const liveOfLine = (lineName) => {
    const key = lk(lineName);
    if (lineCache[key]) return lineCache[key];

    const ss = sessByLine[key] || [];
    const openSess = ss.find(s => s.status === 'open' || s.status === 'pending_close') || null;
    const closed = ss.filter(s => s.status === 'closed');
    const sessionIds = ss.map(s => s.id);

    const lineDts = sessionIds.flatMap(id => dtBy[id] || []);
    const openDts = lineDts.filter(isOpenDT);
    // planned เปิดค้าง = แสดงแบบสงบ (นับสต๊อก/ไม่มีแผน) — ห้ามนับเป็น Andon แต่ห้ามซ่อน
    const alarms = openDts.filter(d => !isPlannedDT(d))
      .map(d => ({
        machineNo: d.machine_no || null,
        typeName: d.dr_downtime_types?.name_th || null,
        description: d.description || null,
        openMin: dtElapsedMin(d, nowMs),
      }))
      .sort((a, b) => (b.openMin || 0) - (a.openMin || 0));
    const plannedOpen = openDts.filter(isPlannedDT).map(d => ({
      typeName: d.dr_downtime_types?.name_th || null, openMin: dtElapsedMin(d, nowMs),
    }));

    // OEE สดของกะที่เปิดอยู่ — parallelN หัก DT 1/N · parallelCap เฉพาะไลน์ parallel_machine
    const lineRow = lineRowByName[key] || null;
    const parallelN = parallelUnitsOf(lineRow);
    const parallelCap = isParallelLine(lineRow?.flow_mode) ? parallelUnitsOf(lineRow) : 1;
    const live = openSess ? computeLiveOee({
      session: openSess,
      orders: ordBy[openSess.id] || [],
      downtimes: dtBy[openSess.id] || [],
      ctMap,
      ngQty: sumDefectQty(dfBy[openSess.id] || [], 'line'),
      workDate: openSess.work_date,
      nowMs, parallelN, parallelCap,
    }) : null;

    // OEE กะที่ปิดแล้ววันนี้ = ค่า stamp ถ่วงเวลารับภาระ (plannedMin จาก DT category='planned')
    let closedOee = null;
    if (closed.length) {
      const withLoad = closed.map(s => ({
        ...s,
        plannedMin: (dtBy[s.id] || []).reduce((a, d) =>
          a + (isPlannedDT(d) ? (num(d.duration_min) || 0) : 0), 0),
      }));
      const v = wavg(withLoad, s => num(s.oee), wLoad);
      closedOee = v == null ? null : Math.round(v * 10) / 10;
    }

    const status = alarms.length ? 'down'
      : openSess ? 'run'
      : closed.length ? 'closed'
      : 'idle';

    lineCache[key] = {
      status, sessionIds,
      name: lineName,            // ชื่อจริง (ไม่ใช่ key lowercase) — แถบ Andon/summary ต้องใช้ตัวนี้
      shift: openSess?.shift || null,
      live,                      // ผลจาก computeLiveOee (null = ยังประเมินไม่ได้/ไม่มีกะเปิด)
      closedOee,                 // OEE กะที่ปิดแล้ววันนี้ (stamp · ถ่วงน้ำหนัก)
      alarms, plannedOpen,
    };
    return lineCache[key];
  };

  /* ── ต่อกล่อง: สถานะไลน์ + ยอดของ mat นั้นบนไลน์นั้นวันนี้ ── */
  const byKey = {};
  boxes.forEach(b => {
    if (!b.line) {
      byKey[b.key] = { status: 'unknown', reason: 'ขั้นนี้ยังไม่ได้ระบุไลน์ใน routing' };
      return;
    }
    const lv = liveOfLine(b.line);
    let produced = 0, target = 0, orderCount = 0;
    lv.sessionIds.forEach(id => {
      (ordBy[id] || []).forEach(o => {
        if (o.mat_no !== b.matNo) return;
        orderCount += 1;
        // สูตรบังคับ "ผลิตได้ระหว่างกะ" — ห้ามเปลี่ยน (CLAUDE.md §ยอดที่จะส่งต่อกะหน้า)
        produced += o.status === 'confirmed' ? (o.qty_ok ?? o.qty ?? 0) : (o.qty_actual ?? 0);
        target += (o.qty_target ?? o.qty ?? 0);
      });
    });
    byKey[b.key] = { ...lv, produced, target, orderCount };
  });

  /* ── สรุปทั้งสาย (นับต่อไลน์ ไม่นับซ้ำเมื่อไลน์โผล่หลายขั้น) ── */
  const perLine = Object.entries(lineCache);
  const summary = {
    down: perLine.filter(([, v]) => v.status === 'down').length,
    run: perLine.filter(([, v]) => v.status === 'run').length,
    closed: perLine.filter(([, v]) => v.status === 'closed').length,
    idle: perLine.filter(([, v]) => v.status === 'idle').length,
    plannedOpen: perLine.reduce((a, [, v]) => a + v.plannedOpen.length, 0),
    alarms: perLine.flatMap(([, v]) => v.alarms.map(a => ({ line: v.name, ...a })))
      .sort((a, b) => (b.openMin || 0) - (a.openMin || 0)),
  };

  return { byKey, byLine: lineCache, summary };
}

/** สี/ป้ายสถานะสด — ใช้ร่วมกันทั้ง SVG (VsmCanvas) และการ์ด HTML (VSM.jsx) ห้ามนิยามซ้ำ */
export const LIVE_STATUS = {
  down:   { label: '🔴 เครื่องหยุด (Downtime ค้าง)', color: '#ef4444' },
  run:    { label: '🟢 กำลังผลิต',                   color: '#22c55e' },
  closed: { label: '✅ ปิดกะแล้ววันนี้',              color: '#64748b' },
  idle:   { label: '⚪ ยังไม่เปิดกะวันนี้',            color: '#6b7280' },
  unknown:{ label: '❔ ไม่ทราบสถานะ',                color: '#6b7280' },
};
