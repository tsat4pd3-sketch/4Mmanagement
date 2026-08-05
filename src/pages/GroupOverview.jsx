import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { wavg } from '../utils/oee';
import { pairAwareTotal } from '../utils/pairTotals';
import useIsMobile from '../utils/useIsMobile';
import ThailandZoneMap from '../components/ThailandZoneMap';

/* ══ 🏢 ภาพรวมกลุ่มบริษัท TSG (Group Overview) — MOCKUP หลายโรงงาน · 2026-08-05 ══════════
   โจทย์ผู้บริหาร: "ระบบนี้ตอนนี้คุมโรงงานเราโรงเดียว ถ้าจะดูภาพรวมหลายบริษัทในกลุ่มทำได้มั้ย"
   หน้านี้ = ตัวอย่างหน้าจอเพื่อตอบคำถามนั้น (ยังไม่ใช่ระบบ multi-plant จริง)

   โครงองค์กร 3 ชั้น (drill-down):  TSG → กลุ่มธุรกิจ → บริษัท → ไลน์ผลิต
     • TSAT4 (Automotive Metal Forming) = บริษัทเรา → ใช้ "ข้อมูลจริง" จากฐานข้อมูลปัจจุบัน
     • บริษัทอื่น = ปั้นจากข้อมูลจริงชุดเดียวกันด้วยตัวคูณ + seeded RNG (deterministic — ตัวเลขไม่ดิ้นทุกครั้งที่รีเฟรช)
   ⚠️ ไม่เขียน DB ใดๆ · ไม่มี schema ของ plant/company จริง — ข้อมูลจำลองอยู่ในหน่วยความจำหน้านี้เท่านั้น

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

/* seeded RNG — ตัวเลขจำลองต้องคงที่ต่อ (บริษัท × ไลน์ × วัน) ไม่งั้นรีเฟรชทีตัวเลขดิ้นที = ดูไม่น่าเชื่อถือ */
function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const rnd = (str) => (hash32(str) % 100000) / 100000;                 // 0..1
const jit = (str, spread) => 1 + (rnd(str) - 0.5) * spread;           // 1 ± spread/2

/* ── โครงองค์กร TSG (mockup) ────────────────────────────────────────────────────────────
   ⚙️ แก้รายชื่อกลุ่มธุรกิจ/บริษัทได้ที่ const นี้จุดเดียว — ที่เหลือ (การ์ด/อันดับ/ตาราง) ตามให้เอง
   real: true = ดึงข้อมูลจริง (มีได้ตัวเดียว = TSAT4) · ที่เหลือคือ profile การจำลอง:
     qtyF ตัวคูณปริมาณผลิต (ขนาดบริษัท) · oeeD ส่วนต่าง OEE เป็นจุด · dtF ตัวคูณ downtime
     ngF ตัวคูณของเสีย · keep สัดส่วนไลน์ที่บริษัทนั้นมี
   ⚠️ ชื่อบริษัทในกลุ่ม Plastech / Mocy เป็นตัวอย่าง (ยังไม่ได้รับรายชื่อจริง) — แก้ได้ที่นี่ */
