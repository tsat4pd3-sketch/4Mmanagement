import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import ReadOnlyNote from '../components/ReadOnlyNote';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import { toast } from '../components/Toast';
import useIsMobile from '../utils/useIsMobile';
import { addMinutes, timeStrToMs, dayFrameMs, roundDeliveryMin, getRoundStatus } from '../utils/deliveryRounds';
import { MAT_CLASSES, matColor, matMatches } from '../utils/matPrefix';
import ProdProgressStrip from '../components/ProdProgressStrip';

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
  display: 'inline-block', fontSize: 11, fontWeight: 800, padding: '2px 8px',
  borderRadius: 10, background: bg, color, whiteSpace: 'nowrap',
});

const SHIFT_LABEL = { day: '☀️ กะเช้า', night: '🌙 กะดึก' };

/* ประเภทพาร์ทจากเลขตัวแรกของ MAT — นิยามกลางที่ src/utils/matPrefix.js
   ⚠️ เดิมเทียบ 3 ตัวแรก ('200'/'300'/'500') ซึ่งพังเมื่อเลขรันทะลุช่วง
      (FG เจอจริงแล้ว: 100xxxxx → 101xxxxx) — ห้ามกลับไปเทียบหลายหลักอีก */
const MAT_PREFIXES = MAT_CLASSES.filter(c => c.digit !== '1').map(c => ({ prefix: c.digit, label: c.short, color: c.color }));

/* 📊 กระโดดไปบอร์ด Heijunka จริงของไลน์ (หน้า Management — มุมเดียวกับที่ไลน์ผลิตเห็น:
   ใบงานบนไทม์ไลน์/สถานะสด/ดีเลย์/คาดเสร็จ) — ใช้บอร์ดตัวจริง ไม่ก๊อปมาซ้ำ (กัน drift)
   ผู้ใช้ที่ scope ไม่ถึงไลน์นั้น Management จะ fallback ไลน์แรกใน scope ตัวเองตามกติกาเดิม */
function LineBoardLink({ line }) {
  const navigate = useNavigate();
  return (
    <button onClick={(e) => { e.stopPropagation(); navigate(`/management?line=${encodeURIComponent(line)}&view=heijunka`); }}
      title="เปิดบอร์ด Heijunka ของไลน์นี้ (จอเดียวกับที่ไลน์ผลิตเห็น)"
      style={{ padding: '2px 9px', borderRadius: 12, cursor: 'pointer', fontSize: 11, fontWeight: 700,
        background: 'var(--bg2)', color: 'var(--text2)', border: '1px solid var(--border)', flexShrink: 0 }}>
      📊 บอร์ดไลน์
    </button>
  );
}

/* ─── helpers ───────────────────────────────────────────────────────────────
   addMinutes/timeStrToMs/dayFrameMs/roundDeliveryMin/getRoundStatus ย้ายไป
   src/utils/deliveryRounds.js (single source of truth — เดิมซ้ำกับ LineStock) */

