/* 🏭 ชิ้นส่วนจอ OEE รายจิ๊ก (ข้อมูลเครื่องจาก Node-RED · สูตร ESM) — ใช้ร่วม /line-oee + /oee-analytics?tab=machine
   📄 docs/modules/integration-hub.md §OEE รายจิ๊ก · สูตร src/utils/machineOee.js · โหลด src/lib/jigOeeData.js

   ของที่ ESM มีเหนือจอ Node-RED (คำสั่ง user 13/11 "ให้ ESM เหนือกว่า"):
     · CT จากพาร์ทในใบผลิตจริงของจิ๊ก (ไม่ใช่ ideal ค่าเดียว) · Q จาก NG ที่คน/QA ตัดสิน (คู่กับ NG หน้าเครื่อง)
     · เป้า/ยอดยืนยันจากใบผลิต เทียบชิ้นที่เครื่องนับ · เหตุผลที่ตัวเลขคิดไม่ได้เขียนบนจอเสมอ (ไม่รู้ ≠ 0)
   🔴 ไฟล์นี้วาดอย่างเดียว ห้ามคิดสูตร · ฟอนต์ขั้นต่ำ 11px · ห้าม color-mix (จอ TV Chromium 94)
   🔴 Pareto ใช้ <ParetoChart> กลาง · แท่งสีจาก Cell ต้อง CELL_BAR_FILL + tooltipProps (ไม่ได้ใช้ Cell ในไฟล์นี้) */
