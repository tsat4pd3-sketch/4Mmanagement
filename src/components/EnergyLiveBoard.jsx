/* ⚡ บอร์ดค่าไฟสด — /energy แท็บ "ค่าไฟสด" (2026-11-09 · คำสั่ง user "จัดเต็ม")
   ต้นแบบหน้าตา: dashboard Node-RED ของ Die Shop (TSS Smart Energy) — ย้ายมาอยู่ใน ESM
   ตัวส่ง: Node-RED อ่าน MySQL energy_sec → POST edge `ingest-energy` ทุก 1 นาที
   แบบเต็ม: docs/ENERGY_MONITORING_DESIGN.md §15

   ⚠️ สูตรสถานะ/ยอดตู้/แจ้งเตือน = buildLiveBoard() + liveSeries() ใน utils/energy.js เท่านั้น
   ⚠️ ไม่รู้ = "—" ห้ามโชว์ 0 · "ไม่เคยได้รับค่า" ≠ "ขาดการติดต่อ" ≠ "ค่าเป็น 0"
   ⚠️ egress: กราฟเส้นโหลดทั้งวันครั้งเดียว แล้วรอบถัดไปดึงเฉพาะนาทีที่ใหม่กว่า (RATE.METER) */
import { useState, useCallback, useMemo, useRef } from 'react';
import { supabaseDR } from '../supabaseClient';
import { usePolling } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';
import { bkkDateStr } from '../utils/workDate';
import { buildLiveBoard, liveSeries, METER_OFFLINE_MIN } from '../utils/energy';
import NoticeBar from './NoticeBar';
import useIsMobile from '../utils/useIsMobile';

/* สีผ่าน token เท่านั้น (ด่าน colorRatchet · พาเลต ≤5 สี) */
const GOOD = 'var(--green)', WARN = 'var(--amber)', BAD = 'var(--red)', IDLE = 'var(--muted)', ACC = 'var(--accent2)', INFO = 'var(--blue)';
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 14, boxShadow: 'var(--shadow-sm)' };
const PAGE = 1000;   // เพดาน PostgREST ต่อคิวรี (กฎ DB ข้อ 5)

const fmt = (v, d = 1) => (v == null || !Number.isFinite(Number(v)) ? '—'
  : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const timeTh = (ms) => (ms == null ? '—'
  : new Date(ms).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }));
const statusMeta = (m) => (
  m.status === 'never' ? { label: 'ยังไม่เคยได้รับค่า', color: IDLE }
    : m.status === 'offline' ? { label: `ขาดการติดต่อ ${m.ageMin} นาที`, color: WARN }
      : (m.overKw || m.overA) ? { label: 'เกินลิมิต', color: BAD }
        : { label: 'ออนไลน์', color: GOOD });

