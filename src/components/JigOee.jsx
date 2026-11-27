/* 🏭 ชิ้นส่วนจอ OEE รายจิ๊ก (ข้อมูลเครื่องจาก Node-RED · สูตร ESM) — ใช้ร่วม /line-oee + /oee-analytics?tab=machine
   📄 docs/modules/integration-hub.md §OEE รายจิ๊ก · สูตร src/utils/machineOee.js · โหลด src/lib/jigOeeData.js

   ของที่ ESM มีเหนือจอ Node-RED (คำสั่ง user 13/11 "ให้ ESM เหนือกว่า"):
     · CT จากพาร์ทในใบผลิตจริงของจิ๊ก (ไม่ใช่ ideal ค่าเดียว) · Q จาก NG ที่คน/QA ตัดสิน (คู่กับ NG หน้าเครื่อง)
     · เป้า/ยอดยืนยันจากใบผลิต เทียบชิ้นที่เครื่องนับ · เหตุผลที่ตัวเลขคิดไม่ได้เขียนบนจอเสมอ (ไม่รู้ ≠ 0)
   🔴 ไฟล์นี้วาดอย่างเดียว ห้ามคิดสูตร · ฟอนต์ขั้นต่ำ 11px · ห้าม color-mix (จอ TV Chromium 94)
   🔴 Pareto ใช้ <ParetoChart> กลาง · แท่งสีจาก Cell ต้อง CELL_BAR_FILL + tooltipProps (ไม่ได้ใช้ Cell ในไฟล์นี้) */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, ReferenceLine,
} from 'recharts';
import { chartAnim, animClass } from '../utils/motion';
import ParetoChart from './ParetoChart';
import { classifyAbc } from '../utils/pareto';
import { axisTick, tooltipProps, CHART_MARGIN, alignedYWidth } from '../utils/chartAxis';
import { WHY_TEXT, pct1, segmentMinutesIn, timeTicks, hourlySummary, hourlyStateMinutes, stopOccurrences, linkStops } from '../utils/machineOee';
import { machineKey } from '../utils/machineNo';
import { loadStopLinks } from '../lib/jigOeeData';
import { tr } from '../utils/i18n';