import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, ReferenceLine,
} from 'recharts';
import ParetoChart from './ParetoChart';
import { classifyAbc } from '../utils/pareto';
import { axisTick, tooltipProps, CHART_MARGIN } from '../utils/chartAxis';
import { WHY_TEXT, pct1 } from '../utils/machineOee';

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
  other:        { label: 'อื่นๆ (ไม่รู้จัก)',      color: 'var(--muted)' },
};
const kindMeta = (k) => KIND_META[k] || KIND_META.other;

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 14, boxShadow: 'var(--shadow-sm)', minWidth: 0 };
const hm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false });
const hms = (ms) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour12: false });
const fmtPct = (v) => (v == null ? '–' : `${pct1(v).toFixed(1)}%`);
const fmtMin = (sec) => (sec == null ? '–' : `${Math.round(sec / 60).toLocaleString()} น.`);
const fmtHM = (sec) => {
  if (sec == null) return '–';
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} ชม. ${m % 60} น.` : `${m} น.`;
};
const toneOfPct = (v, target) => (v == null ? 'var(--muted)' : v >= target ? 'var(--green)' : v >= target * 0.85 ? 'var(--amber)' : 'var(--red)');

/** แถบเปอร์เซ็นต์แนวนอน */
function Bar1({ label, v, target = 0.85 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '16px 1fr 52px', gap: 6, alignItems: 'center', fontSize: 12 }}>
      <span style={{ color: 'var(--muted)', fontWeight: 700 }}>{label}</span>
      <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${v == null ? 0 : Math.min(100, v * 100)}%`, height: '100%', background: toneOfPct(v, target) }} />
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
      <div style={{ position: 'relative', height, background: 'var(--bg3)', borderRadius: 4, overflow: 'hidden' }}
        role="img" aria-label="แถบสถานะเครื่องตลอดกะ">
        {segments.map((s, i) => (
          <div key={i} title={`${kindMeta(s.kind).label} ${hm(s.startMs)}–${hm(s.endMs)} (${Math.max(1, Math.round((s.endMs - s.startMs) / 60000))} น.)${s.reason ? ` · ${s.reason}` : ''}`}
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
            {j.ctInfo?.mats?.length ? `MAT ${j.ctInfo.mats.join(', ')}` : 'ไม่มีใบผลิตบนจิ๊กนี้'}{j.ctInfo?.ct ? ` · CT ${Math.round(j.ctInfo.ct * 10) / 10} s` : ''}
          </div>
        </div>
        {st && (st.live ? (
          /* สถานะสด = ข้อความตามต้นทาง (ESM ยังไม่จับคู่รหัสสถานะ ⇒ ไม่เดาสี) */
          <span title="สถานะสดจากเครื่อง (ข้อความตามต้นทาง)"
            style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', border: '1px solid var(--border2)', borderRadius: 999, padding: '1px 8px', maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ● {st.text}{st.sinceMs ? ` ${fmtHM((nowMs - st.sinceMs) / 1000)}` : ''}
          </span>
        ) : (
          <span title="สถานะล่าสุดที่รู้ (จากช่วงหยุดที่จบแล้ว — ยังไม่ใช่สถานะสด)"
            style={{ fontSize: 11.5, fontWeight: 700, color: kindMeta(st.kind).color, border: `1px solid ${kindMeta(st.kind).color}`, borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}>
            ● {kindMeta(st.kind).label}* {fmtHM((nowMs - st.sinceMs) / 1000)}
          </span>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 12, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 30, fontWeight: 800, color: toneOfPct(o.oee, target), lineHeight: 1 }}>{fmtPct(o.oee)}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>OEE กะนี้ (จากเครื่อง)</div>
        </div>
        <div style={{ display: 'grid', gap: 3 }}>
          <Bar1 label="A" v={o.A} target={target} /><Bar1 label="P" v={o.P} target={target} /><Bar1 label="Q" v={o.Q} target={0.99} />
        </div>
      </div>
      <JigStateStrip segments={j.segments} startMs={j.win.startMs} endMs={j.win.endMs} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, fontSize: 11.5, color: 'var(--muted)', textAlign: 'center' }}>
        <div><b style={{ fontSize: 15, color: 'var(--text)' }}>{o.pieces == null ? '–' : o.pieces.toLocaleString()}</b><div>ชิ้น (เครื่อง)</div></div>
        <div><b style={{ fontSize: 15, color: 'var(--text)' }}>{j.orders?.length ? j.confirmedQty.toLocaleString() : '–'}</b><div>ยืนยันแล้ว (คน)</div></div>
        <div><b style={{ fontSize: 15, color: 'var(--text)' }}>{fmtMin(o.downSec)}</b><div>หยุด ≥ 2 นาที</div></div>
        <div><b style={{ fontSize: 15, color: 'var(--text)' }}>{o.avgCycleSec == null ? '–' : `${o.avgCycleSec.toFixed(1)} s`}</b><div>cycle เฉลี่ย</div></div>
      </div>
      {why.length > 0 && <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>{why.map(w => WHY_TEXT[w]).join(' · ')}</div>}
      {o.pOver && <div style={{ fontSize: 11.5, color: 'var(--red)' }}>%P เกิน 100% (ตัดไว้) — CT ในระบบอาจยาวกว่าจริง ตรวจ CT ของพาร์ท</div>}
      {st?.approx && <div style={{ fontSize: 11, color: st.liveStale ? 'var(--amber)' : 'var(--muted)' }}>
        * {st.liveStale ? 'สถานะสดขาดการส่งเกิน 3 นาที — แสดงสถานะล่าสุดที่รู้จากช่วงหยุดที่จบแล้วแทน' : 'สถานะล่าสุดที่รู้จากช่วงหยุดที่จบแล้ว (ยังไม่ได้ส่งสถานะสด — เพิ่มชนิด "สถานะสดของเครื่อง" ใน flow)'}
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
            {r.sec != null && base > 0 && <div style={{ width: `${Math.min(100, (r.sec / base) * 100)}%`, height: '100%', background: r.loss ? 'var(--red)' : 'var(--blue)', opacity: r.loss ? 0.75 : 1 }} />}
          </div>
          <span style={{ textAlign: 'right', color: 'var(--text)' }}>
            {r.sec == null ? '– (ไม่รู้ CT)' : `${fmtHM(r.sec)} · ${base > 0 ? Math.round((r.sec / base) * 100) : 0}%`}
          </span>
        </div>
      ))}
      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>OEE = เวลาผลิตงานดี ÷ เวลาแผนผลิต · หยุดตามแผน/ไม่มีแผน/พัก ไม่นับในเวลาแผน</div>
    </div>
  );
}