/** แถวรายนาทีตั้งแต่ `from` — วนทีละ 1000 แถว (วันเต็ม 3 เครื่อง = 4,320 แถว) */
async function fetchReadings(from, inclusive) {
  const out = [];
  for (let off = 0; off < 20 * PAGE; off += PAGE) {
    const { data, error } = await supabaseDR.from('energy_readings')
      .select('scope_kind, scope_name, bucket_at, kw')
      .filter('bucket_at', inclusive ? 'gte' : 'gt', from).order('bucket_at').range(off, off + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export default function EnergyLiveBoard() {
  const [meters, setMeters] = useState([]);
  const [live, setLive] = useState([]);
  const [daily, setDaily] = useState([]);
  const [readings, setReadings] = useState([]);
  const [err, setErr] = useState('');
  const [missing, setMissing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const cursor = useRef({ day: null, last: null });   // กราฟ: วันที่โหลดอยู่ + นาทีล่าสุดที่มีแล้ว
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    const now = Date.now();
    const today = bkkDateStr(now);
    const monthStart = `${today.slice(0, 7)}-01`;
    const newDay = cursor.current.day !== today;
    const from = newDay ? `${today}T00:00:00+07:00` : cursor.current.last;
    try {
      const [m, l, d, r] = await Promise.all([
        supabaseDR.from('energy_live_meters')
          .select('scope_kind, scope_name, panel, subtitle, limit_kw, limit_a, gauge_max_kw, sort_order')
          .eq('is_active', true),
        supabaseDR.from('energy_live').select('scope_kind, scope_name, field, value, received_at'),
        supabaseDR.from('energy_daily')
          .select('scope_kind, scope_name, day, kwh, peak_kw, peak_at, resets').gte('day', monthStart),
        fetchReadings(from, newDay),
      ]);
      if (id !== reqId.current) return;   // มีรอบใหม่กว่าแล้ว — ทิ้งผลเก่า
      const e = m.error || l.error || d.error;
      if (e) {
        const isMissing = e.code === '42P01' || e.code === 'PGRST205';
        setMissing(isMissing);
        setErr(isMissing ? '' : e.message);
        return;
      }
      setMissing(false); setErr('');
      setMeters(m.data || []); setLive(l.data || []); setDaily(d.data || []);
      setReadings(prev => (newDay ? r : [...prev, ...r]));
      const last = r.length ? r[r.length - 1].bucket_at : null;
      cursor.current = { day: today, last: last || (newDay ? `${today}T00:00:00+07:00` : cursor.current.last) };
      setNowMs(now);
    } catch (ex) {
      if (id !== reqId.current) return;
      if (ex?.code === '42P01' || ex?.code === 'PGRST205') setMissing(true);
      else setErr(ex?.message || String(ex));
    } finally {
      if (id === reqId.current) setLoaded(true);
    }
  }, []);
  usePolling(load, RATE.METER);

  const today = bkkDateStr(nowMs);
  const board = useMemo(() => buildLiveBoard({ meters, live, daily, today, nowMs }), [meters, live, daily, today, nowMs]);
  const series = useMemo(() => liveSeries(readings, meters), [readings, meters]);
  const panelPeaks = useMemo(() => {
    const out = {};
    for (const p of board.panels) {
      out[p.panel] = liveSeries(readings, meters.filter(m => (m.panel || '—') === p.panel)).panelPeak;
    }
    return out;
  }, [board.panels, readings, meters]);

  if (missing) return (
    <NoticeBar tone="bad">ยังไม่ได้ apply migration <code>20261109_energy_live_board</code> (DR) — แจ้ง admin</NoticeBar>
  );
  if (!loaded) return <div style={{ color: 'var(--muted)', padding: 20 }}>กำลังโหลด…</div>;

  const t = board.totals;
  const lastRecv = board.meters.map(m => m.receivedAt).filter(Boolean).sort().pop();
  const allPeak = Object.values(panelPeaks).filter(Boolean);

  return (
    <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
      {err && <NoticeBar tone="bad">โหลดค่ามิเตอร์ไม่สำเร็จ: {err} — ตัวเลขบนจอเป็นของรอบก่อนหน้า</NoticeBar>}
      {!board.meters.length && (
        <NoticeBar tone="warn">ยังไม่มีมิเตอร์ในทะเบียนบอร์ดสด (<code>energy_live_meters</code>)</NoticeBar>
      )}
      {board.meters.length > 0 && t.never === t.total && (
        <NoticeBar tone="warn">
          <b>ยังไม่เคยได้รับค่าจากมิเตอร์เลย</b> — ตัวส่ง (Node-RED) ต้อง POST ชื่อ topic ให้ตรงกับแท็บ "มิเตอร์ / MQTT"
          เช่น <code>dieshop/DB-ROBOT/kw</code> · ช่องทั้งหมดจึงขึ้น "—" (ไม่ใช่ 0)
        </NoticeBar>
      )}
      {t.resets > 0 && (
        <NoticeBar tone="warn">เลขมิเตอร์ถอยหลังวันนี้ {t.resets} ครั้ง (reset / เปลี่ยนมิเตอร์) — ช่วงนั้นไม่ถูกนับเป็นหน่วยไฟ ยอดวันนี้อาจต่ำกว่าจริง</NoticeBar>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>
          ค่าจากมิเตอร์ทุกเครื่อง · ตัวส่งยิงทุก 1 นาที · จอดึงใหม่ทุก 1 นาที · ไม่มีค่าใหม่เกิน {METER_OFFLINE_MIN} นาที = ขาดการติดต่อ
        </div>
        <div style={{ ...card, padding: '6px 12px', fontSize: 12.5, color: 'var(--text2)' }}>
          รับข้อมูลล่าสุด {lastRecv ? new Date(lastRecv).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
        </div>
      </div>

      {/* ── KPI ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, alignContent: 'start' }}>
        <Kpi color={ACC} label="กำลังไฟรวมขณะนี้" value={fmt(t.kw)} unit="kW"
          sub={<>ออนไลน์ {t.online}/{t.total} เครื่อง{allPeak.length > 0 && <> · สูงสุดวันนี้ {fmt(Math.max(...allPeak.map(p => p.kw)))} kW ({timeTh(allPeak.reduce((a, b) => (b.kw > a.kw ? b : a)).at)})</>}</>} />
        <Kpi color={INFO} label="ใช้ไฟวันนี้" value={fmt(t.todayKwh)} unit="kWh" sub="นับจากเลขมิเตอร์ ตั้งแต่ 00:00 น." />
        <Kpi color={INFO} label="ใช้ไฟเดือนนี้" value={fmt(t.monthKwh, 0)} unit="kWh"
          sub={t.avgPerDay != null ? `เฉลี่ยวันละ ${fmt(t.avgPerDay)} kWh (${t.monthDays} วันที่มีข้อมูล)` : 'ยังไม่มีข้อมูลของเดือนนี้'} />
        <Kpi color={t.offline || t.never ? WARN : GOOD} label="สถานะมิเตอร์" value={t.online} unit={`/ ${t.total} ออนไลน์`}
          sub={<><span style={{ color: WARN }}>ขาดการติดต่อ {t.offline}</span> · <span style={{ color: 'var(--muted)' }}>ยังไม่เคยส่ง {t.never}</span></>} />
        <Kpi color={t.alerts.length ? BAD : GOOD} label="เกินลิมิตตอนนี้" value={t.alerts.length} unit="เครื่อง"
          sub={t.alerts.length ? `ที่ ${t.alerts.map(m => m.name).join(', ')}` : 'ทุกเครื่องอยู่ในลิมิต (นับเฉพาะเครื่องที่ออนไลน์)'} />
      </div>

      {/* ── เส้นทางจ่ายไฟ ── */}
      {board.panels.map(p => <PanelFlow key={p.panel} panel={p} />)}

      {/* ── การ์ดรายเครื่อง ── */}
      {board.meters.length > 0 && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>เครื่องจักรทั้งหมด</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, alignContent: 'start' }}>
            {board.meters.map(m => <MeterCard key={m.key} m={m} pts={series.byScope.get(m.key) || []} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ color, label, value, unit, sub }) {
  return (
    <div style={{ ...card, borderLeft: `4px solid ${color}` }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)' }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', lineHeight: 1.2, marginTop: 4 }}>
        {value} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted)' }}>{unit}</span>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>
    </div>
  );
}

/** ตู้ → เส้นประวิ่งไปแต่ละเครื่อง · ความเร็วเส้นแปรตามกำลังไฟ (เทียบสเกลเกจของเครื่องนั้น) */
function PanelFlow({ panel }) {
  const isMobile = useIsMobile();
  const n = panel.meters.length;
  const rowH = 78, top = 40, H = top + n * rowH;
  const busX = 330, boxX = 680, midY = top + (n * rowH) / 2 - rowH / 2 + 26;
  return (
    <div style={{ ...card }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>เส้นทางจ่ายไฟจากตู้ {panel.panel}</div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>ความเร็วเส้นแปรตามกำลังไฟที่ใช้ · ยอดตู้ = ผลรวมเครื่องที่ออนไลน์</div>
      {/* 📱 มือถือ: SVG กว้าง 1000 ถูกย่อจนตัวหนังสือ < 11px ⇒ แสดงเป็นรายการแทน (จอคอมไม่เปลี่ยน) */}
      {isMobile ? (
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: ACC }}>{fmt(panel.kw)} kW
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}> · ออนไลน์ {panel.online}/{panel.total}{panel.partial ? ' (ยอดไม่ครบ)' : ''}</span></div>
          {panel.meters.map(m => {
            const sm = statusMeta(m);
            return (
              <div key={m.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, borderLeft: `3px solid ${sm.color}`, paddingLeft: 8 }}>
                <span style={{ fontWeight: 700, color: 'var(--text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                <span style={{ color: sm.color, whiteSpace: 'nowrap' }}>{fmt(m.kw)} kW · {fmt(m.a)} A</span>
              </div>
            );
          })}
        </div>
      ) : (
      <svg viewBox={`0 0 1000 ${H}`} style={{ width: '100%', height: 'auto', display: 'block', marginTop: 6 }} role="img"
        aria-label={`ตู้ ${panel.panel} ${fmt(panel.kw)} kW`}>
        <rect x="40" y={midY - 46} width="230" height="92" rx="12" fill={ACC} opacity="0.9" />
        <text x="155" y={midY - 18} textAnchor="middle" fill="var(--bg)" fontSize="15" fontWeight="700">ตู้ {panel.panel}</text>
        <text x="155" y={midY + 12} textAnchor="middle" fill="var(--bg)" fontSize="28" fontWeight="800">{fmt(panel.kw)} kW</text>
        <text x="155" y={midY + 34} textAnchor="middle" fill="var(--bg)" fontSize="13">
          ออนไลน์ {panel.online}/{panel.total} เครื่อง{panel.partial ? ' (ยอดไม่ครบ)' : ''}
        </text>
        <line x1="270" y1={midY} x2={busX} y2={midY} stroke={ACC} strokeWidth="5" />
        <line x1={busX} y1={top + 26} x2={busX} y2={top + (n - 1) * rowH + 26} stroke={ACC} strokeWidth="5" />
        {panel.meters.map((m, i) => {
          const y = top + i * rowH + 26;
          const sm = statusMeta(m);
          const live = m.status === 'online' && m.kw != null && m.kw > 0;
          const ratio = live && m.gaugeMax ? Math.min(1, m.kw / m.gaugeMax) : 0;
          const dur = live ? (2.4 - 1.9 * ratio).toFixed(2) : null;   // 2.4 วิ (เบา) → 0.5 วิ (เต็มสเกล)
          return (
            <g key={m.key}>
              <circle cx={busX} cy={y} r="6" fill={ACC} />
              <line x1={busX} y1={y} x2={boxX} y2={y} stroke="var(--border)" strokeWidth="5" />
              <line x1={busX} y1={y} x2={boxX} y2={y} stroke={live ? ACC : IDLE} strokeWidth="5" strokeDasharray="18 10"
                className={live ? 'energy-flow' : undefined} style={live ? { animationDuration: `${dur}s` } : undefined} />
              <text x={(busX + boxX) / 2} y={y - 12} textAnchor="middle" fill={sm.color} fontSize="18" fontWeight="700">
                {fmt(m.kw)} kW · {fmt(m.a)} A
              </text>
              <rect x={boxX} y={y - 26} width="290" height="52" rx="10" fill="var(--card)" stroke={sm.color} strokeWidth="3" />
              <circle cx={boxX + 24} cy={y} r="7" fill={sm.color} />
              {/* ชื่อบรรทัดบน · สถานะบรรทัดล่าง — ชื่อยาวเกินกล่องตัดด้วย … (ชื่อเต็มอยู่ใน title) */}
              <text x={boxX + 42} y={y - 2} fill="var(--text)" fontSize="19" fontWeight="800">
                <title>{m.name}</title>{m.name.length > 20 ? `${m.name.slice(0, 19)}…` : m.name}
              </text>
              <text x={boxX + 42} y={y + 17} fill={sm.color} fontSize="13" fontWeight="700">{sm.label}</text>
            </g>
          );
        })}
      </svg>
      )}
    </div>
  );
}

function MeterCard({ m, pts }) {
  const sm = statusMeta(m);
  return (
    <div style={{ ...card, borderColor: sm.color === GOOD ? 'var(--border)' : sm.color }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{m.name}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{m.subtitle}</div>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>
            ลิมิต <b style={{ color: GOOD }}>{m.limitKw ?? '—'} kW</b> · <b style={{ color: ACC }}>{m.limitA ?? '—'} A</b>
          </div>
        </div>
        <span style={{ alignSelf: 'flex-start', fontSize: 11.5, fontWeight: 700, color: sm.color, border: `1px solid ${sm.color}`, borderRadius: 999, padding: '2px 10px', whiteSpace: 'nowrap' }}>
          ● {sm.label}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, marginTop: 10, alignItems: 'center' }}>
        <Gauge kw={m.kw} max={m.gaugeMax} color={m.status !== 'online' ? IDLE : m.overKw ? BAD : GOOD} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <Stat label="แรงดัน (เฉลี่ย 3 เฟส)" value={fmt(m.v, 0)} unit="V" color={INFO} />
          <Stat label="กระแส (เฟสสูงสุด)" value={fmt(m.a)} unit="A" color={m.overA ? BAD : ACC} />
          <Stat label="ใช้วันนี้" value={fmt(m.todayKwh)} unit="kWh" color={INFO} />
          <Stat label="เลขมิเตอร์" value={fmt(m.kwhTotal, 0)} unit="kWh" color={INFO} />
        </div>
      </div>

      <Spark pts={pts} limit={m.limitKw} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--muted)', marginTop: 4, gap: 8 }}>
        <span>{m.ageMin == null ? 'ยังไม่เคยได้รับค่า' : m.ageMin < 1 ? 'อัปเดตเมื่อสักครู่' : `อัปเดต ${m.ageMin} นาทีที่แล้ว`}</span>
        <span>{m.peakKw != null ? `สูงสุดวันนี้ ${fmt(m.peakKw)} kW (${timeTh(Date.parse(m.peakAt))})` : ''}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, unit, color }) {
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color }}>{value} <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500 }}>{unit}</span></div>
    </div>
  );
}