const ORG = {
  code: 'TSG', name: 'Thai Summit Group',
  groups: [
    {
      key: 'amf', name: 'Automotive Metal Forming', short: 'Metal Forming', icon: '🔩',
      desc: 'ชิ้นส่วนโลหะยานยนต์ — ปั๊มขึ้นรูป / เชื่อมประกอบ',
      companies: [
        { key: 'tsat1', code: 'TSAT1', name: 'Thai Summit Autoparts 1', region: 'บางปู · สมุทรปราการ', flag: '🇹🇭', zone: 'bangna', lat: 13.53, lon: 100.64, qtyF: 1.28, oeeD: 2.5, dtF: 0.85, ngF: 0.8, keep: 0.9 },
        { key: 'tsat4', code: 'TSAT4', name: 'Thai Summit Autoparts 4 (บริษัทเรา)', region: 'บ้านโพธิ์ · ฉะเชิงเทรา', flag: '🇹🇭', zone: 'bangna', lat: 13.58, lon: 101.08, real: true },
        { key: 'tsla', code: 'TSLA', name: 'Thai Summit Laemchabang', region: 'แหลมฉบัง · ชลบุรี', flag: '🇹🇭', zone: 'east', lat: 13.08, lon: 100.92, qtyF: 0.92, oeeD: -4.5, dtF: 1.3, ngF: 1.4, keep: 0.8 },
        { key: 'tsesa', code: 'TSESA', name: 'Thai Summit Eastern Seaboard', region: 'ปลวกแดง · ระยอง', flag: '🇹🇭', zone: 'east', lat: 12.92, lon: 101.14, qtyF: 1.05, oeeD: -1.5, dtF: 1.1, ngF: 1.1, keep: 0.85 },
        { key: 'tsrf', code: 'TSRF', name: 'Thai Summit Rayong Forming', region: 'นิคมฯ มาบตาพุด · ระยอง', flag: '🇹🇭', zone: 'east', lat: 12.70, lon: 101.32, qtyF: 0.7, oeeD: -8.5, dtF: 1.6, ngF: 1.8, keep: 0.6 },
      ],
    },
    {
      key: 'plastech', name: 'Plastech', short: 'Plastech', icon: '🧩',
      desc: 'ชิ้นส่วนพลาสติก — ฉีด / เป่า / พ่นสี',
      lineAlias: ['INJECTION 1', 'INJECTION 2', 'INJECTION 3', 'BLOW MOLD 1', 'PAINT LINE 1', 'ASSY PLASTIC 1', 'ASSY PLASTIC 2', 'TRIM & WELD'],
      companies: [
        { key: 'ptc1', code: 'TSPT1', name: 'Thai Summit Plastech 1', region: 'บางพลี · สมุทรปราการ', flag: '🇹🇭', zone: 'bangna', lat: 13.61, lon: 100.75, qtyF: 1.1, oeeD: 1.5, dtF: 0.9, ngF: 1.2, keep: 0.75 },
        { key: 'ptc2', code: 'TSPT2', name: 'Thai Summit Plastech 2', region: 'ปลวกแดง · ระยอง', flag: '🇹🇭', zone: 'east', lat: 12.84, lon: 101.22, qtyF: 0.85, oeeD: -3.5, dtF: 1.25, ngF: 1.5, keep: 0.7 },
        { key: 'ptcvn', code: 'TSPT-VN', name: 'Thai Summit Plastech Vietnam', region: 'Hanoi · เวียดนาม', flag: '🇻🇳', zone: 'oversea', qtyF: 0.55, oeeD: -6.5, dtF: 1.4, ngF: 1.6, keep: 0.5 },
      ],
    },
    {
      key: 'mocy', name: 'Mocy (Motorcycle)', short: 'Mocy', icon: '🏍️',
      desc: 'ชิ้นส่วนรถจักรยานยนต์',
      lineAlias: ['MC FRAME 1', 'MC FUEL TANK', 'MC MUFFLER 1', 'MC SWING ARM', 'MC HANDLE', 'MC STEP', 'MC COVER ASSY'],
      companies: [
        { key: 'mocy1', code: 'TSMC1', name: 'Thai Summit Mocy 1', region: 'บางนา · กรุงเทพฯ', flag: '🇹🇭', zone: 'bangna', lat: 13.66, lon: 100.63, qtyF: 0.95, oeeD: 0.5, dtF: 1.0, ngF: 1.0, keep: 0.7 },
        { key: 'mocy2', code: 'TSMC2', name: 'Thai Summit Mocy 2', region: 'บางบ่อ · สมุทรปราการ', flag: '🇹🇭', zone: 'bangna', lat: 13.50, lon: 100.90, qtyF: 0.6, oeeD: -5.5, dtF: 1.35, ngF: 1.45, keep: 0.55 },
        { key: 'mocyid', code: 'TSMC-ID', name: 'Thai Summit Mocy Indonesia', region: 'Karawang · อินโดนีเซีย', flag: '🇮🇩', zone: 'oversea', qtyF: 0.5, oeeD: -9.5, dtF: 1.7, ngF: 1.9, keep: 0.45 },
      ],
    },
  ],
};

/* ── โซนพื้นที่ (แกนที่ 2 — ตัดขวางกลุ่มธุรกิจ) · onMap=false คือไม่ได้อยู่บนแผนที่ภาคกลาง ──
   หมุดบนแผนที่ใช้ lat/lon จริงของบริษัท → กรอบโซนคำนวณจากหมุด (ดู ThailandZoneMap) */
const ZONES = [
  { key: 'bangna', name: 'โซนบางนา', icon: '🏙️', color: '#38bdf8', onMap: true, desc: 'บางนา-ตราด · สมุทรปราการ · ฉะเชิงเทรา' },
  { key: 'east', name: 'โซนตะวันออก', icon: '🌊', color: '#f59e0b', onMap: true, desc: 'ชลบุรี · แหลมฉบัง · ระยอง (Eastern Seaboard)' },
  { key: 'oversea', name: 'โซนต่างประเทศ', icon: '🌏', color: '#a78bfa', onMap: false, desc: 'เวียดนาม · อินโดนีเซีย' },
];

const SHIFT_MIN_FALLBACK = 570;

