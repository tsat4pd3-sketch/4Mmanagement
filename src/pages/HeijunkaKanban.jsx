import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';

/* ─── HEIJUNKA KANBAN — Subcomponent Part Demand ──────────────────────────
   แตกความต้องการพาร์ทย่อยจากแผนผลิตรายวัน (production_sessions + prod_orders)
   ผ่าน BOM (bom_items) → Store เห็นว่าแต่ละไลน์/กะ ต้องใช้พาร์ทอะไร เท่าไหร่
   และคิดเป็นกี่ Kanban (จาก kanban_standards.qty_per_kanban) */

function getWorkDate() {
  const now = new Date();
  const h = now.getHours();
  if (h < 8) now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const card = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: 16,
};
const chip = (bg, color) => ({
  display: 'inline-block', fontSize: 10, fontWeight: 800, padding: '2px 8px',
  borderRadius: 10, background: bg, color, whiteSpace: 'nowrap',
});

const SHIFT_LABEL = { day: '☀️ กะเช้า', night: '🌙 กะดึก' };

/* mat_no prefix → ประเภทพาร์ท (ใช้กรอง view เดียวกันได้ทั้งฝั่งผลิตและฝั่ง store) */
const MAT_PREFIXES = [
  { prefix: '200', label: 'Child (ผลิต)', color: '#3b82f6' },
  { prefix: '300', label: 'Child (ซื้อ)',  color: '#f59e0b' },
  { prefix: '500', label: 'Raw Mat',       color: '#a78bfa' },
];
function matColor(mat_no = '') {
  const m = MAT_PREFIXES.find(p => mat_no.startsWith(p.prefix));
  return m ? m.color : 'var(--muted)';
}

