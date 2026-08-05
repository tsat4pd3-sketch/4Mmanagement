import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { wavg } from '../utils/oee';
import { pairAwareTotal } from '../utils/pairTotals';
import useIsMobile from '../utils/useIsMobile';

/* ══ 🏢 ภาพรวมกลุ่มโรงงาน (Group Overview) — MOCKUP หลายโรงงาน · 2026-08-05 ══════════════
   โจทย์ผู้บริหาร: "ระบบนี้ตอนนี้คุมโรงงานเราโรงเดียว ถ้าจะดูภาพรวมหลายโรงพร้อมกันทำได้มั้ย"
   หน้านี้ = ตัวอย่างหน้าจอเพื่อตอบคำถามนั้น (ยังไม่ใช่ระบบ multi-plant จริง):
     • โรงงานที่ 1 = ข้อมูลจริงจากฐานข้อมูลปัจจุบัน (กะที่ปิดแล้วของวันที่เลือก)
     • โรงงานที่ 2-5 = ปั้นจากข้อมูลจริงชุดเดียวกันด้วยตัวคูณ + seeded RNG (deterministic — ตัวเลขไม่ดิ้นทุกครั้งที่รีเฟรช)
   ⚠️ ไม่มีการเขียน DB ใดๆ · ไม่มี schema ของ plant จริง — ข้อมูลจำลองอยู่ในหน่วยความจำหน้านี้เท่านั้น

   ไม่ scope ตาม section/line โดยตั้งใจ (เหมือน /factory-map ซึ่งเป็นข้อยกเว้นทางการใน CLAUDE.md):
   เป็นจอภาพรวมผู้บริหาร/ห้องประชุม — สิทธิ์เข้าหน้าคุมที่ role_permissions (seed: admin/manager)
   ═════════════════════════════════════════════════════════════════════════════════════════ */