export const KIND_META = {
  /* พาเลต ≤ 5 สี (UI §6.17) — แยกเฉดด้วย -line แทนสีใหม่ */
  run:          { label: 'เดินเครื่อง',          color: 'var(--green)' },
  minor:        { label: 'หยุดสั้น < 2 นาที',    color: 'var(--amber-line)' },
  fault:        { label: 'Alarm',                color: 'var(--red)' },
  unplanned:    { label: 'หยุดนอกแผน',           color: 'var(--red-line)' },
  idle:         { label: 'รองาน / Idle',         color: 'var(--amber)' },
  planned_stop: { label: 'หยุดตามแผน',           color: 'var(--blue)' },
  no_plan:      { label: 'ไม่มีแผนผลิต',          color: 'var(--border2)' },
  comm_loss:    { label: 'ขาดการสื่อสาร',         color: 'var(--blue-line)' },
  break_over:   { label: 'พักเกินเวลานโยบาย',     color: 'var(--red-line)' },
  other:        { label: 'อื่นๆ (ไม่รู้จัก)',      color: 'var(--muted)' },
};
const kindMeta = (k) => KIND_META[k] || KIND_META.other;

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 14, boxShadow: 'var(--shadow-sm)', minWidth: 0 };
const hm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false });
const hms = (ms) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour12: false });
const fmtPct = (v) => (v == null ? '–' : `${pct1(v).toFixed(1)}%`);
const fmtMin = (sec) => (sec == null ? '–' : `${Math.round(sec / 60).toLocaleString()} ${tr("น.")}`);
const fmtHM = (sec) => {
  if (sec == null) return '–';
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} ${tr("ชม.")} ${m % 60} ${tr("น.")}` : `${m} ${tr("น.")}`;
};
const toneOfPct = (v, target) => (v == null ? 'var(--muted)' : v >= target ? 'var(--green)' : v >= target * 0.85 ? 'var(--amber)' : 'var(--red)');

/** แถบเปอร์เซ็นต์แนวนอน */
function Bar1({ label, v, target = 0.85 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '16px 1fr 52px', gap: 6, alignItems: 'center', fontSize: 12 }}>
      <span style={{ color: 'var(--muted)', fontWeight: 700 }}>{label}</span>
      <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
        <div className={animClass('grow')} style={{ width: `${v == null ? 0 : Math.min(100, v * 100)}%`, height: '100%', background: toneOfPct(v, target) }} />
      </div>
      <span style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text)' }}>{fmtPct(v)}</span>
    </div>
  );
}

/** แถบสถานะตลอดกะ — กว้างตามสัดส่วนเวลา · ส่วนอนาคตเป็นพื้นว่าง */
export function JigStateStrip({ segments = [], startMs, endMs, height = 12, showTicks = false }) {
  const total = endMs - startMs;
  if (!(total > 0)) return null;
  const ticks = [];
  if (showTicks) for (let t = startMs; t <= endMs; t += 2 * 3600000) ticks.push(t);
  return (
    <div>
      <div className={animClass('sweep')} style={{ position: 'relative', height, background: 'var(--bg3)', borderRadius: 4, overflow: 'hidden' }}
        role="img" aria-label={tr("แถบสถานะเครื่องตลอดกะ")}>
        {segments.map((s, i) => (
          <div key={i} title={`${kindMeta(s.kind).label} ${hm(s.startMs)}–${hm(s.endMs)} (${Math.max(1, Math.round((s.endMs - s.startMs) / 60000))} ${tr("น.")})${s.reason ? ` · ${s.reason}` : ''}`}
            style={{ position: 'absolute', top: 0, bottom: 0, left: `${((s.startMs - startMs) / total) * 100}%`,
              width: `${Math.max(0.15, ((s.endMs - s.startMs) / total) * 100)}%`, background: kindMeta(s.kind).color }} />
        ))}
      </div>
      {showTicks && (
        <div style={{ position: 'relative', height: 16, marginTop: 2 }}>
          {ticks.map(t => (
            <span key={t} style={{ position: 'absolute', left: `${((t - startMs) / total) * 100}%`, transform: 'translateX(-50%)', fontSize: 11, color: 'var(--muted)' }}>{hm(t)}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** 🔍 แถบสถานะตลอดกะ แบบซูมได้ (16/11 · user "ระบบซูม ดูช่วงกราฟแท่ง เรายังไม่มี")
 *  ลาก = เลือกช่วงซูม · คลิก = ซูม ±15 นาทีรอบจุดนั้น · ปุ่ม "ย่อกลับ" · เส้นตอนนี้ · นาทีรายสถานะในช่วงที่ดู
 *  pointer events = ใช้ได้ทั้งเมาส์และนิ้ว · ส่วนอนาคตเป็นพื้นว่าง */
export function ZoomStateStrip({ segments = [], startMs, endMs, nowMs = Date.now(), height = 30 }) {
  const [view, setView] = useState(null);           // null = ทั้งกะ · [a,b]
  const [drag, setDrag] = useState(null);           // { x0, x1 } พิกเซลในแถบ
  const ref = useRef(null);
  const a = view ? view[0] : startMs, b = view ? view[1] : endMs;
  const span = b - a;
  const mins = useMemo(() => segmentMinutesIn(segments, a, Math.min(b, nowMs)), [segments, a, b, nowMs]);
  if (!(endMs > startMs)) return null;
  const toMs = (x) => { const w = ref.current?.clientWidth || 1; return a + Math.max(0, Math.min(1, x / w)) * span; };
  const xOf = (e) => e.clientX - (ref.current?.getBoundingClientRect().left || 0);
  const onDown = (e) => { e.currentTarget.setPointerCapture?.(e.pointerId); const x = xOf(e); setDrag({ x0: x, x1: x }); };
  const onMove = (e) => { if (drag) setDrag(d => ({ ...d, x1: xOf(e) })); };
  const onUp = () => {
    if (!drag) return;
    const lo = Math.min(drag.x0, drag.x1), hi = Math.max(drag.x0, drag.x1);
    setDrag(null);
    if (hi - lo >= 6) { const s0 = toMs(lo), e0 = toMs(hi); if (e0 - s0 >= 60000) setView([s0, e0]); return; }
    const c = toMs(lo), half = Math.min(15 * 60000, span / 4);
    if (span <= 2 * 60000) return;                    // ซูมสุดแล้ว
    setView([Math.max(startMs, c - half), Math.min(endMs, c + half)]);
  };
  const pctOf = (t) => ((t - a) / span) * 100;
  const kinds = ['run', 'minor', 'fault', 'unplanned', 'idle', 'planned_stop', 'no_plan', 'comm_loss'];
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
        <span>{view ? `${tr("ซูม")} ${hm(a)}–${hm(b)}` : tr("ทั้งช่วง")} · {tr("ลากเพื่อเลือกช่วง หรือคลิกเพื่อซูม")}</span>
        {view && <button type="button" className="pg-btn" style={{ marginLeft: 'auto' }} onClick={() => setView(null)}>⤢ {tr("ย่อกลับทั้งช่วง")}</button>}
      </div>
      <div ref={ref} className={animClass('sweep')} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}
        style={{ position: 'relative', height, background: 'var(--bg3)', borderRadius: 4, overflow: 'hidden', cursor: 'zoom-in', touchAction: 'none', userSelect: 'none' }}
        role="img" aria-label={`${tr("แถบสถานะเครื่อง")} ${hm(a)}–${hm(b)}`}>
        {segments.filter(sg => sg.endMs > a && sg.startMs < b).map((sg, i) => {
          const l = Math.max(0, pctOf(sg.startMs)), r = Math.min(100, pctOf(sg.endMs));
          return (
            <div key={i} title={`${kindMeta(sg.kind).label} ${hms(sg.startMs)}–${hms(sg.endMs)} (${((sg.endMs - sg.startMs) / 60000).toFixed(1)} ${tr("น.")})${sg.reason ? ` · ${sg.reason}` : ''}`}
              style={{ position: 'absolute', top: 0, bottom: 0, left: `${l}%`, width: `${Math.max(0.12, r - l)}%`, background: kindMeta(sg.kind).color }} />
          );
        })}
        {nowMs > a && nowMs < b && (
          <div aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, left: `${pctOf(nowMs)}%`, width: 2, background: 'var(--text)' }} />
        )}
        {drag && Math.abs(drag.x1 - drag.x0) >= 2 && (
          <div aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, left: Math.min(drag.x0, drag.x1), width: Math.abs(drag.x1 - drag.x0), background: 'var(--blue-dim)', border: '1px solid var(--blue)' }} />
        )}
      </div>
      <div style={{ position: 'relative', height: 16 }}>
        {timeTicks(a, b).map(t => (
          <span key={t} style={{ position: 'absolute', left: `${pctOf(t)}%`, transform: 'translateX(-50%)', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{hm(t)}</span>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11.5, color: 'var(--muted)' }}>
        {kinds.filter(k => mins[k] > 0).map(k => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: kindMeta(k).color }} />{kindMeta(k).label} <b style={{ color: 'var(--text)' }}>{mins[k] >= 10 ? Math.round(mins[k]) : mins[k].toFixed(1)} {tr("น.")}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

export function KindLegend({ kinds = ['run', 'minor', 'fault', 'unplanned', 'idle', 'planned_stop', 'no_plan'] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11.5, color: 'var(--muted)' }}>
      {kinds.map(k => (
        <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: kindMeta(k).color }} />{kindMeta(k).label}
        </span>
      ))}
    </div>
  );
}

/** สถานะล่าสุดที่รู้ (จากช่วงหยุดที่จบแล้ว + ชิ้นล่าสุด) — ยังไม่ใช่สถานะสด ต้องเขียนบอก */
function lastKnown(j) {
  if (j.live && !j.live.stale) return { live: true, text: j.live.text, sinceMs: j.live.sinceMs };
  const seg = j.segments?.length ? j.segments[j.segments.length - 1] : null;
  if (!seg) return null;
  return { kind: seg.kind, sinceMs: seg.startMs, approx: true, liveStale: !!j.live?.stale };
}

/** การ์ดจิ๊ก 1 ใบ (จอหน้าไลน์ / ภาพรวม) */
export function JigOeeCard({ j, target = 0.85, onOpen, nowMs = Date.now() }) {
  const o = j.oee;
  const st = lastKnown(j);
  const why = (o.why || []).filter(w => WHY_TEXT[w]);
  return (
    <div style={{ ...card, display: 'grid', gap: 8, alignContent: 'start', cursor: onOpen ? 'pointer' : 'default' }}
      onClick={onOpen} role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined}
      onKeyDown={onOpen ? (e) => { if (e.key === 'Enter') onOpen(); } : undefined}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: 'ui-monospace, monospace' }}>{j.machineNo}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            {j.ctInfo?.mats?.length ? `MAT ${j.ctInfo.mats.join(', ')}` : tr("ไม่มีใบผลิตบนจิ๊กนี้")}{j.ctInfo?.ct ? ` · CT ${Math.round(j.ctInfo.ct * 10) / 10} s` : ''}
          </div>
        </div>
        {st && (st.live ? (
          /* สถานะสด = ข้อความตามต้นทาง (ESM ยังไม่จับคู่รหัสสถานะ ⇒ ไม่เดาสี) */
          <span title={tr("สถานะสดจากเครื่อง (ข้อความตามต้นทาง)")}
            style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', border: '1px solid var(--border2)', borderRadius: 999, padding: '1px 8px', maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ● {st.text}{st.sinceMs ? ` ${fmtHM((nowMs - st.sinceMs) / 1000)}` : ''}
          </span>
        ) : (
          <span title={tr("สถานะล่าสุดที่รู้ (จากช่วงหยุดที่จบแล้ว — ยังไม่ใช่สถานะสด)")}
            style={{ fontSize: 11.5, fontWeight: 700, color: kindMeta(st.kind).color, border: `1px solid ${kindMeta(st.kind).color}`, borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}>
            ● {kindMeta(st.kind).label}* {fmtHM((nowMs - st.sinceMs) / 1000)}
          </span>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 12, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 30, fontWeight: 800, color: toneOfPct(o.oee, target), lineHeight: 1 }}>{fmtPct(o.oee)}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>OEE {tr("กะนี้ (จากเครื่อง")})</div>
        </div>
        <div style={{ display: 'grid', gap: 3 }}>
          <Bar1 label="A" v={o.A} target={target} /><Bar1 label="P" v={o.P} target={target} /><Bar1 label="Q" v={o.Q} target={0.99} />
        </div>
      </div>
      <JigStateStrip segments={j.segments} startMs={j.win.startMs} endMs={j.win.endMs} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, fontSize: 11.5, color: 'var(--muted)', textAlign: 'center' }}>
        <div><b style={{ fontSize: 15, color: 'var(--text)' }}>{o.pieces == null ? '–' : o.pieces.toLocaleString()}</b><div>{tr("ชิ้น (เครื่อง")})</div></div>
        <div><b style={{ fontSize: 15, color: 'var(--text)' }}>{j.orders?.length ? j.confirmedQty.toLocaleString() : '–'}</b><div>{tr("ยืนยันแล้ว (คน")})</div></div>
        <div><b style={{ fontSize: 15, color: 'var(--text)' }}>{fmtMin(o.downSec)}</b><div>{tr("หยุด ≥ 2 นาที")}</div></div>
        <div><b style={{ fontSize: 15, color: 'var(--text)' }}>{o.avgCycleSec == null ? '–' : `${o.avgCycleSec.toFixed(1)} s`}</b><div>cycle {tr("เฉลี่ย")}</div></div>
      </div>
      {why.length > 0 && <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>{why.map(w => WHY_TEXT[w]).join(' · ')}</div>}
      {o.pOver && <div style={{ fontSize: 11.5, color: 'var(--red)' }}>%P {tr("เกิน 100% (ตัดไว้) — CT ในระบบอาจยาวกว่าจริง ตรวจ CT ของพาร์ท")}</div>}
      {st?.approx && <div style={{ fontSize: 11, color: st.liveStale ? 'var(--amber)' : 'var(--muted)' }}>
        * {st.liveStale ? tr("สถานะสดขาดการส่งเกิน 3 นาที — แสดงสถานะล่าสุดที่รู้จากช่วงหยุดที่จบแล้วแทน") : tr("สถานะล่าสุดที่รู้จากช่วงหยุดที่จบแล้ว (ยังไม่ได้ส่งสถานะสด — เพิ่มชนิด \"สถานะสดของเครื่อง\" ใน flow)")}
      </div>}
    </div>
  );
}

/** สรุปรวมหลายจิ๊ก (หัวการ์ด) */
export function JigKpiRow({ items = [] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
      {items.map(it => (
        <div key={it.label} style={{ ...card, padding: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{it.label}</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: it.color || 'var(--text)', lineHeight: 1.2 }}>{it.value}</div>
          {it.sub && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/** น้ำตกเวลา (Loss) — แท่งนอนตามสัดส่วนเวลาแผน */
export function LossWaterfall({ o }) {
  const w = o.waterfall;
  const base = w.plannedSec || 0;
  const rows = [
    { label: 'เวลาแผนผลิต', sec: w.plannedSec, main: true },
    { label: '− Alarm ≥ 2 นาที', sec: w.fault, loss: true },
    { label: '− หยุดนอกแผน', sec: w.unplanned, loss: true },
    { label: '− รองาน / Idle ≥ 2 นาที', sec: w.idle, loss: true },
    { label: '− พักเกินเวลานโยบาย', sec: w.breakOver ?? 0, loss: true },
    { label: 'เวลาเดินเครื่อง (Operating)', sec: w.operatingSec, main: true },
    { label: '− หยุดสั้น < 2 นาที', sec: w.minorSec, loss: true },
    { label: '− ช้ากว่า CT', sec: w.speedSec, loss: true },
    { label: 'เวลาเดินสุทธิ (Net)', sec: w.netSec, main: true },
    { label: '− ของเสีย NG (คนตัดสิน)', sec: w.ngSec, loss: true },
    { label: 'เวลาผลิตงานดี (Fully productive)', sec: w.fullySec, main: true },
  ];
  return (
    <div style={{ display: 'grid', gap: 5 }}>
      {rows.map(r => (
        <div key={r.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 210px) 1fr 108px', gap: 8, alignItems: 'center', fontSize: 12 }}>
          <span style={{ color: r.main ? 'var(--text)' : 'var(--muted)', fontWeight: r.main ? 700 : 400 }}>{r.label}</span>
          <div style={{ height: r.main ? 14 : 8, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
            {r.sec != null && base > 0 && <div className={animClass('grow')} style={{ width: `${Math.min(100, (r.sec / base) * 100)}%`, height: '100%', background: r.loss ? 'var(--red)' : 'var(--blue)', opacity: r.loss ? 0.75 : 1 }} />}
          </div>
          <span style={{ textAlign: 'right', color: 'var(--text)' }}>
            {r.sec == null ? tr("– (ไม่รู้ CT)") : `${fmtHM(r.sec)} · ${base > 0 ? Math.round((r.sec / base) * 100) : 0}%`}
          </span>
        </div>
      ))}
      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>OEE = {tr("เวลาผลิตงานดี ÷ เวลาแผนผลิต · หยุดตามแผน/ไม่มีแผน/พัก ไม่นับในเวลาแผน")}</div>
      {o.loss && (
        /* 🍱 พักแบบโควตานาที (ยึด duration — นาฬิกา PLC คลาด) · เขียนที่มาเสมอ */
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          {tr("พักตามนโยบาย")} {fmtHM(o.loss.policyBreak)} · {tr("กดพักหน้าเครื่อง")} {fmtHM(o.loss.breakPress)}
          {o.loss.breakOver > 0 && <span style={{ color: 'var(--red)' }}> · {tr("พักเกิน")} {fmtHM(o.loss.breakOver)} ({tr("นับเป็นเสีย")})</span>}
          {o.loss.idleAbsorbedSec > 0 && <span> · {tr("ไม่ได้กดพัก ⇒ หักโควตาพักที่เหลือจาก")} Idle {fmtHM(o.loss.idleAbsorbedSec)}</span>}
        </div>
      )}
    </div>
  );
}

const STATE_KINDS = ['run', 'minor', 'fault', 'unplanned', 'idle', 'planned_stop', 'no_plan', 'comm_loss', 'other'];

/** ยอดรายชั่วโมง เทียบเป้า + (ก) นาทีรายสถานะของชั่วโมงเดียวกัน — 2 กราฟซ้อนแกน X เดียว (UI §6.19 · ล็อกความกว้างแกน Y เท่ากัน)
 *  + (ข) การ์ดสรุปของช่วงที่ดู · สูตรอยู่ machineOee.js (hourlySummary / hourlyStateMinutes) */
export function HourlyChart({ buckets = [], segments = null }) {
  const sum = useMemo(() => hourlySummary(buckets), [buckets]);
  const stateMin = useMemo(() => (segments ? hourlyStateMinutes(segments, buckets) : null), [segments, buckets]);
  const data = buckets.map((b, i) => ({
    h: hm(b.hourMs), good: b.qty == null ? null : Math.max(0, b.qty - (b.ng || 0)), ng: b.ng, target: b.target,
    oee: b.oee == null ? null : Math.round(b.oee * 100),
    ...(stateMin ? Object.fromEntries(Object.entries(stateMin[i]).map(([k, v]) => [`m_${k}`, Math.round(v * 10) / 10])) : {}),
  }));
  const kinds = stateMin ? STATE_KINDS.filter(k => stateMin.some(m => m[k] > 0)) : [];
  const yW = alignedYWidth([...data.map(d => Math.max(d.target || 0, (d.good || 0) + (d.ng || 0))), 60].map(v => String(Math.ceil(v))));
  const tile = (label, value, sub, color = 'var(--text)') => (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '8px 10px', minWidth: 0 }}>
      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
  const fmtN = (v) => (v == null ? '–' : Math.round(v).toLocaleString());
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        {tile('ชิ้นดี (เครื่อง)', fmtN(sum.good), `NG ${tr("หน้าเครื่อง")} ${sum.ng}`)}
        {tile('เป้า (เวลาแผน ÷ CT)', fmtN(sum.target), sum.target == null ? 'ยังไม่รู้ CT บางชั่วโมง' : 'ชิ้น · เฉพาะชั่วโมงที่ผ่านไปแล้ว')}
        {tile('ทำได้', sum.achieve == null ? '–' : `${Math.round(sum.achieve * 100)}%`, 'ของเป้า', toneOfPct(sum.achieve, 0.85))}
        {tile('เฉลี่ย', sum.perHour == null ? '–' : sum.perHour.toFixed(1), 'ชิ้น / ชั่วโมงแผน')}
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{tr("ชิ้น / ชั่วโมง")}</div>
      <div style={{ width: '100%', height: 200 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={CHART_MARGIN} syncId={stateMin ? 'jig-hourly' : undefined}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="h" tick={stateMin ? false : axisTick()} height={stateMin ? 4 : undefined} />
            <YAxis width={yW} tick={axisTick()} allowDecimals={false} />
            <Tooltip {...tooltipProps()} />
            <Bar dataKey="good" name="ชิ้นดี (เครื่อง)" stackId="q" fill="var(--green)" {...chartAnim()} />
            <Bar dataKey="ng" name="NG (หน้าเครื่อง)" stackId="q" fill="var(--red)" {...chartAnim()} />
            <Line dataKey="target" name="เป้า (เวลาแผน ÷ CT)" stroke="var(--text)" strokeDasharray="4 3" dot={false} type="stepAfter" {...chartAnim()} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {stateMin && (<>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{tr("นาทีในแต่ละสถานะ (เวลาเดียวกับกราฟบน")})</div>
        <div style={{ width: '100%', height: 170 }}>
          <ResponsiveContainer>
            <ComposedChart data={data} margin={CHART_MARGIN} syncId="jig-hourly">
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="h" tick={axisTick()} />
              <YAxis width={yW} tick={axisTick()} allowDecimals={false} domain={[0, 60]} ticks={[0, 30, 60]} />
              <Tooltip {...tooltipProps()} formatter={(v) => [`${v} ${tr("นาที")}`]} />
              {kinds.map(k => <Bar key={k} dataKey={`m_${k}`} name={kindMeta(k).label} stackId="s" fill={kindMeta(k).color} {...chartAnim()} />)}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </>)}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.length || 1}, 1fr)`, fontSize: 11, color: 'var(--muted)', textAlign: 'center', paddingLeft: yW + CHART_MARGIN.left, paddingRight: CHART_MARGIN.right }}>
        {data.map(d => <span key={d.h} style={{ overflow: 'hidden' }}>{d.oee == null ? '–' : `${d.oee}%`}</span>)}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
        {tr("แถวล่าง = OEE ของชั่วโมง (ชิ้นดี × CT ÷ เวลาแผนของชั่วโมง) · เป้าว่าง = ยังไม่รู้")} CT{stateMin ? tr(" · ชี้ชั่วโมงเดียวกันได้ทั้ง 2 กราฟ") : ''}
      </div>
    </div>
  );
}