/** เกจครึ่งวงล่างเปิด (270°) — ไม่รู้สเกล/ไม่รู้ค่า = วงเทาว่าง ไม่วาดเข็มที่ 0 */
function Gauge({ kw, max, color }) {
  const R = 46, C = 60, sweep = 270, start = 135;
  const pt = (deg) => [C + R * Math.cos((deg * Math.PI) / 180), C + R * Math.sin((deg * Math.PI) / 180)];
  const arc = (a0, a1) => {
    const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
    return `M ${x0} ${y0} A ${R} ${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const ratio = kw != null && max ? Math.max(0, Math.min(1, kw / max)) : null;
  return (
    <svg viewBox="0 0 120 120" style={{ width: 120, height: 120 }} role="img" aria-label={`${fmt(kw)} kW`}>
      <path d={arc(start, start + sweep)} stroke="var(--border)" strokeWidth="10" fill="none" strokeLinecap="round" />
      {ratio != null && ratio > 0 && (
        <path d={arc(start, start + sweep * ratio)} stroke={color} strokeWidth="10" fill="none" strokeLinecap="round" />
      )}
      <text x="60" y="62" textAnchor="middle" fill={color} fontSize="24" fontWeight="800">{fmt(kw)}</text>
      <text x="60" y="80" textAnchor="middle" fill="var(--muted)" fontSize="12">kW</text>
      <text x="60" y="112" textAnchor="middle" fill="var(--muted)" fontSize="11">สเกล 0–{max != null ? Math.round(max) : '?'}</text>
    </svg>
  );
}

/** กราฟเส้น kW วันนี้ (รายนาที) · เส้นประ = ลิมิต · ช่วงที่ขาดเกิน 5 นาทีไม่ลากเส้นต่อ */
function Spark({ pts, limit }) {
  if (pts.length < 2) {
    return <div style={{ height: 56, marginTop: 10, display: 'grid', placeItems: 'center', fontSize: 11.5, color: 'var(--muted)', border: '1px dashed var(--border)', borderRadius: 8 }}>
      ยังไม่มีค่ารายนาทีของวันนี้
    </div>;
  }
  const W = 600, H = 56;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const maxY = Math.max(...pts.map(p => p.kw), limit || 0) * 1.1 || 1;
  const x = (t) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * W);
  const y = (v) => H - (v / maxY) * H;
  let d = '';
  pts.forEach((p, i) => {
    const gap = i > 0 && p.t - pts[i - 1].t > 5 * 60000;
    d += `${i === 0 || gap ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.kw).toFixed(1)} `;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 56, display: 'block', marginTop: 10 }}
      role="img" aria-label="กราฟกำลังไฟวันนี้">
      {limit != null && <line x1="0" x2={W} y1={y(limit)} y2={y(limit)} stroke={BAD} strokeDasharray="6 6" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      <path d={d} fill="none" stroke={GOOD} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