export default function GroupOverview() {
  const isMobile = useIsMobile();
  const [date, setDate] = useState(reviewDefaultDate);
  const [usedDate, setUsedDate] = useState(null);      // วันที่ที่มีข้อมูลจริง (อาจถอยหลังจาก date)
  const [baseLines, setBaseLines] = useState([]);      // aggregate จริงต่อไลน์บนสุด (= ฐานของ TSAT4)
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState({ axis: 'map', node: null, comp: null });  // axis: map=โซนพื้นที่ · biz=กลุ่มธุรกิจ · node/comp=null คือระดับ TSG
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

      // คนเข้างานของวันนั้น (พนักงานผูกไลน์แม่ตามกฎกำลังคน — roll up ให้ไลน์บนสุดอยู่ดี)
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

  /* ── ปั้นต้นไม้องค์กร: TSG → กลุ่มธุรกิจ → บริษัท → ไลน์ (จากฐานจริงชุดเดียว) ───────── */
  const tree = useMemo(() => {
    const dk = usedDate || date;

    const aggregate = (lines) => {
      const sum = (f) => lines.reduce((a, l) => a + (f(l) || 0), 0);
      const target = sum(l => l.target), actual = sum(l => l.actual);
      const oee = wavg(lines, l => l.oee, l => l.w);
      const pct = target > 0 ? +(actual / target * 100).toFixed(1) : null;
      return {
        target, actual, pct, oee,
        dtMin: sum(l => l.dtMin), ng: sum(l => l.ng),
        present: sum(l => l.present), head: sum(l => l.head),
        status: (pct != null && pct < 80) || (oee != null && oee < 65) ? 'bad'
          : (pct != null && pct < 95) || (oee != null && oee < 80) ? 'ok' : 'good',
      };
    };

    // สร้างบริษัททั้งหมดครั้งเดียว แล้วค่อยจัดกลุ่ม 2 แกน (กลุ่มธุรกิจ / โซนพื้นที่)
    const allComps = ORG.groups.flatMap(g => {
      const gMeta = { key: g.key, name: g.name, short: g.short, icon: g.icon };
      return g.companies.map(c => {
        let lines;
        if (c.real) {
          lines = baseLines.map(l => ({ ...l }));
        } else {
          const keep = baseLines.filter((l, i) => i < 3 || rnd(`${c.key}|${l.line}|keep`) < c.keep);
          lines = keep.map((l, idx) => {
            const name = g.lineAlias ? (g.lineAlias[idx % g.lineAlias.length]) : l.line;
            const ratio = l.target > 0 ? l.actual / l.target : 0;
            const nRatio = clamp(ratio * jit(`${c.key}|${name}|r|${dk}`, 0.28) + c.oeeD / 260, 0.35, 1.12);
            const target = Math.max(0, Math.round(l.target * c.qtyF * jit(`${c.key}|${name}|t|${dk}`, 0.34)));
            const head = Math.max(0, Math.round(l.head * c.qtyF * jit(`${c.key}|${name}|h`, 0.2)));
            return {
              line: name,
              target,
              actual: Math.round(target * nRatio),
              oee: l.oee == null ? null : +clamp(l.oee + c.oeeD + (rnd(`${c.key}|${name}|o|${dk}`) - 0.5) * 13, 8, 97).toFixed(1),
              dtMin: Math.round(l.dtMin * c.dtF * jit(`${c.key}|${name}|d|${dk}`, 0.7)),
              ng: Math.round(l.ng * c.ngF * jit(`${c.key}|${name}|n|${dk}`, 0.8)),
              head,
              present: Math.min(head, Math.round(head * clamp(0.94 * jit(`${c.key}|${name}|p|${dk}`, 0.12), 0.7, 1))),
              w: Math.max(1, Math.round(l.w * c.qtyF)),
            };
          });
        }
        const worst = [...lines].filter(l => l.target > 0).sort((a, b) => (b.target - b.actual) - (a.target - a.actual))[0] || null;
        return { ...c, groupMeta: gMeta, lines, worst, ...aggregate(lines) };
      });
    });

    const packBy = (defs, matchFn) => defs.map(d => {
      const companies = allComps.filter(c => matchFn(c, d));
      const lines = companies.flatMap(c => c.lines);
      return { ...d, companies, lines, ...aggregate(lines) };
    });
    const groups = packBy(ORG.groups, (c, g) => c.groupMeta.key === g.key);
    const zones = packBy(ZONES, (c, z) => c.zone === z.key);

    const allLines = allComps.flatMap(c => c.lines.map(l => ({ ...l, comp: c })));
    return { groups, zones, allComps, allLines, ...aggregate(allLines) };
  }, [baseLines, usedDate, date]);

  /* ── ขอบเขตที่กำลังดูอยู่ (breadcrumb) — แกน map (โซน) หรือ biz (กลุ่มธุรกิจ) ── */
  const axisNodes = sel.axis === 'map' ? tree.zones : tree.groups;
  const bizNode = sel.node ? axisNodes.find(n => n.key === sel.node) : null;
  const compNode = sel.comp ? tree.allComps.find(c => c.key === sel.comp) : null;
  const scope = compNode || bizNode || tree;
  const scopeLines = compNode ? compNode.lines.map(l => ({ ...l, comp: compNode }))
    : bizNode ? bizNode.companies.flatMap(c => c.lines.map(l => ({ ...l, comp: c })))
      : tree.allLines;
  const hotspots = scopeLines.filter(l => l.target > 0 && l.actual < l.target)
    .sort((a, b) => (b.target - b.actual) - (a.target - a.actual)).slice(0, 10);

  const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 14 };
  const TH = { padding: '7px 8px', fontSize: 12, color: 'var(--muted)', fontWeight: 700, textAlign: 'left', whiteSpace: 'nowrap' };
  const THR = { ...TH, textAlign: 'right' };
  const TD = { padding: '7px 8px', fontSize: 13, borderTop: '1px solid var(--border)' };
  const TDR = { ...TD, textAlign: 'right' };

  // แถบเทียบ (ใช้ทั้งระดับกลุ่มธุรกิจและระดับบริษัท)
  const RankBars = ({ items, onPick }) => {
    const maxT = Math.max(1, ...items.map(i => i.target));
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[...items].sort((a, b) => (b.oee ?? -1) - (a.oee ?? -1)).map((it, i) => (
          <div key={it.key} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '230px 1fr 128px', gap: 10, alignItems: 'center' }}>
            <button onClick={() => onPick && onPick(it)} disabled={!onPick} style={{
              display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, minWidth: 0,
              background: 'none', border: 'none', padding: 0, color: 'var(--text)', textAlign: 'left',
              cursor: onPick ? 'pointer' : 'default',
            }}>
              <span style={{ fontSize: 12, color: 'var(--muted)', width: 18 }}>#{i + 1}</span>
              <span>{it.icon || it.flag}</span>
              <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.code || it.name}</span>
              {/* ป้ายจริง/จำลอง ใช้กับ "บริษัท" เท่านั้น — โซน/กลุ่มธุรกิจเป็นก้อนรวม (มีทั้งของจริงและจำลอง) */}
              {it.companies
                ? <span style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{it.companies.length} บริษัท</span>
                : it.real
                  ? <span style={{ fontSize: 10, color: '#22c55e', border: '1px solid #22c55e', borderRadius: 4, padding: '0 5px', whiteSpace: 'nowrap' }}>จริง</span>
                  : <span style={{ fontSize: 10, color: '#f59e0b', border: '1px dashed #f59e0b', borderRadius: 4, padding: '0 5px', whiteSpace: 'nowrap' }}>จำลอง</span>}
            </button>
            <div style={{ height: 22, background: 'var(--bg3)', borderRadius: 5, overflow: 'hidden', position: 'relative' }}>
              <div style={{ width: `${clamp(it.target / maxT * 100, 2, 100)}%`, height: '100%', background: 'var(--bg2)', position: 'absolute', inset: 0, borderRight: '1px dashed var(--border2)' }} />
              <div style={{ width: `${clamp(it.actual / maxT * 100, 0, 100)}%`, height: '100%', background: pctCol(it.pct), opacity: 0.85, position: 'relative' }} />
              <span style={{ position: 'absolute', left: 8, top: 0, lineHeight: '22px', fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
                {fmtNum(it.actual)} / {fmtNum(it.target)} ชิ้น
              </span>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: isMobile ? 'flex-start' : 'flex-end', fontSize: 13 }}>
              <span style={{ color: pctCol(it.pct), fontWeight: 700 }}>{it.pct == null ? '—' : it.pct + '%'}</span>
              <span style={{ color: oeeCol(it.oee), fontWeight: 700 }}>OEE {it.oee == null ? '—' : it.oee}</span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const crumbBtn = (label, onClick, active) => (
    <button onClick={onClick} disabled={active} style={{
      background: 'none', border: 'none', padding: '2px 4px', fontSize: 13, fontWeight: active ? 800 : 600,
      color: active ? 'var(--text)' : 'var(--accent)', cursor: active ? 'default' : 'pointer',
    }}>{label}</button>
  );

  return (
    <div style={{ maxWidth: 'min(97vw, 2200px)', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── หัวหน้า + ตัวเลือกวัน (paddingRight กัน 🔔 ทับ) ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between', paddingRight: 52 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: isMobile ? 19 : 23, display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            🏢 {ORG.code} — ภาพรวมกลุ่มบริษัท
            <span style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', border: '1px dashed #f59e0b', borderRadius: 999, padding: '2px 10px' }}>
              🧪 MOCKUP · ตัวอย่างหน้าจอ
            </span>
          </h2>
          {/* breadcrumb: TSG › กลุ่มธุรกิจ › บริษัท */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', marginTop: 3 }}>
            {crumbBtn(`🏢 ${ORG.code}`, () => setSel(s => ({ axis: s.axis, node: null, comp: null })), !bizNode)}
            {bizNode && <><span style={{ color: 'var(--muted)' }}>›</span>
              {crumbBtn(`${bizNode.icon} ${bizNode.name}`, () => setSel(s => ({ ...s, comp: null })), !compNode)}</>}
            {compNode && <><span style={{ color: 'var(--muted)' }}>›</span>
              {crumbBtn(`${compNode.flag} ${compNode.code}`, () => { }, true)}</>}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
            {fmtThaiDate(usedDate || date)}
            {usedDate && usedDate !== date && <span style={{ color: '#f59e0b' }}> (ไม่มีข้อมูลวันที่เลือก — ถอยไปวันงานล่าสุดที่มีข้อมูล)</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* สลับแกนมอง: ตามพื้นที่ (แผนที่) หรือ ตามกลุ่มธุรกิจ — เปลี่ยนแกนแล้วกลับไประดับ TSG */}
          <div style={{ display: 'flex', border: '1px solid var(--border2)', borderRadius: 8, overflow: 'hidden' }}>
            {[{ k: 'map', t: '🗺️ ตามพื้นที่' }, { k: 'biz', t: '🗂️ ตามกลุ่มธุรกิจ' }].map(o => (
              <button key={o.k} onClick={() => setSel({ axis: o.k, node: null, comp: null })} style={{
                padding: '7px 11px', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer',
                background: sel.axis === o.k ? 'var(--accent)' : 'var(--bg3)',
                color: sel.axis === o.k ? '#08120a' : 'var(--text)',
              }}>{o.t}</button>
            ))}
          </div>
          <button className="tbtn" onClick={() => setDate(shiftDate(date, -1))} style={btn}>◀</button>
          <input type="date" value={date} max={getWorkDate()} onChange={e => setDate(e.target.value)}
            style={{ width: 148, padding: '7px 9px', fontSize: 13, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, color: 'var(--text)' }} />
          <button className="tbtn" onClick={() => setDate(shiftDate(date, 1))} disabled={date >= getWorkDate()} style={{ ...btn, opacity: date >= getWorkDate() ? 0.4 : 1 }}>▶</button>
          <button onClick={load} style={{ ...btn, width: 'auto', padding: '7px 12px', fontSize: 13 }}>🔄 รีเฟรช</button>
        </div>
      </div>

      {/* ── แถบอธิบายว่าอันไหนจริง อันไหนจำลอง (ห้ามให้เข้าใจผิดว่ามีหลายบริษัทในระบบแล้ว) ── */}
      <div style={{ ...card, borderStyle: 'dashed', borderColor: '#f59e0b', background: 'rgba(245,158,11,0.07)', fontSize: 13, lineHeight: 1.7 }}>
        <b style={{ color: '#f59e0b' }}>นี่คือหน้าจอตัวอย่าง (mockup) เพื่อดูว่า “ระบบรองรับหลายบริษัทในกลุ่ม” จะหน้าตาแบบไหน</b><br />
        • โครงองค์กร: <b>{ORG.code}</b> → กลุ่มธุรกิจ ({ORG.groups.map(g => g.short).join(' / ')}) → บริษัท → ไลน์ผลิต · ดูอีกแกนเป็น <b>โซนพื้นที่</b> ({ZONES.map(z => z.name).join(' / ')}) ได้จากปุ่มมุมขวาบน — <b>กดหมุด/การ์ด/ชื่อ เพื่อเจาะลึกลงชั้นถัดไป</b><br />
        • <b>TSAT4</b> = <b style={{ color: '#22c55e' }}>ข้อมูลจริง</b>จากฐานข้อมูลปัจจุบัน (กะที่ปิดแล้วของวันที่เลือก) · บริษัทอื่น = <b style={{ color: '#f59e0b' }}>ตัวเลขจำลอง</b> ที่ปั้นจากข้อมูลจริงชุดเดียวกัน (สุ่มแบบ seeded ให้ตัวเลขนิ่ง ไม่ดิ้นทุกครั้งที่รีเฟรช)<br />
        • หน้านี้ <b>ไม่เขียนฐานข้อมูล</b> และยังไม่มีตารางบริษัท/โรงงานจริง — ดูสรุป “ถ้าทำจริงต้องทำอะไร” ท้ายหน้า
      </div>

      {loading && <div style={{ ...card, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>กำลังโหลดข้อมูล...</div>}
      {!loading && !baseLines.length && (
        <div style={{ ...card, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
          ไม่พบข้อมูลการผลิตย้อนหลัง 7 วันจากวันที่เลือก — ลองเลือกวันอื่น
        </div>
      )}

      {!loading && !!baseLines.length && (<>

        {/* ── KPI ของขอบเขตที่กำลังดู ── */}
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))' }}>
          <Kpi
            label={compNode ? '🏭 ไลน์ผลิต' : bizNode ? '🏢 บริษัทใน' + (sel.axis === 'map' ? 'โซนนี้' : 'กลุ่มธุรกิจ') : (sel.axis === 'map' ? '🗺️ โซนพื้นที่' : '🗂️ กลุ่มธุรกิจ')}
            value={compNode ? compNode.lines.length : bizNode ? bizNode.companies.length : axisNodes.length}
            sub={compNode ? `บริษัท ${compNode.code}`
              : bizNode ? `${bizNode.lines.length} ไลน์ผลิตรวม`
                : `${tree.allComps.length} บริษัท · ${tree.allLines.length} ไลน์`} />
          <Kpi label="📦 ผลิตรวม" value={fmtNum(scope.actual)} color={pctCol(scope.pct)}
            sub={`เป้า ${fmtNum(scope.target)} · ${scope.pct == null ? '—' : scope.pct + '%'}`} />
          <Kpi label="⚙️ OEE (ถ่วงน้ำหนัก)" value={scope.oee == null ? '—' : scope.oee + '%'} color={oeeCol(scope.oee)}
            sub="ถ่วงด้วยเวลารับภาระของแต่ละไลน์" />
          <Kpi label="🔧 Downtime นอกแผน" value={fmtNum(scope.dtMin)} sub="นาที" color={scope.dtMin > 0 ? '#f59e0b' : undefined} />
          <Kpi label="🚫 ของเสีย" value={fmtNum(scope.ng)} sub="ชิ้น (NG + สงสัย)" color={scope.ng > 0 ? '#ef4444' : undefined} />
          <Kpi label="👷 คนเข้างาน" value={`${fmtNum(scope.present)}/${fmtNum(scope.head)}`}
            sub={scope.head ? `${Math.round(scope.present / scope.head * 100)}% ของกำลังคน` : '—'} />
        </div>

        {/* ══ ระดับ 1: TSG ══ (แกนแผนที่ = โซนพื้นที่ · แกนกลุ่มธุรกิจ = การ์ดกลุ่ม) */}
        {!bizNode && (<>
          {sel.axis === 'map' && (
            <div style={card}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>🗺️ แผนที่โรงงานในกลุ่ม — ภาคกลาง &amp; ตะวันออก</div>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {tree.zones.filter(z => z.onMap).reduce((a, z) => a + z.companies.length, 0)} โรงงานบนแผนที่ ·
                  หมุดสีตามสถานะการผลิตของวันที่เลือก
                </span>
              </div>
              <ThailandZoneMap
                zones={tree.zones}
                isMobile={isMobile}
                height={isMobile ? 420 : 560}
                onPickZone={(z) => setSel(s => ({ ...s, node: z.key, comp: null }))}
                onPickCompany={(c) => setSel(s => ({ ...s, node: c.zone, comp: c.key }))}
              />
              {/* บริษัทนอกแผนที่ (ต่างประเทศ) — ห้ามหายไปเงียบๆ เพราะวางบนแผนที่ภาคกลางไม่ได้ */}
              {tree.zones.filter(z => !z.onMap && z.companies.length).map(z => (
                <div key={z.key} style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border2)' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: z.color, marginBottom: 6 }}>
                    {z.icon} {z.name} <span style={{ fontSize: 11.5, fontWeight: 400, color: 'var(--muted)' }}>(อยู่นอกกรอบแผนที่ — {z.desc})</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {z.companies.map(c => (
                      <button key={c.key} onClick={() => setSel(s => ({ ...s, node: z.key, comp: c.key }))} style={{
                        fontSize: 12, fontWeight: 700, padding: '4px 9px', borderRadius: 999, cursor: 'pointer',
                        background: 'var(--bg3)', border: '1px dashed var(--border2)', color: 'var(--text)',
                      }}>
                        {c.flag} {c.code}
                        <span style={{ color: oeeCol(c.oee), marginLeft: 5 }}>{c.oee == null ? '—' : c.oee}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
              📊 เทียบผลการผลิต{sel.axis === 'map' ? 'รายโซนพื้นที่' : 'รายกลุ่มธุรกิจ'}
            </div>
            <RankBars items={axisNodes} onPick={(g) => setSel(s => ({ ...s, node: g.key, comp: null }))} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 9 }}>
              แถบทึบ = ผลิตได้จริง · พื้นจาง = เป้าของวัน · เรียงตาม OEE · <b>คลิกชื่อเพื่อดูบริษัทข้างใน</b>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', alignContent: 'start' }}>
            {axisNodes.map(g => {
              const stCol = g.status === 'bad' ? '#ef4444' : g.status === 'ok' ? '#f59e0b' : '#22c55e';
              return (
                <div key={g.key} className="kpi-lift" style={{
                  ...card, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                  minHeight: 258, borderLeft: `4px solid ${stCol}`,
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span style={{ fontSize: 24 }}>{g.icon}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 16, fontWeight: 700 }}>{g.name}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{g.desc}</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', margin: '11px 0 9px' }}>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>OEE</div>
                        <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, color: oeeCol(g.oee), fontVariantNumeric: 'tabular-nums' }}>
                          {g.oee == null ? '—' : g.oee}<span style={{ fontSize: 15 }}>%</span>
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>ผลิต / เป้า</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: pctCol(g.pct), fontVariantNumeric: 'tabular-nums' }}>
                          {fmtNum(g.actual)} / {fmtNum(g.target)} <span style={{ fontSize: 12 }}>({g.pct == null ? '—' : g.pct + '%'})</span>
                        </div>
                        <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden', marginTop: 5 }}>
                          <div style={{ width: `${clamp(g.pct ?? 0, 0, 100)}%`, height: '100%', background: pctCol(g.pct) }} />
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, fontSize: 12 }}>
                      <Mini label="🔧 DT" value={`${fmtNum(g.dtMin)} น.`} color={g.dtMin > 0 ? '#f59e0b' : undefined} />
                      <Mini label="🚫 NG" value={fmtNum(g.ng)} color={g.ng > 0 ? '#ef4444' : undefined} />
                      <Mini label="👷 คน" value={`${fmtNum(g.present)}/${fmtNum(g.head)}`} />
                    </div>

                    {/* บริษัทในกลุ่ม — ชิปคลิกเข้าบริษัทได้เลย */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
                      {g.companies.map(c => (
                        <button key={c.key} onClick={() => setSel(s => ({ ...s, node: g.key, comp: c.key }))} style={{
                          fontSize: 11.5, fontWeight: 700, padding: '3px 8px', borderRadius: 999, cursor: 'pointer',
                          background: c.real ? 'rgba(34,197,94,0.13)' : 'var(--bg3)',
                          border: `1px ${c.real ? 'solid #22c55e' : 'dashed var(--border2)'}`,
                          color: 'var(--text)',
                        }}>
                          {c.flag} {c.code}
                          <span style={{ color: oeeCol(c.oee), marginLeft: 5 }}>{c.oee == null ? '—' : c.oee}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <button onClick={() => setSel(s => ({ ...s, node: g.key, comp: null }))}
                    style={{ ...btn, width: '100%', padding: '7px 10px', fontSize: 13, marginTop: 10 }}>
                    ▸ ดูบริษัทในกลุ่ม ({g.companies.length})
                  </button>
                </div>
              );
            })}
          </div>
        </>)}

        {/* ══ ระดับ 2: กลุ่มธุรกิจ — การ์ดบริษัท ══ */}
        {bizNode && !compNode && (<>
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>📊 เทียบผลการผลิตรายบริษัท — {bizNode.icon} {bizNode.name}</div>
            <RankBars items={bizNode.companies} onPick={(c) => setSel(s => ({ ...s, node: bizNode.key, comp: c.key }))} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 9 }}>
              เรียงตาม OEE · <b>คลิกชื่อบริษัทเพื่อดูรายไลน์</b>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(min(330px, 100%), 1fr))', alignContent: 'start' }}>
            {bizNode.companies.map(c => {
              const stCol = c.status === 'bad' ? '#ef4444' : c.status === 'ok' ? '#f59e0b' : '#22c55e';
              return (
                <div key={c.key} className="kpi-lift" style={{
                  ...card, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                  minHeight: 240, borderLeft: `4px solid ${stCol}`,
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 20 }}>{c.flag}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 16, fontWeight: 800 }}>{c.code}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name} · {c.region}</div>
                      </div>
                      {c.real
                        ? <span style={{ fontSize: 10, color: '#22c55e', border: '1px solid #22c55e', borderRadius: 4, padding: '1px 6px' }}>ข้อมูลจริง</span>
                        : <span style={{ fontSize: 10, color: '#f59e0b', border: '1px dashed #f59e0b', borderRadius: 4, padding: '1px 6px' }}>จำลอง</span>}
                    </div>

                    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', margin: '10px 0 8px' }}>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>OEE</div>
                        <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, color: oeeCol(c.oee), fontVariantNumeric: 'tabular-nums' }}>
                          {c.oee == null ? '—' : c.oee}<span style={{ fontSize: 15 }}>%</span>
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>ผลิต / เป้า</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: pctCol(c.pct), fontVariantNumeric: 'tabular-nums' }}>
                          {fmtNum(c.actual)} / {fmtNum(c.target)} <span style={{ fontSize: 12 }}>({c.pct == null ? '—' : c.pct + '%'})</span>
                        </div>
                        <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden', marginTop: 5 }}>
                          <div style={{ width: `${clamp(c.pct ?? 0, 0, 100)}%`, height: '100%', background: pctCol(c.pct) }} />
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, fontSize: 12 }}>
                      <Mini label="🔧 DT" value={`${fmtNum(c.dtMin)} น.`} color={c.dtMin > 0 ? '#f59e0b' : undefined} />
                      <Mini label="🚫 NG" value={fmtNum(c.ng)} color={c.ng > 0 ? '#ef4444' : undefined} />
                      <Mini label="👷 คน" value={`${fmtNum(c.present)}/${fmtNum(c.head)}`} />
                    </div>

                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 9, minHeight: 34 }}>
                      {c.worst && c.worst.target > c.worst.actual
                        ? <>⚠️ ไลน์ที่ตามหลังมากสุด: <b style={{ color: 'var(--text)' }}>{c.worst.line}</b> ขาด {fmtNum(c.worst.target - c.worst.actual)} ชิ้น</>
                        : <>✅ ทุกไลน์ทำได้ตามเป้า</>}
                    </div>
                  </div>

                  <button onClick={() => setSel(s => ({ ...s, node: bizNode.key, comp: c.key }))}
                    style={{ ...btn, width: '100%', padding: '7px 10px', fontSize: 13, marginTop: 8 }}>
                    ▸ ดูรายไลน์ ({c.lines.length})
                  </button>
                </div>
              );
            })}
          </div>
        </>)}

        {/* ══ ระดับ 3: บริษัท — ตารางรายไลน์ ══ */}
        {compNode && (
          <div style={card}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>
                🏭 {compNode.flag} {compNode.code} — รายไลน์ ({compNode.lines.length})
              </div>
              {compNode.real
                ? <span style={{ fontSize: 11, color: '#22c55e', border: '1px solid #22c55e', borderRadius: 4, padding: '1px 7px' }}>ข้อมูลจริง</span>
                : <span style={{ fontSize: 11, color: '#f59e0b', border: '1px dashed #f59e0b', borderRadius: 4, padding: '1px 7px' }}>ตัวเลขจำลอง</span>}
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{compNode.name} · {compNode.region}</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums', minWidth: 640 }}>
                <thead><tr>
                  <th style={TH}>ไลน์</th><th style={THR}>เป้า</th><th style={THR}>ผลิตได้</th>
                  <th style={THR}>%</th><th style={THR}>OEE</th><th style={THR}>DT (น.)</th>
                  <th style={THR}>NG</th><th style={THR}>คน</th>
                </tr></thead>
                <tbody>
                  {[...compNode.lines].sort((a, b) => (b.target - b.actual) - (a.target - a.actual)).map(l => {
                    const lp = l.target > 0 ? +(l.actual / l.target * 100).toFixed(1) : null;
                    return (
                      <tr key={l.line}>
                        <td style={{ ...TD, fontWeight: 700 }}>{l.line}</td>
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
            {compNode.real && (
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8 }}>
                ตัวเลขชุดนี้มาจากฐานข้อมูลจริง — ตรงกับที่เห็นใน <b>/oee-analytics</b> และ <b>/factory-map</b> (ใช้สูตรกลางชุดเดียวกัน)
              </div>
            )}
          </div>
        )}

        {/* ── ไลน์ที่ต้องดูแลด่วน (ตามขอบเขตที่กำลังดู) ── */}
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
            🚨 ไลน์ที่ต้องดูแลด่วน — {compNode ? compNode.code : bizNode ? bizNode.name : ORG.code}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>เรียงตามจำนวนชิ้นที่ขาดเป้า (ข้ามบริษัท/กลุ่มธุรกิจ)</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums', minWidth: 700 }}>
              <thead><tr>
                {!compNode && <th style={TH}>กลุ่มธุรกิจ</th>}
                {!compNode && <th style={TH}>บริษัท</th>}
                <th style={TH}>ไลน์</th><th style={THR}>ขาดเป้า</th>
                <th style={THR}>ผลิต/เป้า</th><th style={THR}>OEE</th><th style={THR}>DT (น.)</th><th style={THR}>NG</th>
              </tr></thead>
              <tbody>
                {hotspots.map((l, i) => {
                  const lp = +(l.actual / l.target * 100).toFixed(1);
                  return (
                    <tr key={`${l.comp?.key}-${l.line}-${i}`}>
                      {!compNode && <td style={TD}>{l.comp?.groupMeta?.icon} {l.comp?.groupMeta?.short}</td>}
                      {!compNode && (
                        <td style={TD}>
                          <button onClick={() => setSel(s => ({ ...s, node: s.axis === 'map' ? l.comp.zone : l.comp.groupMeta.key, comp: l.comp.key }))} style={{
                            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                            color: 'var(--accent)', fontSize: 13, fontWeight: 700,
                          }}>{l.comp?.flag} {l.comp?.code}</button>
                          {!l.comp?.real && <span style={{ fontSize: 10, color: '#f59e0b', marginLeft: 5 }}>(จำลอง)</span>}
                        </td>
                      )}
                      <td style={{ ...TD, fontWeight: 700 }}>{l.line}</td>
                      <td style={{ ...TDR, color: '#ef4444', fontWeight: 700 }}>-{fmtNum(l.target - l.actual)}</td>
                      <td style={{ ...TDR, color: pctCol(lp) }}>{fmtNum(l.actual)}/{fmtNum(l.target)} ({lp}%)</td>
                      <td style={{ ...TDR, color: oeeCol(l.oee), fontWeight: 700 }}>{l.oee == null ? '—' : l.oee}</td>
                      <td style={{ ...TDR, color: l.dtMin > 0 ? '#f59e0b' : 'var(--muted)' }}>{fmtNum(l.dtMin)}</td>
                      <td style={{ ...TDR, color: l.ng > 0 ? '#ef4444' : 'var(--muted)' }}>{fmtNum(l.ng)}</td>
                    </tr>
                  );
                })}
                {!hotspots.length && <tr><td style={TD} colSpan={compNode ? 6 : 8}>✅ ทุกไลน์ทำได้ตามเป้า</td></tr>}
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
          <span>{showHow ? '▼' : '▶'}</span> 🛠️ ถ้าจะรองรับหลายบริษัทในกลุ่มจริง ต้องทำอะไรบ้าง
          <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>(สรุปเชิงเทคนิค)</span>
        </button>
        {showHow && (
          <div style={{ fontSize: 13, lineHeight: 1.85, marginTop: 10, color: 'var(--text2)' }}>
            <b style={{ color: 'var(--text)' }}>ทำได้ครับ — โครงระบบปัจจุบันรองรับได้โดยไม่ต้องเขียนใหม่</b> เพราะทุกอย่างผูกกับ “ไลน์ / ส่วนงาน” อยู่แล้ว
            แค่ต่อ <b>ผังองค์กรที่มีอยู่ (`org_nodes`)</b> ขึ้นไปอีก 2 ชั้น (กลุ่มธุรกิจ → บริษัท) · งานหลักที่ต้องทำ:
            <ol style={{ margin: '8px 0 0', paddingLeft: 22 }}>
              <li><b>ขยาย <code>org_nodes.kind</code> ให้มี <code>business_group</code> + <code>company</code></b> (ปัจจุบันมี section / department / line) — โครงต้นไม้ parent_id เดิมรองรับอยู่แล้ว ไม่ต้องสร้างตารางใหม่ · เพิ่ม <code>company_id</code> ที่ <code>production_lines</code> + <code>profiles</code></li>
              <li><b>ตารางข้อมูลรายวันไม่ต้องแก้</b> (production_sessions / prod_orders / downtime_logs / defect_logs) — สืบบริษัท↔กลุ่มธุรกิจผ่านไลน์ได้ทั้งหมด</li>
              <li><b>ขยาย scope ของ user</b> จาก “ส่วนงาน (sections)” เป็น “บริษัท → ส่วนงาน” — ต่อยอด <code>effectiveSections()</code> เดิม + เพิ่ม role ระดับกลุ่ม (ผู้บริหาร TSG เห็นทุกบริษัท / ผู้จัดการบริษัทเห็นเฉพาะของตัวเอง)</li>
              <li><b>Master data ที่ต้องแยกต่อบริษัท:</b> ปฏิทินบริษัท · นโยบายเวลาพัก · เป้า OEE · ทะเบียนเอกสาร (เลขฟอร์มคนละชุด) · ห้อง Telegram แจ้งเตือน · ผังโรงงาน</li>
              <li><b>2 Supabase project ปัจจุบัน (Main + DR) ใช้ต่อได้</b> — แยกด้วย <code>company_id</code> ในโครงเดิม ไม่ต้องแตก project ต่อบริษัท (ถ้าบริษัทต่างประเทศต้องเก็บข้อมูลในประเทศตัวเอง ค่อยแยก project แล้วรวมที่ชั้นรายงาน)</li>
              <li><b>จอนี้ (Group Overview)</b> = ชั้นรายงานรวม อ่านอย่างเดียว — ตัวเลขทุกตัวใช้สูตรกลางเดิม (OEE ถ่วงน้ำหนัก, นับงานคู่ RH/LH เป็น 1 stroke) จึงตรงกับที่แต่ละบริษัทเห็นในหน้าตัวเอง</li>
            </ol>
            <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--bg3)', borderRadius: 6, fontSize: 12.5 }}>
              <b>ข้อควรระวัง:</b> แต่ละบริษัทต้องกรอกข้อมูลด้วย “นิยามเดียวกัน” (เช่น downtime อะไรนับเป็นในแผน/นอกแผน, เป้ากะมาจากไหน)
              ไม่งั้นตัวเลขเทียบข้ามบริษัทไม่ได้ — ส่วนนี้เป็นงานวางมาตรฐานกลางของกลุ่ม ไม่ใช่งานเขียนโปรแกรม
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