/** 📅 (ค) ยอดรายวัน เทียบชิ้นที่ควรทำได้ — แท่งซ้อน ดี/NG/ยังขาด (เทา) · tooltip = เวลารายสถานะของวันนั้น · คลิก = เปิดทั้งวัน
 *  แถวจาก dailyCapacityRows() (สูตรอยู่ machineOee.js) · แท่งต่อเนื่อง ไม่ปัดเป็นช่องละ N ชิ้น (วันยอดน้อยต้องไม่หาย) */
export function DailyCapacityChart({ rows = [], onPick }) {
  const fmtM = (m) => fmtHM(m * 60);
  const Tip = ({ active, payload }) => {
    const d = active && payload?.[0]?.payload;
    if (!d) return null;
    const line = (color, v, label) => (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: color, flex: 'none' }} />
        <b style={{ minWidth: 64 }}>{v}</b><span style={{ color: 'var(--muted)' }}>{label}</span>
      </div>
    );
    return (
      <div style={{ background: 'var(--card-surf)', border: '1px solid var(--border2)', borderRadius: 6, padding: '8px 10px', fontSize: 12, color: 'var(--text)', boxShadow: 'var(--shadow-float)', display: 'grid', gap: 2 }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>{d.d}{onPick ? tr(" · คลิกเพื่อดูทั้งวัน") : ''}</div>
        {line('var(--green)', d.good.toLocaleString(), `${tr("ชิ้นดี")}${d.cap != null ? ` · ${tr("ควรได้")} ${d.cap.toLocaleString()}${d.achieve != null ? ` (${Math.round(d.achieve * 100)}%)` : ''}` : tr(' · ไม่รู้ CT บางกะ')}`)}
        {d.ng > 0 && line('var(--red)', d.ng.toLocaleString(), 'NG หน้าเครื่อง')}
        {line('var(--border2)', fmtM(d.planned), 'เวลาแผนผลิต')}
        {line(KIND_META.run.color, fmtM(d.run), tr(KIND_META.run.label))}
        {d.minor > 0 && line(KIND_META.minor.color, fmtM(d.minor), tr(KIND_META.minor.label))}
        {d.fault > 0 && line(KIND_META.fault.color, fmtM(d.fault), tr(KIND_META.fault.label))}
        {d.unplanned > 0 && line(KIND_META.unplanned.color, fmtM(d.unplanned), tr(KIND_META.unplanned.label))}
        {d.idle > 0 && line(KIND_META.idle.color, fmtM(d.idle), tr(KIND_META.idle.label))}
        {d.breakOver > 0 && line(KIND_META.break_over.color, fmtM(d.breakOver), tr(KIND_META.break_over.label))}
        {line(KIND_META.planned_stop.color, fmtM(d.excluded), 'หยุดตามแผน / พัก / ไม่มีแผน (ไม่นับในเวลาแผน)')}
      </div>
    );
  };
  if (!rows.length) return <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{tr("ไม่มีข้อมูลจากเครื่องในช่วงนี้")}</div>;
  const click = onPick ? (_, i) => rows[i] && onPick(rows[i].d) : undefined;
  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={CHART_MARGIN} style={{ cursor: onPick ? 'pointer' : 'default' }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={axisTick()} />
          <YAxis width="auto" tick={axisTick()} allowDecimals={false} />
          <Tooltip content={<Tip />} cursor={tooltipProps().cursor} />
          <Bar dataKey="good" name="ชิ้นดี (เครื่อง)" stackId="q" fill="var(--green)" {...chartAnim()} onClick={click} maxBarSize={56} />
          <Bar dataKey="ng" name="NG (หน้าเครื่อง)" stackId="q" fill="var(--red)" {...chartAnim()} onClick={click} maxBarSize={56} />
          <Bar dataKey="ghost" name="ยังขาดจากที่ควรได้" stackId="q" fill="var(--border2)" fillOpacity={0.55} {...chartAnim()} onClick={click} maxBarSize={56} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** แนวโน้มรายกะ (A/P/Q/OEE) — แกนเดียว 0–100 */
export function ShiftTrendChart({ rows = [], target = 0.85 }) {
  const data = [...rows].reverse().map(r => ({
    k: `${r.workDate.slice(8, 10)}/${r.workDate.slice(5, 7)} ${r.shift === 'day' ? tr('เช้า') : tr('ดึก')}`,
    OEE: pct1(r.oee.oee), A: pct1(r.oee.A), P: pct1(r.oee.P), Q: pct1(r.oee.Q),
  }));
  return (
    <div style={{ width: '100%', height: 230 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="k" tick={axisTick()} interval="preserveStartEnd" />
          <YAxis width="auto" tick={axisTick()} domain={[0, 100]} />
          <Tooltip {...tooltipProps()} />
          <ReferenceLine y={target * 100} stroke="var(--green)" strokeDasharray="4 3" label={{ value: `เป้า ${Math.round(target * 100)}%`, fill: 'var(--green)', fontSize: 11, position: 'insideTopLeft' }} />
          <Line dataKey="OEE" stroke="var(--green)" strokeWidth={2.5} dot={{ r: 2 }} connectNulls={false} {...chartAnim()} />
          <Line dataKey="A" stroke="var(--blue)" dot={false} connectNulls={false} {...chartAnim()} />
          <Line dataKey="P" stroke="var(--amber)" dot={false} connectNulls={false} {...chartAnim()} />
          <Line dataKey="Q" stroke="var(--muted)" dot={false} connectNulls={false} {...chartAnim()} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Pareto เวลาที่เสีย — ผ่าน <ParetoChart> กลาง · ส่ง onPick ⇒ กดแท่งเพื่อเจาะลึก (StopDrillPanel) */
export function StopParetoChart({ pareto = [], onPick }) {
  const rows = useMemo(() => classifyAbc(pareto.map(p => ({
    ...p, name: p.state === 'minor' ? 'หยุดสั้น < 2 นาที' : `${kindMeta(p.state).label}${p.text ? ` · ${p.code ?? ''} ${p.text}` : p.code ? ` · ${p.code}` : ''}`,
  })), p => p.min), [pareto]);
  if (!rows.length) return <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{tr("ไม่มีเวลาที่เสียจากการหยุดในช่วงนี้")}</div>;
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <ParetoChart rows={rows} unit={tr("นาที")} height={280} onPick={onPick} />
      {onPick && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{tr("กดแท่งเพื่อดูรายครั้ง · พาร์ทที่ผลิตอยู่ · downtime ที่คนลง · ใบแจ้งซ่อม")}</div>}
    </div>
  );
}

const fmtDT = (ms) => new Date(ms).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

/** 🔎 เจาะลึก 1 แท่ง Pareto — รายครั้ง + ผูก ESM (สูตร linkStops ใน machineOee.js · โหลด loadStopLinks ตอนกดเท่านั้น)
 *  events = ช่วงหยุดดิบที่ใช้วาด Pareto ชุดเดียวกัน · orders = ใบผลิตบนจิ๊ก (มี session_id) · tagNo = Map tag → เลขเครื่อง */
export function StopDrillPanel({ row, events = [], orders = [], tagNo, fromMs, toMs, onClose }) {
  const [links, setLinks] = useState(null);
  const occ = useMemo(() => (row?.key ? stopOccurrences(events, row.key, { tagNo }) : []), [row, events, tagNo]);
  const orderKey = orders.map(o => o.id).join(',');
  useEffect(() => {
    let alive = true;
    setLinks(null);
    if (!occ.length) return undefined;
    loadStopLinks({ orders, fromMs, toMs }).then(r => { if (alive) setLinks(r); });
    return () => { alive = false; };
  }, [row?.key, orderKey, fromMs, toMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const linked = useMemo(() => (links ? linkStops(occ, { orders, downtimes: links.downtimes, repairs: links.repairs, keyOf: machineKey }) : null), [links, occ, orders]);
  if (!row) return null;
  const title = row.state === 'minor' ? tr("หยุดสั้น < 2 นาที") : row.state === 'break_over' ? tr(KIND_META.break_over.label) : `${kindMeta(row.state).label}${row.code != null ? ` · ${row.code}` : ''}${row.text ? ` ${row.text}` : ''}`;
  const th = { textAlign: 'left', padding: '5px 8px', fontSize: 12, color: 'var(--muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
  const td = { padding: '5px 8px', fontSize: 12.5, borderBottom: '1px solid var(--border)', verticalAlign: 'top' };
  const list = linked || occ;
  const nDt = linked ? linked.filter(o => o.downtimes.length).length : null;
  const nMo = linked ? linked.filter(o => o.repairs.length).length : null;
  return (
    <div style={{ ...card, display: 'grid', gap: 8, borderColor: 'var(--accent)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>🔎 {title}</div>
        <button type="button" className="pg-btn" style={{ marginLeft: 'auto' }} onClick={onClose}>{tr('✕ ปิด')}</button>
      </div>
      {row.state === 'break_over' ? (
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{tr("พักเกินเวลานโยบาย = ยอดรวมทั้งกะ (กดพักรวมเกินโควตา) ไม่ได้เป็นรายครั้ง — ดูช่วงที่กดพักในแถบสถานะ")}</div>
      ) : !occ.length ? (
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          {row.key === 'minor' ? tr("หยุดสั้นในรายงานหลายวันนับจากยอดสรุป ไม่มีรายครั้ง — ดูรายครั้งได้ในมุมมอง \"ภาพรวมกะ\"") : tr("ไม่พบรายครั้งของสาเหตุนี้ในข้อมูลที่โหลดไว้")}
        </div>
      ) : (<>
        <div style={{ fontSize: 12.5, color: 'var(--text)' }}>
          {occ.length} {tr("ครั้ง · รวม")} {fmtHM(occ.reduce((t, o) => t + o.min * 60, 0))}
          {linked && <> · {tr("คนลง downtime แล้ว")} <b>{nDt}/{occ.length}</b> {tr("ครั้ง · มีใบแจ้งซ่อม")} <b>{nMo}</b> {tr("ครั้ง")}</>}
          {!links && <span style={{ color: 'var(--muted)' }}> · {tr("กำลังโหลดข้อมูลจาก")} ESM…</span>}
        </div>
        {links?.errors?.length > 0 && <div style={{ fontSize: 12, color: 'var(--red)' }}>{tr("อ่านไม่สำเร็จ")}: {links.errors.join(' · ')} — {tr("ช่อง \"ยังไม่ลง/ไม่มี\" อาจไม่จริง")}</div>}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{[tr("เริ่ม"), tr("นาที"), tr("เครื่อง"), tr("กะ"), tr("พาร์ทที่ผลิตอยู่"), tr("downtime ที่คนลง"), tr("ใบแจ้งซ่อม")].map(h => <th key={h} style={th}>{tr(h)}</th>)}</tr></thead>
            <tbody>{list.slice(0, 200).map(o => (
              <tr key={`${o.tag}|${o.startMs}`}>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDT(o.startMs)}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{o.min.toFixed(1)}</td>
                <td style={{ ...td, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>{o.machineNo || o.tag || '–'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{o.shift ? `${o.shift.workDate.slice(8, 10)}/${o.shift.workDate.slice(5, 7)} ${o.shift.shift === 'day' ? tr('เช้า') : tr('ดึก')}` : '–'}</td>
                <td style={td}>{!linked ? '…' : o.mats.length ? <>{o.mats.join(', ')}{o.matBy === 'shift' && <span style={{ color: 'var(--muted)' }}> ({tr("ใบในกะ — ไม่มีใบเปิดตอนนั้น")})</span>}</> : <span style={{ color: 'var(--amber)' }}>{tr("ไม่มีใบผลิตบนจิ๊ก")}</span>}</td>
                <td style={td}>{!linked ? '…' : o.downtimes.length ? o.downtimes.map(d => (
                  <div key={d.id}>{links.typeName.get(d.downtime_type_id) || tr("ไม่ระบุประเภท")} · {Math.round(Number(d.duration_min) || 0)} {tr("น.")}{d.description ? ` · ${d.description}` : ''}{d.reported_by_name ? <span style={{ color: 'var(--muted)' }}> ({d.reported_by_name})</span> : null}</div>
                )) : <span style={{ color: 'var(--amber)' }}>{tr("ยังไม่ลง")}</span>}</td>
                <td style={td}>{!linked ? '…' : o.repairs.length ? o.repairs.map(r => (
                  <div key={r.id}><b>{r.mo_no || 'MO'}</b> · {r.status}{r.root_cause ? ` · ${tr("สาเหตุ")}: ${r.root_cause}` : r.problem_detail ? ` · ${r.problem_detail}` : ''}{r.moBy === 'time' && <span style={{ color: 'var(--muted)' }}> ({tr("เวลาตรงกัน")})</span>}</div>
                )) : <span style={{ color: 'var(--muted)' }}>{tr("ไม่มี")}</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {list.length > 200 && <div style={{ fontSize: 12, color: 'var(--amber)' }}>{tr("แสดง 200 ครั้งล่าสุดจาก")} {list.length} {tr("ครั้ง")}</div>}
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          {tr("ผูกด้วยเครื่องเดียวกัน + เวลาทับกัน (เผื่อ ±10 นาที เพราะนาฬิกา PLC คลาด) · ใบแจ้งซ่อม \"(เวลาตรงกัน)\" = ไม่ได้เปิดจาก downtime ใบนั้นโดยตรง ให้ตรวจก่อนสรุป")}
        </div>
      </>)}
    </div>
  );
}

export function StopTable({ stops = [], limit = 40 }) {
  const [all, setAll] = useState(false);
  const shown = all ? stops : stops.slice(0, limit);
  if (!stops.length) return <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{tr("ไม่มีการหยุด ≥ 2 นาทีในช่วงนี้")}</div>;
  const th = { textAlign: 'left', padding: '5px 8px', fontSize: 12, color: 'var(--muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
  const td = { padding: '5px 8px', fontSize: 12.5, borderBottom: '1px solid var(--border)' };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>{tr('เริ่ม')}</th><th style={th}>{tr('จบ')}</th><th style={{ ...th, textAlign: 'right' }}>{tr('นาที')}</th><th style={th}>{tr('สถานะ')}</th><th style={th}>{tr('สาเหตุ (จากหน้าเครื่อง)')}</th></tr></thead>
        <tbody>
          {shown.map(s => (
            <tr key={`${s.startMs}|${s.state}`}>
              <td style={td}>{hms(s.startMs)}</td><td style={td}>{hms(s.endMs)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{s.min.toFixed(1)}</td>
              <td style={td}><span style={{ color: kindMeta(s.state).color, fontWeight: 700 }}>● {kindMeta(s.state).label}</span></td>
              <td style={td}>{s.text ? `${s.code ?? ''} ${s.text}` : s.code ? `${tr("รหัส")} ${s.code}` : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {stops.length > limit && (
        <button type="button" className="pg-btn" style={{ marginTop: 6 }} onClick={() => setAll(v => !v)}>
          {all ? tr("ย่อ") : `${tr("แสดงทั้งหมด")} ${stops.length} ${tr("รายการ (ซ่อนอยู่")} ${stops.length - limit})`}
        </button>
      )}
    </div>
  );
}

/** ดูลึก 1 จิ๊ก 1 กะ — ทุกแผงในจอเครื่องจักรของ Node-RED + ส่วนที่ ESM มีเพิ่ม (ใบผลิต · NG ที่คนตัดสิน · CT ต่อพาร์ท) */
export function JigDrilldown({ j, trendRows = null, target = 0.85 }) {
  const o = j.oee;
  const why = (o.why || []).filter(w => WHY_TEXT[w]);
  const ordersDone = j.orders.filter(x => x.status === 'confirmed');
  const span = j.win.endMs - j.win.startMs > 13 * 3600000 ? 'ทั้งวัน' : 'กะนี้';
  const [pick, setPick] = useState(null);
  const drillTagNo = useMemo(() => new Map([[j.tag, j.machineNo]]), [j.tag, j.machineNo]);
  const sec = (title, sub, body) => (
    <div style={{ ...card }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{sub}</div>}
      {body}
    </div>
  );
  return (
    <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
      <JigKpiRow items={[
        { label: `OEE ${span} (${tr("จากเครื่อง")})`, value: fmtPct(o.oee), color: toneOfPct(o.oee, target), sub: `${tr("เป้า")} ${Math.round(target * 100)}% · ${tr("สูตร")} ESM` },
        { label: 'Availability', value: fmtPct(o.A), color: toneOfPct(o.A, target), sub: `${tr("เดิน")} ${fmtHM(o.operatingSec)} / ${tr("แผน")} ${fmtHM(o.plannedSec)}` },
        { label: 'Performance', value: fmtPct(o.P), color: toneOfPct(o.P, target), sub: o.ct ? `CT ${Math.round(o.ct * 10) / 10} s (${tr("พาร์ทในใบ) · เฉลี่ย")} ${o.avgCycleSec?.toFixed(1) ?? '–'} s` : 'ไม่รู้ CT' },
        { label: 'Quality', value: fmtPct(o.Q), color: toneOfPct(o.Q, 0.99), sub: o.ngPeople == null ? 'ไม่มีใบ ⇒ ไม่รู้ NG ที่คนตัดสิน' : `NG ${tr("คนตัดสิน")} ${o.ngPeople} · ${tr("หน้าเครื่อง")} ${o.ngMachine}` },
        { label: tr("ชิ้น: เครื่อง / ยืนยัน / แผน"), value: `${o.pieces ?? '–'} / ${j.orders.length ? j.confirmedQty : '–'} / ${j.orders.length ? j.planQty : '–'}`, sub: `${ordersDone.length}/${j.orders.length} ${tr("ใบปิดแล้ว")}` },
        { label: 'MTTR / MTBF (Alarm)', value: `${o.mttrMin == null ? '–' : `${o.mttrMin.toFixed(1)} น.`}`, sub: o.mtbfMin == null ? 'ไม่มี Alarm' : `MTBF ${o.mtbfMin.toFixed(1)} ${tr("น.")} · Alarm ${o.counts.alarm + o.counts.alarmMinor} ${tr("ครั้ง")}` },
      ]} />
      {(why.length > 0 || o.pOver) && (
        <div style={{ fontSize: 12.5, color: 'var(--amber)', ...card, padding: 10 }}>
          {why.map(w => <div key={w}>⚠ {WHY_TEXT[w]}</div>)}
          {o.pOver && <div style={{ color: 'var(--red)' }}>⚠ %P {tr("เกิน 100% (ตัดไว้) — CT ในระบบอาจยาวกว่าที่จิ๊กทำได้จริง")}</div>}
        </div>
      )}
      {sec(span === 'ทั้งวัน' ? 'สถานะตลอดวัน' : 'สถานะตลอดกะ', `${hm(j.win.startMs)}–${hm(j.win.endMs)} · ${tr("ลากบนแถบเพื่อซูม · คลิกเพื่อดูช่วง ±15 นาที · ชี้เพื่อดูเวลาและสาเหตุ · อัปเดตล่าสุด")} ${j.lastEventAt ? hm(j.lastEventAt) : '–'}`, (
        <div style={{ display: 'grid', gap: 8 }}>
          <ZoomStateStrip key={`${j.win.startMs}-${j.win.endMs}`} segments={j.segments} startMs={j.win.startMs} endMs={j.win.endMs} />
        </div>
      ))}
      {sec('ยอดผลิต & สถานะเครื่องรายชั่วโมง', 'บน: ชิ้นดี + NG จากเครื่อง เทียบเป้า (เวลาแผนของชั่วโมง ÷ CT พาร์ทในใบ) · ล่าง: แต่ละชั่วโมงหมดเวลาไปกับสถานะไหน', <HourlyChart buckets={j.buckets} segments={j.segments} />)}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12, alignItems: 'start' }}>
        {sec(`OEE Loss ${span}`, 'เวลาแผนหายไปไหนบ้าง (Six Big Losses แบบย่อ)', <LossWaterfall o={o} />)}
        {sec(`Pareto ${tr("สาเหตุการหยุด")} ${span}`, `Alarm/Idle/${tr("หยุดนอกแผน ≥ 2 นาที + หยุดสั้น (นับใน Performance) · หยุดสั้น")} ${o.counts.minor} ${tr("ครั้ง")} ${fmtMin(o.minorSec)}`, <StopParetoChart pareto={j.pareto} onPick={r => setPick(p => (p?.key === r.key ? null : r))} />)}
      </div>
      {pick && <StopDrillPanel row={pick} events={j.events} orders={j.orders} tagNo={drillTagNo} fromMs={j.win.startMs} toMs={j.endMs ?? j.win.endMs} onClose={() => setPick(null)} />}
      {sec('ใบผลิตบนจิ๊กนี้ (ESM)', 'เป้า/ยอดยืนยันจากพนักงาน เทียบชิ้นที่เครื่องนับ — ตัวเชื่อม = เครื่องที่เลือกตอนเปิดใบ', (
          j.orders.length ? (
            <div style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
              {j.orders.map(x => (
                <div key={x.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <b style={{ fontFamily: 'ui-monospace, monospace' }}>{x.mat_no}</b>
                  <span>{tr("แผน")} {x.qty ?? '–'}</span>
                  <span style={{ color: x.status === 'confirmed' ? 'var(--green)' : 'var(--amber)' }}>
                    {x.status === 'confirmed' ? `${tr("ยืนยัน")} ${x.qty_ok ?? x.qty} · ${hm(Date.parse(x.confirmed_at))}` : tr("ยังเปิดอยู่")}
                  </span>
                </div>
              ))}
              <div style={{ color: 'var(--muted)', marginTop: 4 }}>
                {tr("เครื่องนับ")} {o.pieces ?? '–'} {tr("ชิ้น · ยืนยันแล้ว")} {j.confirmedQty} {tr("ชิ้น")}
                {o.pieces != null && ` · ${tr("ต่างกัน")} ${o.pieces - j.confirmedQty} (${tr("ใบที่ยังไม่ปิด/งานรอยืนยัน")})`}
              </div>
            </div>
          ) : <div style={{ fontSize: 12.5, color: 'var(--amber)' }}>{tr(WHY_TEXT.no_order)}</div>
        ))}
      {sec('การหยุดล่าสุด', 'ไม่รวมหยุดสั้น และช่วงไม่มีแผน', <StopTable stops={j.stops} />)}
      {trendRows && sec('แนวโน้มรายกะ', `A / P / Q / OEE ${tr("จากเครื่อง")} · ${trendRows.length} ${tr("กะล่าสุด")}`, <ShiftTrendChart rows={trendRows} target={target} />)}
    </div>
  );
}
