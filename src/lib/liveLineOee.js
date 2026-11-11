/* ══ 🟢 OEE สดรายไลน์ — "ตอนนี้ไลน์ไหนเดินได้แค่ไหน" (2026-11-11 · คำสั่ง user: เพิ่มในจอ Andon ฝ่ายผลิต) ══
   ตัวคำนวณล้วน (ไม่แตะ DB) — ผู้เรียกโหลดข้อมูลมาแล้วส่งเข้า ใช้คู่กับ `components/LiveOeeStrip.jsx`

   🔴 ไม่มีสูตรใหม่ที่นี่ — OEE สดมาจาก `computeLiveOee` (utils/oee.js) ตัวเดียวกับ
      /factory-map · /line-oee · /oee-analytics ⇒ ไลน์เดียวกัน 4 จอต้องได้เลขเดียวกัน
   · นับเฉพาะกะที่ **status = 'open'** ของวันงานนั้น (กะที่ขอปิดแล้ว = จบแล้ว มีค่า stamp ไม่ใช่ "ตอนนี้")
   · ไลน์ที่เปิดหลายกะพร้อมกัน (ลืมปิดกะก่อน) = เอากะล่าสุด แล้วบอกจำนวนที่เปิดค้าง
   · ประเมินไม่ได้ = `oee: null` + เหตุผล (`reason`) **ห้ามคืน 0** (กะเพิ่งเปิด · ยังไม่มีชิ้นแรก · ไม่มี CT)
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
import { computeLiveOee, sumDefectQty, ngByMatFrom } from '../utils/oee.js';
import { parallelUnitsOf, isParallelLine } from '../utils/lineTypes.js';

const bySession = (rows) => {
  const m = {};
  (rows || []).forEach(r => { if (r.session_id != null) (m[r.session_id] ||= []).push(r); });
  return m;
};

/** เหตุผลที่ประเมินไม่ได้ → ข้อความสั้นบนจอ */
export const LIVE_OEE_REASON = {
  early: 'กะเพิ่งเปิด',
  no_output: 'ยังไม่ปิดใบแรก',
  no_ct: 'ยังไม่ตั้ง CT',
};

/**
 * @param a.sessions   production_sessions ของวันงาน (id, line_name, status, shift, start_time, shift_min, work_date, created_at)
 * @param a.orders     prod_orders ของกะเหล่านั้น
 * @param a.downtimes  downtime_logs (ต้องมี dr_downtime_types(category))
 * @param a.defects    defect_logs (ต้องมี prod_orders(mat_no) + ทะเบียนถัง QBIN_EMBED)
 * @param a.lines      production_lines (name, flow_mode, parallel_stations)
 * @param a.procByMat  { mat_no: process_type } — นโยบายพักตามกระบวนการ
 * @returns Array<{ line, sessionId, shift, oee, A, P, Q, reason, ctPartial, pOver, openCount }>
 */
export function liveOeeByLine({
  sessions = [], orders = [], downtimes = [], defects = [], ctMap = {}, lines = [],
  breakPolicies = [], pairMap = null, affectsBy = null, procByMat = {}, nowMs = Date.now(),
} = {}) {
  const ordBy = bySession(orders), dtBy = bySession(downtimes), dfBy = bySession(defects);
  const lineRow = Object.fromEntries((lines || []).map(l => [l.name, l]));
  const openByLine = {};
  (sessions || []).filter(s => s.status === 'open').forEach(s => { (openByLine[s.line_name] ||= []).push(s); });

  return Object.entries(openByLine).map(([line, ss]) => {
    const s = [...ss].sort((x, y) => String(y.created_at || '').localeCompare(String(x.created_at || '')))[0];
    const os = ordBy[s.id] || [];
    const defs = dfBy[s.id] || [];
    const row = lineRow[line] || null;
    const lv = computeLiveOee({
      session: s, orders: os, downtimes: dtBy[s.id] || [], ctMap,
      workDate: s.work_date, nowMs,
      ngQty: sumDefectQty(defs, 'line'),
      // ของเสีย/ทดลอง/ของสงสัย กินรอบเครื่อง ⇒ เข้าตัวเศษ %P (กฎเหล็ก OEE)
      ngForP: ngByMatFrom(defs, os),
      parallelN: parallelUnitsOf(row),
      parallelCap: isParallelLine(row?.flow_mode) ? parallelUnitsOf(row) : 1,
      breakPolicies: breakPolicies || [],
      processType: os.map(o => procByMat[o.mat_no]).find(Boolean) || null,
      // งานคู่ gang die / RH-LH = 1 shot ได้ 2 ชิ้น
      pairMap,
      // ของกลางของไลน์ขนาน (คอนเวเยอร์) ต้องไม่ถูกหารเลน
      affectsLanes: affectsBy,
    });
    const reason = lv == null ? 'early' : lv.noOutput ? 'no_output' : lv.noCt ? 'no_ct' : null;
    return {
      line, sessionId: s.id, shift: s.shift,
      oee: lv?.oee ?? null, A: lv?.A ?? null, P: lv?.P ?? null, Q: lv?.Q ?? null,
      reason: lv?.oee == null ? (reason || 'early') : null,
      ctPartial: !!(lv && !lv.noCt && lv.qtyNoCt > 0),
      pOver: !!lv?.pOver,
      openCount: ss.length,
    };
  });
}

/** เรียงให้ "ไลน์ที่ต้องดู" ขึ้นก่อน: ตัดสินได้และต่ำกว่าเป้ามาก → … → ประเมินไม่ได้ท้ายสุด */
export function sortLiveOee(rows, targetOf = () => null) {
  const gap = (r) => {
    if (r.oee == null) return Infinity;            // ประเมินไม่ได้ = ท้ายลิสต์ (แต่ห้ามตัดทิ้ง)
    const t = targetOf(r.line);
    return t == null ? 1e6 + r.oee : r.oee - t;     // ไม่มีเป้า = ต่อจากไลน์ที่มีเป้า
  };
  return [...(rows || [])].sort((a, b) => gap(a) - gap(b) || a.line.localeCompare(b.line, 'th', { numeric: true }));
}