/** ยอดรายชั่วโมง เทียบเป้า (เวลาแผนของชั่วโมง ÷ CT) — แกนเดียว */
export function HourlyChart({ buckets = [] }) {
  const data = buckets.map(b => ({
    h: hm(b.hourMs), good: b.qty == null ? null : Math.max(0, b.qty - (b.ng || 0)), ng: b.ng, target: b.target,
    oee: b.oee == null ? null : Math.round(b.oee * 100),
  }));
  return (
    <div>
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={CHART_MARGIN}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="h" tick={axisTick()} />
            <YAxis width="auto" tick={axisTick()} allowDecimals={false} />
            <Tooltip {...tooltipProps()} />
            <Bar dataKey="good" name="ชิ้นดี (เครื่อง)" stackId="q" fill="var(--green)" isAnimationActive={false} />
            <Bar dataKey="ng" name="NG (หน้าเครื่อง)" stackId="q" fill="var(--red)" isAnimationActive={false} />
            <Line dataKey="target" name="เป้า (เวลาแผน ÷ CT)" stroke="var(--text)" strokeDasharray="4 3" dot={false} type="stepAfter" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.length || 1}, 1fr)`, fontSize: 11, color: 'var(--muted)', textAlign: 'center', paddingLeft: 40 }}>
        {data.map(d => <span key={d.h}>{d.oee == null ? '–' : `${d.oee}%`}</span>)}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>แถวล่าง = OEE ของชั่วโมง (ชิ้นดี × CT ÷ เวลาแผนของชั่วโมง) · เป้าว่าง = ยังไม่รู้ CT</div>
    </div>
  );
}

/** แนวโน้มรายกะ (A/P/Q/OEE) — แกนเดียว 0–100 */
export function ShiftTrendChart({ rows = [], target = 0.85 }) {
  const data = [...rows].reverse().map(r => ({
    k: `${r.workDate.slice(8, 10)}/${r.workDate.slice(5, 7)} ${r.shift === 'day' ? 'เช้า' : 'ดึก'}`,
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
          <Line dataKey="OEE" stroke="var(--green)" strokeWidth={2.5} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
          <Line dataKey="A" stroke="var(--blue)" dot={false} connectNulls={false} isAnimationActive={false} />
          <Line dataKey="P" stroke="var(--amber)" dot={false} connectNulls={false} isAnimationActive={false} />
          <Line dataKey="Q" stroke="var(--muted)" dot={false} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Pareto เวลาที่เสีย — ผ่าน <ParetoChart> กลาง */
export function StopParetoChart({ pareto = [] }) {
  const rows = useMemo(() => classifyAbc(pareto.map(p => ({
    ...p, name: p.state === 'minor' ? 'หยุดสั้น < 2 นาที' : `${kindMeta(p.state).label}${p.text ? ` · ${p.code ?? ''} ${p.text}` : p.code ? ` · ${p.code}` : ''}`,
  })), p => p.min), [pareto]);
  if (!rows.length) return <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>ไม่มีเวลาที่เสียจากการหยุดในช่วงนี้</div>;
  return <ParetoChart rows={rows} unit="นาที" height={280} />;
}

/** รายการหยุด */
export function StopTable({ stops = [], limit = 40 }) {
  const [all, setAll] = useState(false);
  const shown = all ? stops : stops.slice(0, limit);
  if (!stops.length) return <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>ไม่มีการหยุด ≥ 2 นาทีในช่วงนี้</div>;
  const th = { textAlign: 'left', padding: '5px 8px', fontSize: 12, color: 'var(--muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
  const td = { padding: '5px 8px', fontSize: 12.5, borderBottom: '1px solid var(--border)' };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>เริ่ม</th><th style={th}>จบ</th><th style={{ ...th, textAlign: 'right' }}>นาที</th><th style={th}>สถานะ</th><th style={th}>สาเหตุ (จากหน้าเครื่อง)</th></tr></thead>
        <tbody>
          {shown.map(s => (
            <tr key={`${s.startMs}|${s.state}`}>
              <td style={td}>{hms(s.startMs)}</td><td style={td}>{hms(s.endMs)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{s.min.toFixed(1)}</td>
              <td style={td}><span style={{ color: kindMeta(s.state).color, fontWeight: 700 }}>● {kindMeta(s.state).label}</span></td>
              <td style={td}>{s.text ? `${s.code ?? ''} ${s.text}` : s.code ? `รหัส ${s.code}` : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {stops.length > limit && (
        <button type="button" className="pg-btn" style={{ marginTop: 6 }} onClick={() => setAll(v => !v)}>
          {all ? 'ย่อ' : `แสดงทั้งหมด ${stops.length} รายการ (ซ่อนอยู่ ${stops.length - limit})`}
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
        { label: 'OEE กะนี้ (จากเครื่อง)', value: fmtPct(o.oee), color: toneOfPct(o.oee, target), sub: `เป้า ${Math.round(target * 100)}% · สูตร ESM` },
        { label: 'Availability', value: fmtPct(o.A), color: toneOfPct(o.A, target), sub: `เดิน ${fmtHM(o.operatingSec)} / แผน ${fmtHM(o.plannedSec)}` },
        { label: 'Performance', value: fmtPct(o.P), color: toneOfPct(o.P, target), sub: o.ct ? `CT ${Math.round(o.ct * 10) / 10} s (พาร์ทในใบ) · เฉลี่ย ${o.avgCycleSec?.toFixed(1) ?? '–'} s` : 'ไม่รู้ CT' },
        { label: 'Quality', value: fmtPct(o.Q), color: toneOfPct(o.Q, 0.99), sub: o.ngPeople == null ? 'ไม่มีใบ ⇒ ไม่รู้ NG ที่คนตัดสิน' : `NG คนตัดสิน ${o.ngPeople} · หน้าเครื่อง ${o.ngMachine}` },
        { label: 'ชิ้น: เครื่อง / ยืนยัน / แผน', value: `${o.pieces ?? '–'} / ${j.orders.length ? j.confirmedQty : '–'} / ${j.orders.length ? j.planQty : '–'}`, sub: `${ordersDone.length}/${j.orders.length} ใบปิดแล้ว` },
        { label: 'MTTR / MTBF (Alarm)', value: `${o.mttrMin == null ? '–' : `${o.mttrMin.toFixed(1)} น.`}`, sub: o.mtbfMin == null ? 'ไม่มี Alarm' : `MTBF ${o.mtbfMin.toFixed(1)} น. · Alarm ${o.counts.alarm + o.counts.alarmMinor} ครั้ง` },
      ]} />
      {(why.length > 0 || o.pOver) && (
        <div style={{ fontSize: 12.5, color: 'var(--amber)', ...card, padding: 10 }}>
          {why.map(w => <div key={w}>⚠ {WHY_TEXT[w]}</div>)}
          {o.pOver && <div style={{ color: 'var(--red)' }}>⚠ %P เกิน 100% (ตัดไว้) — CT ในระบบอาจยาวกว่าที่จิ๊กทำได้จริง</div>}
        </div>
      )}
      {sec('สถานะตลอดกะ', `${hm(j.win.startMs)}–${hm(j.win.endMs)} · ชี้ที่แถบเพื่อดูเวลาและสาเหตุ · อัปเดตล่าสุด ${j.lastEventAt ? hm(j.lastEventAt) : '–'}`, (
        <div style={{ display: 'grid', gap: 8 }}>
          <JigStateStrip segments={j.segments} startMs={j.win.startMs} endMs={j.win.endMs} height={26} showTicks />
          <KindLegend />
        </div>
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12, alignItems: 'start' }}>
        {sec('ยอดผลิตรายชั่วโมง', 'ชิ้นดี + NG จากเครื่อง เทียบเป้า (เวลาแผนของชั่วโมง ÷ CT พาร์ทในใบ)', <HourlyChart buckets={j.buckets} />)}
        {sec('OEE Loss กะนี้', 'เวลาแผนหายไปไหนบ้าง (Six Big Losses แบบย่อ)', <LossWaterfall o={o} />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12, alignItems: 'start' }}>
        {sec('Pareto สาเหตุการหยุด กะนี้', `Alarm/Idle/หยุดนอกแผน ≥ 2 นาที + หยุดสั้น (นับใน Performance) · หยุดสั้น ${o.counts.minor} ครั้ง ${fmtMin(o.minorSec)}`, <StopParetoChart pareto={j.pareto} />)}
        {sec('ใบผลิตบนจิ๊กนี้ (ESM)', 'เป้า/ยอดยืนยันจากพนักงาน เทียบชิ้นที่เครื่องนับ — ตัวเชื่อม = เครื่องที่เลือกตอนเปิดใบ', (
          j.orders.length ? (
            <div style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
              {j.orders.map(x => (
                <div key={x.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <b style={{ fontFamily: 'ui-monospace, monospace' }}>{x.mat_no}</b>
                  <span>แผน {x.qty ?? '–'}</span>
                  <span style={{ color: x.status === 'confirmed' ? 'var(--green)' : 'var(--amber)' }}>
                    {x.status === 'confirmed' ? `ยืนยัน ${x.qty_ok ?? x.qty} · ${hm(Date.parse(x.confirmed_at))}` : 'ยังเปิดอยู่'}
                  </span>
                </div>
              ))}
              <div style={{ color: 'var(--muted)', marginTop: 4 }}>
                เครื่องนับ {o.pieces ?? '–'} ชิ้น · ยืนยันแล้ว {j.confirmedQty} ชิ้น
                {o.pieces != null && ` · ต่างกัน ${o.pieces - j.confirmedQty} (ใบที่ยังไม่ปิด/งานรอยืนยัน)`}
              </div>
            </div>
          ) : <div style={{ fontSize: 12.5, color: 'var(--amber)' }}>{WHY_TEXT.no_order}</div>
        ))}
      </div>
      {sec('การหยุดล่าสุด', 'ไม่รวมหยุดสั้น และช่วงไม่มีแผน', <StopTable stops={j.stops} />)}
      {trendRows && sec('แนวโน้มรายกะ', `A / P / Q / OEE จากเครื่อง · ${trendRows.length} กะล่าสุด`, <ShiftTrendChart rows={trendRows} target={target} />)}
    </div>
  );
}