/* ─── Store Board View ───────────────────────────────────────────────────── */
function StoreBoardView({ rounds, deliveries, view, kanbanStd, onConfirm, confirming, onReceive, fmt, lineMap, workDate, nowMs, canOperate }) {
  const [expanded, setExpanded] = useState(null);
  const { groupDemand, roundAlloc } = view;

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

  // byLine: รวมทุกกลุ่มไลน์ที่มีรอบจัดส่ง "หรือ" มี demand จริง — group sub-lines ใต้ parent
  const byLine = useMemo(() => {
    const m = {};
    rounds.forEach(r => {
      const key = lineMap?.[r.line_name]?.parent_line_name || r.line_name;
      (m[key] = m[key] || []).push(r);
    });
    Object.keys(groupDemand).forEach(g => { if (!m[g]) m[g] = []; });
    return m;
  }, [rounds, groupDemand, lineMap]);

  if (!Object.keys(byLine).length) return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
      ยังไม่มีรอบจัดส่ง — ตั้งค่าที่ 📦 Line Stock → ⏰ รอบจัดส่ง
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 16 }}>
      {Object.keys(byLine).sort().map(lineName => {
        const lineRounds = byLine[lineName];
        const demand = groupDemand[lineName] || { parts: [], totalKanban: 0 };
        return (
          <div key={lineName}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              🏭 {lineName}
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>
                {demand.parts.length} พาร์ท · {demand.totalKanban} การ์ด (ทั้งวัน)
              </span>
              <LineBoardLink line={lineName} />
            </div>
            {!lineRounds.length ? (
              <div style={{ padding: '12px 14px', background: 'var(--bg2)', border: '1px dashed var(--border2)', borderRadius: 10, fontSize: 12, color: 'var(--muted)' }}>
                ⚠️ ไลน์นี้ยังไม่ตั้งรอบจัดส่ง — ตั้งค่าที่ 📦 Line Stock → ⏰ รอบจัดส่ง (demand ด้านบนคำนวณจากแผนผลิตวันนี้แล้ว รอกำหนดรอบเพื่อแจ้งสโตร์)
              </div>
            ) : (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {lineRounds.map(r => {
                const key = `${r.line_name}|${r.shift}|${r.round_no}`;
                const status = getRoundStatus(r, confirmedSet, receivedMap, workDate, nowMs);
                const alloc = roundAlloc[r.id] || { parts: [], totalKanban: 0 };
                const isConf = confirmedSet.has(key);
                const isReceived = !!receivedMap[key]?.received_status;
                const needAction = !isConf && (status.label === '⏳ กำลังเตรียม' || status.label === '🔴 ค้างส่ง');
                const finishTime = addMinutes(r.delivery_time?.slice(0, 5), roundDeliveryMin(r));
                const expandKey = `${lineName}|${r.shift}|${r.round_no}`;
                const isExpanded = expanded === expandKey;
                const confirmedBy = deliveries.find(d => d.line_name === r.line_name && d.shift === r.shift && d.round_no === r.round_no)?.confirmed_by;
                return (
                  <div key={r.id} style={{ minWidth: 200, maxWidth: 260, flexShrink: 0, background: status.bg, border: `1px solid ${status.border}`, borderRadius: 12, overflow: 'hidden', cursor: 'pointer', transition: 'transform 0.15s' }}
                    onClick={() => setExpanded(isExpanded ? null : expandKey)}
                  >
                    <div style={{ height: 4, background: status.top }} />
                    <div style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{r.shift === 'night' ? '🌙' : '☀️'} รอบ {r.round_no}</span>
                        <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 7px', borderRadius: 8, background: 'rgba(0,0,0,0.15)', color: status.color }}>{status.label}</span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--text)', marginBottom: 4 }}>
                        📦 ส่ง {r.delivery_time?.slice(0, 5) || '—'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.7 }}>
                        ตัดยอด {r.cutoff_time?.slice(0, 5) || '—'} · เตรียม {r.prep_minutes || 60} น.<br />
                        {r.points_count || 1} จุด × {r.time_per_point_min || 10} น. · เสร็จ ~{finishTime}
                      </div>
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(128,128,128,0.15)', fontSize: 12 }}>
                        🔩 {alloc.parts.length} พาร์ท · 🎴 <span style={{ fontWeight: 900, color: '#f59e0b' }}>{alloc.totalKanban}</span> การ์ด <span style={{ fontSize: 11, color: 'var(--muted)' }}>(รอบนี้)</span>
                      </div>
                      {confirmedBy && (
                        <div style={{ fontSize: 11, color: '#22c55e', marginTop: 4 }}>✓ {confirmedBy}</div>
                      )}
                      {canOperate && needAction && (
                        <button onClick={e => { e.stopPropagation(); onConfirm(r, alloc.parts); }} disabled={confirming === r.id}
                          style={{ marginTop: 8, width: '100%', padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 800, cursor: 'pointer', background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', fontFamily: 'var(--font-body)' }}>
                          {confirming === r.id ? '...' : '✅ ยืนยันส่งแล้ว'}
                        </button>
                      )}
                      {canOperate && isConf && !isReceived && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 8 }} onClick={e => e.stopPropagation()}>
                          <button onClick={() => onReceive(r, alloc.parts, 'full')}
                            style={{ flex: 1, padding: '6px 4px', borderRadius: 8, fontSize: 11, fontWeight: 800, cursor: 'pointer', background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', fontFamily: 'var(--font-body)' }}>
                            ✔️ รับครบ
                          </button>
                          <button onClick={() => onReceive(r, alloc.parts, 'partial')}
                            style={{ flex: 1, padding: '6px 4px', borderRadius: 8, fontSize: 11, fontWeight: 800, cursor: 'pointer', background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)', fontFamily: 'var(--font-body)' }}>
                            ⚠️ รับไม่ครบ
                          </button>
                        </div>
                      )}
                      {isReceived && (
                        <div style={{ fontSize: 11, color: receivedMap[key].received_status === 'full' ? '#22c55e' : '#f59e0b', marginTop: 4 }}>
                          {receivedMap[key].received_status === 'full' ? '✔️' : '⚠️'} {receivedMap[key].received_by} รับของแล้ว
                          {receivedMap[key].received_note ? ` — ${receivedMap[key].received_note}` : ''}
                        </div>
                      )}
                    </div>
                    {isExpanded && alloc.parts.length > 0 && (
                      <div style={{ borderTop: '1px solid rgba(128,128,128,0.15)', padding: '8px 14px', maxHeight: 220, overflowY: 'auto' }}>
                        {alloc.parts.map(p => {
                          const per = kanbanStd[p.mat_no];
                          return (
                            <div key={p.mat_no} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid rgba(128,128,128,0.1)', fontSize: 11 }}>
                              <div style={{ overflow: 'hidden' }}>
                                <div style={{ fontFamily: 'monospace', color: '#0ea5e9', fontWeight: 700 }}>{p.mat_no}</div>
                                <div style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>{p.part_name}</div>
                              </div>
                              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                <div style={{ fontWeight: 800, color: p.netTotal > 0 ? '#f59e0b' : '#22c55e' }}>
                                  {p.netTotal <= 0 ? '✓ stock พอ' : per ? `${p.cards} ใบ` : `${fmt(p.netTotal)} ${p.uom}`}
                                </div>
                                <div style={{ color: 'var(--muted)', fontSize: 11 }}>ต้องใช้ {fmt(p.qty)}{p.netTotal > 0 && p.netTotal !== p.qty ? ` · NET ${fmt(p.netTotal)}` : ''}</div>
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
function DeliveryTimelineBoard({ rounds, deliveries, view, kanbanStd, fmt, lineMap, workDate, breakPolicies, nowMs }) {
  const [expanded, setExpanded] = useState(null);
  const { groupDemand, roundAlloc } = view;
  const HOURS  = [8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,0,1,2,3,4,5,6,7];
  // มือถือ ≤768px: บอร์ดครึ่งวัน (12 ชม.) เลื่อนแนวนอนได้ + ป้ายซ้าย sticky (desktop เต็มจอเดียวเหมือนเดิม)
  const isMobile = useIsMobile();
  const LEFT_W = isMobile ? 96 : 130;
  const stickyL = (bg) => isMobile ? { position: 'sticky', left: 0, zIndex: 6, background: bg } : null; // z6 เหนือ playhead
  // ยึด grid กับ workDate ที่เลือก (ไม่ใช่วันปฏิทินปัจจุบัน) — ช่วง 00:00–07:59 กะดึกยังอยู่ในกรอบวันงานเดิม
  const gridStartMs = dayFrameMs(workDate).startMs;
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
  // รวมไลน์ที่มี demand จริงแต่ยังไม่ตั้งรอบจัดส่งเข้ามาด้วย กันหายไปจากบอร์ด — group sub-lines ใต้ parent
  const byLine = useMemo(() => {
    const m = {};
    rounds.forEach(r => {
      const key = lineMap?.[r.line_name]?.parent_line_name || r.line_name;
      (m[key] = m[key] || []).push(r);
    });
    Object.keys(groupDemand).forEach(g => { if (!m[g]) m[g] = []; });
    return m;
  }, [rounds, groupDemand, lineMap]);

  const timeToMs = (t) => timeStrToMs(workDate, t);

  if (!Object.keys(byLine).length) return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
      ยังไม่มีรอบจัดส่ง — ตั้งค่าที่ 📦 Line Stock → ⏰ รอบจัดส่ง
    </div>
  );

  const hourHeader = (hours, halfStartMs) => (
    <div style={{ display: 'flex', borderBottom: '1px solid var(--border2)', background: 'var(--bg2)', position: 'relative' }}>
      <div style={{ width: LEFT_W, flexShrink: 0, borderRight: '1px solid var(--border2)', padding: '4px 8px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', ...stickyL('var(--bg2)') }}>รอบจัดส่ง</div>
      {hours.map((h, i) => {
        const slotMs = halfStartMs + i * 3600000;
        const isNow = nowMs >= slotMs && nowMs < slotMs + 3600000;
        const isShiftBound = h === 8 || h === 20;
        return (
          <div key={i} style={{
            flex: 1, minWidth: 0, textAlign: 'center', fontSize: 11,
            fontWeight: isNow ? 800 : isShiftBound ? 600 : 400,
            color: isNow ? '#4d9fff' : isShiftBound ? 'var(--text2)' : 'var(--muted)',
            padding: '4px 0', lineHeight: 1,
            borderRight: `1px solid ${isShiftBound ? 'var(--border2)' : 'var(--border)'}`,
            background: isNow ? 'rgba(77,159,255,0.12)' : 'transparent',
          }}>
            {String(h).padStart(2,'0')}:00
          </div>
        );
      })}
      {/* ป้ายเวลาปัจจุบัน ลอยตรงตำแหน่ง playhead */}
      {nowMs >= halfStartMs && nowMs < halfStartMs + 12 * 3600000 && (() => {
        const t = new Date(nowMs);
        return (
          <div className="now-chip" style={{ left: `calc(${LEFT_W}px + (100% - ${LEFT_W}px) * ${(nowMs - halfStartMs) / (12 * 3600000)})` }}>
            ⏱ {String(t.getHours()).padStart(2, '0')}:{String(t.getMinutes()).padStart(2, '0')}
          </div>
        );
      })()}
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
          const endMs = startMs + roundDeliveryMin(r) * 60000;
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
          const status = getRoundStatus(r, confirmedSet, receivedMap, workDate, nowMs);
          const cards = roundAlloc[r.id]?.totalKanban || 0;
          const expandKey = `${r.line_name}|${r.shift}|${r.round_no}`;
          return (
            <div key={r.id} title={`รอบ ${r.round_no} (${r.shift === 'night' ? 'กะดึก' : 'กะเช้า'}) · ส่ง ${(r.delivery_time||'').slice(0,5)} · ${cards} การ์ด · ${status.label}`}
              onClick={() => setExpanded(expanded === expandKey ? null : expandKey)}
              style={{
                position: 'absolute', top: 4, bottom: 4, left: `${leftPct}%`, width: `${widthPct}%`, minWidth: 22,
                background: `${status.top}28`, border: `1.5px solid ${status.top}cc`,
                borderRadius: 4, overflow: 'hidden', cursor: 'pointer', zIndex: 1,
                display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 3px',
              }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: status.top, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                🎴 รอบ {r.round_no}{cards > 0 ? ` · ${cards}ใบ` : ''}
              </div>
            </div>
          );
        });
      })()}
      {/* Now marker — playhead ชมพูเรืองแสง (สีไม่ซ้ำสถานะใดบนบอร์ด) */}
      {nowMs >= half.startMs && nowMs < half.startMs + 12 * 3600000 && (
        <div className="now-line" style={{ left: `${(nowMs - half.startMs) * pctPerMs}%` }} />
      )}
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
            <span style={{ width: 18, height: 18, borderRadius: 4, background: `${item.c}28`, border: `1.5px solid ${item.c}cc`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>{item.icon}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{item.label}</span>
          </div>
        ))}
      </div>
      {Object.keys(byLine).sort().map(lineName => {
        const lineRounds = byLine[lineName];
        const demand = groupDemand[lineName] || { parts: [], totalKanban: 0 };
        return (
          <div key={lineName} style={{ border: '1px solid var(--border2)', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '8px 14px', background: 'var(--bg2)', borderBottom: '1px solid var(--border2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b', display: 'inline-flex', alignItems: 'center', gap: 8 }}>🏭 {lineName} <LineBoardLink line={lineName} /></span>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{demand.parts.length} พาร์ท · 🎴 {demand.totalKanban} การ์ด (ทั้งวัน)</span>
            </div>
            <div style={isMobile ? { overflowX: 'auto', WebkitOverflowScrolling: 'touch' } : undefined}>
            <div style={isMobile ? { minWidth: 620 } : undefined}>
            {HALVES.map(half => (
              <div key={half.key} style={{ borderTop: half.key === 'pm' ? '2px solid var(--border2)' : 'none' }}>
                {hourHeader(half.hours, half.startMs)}
                <div style={{ display: 'flex', minHeight: 36 }}>
                  <div style={{ width: LEFT_W, flexShrink: 0, padding: '4px 8px', borderRight: '1px solid var(--border2)', display: 'flex', alignItems: 'center', fontSize: 11, color: 'var(--muted)', fontWeight: 700, ...stickyL('var(--card)') }}>
                    {lineRounds.length} รอบ
                  </div>
                  {renderTimeline(lineRounds, half, `${lineName}-${half.key}`)}
                </div>
              </div>
            ))}
            </div>
            </div>
            {/* expanded round detail — demand เฉพาะรอบนั้น */}
            {lineRounds.map(r => {
              const expandKey = `${r.line_name}|${r.shift}|${r.round_no}`;
              if (expanded !== expandKey) return null;
              const alloc = roundAlloc[r.id] || { parts: [], totalKanban: 0 };
              return (
                <div key={expandKey} style={{ borderTop: '1px solid var(--border2)', padding: '10px 14px', background: 'var(--bg)' }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>
                    {r.shift === 'night' ? '🌙' : '☀️'} รอบ {r.round_no} — ตัดยอด {(r.cutoff_time||'').slice(0,5) || '—'} · ส่ง {(r.delivery_time||'').slice(0,5)} · 🎴 {alloc.totalKanban} การ์ด · {getRoundStatus(r, confirmedSet, receivedMap, workDate, nowMs).label}
                  </div>
                  {alloc.parts.length === 0 ? (
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>ไม่มี demand พาร์ทย่อยที่ตกในรอบนี้</div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {alloc.parts.map(p => {
                        const per = kanbanStd[p.mat_no];
                        return (
                          <span key={p.mat_no} style={chip('var(--bg2)', 'var(--text2)')}>
                            <span style={{ fontFamily: 'monospace', color: '#0ea5e9' }}>{p.mat_no}</span> · {p.netTotal <= 0 ? '✓ stock พอ' : per ? `${p.cards} ใบ` : `${fmt(p.netTotal)} ${p.uom}`}
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
function DeliveryRoundsPanel({ rounds, deliveries, onConfirm, confirming, onReceive, roundAlloc, workDate, nowMs, canOperate, tripsFor }) {
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 12 }}>
          {Object.keys(byLine).sort().map(lineName => (
            <div key={lineName} style={{ background: 'var(--bg2)', borderRadius: 8, padding: 12, border: '1px solid var(--border2)' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', marginBottom: 8, borderBottom: '1px solid var(--border)', paddingBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                🏭 {lineName} <LineBoardLink line={lineName} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {byLine[lineName].map(r => {
                  const key = `${r.line_name}|${r.shift}|${r.round_no}`;
                  const status = getRoundStatus(r, confirmedSet, receivedMap, workDate, nowMs);
                  const isConf = confirmedSet.has(key);
                  const isReceived = !!receivedMap[key]?.received_status;
                  const confirmedBy = deliveries.find(d => d.line_name === r.line_name && d.shift === r.shift && d.round_no === r.round_no)?.confirmed_by;
                  const alloc = roundAlloc?.[r.id] || { parts: [], totalKanban: 0 };
                  const parts = alloc.parts;
                  return (
                    <div key={r.id} style={{ background: 'var(--card)', borderRadius: 6, padding: '8px 10px', border: `1px solid ${status.border}`, opacity: isConf ? 0.8 : 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>{r.shift === 'night' ? '🌙' : '☀️'} รอบ {r.round_no}</div>
                        <span style={chip(status.bg, status.color)}>{status.label}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        ตัดยอด {r.cutoff_time?.slice(0,5) || '—'} → ส่ง {r.delivery_time?.slice(0,5) || '—'} · 🎴 {alloc.totalKanban} การ์ด
                      </div>
                      {(() => {
                        const tp = tripsFor?.(r.id, alloc.totalKanban);
                        if (!tp) return null;
                        return (
                          <div style={{ fontSize: 11, marginTop: 2, color: tp.trips > 1 ? '#f59e0b' : 'var(--muted)', fontWeight: tp.trips > 1 ? 700 : 400 }}
                            title={tp.assigned ? 'คิดจากรถของคนขับที่มอบหมายรอบนี้ (หน้า มอบหมายขนส่ง)' : 'ยังไม่มอบหมายคนขับ — คิดจากรถที่จุมากสุด'}>
                            {tp.veh.icon} {alloc.totalKanban} กล่อง ÷ จุ {tp.cap} = <b>{tp.trips} เที่ยว</b>{tp.assigned ? '' : ' (ยังไม่มอบหมายรถ)'}
                          </div>
                        );
                      })()}
                      {confirmedBy && <div style={{ fontSize: 11, color: '#22c55e', marginTop: 3 }}>✓ {confirmedBy}</div>}
                      {canOperate && !isConf && (
                        <button onClick={() => onConfirm(r, parts)} disabled={confirming === r.id}
                          style={{ marginTop: 6, width: '100%', padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', fontFamily: 'var(--font-body)' }}>
                          {confirming === r.id ? '...' : '✅ ยืนยันส่งแล้ว'}
                        </button>
                      )}
                      {canOperate && isConf && !isReceived && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                          <button onClick={() => onReceive(r, parts, 'full')}
                            style={{ flex: 1, padding: '5px 4px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', fontFamily: 'var(--font-body)' }}>
                            ✔️ รับครบ
                          </button>
                          <button onClick={() => onReceive(r, parts, 'partial')}
                            style={{ flex: 1, padding: '5px 4px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)', fontFamily: 'var(--font-body)' }}>
                            ⚠️ ไม่ครบ
                          </button>
                        </div>
                      )}
                      {isReceived && (
                        <div style={{ fontSize: 11, color: receivedMap[key].received_status === 'full' ? '#22c55e' : '#f59e0b', marginTop: 3 }}>
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

/* ─── Smart Scheduling Planner Strip — รอบถัดไป / ค้างส่ง / การ์ดคงเหลือ / เตือนตารางชนกัน ── */
function PlannerStrip({ rounds, deliveries, roundAlloc, workDate, breakPolicies, nowMs }) {
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

  if (!rounds.length) return null;
  const { startMs, endMs } = dayFrameMs(workDate);
  const isToday = nowMs >= startMs && nowMs < endMs;

  const pending = rounds.filter(r => !confirmedSet.has(`${r.line_name}|${r.shift}|${r.round_no}`));
  const overdue = pending.filter(r => getRoundStatus(r, confirmedSet, receivedMap, workDate, nowMs).label === '🔴 ค้างส่ง');
  const cardsLeft = pending.reduce((s, r) => s + (roundAlloc[r.id]?.totalKanban || 0), 0);
  const confirmedCount = rounds.length - pending.length;

  // รอบถัดไป = รอบที่ยังไม่ยืนยัน และช่วงส่งยังไม่จบ (เรียงตามเวลาบนกรอบ 08:00→08:00 ของ workDate)
  const next = isToday
    ? pending
        .map(r => ({ r, ms: timeStrToMs(workDate, r.delivery_time) }))
        .filter(x => x.ms != null && x.ms + roundDeliveryMin(x.r) * 60000 > nowMs)
        .sort((a, b) => a.ms - b.ms)[0] || null
    : null;
  const nextMins = next ? Math.round((next.ms - nowMs) / 60000) : null;

  // ตัดยอดถัดไป = หน้าต่าง demand ที่กำลังจะปิด — สโตร์ต้องรู้ก่อนเพื่อเตรียมของทัน
  const nextCut = isToday
    ? pending
        .map(r => ({ r, ms: timeStrToMs(workDate, r.cutoff_time) }))
        .filter(x => x.ms != null && x.ms > nowMs)
        .sort((a, b) => a.ms - b.ms)[0] || null
    : null;
  const nextCutMins = nextCut ? Math.round((nextCut.ms - nowMs) / 60000) : null;

  // ⚠️ ตรวจตารางรอบ: cutoff ต้องมาก่อนเวลาส่ง + ช่วงส่งไม่ควรชนช่วงพักของกะนั้น
  const breakIvs = breakPolicies.map(p => {
    const s = timeStrToMs(workDate, p.start_time);
    return s == null ? null : { s, e: s + (p.duration_min || 0) * 60000, name: p.name_th || p.name_en || p.name || 'พัก', shift: p.shift || 'both' };
  }).filter(Boolean);
  const warnings = [];
  rounds.forEach(r => {
    const cut = timeStrToMs(workDate, r.cutoff_time);
    const dlv = timeStrToMs(workDate, r.delivery_time);
    if (cut != null && dlv != null && cut >= dlv)
      warnings.push(`${r.line_name} รอบ ${r.round_no}: เวลาตัดยอด ${r.cutoff_time?.slice(0, 5)} ต้องมาก่อนเวลาส่ง ${r.delivery_time?.slice(0, 5)}`);
    if (dlv != null) {
      const fin = dlv + roundDeliveryMin(r) * 60000;
      const hit = breakIvs.find(b => (b.shift === 'both' || b.shift === r.shift) && dlv < b.e && fin > b.s);
      if (hit) warnings.push(`${r.line_name} รอบ ${r.round_no}: ช่วงส่ง ${r.delivery_time?.slice(0, 5)} ชนช่วง "${hit.name}" — ควรเลื่อนเวลาส่ง`);
    }
  });

  // ⚖️ ตรวจสมดุลโหลด (heijunka): รอบไหนแบกการ์ดเกิน 2 เท่าของค่าเฉลี่ยไลน์|กะ → แนะนำขยับเวลาตัดยอด/เพิ่มรอบ
  const loadByLS = {};
  rounds.forEach(r => {
    const k = `${r.line_name}|${r.shift}`;
    (loadByLS[k] = loadByLS[k] || []).push({ r, cards: roundAlloc[r.id]?.totalKanban || 0 });
  });
  Object.values(loadByLS).forEach(list => {
    if (list.length < 2) return;
    const total = list.reduce((s, x) => s + x.cards, 0);
    if (!total) return;
    const avg = total / list.length;
    list.forEach(({ r, cards }) => {
      if (cards >= avg * 2 && cards >= 4)
        warnings.push(`${r.line_name} รอบ ${r.round_no}: โหลด ${cards} การ์ด สูงกว่าค่าเฉลี่ย ${avg.toFixed(1)} มาก — พิจารณาขยับเวลาตัดยอดหรือเพิ่มรอบเพื่อเกลี่ยโหลด (heijunka)`);
    });
  });

  const tile = (icon, label, value, sub, color) => (
    <div key={label} style={{ flex: '1 1 150px', minWidth: 150, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '10px 14px' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{icon} {label}</div>
      <div style={{ fontSize: 20, fontWeight: 900, fontFamily: 'var(--font-display)', color: color || 'var(--text)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {tile('⏱', 'ตัดยอดถัดไป',
          nextCut ? `อีก ${nextCutMins} นาที` : isToday ? '—' : '—',
          nextCut ? `${nextCut.r.line_name} รอบ ${nextCut.r.round_no} · ตัดยอด ${nextCut.r.cutoff_time?.slice(0, 5)}` : (isToday ? 'ไม่มีรอบที่รอตัดยอด' : 'นอกกรอบวันงานที่เลือก'),
          nextCut && nextCutMins <= 15 ? '#f59e0b' : 'var(--text)')}
        {tile('⏭', 'รอบส่งถัดไป',
          next ? (nextMins > 0 ? `อีก ${nextMins} นาที` : '🚚 กำลังส่ง') : isToday ? 'ครบทุกรอบแล้ว' : '—',
          next ? `${next.r.line_name} รอบ ${next.r.round_no} · ส่ง ${next.r.delivery_time?.slice(0, 5)}` : (isToday ? '' : 'นอกกรอบวันงานที่เลือก'),
          next && nextMins <= 15 ? '#f59e0b' : 'var(--text)')}
        {tile('🔴', 'รอบค้างส่ง', overdue.length,
          overdue.length ? overdue.slice(0, 2).map(r => `${r.line_name} รอบ ${r.round_no}`).join(' · ') + (overdue.length > 2 ? ` +${overdue.length - 2}` : '') : 'ไม่มี',
          overdue.length ? '#ef4444' : '#22c55e')}
        {tile('🎴', 'การ์ดรอเตรียมส่ง', cardsLeft, `${pending.length} รอบที่ยังไม่ยืนยันส่ง`, cardsLeft > 0 ? '#f59e0b' : '#22c55e')}
        {tile('✅', 'ยืนยันส่งแล้ว', `${confirmedCount}/${rounds.length}`, 'รอบของวันนี้ทั้งหมด', confirmedCount === rounds.length ? '#22c55e' : 'var(--text)')}
      </div>
      {warnings.length > 0 && (
        <div style={{ marginTop: 10, padding: '10px 14px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#ef4444', marginBottom: 4 }}>⚠️ ตารางรอบจัดส่งมีจุดที่ควรแก้ ({warnings.length})</div>
          {warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.8 }}>• {w}</div>
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
                borderRadius: 10, fontSize: 11, fontWeight: 800, padding: '2px 7px',
              }}>✓ stock พอ</div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: '#0ea5e9', letterSpacing: 0.5 }}>
                {r.mat_no}
              </span>
              {r.supplier && (
                <span style={{ fontSize: 11, fontWeight: 800, padding: '1px 5px', borderRadius: 6, background: 'var(--bg3)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
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
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{r.uom}</span>
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
function PullBoard({ lotRequests, rawRequests, accumulator, lotSizeMap, busy, onAdvanceLot, onIssueRaw, onReorder, fmt, canOperate }) {
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(290px, 100%), 1fr))', gap: 12 }}>
                {lineLots.map(lot => {
                  const st = LOT_STATUS[lot.status] || LOT_STATUS.pending;
                  const raws = rawByLot[lot.id] || [];
                  const qIdx = queue.findIndex(l => l.id === lot.id);
                  const canReorder = canOperate && lot.status !== 'done' && queue.length > 1;
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
                          <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 8, background: 'rgba(0,0,0,0.12)', color: st.color }}>{st.label}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{lot.part_name || ''}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                          <span style={{ fontSize: 20, fontWeight: 900, color: 'var(--text)' }}>{fmt(lot.lot_qty)} <span style={{ fontSize: 11, color: 'var(--muted)' }}>ชิ้น/ล็อต</span></span>
                          {canReorder && (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="tbtn" onClick={() => onReorder(queue, lot, 'up')} disabled={busy === lot.id || qIdx === 0}
                                style={{ padding: '2px 8px', borderRadius: 6, cursor: qIdx === 0 ? 'default' : 'pointer', fontSize: 12, fontWeight: 800, background: 'var(--bg2)', color: qIdx === 0 ? 'var(--border2)' : 'var(--text)', border: '1px solid var(--border)' }}>▲</button>
                              <button className="tbtn" onClick={() => onReorder(queue, lot, 'down')} disabled={busy === lot.id || qIdx === queue.length - 1}
                                style={{ padding: '2px 8px', borderRadius: 6, cursor: qIdx === queue.length - 1 ? 'default' : 'pointer', fontSize: 12, fontWeight: 800, background: 'var(--bg2)', color: qIdx === queue.length - 1 ? 'var(--border2)' : 'var(--text)', border: '1px solid var(--border)' }}>▼</button>
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                          {lot.work_date || ''}{lot.source_prod_no ? ` · จาก FG ${lot.source_prod_no}` : ''}
                        </div>
                        {canOperate && st.next && (
                          <button onClick={() => onAdvanceLot(lot, st.next)} disabled={busy === lot.id}
                            style={{ marginTop: 8, width: '100%', padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer', background: 'rgba(0,0,0,0.12)', color: st.color, border: `1px solid ${st.border}`, fontFamily: 'var(--font-body)' }}>
                            {busy === lot.id ? '...' : st.nextLabel}
                          </button>
                        )}
                      </div>
                      {raws.length > 0 && (
                        <div style={{ borderTop: '1px solid rgba(128,128,128,0.15)', padding: '8px 14px', background: 'rgba(0,0,0,0.06)' }}>
                          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', marginBottom: 6 }}>📤 ใบเบิกวัตถุดิบ (Store Raw)</div>
                          {raws.map(r => {
                            const issued = r.status === 'issued';
                            return (
                              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 11 }}>
                                <div>
                                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: matColor(r.raw_mat_no) }}>{r.raw_mat_no}</span>
                                  <span style={{ color: 'var(--muted)', marginLeft: 6 }}>{fmt(r.qty)}</span>
                                </div>
                                {issued
                                  ? <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 700 }}>✔ จ่ายแล้ว</span>
                                  : canOperate
                                    ? <button onClick={() => onIssueRaw(r)} disabled={busy === r.id}
                                        style={{ padding: '3px 9px', borderRadius: 7, fontSize: 11, fontWeight: 800, cursor: 'pointer', background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', fontFamily: 'var(--font-body)' }}>
                                        {busy === r.id ? '...' : 'จ่าย'}
                                      </button>
                                    : null}
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
   🏭 Store FG (parent 100) → ไลน์ประกอบ · 🔧 Store Child (200 ผลิตเอง) → เริ่มผลิต
   🛒 จัดซื้อ (300/500 ซื้อ supplier) → รับเข้าสโตร์ · 📦 Rack Center (ภาชนะ+packaging) → ทุกไลน์
   ทุกสโตร์ใช้การ์ดหน้าตาเดียวกัน: สถานะ → ปลายทาง → ปุ่มขยับสถานะ ────────────── */
const STORE_TABS = [
  { key: 'fg',       icon: '🏭', label: 'Store FG',      desc: 'พาร์ทแม่ (100) → ไลน์ประกอบ' },
  { key: 'child',    icon: '🔧', label: 'Store Child',   desc: 'พาร์ทย่อยผลิตเอง (200) → เริ่มผลิต' },
  { key: 'purchase', icon: '🛒', label: 'จัดซื้อ',       desc: 'ของซื้อ (300/500) → รับเข้าสโตร์' },
  { key: 'raw',      icon: '🧱', label: 'Store Raw Mat', desc: 'เบิกวัตถุดิบเข้าการผลิต child' },
  { key: 'rack',     icon: '📦', label: 'Rack Center',   desc: 'ภาชนะ + Packaging → ทุกไลน์' },
  { key: 'wip',      icon: '🔄', label: 'WIP Point',     desc: 'จุด WIP ในไลน์ที่เรียกเติม → ไลน์นั้น' },
];
// ของซื้อจาก supplier (300 child ซื้อ / 500 raw) — 2 สเต็ป: สั่งซื้อ → รับเข้า (เติม stock)
const PURCHASE_STATUS = {
  pending:  { label: '🆕 รอสั่งซื้อ',  color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)', next: 'ordered',  nextLabel: '🛒 สั่งซื้อแล้ว' },
  ordered:  { label: '🚚 รอของเข้า',   color: '#0ea5e9', bg: 'rgba(14,165,233,0.1)', border: 'rgba(14,165,233,0.3)', next: 'received', nextLabel: '✅ รับเข้าสโตร์' },
  received: { label: '✅ รับเข้าแล้ว',  color: '#22c55e', bg: 'rgba(34,197,94,0.1)',  border: 'rgba(34,197,94,0.3)',  next: null,       nextLabel: null },
};
const PURCHASE_FILTERS = [
  { key: '',  label: 'ทั้งหมด' },
  { key: '3', label: '🟠 Child ซื้อ (3xxxxxxx)' },
  { key: '5', label: '🟣 Raw Mat (5xxxxxxx)' },
];
const WIP_STATUS = {
  pending:   { label: '🔔 เรียกแล้ว',   color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)', next: '🔧 เริ่มเตรียม' },
  preparing: { label: '🔧 กำลังเตรียม', color: '#0ea5e9', bg: 'rgba(14,165,233,0.1)', border: 'rgba(14,165,233,0.3)', next: '✅ ส่งเติมแล้ว' },
  delivered: { label: '✅ เติมแล้ว',    color: '#22c55e', bg: 'rgba(34,197,94,0.1)',  border: 'rgba(34,197,94,0.3)', next: null },
};
function QueueCard({ code, name, qty, unit, destination, statusLabel, statusColor, statusBg, statusBorder, actionLabel, onAction, busy, meta }) {
  return (
    <div style={{ background: statusBg, border: `1px solid ${statusBorder}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ height: 4, background: statusColor }} />
      <div style={{ padding: '10px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'monospace', fontWeight: 800, color: matColor(code), fontSize: 13 }}>{code}</span>
          <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 8, background: 'rgba(0,0,0,0.12)', color: statusColor }}>{statusLabel}</span>
        </div>
        {name && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{name}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8 }}>
          <span style={{ fontSize: 20, fontWeight: 900, color: 'var(--text)' }}>{qty} <span style={{ fontSize: 11, color: 'var(--muted)' }}>{unit || ''}</span></span>
          {destination && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'rgba(59,130,246,0.12)', color: '#3b82f6' }}>➜ {destination}</span>}
        </div>
        {meta && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{meta}</div>}
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
function UnifiedStoreBoard({ store, setStore, rounds, deliveries, view, onConfirm, confirming, onReceive,
  lotRequests, rawRequests, rackRequests, pkgRequests, wipRequests, purchaseRequests, busy, onAdvanceLot, onIssueRaw, onAdvanceWip, onAdvancePurchase, fmt, workDate, nowMs, canOperate }) {

  const { roundAlloc } = view;
  const [buyFilter, setBuyFilter] = useState('');   // '' | '300' | '500'
  const confirmedSet = useMemo(() => { const s = new Set(); deliveries.forEach(d => s.add(`${d.line_name}|${d.shift}|${d.round_no}`)); return s; }, [deliveries]);
  const receivedMap  = useMemo(() => { const m = {}; deliveries.forEach(d => { m[`${d.line_name}|${d.shift}|${d.round_no}`] = d; }); return m; }, [deliveries]);

  const openPurchases = purchaseRequests.filter(p => p.status !== 'received' && p.status !== 'cancelled');
  const counts = {
    fg: rounds.filter(r => !confirmedSet.has(`${r.line_name}|${r.shift}|${r.round_no}`)).length,
    child: lotRequests.filter(l => l.status !== 'done').length,
    purchase: openPurchases.length,
    raw: rawRequests.filter(r => r.status !== 'issued').length,
    rack: rackRequests.filter(r => r.status !== 'received').length + pkgRequests.filter(p => p.status !== 'issued').length,
    wip: wipRequests.filter(w => w.status !== 'delivered').length,
  };
  const filteredPurchases = buyFilter ? purchaseRequests.filter(p => matMatches(p.mat_no, buyFilter)) : purchaseRequests;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {STORE_TABS.map(t => (
          <button key={t.key} onClick={() => setStore(t.key)} title={t.desc}
            style={{ padding: '10px 16px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-body)',
              background: store === t.key ? 'var(--accent)' : 'var(--bg2)', color: store === t.key ? '#08130a' : 'var(--text2)',
              border: `1px solid ${store === t.key ? 'var(--accent)' : 'var(--border)'}`, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, minWidth: 150 }}>
            <span>{t.icon} {t.label} {counts[t.key] > 0 && <span style={{ opacity: 0.8 }}>({counts[t.key]})</span>}</span>
            <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.75 }}>{t.desc}</span>
          </button>
        ))}
      </div>

      {store === 'fg' && (
        rounds.length === 0 ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีรอบจัดส่ง</div> :
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(260px, 100%), 1fr))', gap: 12 }}>
          {rounds.map(r => {
            const key = `${r.line_name}|${r.shift}|${r.round_no}`;
            const status = getRoundStatus(r, confirmedSet, receivedMap, workDate, nowMs);
            const isConf = confirmedSet.has(key);
            const isReceived = !!receivedMap[key]?.received_status;
            const alloc = roundAlloc[r.id] || { parts: [], totalKanban: 0 };
            const needAction = !isConf && (status.label === '⏳ กำลังเตรียม' || status.label === '🔴 ค้างส่ง');
            return (
              <QueueCard key={r.id} code={`${r.shift === 'night' ? '🌙' : '☀️'} รอบ ${r.round_no}`} name={r.line_name}
                qty={alloc.totalKanban} unit="การ์ด" destination={r.line_name}
                statusLabel={status.label} statusColor={status.top} statusBg={status.bg} statusBorder={status.border}
                actionLabel={canOperate ? (needAction ? '✅ ยืนยันส่งแล้ว' : (isConf && !isReceived ? '✔️ รับครบ' : null)) : null}
                busy={confirming === r.id}
                onAction={() => needAction ? onConfirm(r, alloc.parts) : onReceive(r, alloc.parts, 'full')}
                meta={`ส่ง ${r.delivery_time?.slice(0,5) || '—'} · ตัดยอด ${r.cutoff_time?.slice(0,5) || '—'} · ${alloc.parts.length} พาร์ท`} />
            );
          })}
        </div>
      )}

      {store === 'child' && (
        lotRequests.length === 0 ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีใบสั่งผลิตพาร์ทย่อย</div> :
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(260px, 100%), 1fr))', gap: 12 }}>
          {lotRequests.map(lot => {
            const st = LOT_STATUS[lot.status] || LOT_STATUS.pending;
            return (
              <QueueCard key={lot.id} code={lot.child_mat_no} name={lot.part_name}
                qty={fmt(lot.lot_qty)} unit="ชิ้น/ล็อต" destination={lot.source_line || 'ของซื้อ'}
                statusLabel={st.label} statusColor={st.color} statusBg={st.bg} statusBorder={st.border}
                actionLabel={canOperate ? st.nextLabel : null} busy={busy === lot.id} onAction={() => onAdvanceLot(lot, st.next)}
                meta={lot.source_prod_no ? `จาก FG ${lot.source_prod_no}` : ''} />
            );
          })}
        </div>
      )}

      {store === 'purchase' && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {PURCHASE_FILTERS.map(f => (
              <button key={f.key} onClick={() => setBuyFilter(f.key)}
                style={{ padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-body)',
                  background: buyFilter === f.key ? 'var(--accent)' : 'var(--bg2)', color: buyFilter === f.key ? '#08130a' : 'var(--text2)',
                  border: `1px solid ${buyFilter === f.key ? 'var(--accent)' : 'var(--border)'}` }}>{f.label}</button>
            ))}
          </div>
          {filteredPurchases.length === 0 ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีรายการจัดซื้อ — เกิดอัตโนมัติเมื่อของซื้อ (300/500) ในสโตร์ไม่พอต่อแผนผลิต</div> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(260px, 100%), 1fr))', gap: 12 }}>
              {filteredPurchases.map(pr => {
                const st = PURCHASE_STATUS[pr.status] || PURCHASE_STATUS.pending;
                return (
                  <QueueCard key={pr.id} code={pr.mat_no} name={pr.part_name}
                    qty={fmt(pr.qty)} unit="ชิ้น" destination={pr.dest_line || '—'}
                    statusLabel={st.label} statusColor={st.color} statusBg={st.bg} statusBorder={st.border}
                    actionLabel={canOperate ? st.nextLabel : null} busy={busy === pr.id} onAction={() => onAdvancePurchase(pr, st.next)}
                    meta={[pr.supplier ? `🏢 ${pr.supplier}` : '', pr.source_prod_no ? `FG ${pr.source_prod_no}` : ''].filter(Boolean).join(' · ')} />
                );
              })}
            </div>
          )}
        </>
      )}

      {store === 'raw' && (
        rawRequests.length === 0 ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีใบเบิกวัตถุดิบ</div> :
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(260px, 100%), 1fr))', gap: 12 }}>
          {rawRequests.map(r => {
            const parentLot = lotRequests.find(l => l.id === r.lot_request_id);
            const issued = r.status === 'issued';
            return (
              <QueueCard key={r.id} code={r.raw_mat_no} name={r.part_name}
                qty={fmt(r.qty)} unit="" destination={parentLot?.source_line || '—'}
                statusLabel={issued ? '✔ จ่ายแล้ว' : '🆕 รอจ่าย'} statusColor={issued ? '#22c55e' : '#f59e0b'}
                statusBg={issued ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)'} statusBorder={issued ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}
                actionLabel={issued || !canOperate ? null : 'จ่ายวัตถุดิบ'} busy={busy === r.id} onAction={() => onIssueRaw(r)}
                meta={`สำหรับ ${r.lot_request_id ? parentLot?.child_mat_no || '' : ''}`} />
            );
          })}
        </div>
      )}

      {store === 'rack' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>👁️ แสดงคิวภาชนะ/Packaging แบบอ่านอย่างเดียว — เลื่อนสถานะ/จ่ายที่หน้า Rack Center (เจ้าของเดียว กันแข่งกันเขียน)</span>
            <Link to="/rack-center" style={{ fontSize: 12, fontWeight: 800, color: '#0ea5e9', textDecoration: 'none', padding: '5px 12px', borderRadius: 8, border: '1px solid rgba(14,165,233,0.4)', background: 'rgba(14,165,233,0.08)', whiteSpace: 'nowrap' }}>
              🗃️ จัดการที่ Rack Center →
            </Link>
          </div>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', marginBottom: 8 }}>🗃️ ภาชนะ (แร็ค/ถาด)</div>
          {rackRequests.length === 0 ? <div style={{ padding: '10px 0 20px', color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีการเรียกภาชนะ</div> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(260px, 100%), 1fr))', gap: 12, marginBottom: 20 }}>
              {rackRequests.map(r => {
                const st = RACK_STATUS[r.status] || RACK_STATUS.requested;
                return (
                  <QueueCard key={r.id} code={r.container_name || 'ภาชนะ'} name={null}
                    qty={r.qty} unit="ใบ" destination={r.line_name}
                    statusLabel={st.label} statusColor={st.color} statusBg={st.bg} statusBorder={st.border}
                    actionLabel={null} busy={busy === r.id}
                    meta={r.note || ''} />
                );
              })}
            </div>
          )}
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', marginBottom: 8 }}>📦 Packaging (จากการผลิต)</div>
          {pkgRequests.length === 0 ? <div style={{ padding: '10px 0', color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีใบเบิก packaging</div> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(260px, 100%), 1fr))', gap: 12 }}>
              {pkgRequests.map(p => {
                const issued = p.status === 'issued';
                return (
                  <QueueCard key={p.id} code={p.packaging_code} name={p.packaging_name}
                    qty={p.qty} unit="" destination={p.source_line || '—'}
                    statusLabel={issued ? '✔ จ่ายแล้ว' : '🆕 รอจ่าย'} statusColor={issued ? '#22c55e' : '#f59e0b'}
                    statusBg={issued ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)'} statusBorder={issued ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}
                    actionLabel={null} busy={busy === p.id}
                    meta={[p.product_name, p.source_prod_no ? `FG ${p.source_prod_no}` : ''].filter(Boolean).join(' · ')} />
                );
              })}
            </div>
          )}
        </>
      )}

      {store === 'wip' && (
        wipRequests.length === 0 ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีคำขอเติมจุด WIP — เกิดจากกด "🔔 เรียกเติม" ที่ ⚙️ ตั้งค่าผังไลน์ → จุด WIP</div> :
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(260px, 100%), 1fr))', gap: 12 }}>
          {wipRequests.map(w => {
            const st = WIP_STATUS[w.status] || WIP_STATUS.pending;
            const code = w.point_type === 'packaging' ? (w.packaging_no || w.packaging_type || w.point_name) : (w.mat_no || w.point_name);
            return (
              <QueueCard key={w.id} code={code} name={w.point_name}
                qty={fmt(w.request_qty)} unit="" destination={w.line_name}
                statusLabel={st.label} statusColor={st.color} statusBg={st.bg} statusBorder={st.border}
                actionLabel={canOperate ? st.next : null} busy={busy === w.id} onAction={() => onAdvanceWip(w)}
                meta={w.point_type === 'packaging' ? '📦 packaging' : '🧱 material'} />
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function HeijunkaKanban() {
  const { fullName, role } = useContext(UserContext);
  const navigate = useNavigate();
  const canOperate = can('heijunka', 'operate', role);
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
  const [transport, setTransport] = useState({ assigns: [], carriers: [], vehicles: [] }); // มอบหมายคนขับ+ความจุรถ (คำนวณเที่ยว)
  const [confirming, setConfirming] = useState(null);
  const [receiveModal, setReceiveModal] = useState(null); // { round, parts, mode }
  const [receiving, setReceiving] = useState(false);
  // ── Pull system (ใบสั่งผลิตล็อต + ใบเบิกวัตถุดิบ + ตัวสะสม demand) ──
  const [lotRequests, setLotRequests] = useState([]);
  const [rawRequests, setRawRequests] = useState([]);
  const [accumulator, setAccumulator] = useState([]);
  const [lotSizeMap, setLotSizeMap]   = useState({});   // mat_no → lot_size
  const [pullBusy, setPullBusy]       = useState(null);
  const [lineMap,   setLineMap]       = useState({});   // name → { parent_line_name, ... }
  const [parentChildrenMap, setParentChildrenMap] = useState({}); // parent → [children]
  // ── ตู้ Kanban รวม: Rack Center (ภาชนะ + packaging) ──
  const [rackRequests, setRackRequests] = useState([]);
  const [pkgRequests, setPkgRequests]   = useState([]);
  const [wipRequests, setWipRequests]   = useState([]);
  const [purchaseRequests, setPurchaseRequests] = useState([]);   // ของซื้อ 300/500
  const [unifiedStore, setUnifiedStore] = useState('fg'); // 'fg' | 'child' | 'purchase' | 'raw' | 'rack' | 'wip'
  const [breakPolicies, setBreakPolicies] = useState([]);

  useEffect(() => {
    supabaseDR.from('break_policies').select('*').eq('is_active', true)
      .then(({ data }) => setBreakPolicies(data || []));
  }, []);

  // นาฬิกาภายใน — สถานะรอบ (รอ/กำลังเตรียม/ค้างส่ง) และ countdown ต้องเดินเองแม้ไม่มีการโหลดข้อมูลใหม่
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const loadPull = useCallback(async () => {
    const [{ data: lots }, { data: raws }, { data: acc }, { data: ks }, { data: racks }, { data: pkgs }, { data: wips }, { data: purchases }] = await Promise.all([
      supabaseDR.from('child_lot_requests').select('*').order('created_at', { ascending: false }).limit(200),
      supabaseDR.from('raw_withdrawal_requests').select('*').order('created_at', { ascending: false }).limit(400),
      supabaseDR.from('child_demand_accumulator').select('*').gt('pending_qty', 0).order('pending_qty', { ascending: false }),
      supabaseDR.from('kanban_standards').select('mat_no, lot_size').eq('is_active', true),
      supabaseDR.from('rack_requests').select('*').order('requested_at', { ascending: false }).limit(200),
      supabaseDR.from('packaging_withdrawal_requests').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('wip_replenish_requests').select('*').order('requested_at', { ascending: false }).limit(200),
      supabaseDR.from('purchase_requests').select('*').order('created_at', { ascending: false }).limit(300),
    ]);
    setLotRequests(lots || []);
    setRawRequests(raws || []);
    setAccumulator(acc || []);
    // กรองใบยกเลิกออก — ให้เห็นชุดเดียวกับบอร์ดหน้า Rack Center เป๊ะ (เคยโชว์ใบ cancelled เป็น "เรียกแล้ว" หลอกตา)
    setRackRequests((racks || []).filter(r => r.status !== 'cancelled'));
    setPkgRequests(pkgs || []);
    setWipRequests(wips || []);
    setPurchaseRequests(purchases || []);
    const lm = {};
    (ks || []).forEach(s => { if (s.lot_size != null) lm[s.mat_no] = s.lot_size; });
    setLotSizeMap(lm);
  }, []);

  const advanceLot = async (lot, next) => {
    if (lot.status === next) return;
    setPullBusy(lot.id);
    try {
      // เปลี่ยนสถานะแบบมีเงื่อนไข: อัปเดตเฉพาะแถวที่ยัง "ไม่ใช่" ค่าใหม่ แล้วเช็คว่าเราเป็นคนเปลี่ยนจริง
      // กัน double-click / สองแท็บ ไม่ให้ insert stock (issue/consume) ซ้ำตอนปิดล็อต
      const { data: updated, error } = await supabaseDR.from('child_lot_requests')
        .update({ status: next }).eq('id', lot.id).neq('status', next).select('id');
      if (error) throw error;
      if (!updated || updated.length === 0) { await loadPull(); setPullBusy(null); return; }
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
      // toast ตามจริง: เติมสต็อกเฉพาะเมื่อมี source_line (ผลิตเองแล้วของกลับเข้าสโตร์)
      toast.success(next === 'done'
        ? (lot.source_line ? `✅ ผลิตเสร็จ ${lot.child_mat_no} · เติมสต็อกสโตร์ +${lot.lot_qty}` : `✅ ปิดล็อต ${lot.child_mat_no}`)
        : `อัปเดตล็อต ${lot.child_mat_no} → ${next}`);
      await loadPull();
      await load();
    } catch (err) { toast.error(err.message); }
    setPullBusy(null);
  };

  // จัดซื้อ (ของ 300/500): pending → ordered (สั่งซื้อแล้ว) → received (รับเข้า = เติม stock ที่ dest_line)
  const advancePurchase = async (pr, next) => {
    if (pr.status === next) return;
    setPullBusy(pr.id);
    try {
      const patch = { status: next };
      if (next === 'ordered')  { patch.ordered_by = fullName || 'จัดซื้อ'; patch.ordered_at = new Date().toISOString(); }
      if (next === 'received') { patch.received_by = fullName || 'สโตร์'; patch.received_at = new Date().toISOString(); }
      // อัปเดตแบบมีเงื่อนไข กันกดซ้ำ/สองแท็บ ไม่ให้เติม stock ซ้ำ
      const { data: updated, error } = await supabaseDR.from('purchase_requests')
        .update(patch).eq('id', pr.id).neq('status', next).select('id');
      if (error) throw error;
      if (!updated || updated.length === 0) { await loadPull(); setPullBusy(null); return; }
      if (next === 'received' && pr.dest_line) {
        const { error: e2 } = await supabaseDR.from('line_stock_transactions').insert({
          line_name: pr.dest_line, mat_no: pr.mat_no, part_name: pr.part_name, qty: pr.qty,
          type: 'issue', work_date: pr.work_date || getWorkDate(),
          note: `รับของซื้อเข้าสโตร์${pr.supplier ? ' · ' + pr.supplier : ''}`, created_by: fullName || 'สโตร์',
        });
        if (e2) throw e2;
      }
      toast.success(next === 'ordered' ? `🛒 บันทึกสั่งซื้อ ${pr.mat_no}` : `✅ รับเข้าสโตร์ ${pr.mat_no} +${pr.qty}`);
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

  // rack_requests + packaging_withdrawal_requests: เลื่อนสถานะ/จ่าย = ทำที่หน้า Rack Center เท่านั้น
  // (เดิม advanceRack/issuePkg ซ้ำที่นี่ด้วย → แข่งกันเขียน + พฤติกรรมต่าง · ยุบให้ RackCenter เป็นเจ้าของเดียว 2026-07-21)
  // บอร์ดนี้แสดงคิว rack/packaging แบบอ่านอย่างเดียว + ลิงก์ไป /rack-center

  // เติมจุด WIP: pending → preparing → delivered — พอ delivered ค่อยบวก current_qty กลับที่จุดจริง (main supabase)
  const advanceWip = async (w) => {
    const next = { pending: 'preparing', preparing: 'delivered' }[w.status];
    if (!next) return;
    setPullBusy(w.id);
    try {
      const payload = { status: next };
      if (next === 'delivered') { payload.delivered_by = fullName || 'สโตร์'; payload.delivered_at = new Date().toISOString(); }
      const { error } = await supabase.from('wip_replenish_requests').update(payload).eq('id', w.id);
      if (error) throw error;
      if (next === 'delivered' && w.wip_point_id) {
        const { data: point } = await supabase.from('wip_buffer_points').select('current_qty, max_qty').eq('id', w.wip_point_id).single();
        if (point) {
          const newQty = Math.min((point.current_qty || 0) + w.request_qty, point.max_qty ?? Infinity);
          await supabase.from('wip_buffer_points').update({ current_qty: newQty }).eq('id', w.wip_point_id);
        }
      }
      toast.success(next === 'delivered' ? `✅ เติม ${w.point_name} เรียบร้อย` : `อัปเดต ${w.point_name} → ${next}`);
      await loadPull();
    } catch (err) { toast.error(err.message); }
    setPullBusy(null);
  };

  /* ── load & explode ── */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 0) production line hierarchy
      const { data: linesData } = await supabase.from('production_lines').select('id, name, parent_line_name').order('name');
      const lm = {};
      const pcm = {};
      (linesData || []).forEach(l => {
        lm[l.name] = l;
        if (l.parent_line_name) {
          if (!pcm[l.parent_line_name]) pcm[l.parent_line_name] = [];
          pcm[l.parent_line_name].push(l.name);
        }
      });
      setLineMap(lm);
      setParentChildrenMap(pcm);

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
        supabaseDR.from('prod_orders').select('session_id, mat_no, part_name, qty, status, opened_at').in('session_id', sessIds),
        supabaseDR.from('kanban_targets').select('session_id, mat_no, part_name, qty_target').in('session_id', sessIds),
        supabaseDR.from('dr_products').select('id, name, mat_no').eq('is_active', true),
      ]);
      const prodByMat = {};
      (products || []).forEach(p => { if (p.mat_no) prodByMat[p.mat_no] = p; });

      // demand ระดับ parent ต่อ session: ใช้ prod_orders ก่อน, session ไหนไม่มี order → fallback kanban_targets
      // opened_at ใช้จัดสรร demand เข้ารอบจัดส่ง (targets ไม่มีเวลาสแกน → เกลี่ยทุกรอบแบบ heijunka)
      const activeOrders = (orders || []).filter(o => o.status !== 'cancelled');
      const sessionsWithOrders = new Set(activeOrders.map(o => o.session_id));
      const dem = [];
      activeOrders.forEach(o => {
        if (!o.qty) return;
        dem.push({ session_id: o.session_id, mat_no: o.mat_no, part_name: o.part_name, qty: o.qty, opened_at: o.opened_at, product: prodByMat[o.mat_no] || null });
      });
      (targets || []).forEach(t => {
        if (sessionsWithOrders.has(t.session_id) || !t.qty_target) return;
        dem.push({ session_id: t.session_id, mat_no: t.mat_no, part_name: t.part_name, qty: t.qty_target, opened_at: null, product: prodByMat[t.mat_no] || null });
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
    const [{ data: rds }, { data: dlvs }, { data: asg }, { data: car }, { data: veh }] = await Promise.all([
      supabaseDR.from('kanban_delivery_rounds').select('*').eq('is_active', true).order('line_name').order('round_no'),
      supabaseDR.from('kanban_deliveries').select('*').eq('work_date', workDate),
      // ฝั่ง Transport (มอบหมายคนขับ + ความจุรถ) — ใช้คำนวณ load กี่เที่ยวต่อรอบ (best-effort)
      supabaseDR.from('transport_round_assignments').select('round_id, carrier_id').eq('work_date', workDate),
      supabaseDR.from('transport_carriers').select('id, vehicles').eq('is_active', true),
      supabaseDR.from('transport_vehicles').select('*').eq('is_active', true).order('sort_order'),
    ]);
    setRounds(rds || []);
    setDeliveries(dlvs || []);
    setTransport({ assigns: asg || [], carriers: car || [], vehicles: veh || [] });
  }, [workDate]);

  // load รอบส่ง: การ์ด kanban N ใบ (1 การ์ด = 1 กล่อง/packaging) ÷ ความจุรถ = กี่เที่ยว
  // รถที่ใช้คิด: รอบที่มอบหมายคนขับแล้ว (หน้า /transport) = รถของคนขับคนนั้น · ยังไม่มอบหมาย = รถที่จุมากสุดในระบบ
  // ยังไม่ตั้งความจุรถเลย (migration 20260803 / ช่อง "จุ กล่อง/เที่ยว" ใน /transport) = ไม่แสดง
  const tripsFor = useCallback((roundId, cards) => {
    if (!cards || !transport.vehicles.length) return null;
    const asg = transport.assigns.find(a => a.round_id === roundId);
    const carrier = asg?.carrier_id ? transport.carriers.find(c => c.id === asg.carrier_id) : null;
    const codes = carrier?.vehicles?.length ? carrier.vehicles : transport.vehicles.map(v => v.code);
    const cand = codes.map(c => transport.vehicles.find(v => v.code === c)).filter(v => v && Number(v.capacity_pkg) > 0);
    if (!cand.length) return null;
    const veh = cand.reduce((b, v) => (Number(v.capacity_pkg) > Number(b.capacity_pkg) ? v : b), cand[0]);
    const cap = Number(veh.capacity_pkg);
    return { trips: Math.ceil(cards / cap), veh, cap, assigned: !!carrier };
  }, [transport]);

  useEffect(() => { loadDeliveries(); }, [loadDeliveries]);
  useEffect(() => { loadPull(); }, [loadPull]);

  const confirmRound = async (r, parts) => {
    if (confirming) return;
    setConfirming(r.id);
    try {
      // กันยืนยันซ้ำแบบ atomic: insert แถวยืนยันด้วย ON CONFLICT DO NOTHING (ignoreDuplicates)
      // — 2 เครื่องสโตร์ (บัญชีร่วม) กดยืนยันรอบเดียวกันพร้อมกัน มีแค่ตัวเดียวที่ insert สำเร็จ (คืนแถว)
      // ตัวที่ชน conflict คืน [] → ข้าม issueRows · เดิมเป็น read-then-write ทำให้ stock ถูก issue ซ้ำถาวร
      const { data: claimed, error } = await supabaseDR.from('kanban_deliveries').upsert({
        work_date: workDate, line_name: r.line_name, shift: r.shift, round_no: r.round_no,
        confirmed_at: new Date().toISOString(), confirmed_by: fullName || 'Store',
      }, { onConflict: 'work_date,line_name,shift,round_no', ignoreDuplicates: true }).select('id');
      if (error) throw error;
      if (!claimed || claimed.length === 0) {
        toast.info(`รอบ ${r.round_no} ยืนยันส่งไปแล้ว — ไม่บันทึกซ้ำ`);
        await loadDeliveries();
        setConfirming(null);
        return;
      }
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

  /* ── explode เป็น demand พาร์ทย่อย + จัดสรรเข้ารอบจัดส่ง (smart scheduling) ── */
  const view = useMemo(() => {
    const sessById = Object.fromEntries(sessions.map(s => [s.id, s]));
    const groupOf = (line) => lineMap[line]?.parent_line_name || line;
    const visibleSessions = sessions.filter(s => shiftFilter === 'all' || s.shift === shiftFilter);
    const visibleIds = new Set(visibleSessions.map(s => s.id));

    // columns = ไลน์·กะ ที่มี demand
    const cols = visibleSessions.map(s => ({ id: s.id, line: s.line_name, shift: s.shift, status: s.status }));

    const { startMs: dayStartMs, endMs: dayEndMs } = dayFrameMs(workDate);

    // ── รอบจัดส่งต่อ กลุ่มไลน์|กะ + หน้าต่างตัดยอด [cutoff รอบก่อนหน้า, cutoff รอบนี้) ──
    const roundsByGS = {};
    rounds.forEach(r => {
      const k = `${groupOf(r.line_name)}|${r.shift}`;
      (roundsByGS[k] = roundsByGS[k] || []).push(r);
    });
    const roundWindows = {};
    Object.values(roundsByGS).forEach(list => {
      list.sort((a, b) =>
        (timeStrToMs(workDate, a.cutoff_time || a.delivery_time) ?? dayEndMs) -
        (timeStrToMs(workDate, b.cutoff_time || b.delivery_time) ?? dayEndMs));
      let prev = dayStartMs;
      list.forEach((r, i) => {
        const cut = timeStrToMs(workDate, r.cutoff_time || r.delivery_time) ?? dayEndMs;
        roundWindows[r.id] = { startMs: prev, endMs: i === list.length - 1 ? dayEndMs : cut };
        prev = cut;
      });
    });
    // order ที่สแกนเปิดตกหน้าต่างไหน → เข้ารอบนั้น · เปิดก่อนวันงาน (carry-over) → รอบแรก · หลังรอบสุดท้าย → รอบสุดท้าย
    const roundIdForOrder = (gsKey, openedAtIso) => {
      const list = roundsByGS[gsKey];
      if (!list?.length || !openedAtIso) return null;
      let ms = new Date(openedAtIso).getTime();
      if (Number.isNaN(ms)) return null;
      if (ms < dayStartMs) ms = dayStartMs;
      for (const r of list) {
        const w = roundWindows[r.id];
        if (ms >= w.startMs && ms < w.endMs) return r.id;
      }
      return list[list.length - 1].id;
    };

    // rows: child mat_no → gross demand ต่อ col + stock ต่อไลน์ → net demand
    const rows = {};
    const noBom = new Map();
    const grossByRound = {};  // roundId → { mat_no: gross qty ที่ตกในรอบนั้น }
    const evenPool = {};      // gsKey  → { mat_no: qty } demand ไม่มีเวลาสแกน (kanban_targets) → เกลี่ยทุกรอบ
    demands.forEach(d => {
      if (!visibleIds.has(d.session_id)) return;
      const sess = sessById[d.session_id];
      const bomItems = d.product ? bomMap[d.product.id] : null;
      if (!bomItems?.length) {
        const key = d.mat_no || d.part_name;
        noBom.set(key, { name: d.part_name || d.mat_no, mat_no: d.mat_no, qty: (noBom.get(key)?.qty || 0) + d.qty });
        return;
      }
      const gsKey = sess ? `${groupOf(sess.line_name)}|${sess.shift}` : null;
      const hasRounds = !!(gsKey && roundsByGS[gsKey]?.length);
      const rid = hasRounds ? roundIdForOrder(gsKey, d.opened_at) : null;
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
        if (rid) {
          const g = grossByRound[rid] = grossByRound[rid] || {};
          g[b.mat_no] = (g[b.mat_no] || 0) + need;
        } else if (hasRounds) {
          const g = evenPool[gsKey] = evenPool[gsKey] || {};
          g[b.mat_no] = (g[b.mat_no] || 0) + need;
        }
      });
    });

    // เกลี่ย demand ที่ไม่มีเวลาสแกนให้ทุกรอบของกะนั้นเท่า ๆ กัน (heijunka leveling — ผลรวมคงเดิม)
    Object.entries(evenPool).forEach(([gsKey, mats]) => {
      const list = roundsByGS[gsKey];
      Object.entries(mats).forEach(([mat, qty]) => {
        let acc = 0;
        list.forEach((r, i) => {
          const target = Math.round((qty * (i + 1)) / list.length);
          const give = target - acc;
          acc = target;
          if (give <= 0) return;
          const g = grossByRound[r.id] = grossByRound[r.id] || {};
          g[mat] = (g[mat] || 0) + give;
        });
      });
    });

    // คำนวณ net = gross - total stock ที่มีในทุกไลน์ที่เกี่ยวข้อง
    let rowList = Object.values(rows).map(r => {
      const totalStock = Object.values(r.stockPerLine).reduce((s, v) => s + v, 0);
      const netTotal   = Math.max(0, r.grossTotal - totalStock);
      return { ...r, totalStock, netTotal };
    }).sort((a, b) => a.mat_no.localeCompare(b.mat_no));

    // กรองตามประเภทพาร์ท (mat_no prefix) — ใช้กับมุมมองวิเคราะห์ (การ์ด/ตาราง/CSV)
    // ส่วน roundAlloc/groupDemand ไม่กรอง เพราะเป็นยอดปฏิบัติงานจริงของสโตร์ (การยืนยันส่งต้องครบทุกพาร์ท)
    if (matFilter) rowList = rowList.filter(r => matMatches(r.mat_no, matFilter));

    const totalKanban = rowList.reduce((s, r) => {
      const per = kanbanStd[r.mat_no];
      return s + (per ? Math.ceil(r.netTotal / per) : 0);
    }, 0);

    // ── NET ต่อรอบ: เรียงทุกรอบของกลุ่มตามเวลา แล้วไล่หักสต็อกในกลุ่มแบบ FIFO (รอบแรกใช้สต็อกก่อน) ──
    const allRows = Object.values(rows);
    const roundAlloc = {};
    const roundsByGroup = {};
    rounds.forEach(r => { const g = groupOf(r.line_name); (roundsByGroup[g] = roundsByGroup[g] || []).push(r); });
    Object.entries(roundsByGroup).forEach(([g, list]) => {
      list.sort((a, b) =>
        (timeStrToMs(workDate, a.delivery_time || a.cutoff_time) ?? dayEndMs) -
        (timeStrToMs(workDate, b.delivery_time || b.cutoff_time) ?? dayEndMs));
      const stockLeft = {};
      allRows.forEach(row => {
        stockLeft[row.mat_no] = Object.entries(row.stockPerLine)
          .filter(([ln]) => groupOf(ln) === g)
          .reduce((s, [, v]) => s + v, 0);
      });
      list.forEach(r => {
        const mats = grossByRound[r.id] || {};
        const parts = Object.entries(mats)
          .filter(([, qty]) => qty > 0)
          .map(([mat, qty]) => {
            const row = rows[mat];
            const used = Math.min(stockLeft[mat] || 0, qty);
            stockLeft[mat] = (stockLeft[mat] || 0) - used;
            const net = qty - used;
            const per = kanbanStd[mat];
            return {
              mat_no: mat, part_name: row?.part_name, uom: row?.uom, supplier: row?.supplier,
              qty, stockUsed: used, netTotal: net,
              cards: per && net > 0 ? Math.ceil(net / per) : 0,
            };
          })
          .sort((a, b) => a.mat_no.localeCompare(b.mat_no));
        roundAlloc[r.id] = {
          parts,
          totalKanban: parts.reduce((s, p) => s + p.cards, 0),
          netParts: parts.filter(p => p.netTotal > 0).length,
        };
      });
    });

    // ── demand ระดับกลุ่มไลน์ (รวมไลน์ลูกใต้ parent) — NET จากสต็อกภายในกลุ่มจริง ──
    const groupDemand = {};
    const colGroup = {};
    cols.forEach(c => { colGroup[c.id] = groupOf(c.line); });
    allRows.forEach(row => {
      const qtyByGroup = {};
      Object.entries(row.perCol).forEach(([cid, v]) => {
        const g = colGroup[cid];
        if (g && v > 0) qtyByGroup[g] = (qtyByGroup[g] || 0) + v;
      });
      Object.entries(qtyByGroup).forEach(([g, qty]) => {
        const stockInGroup = Object.entries(row.stockPerLine)
          .filter(([ln]) => groupOf(ln) === g).reduce((s, [, v]) => s + v, 0);
        const net = Math.max(0, qty - stockInGroup);
        const per = kanbanStd[row.mat_no];
        const cards = per && net > 0 ? Math.ceil(net / per) : 0;
        const gd = groupDemand[g] = groupDemand[g] || { parts: [], totalKanban: 0 };
        gd.parts.push({ mat_no: row.mat_no, part_name: row.part_name, uom: row.uom, qty, netTotal: net, cards });
        gd.totalKanban += cards;
      });
    });
    Object.values(groupDemand).forEach(gd => gd.parts.sort((a, b) => a.mat_no.localeCompare(b.mat_no)));

    return { cols, rowList, noBom: [...noBom.values()], sessById, totalKanban, roundAlloc, groupDemand };
  }, [sessions, demands, bomMap, kanbanStd, lineStock, shiftFilter, matFilter, rounds, lineMap, workDate]);

  const fmt = (n) => Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });

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
    <div style={{ padding: 'clamp(12px, 2vw, 24px)', maxWidth: 'min(96vw, 2000px)', margin: '0 auto' }}>
      {/* ⚠️ heijunka:operate seed ตั้งแต่ 2026-07-08 = ทุก role ณ ตอนนั้น — mtn/dept_admin ที่เพิ่มทีหลังไม่มีแถว */}
      <ReadOnlyNote show={!canOperate} role={role} what="สั่งงาน/จัดคิวบนบอร์ด"
        permKey="heijunka:operate" />
      {/* Header */}
      <div style={{ display: 'flex', paddingRight: 52, justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
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
            width: 140, /* input ใน flex row ต้องกำหนด width — index.css ตั้ง input{width:100%} จะดันปุ่มแตกแถว */
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

      {/* Smart Scheduling Planner */}
      <PlannerStrip rounds={rounds} deliveries={deliveries} roundAlloc={view.roundAlloc} workDate={workDate} breakPolicies={breakPolicies} nowMs={nowMs} />

      {/* Store ต้องเห็นด้วยว่า "สั่งผลิตไปไลน์ไหน ทำได้ตามที่มอบหมายไหม" ไม่ใช่เห็นแค่ฝั่งเบิก-ส่ง
          (สรุปยอดเท่านั้น — บอร์ดตัวจริงอยู่ที่ฝ่ายผลิต กดชื่อไลน์แล้วเด้งไป ห้าม render ซ้ำที่นี่) */}
      <ProdProgressStrip workDate={workDate}
        onOpenLine={(ln) => navigate(`/management?line=${encodeURIComponent(ln)}&view=heijunka`)} />

      {/* View mode toggle */}
      {/* flexWrap: จอแคบปุ่มสลับมุมมองตกบรรทัดใหม่ได้ ไม่ล้นจอ (desktop แถวเดียวพอ — เหมือนเดิม) */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {[{ id: 'unified', label: '🗄️ ตู้ Kanban รวม' }, { id: 'board', label: '🏪 Store Board' }, { id: 'timeline', label: '📊 Heijunka Board' }, { id: 'pull', label: '🔄 Pull / ใบสั่งผลิต' }, { id: 'cards', label: '🎴 การ์ด' }, { id: 'table', label: '📋 ตาราง' }].map(v => (
          <button key={v.id} onClick={() => setViewMode(v.id)} style={{
            padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-body)', whiteSpace: 'nowrap',
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
            rounds={rounds} deliveries={deliveries} view={view}
            onConfirm={confirmRound} confirming={confirming} onReceive={openReceive}
            lotRequests={lotRequests} rawRequests={rawRequests} rackRequests={rackRequests} pkgRequests={pkgRequests} wipRequests={wipRequests} purchaseRequests={purchaseRequests}
            busy={pullBusy} onAdvanceLot={advanceLot} onIssueRaw={issueRaw} onAdvanceWip={advanceWip} onAdvancePurchase={advancePurchase}
            fmt={fmt} workDate={workDate} nowMs={nowMs} canOperate={canOperate}
          />
        ) : viewMode === 'board' ? (
          <StoreBoardView
            rounds={rounds} deliveries={deliveries} view={view}
            kanbanStd={kanbanStd} onConfirm={confirmRound} confirming={confirming}
            onReceive={openReceive} fmt={fmt} lineMap={lineMap} workDate={workDate} nowMs={nowMs} canOperate={canOperate}
          />
        ) : viewMode === 'timeline' ? (
          <DeliveryTimelineBoard
            rounds={rounds} deliveries={deliveries} view={view} kanbanStd={kanbanStd} fmt={fmt} lineMap={lineMap}
            workDate={workDate} breakPolicies={breakPolicies} nowMs={nowMs}
          />
        ) : viewMode === 'pull' ? (
          <PullBoard
            lotRequests={lotRequests} rawRequests={rawRequests} accumulator={accumulator}
            lotSizeMap={lotSizeMap} busy={pullBusy} onAdvanceLot={advanceLot} onIssueRaw={issueRaw}
            onReorder={reorderLot} fmt={fmt} canOperate={canOperate}
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
          <div className="table-sticky" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead>
                <tr style={{ background: 'var(--bg2)' }}>
                  <th style={{ padding: '10px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 1 }}>พาร์ทย่อย</th>
                  {view.cols.map(c => (
                    <th key={c.id} style={{ padding: '10px 12px', fontSize: 11, fontWeight: 800, color: 'var(--text2)', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {c.line}<br />
                      <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{SHIFT_LABEL[c.shift] || c.shift}</span>
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
                        {stockCovered && <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 700 }}>✓ stock พอ</div>}
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
                        {stockCovered ? '✓ พอ' : fmt(r.netTotal)} <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{r.uom}</span>
                      </td>
                      <td style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', textAlign: 'right' }}>
                        {stockCovered
                          ? <span style={chip('rgba(34,197,94,0.1)', '#22c55e')}>ไม่ต้องเบิก</span>
                          : per
                            ? <span style={chip('rgba(245,158,11,0.12)', '#f59e0b')}>{Math.ceil(r.netTotal / per)} ใบ × {per}</span>
                            : <span style={{ fontSize: 11, color: 'var(--muted)' }}>ไม่มี std</span>}
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
          onReceive={openReceive} roundAlloc={view.roundAlloc} workDate={workDate} nowMs={nowMs} canOperate={canOperate} tripsFor={tripsFor} />
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
    <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
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