function getWorkDate() {
  const d = new Date();
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// วันงานล่าสุดที่ "จบแล้ว" — ตรรกะเดียวกับ MorningMeeting / แผงทบทวนใน FactoryMap
function reviewDefaultDate() {
  const base = getWorkDate();
  if (new Date().getHours() < 8) return base;
  const d = new Date(`${base}T00:00:00`); d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const shiftDate = (s, delta) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + delta); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtThaiDate = (s) => { try { return new Date(`${s}T00:00:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); } catch { return s; } };
const fmtNum = (n) => (n == null ? '0' : Math.round(n).toLocaleString('en-US'));
const oeeCol = (o) => o == null ? 'var(--muted)' : o >= 80 ? '#22c55e' : o >= 65 ? '#f59e0b' : '#ef4444';
const pctCol = (p) => p == null ? 'var(--muted)' : p >= 95 ? '#22c55e' : p >= 80 ? '#f59e0b' : '#ef4444';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* seeded RNG — ตัวเลขจำลองต้องคงที่ต่อ (โรงงาน × ไลน์ × วัน) ไม่งั้นรีเฟรชทีตัวเลขดิ้นที = ดูไม่น่าเชื่อถือ */
function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const rnd = (str) => (hash32(str) % 100000) / 100000;                 // 0..1
const jit = (str, spread) => 1 + (rnd(str) - 0.5) * spread;           // 1 ± spread/2

/* ── โรงงานในกลุ่ม (mockup) ───────────────────────────────────────────────────────────
   real: true = ดึงข้อมูลจริง · ที่เหลือคือ profile การจำลอง
     qtyF   ตัวคูณปริมาณผลิต (ขนาดโรงงาน)   oeeD  ส่วนต่าง OEE เป็นจุด (+ ดีกว่า / − แย่กว่า)
     dtF    ตัวคูณ downtime                 ngF   ตัวคูณของเสีย       keep  สัดส่วนไลน์ที่โรงนั้นมี */
const PLANTS = [
  { key: 'bp', name: 'บ้านโพธิ์', code: 'PLANT-1', region: 'ฉะเชิงเทรา · ไทย', flag: '🇹🇭', real: true },
  { key: 'ry', name: 'ระยอง',      code: 'PLANT-2', region: 'ระยอง · ไทย',      flag: '🇹🇭', qtyF: 0.88, oeeD: -6.5, dtF: 1.45, ngF: 1.7, keep: 0.80 },
  { key: 'sp', name: 'บางปู',      code: 'PLANT-3', region: 'สมุทรปราการ · ไทย', flag: '🇹🇭', qtyF: 1.22, oeeD: 3.5, dtF: 0.72, ngF: 0.65, keep: 0.85 },
  { key: 'vn', name: 'Hanoi',      code: 'PLANT-4', region: 'เวียดนาม',         flag: '🇻🇳', qtyF: 0.62, oeeD: -2.0, dtF: 1.10, ngF: 1.15, keep: 0.55 },
  { key: 'id', name: 'Karawang',   code: 'PLANT-5', region: 'อินโดนีเซีย',      flag: '🇮🇩', qtyF: 0.47, oeeD: -11.0, dtF: 1.85, ngF: 2.1, keep: 0.45 },
];

const SHIFT_MIN_FALLBACK = 570;

export default function GroupOverview() {
  const isMobile = useIsMobile();
  const [date, setDate] = useState(reviewDefaultDate);
  const [usedDate, setUsedDate] = useState(null);      // วันที่ที่มีข้อมูลจริง (อาจถอยหลังจาก date)
  const [baseLines, setBaseLines] = useState([]);      // aggregate จริงต่อไลน์บนสุด
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);      // plant.key ที่กางดูรายไลน์
  const [showHow, setShowHow] = useState(false);

  /* ── โหลดข้อมูลจริงของวันที่เลือก (ถ้าไม่มีกะเลย ถอยหลังหาไม่เกิน 7 วัน เพื่อให้ตัวอย่างมีข้อมูลโชว์เสมอ) ── */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [plRes, empRes] = await Promise.all([
        supabase.from('production_lines').select('id, name, parent_line_name'),
        supabase.from('employees').select('id, line_id').eq('is_active', true),
      ]);
      const parentOf = {}; (plRes.data || []).forEach(l => { if (l.parent_line_name) parentOf[l.name] = l.parent_line_name; });
      const topOf = (n) => { let cur = n, g = 0; while (parentOf[cur] && g++ < 6) cur = parentOf[cur]; return cur; };
      const lineOfId = {}; (plRes.data || []).forEach(l => { lineOfId[l.id] = l.name; });

      let d = date, sessions = null;
      for (let i = 0; i < 8; i++) {
        const { data } = await supabaseDR.from('production_sessions')
          .select('id, line_name, shift, status, oee, shift_min').eq('work_date', d);
        if (data?.length) { sessions = data; break; }
        d = shiftDate(d, -1);
      }
      if (!sessions) { setBaseLines([]); setUsedDate(null); setLoading(false); return; }
      setUsedDate(d);

      const out = {};
      const ensure = (ln) => (out[ln] || (out[ln] = {
        line: ln, actual: 0, target: 0, dtMin: 0, plannedMin: 0, ng: 0,
        present: 0, head: 0, sessions: 0, oeeWSum: 0, oeeWLoad: 0, oeeSum: 0, oeeN: 0,
      }));

      // คนเข้างานของวันนั้น (พนักงานผูกไลน์แม่ 100% ตามกฎกำลังคน — roll up ให้ไลน์บนสุดอยู่ดี)
      const { data: logs } = await supabase.from('daily_production_logs')
        .select('employee_id, is_present').eq('work_date', d);
      const presentSet = new Set((logs || []).filter(l => l.is_present).map(l => l.employee_id));
      (empRes.data || []).forEach(e => {
        const ln = lineOfId[e.line_id]; if (!ln) return;
        const o = ensure(topOf(ln)); o.head++; if (presentSet.has(e.id)) o.present++;
      });

      const sessIds = sessions.map(s => s.id);
      const [{ data: orders }, { data: dts }, { data: defs }, { data: prods }] = await Promise.all([
        supabaseDR.from('prod_orders').select('session_id, status, qty, qty_ok, qty_actual, qty_target, mat_no').in('session_id', sessIds),
        supabaseDR.from('downtime_logs').select('session_id, duration_min, started_at, ended_at, dr_downtime_types(category)').in('session_id', sessIds),
        supabaseDR.from('defect_logs').select('session_id, qty_ng, qty_suspect').in('session_id', sessIds),
        supabaseDR.from('dr_products').select('mat_no, pair_mat_no'),
      ]);
      const ngBySess = {}; (defs || []).forEach(x => { ngBySess[x.session_id] = (ngBySess[x.session_id] || 0) + (Number(x.qty_ng) || 0) + (Number(x.qty_suspect) || 0); });
      const pairMap = {}; (prods || []).forEach(p => { if (p.pair_mat_no) pairMap[p.mat_no] = p.pair_mat_no; });
      const ordBySess = {}; (orders || []).forEach(o => { (ordBySess[o.session_id] ||= []).push(o); });
      const dtBySess = {}; (dts || []).forEach(x => { (dtBySess[x.session_id] ||= []).push(x); });

      sessions.forEach(s => {
        const o = ensure(topOf(s.line_name));
        o.sessions++;
        const os = ordBySess[s.id] || [];
        // นับงานคู่ RH/LH เป็น 1 คู่/stroke ตามกฎภาพใหญ่ (pairAwareTotal)
        const perMat = {};
        os.forEach(od => {
          if (!od.mat_no) return;
          const e = perMat[od.mat_no] || (perMat[od.mat_no] = { mat_no: od.mat_no, target: 0, produced: 0 });
          e.target += od.qty_target ?? od.qty ?? 0;
          e.produced += od.status === 'confirmed' ? (od.qty_ok ?? od.qty ?? 0) : (od.qty_actual ?? 0);
        });
        const nullOs = os.filter(od => !od.mat_no);
        const pt = pairAwareTotal(Object.values(perMat), m => pairMap[m] || null);
        o.target += pt.target + nullOs.reduce((a, od) => a + (od.qty_target ?? od.qty ?? 0), 0);
        o.actual += pt.produced + nullOs.reduce((a, od) => a + (od.status === 'confirmed' ? (od.qty_ok ?? od.qty ?? 0) : (od.qty_actual ?? 0)), 0);

        let planned = 0;
        (dtBySess[s.id] || []).forEach(x => {
          const mins = x.duration_min != null ? (Number(x.duration_min) || 0)
            : (x.started_at && x.ended_at ? Math.max(0, (new Date(x.ended_at) - new Date(x.started_at)) / 60000) : 0);
          if (x.dr_downtime_types?.category === 'planned') planned += mins; else o.dtMin += mins;
        });
        o.plannedMin += planned;
        o.ng += ngBySess[s.id] || 0;              // NG ยึด defect_logs เสมอ (คอลัมน์ session เป็น rollup)
        if (s.oee != null) {
          const w = Math.max(0, (s.shift_min || SHIFT_MIN_FALLBACK) - planned);
          o.oeeWSum += Number(s.oee) * w; o.oeeWLoad += w;
          o.oeeSum += Number(s.oee); o.oeeN++;
        }
      });

      const rows = Object.values(out)
        .filter(o => o.sessions > 0 || o.target > 0)
        .map(o => ({
          line: o.line,
          actual: Math.round(o.actual), target: Math.round(o.target),
          dtMin: Math.round(o.dtMin), ng: Math.round(o.ng),
          present: o.present, head: o.head,
          // น้ำหนักถ่วง OEE = เวลารับภาระ (นาที) — ใช้ต่อทั้งฝั่งจำลอง
          w: Math.round(o.oeeWLoad || (o.sessions * SHIFT_MIN_FALLBACK)),
          oee: o.oeeWLoad > 0 ? +(o.oeeWSum / o.oeeWLoad).toFixed(1) : (o.oeeN ? +(o.oeeSum / o.oeeN).toFixed(1) : null),
        }))
        .sort((a, b) => b.target - a.target);
      setBaseLines(rows);
    } catch {
      setBaseLines([]); setUsedDate(null);
    } finally { setLoading(false); }
  }, [date]);
  useEffect(() => { load(); }, [load]);

  /* ── ปั้นข้อมูลรายโรงงานจากฐานจริง ─────────────────────────────────────────────────── */
  const plants = useMemo(() => {
    const dk = usedDate || date;
    return PLANTS.map(p => {
      let lines;
      if (p.real) {
        lines = baseLines.map(l => ({ ...l }));
      } else {
        const keep = baseLines.filter((l, i) => i < 3 || rnd(`${p.key}|${l.line}|keep`) < p.keep);
        lines = keep.map(l => {
          const ratio = l.target > 0 ? l.actual / l.target : 0;
          const nRatio = clamp(ratio * jit(`${p.key}|${l.line}|r|${dk}`, 0.28) + p.oeeD / 260, 0.35, 1.12);
          const target = Math.max(0, Math.round(l.target * p.qtyF * jit(`${p.key}|${l.line}|t|${dk}`, 0.34)));
          const head = Math.max(0, Math.round(l.head * p.qtyF * jit(`${p.key}|${l.line}|h`, 0.2)));
          return {
            line: l.line,
            target,
            actual: Math.round(target * nRatio),
            oee: l.oee == null ? null : +clamp(l.oee + p.oeeD + (rnd(`${p.key}|${l.line}|o|${dk}`) - 0.5) * 13, 8, 97).toFixed(1),
            dtMin: Math.round(l.dtMin * p.dtF * jit(`${p.key}|${l.line}|d|${dk}`, 0.7)),
            ng: Math.round(l.ng * p.ngF * jit(`${p.key}|${l.line}|n|${dk}`, 0.8)),
            head,
            present: Math.min(head, Math.round(head * clamp(0.94 * jit(`${p.key}|${l.line}|p|${dk}`, 0.12), 0.7, 1))),
            w: Math.max(1, Math.round(l.w * p.qtyF)),
          };
        });
      }
      const sum = (f) => lines.reduce((a, l) => a + (f(l) || 0), 0);
      const target = sum(l => l.target), actual = sum(l => l.actual);
      const oee = wavg(lines, l => l.oee, l => l.w);
      const pct = target > 0 ? +(actual / target * 100).toFixed(1) : null;
      const status = (pct != null && pct < 80) || (oee != null && oee < 65) ? 'bad'
        : (pct != null && pct < 95) || (oee != null && oee < 80) ? 'ok' : 'good';
      // ไลน์ที่ต้องดูแลก่อน = ขาดเป้ามากสุด (ชิ้น)
      const worst = [...lines].filter(l => l.target > 0).sort((a, b) => (b.target - b.actual) - (a.target - a.actual))[0] || null;
      return {
        ...p, lines, target, actual, pct, oee, status, worst,
        dtMin: sum(l => l.dtMin), ng: sum(l => l.ng),
        present: sum(l => l.present), head: sum(l => l.head),
      };
    });
  }, [baseLines, usedDate, date]);

  const group = useMemo(() => {
    const allLines = plants.flatMap(p => p.lines.map(l => ({ ...l, plant: p })));
    const sum = (f) => plants.reduce((a, p) => a + (f(p) || 0), 0);
    const target = sum(p => p.target), actual = sum(p => p.actual);
    return {
      target, actual,
      pct: target > 0 ? +(actual / target * 100).toFixed(1) : null,
      oee: wavg(allLines, l => l.oee, l => l.w),
      dtMin: sum(p => p.dtMin), ng: sum(p => p.ng),
      present: sum(p => p.present), head: sum(p => p.head),
      lineCount: allLines.length,
      // ไลน์ที่ต้องดูแลด่วนทั้งกลุ่ม — ขาดเป้ามากสุด (ตัดไลน์ที่ไม่มีเป้าออก)
      hotspots: allLines.filter(l => l.target > 0 && l.actual < l.target)
        .sort((a, b) => (b.target - b.actual) - (a.target - a.actual)).slice(0, 8),
    };
  }, [plants]);

  const maxTarget = Math.max(1, ...plants.map(p => p.target));
  const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 14 };
  const TH = { padding: '7px 8px', fontSize: 12, color: 'var(--muted)', fontWeight: 700, textAlign: 'left', whiteSpace: 'nowrap' };
  const THR = { ...TH, textAlign: 'right' };
  const TD = { padding: '7px 8px', fontSize: 13, borderTop: '1px solid var(--border)' };
  const TDR = { ...TD, textAlign: 'right' };

  return (
    <div style={{ maxWidth: 'min(97vw, 2200px)', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── หัวหน้า + ตัวเลือกวัน (paddingRight กัน 🔔 ทับ) ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between', paddingRight: 52 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: isMobile ? 19 : 23, display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            🏢 ภาพรวมกลุ่มโรงงาน
            <span style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', border: '1px dashed #f59e0b', borderRadius: 999, padding: '2px 10px' }}>
              🧪 MOCKUP · ตัวอย่างหน้าจอ
            </span>
          </h2>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            เทียบผลการผลิต {PLANTS.length} โรงงานในกลุ่ม · {fmtThaiDate(usedDate || date)}
            {usedDate && usedDate !== date && <span style={{ color: '#f59e0b' }}> (ไม่มีข้อมูลวันที่เลือก — ถอยไปวันงานล่าสุดที่มีข้อมูล)</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className="tbtn" onClick={() => setDate(shiftDate(date, -1))} style={btn}>◀</button>
          <input type="date" value={date} max={getWorkDate()} onChange={e => setDate(e.target.value)}
            style={{ width: 148, padding: '7px 9px', fontSize: 13, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, color: 'var(--text)' }} />
          <button className="tbtn" onClick={() => setDate(shiftDate(date, 1))} disabled={date >= getWorkDate()} style={{ ...btn, opacity: date >= getWorkDate() ? 0.4 : 1 }}>▶</button>
          <button onClick={load} style={{ ...btn, width: 'auto', padding: '7px 12px', fontSize: 13 }}>🔄 รีเฟรช</button>
        </div>
      </div>

      {/* ── แถบอธิบายว่าอันไหนจริง อันไหนจำลอง (ห้ามให้ผู้บริหารเข้าใจผิดว่ามีโรงงานจริงในระบบแล้ว) ── */}
      <div style={{ ...card, borderStyle: 'dashed', borderColor: '#f59e0b', background: 'rgba(245,158,11,0.07)', fontSize: 13, lineHeight: 1.7 }}>
        <b style={{ color: '#f59e0b' }}>นี่คือหน้าจอตัวอย่าง (mockup) เพื่อดูว่า “ระบบรองรับหลายโรงงาน” จะหน้าตาแบบไหน</b><br />
        • <b>{PLANTS[0].code} {PLANTS[0].name}</b> = <b style={{ color: '#22c55e' }}>ข้อมูลจริง</b>จากฐานข้อมูลปัจจุบัน (กะที่ปิดแล้วของวันที่เลือก)<br />
        • โรงงานที่เหลือ = <b style={{ color: '#f59e0b' }}>ตัวเลขจำลอง</b> ที่ปั้นจากข้อมูลจริงชุดเดียวกัน (ตัวคูณคงที่ต่อโรงงาน + สุ่มแบบ seeded ให้ตัวเลขนิ่ง ไม่ดิ้นทุกครั้งที่รีเฟรช)<br />
        • หน้านี้ <b>ไม่เขียนฐานข้อมูล</b> และยังไม่มีตาราง/ระบบแยกโรงงานจริง — ดูสรุป “ถ้าทำจริงต้องทำอะไร” ท้ายหน้า
      </div>

      {loading && <div style={{ ...card, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>กำลังโหลดข้อมูล...</div>}
      {!loading && !baseLines.length && (
        <div style={{ ...card, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
          ไม่พบข้อมูลการผลิตย้อนหลัง 7 วันจากวันที่เลือก — ลองเลือกวันอื่น
        </div>
      )}

      {!loading && !!baseLines.length && (<>

        {/* ── KPI รวมทั้งกลุ่ม ── */}
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))' }}>
          <Kpi label="🏭 โรงงานในกลุ่ม" value={PLANTS.length} sub={`${group.lineCount} ไลน์ผลิตรวม`} />
          <Kpi label="📦 ผลิตรวมทั้งกลุ่ม" value={fmtNum(group.actual)} color={pctCol(group.pct)}
            sub={`เป้า ${fmtNum(group.target)} · ${group.pct == null ? '—' : group.pct + '%'}`} />
          <Kpi label="⚙️ OEE กลุ่ม (ถ่วงน้ำหนัก)" value={group.oee == null ? '—' : group.oee + '%'} color={oeeCol(group.oee)}
            sub="ถ่วงด้วยเวลารับภาระของแต่ละไลน์" />
          <Kpi label="🔧 Downtime นอกแผน" value={fmtNum(group.dtMin)} sub="นาที (รวมทุกโรง)" color={group.dtMin > 0 ? '#f59e0b' : undefined} />
          <Kpi label="🚫 ของเสียรวม" value={fmtNum(group.ng)} sub="ชิ้น (NG + สงสัย)" color={group.ng > 0 ? '#ef4444' : undefined} />
          <Kpi label="👷 คนเข้างาน" value={`${fmtNum(group.present)}/${fmtNum(group.head)}`}
            sub={group.head ? `${Math.round(group.present / group.head * 100)}% ของกำลังคน` : '—'} />
        </div>

        {/* ── เทียบโรงงาน (แถบเรียงอันดับ) ── */}
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>📊 เทียบผลการผลิตรายโรงงาน</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[...plants].sort((a, b) => (b.oee ?? -1) - (a.oee ?? -1)).map((p, i) => (
              <div key={p.key} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '210px 1fr 120px', gap: 10, alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, minWidth: 0 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)', width: 18 }}>#{i + 1}</span>
                  <span>{p.flag}</span>
                  <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  {p.real
                    ? <span style={{ fontSize: 10, color: '#22c55e', border: '1px solid #22c55e', borderRadius: 4, padding: '0 5px', whiteSpace: 'nowrap' }}>จริง</span>
                    : <span style={{ fontSize: 10, color: '#f59e0b', border: '1px dashed #f59e0b', borderRadius: 4, padding: '0 5px', whiteSpace: 'nowrap' }}>จำลอง</span>}
                </div>
                <div style={{ height: 22, background: 'var(--bg3)', borderRadius: 5, overflow: 'hidden', position: 'relative' }}>
                  <div style={{ width: `${clamp(p.target / maxTarget * 100, 2, 100)}%`, height: '100%', background: 'var(--bg2)', position: 'absolute', inset: 0, borderRight: '1px dashed var(--border2)' }} />
                  <div style={{ width: `${clamp(p.actual / maxTarget * 100, 0, 100)}%`, height: '100%', background: pctCol(p.pct), opacity: 0.85, position: 'relative' }} />
                  <span style={{ position: 'absolute', left: 8, top: 0, lineHeight: '22px', fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
                    {fmtNum(p.actual)} / {fmtNum(p.target)} ชิ้น
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: isMobile ? 'flex-start' : 'flex-end', fontSize: 13 }}>
                  <span style={{ color: pctCol(p.pct), fontWeight: 700 }}>{p.pct == null ? '—' : p.pct + '%'}</span>
                  <span style={{ color: oeeCol(p.oee), fontWeight: 700 }}>OEE {p.oee == null ? '—' : p.oee}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 9 }}>
            แถบทึบ = ผลิตได้จริง · พื้นจาง = เป้าของวัน (สเกลเทียบโรงงานที่เป้าสูงสุด) · เรียงตาม OEE
          </div>
        </div>

        {/* ── การ์ดรายโรงงาน (กดกางดูรายไลน์) ── */}
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(min(330px, 100%), 1fr))', alignContent: 'start' }}>
          {plants.map(p => {
            const stCol = p.status === 'bad' ? '#ef4444' : p.status === 'ok' ? '#f59e0b' : '#22c55e';
            const open = expanded === p.key;
            return (
              <div key={p.key} style={{ display: 'contents' }}>
                <div className="kpi-lift" style={{
                  ...card, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                  minHeight: 232, borderLeft: `4px solid ${stCol}`,
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: 20 }}>{p.flag}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.code} · {p.region}</div>
                      </div>
                      {p.real
                        ? <span style={{ fontSize: 10, color: '#22c55e', border: '1px solid #22c55e', borderRadius: 4, padding: '1px 6px' }}>ข้อมูลจริง</span>
                        : <span style={{ fontSize: 10, color: '#f59e0b', border: '1px dashed #f59e0b', borderRadius: 4, padding: '1px 6px' }}>จำลอง</span>}
                    </div>

                    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', margin: '10px 0 8px' }}>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>OEE</div>
                        <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, color: oeeCol(p.oee), fontVariantNumeric: 'tabular-nums' }}>
                          {p.oee == null ? '—' : p.oee}<span style={{ fontSize: 15 }}>%</span>
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>ผลิต / เป้า</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: pctCol(p.pct), fontVariantNumeric: 'tabular-nums' }}>
                          {fmtNum(p.actual)} / {fmtNum(p.target)} <span style={{ fontSize: 12 }}>({p.pct == null ? '—' : p.pct + '%'})</span>
                        </div>
                        <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden', marginTop: 5 }}>
                          <div style={{ width: `${clamp(p.pct ?? 0, 0, 100)}%`, height: '100%', background: pctCol(p.pct) }} />
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, fontSize: 12 }}>
                      <Mini label="🔧 DT" value={`${fmtNum(p.dtMin)} น.`} color={p.dtMin > 0 ? '#f59e0b' : undefined} />
                      <Mini label="🚫 NG" value={`${fmtNum(p.ng)}`} color={p.ng > 0 ? '#ef4444' : undefined} />
                      <Mini label="👷 คน" value={`${fmtNum(p.present)}/${fmtNum(p.head)}`} />
                    </div>

                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 9, minHeight: 34 }}>
                      {p.worst && p.worst.target > p.worst.actual
                        ? <>⚠️ ไลน์ที่ตามหลังมากสุด: <b style={{ color: 'var(--text)' }}>{p.worst.line}</b> ขาด {fmtNum(p.worst.target - p.worst.actual)} ชิ้น</>
                        : <>✅ ทุกไลน์ทำได้ตามเป้า</>}
                    </div>
                  </div>

                  <button onClick={() => setExpanded(open ? null : p.key)}
                    style={{ ...btn, width: '100%', padding: '7px 10px', fontSize: 13, marginTop: 8 }}>
                    {open ? '▲ ปิดรายไลน์' : `▾ ดูรายไลน์ (${p.lines.length})`}
                  </button>
                </div>

                {/* แถวขยาย = panel เต็มแถว ตาม convention การ์ด grid (ไม่ปนใน grid การ์ดหลัก) */}
                {open && (
                  <div style={{
                    gridColumn: '1 / -1', border: '1px dashed var(--border2)', borderRadius: 'var(--radius-lg)',
                    padding: 12, background: 'var(--bg2)',
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                      {p.flag} {p.name} — รายไลน์ ({p.lines.length}) · {fmtThaiDate(usedDate || date)}
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums', minWidth: 620 }}>
                        <thead><tr>
                          <th style={TH}>ไลน์</th><th style={THR}>เป้า</th><th style={THR}>ผลิตได้</th>
                          <th style={THR}>%</th><th style={THR}>OEE</th><th style={THR}>DT (น.)</th>
                          <th style={THR}>NG</th><th style={THR}>คน</th>
                        </tr></thead>
                        <tbody>
                          {[...p.lines].sort((a, b) => (a.target - a.actual < b.target - b.actual ? 1 : -1)).map(l => {
                            const lp = l.target > 0 ? +(l.actual / l.target * 100).toFixed(1) : null;
                            return (
                              <tr key={l.line}>
                                <td style={TD}>{l.line}</td>
                                <td style={TDR}>{fmtNum(l.target)}</td>
                                <td style={TDR}>{fmtNum(l.actual)}</td>
                                <td style={{ ...TDR, color: pctCol(lp), fontWeight: 700 }}>{lp == null ? '—' : lp + '%'}</td>
                                <td style={{ ...TDR, color: oeeCol(l.oee), fontWeight: 700 }}>{l.oee == null ? '—' : l.oee}</td>
                                <td style={{ ...TDR, color: l.dtMin > 0 ? '#f59e0b' : 'var(--muted)' }}>{fmtNum(l.dtMin)}</td>
                                <td style={{ ...TDR, color: l.ng > 0 ? '#ef4444' : 'var(--muted)' }}>{fmtNum(l.ng)}</td>
                                <td style={TDR}>{fmtNum(l.present)}/{fmtNum(l.head)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── ไลน์ที่ต้องดูแลด่วนทั้งกลุ่ม (คุณค่าหลักของจอผู้บริหาร: เห็นข้ามโรงงานในตารางเดียว) ── */}
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>🚨 ไลน์ที่ต้องดูแลด่วน — ทั้งกลุ่ม</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>เรียงตามจำนวนชิ้นที่ขาดเป้า (ข้ามโรงงาน)</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums', minWidth: 640 }}>
              <thead><tr>
                <th style={TH}>โรงงาน</th><th style={TH}>ไลน์</th><th style={THR}>ขาดเป้า</th>
                <th style={THR}>ผลิต/เป้า</th><th style={THR}>OEE</th><th style={THR}>DT (น.)</th><th style={THR}>NG</th>
              </tr></thead>
              <tbody>
                {group.hotspots.map((l, i) => {
                  const lp = +(l.actual / l.target * 100).toFixed(1);
                  return (
                    <tr key={`${l.plant.key}-${l.line}-${i}`}>
                      <td style={TD}>
                        <span style={{ marginRight: 5 }}>{l.plant.flag}</span>{l.plant.name}
                        {!l.plant.real && <span style={{ fontSize: 10, color: '#f59e0b', marginLeft: 5 }}>(จำลอง)</span>}
                      </td>
                      <td style={{ ...TD, fontWeight: 700 }}>{l.line}</td>
                      <td style={{ ...TDR, color: '#ef4444', fontWeight: 700 }}>-{fmtNum(l.target - l.actual)}</td>
                      <td style={{ ...TDR, color: pctCol(lp) }}>{fmtNum(l.actual)}/{fmtNum(l.target)} ({lp}%)</td>
                      <td style={{ ...TDR, color: oeeCol(l.oee), fontWeight: 700 }}>{l.oee == null ? '—' : l.oee}</td>
                      <td style={{ ...TDR, color: l.dtMin > 0 ? '#f59e0b' : 'var(--muted)' }}>{fmtNum(l.dtMin)}</td>
                      <td style={{ ...TDR, color: l.ng > 0 ? '#ef4444' : 'var(--muted)' }}>{fmtNum(l.ng)}</td>
                    </tr>
                  );
                })}
                {!group.hotspots.length && <tr><td style={TD} colSpan={7}>✅ ทุกไลน์ทำได้ตามเป้า</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </>)}

      {/* ── ถ้าจะทำจริงต้องทำอะไร (ตอบคำถามผู้บริหารในหน้าเดียวกัน) ── */}
      <div style={card}>
        <button onClick={() => setShowHow(v => !v)} style={{
          background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', padding: 0,
          fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
        }}>
          <span>{showHow ? '▼' : '▶'}</span> 🛠️ ถ้าจะรองรับหลายโรงงานจริง ต้องทำอะไรบ้าง
          <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>(สรุปเชิงเทคนิค)</span>
        </button>
        {showHow && (
          <div style={{ fontSize: 13, lineHeight: 1.85, marginTop: 10, color: 'var(--text2)' }}>
            <b style={{ color: 'var(--text)' }}>ทำได้ครับ — โครงระบบปัจจุบันรองรับได้โดยไม่ต้องเขียนใหม่</b> เพราะทุกอย่างผูกกับ “ไลน์ / ส่วนงาน” อยู่แล้ว
            แค่เพิ่มชั้น “โรงงาน (plant)” ทับข้างบน · งานหลักที่ต้องทำ:
            <ol style={{ margin: '8px 0 0', paddingLeft: 22 }}>
              <li><b>เพิ่มตาราง <code>plants</code> + คอลัมน์ <code>plant_id</code></b> ที่ต้นทางของลำดับชั้น (<code>org_nodes</code>, <code>production_lines</code>, <code>profiles</code>) — ตารางข้อมูลรายวัน (production_sessions / prod_orders / downtime / defect) <b>ไม่ต้องแก้</b> เพราะสืบโรงงานผ่านไลน์ได้</li>
              <li><b>ขยาย scope ของ user</b> จาก “ส่วนงาน (sections)” เป็น “โรงงาน → ส่วนงาน” — ต่อยอด <code>effectiveSections()</code> เดิม ไม่ต้องรื้อกลไกสิทธิ์</li>
              <li><b>Master data ที่ต้องแยกต่อโรงงาน:</b> ปฏิทินบริษัท · นโยบายเวลาพัก · เป้า OEE · ทะเบียนเอกสาร (เลขฟอร์มคนละชุด) · ห้อง Telegram แจ้งเตือน</li>
              <li><b>2 Supabase project ปัจจุบัน (Main + DR) ใช้ต่อได้</b> — แยกด้วย <code>plant_id</code> ในโครงเดิม ไม่ต้องแตก project ต่อโรงงาน (ถ้าโรงงานต่างประเทศต้องเก็บข้อมูลในประเทศตัวเอง ค่อยแยก project แล้วรวมที่ชั้นรายงาน)</li>
              <li><b>จอนี้ (Group Overview)</b> = ชั้นรายงานรวม อ่านอย่างเดียว — ตัวเลขทุกตัวใช้สูตรกลางเดิม (OEE ถ่วงน้ำหนัก, นับงานคู่ RH/LH เป็น 1 stroke) จึงตรงกับที่แต่ละโรงเห็นในหน้าตัวเอง</li>
            </ol>
            <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--bg3)', borderRadius: 6, fontSize: 12.5 }}>
              <b>ข้อควรระวัง:</b> แต่ละโรงงานต้องกรอกข้อมูลด้วย “นิยามเดียวกัน” (เช่น downtime อะไรนับเป็นในแผน/นอกแผน, เป้ากะมาจากไหน)
              ไม่งั้นตัวเลขเทียบข้ามโรงไม่ได้ — ส่วนนี้เป็นงานวางมาตรฐาน ไม่ใช่งานเขียนโปรแกรม
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const btn = {
  padding: '7px 10px', fontSize: 14, background: 'var(--bg3)', border: '1px solid var(--border2)',
  borderRadius: 8, color: 'var(--text)', cursor: 'pointer', fontWeight: 600,
};

function Kpi({ label, value, sub, color }) {
  return (
    <div className="kpi-lift" style={{
      background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
      padding: '11px 13px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 88,
    }}>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.15, color: color || 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', minHeight: 15 }}>{sub || ' '}</div>
    </div>
  );
}

function Mini({ label, value, color }) {
  return (
    <div style={{ background: 'var(--bg3)', borderRadius: 6, padding: '5px 7px' }}>
      <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: color || 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}