/* ─── helpers ───────────────────────────────────────────────────────────── */
function addMinutes(timeStr, mins) {
  if (!timeStr) return '—';
  const [h, m] = timeStr.slice(0, 5).split(':').map(Number);
  const total = h * 60 + m + (mins || 0);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
/* แปลงเวลา "HH:MM" ของ workDate ให้เป็น ms จริง — ห่อข้ามเที่ยงคืนเข้ากรอบ 08:00→08:00 ของวันนั้น */
function timeStrToMs(workDate, t) {
  if (!t) return null;
  const gridStartMs = new Date(`${workDate}T08:00:00`).getTime();
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  let ms = gridStartMs + h * 3600000 + m * 60000;
  if (h < 8) ms += 24 * 3600000;
  return ms;
}
/* หารอบจัดส่งที่ order นี้ "ถูกสแกนเปิด" เข้าไปตกอยู่ในช่วง [รอบก่อนหน้า.cutoff, รอบนี้.cutoff)
   ของไลน์/กะนั้น — ถ้าเปิดมาหลังรอบสุดท้ายไปแล้ว (ยังไม่มีรอบรองรับ) ให้เข้ารอบสุดท้ายไปก่อน ไม่ทิ้ง demand */
function findRoundIdForOrder(line_name, shift, openedAtIso, roundsForLineShift, roundWindows) {
  if (!openedAtIso || !roundsForLineShift.length) return null;
  const ms = new Date(openedAtIso).getTime();
  for (const r of roundsForLineShift) {
    const w = roundWindows[r.id];
    if (w && ms >= w.startMs && ms < w.endMs) return r.id;
  }
  return roundsForLineShift[roundsForLineShift.length - 1].id;
}
function getRoundStatus(r, confirmedSet, receivedMap) {
  const key = `${r.line_name}|${r.shift}|${r.round_no}`;
  if (confirmedSet.has(key)) {
    const recv = receivedMap?.[key];
    if (recv?.received_status === 'full')
      return { label: '✔️ รับครบแล้ว', color: '#22c55e', bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.3)', top: '#22c55e' };
    if (recv?.received_status === 'partial')
      return { label: '⚠️ รับไม่ครบ', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)', top: '#f59e0b' };
    return { label: '📦 ส่งแล้ว · รอรับ', color: '#0ea5e9', bg: 'rgba(14,165,233,0.1)', border: 'rgba(14,165,233,0.3)', top: '#0ea5e9' };
  }
  const now = nowHHMM();
  const cutoff   = (r.cutoff_time   || '').slice(0, 5);
  const delivery = (r.delivery_time || '').slice(0, 5);
  const finish   = addMinutes(delivery, (r.points_count || 1) * (r.time_per_point_min || 10));
  if (delivery && now >= finish)
    return { label: '🔴 ค้างส่ง',      color: '#ef4444', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.3)',   top: '#ef4444' };
  if (cutoff && delivery && now >= cutoff && now < delivery)
    return { label: '⏳ กำลังเตรียม', color: '#0ea5e9', bg: 'rgba(14,165,233,0.08)',  border: 'rgba(14,165,233,0.3)',  top: '#0ea5e9' };
  return { label: '⬜ รอ', color: 'var(--muted)', bg: 'var(--bg2)', border: 'var(--border)', top: 'var(--border2)' };
}

/* ─── Store Board View ───────────────────────────────────────────────────── */
function StoreBoardView({ rounds, deliveries, view, kanbanStd, onConfirm, confirming, onReceive, fmt }) {
  const [expanded, setExpanded] = useState(null);

  const confirmedSet = useMemo(() => {
    const s = new Set();
    deliveries.forEach(d => s.add(`${d.line_name}|${d.shift}|${d.round_no}`));
    return s;
  }, [deliveries]);

  const receivedMap = useMemo(() => {
    const m = {};
    deliveries.forEach(d => { m[`${d.line_name}|${d.shift}|${d.round_no}`] = d; });
    return m;
  }, [deliveries]);

  // demand per line: parts + kanban cards needed
  const demandByLine = useMemo(() => {
    const lineToColIds = {};
    view.cols.forEach(c => { (lineToColIds[c.line] = lineToColIds[c.line] || []).push(c.id); });
    const res = {};
    Object.keys(lineToColIds).forEach(lineName => {
      const colIdSet = new Set(lineToColIds[lineName]);
      const partsForLine = view.rowList.filter(r =>
        Object.entries(r.perCol).some(([cid, v]) => colIdSet.has(cid) && v > 0)
      );
      const totalKanban = partsForLine.reduce((s, r) => {
        const per = kanbanStd[r.mat_no];
        return s + (per ? Math.ceil(r.netTotal / per) : 0);
      }, 0);
      res[lineName] = { parts: partsForLine, totalKanban };
    });
    return res;
  }, [view.cols, view.rowList, kanbanStd]);

  // byLine: รวมทุกไลน์ที่มีรอบจัดส่ง "หรือ" มี demand จริง — กันไลน์ที่ยังไม่ตั้งรอบหายไปจากบอร์ด
  const byLine = useMemo(() => {
    const m = {};
    rounds.forEach(r => { (m[r.line_name] = m[r.line_name] || []).push(r); });
    Object.keys(demandByLine).forEach(lineName => { if (!m[lineName]) m[lineName] = []; });
    return m;
  }, [rounds, demandByLine]);

  if (!Object.keys(byLine).length) return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
      ยังไม่มีรอบจัดส่ง — ตั้งค่าที่ 📦 Line Stock → ⏰ รอบจัดส่ง
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 16 }}>
      {Object.keys(byLine).sort().map(lineName => {
        const lineRounds = byLine[lineName];
        const demand = demandByLine[lineName] || { parts: [], totalKanban: 0 };
        return (
          <div key={lineName}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              🏭 {lineName}
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>
                {demand.parts.length} พาร์ท · {demand.totalKanban} การ์ด
              </span>
            </div>
            {!lineRounds.length ? (
              <div style={{ padding: '12px 14px', background: 'var(--bg2)', border: '1px dashed var(--border2)', borderRadius: 10, fontSize: 12, color: 'var(--muted)' }}>
                ⚠️ ไลน์นี้ยังไม่ตั้งรอบจัดส่ง — ตั้งค่าที่ 📦 Line Stock → ⏰ รอบจัดส่ง (demand ด้านบนคำนวณจากแผนผลิตวันนี้แล้ว รอกำหนดรอบเพื่อแจ้งสโตร์)
              </div>
            ) : (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {lineRounds.map(r => {
                const key = `${r.line_name}|${r.shift}|${r.round_no}`;
                const status = getRoundStatus(r, confirmedSet, receivedMap);
                const isConf = confirmedSet.has(key);
                const isReceived = !!receivedMap[key]?.received_status;
                const needAction = !isConf && (status.label === '⏳ กำลังเตรียม' || status.label === '🔴 ค้างส่ง');
                const finishTime = addMinutes(r.delivery_time?.slice(0, 5), (r.points_count || 1) * (r.time_per_point_min || 10));
                const expandKey = `${lineName}|${r.round_no}`;
                const isExpanded = expanded === expandKey;
                const confirmedBy = deliveries.find(d => d.line_name === r.line_name && d.shift === r.shift && d.round_no === r.round_no)?.confirmed_by;
                return (
                  <div key={r.id} style={{ minWidth: 200, maxWidth: 260, flexShrink: 0, background: status.bg, border: `1px solid ${status.border}`, borderRadius: 12, overflow: 'hidden', cursor: 'pointer', transition: 'transform 0.15s' }}
                    onClick={() => setExpanded(isExpanded ? null : expandKey)}
                  >
                    <div style={{ height: 4, background: status.top }} />
                    <div style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>รอบ {r.round_no}</span>
                        <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 8, background: 'rgba(0,0,0,0.15)', color: status.color }}>{status.label}</span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--text)', marginBottom: 4 }}>
                        📦 ส่ง {r.delivery_time?.slice(0, 5) || '—'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.7 }}>
                        ตัดยอด {r.cutoff_time?.slice(0, 5) || '—'} · เตรียม {r.prep_minutes || 60} น.<br />
                        {r.points_count || 1} จุด × {r.time_per_point_min || 10} น. · เสร็จ ~{finishTime}
                      </div>
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(128,128,128,0.15)', fontSize: 12 }}>
                        🔩 {demand.parts.length} พาร์ท · 🎴 <span style={{ fontWeight: 900, color: '#f59e0b' }}>{demand.totalKanban}</span> การ์ด
                      </div>
                      {confirmedBy && (
                        <div style={{ fontSize: 10, color: '#22c55e', marginTop: 4 }}>✓ {confirmedBy}</div>
                      )}
                      {needAction && (
                        <button onClick={e => { e.stopPropagation(); onConfirm(r, demand.parts); }} disabled={confirming === r.id}
                          style={{ marginTop: 8, width: '100%', padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 800, cursor: 'pointer', background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', fontFamily: 'var(--font-body)' }}>
                          {confirming === r.id ? '...' : '✅ ยืนยันส่งแล้ว'}
                        </button>
                      )}
                      {isConf && !isReceived && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 8 }} onClick={e => e.stopPropagation()}>
                          <button onClick={() => onReceive(r, demand.parts, 'full')}
                            style={{ flex: 1, padding: '6px 4px', borderRadius: 8, fontSize: 10, fontWeight: 800, cursor: 'pointer', background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', fontFamily: 'var(--font-body)' }}>
                            ✔️ รับครบ
                          </button>
                          <button onClick={() => onReceive(r, demand.parts, 'partial')}
                            style={{ flex: 1, padding: '6px 4px', borderRadius: 8, fontSize: 10, fontWeight: 800, cursor: 'pointer', background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)', fontFamily: 'var(--font-body)' }}>
                            ⚠️ รับไม่ครบ
                          </button>
                        </div>
                      )}
                      {isReceived && (
                        <div style={{ fontSize: 10, color: receivedMap[key].received_status === 'full' ? '#22c55e' : '#f59e0b', marginTop: 4 }}>
                          {receivedMap[key].received_status === 'full' ? '✔️' : '⚠️'} {receivedMap[key].received_by} รับของแล้ว
                          {receivedMap[key].received_note ? ` — ${receivedMap[key].received_note}` : ''}
                        </div>
                      )}
                    </div>
                    {isExpanded && demand.parts.length > 0 && (
                      <div style={{ borderTop: '1px solid rgba(128,128,128,0.15)', padding: '8px 14px', maxHeight: 220, overflowY: 'auto' }}>
                        {demand.parts.map(p => {
                          const per = kanbanStd[p.mat_no];
                          return (
                            <div key={p.mat_no} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid rgba(128,128,128,0.1)', fontSize: 11 }}>
                              <div style={{ overflow: 'hidden' }}>
                                <div style={{ fontFamily: 'monospace', color: '#0ea5e9', fontWeight: 700 }}>{p.mat_no}</div>
                                <div style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>{p.part_name}</div>
                              </div>
                              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                <div style={{ fontWeight: 800, color: '#f59e0b' }}>{per ? `${Math.ceil(p.netTotal / per)} ใบ` : `${fmt(p.netTotal)} ${p.uom}`}</div>
                                {per && <div style={{ color: 'var(--muted)', fontSize: 10 }}>NET {fmt(p.netTotal)}</div>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Delivery Timeline Board — 24h heijunka-style view of delivery rounds ── */
function DeliveryTimelineBoard({ rounds, deliveries, view, kanbanStd, fmt }) {
  const [expanded, setExpanded] = useState(null);
  const [breakPolicies, setBreakPolicies] = useState([]);
  useEffect(() => {
    supabaseDR.from('break_policies').select('*').eq('is_active', true)
      .then(({ data }) => setBreakPolicies(data || []));
  }, []);
  const HOURS  = [8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,0,1,2,3,4,5,6,7];
  const LEFT_W = 130;
  const now = new Date();
  const gridStartMs = new Date(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T08:00:00`).getTime();
  const nowMs = now.getTime();
  const pctPerMs = 100 / (12 * 3600000);
  const HALVES = [
    { key: 'am', hours: HOURS.slice(0, 12), startMs: gridStartMs },
    { key: 'pm', hours: HOURS.slice(12), startMs: gridStartMs + 12 * 3600000 },
  ];

  const confirmedSet = useMemo(() => {
    const s = new Set();
    deliveries.forEach(d => s.add(`${d.line_name}|${d.shift}|${d.round_no}`));
    return s;
  }, [deliveries]);
  const receivedMap = useMemo(() => {
    const m = {};
    deliveries.forEach(d => { m[`${d.line_name}|${d.shift}|${d.round_no}`] = d; });
    return m;
  }, [deliveries]);
  const demandByLine = useMemo(() => {
    const lineToColIds = {};
    view.cols.forEach(c => { (lineToColIds[c.line] = lineToColIds[c.line] || []).push(c.id); });
    const res = {};
    Object.keys(lineToColIds).forEach(lineName => {
      const colIdSet = new Set(lineToColIds[lineName]);
      const partsForLine = view.rowList.filter(r =>
        Object.entries(r.perCol).some(([cid, v]) => colIdSet.has(cid) && v > 0)
      );
      const totalKanban = partsForLine.reduce((s, r) => {
        const per = kanbanStd[r.mat_no];
        return s + (per ? Math.ceil(r.netTotal / per) : 0);
      }, 0);
      res[lineName] = { parts: partsForLine, totalKanban };
    });
    return res;
  }, [view.cols, view.rowList, kanbanStd]);
  // รวมไลน์ที่มี demand จริงแต่ยังไม่ตั้งรอบจัดส่งเข้ามาด้วย กันหายไปจากบอร์ด
  const byLine = useMemo(() => {
    const m = {};
    rounds.forEach(r => { (m[r.line_name] = m[r.line_name] || []).push(r); });
    Object.keys(demandByLine).forEach(lineName => { if (!m[lineName]) m[lineName] = []; });
    return m;
  }, [rounds, demandByLine]);

  const timeToMs = (t) => {
    if (!t) return null;
    const [h, m] = t.slice(0, 5).split(':').map(Number);
    let ms = gridStartMs + h * 3600000 + m * 60000;
    if (h < 8) ms += 24 * 3600000; // wrap past midnight into next-day slot of the 08:00→08:00 grid
    return ms;
  };

  if (!Object.keys(byLine).length) return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
      ยังไม่มีรอบจัดส่ง — ตั้งค่าที่ 📦 Line Stock → ⏰ รอบจัดส่ง
    </div>
  );

  const hourHeader = (hours, halfStartMs) => (
    <div style={{ display: 'flex', borderBottom: '1px solid var(--border2)', background: 'var(--bg2)' }}>
      <div style={{ width: LEFT_W, flexShrink: 0, borderRight: '1px solid var(--border2)', padding: '4px 8px', fontSize: 8, fontWeight: 700, color: 'var(--muted)' }}>รอบจัดส่ง</div>
      {hours.map((h, i) => {
        const slotMs = halfStartMs + i * 3600000;
        const isNow = nowMs >= slotMs && nowMs < slotMs + 3600000;
        const isShiftBound = h === 8 || h === 20;
        return (
          <div key={i} style={{
            flex: 1, minWidth: 0, textAlign: 'center', fontSize: 8,
            fontWeight: isNow ? 800 : isShiftBound ? 600 : 400,
            color: isNow ? '#4d9fff' : isShiftBound ? 'var(--text2)' : 'var(--muted)',
            padding: '4px 0', lineHeight: 1,
            borderRight: `1px solid ${isShiftBound ? 'var(--border2)' : 'var(--border)'}`,
            background: isNow ? 'rgba(77,159,255,0.12)' : 'transparent',
          }}>
            {String(h).padStart(2,'0')}:00
            {isNow && <div style={{ width: 3, height: 3, borderRadius: '50%', background: '#4d9fff', margin: '1px auto 0' }} />}
          </div>
        );
      })}
    </div>
  );

  // ช่วง break_policies ที่ตรงกับ half นี้ (เป็น [startMs, endMs]) — ใช้ทั้งวาดแถบและกันรอบจัดส่งวางทับเวลาพัก
  const getBreakIntervals = (half) => breakPolicies
    .filter(p => p.shift === 'both' || (p.shift === 'day' && half.key === 'am') || (p.shift === 'night' && half.key === 'pm'))
    .map(p => {
      const idx = half.hours.indexOf(Number(String(p.start_time).slice(0,2)));
      if (idx < 0) return null;
      const mins = Number(String(p.start_time).slice(3,5)) || 0;
      const s = half.startMs + idx * 3600000 + mins * 60000;
      const e = s + (p.duration_min || 0) * 60000;
      return [s, e];
    })
    .filter(Boolean)
    .sort((a, b) => a[0] - b[0]);

  // เรียงรอบตามเวลาเริ่มจริง แล้วต่อคิวในแถวเดียวกัน (ไม่ดันออกทางขวาเกินเวลาจริง ไม่สร้างแถวใหม่) และหลบช่วงเวลาพัก
  const renderTimeline = (lineRounds, half, rowKey) => (
    <div key={rowKey} style={{ flex: 1, position: 'relative', display: 'flex' }}>
      {half.hours.map((h, i) => {
        const slotMs = half.startMs + i * 3600000;
        const isNow = nowMs >= slotMs && nowMs < slotMs + 3600000;
        const isShiftBound = h === 8 || h === 20;
        return <div key={i} style={{ flex: 1, minWidth: 0, height: '100%', borderRight: `1px solid ${isShiftBound ? 'var(--border2)' : 'var(--border)'}`, background: isNow ? 'rgba(77,159,255,0.06)' : 'transparent' }} />;
      })}
      {(() => {
        const breaks = getBreakIntervals(half);
        return breaks.map(([bs, be], pi) => {
          const leftPct = Math.max(0, (bs - half.startMs) * pctPerMs);
          const widthPct = Math.min(100 - leftPct, (be - bs) * pctPerMs);
          if (widthPct <= 0) return null;
          const p = breakPolicies.find(bp => {
            const idx = half.hours.indexOf(Number(String(bp.start_time).slice(0,2)));
            if (idx < 0) return false;
            const mins = Number(String(bp.start_time).slice(3,5)) || 0;
            return half.startMs + idx * 3600000 + mins * 60000 === bs;
          }) || {};
          return (
            <div key={`brk-${pi}`} title={`${p.name_th || p.name_en} — ไลน์ไม่รองรับ KANBAN`}
              style={{
                position: 'absolute', top: 0, bottom: 0, left: `${leftPct}%`, width: `${widthPct}%`,
                background: 'repeating-linear-gradient(45deg, rgba(148,163,184,0.18) 0px, rgba(148,163,184,0.18) 4px, transparent 4px, transparent 8px)',
                borderLeft: '1px dashed rgba(148,163,184,0.6)', borderRight: '1px dashed rgba(148,163,184,0.6)',
                zIndex: 0, pointerEvents: 'none',
              }}
            />
          );
        });
      })()}
      {(() => {
        const MIN_W_PCT = 1.5;
        const breaks = getBreakIntervals(half);
        const items = lineRounds.map(r => {
          const startMs = timeToMs((r.delivery_time || '').slice(0, 5));
          if (startMs == null) return null;
          const finishMin = (r.points_count || 1) * (r.time_per_point_min || 10);
          const endMs = startMs + finishMin * 60000;
          if (endMs <= half.startMs || startMs >= half.startMs + 12 * 3600000) return null;
          return { r, startMs, endMs };
        }).filter(Boolean).sort((a, b) => a.startMs - b.startMs);
        let queueEndMs = -Infinity;
        const positioned = items.map(({ r, startMs, endMs }) => {
          const durationMs = Math.max(endMs - startMs, 0);
          let realStartMs = Math.max(startMs, queueEndMs);
          let realEndMs = realStartMs + durationMs;
          let pushed = true;
          while (pushed) {
            pushed = false;
            for (const [bs, be] of breaks) {
              if (realStartMs < be && realEndMs > bs) {
                realStartMs = be;
                realEndMs = realStartMs + durationMs;
                pushed = true;
              }
            }
          }
          queueEndMs = realEndMs;
          const leftPct = Math.max(0, (realStartMs - half.startMs) * pctPerMs);
          const rightPct = Math.min(100, (realEndMs - half.startMs) * pctPerMs);
          const widthPct = Math.max(MIN_W_PCT, rightPct - leftPct);
          return { r, leftPct, widthPct };
        });
        return positioned.map(({ r, leftPct, widthPct }) => {
          if (leftPct >= 100) return null;
          const status = getRoundStatus(r, confirmedSet, receivedMap);
          const expandKey = `${r.line_name}|${r.round_no}`;
          return (
            <div key={r.id} title={`รอบ ${r.round_no} · ส่ง ${(r.delivery_time||'').slice(0,5)} · ${status.label}`}
              onClick={() => setExpanded(expanded === expandKey ? null : expandKey)}
              style={{
                position: 'absolute', top: 4, bottom: 4, left: `${leftPct}%`, width: `${widthPct}%`, minWidth: 22,
                background: `${status.top}28`, border: `1.5px solid ${status.top}cc`,
                borderRadius: 4, overflow: 'hidden', cursor: 'pointer', zIndex: 1,
                display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 3px',
              }}>
              <div style={{ fontSize: 8, fontWeight: 800, color: status.top, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                🎴 รอบ {r.round_no}
              </div>
            </div>
          );
        });
      })()}
      {nowMs >= half.startMs && nowMs < half.startMs + 12 * 3600000 && (() => {
        const nowPct = (nowMs - half.startMs) * pctPerMs;
        return <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${nowPct}%`, width: 1.5, background: 'rgba(77,159,255,0.7)', zIndex: 2, pointerEvents: 'none' }} />;
      })()}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', padding: '6px 10px', background: 'var(--bg2)', borderRadius: 8, border: '1px solid var(--border2)' }}>
        {[
          { c: 'var(--border2)', icon: '⬜', label: 'รอ' },
          { c: '#0ea5e9', icon: '⏳', label: 'กำลังเตรียม / ส่งแล้วรอรับ' },
          { c: '#22c55e', icon: '✔️', label: 'รับครบแล้ว' },
          { c: '#f59e0b', icon: '⚠️', label: 'รับไม่ครบ' },
          { c: '#ef4444', icon: '🔴', label: 'ค้างส่ง' },
        ].map(item => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 14, height: 14, borderRadius: 3, background: `${item.c}28`, border: `1.5px solid ${item.c}cc`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, flexShrink: 0 }}>{item.icon}</span>
            <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>{item.label}</span>
          </div>
        ))}
      </div>
      {Object.keys(byLine).sort().map(lineName => {
        const lineRounds = byLine[lineName];
        const demand = demandByLine[lineName] || { parts: [], totalKanban: 0 };
        return (
          <div key={lineName} style={{ border: '1px solid var(--border2)', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '8px 14px', background: 'var(--bg2)', borderBottom: '1px solid var(--border2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b' }}>🏭 {lineName}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{demand.parts.length} พาร์ท · 🎴 {demand.totalKanban} การ์ด</span>
            </div>
            {HALVES.map(half => (
              <div key={half.key} style={{ borderTop: half.key === 'pm' ? '2px solid var(--border2)' : 'none' }}>
                {hourHeader(half.hours, half.startMs)}
                <div style={{ display: 'flex', minHeight: 36 }}>
                  <div style={{ width: LEFT_W, flexShrink: 0, padding: '4px 8px', borderRight: '1px solid var(--border2)', display: 'flex', alignItems: 'center', fontSize: 9, color: 'var(--muted)', fontWeight: 700 }}>
                    {lineRounds.length} รอบ
                  </div>
                  {renderTimeline(lineRounds, half, `${lineName}-${half.key}`)}
                </div>
              </div>
            ))}
            {/* expanded round detail */}
            {lineRounds.map(r => {
              const expandKey = `${lineName}|${r.round_no}`;
              if (expanded !== expandKey) return null;
              return (
                <div key={r.round_no} style={{ borderTop: '1px solid var(--border2)', padding: '10px 14px', background: 'var(--bg)' }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>
                    รอบ {r.round_no} — ส่ง {(r.delivery_time||'').slice(0,5)} · {getRoundStatus(r, confirmedSet, receivedMap).label}
                  </div>
                  {demand.parts.length === 0 ? (
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>ไม่มี demand พาร์ทย่อยสำหรับไลน์นี้</div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {demand.parts.map(p => {
                        const per = kanbanStd[p.mat_no];
                        return (
                          <span key={p.mat_no} style={chip('var(--bg2)', 'var(--text2)')}>
                            <span style={{ fontFamily: 'monospace', color: '#0ea5e9' }}>{p.mat_no}</span> · {per ? `${Math.ceil(p.netTotal / per)} ใบ` : `${fmt(p.netTotal)} ${p.uom}`}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Delivery Rounds Panel (compact, for cards/table views) ─────────────── */
function DeliveryRoundsPanel({ rounds, deliveries, onConfirm, confirming, onReceive, demandByLine }) {
  const [collapsed, setCollapsed] = useState(false);

  const confirmedSet = useMemo(() => {
    const s = new Set();
    deliveries.forEach(d => s.add(`${d.line_name}|${d.shift}|${d.round_no}`));
    return s;
  }, [deliveries]);

  const receivedMap = useMemo(() => {
    const m = {};
    deliveries.forEach(d => { m[`${d.line_name}|${d.shift}|${d.round_no}`] = d; });
    return m;
  }, [deliveries]);

  const byLine = useMemo(() => {
    const m = {};
    rounds.forEach(r => { (m[r.line_name] = m[r.line_name] || []).push(r); });
    return m;
  }, [rounds]);

  if (rounds.length === 0) return null;

  return (
    <div style={{ ...card, marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', marginBottom: collapsed ? 0 : 16 }}
        onClick={() => setCollapsed(v => !v)}>
        <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
          ⏰ รอบจัดส่งวันนี้ <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>({rounds.length} รอบ)</span>
        </div>
        <span style={{ color: 'var(--muted)', fontSize: 14 }}>{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {Object.keys(byLine).sort().map(lineName => (
            <div key={lineName} style={{ background: 'var(--bg2)', borderRadius: 8, padding: 12, border: '1px solid var(--border2)' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', marginBottom: 8, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                🏭 {lineName}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {byLine[lineName].map(r => {
                  const key = `${r.line_name}|${r.shift}|${r.round_no}`;
                  const status = getRoundStatus(r, confirmedSet, receivedMap);
                  const isConf = confirmedSet.has(key);
                  const isReceived = !!receivedMap[key]?.received_status;
                  const confirmedBy = deliveries.find(d => d.line_name === r.line_name && d.shift === r.shift && d.round_no === r.round_no)?.confirmed_by;
                  const parts = demandByLine?.[lineName]?.parts || [];
                  return (
                    <div key={r.id} style={{ background: 'var(--card)', borderRadius: 6, padding: '8px 10px', border: `1px solid ${status.border}`, opacity: isConf ? 0.8 : 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>รอบ {r.round_no}</div>
                        <span style={chip(status.bg, status.color)}>{status.label}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        ตัดยอด {r.cutoff_time?.slice(0,5) || '—'} → ส่ง {r.delivery_time?.slice(0,5) || '—'}
                      </div>
                      {confirmedBy && <div style={{ fontSize: 10, color: '#22c55e', marginTop: 3 }}>✓ {confirmedBy}</div>}
                      {!isConf && (
                        <button onClick={() => onConfirm(r, parts)} disabled={confirming === r.id}
                          style={{ marginTop: 6, width: '100%', padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', fontFamily: 'var(--font-body)' }}>
                          {confirming === r.id ? '...' : '✅ ยืนยันส่งแล้ว'}
                        </button>
                      )}
                      {isConf && !isReceived && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                          <button onClick={() => onReceive(r, parts, 'full')}
                            style={{ flex: 1, padding: '5px 4px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer', background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', fontFamily: 'var(--font-body)' }}>
                            ✔️ รับครบ
                          </button>
                          <button onClick={() => onReceive(r, parts, 'partial')}
                            style={{ flex: 1, padding: '5px 4px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer', background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)', fontFamily: 'var(--font-body)' }}>
                            ⚠️ ไม่ครบ
                          </button>
                        </div>
                      )}
                      {isReceived && (
                        <div style={{ fontSize: 10, color: receivedMap[key].received_status === 'full' ? '#22c55e' : '#f59e0b', marginTop: 3 }}>
                          {receivedMap[key].received_status === 'full' ? '✔️' : '⚠️'} {receivedMap[key].received_by} รับของแล้ว
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Kanban Card Grid ──────────────────────────────────────────────────── */
function KanbanCardGrid({ rowList, kanbanStd, fmt }) {
  if (!rowList.length) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, padding: 16 }}>
      {rowList.map(r => {
        const per = kanbanStd[r.mat_no];
        const stockCovered = r.netTotal === 0;
        const borderColor = stockCovered ? '#22c55e' : per ? '#f59e0b' : '#ef4444';
        return (
          <div key={r.mat_no} style={{
            background: 'var(--bg2)', border: '1px solid var(--border)',
            borderLeft: `4px solid ${borderColor}`, borderRadius: 8, padding: 12,
            position: 'relative', opacity: stockCovered ? 0.5 : 1,
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            {stockCovered && (
              <div style={{
                position: 'absolute', top: 8, right: 8,
                background: 'rgba(34,197,94,0.15)', color: '#22c55e',
                borderRadius: 10, fontSize: 10, fontWeight: 800, padding: '2px 7px',
              }}>✓ stock พอ</div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: '#0ea5e9', letterSpacing: 0.5 }}>
                {r.mat_no}
              </span>
              {r.supplier && (
                <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 6, background: 'var(--bg3)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                  {r.supplier}
                </span>
              )}
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', lineHeight: 1.3, fontFamily: 'var(--font-body)' }}>
              {r.part_name}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span style={{ color: 'var(--muted)', fontWeight: 600 }}>{fmt(r.grossTotal)}</span>
              <span style={{ color: 'var(--muted)' }}>→</span>
              <span style={{ fontSize: 18, fontWeight: 900, fontFamily: 'var(--font-display)', color: stockCovered ? '#22c55e' : borderColor }}>
                {stockCovered ? '✓ พอ' : fmt(r.netTotal)}
              </span>
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>{r.uom}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
              {r.totalStock > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>
                  📦 {fmt(r.totalStock)}
                </span>
              )}
              {!stockCovered && (
                per
                  ? <span style={{ fontSize: 13, fontWeight: 900, padding: '3px 10px', borderRadius: 12, background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }}>
                      🎴 {Math.ceil(r.netTotal / per)} ใบ × {per}
                    </span>
                  : <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                      ไม่มี std
                    </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Pull Board — ตัวสะสม demand + ใบสั่งผลิตล็อต + ใบเบิกวัตถุดิบ ───────────── */
const LOT_STATUS = {
  pending:   { label: '🆕 รอผลิต',   color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.3)', next: 'producing', nextLabel: '▶ เริ่มผลิต' },
  producing: { label: '🔧 กำลังผลิต', color: '#0ea5e9', bg: 'rgba(14,165,233,0.1)',  border: 'rgba(14,165,233,0.3)', next: 'done',      nextLabel: '✔ ผลิตเสร็จ' },
  done:      { label: '✅ เสร็จแล้ว',  color: '#22c55e', bg: 'rgba(34,197,94,0.1)',   border: 'rgba(34,197,94,0.3)', next: null,        nextLabel: null },
};
function PullBoard({ lotRequests, rawRequests, accumulator, lotSizeMap, busy, onAdvanceLot, onIssueRaw, onReorder, fmt }) {
  const rawByLot = useMemo(() => {
    const m = {};
    rawRequests.forEach(r => { (m[r.lot_request_id] = m[r.lot_request_id] || []).push(r); });
    return m;
  }, [rawRequests]);

  // จัดกลุ่มใบสั่งผลิตตามไลน์ผลิต + เรียงตามคิว (seq_no น้อยก่อน, ไม่มี seq ไปท้าย แล้วเรียงตามเวลา)
  const lotsByLine = useMemo(() => {
    const m = {};
    lotRequests.forEach(l => { const k = l.source_line || '— ไม่ระบุไลน์ (ของซื้อ) —'; (m[k] = m[k] || []).push(l); });
    Object.values(m).forEach(arr => arr.sort((a, b) => {
      const sa = a.seq_no == null ? Infinity : a.seq_no, sb = b.seq_no == null ? Infinity : b.seq_no;
      if (sa !== sb) return sa - sb;
      return new Date(a.created_at) - new Date(b.created_at);
    }));
    return m;
  }, [lotRequests]);

  const Section = ({ title, children }) => (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 10, fontFamily: 'var(--font-display)' }}>{title}</div>
      {children}
    </div>
  );

  return (
    <div style={{ padding: 16 }}>
      {/* ① ตัวสะสม demand */}
      <Section title="① 📈 ตัวสะสม Demand (รอครบล็อต)">
        {accumulator.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่มี demand สะสม</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {accumulator.map(a => {
              const lot = lotSizeMap[a.child_mat_no];
              const pct = lot ? Math.min(100, (a.pending_qty / lot) * 100) : 0;
              return (
                <div key={a.child_mat_no} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                  <div style={{ fontFamily: 'monospace', fontWeight: 800, color: matColor(a.child_mat_no), fontSize: 13 }}>{a.child_mat_no}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6 }}>
                    <span style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)' }}>{fmt(a.pending_qty)}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{lot ? `/ ${fmt(lot)} ล็อต` : 'ยังไม่ตั้ง lot'}</span>
                  </div>
                  {lot > 0 && (
                    <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 4, overflow: 'hidden', marginTop: 6 }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? '#22c55e' : '#7c3aed' }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ② ใบสั่งผลิตล็อต + ใบเบิกวัตถุดิบ — จัดกลุ่มตามไลน์ + เรียงคิวผลิต */}
      <Section title="② 🏭 ใบสั่งผลิตล็อต + คิวผลิต (Production Child part)">
        {lotRequests.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่มีใบสั่งผลิต — demand สะสมยังไม่ครบล็อต</div>
        ) : Object.keys(lotsByLine).sort().map(lineName => {
          const lineLots = lotsByLine[lineName];
          // คิวที่ยังไม่เสร็จ ใช้สำหรับเรียงลำดับ
          const queue = lineLots.filter(l => l.status !== 'done');
          return (
            <div key={lineName} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#3b82f6', marginBottom: 8 }}>🏭 {lineName} <span style={{ color: 'var(--muted)', fontWeight: 600 }}>· คิว {queue.length}</span></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 12 }}>
                {lineLots.map(lot => {
                  const st = LOT_STATUS[lot.status] || LOT_STATUS.pending;
                  const raws = rawByLot[lot.id] || [];
                  const qIdx = queue.findIndex(l => l.id === lot.id);
                  const canReorder = lot.status !== 'done' && queue.length > 1;
                  return (
                    <div key={lot.id} style={{ background: st.bg, border: `1px solid ${st.border}`, borderRadius: 12, overflow: 'hidden' }}>
                      <div style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {qIdx >= 0 && (
                              <span style={{ fontSize: 12, fontWeight: 900, color: '#7c3aed', background: 'rgba(124,58,237,0.12)', borderRadius: 6, padding: '1px 7px' }}>#{qIdx + 1}</span>
                            )}
                            <span style={{ fontFamily: 'monospace', fontWeight: 800, color: matColor(lot.child_mat_no) }}>{lot.child_mat_no}</span>
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 8, background: 'rgba(0,0,0,0.12)', color: st.color }}>{st.label}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{lot.part_name || ''}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                          <span style={{ fontSize: 20, fontWeight: 900, color: 'var(--text)' }}>{fmt(lot.lot_qty)} <span style={{ fontSize: 11, color: 'var(--muted)' }}>ชิ้น/ล็อต</span></span>
                          {canReorder && (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button onClick={() => onReorder(queue, lot, 'up')} disabled={busy === lot.id || qIdx === 0}
                                style={{ padding: '2px 8px', borderRadius: 6, cursor: qIdx === 0 ? 'default' : 'pointer', fontSize: 12, fontWeight: 800, background: 'var(--bg2)', color: qIdx === 0 ? 'var(--border2)' : 'var(--text)', border: '1px solid var(--border)' }}>▲</button>
                              <button onClick={() => onReorder(queue, lot, 'down')} disabled={busy === lot.id || qIdx === queue.length - 1}
                                style={{ padding: '2px 8px', borderRadius: 6, cursor: qIdx === queue.length - 1 ? 'default' : 'pointer', fontSize: 12, fontWeight: 800, background: 'var(--bg2)', color: qIdx === queue.length - 1 ? 'var(--border2)' : 'var(--text)', border: '1px solid var(--border)' }}>▼</button>
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                          {lot.work_date || ''}{lot.source_prod_no ? ` · จาก FG ${lot.source_prod_no}` : ''}
                        </div>
                        {st.next && (
                          <button onClick={() => onAdvanceLot(lot, st.next)} disabled={busy === lot.id}
                            style={{ marginTop: 8, width: '100%', padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer', background: 'rgba(0,0,0,0.12)', color: st.color, border: `1px solid ${st.border}`, fontFamily: 'var(--font-body)' }}>
                            {busy === lot.id ? '...' : st.nextLabel}
                          </button>
                        )}
                      </div>
                      {raws.length > 0 && (
                        <div style={{ borderTop: '1px solid rgba(128,128,128,0.15)', padding: '8px 14px', background: 'rgba(0,0,0,0.06)' }}>
                          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--muted)', marginBottom: 6 }}>📤 ใบเบิกวัตถุดิบ (Store Raw)</div>
                          {raws.map(r => {
                            const issued = r.status === 'issued';
                            return (
                              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 11 }}>
                                <div>
                                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: matColor(r.raw_mat_no) }}>{r.raw_mat_no}</span>
                                  <span style={{ color: 'var(--muted)', marginLeft: 6 }}>{fmt(r.qty)}</span>
                                </div>
                                {issued
                                  ? <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 700 }}>✔ จ่ายแล้ว</span>
                                  : <button onClick={() => onIssueRaw(r)} disabled={busy === r.id}
                                      style={{ padding: '3px 9px', borderRadius: 7, fontSize: 10, fontWeight: 800, cursor: 'pointer', background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', fontFamily: 'var(--font-body)' }}>
                                      {busy === r.id ? '...' : 'จ่าย'}
                                    </button>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </Section>
    </div>
  );
}

/* ─── Unified Store Board — ตู้ Kanban รวมของทุกสโตร์ ─────────────────────────
   หน้างานจริงมีหลายสโตร์แยกกัน แต่ละสโตร์มี "ของ" และ "ปลายทาง" ต่างกัน:
   🏭 Store FG (parent 100) → ไลน์ประกอบ · 🔧 Store Child (200/300) → Production Child
   🧱 Store Raw (500) → Production Child · 📦 Rack Center (ภาชนะ+packaging) → ทุกไลน์
   ทุกสโตร์ใช้การ์ดหน้าตาเดียวกัน: สถานะ → ปลายทาง → ปุ่มขยับสถานะ ────────────── */
const STORE_TABS = [
  { key: 'fg',    icon: '🏭', label: 'Store FG',        desc: 'พาร์ทแม่ (100) → ไลน์ประกอบ' },
  { key: 'child', icon: '🔧', label: 'Store Child',     desc: 'พาร์ทย่อย (200/300) → Production Child' },
  { key: 'raw',   icon: '🧱', label: 'Store Raw Mat',   desc: 'วัตถุดิบ (500) → Production Child' },
  { key: 'rack',  icon: '📦', label: 'Rack Center',     desc: 'ภาชนะ + Packaging → ทุกไลน์' },
];
function QueueCard({ code, name, qty, unit, destination, statusLabel, statusColor, statusBg, statusBorder, actionLabel, onAction, busy, meta }) {
  return (
    <div style={{ background: statusBg, border: `1px solid ${statusBorder}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ height: 4, background: statusColor }} />
      <div style={{ padding: '10px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'monospace', fontWeight: 800, color: matColor(code), fontSize: 13 }}>{code}</span>
          <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 8, background: 'rgba(0,0,0,0.12)', color: statusColor }}>{statusLabel}</span>
        </div>
        {name && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{name}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8 }}>
          <span style={{ fontSize: 20, fontWeight: 900, color: 'var(--text)' }}>{qty} <span style={{ fontSize: 11, color: 'var(--muted)' }}>{unit || ''}</span></span>
          {destination && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'rgba(59,130,246,0.12)', color: '#3b82f6' }}>➜ {destination}</span>}
        </div>
        {meta && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>{meta}</div>}
        {actionLabel && (
          <button onClick={onAction} disabled={busy}
            style={{ marginTop: 8, width: '100%', padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer', background: 'rgba(0,0,0,0.12)', color: statusColor, border: `1px solid ${statusBorder}`, fontFamily: 'var(--font-body)' }}>
            {busy ? '...' : actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
const RACK_STATUS = {
  requested: { label: '🔔 เรียกแล้ว', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)', next: '🔧 เริ่มเตรียม' },
  preparing: { label: '🔧 กำลังเตรียม', color: '#0ea5e9', bg: 'rgba(14,165,233,0.1)', border: 'rgba(14,165,233,0.3)', next: '🚚 จัดส่งแล้ว' },
  delivered: { label: '🚚 จัดส่งแล้ว', color: '#a855f7', bg: 'rgba(168,85,247,0.1)', border: 'rgba(168,85,247,0.3)', next: '✅ ยืนยันรับ' },
  received:  { label: '✅ รับแล้ว', color: '#22c55e', bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.3)', next: null },
};
function UnifiedStoreBoard({ store, setStore, rounds, deliveries, view, kanbanStd, onConfirm, confirming, onReceive,
  lotRequests, rawRequests, rackRequests, pkgRequests, busy, onAdvanceLot, onIssueRaw, onAdvanceRack, onIssuePkg, fmt }) {

  const confirmedSet = useMemo(() => { const s = new Set(); deliveries.forEach(d => s.add(`${d.line_name}|${d.shift}|${d.round_no}`)); return s; }, [deliveries]);
  const receivedMap  = useMemo(() => { const m = {}; deliveries.forEach(d => { m[`${d.line_name}|${d.shift}|${d.round_no}`] = d; }); return m; }, [deliveries]);
  const demandByLine = useMemo(() => {
    const lineToColIds = {};
    view.cols.forEach(c => { (lineToColIds[c.line] = lineToColIds[c.line] || []).push(c.id); });
    const res = {};
    Object.keys(lineToColIds).forEach(lineName => {
      const colIdSet = new Set(lineToColIds[lineName]);
      const partsForLine = view.rowList.filter(r => Object.entries(r.perCol).some(([cid, v]) => colIdSet.has(cid) && v > 0));
      const totalKanban = partsForLine.reduce((s, r) => { const per = kanbanStd[r.mat_no]; return s + (per ? Math.ceil(r.netTotal / per) : 0); }, 0);
      res[lineName] = { parts: partsForLine, totalKanban };
    });
    return res;
  }, [view.cols, view.rowList, kanbanStd]);

  const counts = {
    fg: rounds.filter(r => !confirmedSet.has(`${r.line_name}|${r.shift}|${r.round_no}`)).length,
    child: lotRequests.filter(l => l.status !== 'done').length,
    raw: rawRequests.filter(r => r.status !== 'issued').length,
    rack: rackRequests.filter(r => r.status !== 'received').length + pkgRequests.filter(p => p.status !== 'issued').length,
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {STORE_TABS.map(t => (
          <button key={t.key} onClick={() => setStore(t.key)} title={t.desc}
            style={{ padding: '10px 16px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-body)',
              background: store === t.key ? 'var(--accent)' : 'var(--bg2)', color: store === t.key ? '#08130a' : 'var(--text2)',
              border: `1px solid ${store === t.key ? 'var(--accent)' : 'var(--border)'}`, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, minWidth: 150 }}>
            <span>{t.icon} {t.label} {counts[t.key] > 0 && <span style={{ opacity: 0.8 }}>({counts[t.key]})</span>}</span>
            <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.75 }}>{t.desc}</span>
          </button>
        ))}
      </div>

      {store === 'fg' && (
        rounds.length === 0 ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีรอบจัดส่ง</div> :
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
          {rounds.map(r => {
            const key = `${r.line_name}|${r.shift}|${r.round_no}`;
            const status = getRoundStatus(r, confirmedSet, receivedMap);
            const isConf = confirmedSet.has(key);
            const isReceived = !!receivedMap[key]?.received_status;
            const demand = demandByLine[r.line_name] || { parts: [], totalKanban: 0 };
            const needAction = !isConf && (status.label === '⏳ กำลังเตรียม' || status.label === '🔴 ค้างส่ง');
            return (
              <QueueCard key={r.id} code={`รอบ ${r.round_no}`} name={r.line_name}
                qty={demand.totalKanban} unit="การ์ด" destination={r.line_name}
                statusLabel={status.label} statusColor={status.top} statusBg={status.bg} statusBorder={status.border}
                actionLabel={needAction ? '✅ ยืนยันส่งแล้ว' : (isConf && !isReceived ? '✔️ รับครบ' : null)}
                busy={confirming === r.id}
                onAction={() => needAction ? onConfirm(r, demand.parts) : onReceive(r, demand.parts, 'full')}
                meta={`ส่ง ${r.delivery_time?.slice(0,5) || '—'} · ตัดยอด ${r.cutoff_time?.slice(0,5) || '—'}`} />
            );
          })}
        </div>
      )}

      {store === 'child' && (
        lotRequests.length === 0 ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีใบสั่งผลิตพาร์ทย่อย</div> :
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
          {lotRequests.map(lot => {
            const st = LOT_STATUS[lot.status] || LOT_STATUS.pending;
            return (
              <QueueCard key={lot.id} code={lot.child_mat_no} name={lot.part_name}
                qty={fmt(lot.lot_qty)} unit="ชิ้น/ล็อต" destination={lot.source_line || 'ของซื้อ'}
                statusLabel={st.label} statusColor={st.color} statusBg={st.bg} statusBorder={st.border}
                actionLabel={st.nextLabel} busy={busy === lot.id} onAction={() => onAdvanceLot(lot, st.next)}
                meta={lot.source_prod_no ? `จาก FG ${lot.source_prod_no}` : ''} />
            );
          })}
        </div>
      )}

      {store === 'raw' && (
        rawRequests.length === 0 ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีใบเบิกวัตถุดิบ</div> :
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
          {rawRequests.map(r => {
            const parentLot = lotRequests.find(l => l.id === r.lot_request_id);
            const issued = r.status === 'issued';
            return (
              <QueueCard key={r.id} code={r.raw_mat_no} name={r.part_name}
                qty={fmt(r.qty)} unit="" destination={parentLot?.source_line || '—'}
                statusLabel={issued ? '✔ จ่ายแล้ว' : '🆕 รอจ่าย'} statusColor={issued ? '#22c55e' : '#f59e0b'}
                statusBg={issued ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)'} statusBorder={issued ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}
                actionLabel={issued ? null : 'จ่ายวัตถุดิบ'} busy={busy === r.id} onAction={() => onIssueRaw(r)}
                meta={`สำหรับ ${r.lot_request_id ? parentLot?.child_mat_no || '' : ''}`} />
            );
          })}
        </div>
      )}

      {store === 'rack' && (
        <>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', marginBottom: 8 }}>🗃️ ภาชนะ (แร็ค/ถาด)</div>
          {rackRequests.length === 0 ? <div style={{ padding: '10px 0 20px', color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีการเรียกภาชนะ</div> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12, marginBottom: 20 }}>
              {rackRequests.map(r => {
                const st = RACK_STATUS[r.status] || RACK_STATUS.requested;
                return (
                  <QueueCard key={r.id} code={r.container_type_id || 'ภาชนะ'} name={null}
                    qty={r.qty} unit="ใบ" destination={r.line_name}
                    statusLabel={st.label} statusColor={st.color} statusBg={st.bg} statusBorder={st.border}
                    actionLabel={st.next} busy={busy === r.id} onAction={() => onAdvanceRack(r)}
                    meta={r.note || ''} />
                );
              })}
            </div>
          )}
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', marginBottom: 8 }}>📦 Packaging (จากการผลิต)</div>
          {pkgRequests.length === 0 ? <div style={{ padding: '10px 0', color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีใบเบิก packaging</div> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
              {pkgRequests.map(p => {
                const issued = p.status === 'issued';
                return (
                  <QueueCard key={p.id} code={p.packaging_code} name={p.packaging_name}
                    qty={p.qty} unit="" destination={p.source_line || '—'}
                    statusLabel={issued ? '✔ จ่ายแล้ว' : '🆕 รอจ่าย'} statusColor={issued ? '#22c55e' : '#f59e0b'}
                    statusBg={issued ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)'} statusBorder={issued ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}
                    actionLabel={issued ? null : 'จ่าย Packaging'} busy={busy === p.id} onAction={() => onIssuePkg(p)}
                    meta={[p.product_name, p.source_prod_no ? `FG ${p.source_prod_no}` : ''].filter(Boolean).join(' · ')} />
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function HeijunkaKanban() {
  const { fullName } = useContext(UserContext);
  const [workDate, setWorkDate]   = useState(getWorkDate());
  const [shiftFilter, setShiftFilter] = useState('all');
  const [matFilter, setMatFilter] = useState('');            // '' | '200' | '300' | '500' — กรอง view เดียวกันทั้งฝั่งผลิต/store
  const [viewMode, setViewMode]   = useState('unified');     // 'unified' | 'board' | 'timeline' | 'pull' | 'cards' | 'table'
  const [loading, setLoading]     = useState(false);
  const [sessions, setSessions]   = useState([]);
  const [demands, setDemands]     = useState([]);
  const [bomMap, setBomMap]       = useState({});
  const [kanbanStd, setKanbanStd] = useState({});
  const [lineStock, setLineStock] = useState({});
  const [rounds, setRounds]       = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [confirming, setConfirming] = useState(null);
  const [receiveModal, setReceiveModal] = useState(null); // { round, parts, mode }
  const [receiving, setReceiving] = useState(false);
  // ── Pull system (ใบสั่งผลิตล็อต + ใบเบิกวัตถุดิบ + ตัวสะสม demand) ──
  const [lotRequests, setLotRequests] = useState([]);
  const [rawRequests, setRawRequests] = useState([]);
  const [accumulator, setAccumulator] = useState([]);
  const [lotSizeMap, setLotSizeMap]   = useState({});   // mat_no → lot_size
  const [pullBusy, setPullBusy]       = useState(null);
  // ── ตู้ Kanban รวม: Rack Center (ภาชนะ + packaging) ──
  const [rackRequests, setRackRequests] = useState([]);
  const [pkgRequests, setPkgRequests]   = useState([]);
  const [unifiedStore, setUnifiedStore] = useState('fg'); // 'fg' | 'child' | 'raw' | 'rack'

  const loadPull = useCallback(async () => {
    const [{ data: lots }, { data: raws }, { data: acc }, { data: ks }, { data: racks }, { data: pkgs }] = await Promise.all([
      supabaseDR.from('child_lot_requests').select('*').order('created_at', { ascending: false }).limit(200),
      supabaseDR.from('raw_withdrawal_requests').select('*').order('created_at', { ascending: false }).limit(400),
      supabaseDR.from('child_demand_accumulator').select('*').gt('pending_qty', 0).order('pending_qty', { ascending: false }),
      supabaseDR.from('kanban_standards').select('mat_no, lot_size').eq('is_active', true),
      supabaseDR.from('rack_requests').select('*').order('requested_at', { ascending: false }).limit(200),
      supabaseDR.from('packaging_withdrawal_requests').select('*').order('created_at', { ascending: false }).limit(200),
    ]);
    setLotRequests(lots || []);
    setRawRequests(raws || []);
    setAccumulator(acc || []);
    setRackRequests(racks || []);
    setPkgRequests(pkgs || []);
    const lm = {};
    (ks || []).forEach(s => { if (s.lot_size != null) lm[s.mat_no] = s.lot_size; });
    setLotSizeMap(lm);
  }, []);

  const advanceLot = async (lot, next) => {
    setPullBusy(lot.id);
    try {
      const { error } = await supabaseDR.from('child_lot_requests').update({ status: next }).eq('id', lot.id);
      if (error) throw error;
      // ── ผลิตเสร็จ = ปิด loop ──
      if (next === 'done') {
        const wd = lot.work_date || getWorkDate();
        const txns = [];
        // (1) ของที่ผลิตได้ กลับเข้าเติมสต็อกสโตร์ (ที่ไลน์ผลิตพาร์ท) — ถ้าเป็นของซื้อ (ไม่มี source_line) ข้าม
        if (lot.source_line) {
          txns.push({ line_name: lot.source_line, mat_no: lot.child_mat_no, part_name: lot.part_name, qty: lot.lot_qty,
            type: 'issue', work_date: wd, note: `auto: ผลิตเสร็จ เติมสต็อก Store Child (ล็อต ${lot.lot_qty})`, created_by: fullName || 'ผลิต' });
          // (2) ตัดสต็อกวัตถุดิบที่ใช้จริงตามใบเบิก
          rawRequests.filter(r => r.lot_request_id === lot.id).forEach(r => {
            txns.push({ line_name: lot.source_line, mat_no: r.raw_mat_no, part_name: r.part_name, qty: r.qty,
              type: 'consume', work_date: wd, note: `auto: ใช้ผลิต ${lot.child_mat_no} (ล็อต)`, created_by: fullName || 'ผลิต' });
          });
        }
        if (txns.length) {
          const { error: e2 } = await supabaseDR.from('line_stock_transactions').insert(txns);
          if (e2) throw e2;
        }
        // ใบเบิกวัตถุดิบที่ผูกไว้ → issued
        await supabaseDR.from('raw_withdrawal_requests').update({ status: 'issued' }).eq('lot_request_id', lot.id).eq('status', 'pending');
      }
      toast.success(next === 'done' ? `✅ ผลิตเสร็จ ${lot.child_mat_no} · เติมสต็อกสโตร์ +${lot.lot_qty}` : `อัปเดตล็อต ${lot.child_mat_no} → ${next}`);
      await loadPull();
      await load();
    } catch (err) { toast.error(err.message); }
    setPullBusy(null);
  };

  // เรียงคิวผลิต: สลับลำดับใน list ของไลน์นั้นแล้วเขียน seq_no = ตำแหน่งใหม่ทั้งชุด
  const reorderLot = async (lineLots, lot, dir) => {
    const arr = [...lineLots];
    const i = arr.findIndex(l => l.id === lot.id);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setPullBusy(lot.id);
    try {
      await Promise.all(arr.map((l, k) =>
        supabaseDR.from('child_lot_requests').update({ seq_no: k + 1 }).eq('id', l.id)
      ));
      await loadPull();
    } catch (err) { toast.error(err.message); }
    setPullBusy(null);
  };

  const issueRaw = async (raw) => {
    setPullBusy(raw.id);
    try {
      const { error } = await supabaseDR.from('raw_withdrawal_requests').update({ status: 'issued' }).eq('id', raw.id);
      if (error) throw error;
      toast.success(`จ่ายวัตถุดิบ ${raw.raw_mat_no} แล้ว`);
      await loadPull();
    } catch (err) { toast.error(err.message); }
    setPullBusy(null);
  };

  const advanceRack = async (r) => {
    const next = { requested: 'preparing', preparing: 'delivered', delivered: 'received' }[r.status];
    if (!next) return;
    setPullBusy(r.id);
    try {
      const payload = { status: next };
      if (next === 'preparing') { payload.prepared_by = fullName; payload.prepared_at = new Date().toISOString(); }
      if (next === 'delivered') { payload.delivered_by = fullName; payload.delivered_at = new Date().toISOString(); }
      if (next === 'received')  { payload.received_by  = fullName; payload.received_at  = new Date().toISOString(); }
      const { error } = await supabaseDR.from('rack_requests').update(payload).eq('id', r.id);
      if (error) throw error;
      toast.success(`อัปเดตภาชนะ → ${next}`);
      await loadPull();
    } catch (err) { toast.error(err.message); }
    setPullBusy(null);
  };

  const issuePkg = async (p) => {
    setPullBusy(p.id);
    try {
      const { error } = await supabaseDR.from('packaging_withdrawal_requests').update({ status: 'issued' }).eq('id', p.id);
      if (error) throw error;
      toast.success(`จ่าย packaging ${p.packaging_code} แล้ว`);
      await loadPull();
    } catch (err) { toast.error(err.message); }
    setPullBusy(null);
  };

  /* ── load & explode ── */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 1) sessions ของวันนั้น
      const { data: sess, error: e1 } = await supabaseDR.from('production_sessions')
        .select('id, line_name, shift, status, product_id, dr_products(id, name, mat_no)')
        .eq('work_date', workDate)
        .order('line_name');
      if (e1) throw e1;
      setSessions(sess || []);
      if (!sess?.length) { setDemands([]); setBomMap({}); setLoading(false); return; }
      const sessIds = sess.map(s => s.id);

      // 2) แผนผลิต: prod_orders + kanban_targets ของ sessions เหล่านี้
      const [{ data: orders }, { data: targets }, { data: products }] = await Promise.all([
        supabaseDR.from('prod_orders').select('session_id, mat_no, part_name, qty, status').in('session_id', sessIds),
        supabaseDR.from('kanban_targets').select('session_id, mat_no, part_name, qty_target').in('session_id', sessIds),
        supabaseDR.from('dr_products').select('id, name, mat_no').eq('is_active', true),
      ]);
      const prodByMat = {};
      (products || []).forEach(p => { if (p.mat_no) prodByMat[p.mat_no] = p; });

      // demand ระดับ parent ต่อ session: ใช้ prod_orders ก่อน, session ไหนไม่มี order → fallback kanban_targets
      const sessionsWithOrders = new Set((orders || []).map(o => o.session_id));
      const dem = [];
      (orders || []).forEach(o => {
        if (!o.qty) return;
        dem.push({ session_id: o.session_id, mat_no: o.mat_no, part_name: o.part_name, qty: o.qty, product: prodByMat[o.mat_no] || null });
      });
      (targets || []).forEach(t => {
        if (sessionsWithOrders.has(t.session_id) || !t.qty_target) return;
        dem.push({ session_id: t.session_id, mat_no: t.mat_no, part_name: t.part_name, qty: t.qty_target, product: prodByMat[t.mat_no] || null });
      });
      setDemands(dem);

      // 3) BOM ของ product ที่เกี่ยวข้อง + kanban standards ของพาร์ทย่อย
      const productIds = [...new Set(dem.map(d => d.product?.id).filter(Boolean))];
      if (productIds.length === 0) { setBomMap({}); setLoading(false); return; }
      const { data: boms } = await supabaseDR.from('bom_items')
        .select('*').in('product_id', productIds).eq('is_active', true);
      const bm = {};
      (boms || []).forEach(b => { (bm[b.product_id] = bm[b.product_id] || []).push(b); });
      setBomMap(bm);

      const childMats = [...new Set((boms || []).map(b => b.mat_no))];
      const lineNames = [...new Set((sess || []).map(s => s.line_name))];
      if (childMats.length) {
        const [{ data: stds }, { data: stockRows }] = await Promise.all([
          supabaseDR.from('kanban_standards').select('mat_no, qty_per_kanban').in('mat_no', childMats).eq('is_active', true),
          supabaseDR.from('line_stock_summary').select('line_name, mat_no, qty_on_hand').in('mat_no', childMats).in('line_name', lineNames),
        ]);
        const ks = {};
        (stds || []).forEach(s => { ks[s.mat_no] = s.qty_per_kanban; });
        setKanbanStd(ks);
        const ls = {};
        (stockRows || []).forEach(r => { ls[`${r.line_name}|${r.mat_no}`] = parseFloat(r.qty_on_hand) || 0; });
        setLineStock(ls);
      } else { setKanbanStd({}); setLineStock({}); }
    } catch (err) {
      toast.error('โหลดข้อมูลไม่สำเร็จ: ' + err.message);
    }
    setLoading(false);
  }, [workDate]);

  useEffect(() => { load(); }, [load]);

  const loadDeliveries = useCallback(async () => {
    const [{ data: rds }, { data: dlvs }] = await Promise.all([
      supabaseDR.from('kanban_delivery_rounds').select('*').eq('is_active', true).order('line_name').order('round_no'),
      supabaseDR.from('kanban_deliveries').select('*').eq('work_date', workDate),
    ]);
    setRounds(rds || []);
    setDeliveries(dlvs || []);
  }, [workDate]);

  useEffect(() => { loadDeliveries(); }, [loadDeliveries]);
  useEffect(() => { loadPull(); }, [loadPull]);

  const confirmRound = async (r, parts) => {
    if (confirming) return;
    setConfirming(r.id);
    try {
      const { error } = await supabaseDR.from('kanban_deliveries').upsert({
        work_date: workDate, line_name: r.line_name, shift: r.shift, round_no: r.round_no,
        confirmed_at: new Date().toISOString(), confirmed_by: fullName || 'Store',
      }, { onConflict: 'work_date,line_name,shift,round_no', ignoreDuplicates: false });
      if (error) throw error;
      // เข้าสต็อกในไลน์ทันที (รอผลิตกด confirm รับของอีกที)
      const issueRows = (parts || []).filter(p => p.netTotal > 0).map(p => ({
        line_name: r.line_name, mat_no: p.mat_no, part_name: p.part_name, qty: p.netTotal,
        type: 'issue', work_date: workDate,
        note: `Kanban ${r.line_name} รอบ ${r.round_no} (รอผลิตยืนยันรับ)`,
        created_by: fullName || 'Store',
      }));
      if (issueRows.length) {
        const { error: e2 } = await supabaseDR.from('line_stock_transactions').insert(issueRows);
        if (e2) throw e2;
      }
      toast.success(`✅ ยืนยันส่งแล้ว: ${r.line_name} รอบ ${r.round_no}`);
      await loadDeliveries();
    } catch (err) { toast.error(err.message); }
    setConfirming(null);
  };

  const openReceive = (round, parts, mode) => setReceiveModal({ round, parts, mode });

  const submitReceive = async (actualQtyByMat) => {
    const { round, parts, mode } = receiveModal;
    setReceiving(true);
    try {
      let shortageNote = '';
      if (mode === 'partial') {
        const shortRows = [];
        parts.filter(p => p.netTotal > 0).forEach(p => {
          const actual = actualQtyByMat[p.mat_no] ?? p.netTotal;
          const shortfall = p.netTotal - actual;
          if (shortfall > 0) {
            shortRows.push({
              line_name: round.line_name, mat_no: p.mat_no, part_name: p.part_name, qty: shortfall,
              type: 'consume', work_date: workDate,
              note: `รับไม่ครบ — Kanban ${round.line_name} รอบ ${round.round_no} (ปรับยอดตามจริง)`,
              created_by: fullName || 'ผลิต',
            });
          }
        });
        if (shortRows.length) {
          const { error } = await supabaseDR.from('line_stock_transactions').insert(shortRows);
          if (error) throw error;
        }
        shortageNote = shortRows.map(s => `${s.mat_no} ขาด ${s.qty}`).join(', ');
      }
      const { error } = await supabaseDR.from('kanban_deliveries').update({
        received_at: new Date().toISOString(), received_by: fullName || 'ผลิต',
        received_status: mode, received_note: shortageNote || null,
      }).match({ work_date: workDate, line_name: round.line_name, shift: round.shift, round_no: round.round_no });
      if (error) throw error;
      toast.success(mode === 'full' ? '✔️ ยืนยันรับครบแล้ว' : '⚠️ บันทึกรับไม่ครบแล้ว');
      setReceiveModal(null);
      await loadDeliveries();
    } catch (err) { toast.error(err.message); }
    setReceiving(false);
  };

  /* ── explode เป็น demand พาร์ทย่อย ── */
  const view = useMemo(() => {
    const sessById = Object.fromEntries(sessions.map(s => [s.id, s]));
    const visibleSessions = sessions.filter(s => shiftFilter === 'all' || s.shift === shiftFilter);
    const visibleIds = new Set(visibleSessions.map(s => s.id));

    // columns = ไลน์·กะ ที่มี demand
    const cols = visibleSessions.map(s => ({ id: s.id, line: s.line_name, shift: s.shift, status: s.status }));

    // rows: child mat_no → gross demand ต่อ col + stock ต่อไลน์ → net demand
    const rows = {};
    const noBom = new Map();
    demands.forEach(d => {
      if (!visibleIds.has(d.session_id)) return;
      const sess = sessions.find(s => s.id === d.session_id);
      const bomItems = d.product ? bomMap[d.product.id] : null;
      if (!bomItems?.length) {
        const key = d.mat_no || d.part_name;
        noBom.set(key, { name: d.part_name || d.mat_no, mat_no: d.mat_no, qty: (noBom.get(key)?.qty || 0) + d.qty });
        return;
      }
      bomItems.forEach(b => {
        const r = rows[b.mat_no] = rows[b.mat_no] || {
          mat_no: b.mat_no, part_name: b.part_name, uom: b.uom, supplier: b.supplier,
          perCol: {}, grossTotal: 0,
          stockPerLine: {},    // line_name → stock qty_on_hand (เก็บไว้แสดง)
        };
        const need = d.qty * Number(b.qty_per_unit);
        r.perCol[d.session_id] = (r.perCol[d.session_id] || 0) + need;
        r.grossTotal += need;
        // เก็บ stock per line (สำหรับแสดงใน tooltip / column)
        if (sess) {
          const stockKey = `${sess.line_name}|${b.mat_no}`;
          r.stockPerLine[sess.line_name] = lineStock[stockKey] || 0;
        }
      });
    });

    // คำนวณ net = gross - total stock ที่มีในทุกไลน์ที่เกี่ยวข้อง
    let rowList = Object.values(rows).map(r => {
      const totalStock = Object.values(r.stockPerLine).reduce((s, v) => s + v, 0);
      const netTotal   = Math.max(0, r.grossTotal - totalStock);
      return { ...r, totalStock, netTotal };
    }).sort((a, b) => a.mat_no.localeCompare(b.mat_no));

    // กรองตามประเภทพาร์ท (mat_no prefix) — ใช้ view เดียวกันทั้งฝั่งผลิตและฝั่ง store
    if (matFilter) rowList = rowList.filter(r => r.mat_no.startsWith(matFilter));

    const totalKanban = rowList.reduce((s, r) => {
      const per = kanbanStd[r.mat_no];
      return s + (per ? Math.ceil(r.netTotal / per) : 0);
    }, 0);
    return { cols, rowList, noBom: [...noBom.values()], sessById, totalKanban };
  }, [sessions, demands, bomMap, kanbanStd, lineStock, shiftFilter, matFilter]);

  const fmt = (n) => Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });

  // demand แยกตามไลน์ — ใช้ทั้งกำหนดยอดที่จะเข้าสต็อกตอนยืนยันส่ง และแสดงในแผง compact
  const demandByLine = useMemo(() => {
    const lineToColIds = {};
    view.cols.forEach(c => { (lineToColIds[c.line] = lineToColIds[c.line] || []).push(c.id); });
    const res = {};
    Object.keys(lineToColIds).forEach(lineName => {
      const colIdSet = new Set(lineToColIds[lineName]);
      const partsForLine = view.rowList.filter(r =>
        Object.entries(r.perCol).some(([cid, v]) => colIdSet.has(cid) && v > 0)
      );
      res[lineName] = { parts: partsForLine };
    });
    return res;
  }, [view.cols, view.rowList]);

  /* ── CSV export ── */
  const exportCSV = () => {
    if (!view.rowList.length) { toast.info('ไม่มีข้อมูลให้ export'); return; }
    const head = ['Mat No.', 'Part Name', 'UOM', 'Supplier', ...view.cols.map(c => `${c.line} (${c.shift})`), 'Gross', 'Stock in Line', 'Net', 'Qty/Kanban', 'Kanban'];
    const lines = view.rowList.map(r => {
      const per = kanbanStd[r.mat_no];
      return [r.mat_no, `"${r.part_name}"`, r.uom, r.supplier || '', ...view.cols.map(c => r.perCol[c.id] || 0), r.grossTotal, r.totalStock, r.netTotal, per || '', per ? Math.ceil(r.netTotal / per) : ''].join(',');
    });
    const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `heijunka_kanban_${workDate}${shiftFilter !== 'all' ? '_' + shiftFilter : ''}${matFilter ? '_' + matFilter : ''}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div style={{ padding: 'clamp(12px, 2vw, 24px)', maxWidth: 1500, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 'clamp(18px, 2.5vw, 24px)', fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
            🎴 Heijunka Kanban — Subcomponent Demand
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            ความต้องการพาร์ทย่อยตามแผนผลิตวันนี้ · แตกจาก BOM ของแต่ละ product
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={workDate} onChange={e => setWorkDate(e.target.value)} style={{
            padding: '8px 10px', borderRadius: 8, fontSize: 13, background: 'var(--bg2)',
            border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--font-body)',
          }} />
          {['all', 'day', 'night'].map(s => (
            <button key={s} onClick={() => setShiftFilter(s)} style={{
              padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-body)',
              background: shiftFilter === s ? 'var(--accent)' : 'var(--bg2)',
              color: shiftFilter === s ? '#08130a' : 'var(--text2)',
              border: `1px solid ${shiftFilter === s ? 'var(--accent)' : 'var(--border)'}`,
            }}>{s === 'all' ? 'ทุกกะ' : SHIFT_LABEL[s]}</button>
          ))}
          <span style={{ width: 1, height: 22, background: 'var(--border)' }} />
          <button onClick={() => setMatFilter('')} style={{
            padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-body)',
            background: matFilter === '' ? 'var(--accent)' : 'var(--bg2)',
            color: matFilter === '' ? '#08130a' : 'var(--text2)',
            border: `1px solid ${matFilter === '' ? 'var(--accent)' : 'var(--border)'}`,
          }}>ทุกประเภท</button>
          {MAT_PREFIXES.map(m => (
            <button key={m.prefix} onClick={() => setMatFilter(matFilter === m.prefix ? '' : m.prefix)} style={{
              padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-body)',
              background: matFilter === m.prefix ? `${m.color}28` : 'var(--bg2)',
              color: matFilter === m.prefix ? m.color : 'var(--text2)',
              border: `1px solid ${matFilter === m.prefix ? m.color : 'var(--border)'}`,
            }}>{m.label}</button>
          ))}
          <button onClick={exportCSV} style={{
            padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700,
            background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--font-body)',
          }}>⬇ CSV</button>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'ไลน์ที่มีแผนผลิต', value: view.cols.length, icon: '🏭' },
          { label: 'พาร์ทย่อยที่ต้องใช้', value: view.rowList.length, icon: '🔩' },
          { label: 'Kanban NET ที่ต้องเตรียม', value: view.totalKanban, icon: '🎴' },
          { label: 'Product ไม่มี BOM', value: view.noBom.length, icon: '⚠️', warn: view.noBom.length > 0 },
        ].map(c => (
          <div key={c.label} style={{ ...card, padding: '12px 16px', borderColor: c.warn ? 'rgba(245,158,11,0.4)' : 'var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{c.icon} {c.label}</div>
            <div style={{ fontSize: 26, fontWeight: 900, fontFamily: 'var(--font-display)', color: c.warn ? '#f59e0b' : 'var(--text)', marginTop: 2 }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* No-BOM warning */}
      {view.noBom.length > 0 && (
        <div style={{ ...card, borderColor: 'rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.05)', marginBottom: 16, padding: '12px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b', marginBottom: 6 }}>⚠️ มีแผนผลิตที่ยังแตกพาร์ทย่อยไม่ได้ — product เหล่านี้ยังไม่มี BOM</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {view.noBom.map(p => (
              <span key={p.mat_no || p.name} style={chip('rgba(245,158,11,0.12)', '#f59e0b')}>
                {p.name} · แผน {fmt(p.qty)} ชิ้น
              </span>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>→ ไปเพิ่ม BOM ที่หน้า 📦 BOM ก่อน แล้วข้อมูลจะแตกให้อัตโนมัติ</div>
        </div>
      )}

      {/* View mode toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {[{ id: 'unified', label: '🗄️ ตู้ Kanban รวม' }, { id: 'board', label: '🏪 Store Board' }, { id: 'timeline', label: '📊 Heijunka Board' }, { id: 'pull', label: '🔄 Pull / ใบสั่งผลิต' }, { id: 'cards', label: '🎴 การ์ด' }, { id: 'table', label: '📋 ตาราง' }].map(v => (
          <button key={v.id} onClick={() => setViewMode(v.id)} style={{
            padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-body)',
            background: viewMode === v.id ? 'var(--accent)' : 'var(--bg2)',
            color: viewMode === v.id ? '#08130a' : 'var(--text2)',
            border: `1px solid ${viewMode === v.id ? 'var(--accent)' : 'var(--border)'}`,
            transition: 'all 0.15s',
          }}>{v.label}</button>
        ))}
      </div>

      {/* Demand board */}
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>กำลังโหลด...</div>
        ) : viewMode === 'unified' ? (
          <UnifiedStoreBoard
            store={unifiedStore} setStore={setUnifiedStore}
            rounds={rounds} deliveries={deliveries} view={view} kanbanStd={kanbanStd}
            onConfirm={confirmRound} confirming={confirming} onReceive={openReceive}
            lotRequests={lotRequests} rawRequests={rawRequests} rackRequests={rackRequests} pkgRequests={pkgRequests}
            busy={pullBusy} onAdvanceLot={advanceLot} onIssueRaw={issueRaw} onAdvanceRack={advanceRack} onIssuePkg={issuePkg}
            fmt={fmt}
          />
        ) : viewMode === 'board' ? (
          <StoreBoardView
            rounds={rounds} deliveries={deliveries} view={view}
            kanbanStd={kanbanStd} onConfirm={confirmRound} confirming={confirming}
            onReceive={openReceive} fmt={fmt}
          />
        ) : viewMode === 'timeline' ? (
          <DeliveryTimelineBoard
            rounds={rounds} deliveries={deliveries} view={view} kanbanStd={kanbanStd} fmt={fmt}
          />
        ) : viewMode === 'pull' ? (
          <PullBoard
            lotRequests={lotRequests} rawRequests={rawRequests} accumulator={accumulator}
            lotSizeMap={lotSizeMap} busy={pullBusy} onAdvanceLot={advanceLot} onIssueRaw={issueRaw}
            onReorder={reorderLot} fmt={fmt}
          />
        ) : view.cols.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>ไม่มีกะ/แผนผลิตในวันที่ {workDate}</div>
        ) : view.rowList.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            ยังไม่มี demand พาร์ทย่อย — ตรวจว่าไลน์เปิด order แล้ว และ product มี BOM
          </div>
        ) : viewMode === 'cards' ? (
          <KanbanCardGrid rowList={view.rowList} kanbanStd={kanbanStd} fmt={fmt} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead>
                <tr style={{ background: 'var(--bg2)' }}>
                  <th style={{ padding: '10px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 1 }}>พาร์ทย่อย</th>
                  {view.cols.map(c => (
                    <th key={c.id} style={{ padding: '10px 12px', fontSize: 11, fontWeight: 800, color: 'var(--text2)', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {c.line}<br />
                      <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>{SHIFT_LABEL[c.shift] || c.shift}</span>
                    </th>
                  ))}
                  <th style={{ padding: '10px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'right' }}>Gross</th>
                  <th style={{ padding: '10px 12px', fontSize: 11, fontWeight: 800, color: '#22c55e', textAlign: 'right' }}>📦 Stock</th>
                  <th style={{ padding: '10px 12px', fontSize: 11, fontWeight: 800, color: 'var(--accent)', textAlign: 'right' }}>NET</th>
                  <th style={{ padding: '10px 12px', fontSize: 11, fontWeight: 800, color: '#f59e0b', textAlign: 'right' }}>🎴 KANBAN</th>
                </tr>
              </thead>
              <tbody>
                {view.rowList.map(r => {
                  const per = kanbanStd[r.mat_no];
                  const stockCovered = r.netTotal === 0;
                  return (
                    <tr key={r.mat_no} style={{ opacity: stockCovered ? 0.55 : 1 }}>
                      <td style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: matColor(r.mat_no), fontFamily: 'monospace' }}>{r.mat_no}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.part_name}{r.supplier ? ` · ${r.supplier}` : ''}</div>
                        {stockCovered && <div style={{ fontSize: 10, color: '#22c55e', fontWeight: 700 }}>✓ stock พอ</div>}
                      </td>
                      {view.cols.map(c => (
                        <td key={c.id} style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', textAlign: 'center', fontSize: 13, color: r.perCol[c.id] ? 'var(--text)' : 'var(--muted)', fontWeight: r.perCol[c.id] ? 700 : 400 }}>
                          {r.perCol[c.id] ? fmt(r.perCol[c.id]) : '—'}
                        </td>
                      ))}
                      <td style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', textAlign: 'right', fontSize: 13, color: 'var(--muted)' }}>
                        {fmt(r.grossTotal)}
                      </td>
                      <td style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#22c55e' }}>
                        {r.totalStock > 0 ? fmt(r.totalStock) : '—'}
                      </td>
                      <td style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', textAlign: 'right', fontSize: 15, fontWeight: 900, color: stockCovered ? '#22c55e' : 'var(--accent)' }}>
                        {stockCovered ? '✓ พอ' : fmt(r.netTotal)} <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>{r.uom}</span>
                      </td>
                      <td style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', textAlign: 'right' }}>
                        {stockCovered
                          ? <span style={chip('rgba(34,197,94,0.1)', '#22c55e')}>ไม่ต้องเบิก</span>
                          : per
                            ? <span style={chip('rgba(245,158,11,0.12)', '#f59e0b')}>{Math.ceil(r.netTotal / per)} ใบ × {per}</span>
                            : <span style={{ fontSize: 10, color: 'var(--muted)' }}>ไม่มี std</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delivery Rounds Panel — only for cards/table view, board has it built-in */}
      {viewMode !== 'board' && viewMode !== 'pull' && viewMode !== 'unified' && (
        <DeliveryRoundsPanel rounds={rounds} deliveries={deliveries} onConfirm={confirmRound} confirming={confirming}
          onReceive={openReceive} demandByLine={demandByLine} />
      )}

      {receiveModal && (
        <ReceiveModal
          round={receiveModal.round} parts={receiveModal.parts} mode={receiveModal.mode}
          fmt={fmt} saving={receiving}
          onCancel={() => setReceiveModal(null)}
          onSubmit={submitReceive}
        />
      )}
    </div>
  );
}

/* ─── Receive Modal — ฝ่ายผลิตยืนยันรับของจาก Store ──────────────────────── */
function ReceiveModal({ round, parts, mode, fmt, saving, onCancel, onSubmit }) {
  const netParts = parts.filter(p => p.netTotal > 0);
  const [actual, setActual] = useState(() => Object.fromEntries(netParts.map(p => [p.mat_no, p.netTotal])));

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onCancel}>
      <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(440px,100%)', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 4, fontFamily: 'var(--font-display)' }}>
          {mode === 'full' ? '✔️ ยืนยันรับของครบ' : '⚠️ บันทึกรับของไม่ครบ'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>{round.line_name} · รอบ {round.round_no}</div>

        {mode === 'full' ? (
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>
            ยืนยันว่าได้รับพาร์ททั้งหมด {netParts.length} รายการ ตามจำนวนที่ Store แจ้งครบถูกต้อง
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>กรอกจำนวนที่ได้รับจริงต่อพาร์ท (ค่าเริ่มต้น = จำนวนที่ Store แจ้งส่ง)</div>
            {netParts.map(p => (
              <div key={p.mat_no} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#0ea5e9', fontWeight: 700 }}>{p.mat_no}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.part_name} · แจ้งส่ง {fmt(p.netTotal)} {p.uom}</div>
                </div>
                <input type="number" min="0" step="any"
                  value={actual[p.mat_no]}
                  onChange={e => setActual(a => ({ ...a, [p.mat_no]: e.target.value === '' ? '' : parseFloat(e.target.value) }))}
                  style={{ width: 90, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 13, fontWeight: 700, textAlign: 'center' }}
                />
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button onClick={onCancel} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-body)' }}>ยกเลิก</button>
          <button onClick={() => onSubmit(actual)} disabled={saving}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: mode === 'full' ? '#22c55e' : '#f59e0b', color: '#08130a', cursor: 'pointer', fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-body)', opacity: saving ? 0.6 : 1 }}>
            {saving ? '...' : mode === 'full' ? '✔️ ยืนยันรับครบ' : '⚠️ บันทึกรับไม่ครบ'}
          </button>
        </div>
      </div>
    </div>
  );
}
