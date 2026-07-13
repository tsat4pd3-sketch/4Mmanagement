import { useState, useEffect, useCallback, useMemo, useRef, useContext, Fragment } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { motion, AnimatePresence } from 'framer-motion';
import { UserContext } from '../App';
import { isAlarmingDT, dtElapsedMin } from '../utils/downtimeAlarm';
import { markerScale } from '../utils/markerScale';
import { buildMan4mPendingMatcher, ppeMissingList } from '../utils/personAlarm';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';

const FADE_UP = { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } };
const stagger = (i) => ({ ...FADE_UP, transition: { delay: i * 0.06, duration: 0.35 } });

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth <= 768);
  useEffect(() => {
    const h = () => setMobile(window.innerWidth <= 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return mobile;
}

function useWidth() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return w;
}

function getShiftInfo(date) {
  const h = date.getHours();
  const m = date.getMinutes();
  const total = h * 60 + m;
  const isDay = total >= 480 && total < 1200;
  return { isDay, label: isDay ? 'กะเช้า' : 'กะดึก', icon: isDay ? '☀️' : '🌙' };
}

// การ์ดผังไลน์ย่อ — พิกัด pos_top/pos_left เป็น % ของ "ตัวรูปจริง" (มาตรฐานเดียวกับ LineSetup/Management)
// ใช้ object-fit: contain + overlay ที่ยึดกรอบรูปหลังหัก letterbox เพื่อให้จุดเกาะรูปตามทุกขนาดการ์ด
function ThumbMap({ imageUrl, alt, markers }) {
  const imgRef = useRef(null);
  const [box, setBox] = useState(null); // { ox, oy, rw, rh }
  const recalc = useCallback(() => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) { setBox(null); return; }
    const cw = img.clientWidth, ch = img.clientHeight;
    const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
    const rw = img.naturalWidth * scale, rh = img.naturalHeight * scale;
    setBox({ ox: (cw - rw) / 2, oy: (ch - rh) / 2, rw, rh });
  }, []);
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const ro = new ResizeObserver(() => requestAnimationFrame(recalc));
    ro.observe(img);
    return () => ro.disconnect();
  }, [recalc, imageUrl]);
  return (
    <div style={{ position: 'relative', aspectRatio: '16/9' }}>
      <img ref={imgRef} src={imageUrl} alt={alt} onLoad={recalc}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', opacity: 0.65 }} />
      {box && (
        <div style={{ position: 'absolute', left: box.ox, top: box.oy, width: box.rw, height: box.rh, pointerEvents: 'none' }}>
          {markers.map(m => (
            <div key={m.id} style={{ position: 'absolute', top: m.top, left: m.left, transform: 'translate(-50%, -50%)', zIndex: m.alarm ? 3 : 2 }}>
              {m.alarm ? (
                /* wrapper สูงเท่าวงกลมเท่านั้น — ป้ายห้อยใต้แบบ absolute กันจุดกึ่งกลางเลื่อน (UI-CONVENTIONS §1.1) */
                <div style={{ position: 'relative', width: 26, height: 26 }}>
                  <div className="dt-alarm-blink" style={{
                    width: 26, height: 26, borderRadius: '50%',
                    border: '2px solid #ef4444', boxShadow: '0 0 8px #ef4444',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, background: 'rgba(0,0,0,0.6)',
                  }}>⚙️</div>
                  <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 1, background: 'rgba(239,68,68,0.9)', borderRadius: 4, padding: '0px 5px', fontSize: 11, fontWeight: 800, color: '#fff', whiteSpace: 'nowrap', maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.label}</div>
                </div>
              ) : (
                <div style={{ position: 'relative' }} title={m.personAlarm?.label}>
                  <div
                    className={m.personAlarm ? (m.personAlarm.kind === 'red' ? 'person-alarm-red' : 'person-alarm-amber') : undefined}
                    style={{
                      width: 26, height: 26, borderRadius: '50%',
                      border: `2px solid ${m.color}`, boxShadow: `0 0 6px ${m.color}88`,
                      overflow: 'hidden', background: '#1a1a1a',
                    }}>
                    {m.img
                      ? <img src={m.img} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: m.color }}>{m.initial}</div>
                    }
                  </div>
                  {m.personAlarm && (
                    <div style={{ position: 'absolute', top: -5, right: -5, fontSize: 11, lineHeight: 1 }}>{m.personAlarm.icon}</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RadialProgress({ pct, size = 80, stroke = 7, color = 'var(--accent)' }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
        style={{ stroke: 'var(--border2)' }} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color}
        strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
    </svg>
  );
}

function MiniBar({ value, max, color }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ height: 4, borderRadius: 3, background: 'var(--border2)', overflow: 'hidden', marginTop: 6 }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.7s ease' }} />
    </div>
  );
}

const SKILL_LEVELS = [
  { min: 100, label: 'ผู้เชี่ยวชาญ',   color: '#a855f7', bg: 'rgba(168,85,247,0.15)' },
  { min: 75,  label: 'แก้ปัญหาได้',    color: '#22c55e', bg: 'rgba(34,197,94,0.15)'  },
  { min: 50,  label: 'มาตรฐาน',        color: '#84cc16', bg: 'rgba(132,204,18,0.15)' },
  { min: 25,  label: 'ต้องดูแล',       color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  { min: 0,   label: 'ยังไม่ผ่าน OJT', color: '#ef4444', bg: 'rgba(239,68,68,0.15)'  },
];
const getFitLevel = (fit) => fit === null ? null : SKILL_LEVELS.find(l => fit >= l.min) ?? SKILL_LEVELS[4];

const CAT_META = {
  Man:      { color: '#4d9fff', icon: '👤', bg: 'rgba(77,159,255,0.12)' },
  Machine:  { color: '#f59e0b', icon: '⚙️', bg: 'rgba(245,158,11,0.12)' },
  Material: { color: '#a855f7', icon: '📦', bg: 'rgba(168,85,247,0.12)' },
  Method:   { color: '#22c55e', icon: '📋', bg: 'rgba(34,197,94,0.12)' },
};
const getCatMeta = (cat = '') => {
  const key = Object.keys(CAT_META).find(k => cat.includes(k));
  return key ? CAT_META[key] : { color: '#888', icon: '🔔', bg: 'rgba(128,128,128,0.1)' };
};

function getWorkDateStr(date) {
  const h = date.getHours();
  const d = new Date(date);
  if (h < 8) d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function Dashboard() {
  const now = useNow();
  // scope ตาม user (คำสั่ง user 2026-07-12: "filter ได้ก็ไม่มีปัญหา ถ้าไม่ใช้ก็เหมือนไม่ filter")
  // — leader เห็นเฉพาะ family ไลน์ตัวเอง · role ที่มี sections เห็นเฉพาะ section ตัวเอง · ที่เหลือเห็นหมดเหมือนเดิม
  const { role, lineId: userLineId, sections: scopeSecs } = useContext(UserContext);
  const isMobile = useIsMobile();
  const vw = useWidth();
  const isWide = vw >= 1280;   // desktop / laptop
  const isUltra = vw >= 1600;  // large desktop / TV
  const shiftInfo = getShiftInfo(now);
  const workDateStr = getWorkDateStr(now);

  const [selectedDate,  setSelectedDate]  = useState(workDateStr);
  const [selectedShift, setSelectedShift] = useState(shiftInfo.isDay ? 'day' : 'night');

  // Section filter — เหมาะกับจอ TV ที่ตั้งไว้ดูเฉพาะส่วนงานตัวเอง
  // จำค่าไว้ใน URL (?section=...) เพื่อให้ bookmark จอ TV ได้ตรงส่วนงานทุกครั้งที่เปิด
  const [selectedSection, setSelectedSection] = useState(() => new URLSearchParams(window.location.search).get('section') || 'all');
  const changeSection = (sec) => {
    setSelectedSection(sec);
    const params = new URLSearchParams(window.location.search);
    if (sec === 'all') params.delete('section'); else params.set('section', sec);
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  };

  // Auto-sync shift when day→night boundary crosses (20:00) while viewing today
  useEffect(() => {
    if (selectedDate === workDateStr) {
      setSelectedShift(shiftInfo.isDay ? 'day' : 'night');
    }
  }, [shiftInfo.isDay, selectedDate, workDateStr]);
  const [logs, setLogs]         = useState([]);
  const [fourMLogs, setFourMLogs] = useState([]);
  const [lines, setLines]       = useState([]);
  const [orgSections, setOrgSections] = useState([]);
  const [loading, setLoading]   = useState(true);

  const [empCounts, setEmpCounts] = useState({});   // { [line_id]: count }

  const [layouts,       setLayouts]       = useState([]);
  const [workstations,  setWorkstations]  = useState([]);
  const [machinePoints, setMachinePoints] = useState([]);
  const [stationEmpMap, setStationEmpMap] = useState({});
  const [expandedLine,  setExpandedLine]  = useState(null);
  const [expandedLines, setExpandedLines] = useState(new Set()); // ชื่อไลน์หลักที่กดขยายดูไลน์ย่อยในการ์ดสถานะไลน์ผลิต
  const [andonLine, setAndonLine] = useState(null); // { title, names } — เปิด Andon panel เจาะรายละเอียด alarm ของไลน์
  const mapImgRef = useRef(null);
  const [mapBox, setMapBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!expandedLine) return;
    const measure = () => {
      if (mapImgRef.current) setMapBox({ w: mapImgRef.current.clientWidth, h: mapImgRef.current.clientHeight });
    };
    measure();
    window.addEventListener('resize', measure);
    // ResizeObserver จับกรณีขนาดรูปเปลี่ยนโดยไม่มี window resize (เช่น พับ sidebar, รูปเพิ่งโหลดเสร็จ)
    const ro = mapImgRef.current ? new ResizeObserver(measure) : null;
    if (ro && mapImgRef.current) ro.observe(mapImgRef.current);
    return () => {
      window.removeEventListener('resize', measure);
      if (ro) ro.disconnect();
    };
  }, [expandedLine]);
  const [prodStatus,    setProdStatus]    = useState([]);
  const [ctByMatNo,     setCtByMatNo]     = useState({});
  const [nameByMatNo,   setNameByMatNo]   = useState({});
  const [imgByMatNo,    setImgByMatNo]    = useState({});
  const [breakPolicies, setBreakPolicies] = useState([]);
  // วันที่ของ Heijunka Board — เลือกดูย้อนหลังได้ (default = วันงานปัจจุบัน)
  const [boardDate,     setBoardDate]     = useState(() => getWorkDateStr(new Date()));
  const [lineByMat,     setLineByMat]     = useState({});   // mat_no → line_name (จาก dr_products)
  const [ediOrders,     setEdiOrders]     = useState([]);   // รอบส่งลูกค้า (EDI 862) วันนี้+พรุ่งนี้ ที่ยังไม่ส่ง
  const [fgStockByMat,  setFgStockByMat]  = useState({});   // mat_no → stock FG พร้อมส่งรวมทุกคลัง

  // โหลดเฉพาะข้อมูลผลิต/OEE จาก DR — เบากว่า fetchAll มาก ใช้กับ realtime
  const fetchProdStatus = useCallback(async () => {
    const [{ data: sessions }, { data: breakPolicies }, { data: products }] = await Promise.all([
      supabaseDR
        .from('production_sessions')
        .select('id, line_name, shift, status, work_date, start_time, created_at, dr_products(name, target_per_shift, cycle_time_sec, process_type)')
        .eq('work_date', boardDate),
      supabaseDR.from('break_policies').select('*').eq('is_active', true),
      supabaseDR.from('dr_products').select('mat_no, name, cycle_time_sec, image_url, line_name').not('mat_no', 'is', null),
    ]);
    // production_sessions.product_id ไม่ได้ตั้งค่าเสมอ (กะนึงมีได้หลาย mat_no) — ใช้ map นี้
    // เป็น fallback หา cycle_time_sec รายออเดอร์จาก mat_no ตรง ๆ แทนการพึ่ง session.dr_products
    const ctMap = {};
    const nameMap = {};
    const imgMap = {};
    const lineMap = {};
    (products || []).forEach(p => {
      ctMap[p.mat_no] = p.cycle_time_sec || 0; nameMap[p.mat_no] = p.name || ''; imgMap[p.mat_no] = p.image_url || '';
      if (p.line_name) lineMap[p.mat_no] = p.line_name;
    });
    setCtByMatNo(ctMap);
    setNameByMatNo(nameMap);
    setImgByMatNo(imgMap);
    setLineByMat(lineMap);
    setBreakPolicies(breakPolicies || []);
    // 📡 รอบส่งลูกค้า (EDI 862) ของวันนี้→พรุ่งนี้ ที่ยังไม่ส่ง — ใช้พยากรณ์กะดึกล่วงหน้าแม้ยังไม่เปิดใบผลิต
    {
      const nd = new Date(`${boardDate}T12:00:00`);
      nd.setDate(nd.getDate() + 1);
      const nextDay = `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}-${String(nd.getDate()).padStart(2, '0')}`;
      const { data: shipOrders } = await supabaseDR.from('customer_shipping_orders')
        .select('mat_no, qty, due_date, ship_time, customer, status')
        .gte('due_date', boardDate).lte('due_date', nextDay).neq('status', 'shipped');
      setEdiOrders(shipOrders || []);
      // stock FG พร้อมส่งของ mat เหล่านั้น — planner จะหักออกก่อนคำนวณว่าต้องผลิตคืนนี้เท่าไหร่
      const shipMats = [...new Set((shipOrders || []).map(o => o.mat_no))];
      if (shipMats.length) {
        const { data: st } = await supabaseDR.from('line_stock_summary').select('mat_no, qty_on_hand').in('mat_no', shipMats);
        const fg = {};
        (st || []).forEach(r => { fg[r.mat_no] = (fg[r.mat_no] || 0) + (parseFloat(r.qty_on_hand) || 0); });
        setFgStockByMat(fg);
      } else setFgStockByMat({});
    }
    const sessionIds = (sessions || []).map(s => s.id);
    let ordersBySession = {}, dtBySession = {}, defectBySession = {};
    if (sessionIds.length > 0) {
      const [{ data: orders }, { data: dtLogs }, { data: defectLogs }] = await Promise.all([
        supabaseDR.from('prod_orders').select('session_id, status, qty, qty_ok, qty_actual, qty_target, is_manual, prod_no, part_name, mat_no, opened_at, confirmed_at').in('session_id', sessionIds),
        supabaseDR.from('downtime_logs').select('id, session_id, machine_no, description, duration_min, started_at, ended_at, created_at, dr_downtime_types(category, name_th)').in('session_id', sessionIds),
        supabaseDR.from('defect_logs').select('session_id, qty_ng, qty_suspect').in('session_id', sessionIds),
      ]);
      (orders     || []).forEach(o => { (ordersBySession[o.session_id]  ||= []).push(o); });
      (dtLogs     || []).forEach(d => { (dtBySession[d.session_id]      ||= []).push(d); });
      (defectLogs || []).forEach(d => { (defectBySession[d.session_id]  ||= []).push(d); });
    }

    // ประมาณ OEE "สด" ของกะที่กำลังผลิตอยู่ (ยังไม่ปิดกะ) — สูตรเดียวกับ computeOEE() ใน DailyReport.jsx
    // ใช้ work_date + start_time (เวลาเปิดกะจริงที่ตั้งไว้) เป็นจุดเริ่ม ไม่ใช่ created_at ที่อาจคลาดเคลื่อน
    // และคิด CT แยกตาม MAT.NO ของแต่ละ order ไม่ใช่ CT เดียวของ session เพราะกะเดียวอาจผลิตหลาย MAT.NO
    const computeSessionOEE = (s) => {
      const openedAt = (s.work_date && s.start_time)
        ? new Date(`${s.work_date}T${s.start_time.slice(0,5)}:00`)
        : (s.created_at ? new Date(s.created_at) : null);
      const closedAt  = new Date();
      if (!openedAt) return null;
      const shiftMin  = Math.round((closedAt - openedAt) / 60000);
      const dts       = dtBySession[s.id] || [];
      const plannedDT = dts.filter(d => d.dr_downtime_types?.category === 'planned').reduce((a, d) => a + (d.duration_min || 0), 0);
      const unplannedDT = dts.filter(d => d.dr_downtime_types?.category !== 'planned').reduce((a, d) => a + (d.duration_min || 0), 0);
      // Policy breaks overlap
      const wDate = s.work_date;
      const policyBreak = (breakPolicies || [])
        .filter(p => p.shift === 'both' || p.shift === s.shift)
        .filter(p => p.process_type === 'common' || p.process_type === s.dr_products?.process_type)
        .reduce((sum, p) => {
          const [ph, pm] = (p.start_time || '00:00').split(':').map(Number);
          let pStart = new Date(`${wDate}T${String(ph).padStart(2,'0')}:${String(pm).padStart(2,'0')}:00`);
          let pEnd = new Date(pStart.getTime() + p.duration_min * 60000);
          if (pStart < openedAt && pEnd < openedAt) {
            pStart = new Date(pStart.getTime() + 86400000);
            pEnd   = new Date(pEnd.getTime() + 86400000);
          }
          return sum + Math.max(0, (Math.min(pEnd, closedAt) - Math.max(pStart, openedAt)) / 60000);
        }, 0);
      const netAvail = Math.max(0, shiftMin - plannedDT - policyBreak);
      const runMin   = Math.max(0, netAvail - unplannedDT);
      const orders   = ordersBySession[s.id] || [];
      let producedMin = 0, knownQty = 0;
      const produced = orders.filter(o => o.status === 'confirmed').reduce((a, o) => a + o.qty, 0);
      orders.filter(o => o.status === 'confirmed').forEach(o => {
        const ct = ctMap[o.mat_no] || s.dr_products?.cycle_time_sec || 0;
        if (ct > 0) { producedMin += o.qty * ct / 60; knownQty += o.qty; }
      });
      const ngQty    = (defectBySession[s.id] || []).reduce((a, d) => a + (d.qty_ng || 0) + (d.qty_suspect || 0), 0);
      // Availability: ถ้ากะนี้มีหลาย MAT.NO วิ่งคนละช่วงเวลากัน ให้แยกคำนวณ netAvail/runMin ตามช่วงเปิด-ปิดของแต่ละ
      // MAT.NO เอง แล้วถ่วงเฉลี่ยตามเวลาที่รัน (runMin) กลับเป็นค่าไลน์เดียว — สูตรเดียวกับ computeOEE() ใน DailyReport.jsx
      const dtOverlapMinLive = (startMs, endMs, pred = () => true) => {
        if (!startMs || !endMs || endMs <= startMs) return 0;
        return dts.filter(pred).reduce((sum, d) => {
          if (!d.started_at) return sum;
          const s0 = new Date(d.started_at).getTime();
          const e0 = d.ended_at ? new Date(d.ended_at).getTime() : s0 + (d.duration_min || 0) * 60000;
          const ov0 = Math.max(s0, startMs), ov1 = Math.min(e0, endMs);
          return ov1 > ov0 ? sum + (ov1 - ov0) / 60000 : sum;
        }, 0);
      };
      let totalNetAvailByMat = 0, totalRunMinByMat = 0;
      const matNosForA = Array.from(new Set(orders.map(o => o.mat_no)));
      matNosForA.forEach(matNo => {
        const matOrders = orders.filter(o => o.mat_no === matNo);
        const openedTimes = matOrders.map(o => o.opened_at).filter(Boolean).map(t => new Date(t).getTime());
        const closedTimes = matOrders.filter(o => o.status === 'confirmed' && o.confirmed_at).map(o => new Date(o.confirmed_at).getTime());
        const matStartMs = openedTimes.length ? Math.min(...openedTimes) : null;
        const matEndMs   = closedTimes.length ? Math.max(...closedTimes) : closedAt.getTime();
        if (matStartMs == null || matEndMs <= matStartMs) return;
        const windowMin = (matEndMs - matStartMs) / 60000;
        const matPolicyBreakMin = (breakPolicies || [])
          .filter(p => p.shift === 'both' || p.shift === s.shift)
          .filter(p => p.process_type === 'common' || p.process_type === s.dr_products?.process_type)
          .reduce((sum, p) => {
            const [ph, pm] = (p.start_time || '00:00').split(':').map(Number);
            let pStart = new Date(`${wDate}T${String(ph).padStart(2,'0')}:${String(pm).padStart(2,'0')}:00`);
            let pEnd = new Date(pStart.getTime() + p.duration_min * 60000);
            if (pStart.getTime() < matStartMs && pEnd.getTime() < matStartMs) {
              pStart = new Date(pStart.getTime() + 86400000);
              pEnd   = new Date(pEnd.getTime() + 86400000);
            }
            return sum + Math.max(0, (Math.min(pEnd.getTime(), matEndMs) - Math.max(pStart.getTime(), matStartMs)) / 60000);
          }, 0);
        const matLoggedPlanned   = dtOverlapMinLive(matStartMs, matEndMs, d => d.dr_downtime_types?.category === 'planned');
        const matLoggedUnplanned = dtOverlapMinLive(matStartMs, matEndMs, d => d.dr_downtime_types?.category !== 'planned');
        const matNetAvail = Math.max(0, windowMin - matPolicyBreakMin - matLoggedPlanned);
        const matRunMin   = Math.max(0, matNetAvail - matLoggedUnplanned);
        totalNetAvailByMat += matNetAvail;
        totalRunMinByMat   += matRunMin;
      });
      const A = totalNetAvailByMat > 0 ? Math.min(1, totalRunMinByMat / totalNetAvailByMat)
        : (netAvail > 0 ? Math.min(1, runMin / netAvail) : 0);
      // ไม่มี Cycle Time ของ MAT.NO ที่ผลิตเลย → P คำนวณไม่ได้ ห้าม default เป็น 100%
      const P = knownQty > 0 ? (runMin > 0 ? Math.min(1, producedMin / runMin) : 0) : null;
      const Q = produced > 0 ? Math.max(0, (produced - ngQty) / produced) : 1;
      const oee = P != null ? A * P * Q : null;
      return { A, P, Q, oee, runMin, netAvail, shiftMin };
    };

    const ps = (sessions || []).map(s => {
      const orders  = ordersBySession[s.id] || [];
      const active  = orders.filter(o => !['cancelled','imported'].includes(o.status));
      const demand  = active.reduce((sum, o) => sum + (o.qty || 0), 0);
      const actual  = active.filter(o => o.status === 'confirmed').reduce((sum, o) => sum + (o.qty_ok ?? o.qty ?? 0), 0);
      const target  = s.dr_products?.target_per_shift || 0;
      const oeeData = s.status === 'open' ? computeSessionOEE(s) : null;
      // downtime ที่กำลัง alarm (ยังไม่ปิดรายการ = เครื่องยังหยุดอยู่) — เฉพาะกะที่ยังไม่ปิด
      const activeDT = ['open', 'pending_close'].includes(s.status)
        ? (dtBySession[s.id] || []).filter(isAlarmingDT)
        : [];
      return { ...s, orders: active, demand, actual, target, oeeData, activeDT, dtLogs: dtBySession[s.id] || [] };
    });
    setProdStatus(ps);
  }, [boardDate]);

  const fetchAll = useCallback(async (date) => {
    setLoading(true);
    const [
      { data: logData },
      { data: fmData },
      { data: lineData },
      { data: orgNodeData },
      { data: empData },
      { data: scheduleData },
      { data: overrideData },
      { data: layoutData },
      { data: wsData },
      { data: hpData },
      { data: mpData },
    ] = await Promise.all([
      supabase.from('daily_production_logs')
        .select('id, is_present, has_helmet, has_boots, has_gloves, has_ot, has_extended_ot, shift, assigned_line, employees!inner(id, name, image_url, employee_id_code, line_id, team, is_active, employee_skills(skill_name, score))')
        .eq('work_date', date)
        .eq('employees.is_active', true),
      supabase.from('four_m_logs').select('*').eq('work_date', date).order('created_at', { ascending: false }),
      supabase.from('production_lines').select('id, name, section, std_day_shift, std_night_shift, parent_line_name').order('name'),
      supabase.from('org_nodes').select('code, name').eq('kind', 'section').eq('is_active', true).order('name'),
      supabase.from('employees').select('id, line_id, team').eq('is_active', true),
      supabase.from('shift_schedules').select('line_id, day_team').eq('work_date', date),
      supabase.from('shift_overrides').select('employee_id, shift').eq('work_date', date),
      supabase.from('line_layouts').select('line_name, image_url'),
      supabase.from('workstations').select('id, line_name, station_name, pos_top, pos_left, station_requirements(skill_name, min_score)'),
      supabase.from('employee_home_positions').select('employee_id, station_id, employees(id, name, image_url, position, employee_skills(skill_name, score))'),
      supabase.from('machine_points').select('id, line_name, machine_no, pos_top, pos_left'),
    ]);

    // Build per-line day_team map
    const lineSchedule = {};
    (scheduleData || []).forEach(s => { lineSchedule[s.line_id] = s.day_team; });

    // Build per-employee override map
    const empOverride = {};
    (overrideData || []).forEach(o => { empOverride[o.employee_id] = o.shift; });

    // Enrich logs with assignedShift (same logic as Checkin.jsx)
    const enriched = (logData || []).map(log => {
      const emp = log.employees;
      let assignedShift = null;
      if (emp) {
        if (empOverride[emp.id]) {
          assignedShift = empOverride[emp.id];
        } else if (emp.line_id && lineSchedule[emp.line_id]) {
          const dayTeam = lineSchedule[emp.line_id];
          const nightTeam = dayTeam === 'A' ? 'B' : 'A';
          assignedShift = emp.team === dayTeam ? 'day' : emp.team === nightTeam ? 'night' : null;
        }
      }
      return { ...log, assignedShift };
    });

    setLogs(enriched);
    setFourMLogs(fmData || []);
    setLines(lineData || []);
    setOrgSections((orgNodeData || []).map(n => n.code || n.name).sort());

    // Build line capacity using shift_schedules for correct day/night split
    const counts = {};
    (empData || []).forEach(emp => {
      if (!emp.line_id) return;
      if (!counts[emp.line_id]) counts[emp.line_id] = { day: 0, night: 0, all: 0 };
      counts[emp.line_id].all++;
      const dayTeam = lineSchedule[emp.line_id];
      if (!dayTeam) return;
      const nightTeam = dayTeam === 'A' ? 'B' : 'A';
      if (emp.team === dayTeam)   counts[emp.line_id].day++;
      else if (emp.team === nightTeam) counts[emp.line_id].night++;
    });
    setEmpCounts(counts);
    setLayouts(layoutData || []);
    setWorkstations(wsData || []);
    setMachinePoints(mpData || []);

    // Build skill fit lookups from NESTED data (same source as Management page,
    // avoids the 1000-row truncation that flat queries hit).
    // station_id → [{ skill_name, min_score }] from nested workstations
    const stationReqMap = {};
    (wsData || []).forEach(ws => {
      stationReqMap[String(ws.id)] = ws.station_requirements || [];
    });
    // employee_id → { skill_name: score } from nested employee_skills
    const empSkillMap = {};
    const addSkills = (emp) => {
      if (!emp?.id || empSkillMap[emp.id]) return;
      const m = {};
      (emp.employee_skills || []).forEach(s => { m[s.skill_name] = s.score; });
      empSkillMap[emp.id] = m;
    };
    (logData || []).forEach(l => addSkills(l.employees));
    (hpData || []).forEach(hp => addSkills(hp.employees));

    // Identical formula to Management.jsx computeFit: passed / total * 100
    const computeFit = (empId, stationId) => {
      const reqs = stationReqMap[String(stationId)];
      if (!reqs || reqs.length === 0) return null;
      const skills = empSkillMap[empId] || {};
      const passed = reqs.filter(r => Number(skills[r.skill_name] ?? 0) >= r.min_score).length;
      return Math.round((passed / reqs.length) * 100);
    };

    // Build stationEmpMap: station_id → employee + today's attendance + skill fit
    // Only present employees will be shown on the floor map
    const attMap = {};
    enriched.forEach(l => { if (l.employees?.id) attMap[l.employees.id] = l; });

    const semap = {};

    // 1st pass: home positions as baseline
    (hpData || []).forEach(hp => {
      if (!hp.employees) return;
      const att = attMap[hp.employee_id];
      semap[String(hp.station_id)] = {
        ...hp.employees,
        is_present:      att ? att.is_present      : null,
        has_ot:          att?.has_ot          ?? false,
        has_extended_ot: att?.has_extended_ot ?? false,
        has_helmet:      att?.has_helmet      ?? true,
        has_boots:       att?.has_boots       ?? true,
        has_gloves:      att?.has_gloves      ?? true,
        assignedShift:   att?.assignedShift   ?? null,
        fitScore:        computeFit(hp.employee_id, hp.station_id),
      };
    });

    // 2nd pass: override with today's actual assigned_line (same source as Management page)
    enriched.forEach(l => {
      if (!l.assigned_line || !l.employees?.id) return;
      const stId = String(l.assigned_line);
      semap[stId] = {
        id:              l.employees.id,
        name:            l.employees.name,
        image_url:       l.employees.image_url ?? null,
        position:        l.employees.position  ?? null,
        is_present:      l.is_present,
        has_ot:          l.has_ot          ?? false,
        has_extended_ot: l.has_extended_ot ?? false,
        has_helmet:      l.has_helmet      ?? true,
        has_boots:       l.has_boots       ?? true,
        has_gloves:      l.has_gloves      ?? true,
        assignedShift:   l.assignedShift   ?? null,
        fitScore:        computeFit(l.employees.id, l.assigned_line),
      };
    });
    setStationEmpMap(semap);
    setLoading(false);

    // ข้อมูลผลิต/OEE โหลดแยก (เบากว่า) — realtime จะอัปเดตเฉพาะส่วนนี้
    fetchProdStatus();
  }, [fetchProdStatus]);

  useEffect(() => { fetchAll(selectedDate); }, [selectedDate, fetchAll]);

  // Auto-refresh ข้อมูลหลักทุก 5 นาที (พนักงาน/กะ/ทักษะเปลี่ยนไม่บ่อย)
  useEffect(() => {
    const t = setInterval(() => fetchAll(selectedDate), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [selectedDate, fetchAll]);

  // Realtime refresh เฉพาะข้อมูลผลิต — debounce 1.5s กัน event รัวๆ ตอนสแกนหลายใบติดกัน
  useEffect(() => {
    let timer = null;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => fetchProdStatus(), 1500);
    };
    const ch = supabaseDR.channel('dash-dr')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prod_orders' },         refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'downtime_logs' },       refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'defect_logs' },         refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_sessions' }, refresh)
      .subscribe();
    return () => { clearTimeout(timer); supabaseDR.removeChannel(ch); };
  }, [fetchProdStatus]);

  // Determine OT windows based on current time (for live "today" view)
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const inDayOTWindow      = nowMin >= 17 * 60 + 30 && nowMin < 20 * 60;
  const inExtendedOTWindow = nowMin >= 20 * 60 && nowMin < 23 * 60;

  // mandatory scope filter (pattern มาตรฐาน — CLAUDE.md "Section/Line/Team Scoping"):
  // กรองก่อนเสมอ แล้วค่อยให้ dropdown section เลือกแคบลงทับอีกชั้น · user ไม่มี scope = เห็นหมดเหมือนเดิม
  const scopeActive = (role === 'leader' && !!userLineId) || (scopeSecs?.length > 0);
  const scopedLines = useMemo(() => {
    if (role === 'leader' && userLineId) {
      // เทียบ id ด้วย String() — lineId จาก profile อาจเป็นคนละ type กับ production_lines.id (pattern เดียวกับ EventLog)
      const myLine = lines.find(l => String(l.id) === String(userLineId));
      const fam = new Set(myLine ? getLineFamilyNames(lines, myLine.name) : []);
      return fam.size ? lines.filter(l => fam.has(l.name)) : lines;
    }
    if (scopeSecs?.length) return lines.filter(l => inSectionScope(scopeSecs, l.section));
    return lines;
  }, [lines, role, userLineId, scopeSecs]);

  const sections = useMemo(
    () => (!scopeActive && orgSections.length) ? orgSections : [...new Set(scopedLines.map(l => l.section).filter(Boolean))].sort(),
    [scopedLines, orgSections, scopeActive],
  );
  const visibleLines = useMemo(
    () => selectedSection === 'all' ? scopedLines : scopedLines.filter(l => l.section === selectedSection),
    [scopedLines, selectedSection],
  );
  const visibleLineNames = useMemo(() => new Set(visibleLines.map(l => l.name)), [visibleLines]);
  const visibleLineIds   = useMemo(() => new Set(visibleLines.map(l => l.id)), [visibleLines]);

  const passAll = !scopeActive && selectedSection === 'all'; // ไม่มี scope + ไม่เลือก section = ไม่ต้องกรอง (พฤติกรรมเดิม)
  const visibleFourMLogs = useMemo(
    () => passAll ? fourMLogs : fourMLogs.filter(f => visibleLineNames.has(f.line_name)),
    [fourMLogs, passAll, visibleLineNames],
  );
  const visibleProdStatus = useMemo(
    () => passAll ? prodStatus : prodStatus.filter(s => visibleLineNames.has(s.line_name)),
    [prodStatus, passAll, visibleLineNames],
  );
  const visibleLayouts = useMemo(
    () => passAll ? layouts : layouts.filter(l => visibleLineNames.has(l.line_name)),
    [layouts, passAll, visibleLineNames],
  );

  // ── Downtime alarm — รวม downtime ที่ยังค้าง/เพิ่งบันทึกจากทุกกะที่มองเห็น ──
  // ใช้ขับ banner ด้านบน, ป้ายบนการ์ดสถานะไลน์ และจุดเครื่องจักรกระพริบบนผัง
  const dtAlarmList = useMemo(
    () => visibleProdStatus.flatMap(s => (s.activeDT || []).map(d => ({ ...d, line_name: s.line_name, shift: s.shift }))),
    [visibleProdStatus],
  );
  const dtAlarmByMachine = useMemo(() => {
    const m = {};
    dtAlarmList.forEach(d => { if (d.machine_no) (m[d.machine_no] ||= []).push(d); });
    return m;
  }, [dtAlarmList]);
  const dtAlarmByLine = useMemo(() => {
    const m = {};
    dtAlarmList.forEach(d => { (m[d.line_name] ||= []).push(d); });
    return m;
  }, [dtAlarmList]);

  // ── Person alarm — คนกระพริบบนผัง: แดง = PPE ไม่ครบ, เหลือง = ย้ายจุดแล้ว 4M ยังรออนุมัติ ──
  const man4mPendingFor = useMemo(() => buildMan4mPendingMatcher(fourMLogs), [fourMLogs]);
  const personAlarmOf = useCallback((emp) => {
    if (!emp || emp.is_present !== true) return null;
    const ppeMiss = ppeMissingList(emp);
    if (ppeMiss.length) return { kind: 'red', icon: '⛑', label: `PPE ไม่ครบ (${ppeMiss.join(', ')})` };
    const pend = man4mPendingFor(emp.name);
    if (pend) return { kind: 'amber', icon: '⏳', label: `รออนุมัติ 4M — ${pend.description}` };
    return null;
  }, [man4mPendingFor]);

  // ไลน์ย่อย (เช่น HDF1, LASER123 ใต้ HYDROFORM) ที่ไม่มีรูปผังของตัวเอง — จริงๆ อยู่พื้นที่เดียวกับไลน์หลัก
  // ให้รวมจุดงาน/คนของมันเข้าไปในการ์ดของไลน์หลักแทนที่จะแยกการ์ด (ซึ่งจะไม่มีรูปให้แสดงอยู่แล้ว)
  const parentChildrenMap = useMemo(() => {
    const pcm = {};
    lines.forEach(l => {
      if (l.parent_line_name) (pcm[l.parent_line_name] ||= []).push(l.name);
    });
    return pcm;
  }, [lines]);
  const layoutLineNamesForCard = useCallback((layoutLineName) => {
    // ไล่ลงเป็นขั้น (รองรับย่อยซ้อนย่อย): ลูกที่ไม่มีผังของตัวเองถูกรวมเข้าการ์ดนี้แล้วไล่ต่อลงไป
    // ลูกที่มีผังของตัวเอง = มี card แยกของมันเอง จึงหยุดไล่สายนั้น (จุดของมันวางบนรูปของมันเอง)
    const names = [layoutLineName];
    const seen = new Set(names);
    const walk = (parentName) => {
      for (const child of parentChildrenMap[parentName] || []) {
        if (seen.has(child) || layouts.some(l => l.line_name === child)) continue;
        seen.add(child);
        names.push(child);
        walk(child);
      }
    };
    walk(layoutLineName);
    return names;
  }, [parentChildrenMap, layouts]);

  /* Filter by assignedShift — memoized so the 1s clock tick doesn't re-filter all logs */
  const shiftLogs = useMemo(
    () => {
      const base = selectedShift === 'all' ? logs : logs.filter(l => l.assignedShift === selectedShift);
      return passAll ? base : base.filter(l => visibleLineIds.has(l.employees?.line_id));
    },
    [logs, selectedShift, passAll, visibleLineIds],
  );

  const present  = useMemo(() => shiftLogs.filter(l =>  l.is_present), [shiftLogs]);
  const absent   = useMemo(() => shiftLogs.filter(l => !l.is_present), [shiftLogs]);
  const ppeReady = useMemo(() => present.filter(l => l.has_helmet && l.has_boots && l.has_gloves), [present]);
  const otCount  = useMemo(() => present.filter(l => l.has_ot).length, [present]);

  const shiftKey = selectedShift === 'all' ? 'all' : selectedShift;

  // Set of employee IDs to show on floor map — memoized, depends on logs/shift not clock
  const shiftEmpIds = useMemo(() => {
    if (selectedShift === 'all') return null;
    const ids = new Set(shiftLogs.map(l => l.employees?.id).filter(Boolean));
    if (selectedDate === workDateStr && selectedShift === 'night' && inExtendedOTWindow) {
      logs.filter(l => l.assignedShift === 'day' && l.has_extended_ot && l.is_present)
          .forEach(l => { if (l.employees?.id) ids.add(l.employees.id); });
    }
    return ids;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftLogs, logs, selectedShift, selectedDate, workDateStr, inExtendedOTWindow]);

  const lineStats = useMemo(() => visibleLines.map(line => {
    const lineLogs    = shiftLogs.filter(l => l.employees?.line_id === line.id);
    const linePresent = lineLogs.filter(l => l.is_present).length;
    const stdTotal = selectedShift === 'day'  ? (line.std_day_shift   || 0)
                   : selectedShift === 'night' ? (line.std_night_shift || 0)
                   : (line.std_day_shift || 0) + (line.std_night_shift || 0);
    // ไลน์ย่อยส่วนใหญ่ถูกตั้ง std ก็อปมาจากไลน์หลัก แต่พนักงานจริงผูกกับไลน์หลักหมด (ไลน์ย่อย = 0 คน)
    // → ไลน์ย่อยที่ไม่มีพนักงาน/ไม่มีคนเช็คชื่อของตัวเอง ให้ capacity = 0 กันตัวหารเฟ้อตอนรวมเข้าไลน์หลัก
    //   (เดิม HYDROFORM = 14 + 14×6 = 98) — ไลน์เดี่ยว/ไลน์หลักไม่กระทบ
    const isSubline    = !!line.parent_line_name;
    const hasOwnPeople = (empCounts[line.id]?.all ?? 0) > 0 || lineLogs.length > 0;
    const lineTotal = (isSubline && !hasOwnPeople)
      ? 0
      : (stdTotal > 0 ? stdTotal : (empCounts[line.id]?.[shiftKey] ?? lineLogs.length));
    const lineAlerts = fourMLogs.filter(f => f.line_name === line.name).length;
    const rate = lineTotal > 0 ? Math.round((linePresent / lineTotal) * 100) : 0;
    return { ...line, linePresent, lineTotal, lineAlerts, rate };
  }), [visibleLines, shiftLogs, selectedShift, empCounts, shiftKey, fourMLogs]);

  const totalCapacity = useMemo(() => lineStats.reduce((s, l) => s + l.lineTotal, 0) || shiftLogs.length, [lineStats, shiftLogs]);
  const attendRate    = useMemo(() => totalCapacity > 0 ? Math.round((present.length / totalCapacity) * 100) : 0, [totalCapacity, present]);
  const ppeRate       = useMemo(() => present.length > 0 ? Math.round((ppeReady.length / present.length) * 100) : 0, [present, ppeReady]);

  const isToday = selectedDate === workDateStr;

  return (
    <div className="page-content" style={{ maxWidth: '100%' }}>

      {/* ── Header ─────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28, gap: 16, flexWrap: 'wrap' }}>
        <motion.div {...stagger(0)}>
          <div style={{ fontSize: 'clamp(18px,3vw,24px)', fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text)', letterSpacing: '-0.5px' }}>
            Production Overview
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
            {selectedShift !== 'all' && (
              <span style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 13, fontWeight: 700,
                background: selectedShift === 'day' ? 'rgba(245,158,11,0.15)' : 'rgba(77,159,255,0.15)',
                color: selectedShift === 'day' ? '#f59e0b' : '#4d9fff',
                border: `1px solid ${selectedShift === 'day' ? 'rgba(245,158,11,0.3)' : 'rgba(77,159,255,0.3)'}`,
              }}>
                {selectedShift === 'day' ? '☀️ กะเช้า' : '🌙 กะดึก'}
                {isToday && selectedShift === (shiftInfo.isDay ? 'day' : 'night') && ' · กะปัจจุบัน'}
              </span>
            )}
            <span style={{ fontSize: 14, color: 'var(--muted)', fontFamily: 'var(--font-display)' }}>
              {isToday
                ? now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : selectedDate}
            </span>
          </div>
        </motion.div>

        <motion.div {...stagger(1)} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingRight: 52 }}>
          {/* Section filter — สำหรับจอ TV ดูเฉพาะส่วนงานตัวเอง */}
          {sections.length > 1 && (
            <select
              value={selectedSection}
              onChange={e => changeSection(e.target.value)}
              style={{
                background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 10,
                padding: '7px 12px', fontSize: 14, fontWeight: 700, color: 'var(--text)',
                cursor: 'pointer', outline: 'none',
              }}>
              <option value="all">🏭 ทุกส่วนงาน</option>
              {sections.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {/* Shift toggle */}
          <div style={{ display: 'flex', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 10, padding: 3, gap: 2 }}>
            {[
              { val: 'day',   label: '☀️ กะเช้า', active: 'rgba(245,158,11,0.2)', color: '#f59e0b' },
              { val: 'night', label: '🌙 กะดึก',  active: 'rgba(77,159,255,0.2)', color: '#4d9fff' },
              { val: 'all',   label: 'ทั้งหมด',    active: 'rgba(255,255,255,0.1)', color: 'var(--text2)' },
            ].map(s => (
              <button key={s.val} onClick={() => setSelectedShift(s.val)}
                style={{
                  padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
                  background: selectedShift === s.val ? s.active : 'transparent',
                  color: selectedShift === s.val ? s.color : 'var(--muted)',
                  transition: 'all 0.15s',
                }}>
                {s.label}
              </button>
            ))}
          </div>
          {/* Date picker */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--card)', border: '1px solid var(--border2)',
            padding: '8px 14px', borderRadius: 10,
          }}>
            <span style={{ fontSize: 15, color: 'var(--muted)' }}>📅</span>
            {/* width:'auto' กัน trap index.css input{width:100%} ใน flex row (ดู "กับดัก CSS" ใน CLAUDE.md) */}
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
              style={{ border: 'none', background: 'transparent', color: 'var(--accent)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, outline: 'none', padding: 0, width: 'auto' }} />
          </div>
        </motion.div>
      </div>

      {/* ── KPI Row ─────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: isWide ? 'repeat(5, 1fr)' : 'repeat(auto-fit, minmax(175px, 1fr))', gap: isMobile ? 10 : 14, marginBottom: 24 }}>
        {[
          {
            label: 'พนักงานทั้งหมด', value: totalCapacity, unit: 'คน',
            sub: `เช็คชื่อแล้ว ${present.length + absent.length} / ${totalCapacity} คน`,
            accent: '#4d9fff', icon: '👥',
            radial: null,
          },
          {
            label: 'อัตราการมาทำงาน', value: attendRate, unit: '%',
            sub: `มา ${present.length} · ขาด ${absent.length}`,
            accent: attendRate >= 90 ? '#22c55e' : attendRate >= 75 ? '#f59e0b' : '#e74c3c',
            icon: '✅', radial: attendRate,
          },
          {
            label: 'PPE ครบถ้วน', value: ppeRate, unit: '%',
            sub: `${ppeReady.length} / ${present.length} คนที่มา`,
            accent: ppeRate >= 90 ? '#22c55e' : ppeRate >= 70 ? '#f59e0b' : '#e74c3c',
            icon: '🦺', radial: ppeRate,
          },
          {
            label: 'OT วันนี้', value: otCount, unit: 'คน',
            sub: present.length > 0 ? `${Math.round(otCount/present.length*100)}% ของคนที่มา` : 'ไม่มีข้อมูล',
            accent: '#f59e0b', icon: '⏰', radial: null,
          },
          {
            label: '4M Alerts', value: visibleFourMLogs.length, unit: 'รายการ',
            sub: visibleFourMLogs.length > 0 ? `${[...new Set(visibleFourMLogs.map(f => f.line_name))].length} ไลน์ได้รับผลกระทบ` : 'ไม่มีการแจ้งเตือน',
            accent: visibleFourMLogs.length > 0 ? '#e74c3c' : '#22c55e', icon: '🚨', radial: null,
          },
        ].map((kpi, i) => (
          <motion.div key={kpi.label} {...stagger(i + 2)} style={{ height: '100%' }}>
            <div style={{
              background: 'var(--card)', border: '1px solid var(--border2)',
              borderRadius: 14, padding: isMobile ? '14px 14px' : isWide ? '22px 24px' : '18px 20px',
              boxShadow: 'var(--shadow-sm)',
              borderTop: `3px solid ${kpi.accent}`,
              display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'space-between',
              position: 'relative', overflow: 'hidden',
              height: '100%', boxSizing: 'border-box',
              minHeight: isMobile ? 120 : isWide ? 160 : 140,
            }}>
              <div style={{ position: 'absolute', top: 14, right: 16, opacity: 0.12, fontSize: isWide ? 56 : 42, lineHeight: 1, userSelect: 'none' }}>
                {kpi.icon}
              </div>
              <div style={{ fontSize: isWide ? 16 : 15, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {kpi.label}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 4 }}>
                {kpi.radial !== null ? (
                  <div style={{ position: 'relative', width: isWide ? 92 : 72, height: isWide ? 92 : 72, flexShrink: 0 }}>
                    <RadialProgress pct={kpi.radial} size={isWide ? 92 : 72} stroke={isWide ? 8 : 7} color={kpi.accent} />
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isWide ? 24 : 19, fontWeight: 800, color: kpi.accent, fontFamily: 'var(--font-display)' }}>
                      {kpi.value}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: isWide ? 54 : 44, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text)', lineHeight: 1 }}>
                    {loading ? '—' : kpi.value}
                    <span style={{ fontSize: isWide ? 22 : 18, fontWeight: 500, color: 'var(--text2)', marginLeft: 4 }}>{kpi.unit}</span>
                  </div>
                )}
              </div>
              <div style={{ fontSize: isWide ? 15 : 14, color: 'var(--muted)', marginTop: 2 }}>{kpi.sub}</div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* ── Downtime Alarm Banner — เครื่องจักรหยุด กระพริบเตือนทั้งแถบ ── */}
      {dtAlarmList.length > 0 && (
        <motion.div {...stagger(6)} className="dt-alarm-banner"
          style={{ border: '1px solid rgba(239,68,68,0.45)', borderRadius: 12, padding: isMobile ? '12px 14px' : '14px 18px', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span className="dt-alarm-icon" style={{ fontSize: 20 }}>🚨</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: '#ef4444', fontFamily: 'var(--font-display)' }}>
              เครื่องจักร Downtime {dtAlarmList.length} รายการ
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {dtAlarmList.map(d => {
              const elapsed = dtElapsedMin(d, now.getTime());
              return (
                <div key={d.id} style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8,
                  background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(239,68,68,0.4)',
                }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: '#fca5a5' }}>⚙️ {d.machine_no || d.line_name}</span>
                  <span style={{ fontSize: 13, color: 'var(--text2)' }}>{d.line_name}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#ef4444' }}>{d.dr_downtime_types?.name_th || 'Downtime'}</span>
                  {elapsed != null && (
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#fbbf24' }}>⏱ หยุดมาแล้ว {elapsed} นาที</span>
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* ── Line Status Grid ─────────────────────────────── */}
      {(() => {
        // ไลน์หลักที่มีไลน์ย่อย → รวมยอดคนของไลน์หลัก+ย่อยเข้าเป็นการ์ดเดียว (กันเลข "0/14" ซ้ำกันทุกไลน์ย่อย)
        // กดขยาย (▾) เพื่อดูการ์ดแยกของแต่ละไลน์ย่อยด้านล่างได้ ไม่บังคับโชว์ตลอด
        const childNames = new Set(lines.filter(l => l.parent_line_name).map(l => l.name));
        const renderOrder = [];
        lineStats.forEach(ls => {
          if (childNames.has(ls.name)) return;
          const childNamesForLs = parentChildrenMap[ls.name] || [];
          const childStats = childNamesForLs.map(childName => lineStats.find(l => l.name === childName)).filter(Boolean);
          if (childStats.length) {
            const combined = {
              ...ls,
              linePresent: ls.linePresent + childStats.reduce((s, c) => s + c.linePresent, 0),
              lineTotal:   ls.lineTotal   + childStats.reduce((s, c) => s + c.lineTotal, 0),
              lineAlerts:  ls.lineAlerts  + childStats.reduce((s, c) => s + c.lineAlerts, 0),
            };
            combined.rate = combined.lineTotal > 0 ? Math.round((combined.linePresent / combined.lineTotal) * 100) : 0;
            renderOrder.push({ ...combined, _isChild: false, _hasChildren: true, _children: childStats });
          } else {
            renderOrder.push({ ...ls, _isChild: false });
          }
        });
        const toggleExpand = (name) => setExpandedLines(prev => {
          const next = new Set(prev);
          if (next.has(name)) next.delete(name); else next.add(name);
          return next;
        });
        return (
          <motion.div {...stagger(7)} style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
              สถานะไลน์ผลิต
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isUltra ? 'repeat(auto-fill, minmax(250px, 1fr))' : isWide ? 'repeat(auto-fill, minmax(230px, 1fr))' : 'repeat(auto-fill, minmax(200px, 1fr))', gap: isMobile ? 10 : 14 }}>
              {renderOrder.flatMap((line, i) => {
                const healthy = line.rate >= 80 && line.lineAlerts === 0;
                const warn    = line.lineAlerts > 0 || (line.rate > 0 && line.rate < 80);
                const color   = healthy ? '#22c55e' : warn ? '#f59e0b' : '#555';
                const isExpanded = line._hasChildren && expandedLines.has(line.name);
                // downtime alarm ของไลน์นี้ + ไลน์ย่อยที่ถูกรวมเข้าการ์ดเดียวกัน
                const cardNames = [line.name, ...(line._children?.map(c => c.name) || [])];
                const cardDT = cardNames.flatMap(n => dtAlarmByLine[n] || []);
                // ป้าย 4M: แดงเมื่อยังมีรายการรออนุมัติ · เหลืองเมื่ออนุมัติครบแล้ว (เป็นแค่ประวัติวันนี้)
                const cardFMPending = fourMLogs.some(f => cardNames.includes(f.line_name) && f.status !== 'approved' && f.status !== 'rejected');
                const card = (
                  <motion.div key={line.id} {...stagger(8 + i)} style={{ height: '100%' }}>
                    <div
                      style={{
                        background: 'var(--card)',
                        border: '1px solid var(--border2)',
                        borderLeft: line._hasChildren ? '4px solid var(--accent)' : '1px solid var(--border2)',
                        borderRadius: 12, padding: isWide ? '18px 20px' : '14px 16px',
                        boxShadow: 'var(--shadow-sm)',
                        height: '100%', boxSizing: 'border-box',
                        minHeight: isWide ? 190 : 165,
                        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                      }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            {line._hasChildren && <span style={{ fontSize: 17 }}>📂</span>}
                            <div style={{ fontSize: isWide ? 19 : 17, fontWeight: 700, color: 'var(--text)', lineHeight: 1.25 }}>{line.name}</div>
                          </div>
                          {line.section && (
                            <div style={{ fontSize: isWide ? 14 : 13, color: '#4d9fff', marginTop: 2, fontWeight: 600 }}>
                              {line.section}{line._hasChildren && ` · รวม ${line._children.length} ไลน์ย่อย`}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}` }} />
                          {line.lineAlerts > 0 && (
                            <div onClick={() => setAndonLine({ title: line.name, names: cardNames })}
                              title="คลิกดูรายละเอียด 4M ที่แจ้งเตือน"
                              style={{
                                fontSize: 11, fontWeight: 800, padding: '2px 6px', borderRadius: 6, cursor: 'pointer',
                                background: cardFMPending ? 'rgba(231,76,60,0.15)' : 'rgba(245,158,11,0.15)',
                                color: cardFMPending ? '#e74c3c' : '#f59e0b',
                                border: `1px solid ${cardFMPending ? 'rgba(231,76,60,0.3)' : 'rgba(245,158,11,0.35)'}`,
                              }}>
                              {cardFMPending ? '🚨' : '🟡'} {line.lineAlerts}
                            </div>
                          )}
                          {cardDT.length > 0 && (
                            <div className="dt-alarm-blink" onClick={() => setAndonLine({ title: line.name, names: cardNames })}
                              title="คลิกดูรายละเอียดเครื่องจักรที่ Downtime"
                              style={{ fontSize: 11, fontWeight: 800, padding: '2px 6px', borderRadius: 6, color: '#fff', border: '1px solid #ef4444', cursor: 'pointer' }}>
                              ⚙️ DT {cardDT.length}
                            </div>
                          )}
                        </div>
                      </div>
                      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ fontSize: isWide ? 42 : 34, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
                          {line.linePresent}
                        </span>
                        <span style={{ fontSize: isWide ? 17 : 15, color: 'var(--muted)' }}>/ {line.lineTotal} คน{line._hasChildren && ' (รวมย่อย)'}</span>
                      </div>
                      <MiniBar value={line.linePresent} max={line.lineTotal} color={color} />
                      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: isWide ? 15 : 14, fontWeight: 700, color }}>
                          {line.lineTotal === 0 ? 'ไม่มีข้อมูล' : `${line.rate}% Attendance ${healthy ? '· ✓ Normal' : line.lineAlerts > 0 ? '· ⚠ Risk' : ''}`}
                        </span>
                        {line._hasChildren && (
                          <button onClick={() => toggleExpand(line.name)}
                            style={{
                              fontSize: 13, fontWeight: 800, color: 'var(--accent)', whiteSpace: 'nowrap',
                              display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                              background: 'var(--accent-dim)', border: '1px solid var(--accent)',
                              borderRadius: 7, padding: '4px 10px',
                            }}>
                            {isExpanded ? 'ซ่อนไลน์ย่อย' : 'ดูไลน์ย่อย'}
                            <span style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
                if (!isExpanded) return [card];
                const nested = (
                  <motion.div key={`${line.id}-children`} {...stagger(8 + i)} style={{ gridColumn: '1 / -1' }}>
                    <div style={{
                      background: 'var(--bg2)',
                      border: '1px dashed var(--border2)',
                      borderLeft: '4px solid var(--accent)',
                      borderRadius: 12, padding: isWide ? '14px 16px' : '12px 14px',
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span>↳ ไลน์ย่อยของ</span>
                        <span style={{ color: 'var(--accent)' }}>{line.name}</span>
                        <span>({line._children.length})</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: isUltra ? 'repeat(auto-fill, minmax(180px, 1fr))' : isWide ? 'repeat(auto-fill, minmax(170px, 1fr))' : 'repeat(auto-fill, minmax(150px, 1fr))', gap: isMobile ? 8 : 12 }}>
                        {line._children.map((cs) => {
                          const cHealthy = cs.rate >= 80 && cs.lineAlerts === 0;
                          const cWarn    = cs.lineAlerts > 0 || (cs.rate > 0 && cs.rate < 80);
                          const cColor   = cHealthy ? '#22c55e' : cWarn ? '#f59e0b' : '#555';
                          const csDT     = dtAlarmByLine[cs.name] || [];
                          const csFMPending = fourMLogs.some(f => f.line_name === cs.name && f.status !== 'approved' && f.status !== 'rejected');
                          return (
                            <div key={cs.id} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: isWide ? '12px 14px' : '10px 12px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div>
                                  <span style={{ fontSize: 11, fontWeight: 800, color: '#4d9fff', background: 'rgba(77,159,255,0.12)', border: '1px solid rgba(77,159,255,0.3)', borderRadius: 4, padding: '1px 5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>ไลน์ย่อย</span>
                                  <div style={{ fontSize: isWide ? 15 : 14, fontWeight: 600, color: 'var(--text)', marginTop: 4 }}>{cs.name}</div>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: cColor, boxShadow: `0 0 6px ${cColor}` }} />
                                  {cs.lineAlerts > 0 && (
                                    <div onClick={() => setAndonLine({ title: cs.name, names: [cs.name] })}
                                      title="คลิกดูรายละเอียด 4M ที่แจ้งเตือน"
                                      style={{
                                        fontSize: 11, fontWeight: 800, padding: '2px 6px', borderRadius: 6, cursor: 'pointer',
                                        background: csFMPending ? 'rgba(231,76,60,0.15)' : 'rgba(245,158,11,0.15)',
                                        color: csFMPending ? '#e74c3c' : '#f59e0b',
                                        border: `1px solid ${csFMPending ? 'rgba(231,76,60,0.3)' : 'rgba(245,158,11,0.35)'}`,
                                      }}>
                                      {csFMPending ? '🚨' : '🟡'} {cs.lineAlerts}
                                    </div>
                                  )}
                                  {csDT.length > 0 && (
                                    <div className="dt-alarm-blink" onClick={() => setAndonLine({ title: cs.name, names: [cs.name] })}
                                      title="คลิกดูรายละเอียดเครื่องจักรที่ Downtime"
                                      style={{ fontSize: 11, fontWeight: 800, padding: '2px 6px', borderRadius: 6, color: '#fff', border: '1px solid #ef4444', cursor: 'pointer' }}>
                                      ⚙️ DT {csDT.length}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                <span style={{ fontSize: isWide ? 26 : 20, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>{cs.linePresent}</span>
                                <span style={{ fontSize: isWide ? 14 : 12, color: 'var(--muted)' }}>/ {cs.lineTotal} คน</span>
                              </div>
                              <MiniBar value={cs.linePresent} max={cs.lineTotal} color={cColor} />
                              <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: cColor }}>
                                {cs.lineTotal === 0 ? 'ไม่มีข้อมูล' : `${cs.rate}% Attendance ${cHealthy ? '· ✓ Normal' : cs.lineAlerts > 0 ? '· ⚠ Risk' : ''}`}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </motion.div>
                );
                return [card, nested];
              })}
            </div>
          </motion.div>
        );
      })()}

      {/* ── Heijunka Timeline Board ───────────────────── */}
      {visibleProdStatus.length > 0 && (() => {
        const HOURS   = [8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,0,1,2,3,4,5,6,7];
        const LEFT_W  = isMobile ? 120 : 175; // ป้ายพาร์ทใหญ่ (รูป 44px + ชื่อ 2 บรรทัด) — มือถือแคบลง + บอร์ดเลื่อนแนวนอน
        const nowMs   = now.getTime();

        const wd = visibleProdStatus[0]?.work_date || boardDate;
        const gridStartMs = new Date(`${wd}T08:00:00`).getTime();
        const gridEndMs   = gridStartMs + 24 * 3600000;
        const isHistorical = nowMs >= gridEndMs;   // ดูวันย้อนหลัง — วันงานนั้นจบไปแล้ว
        const isFutureDay  = nowMs < gridStartMs;

        const fmtMs = (ms) => {
          const d = new Date(ms);
          return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        };

        // group sessions by line — sub-lines fold under parent
        const childParentMap = {};
        lines.forEach(l => { if (l.parent_line_name) childParentMap[l.name] = l.parent_line_name; });
        const byLine = {};
        visibleProdStatus.forEach(s => {
          const key = childParentMap[s.line_name] || s.line_name;
          (byLine[key] = byLine[key] || []).push(s);
        });

        const shiftDate = (days) => {
          const d = new Date(`${boardDate}T12:00:00`);
          d.setDate(d.getDate() + days);
          setBoardDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
        };
        const todayStr = getWorkDateStr(new Date());
        const dateBtn = {
          padding: '4px 10px', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 700,
          background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text2)', fontFamily: 'var(--font-body)',
        };

        return (
          <motion.div {...stagger(8)} style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                📊 Heijunka Board — ไทม์ไลน์การผลิต
                {isHistorical && <span style={{ marginLeft: 8, fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'rgba(168,85,247,0.15)', color: '#a855f7', letterSpacing: 0 }}>📅 ย้อนหลัง {boardDate}</span>}
                {isFutureDay && <span style={{ marginLeft: 8, fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'rgba(148,163,184,0.15)', color: 'var(--muted)', letterSpacing: 0 }}>📅 ล่วงหน้า {boardDate}</span>}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button onClick={() => shiftDate(-1)} style={dateBtn}>◀</button>
                {/* width ต้องกำหนดเอง — index.css ตั้ง input width:100% ทั้งแอป ถ้าปล่อยไว้ช่องวันที่จะกินเต็มแถวจนปุ่มแตกบรรทัด */}
                <input type="date" value={boardDate} max={todayStr} onChange={e => e.target.value && setBoardDate(e.target.value)}
                  style={{ width: 148, padding: '4px 8px', borderRadius: 7, fontSize: 13, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--font-body)' }} />
                <button onClick={() => shiftDate(1)} disabled={boardDate >= todayStr} style={{ ...dateBtn, opacity: boardDate >= todayStr ? 0.4 : 1, cursor: boardDate >= todayStr ? 'default' : 'pointer' }}>▶</button>
                {boardDate !== todayStr && (
                  <button onClick={() => setBoardDate(todayStr)} style={{ ...dateBtn, background: 'var(--accent)', color: '#08130a', border: '1px solid var(--accent)' }}>วันนี้</button>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12, padding: '6px 10px', background: 'var(--bg2)', borderRadius: 8, border: '1px solid var(--border2)' }}>
              {[
                { c: '#4d9fff', icon: '▶', label: 'กำลังผลิต' },
                { c: '#22c55e', icon: '✓', label: 'เสร็จแล้ว' },
                { c: '#f97316', icon: '✓!', label: 'เสร็จ (ปิดช้ากว่ากำหนด)' },
                { c: '#ef4444', icon: '!', label: 'ล่าช้า' },
                { c: '#f59e0b', icon: '↷', label: 'ยกยอดข้ามกะ' },
                { c: '#6b7280', icon: '⏪', label: 'ยิงย้อนหลัง (backfill)' },
                { c: '#ef4444', icon: '⛔', label: 'Downtime (แถบบนแถว)' },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 16, height: 16, borderRadius: 3, background: `${item.c}28`, border: `1.5px solid ${item.c}cc`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: item.c, flexShrink: 0 }}>{item.icon}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>{item.label}</span>
                </div>
              ))}
            </div>

            {Object.entries(byLine).map(([lineName, sessions]) => {
              const hasOpen = sessions.some(s => s.status === 'open');
              const totalDelayed = sessions.reduce((acc, s) => {
                const ctSec = s.dr_products?.cycle_time_sec || 0;
                if (!ctSec || s.status !== 'open') return acc;
                const startMs = s.created_at ? new Date(s.created_at).getTime() : null;
                if (!startMs) return acc;
                let cum = 0;
                s.orders.forEach(o => {
                  cum += (o.qty || 0) * ctSec;
                  if (o.status === 'open' && nowMs > startMs + cum * 1000) acc++;
                });
                return acc;
              }, 0);

              return (
                <div key={lineName} style={{
                  marginBottom: 16,
                  background: 'var(--card)',
                  border: `1px solid ${totalDelayed > 0 ? 'rgba(239,68,68,0.45)' : hasOpen ? 'rgba(34,197,94,0.35)' : 'var(--border2)'}`,
                  borderRadius: 12, overflow: 'hidden',
                  boxShadow: totalDelayed > 0 ? '0 0 0 1px rgba(239,68,68,0.12)' : hasOpen ? '0 0 0 1px rgba(34,197,94,0.08)' : 'none',
                }}>

                  {/* ── Line header ── */}
                  <div style={{ padding: '9px 14px', borderBottom: '1px solid var(--border2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>{lineName}</span>
                      {totalDelayed > 0 && (
                        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 20, fontWeight: 700, background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>
                          ⚠️ ดีเลย์ {totalDelayed} ใบ
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {/* hierarchy: ยุบป้ายกะเป็น 1 ชิปต่อไลน์ย่อย (☀️/🌙 อยู่ในชิปเดียวกัน) แทนป้ายต่อ session ที่รกเมื่อมีหลายไลน์ลูก */}
                      {(() => {
                        const byChild = {};
                        sessions.forEach(s => { (byChild[s.line_name] = byChild[s.line_name] || []).push(s); });
                        const names = Object.keys(byChild).sort();
                        const multi = names.length > 1 || (names.length === 1 && names[0] !== lineName);
                        return names.map(ln => {
                          const list = [...byChild[ln]].sort((a, b) => (a.shift === b.shift ? 0 : a.shift === 'day' ? -1 : 1));
                          const anyOpen = list.some(s => s.status === 'open');
                          return (
                            <span key={ln} style={{ fontSize: 12, padding: '2px 8px', borderRadius: 20, fontWeight: 700,
                              background: anyOpen ? 'rgba(34,197,94,0.15)' : 'rgba(128,128,128,0.12)',
                              color: anyOpen ? '#22c55e' : '#888' }}>
                              {multi && <span style={{ fontWeight: 800 }}>{ln} · </span>}
                              {list.map(s => `${s.shift === 'day' ? '☀️' : '🌙'}${s.status === 'open' ? '●' : '✓'}`).join(' ')}
                              {anyOpen ? ' Live' : ' ปิดแล้ว'}
                            </span>
                          );
                        });
                      })()}
                    </div>
                  </div>

                  {/* ── Timeline grid: split 24h → 2 rows × 12h, แยกแถวตาม product ── */}
                  {(() => {
                    const pctPerMs = 100 / (12 * 3600000);
                    const HALVES = [
                      { key: 'am', hours: HOURS.slice(0, 12), startMs: gridStartMs },
                      { key: 'pm', hours: HOURS.slice(12), startMs: gridStartMs + 12 * 3600000 },
                    ];

                    // flatten ทุกออเดอร์ของทุก session ในไลน์ พร้อม timing + product key
                    const buildCards = (sessList) => {
                      const cards = [];
                      sessList.forEach(s => {
                        const sessionCtSec = s.dr_products?.cycle_time_sec || 0;
                        const sessionStartMs = s.created_at ? new Date(s.created_at).getTime() : null;
                        // ใบที่ status = carry_over คือใบเดิมที่ถูกยกยอดไปต่อในกะถัดไปแล้ว (มีใบใหม่ status='open'
                        // พร้อม carry_over_from_session_id ชี้กลับมา) — ถ้าแสดงทั้งสองใบจะเห็นเป็นกัมบังซ้ำกัน
                        // ข้ามกะเช้า/กะดึก ทั้งที่เป็นงานเดียวกัน จึงตัดใบเดิม (carry_over) ออกจาก timeline
                        const sorted = [...s.orders].filter(o => o.status !== 'carry_over').sort((a, b) => new Date(a.opened_at || 0) - new Date(b.opened_at || 0));
                        let cumSec = 0;
                        sorted.forEach(o => {
                          // session.dr_products มาจาก product_id ที่อาจไม่ถูกตั้งค่า (กะนึงมีได้หลาย mat_no)
                          // จึง fallback ไปหา cycle_time_sec ตรงจาก mat_no ของออเดอร์เอง
                          const ctSec = ctByMatNo[o.mat_no] || sessionCtSec || 0;
                          // ถ้ามี opened_at ใช้เวลาจริงเป็น start แทนการสะสมจาก session start
                          const openedMs = o.opened_at ? new Date(o.opened_at).getTime() : null;
                          const startSec = cumSec;
                          cumSec += (o.qty || 0) * ctSec;
                          let orderStartMs = openedMs || (sessionStartMs && ctSec > 0 ? sessionStartMs + startSec * 1000 : null);
                          let orderEndMs   = orderStartMs && ctSec > 0 ? orderStartMs + (o.qty || 0) * ctSec * 1000 : null;
                          if (orderStartMs && !orderEndMs) {
                            // ไม่รู้ cycle time จริง ๆ — ให้แสดงเป็นแท่งบาง ๆ แทนการซ่อนไปเลย
                            orderEndMs = orderStartMs + 5 * 60000;
                          }
                          const isDone    = o.status === 'confirmed';
                          const isCarry   = o.status === 'carry_over';
                          const isDelayed = !isDone && !isCarry && !!orderEndMs && nowMs > orderEndMs;
                          const productKey = (nameByMatNo[o.mat_no] || s.dr_products?.name || '').trim().toUpperCase() || o.mat_no || 'unknown';
                          const productLabel = nameByMatNo[o.mat_no] || s.dr_products?.name || o.mat_no || 'ไม่ทราบ P/N';
                          const productImg = imgByMatNo[o.mat_no] || '';
                          cards.push({ ...o, orderStartMs, orderEndMs, isDone, isCarry, isDelayed, productKey, productLabel, productImg, shift: s.shift, sessionOpen: s.status === 'open', line_name: s.line_name });
                        });
                      });
                      return cards;
                    };

                    const allCards = buildCards(sessions);

                    // ── Downtime ของไลน์นี้ (จาก downtime_logs ทุก session ของวันนั้น) ──
                    // ใช้วาดแถบ ⛔ บนไทม์ไลน์ และผูกเข้า tooltip ของใบที่ดีเลย์/ปิดช้า เพื่อบอก "สาเหตุ" ของการหลุดแผน
                    // การ์ดไลน์แม่รวมหลาย sub-line (เช่น Line 60 + Line 61) — ต้องจำว่า downtime เป็นของ
                    // sub-line ไหน ไม่งั้นเหตุของไลน์หนึ่งจะไปโผล่เป็น "สาเหตุ" บนแถว/tooltip ของอีกไลน์
                    const dtWindows = sessions.flatMap(s => (s.dtLogs || []).map(d => {
                      const ds = d.started_at ? new Date(d.started_at).getTime() : null;
                      if (ds == null) return null;
                      const de = d.ended_at ? new Date(d.ended_at).getTime() : ds + (d.duration_min || 0) * 60000;
                      return {
                        s: ds, e: Math.max(de, ds + 60000), name: d.dr_downtime_types?.name_th || 'Downtime',
                        machine: d.machine_no || '', desc: d.description || '',
                        planned: d.dr_downtime_types?.category === 'planned',
                        min: d.duration_min || Math.round((de - ds) / 60000),
                        line_name: s.line_name,
                      };
                    }).filter(Boolean)).sort((a, b) => a.s - b.s);
                    // การ์ดนี้มีหลาย sub-line มั้ย — ถ้ามี ให้ระบุชื่อไลน์กำกับใน label กันอ่านแล้วสับสน
                    const multiSubLine = new Set(sessions.map(s => s.line_name)).size > 1;
                    const dtLabel = (w) => `⛔ ${multiSubLine && w.line_name ? `[${w.line_name}] ` : ''}${w.name}${w.machine ? ` @${w.machine}` : ''} ${fmtMs(w.s)}–${fmtMs(w.e)} (${w.min}น.)${w.desc ? ` — ${w.desc}` : ''}`;
                    // downtime ที่คาบเกี่ยวช่วงเวลา [a,b] ของใบกัมบัง — เฉพาะของ sub-line เดียวกับใบนั้น
                    const dtTooltip = (a, b, lineName) => {
                      const hits = dtWindows.filter(w => w.s < b && w.e > a && (!lineName || w.line_name === lineName));
                      return hits.length
                        ? ` · สาเหตุที่เป็นไปได้: ${hits.map(dtLabel).join(' · ')}`
                        : ' · ไม่มีบันทึก downtime ในช่วงนี้';
                    };

                    // แยกแถวตามชื่อ product (ไม่ใช่ mat_no) — เพื่อไม่ให้ product ต่างกัน (เช่น RH60 / LH61) ปนแถวเดียวกัน
                    // แต่ part เดียวกันที่ต่าง mat_no/customer เท่านั้น (เช่น FVL/FTM/AAT) ให้รวมแถวเดียว
                    // การ์ดไลน์แม่รวมหลาย sub-line: product ชื่อเดียวกันที่ผลิต "คนละไลน์" (เช่น REINF FRT FNDR
                    // ใบ manual ที่ HDF1 กับใบสแกนที่ HDF2) ต้องแยกคนละแถวด้วย — คิวคาดการณ์ต่อแถวถือว่าเป็น
                    // เครื่องเดียวกัน ถ้ารวมกันใบจะถูกต่อคิวข้ามไลน์ เวลาคาดเสร็จ/ดีเลย์ผิดทั้งแถว
                    const groups = {};
                    allCards.forEach(c => {
                      const rowKey = multiSubLine ? `${c.line_name || ''}|${c.productKey}` : c.productKey;
                      (groups[rowKey] = groups[rowKey] || { key: rowKey, label: c.productLabel, img: c.productImg, line: c.line_name, cards: [] }).cards.push(c);
                    });
                    const productRows = Object.values(groups).sort((a, b) => a.label.localeCompare(b.label) || String(a.line || '').localeCompare(String(b.line || '')));

                    // ช่วง break_policies ที่ตรงกับ half นี้ (เป็น [startMs, endMs]) — ใช้ทั้งวาดแถบและกันการ์ดวางทับเวลาพัก
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

                    // ต่อคิวในแถวเดียวกัน + หลบเวลาพัก แล้วคืนตำแหน่งจริงพร้อม isDelayed ที่คำนวณจากเวลาจบ "จริง" หลังต่อคิว
                    // (ไม่ใช้ o.isDelayed ที่คำนวณแบบ naive จาก opened_at + cycle time เพราะการ์ดที่ถูกต่อคิวหรือเลื่อนหลบเบรค
                    //  จะมี orderEndMs เดิมที่ผ่านไปแล้วทั้งที่ยังไม่ถึงคิวจริง ทำให้ขึ้นแดงทั้งที่ยังไม่ถึงเวลา)
                    // จัดกลุ่มการ์ดเป็น "รอบสแกน" ทุก 2 ชม. ตามเวลาเปิดจริง (ตายตัวทั้งกะเช้า/กะดึก) ต่อเนื่องตลอด 24 ชม.
                    // เพื่อจำกัดผลของดีเลย์ให้อยู่แค่ในรอบของตัวเอง ไม่ลากคิวยาวไปทั้งกะ
                    // (พนักงานสแกนปิดไม่เรียงเลขใบ แต่จะอยู่ในรอบเดียวกันเสมอ — ตัด FIFO ข้ามรอบออก)
                    const ROUND_MS = 2 * 3600000;
                    const roundIndexOf = (ms) => Math.floor((ms - gridStartMs) / ROUND_MS);
                    const roundStartOf = (idx) => gridStartMs + idx * ROUND_MS;
                    const MIN_W_PCT = 1.5;

                    // รวมเวลาพักทั้งวัน (กะเช้า+กะดึก) เพื่อให้คิวต่อเนื่องข้ามกะได้ถ้าดีเลย์ล้นจากกะเช้าไปกะดึก
                    const allBreaksOnce = () => [...getBreakIntervals(HALVES[0]), ...getBreakIntervals(HALVES[1])].sort((a, b) => a[0] - b[0]);

                    // คำนวณคิวทั้งวัน (24 ชม.) ครั้งเดียวต่อแถว product แทนการตัดแยกทีละกะ
                    // เพื่อให้การ์ดที่ดีเลย์ล้นข้ามกะ (เช่น ผลิตจากกะเช้าไปจบกะดึก) ต่อแถวเดิมได้ ไม่ถูกตัดทิ้งที่ขอบกะ
                    const computeQueuedPositionsFull = (cards) => {
                      const breaks = allBreaksOnce();
                      const filtered = cards.filter(o => o.orderStartMs && o.orderEndMs);
                      const byOpenTime = [...filtered].sort((a, b) => a.orderStartMs - b.orderStartMs);
                      // คิวแสดงผลจริง: ใบที่ "ปิดแล้ว" (confirm) คือลำดับการผลิตที่เกิดขึ้นจริง ให้แทรกเข้าคิวก่อนตามเวลาปิดจริง
                      // (confirmed_at) เสมอ — ใบที่ "ยังไม่ปิด" ถือว่ายังไม่ถึงตาที่ผลิตจริง ต้องถีบไปต่อท้ายคิวเสมอ ไม่ว่าจะ
                      // เปิดมาก่อนนานแค่ไหนก็ตาม ผลคือถ้ามีใบ confirm มาแทรก จะดันใบที่ยังไม่ปิดถอยไปอยู่หลังสุด ไม่บังพื้นที่
                      // ของใบที่ทำสำเร็จไปแล้วจริง ๆ — ทำให้เหลือใบแดง (ยังไม่ปิด) แค่เท่าที่จำเป็นจริง ๆ
                      const doneCards = filtered.filter(o => o.isDone && o.confirmed_at)
                        .sort((a, b) => new Date(a.confirmed_at).getTime() - new Date(b.confirmed_at).getTime() || a.orderStartMs - b.orderStartMs);
                      const openCards = filtered.filter(o => !(o.isDone && o.confirmed_at))
                        .sort((a, b) => a.orderStartMs - b.orderStartMs);
                      const sorted = [...doneCards, ...openCards];
                      // ── ชุดสแกนปิดรวด (batch confirm) ──────────────────────────────────────
                      // เครื่องจักรยังไม่ส่งสัญญาณจบทีละใบ พนักงานจึงสแกนปิดทั้งล็อตรวดเดียว (เช่น 9 ใบติดกัน)
                      // ถ้าตัดสิน "ปิดช้า" รายใบจาก confirmed_at ใบแรก ๆ ของชุดจะกลายเป็นส้มเกินจริงเสมอ
                      // จึงจัดกลุ่มใบที่สแกนห่างกันไม่เกิน 5 นาทีเป็นชุดเดียว แล้วตัดสินความช้าที่ใบสุดท้ายของชุด
                      // (เทียบเวลาสแกนจบชุด กับเวลาจบตามทฤษฎีของงานทั้งชุด)
                      const BATCH_GAP_MS = 5 * 60000;
                      const batchIdOf = new Map();
                      let curBatchId = 0;
                      doneCards.forEach((o, i) => {
                        if (i > 0 && new Date(o.confirmed_at).getTime() - new Date(doneCards[i - 1].confirmed_at).getTime() > BATCH_GAP_MS) curBatchId++;
                        batchIdOf.set(o, curBatchId);
                      });
                      const batchCount = new Map();
                      doneCards.forEach(o => { const b = batchIdOf.get(o); batchCount.set(b, (batchCount.get(b) || 0) + 1); });
                      const batchSeen = new Map();
                      // เงื่อนไขผสม: ใบที่ยังไม่ปิด+เกินเวลาจะตีแดงก็ต่อเมื่อ "ยอดรวมจริงของแถวนี้ยังไม่ทันเป้าตามเวลา" ด้วย
                      // ถ้ายอดรวมทันเป้าอยู่ (แค่สแกนปิดไม่ตรง FIFO) จะไม่ตีแดง เพราะงานยังผลิตได้ตามแผนจริง
                      const ctSec = ctByMatNo[byOpenTime[0]?.mat_no] || 0;
                      const rowActualQty = cards.reduce((a, c) => a + (c.isDone ? (c.qty_ok ?? c.qty ?? 0) : (c.qty_actual ?? 0)), 0);
                      const firstStartMs = byOpenTime.length ? byOpenTime[0].orderStartMs : null;
                      let expectedQty = Infinity;
                      if (ctSec > 0 && firstStartMs) {
                        let elapsedMs = Math.max(0, Math.min(nowMs, firstStartMs + 24 * 3600000) - firstStartMs);
                        breaks.forEach(([bs, be]) => {
                          const os = Math.max(bs, firstStartMs), oe = Math.min(be, nowMs);
                          if (oe > os) elapsedMs -= (oe - os);
                        });
                        expectedQty = Math.max(0, elapsedMs) / 1000 / ctSec;
                      }
                      const rowBehindPace = rowActualQty < expectedQty;
                      let queueEndMs = -Infinity;
                      let curRoundIdx = null;
                      return sorted.map(o => {
                        const roundIdx = roundIndexOf(o.orderStartMs);
                        if (curRoundIdx === null || roundIdx !== curRoundIdx) {
                          // ข้ามไปรอบใหม่ — รีเซ็ตคิวไปต้นรอบ "เฉพาะตอนที่ใบก่อนหน้าปิดไปแล้วจริง ๆ ก่อนรอบนี้"
                          // ถ้าใบก่อนหน้ายังครองไลน์อยู่ข้ามเข้ามาในรอบนี้ (queueEndMs ล้ำเข้ามา) ห้ามดันกลับไปต้นรอบ
                          // เด็ดขาด เพราะ 1 ไลน์ผลิตได้ทีละใบเท่านั้น แถบจะซ้อนทับกันไม่ได้ไม่ว่ากรณีใด
                          curRoundIdx = roundIdx;
                          queueEndMs = Math.max(queueEndMs, roundStartOf(roundIdx));
                        }
                        const durationMs = Math.max(o.orderEndMs - o.orderStartMs, 0);
                        let startMs = Math.max(o.orderStartMs, queueEndMs);
                        let endMs = startMs + durationMs;
                        // ถ้าช่วงเวลาผลิตของการ์ดนี้ทับเวลาพักเบรค ไม่เลื่อน startMs ไปหลังเบรค (เพราะจะทำให้
                        // เวลาที่ "ว่าง" ก่อนเบรคเสียไปฟรี ๆ) แต่ให้ "ซอย" ทับเบรคแล้วยืดความยาวการ์ดออกแทน
                        // เพราะช่วงเวลาที่ทับเบรคนั้นผลิตงานไม่ได้จริง ๆ ต้องนับเป็นเวลาที่ครองไลน์เพิ่ม
                        const consumedBreaks = new Set();
                        let extended = true;
                        while (extended) {
                          extended = false;
                          breaks.forEach(([bs, be], i) => {
                            if (consumedBreaks.has(i)) return;
                            if (bs < endMs && be > startMs) {
                              consumedBreaks.add(i);
                              endMs += (be - bs);
                              extended = true;
                            }
                          });
                        }
                        // กฎตายตัว: ใบกัมบังห้ามซ้อนทับกันเอง และความกว้างต้องไม่สั้นกว่า durationMs (qty × ct) เด็ดขาด
                        // ดังนั้นถ้าปิดงานเร็วกว่าทฤษฎี (confirmed_at < endMs) จะไม่บีบ/เลื่อนตำแหน่งตาม confirmed_at เลย —
                        // ปล่อยให้การ์ดอยู่ตามคิว (queueFloor + durationMs) เหมือนเดิม ใช้ confirmed_at แค่ตัดสินสี/ไอคอนเท่านั้น
                        // ส่วนกรณีปิดงานช้ากว่าทฤษฎี (isLateDone) ปล่อยให้ endMs เดิม + แสดง "หาง" ของความช้าแยกต่างหาก (ไม่ขยับการ์ดหลัก)
                        // ปิดช้า: ใบเดี่ยวตัดสินตามเดิม · ใบในชุดสแกนรวดเดียวตัดสินเฉพาะใบสุดท้ายของชุด
                        // (ใบแรก ๆ ของชุดถือว่าจบตามคิวทฤษฎี เพราะเวลาสแกนไม่ใช่เวลาผลิตจบจริงของใบนั้น)
                        let isLateDone = false;
                        if (o.isDone && o.confirmed_at) {
                          const bid = batchIdOf.get(o);
                          const size = batchCount.get(bid) || 1;
                          const seen = (batchSeen.get(bid) || 0) + 1;
                          batchSeen.set(bid, seen);
                          if (size === 1 || seen === size)
                            isLateDone = new Date(o.confirmed_at).getTime() > endMs + (size > 1 ? BATCH_GAP_MS : 0);
                        }
                        // เวลาที่ "ครองไลน์" จริง สำหรับผลักคิวถัดไป (ไม่ใช่แค่เวลาจบตามแผน):
                        // - ถ้าปิดงานแล้ว ใช้เวลาปิดจริง (confirmed_at) เสมอ
                        // - ถ้ายังไม่ปิดแต่เลยกำหนดจบไปแล้ว ถือว่ายังครองไลน์อยู่จนถึงเวลาปัจจุบัน
                        let occupiedEndMs = endMs;
                        if (isLateDone) {
                          occupiedEndMs = new Date(o.confirmed_at).getTime();
                        } else if (!o.isDone && !o.isCarry && nowMs > endMs) {
                          occupiedEndMs = nowMs;
                        }
                        // เดินคิวต้องไม่ขยับมาก่อน endMs ของการ์ดนี้เด็ดขาด (ไม่งั้นใบถัดไปจะมาทับกล่องที่แสดงอยู่)
                        // ถ้าปิดช้ากว่าทฤษฎี (isLateDone) ค่อยยืดคิวต่อไปถึง occupiedEndMs (confirmed_at จริง) กันใบถัดไปทับ "หาง"
                        // ถ้าปิดเร็ว/ยังไม่ปิด ใช้ endMs เดิม — ห้ามใช้ confirmed_at ที่เร็วกว่ามาเลื่อนคิวให้สั้นลง
                        queueEndMs = isLateDone ? occupiedEndMs : endMs;
                        const isDelayed = !o.isDone && !o.isCarry && endMs < nowMs && rowBehindPace;
                        return { o, startMs, endMs, occupiedEndMs, isDelayed, isLateDone };
                      }).map((item, i, arr) => {
                        // ใบที่ยังไม่ปิด+เลยกำหนด หางสีแดงจะยืดไปถึง "ตอนนี้" เสมอ — แต่ถ้าใบถัดไปเริ่มทำงานไปแล้ว
                        // (แสดงว่าคิวเดินต่อไปจริงแล้ว) ต้องตัดหางแดงให้สุดแค่จุดที่ใบถัดไปเริ่ม ไม่ให้ยืดไปทับใบถัดไป
                        if (item.isDelayed && arr[i + 1]) {
                          return { ...item, occupiedEndMs: Math.min(item.occupiedEndMs, arr[i + 1].startMs) };
                        }
                        return item;
                      });
                    };

                    // ตัดผลคิวทั้งวัน (ms จริง) มาเป็น % สำหรับ "กะ" หนึ่ง ๆ — การ์ดเดียวกันแสดงต่อกันได้ทั้ง 2 กะ
                    // ถ้าดีเลย์ล้นข้ามขอบกะ (เช่น ผลิตเลย 20:00) แทนที่จะถูกตัดทิ้งที่ขอบ
                    const pctForHalf = (item, half) => {
                      const hs = half.startMs, he = half.startMs + 12 * 3600000;
                      const rightMs = item.isLateDone ? item.occupiedEndMs : item.endMs;
                      if (rightMs <= hs || item.startMs >= he) return null; // ไม่อยู่ในกะนี้เลย
                      const leftPct = Math.max(0, (item.startMs - hs) * pctPerMs);
                      const rightPct = Math.max(0, Math.min(100, (rightMs - hs) * pctPerMs));
                      const widthPct = Math.max(MIN_W_PCT, rightPct - leftPct);
                      let tailLeftPct = 0, tailWidthPct = 0;
                      if (item.isDelayed && item.occupiedEndMs > rightMs) {
                        const tLeft  = Math.max(0, Math.min(100, (rightMs - hs) * pctPerMs));
                        const tRight = Math.max(0, Math.min(100, (item.occupiedEndMs - hs) * pctPerMs));
                        tailLeftPct = tLeft;
                        tailWidthPct = Math.max(0, tRight - tLeft);
                      }
                      return { o: item.o, leftPct, widthPct, tailLeftPct, tailWidthPct, realEndMs: item.endMs, isDelayed: item.isDelayed, isLateDone: item.isLateDone, startMs: item.startMs, occupiedEndMs: item.occupiedEndMs };
                    };

                    // เรียงตามเวลาเริ่มจริง แล้วต่อคิวในแถวเดียวกัน (ไม่สร้างแถวใหม่) — แต่ละการ์ดเริ่มได้ไม่ก่อนการ์ดก่อนหน้าสิ้นสุด
                    // เพราะ 1 ไลน์ผลิตได้ทีละใบ ความกว้างคำนวณจากเวลาผลิตจริง (cycle_time × qty) และต้องหลบช่วงเวลาพัก (break_policies)
                    const renderTimeline = (cards, half, rowKey) => (
                      <div key={rowKey} style={{ flex: 1, position: 'relative', display: 'flex' }}>
                        {half.hours.map((h, i) => {
                          const slotMs = half.startMs + i * 3600000;
                          const isNow = nowMs >= slotMs && nowMs < slotMs + 3600000;
                          const isShiftBound = h === 8 || h === 20;
                          return (
                            <div key={i} style={{
                              flex: 1, minWidth: 0, height: '100%',
                              borderRight: `1px solid ${isShiftBound ? 'var(--border2)' : 'var(--border)'}`,
                              background: isNow ? 'rgba(77,159,255,0.06)' : 'transparent',
                              boxSizing: 'border-box',
                            }} />
                          );
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
                                    position: 'absolute', top: 0, bottom: 0,
                                    left: `${leftPct}%`, width: `${widthPct}%`,
                                    background: 'repeating-linear-gradient(45deg, rgba(148,163,184,0.18) 0px, rgba(148,163,184,0.18) 4px, transparent 4px, transparent 8px)',
                                    borderLeft: '1px dashed rgba(148,163,184,0.6)', borderRight: '1px dashed rgba(148,163,184,0.6)',
                                    zIndex: 0, pointerEvents: 'none',
                                    display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden',
                                  }}>
                                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', writingMode: widthPct < 3 ? 'vertical-rl' : 'horizontal-tb', whiteSpace: 'nowrap', marginBottom: 1 }}>
                                    🚫{p.name_th || p.name_en}
                                  </span>
                                </div>
                              );
                            });
                        })()}
                        {/* ⛔ แถบ downtime — วางชิดขอบบนแถว ไม่บังใบกัมบัง ชี้เมาส์ดูรายละเอียดได้
                            แสดงเฉพาะ downtime ของ sub-line ที่มีใบงานอยู่ในแถวนี้ — ไม่วาดซ้ำทุกแถวจนเหตุของ
                            อีกไลน์มาโผล่ปนกัน (แถวที่ไม่มีใบงานเลยให้เห็นทุกรายการไว้ก่อน ดีกว่าหายเงียบ) */}
                        {(() => {
                          const rowLines = new Set(cards.map(c => c.line_name).filter(Boolean));
                          return dtWindows.filter(w => !rowLines.size || !w.line_name || rowLines.has(w.line_name));
                        })().map((w, di) => {
                          const l = Math.max(0, (w.s - half.startMs) * pctPerMs);
                          const rgt = Math.min(100, (w.e - half.startMs) * pctPerMs);
                          if (rgt <= 0 || l >= 100 || rgt <= l) return null;
                          return (
                            <div key={`dt-${di}`} title={dtLabel(w)}
                              style={{
                                position: 'absolute', top: 0, height: 5, left: `${l}%`, width: `${Math.max(rgt - l, 0.4)}%`,
                                background: w.planned ? '#94a3b8' : '#ef4444', opacity: 0.85,
                                borderRadius: '0 0 3px 3px', zIndex: 3, cursor: 'help',
                              }} />
                          );
                        })}
                        {(() => {
                          const positioned = computeQueuedPositionsFull(cards).map(item => pctForHalf(item, half)).filter(Boolean);
                          // MIN_W_PCT บวกความกว้างขั้นต่ำให้การ์ดบาง ๆ มองเห็นได้ แต่ถ้าการ์ดสองใบต่อคิวกันพอดี
                          // (จบ-เริ่มติดกัน) การบวกความกว้างขั้นต่ำแยกอิสระแต่ละใบจะทำให้ขอบขวาของใบแรกล้ำ
                          // ขอบซ้ายของใบถัดไป เห็นเป็นแถบซ้อนทับกันทั้งที่ข้อมูลจริงต่อคิวไม่ทับกัน — หรี่ความกว้าง
                          // ของใบก่อนหน้าลงให้ไม่ล้ำขอบซ้ายของใบถัดไปเสมอ
                          for (let i = 0; i < positioned.length - 1; i++) {
                            const maxRight = positioned[i + 1].leftPct;
                            if (positioned[i].leftPct + positioned[i].widthPct > maxRight) {
                              positioned[i].widthPct = Math.max(0, maxRight - positioned[i].leftPct);
                            }
                          }
                          return positioned.map(({ o, leftPct, widthPct, tailLeftPct, tailWidthPct, realEndMs, isDelayed, isLateDone, startMs }, oi) => {
                          if (leftPct >= 100) return null;
                          const statusColor = isLateDone ? '#f97316' : o.isDone ? '#22c55e' : isDelayed ? '#ef4444' : o.isCarry ? '#f59e0b' : '#4d9fff';
                          const icon = o.isDone ? (isLateDone ? '✓!' : '✓') : isDelayed ? '!' : o.isCarry ? '↷' : o.is_manual ? '✍️' : '▶';
                          const doneQty  = o.isDone ? (o.qty_ok ?? o.qty ?? 0) : (o.qty_actual ?? 0);
                          const pctBlock = (o.qty || 0) > 0 ? Math.min((doneQty / o.qty) * 100, 100) : (o.isDone ? 100 : 0);
                          // ใบที่หลุดแผน (ดีเลย์/ปิดช้า) — แนบ downtime ที่คาบเกี่ยวช่วงเวลาของใบนั้นเข้า tooltip เป็นสาเหตุ
                          // จำกัดเฉพาะ downtime ของ sub-line เดียวกับใบนี้ ไม่หยิบของอีกไลน์ที่แค่เวลาตรงกันมาปน
                          const causeText = isLateDone ? dtTooltip(startMs, new Date(o.confirmed_at).getTime(), o.line_name)
                            : isDelayed ? dtTooltip(startMs, Math.min(nowMs, gridEndMs), o.line_name) : '';
                          return (
                            <Fragment key={o.prod_no || oi}>
                            <div title={`${o.prod_no || ''} ${o.mat_no || ''} — ${o.qty}ชิ้น${isLateDone ? ` ✓เสร็จ (ช้ากว่ากำหนด${Math.round((new Date(o.confirmed_at).getTime()-realEndMs)/60000)}นาที)` : isDelayed ? ` ⚠️ช้า${Math.round((nowMs-realEndMs)/60000)}นาที ยังไม่ปิด — ใบถัดไปถูกดันไปต่อท้าย` : o.isDone ? ' ✓เสร็จ' : ` →${fmtMs(realEndMs)}`}${causeText}`}
                              style={{
                                position: 'absolute', top: 4, bottom: 4,
                                left: `${leftPct}%`, width: `${widthPct}%`, minWidth: 24,
                                background: `${statusColor}28`,
                                border: `1.5px solid ${statusColor}${o.isDone && !isLateDone ? 'cc' : (isDelayed || isLateDone) ? 'dd' : '88'}`,
                                borderRadius: 4, overflow: 'hidden',
                                boxShadow: (isDelayed || isLateDone) ? `0 0 6px ${statusColor}44` : 'none',
                                cursor: 'default', zIndex: 1,
                              }}>
                              {/* ใบ manual: fill เข้มขึ้นตามสัดส่วนยอดสะสม (alpha 0.30→0.75) ครบเป้า = เขียว — เห็นชัดว่าเหลืออีกเท่าไหร่จบ
                                  ใบสแกนปกติ: fill จางแบบเดิม */}
                              <div style={{
                                position: 'absolute', top: 0, left: 0, bottom: 0, width: `${pctBlock}%`,
                                background: o.is_manual && !o.isDone
                                  ? `${pctBlock >= 100 ? '#22c55e' : statusColor}${Math.round((0.30 + 0.45 * Math.min(pctBlock, 100) / 100) * 255).toString(16).padStart(2, '0')}`
                                  : `${statusColor}22`,
                                transition: 'width 0.5s ease, background 0.5s ease',
                              }} />
                              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 3px', overflow: 'hidden' }}>
                                {/* fill เข้มของใบ manual ทำสีเดิมจม — เกินครึ่งสลับตัวหนังสือเป็นขาว */}
                                <div style={{ fontSize: 11, fontWeight: 800, color: o.is_manual && !o.isDone && pctBlock >= 45 ? '#fff' : statusColor, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {icon} {o.prod_no || (oi + 1)}
                                </div>
                                <div style={{ fontSize: 11, color: o.is_manual && !o.isDone && pctBlock >= 45 ? 'rgba(255,255,255,0.85)' : 'var(--muted)', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {/* ใบ manual ที่ยังเปิด: โชว์ยอดสะสม/เป้า (พนักงานอัพเดททุกเบรค) — ใบสแกน/ปิดแล้ว: จำนวนตามเดิม */}
                                  {o.is_manual && !o.isDone ? `${o.qty_actual ?? 0}/${o.qty_target ?? o.qty}` : o.qty}ชิ้น
                                </div>
                              </div>
                            </div>
                            {/* หางเงาแดง — ยังไม่ปิดงานแม้เลยกำหนดแล้ว ครองไลน์อยู่จนถึงตอนนี้ ดันใบถัดไปไปต่อท้าย */}
                            {tailWidthPct > 0 && (
                              <div title="ยังไม่ปิดงาน — ดีเลย์ยังดำเนินอยู่"
                                style={{
                                  position: 'absolute', top: 4, bottom: 4,
                                  left: `${tailLeftPct}%`, width: `${tailWidthPct}%`,
                                  background: 'repeating-linear-gradient(45deg, #ef444433 0px, #ef444433 4px, #ef444412 4px, #ef444412 8px)',
                                  border: '1.5px dashed #ef4444aa', borderLeft: 'none',
                                  borderRadius: '0 4px 4px 0', zIndex: 1, pointerEvents: 'none',
                                }} />
                            )}
                            </Fragment>
                          );
                          });
                        })()}
                        {/* Now marker — playhead ชมพูเรืองแสง (สีไม่ซ้ำสถานะใดบนบอร์ด) */}
                        {nowMs >= half.startMs && nowMs < half.startMs + 12 * 3600000 && (
                          <div className="now-line" style={{ left: `${(nowMs - half.startMs) * pctPerMs}%` }} />
                        )}
                      </div>
                    );

                    // ── Smart planner: คาดการณ์เวลาเสร็จจากคิวจริง + คำแนะนำเปิด OT ──
                    // กะเช้า: OT ต่อท้ายกะ — เลิกปกติ 17:30, OT ได้ถึง 20:00
                    // กะดึก: OT อยู่หัวกะ — เข้าปกติ 22:30–08:00 แต่ถ้าเปิด OT จะเข้า 20:00 แทน
                    //   คำถามที่ต้องตอบก่อนกะดึกเริ่ม: งานที่เห็นทั้งหมด เข้า 22:30 ทันก่อน 08:00 มั้ย ถ้าไม่ทันต้องเรียกเข้า 20:00
                    const plannerChips = (() => {
                      const DAY_REG_END   = gridStartMs + 9.5  * 3600000;  // 17:30
                      const DAY_OT_END    = gridStartMs + 12   * 3600000;  // 20:00
                      const NIGHT_OT_IN   = gridStartMs + 12   * 3600000;  // 20:00 (เข้าแบบเปิด OT)
                      const NIGHT_REG_IN  = gridStartMs + 14.5 * 3600000;  // 22:30 (เข้าปกติ)
                      const FRAME_END     = gridEndMs;                     // 08:00
                      // จำลองเวลาเสร็จ: เริ่มจาก startMs ใส่เนื้องาน workMs แล้วยืดคร่อมช่วงพักที่ทับ
                      const finishFrom = (startMs, workMs) => {
                        const breaks = allBreaksOnce();
                        let end = startMs + workMs;
                        const consumed = new Set();
                        let ext = true;
                        while (ext) {
                          ext = false;
                          breaks.forEach(([bs, be], i) => {
                            if (consumed.has(i)) return;
                            if (bs < end && be > startMs) { consumed.add(i); end += be - bs; ext = true; }
                          });
                        }
                        return end;
                      };
                      const chips = [];
                      ['day', 'night'].forEach(shift => {
                        let remainCards = 0, remainQty = 0, projEndMs = null, noCt = 0, workMs = 0, started = false;
                        productRows.forEach(row => {
                          computeQueuedPositionsFull(row.cards).forEach(item => {
                            if (item.o.shift !== shift) return;
                            if (item.o.isDone || (item.o.qty_actual || 0) > 0) started = true;
                            if (item.o.isDone || item.o.isCarry) return;
                            remainCards++;
                            const rq = Math.max(0, (item.o.qty || 0) - (item.o.qty_actual || 0));
                            remainQty += rq;
                            const ct = ctByMatNo[item.o.mat_no] || 0;
                            if (ct > 0) workMs += rq * ct * 1000; else noCt++;
                            const end = Math.max(item.endMs, item.occupiedEndMs);
                            projEndMs = projEndMs == null ? end : Math.max(projEndMs, end);
                          });
                        });
                        // 📡 EDI fallback: กะดึกยังไม่เปิดใบผลิตเลย — ใช้รอบส่งลูกค้าของพรุ่งนี้ตอบว่าต้องเรียกเข้า 20:00 มั้ย
                        if (shift === 'night' && !remainCards && !isHistorical && !isFutureDay && nowMs < gridStartMs + 14.5 * 3600000) {
                          const ediForLine = ediOrders.filter(o => {
                            const ln = lineByMat[o.mat_no];
                            return ln && (childParentMap[ln] || ln) === lineName && o.due_date > boardDate;
                          });
                          // หัก stock FG พร้อมส่งใน warehouse ออกก่อน — ต้องผลิตคืนนี้เฉพาะส่วนที่ขาดจริง
                          const demandByMat = {};
                          ediForLine.forEach(o => { demandByMat[o.mat_no] = (demandByMat[o.mat_no] || 0) + Number(o.qty); });
                          let ediQty = 0, w = 0, noCtQty = 0, stockUsed = 0;
                          Object.entries(demandByMat).forEach(([mat, q]) => {
                            const used = Math.min(fgStockByMat[mat] || 0, q);
                            stockUsed += used;
                            const net = q - used;
                            if (net <= 0) return;
                            ediQty += net;
                            const ct = ctByMatNo[mat] || 0;
                            if (ct > 0) w += net * ct * 1000; else noCtQty += net;
                          });
                          const grossQty = Object.values(demandByMat).reduce((a, q) => a + q, 0);
                          if (ediQty <= 0 && stockUsed > 0) {
                            chips.push({ color: '#22c55e', text: `🌙📡 EDI ส่งพรุ่งนี้ ${grossQty.toLocaleString()} ชิ้น — 📦 stock พร้อมส่งครอบทั้งหมด ไม่ต้องผลิตเพิ่มคืนนี้` });
                          }
                          if (ediQty > 0) {
                            const NIGHT_OT_IN2 = gridStartMs + 12 * 3600000, NIGHT_REG_IN2 = gridStartMs + 14.5 * 3600000;
                            const stockNote = stockUsed > 0 ? ` · หัก stock ${stockUsed.toLocaleString()} แล้ว` : '';
                            const finishFrom2 = (startMs, workMs) => {
                              const breaks = allBreaksOnce();
                              let end = startMs + workMs;
                              const consumed = new Set();
                              let ext = true;
                              while (ext) {
                                ext = false;
                                breaks.forEach(([bs, be], i) => {
                                  if (consumed.has(i)) return;
                                  if (bs < end && be > startMs) { consumed.add(i); end += be - bs; ext = true; }
                                });
                              }
                              return end;
                            };
                            if (w <= 0) {
                              chips.push({ color: 'var(--muted)', text: `🌙📡 EDI: งานส่งพรุ่งนี้ ${ediQty.toLocaleString()} ชิ้น แต่ไม่มี cycle time — คาดการณ์ไม่ได้${stockNote}` });
                            } else {
                              const nf = finishFrom2(Math.max(NIGHT_REG_IN2, nowMs), w);
                              const tail = noCtQty > 0 ? ` (+${noCtQty.toLocaleString()} ชิ้นไม่มี CT)` : '';
                              if (nf <= gridEndMs) {
                                chips.push({ color: '#22c55e', text: `🌙📡 EDI ต้องผลิตคืนนี้ ${ediQty.toLocaleString()} ชิ้น${stockNote} — เข้าปกติ 22:30 ทัน คาดเสร็จ ~${fmtMs(nf)}${tail}` });
                              } else {
                                const of2 = finishFrom2(Math.max(NIGHT_OT_IN2, nowMs), w);
                                if (of2 <= gridEndMs) {
                                  chips.push({ color: '#f59e0b', text: `🌙📡 EDI ต้องผลิตคืนนี้ ${ediQty.toLocaleString()} ชิ้น${stockNote} — ⏰ ควรเรียกเข้า 20:00 (คาดเสร็จ ~${fmtMs(of2)} · ถ้าเข้า 22:30 จบ ~${fmtMs(nf)})${tail}` });
                                } else {
                                  chips.push({ color: '#ef4444', text: `🌙📡 EDI ต้องผลิตคืนนี้ ${ediQty.toLocaleString()} ชิ้น${stockNote} — 🚨 เกินกำลังแม้เข้า 20:00 (คาดเสร็จ ~${fmtMs(of2)}) วางแผนล่วงหน้า${tail}` });
                                }
                              }
                            }
                          }
                          return;
                        }
                        if (!remainCards) return;
                        const sLabel = shift === 'day' ? '☀️' : '🌙';
                        if (isHistorical) {
                          chips.push({ color: '#ef4444', text: `${sLabel} งานไม่จบในกะ ${remainCards} ใบ (~${remainQty.toLocaleString()} ชิ้น)` });
                          return;
                        }
                        if (isFutureDay || projEndMs == null) return;
                        if (noCt === remainCards) {
                          chips.push({ color: 'var(--muted)', text: `${sLabel} คาดการณ์ไม่ได้ — งานค้าง ${remainCards} ใบไม่มี cycle time` });
                          return;
                        }
                        if (shift === 'day') {
                          const projLabel = `~${fmtMs(projEndMs)}`;
                          const otMin = Math.ceil((projEndMs - DAY_REG_END) / 60000);
                          if (projEndMs <= DAY_REG_END) {
                            chips.push({ color: '#22c55e', text: `${sLabel} คาดเสร็จ ${projLabel} — จบในเวลาปกติ (ก่อน 17:30) ไม่ต้องเปิด OT` });
                          } else if (projEndMs <= DAY_OT_END) {
                            chips.push({ color: '#f59e0b', text: `${sLabel} คาดเสร็จ ${projLabel} — ⏰ ต้องเปิด OT ~${otMin} นาที (เลิก 17:30 → ผลิตถึง ${projLabel})` });
                          } else {
                            chips.push({ color: '#ef4444', text: `${sLabel} คาดเสร็จ ${projLabel} — 🚨 เกินกรอบ OT (20:00) ควรวางแผนยกยอด/เพิ่มกำลังผลิต` });
                          }
                          return;
                        }
                        // ── กะดึก ──
                        if (nowMs < NIGHT_REG_IN && !started) {
                          // ยังไม่เริ่มกะดึก → โหมดตัดสินใจ: เข้า 22:30 ทันมั้ย หรือต้องเรียกเข้า 20:00 (เปิด OT หัวกะ)
                          const normalFinish = finishFrom(Math.max(NIGHT_REG_IN, nowMs), workMs);
                          if (normalFinish <= FRAME_END) {
                            chips.push({ color: '#22c55e', text: `${sLabel} เข้างานปกติ 22:30 ทัน — คาดเสร็จ ~${fmtMs(normalFinish)} (ก่อน 08:00) ไม่ต้องเปิด OT` });
                          } else {
                            const otFinish = finishFrom(Math.max(NIGHT_OT_IN, nowMs), workMs);
                            if (otFinish <= FRAME_END) {
                              chips.push({ color: '#f59e0b', text: `${sLabel} ⏰ ต้องเปิด OT เข้า 20:00 — คาดเสร็จ ~${fmtMs(otFinish)} (ถ้าเข้า 22:30 จะจบ ~${fmtMs(normalFinish)} เกิน 08:00)` });
                            } else {
                              chips.push({ color: '#ef4444', text: `${sLabel} 🚨 เกินกำลังกะดึกแม้เข้า 20:00 (คาดเสร็จ ~${fmtMs(otFinish)}) — ควรวางแผนยกยอด/เพิ่มกำลัง` });
                            }
                          }
                          return;
                        }
                        // กะดึกเริ่มผลิตแล้ว → ใช้คิวจริงเทียบขอบกะ 08:00
                        const projLabel = `~${fmtMs(projEndMs)}`;
                        if (projEndMs <= FRAME_END) {
                          chips.push({ color: '#22c55e', text: `${sLabel} คาดเสร็จ ${projLabel} — จบภายในกะ (ก่อน 08:00)` });
                        } else {
                          chips.push({ color: '#ef4444', text: `${sLabel} คาดเสร็จ ${projLabel} — 🚨 เกิน 08:00 ควรวางแผนยกยอดไปกะถัดไป` });
                        }
                      });
                      return chips;
                    })();

                    const plannerStrip = plannerChips.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--border2)', background: 'var(--bg2)' }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', alignSelf: 'center' }}>🧠 PLANNER</span>
                        {plannerChips.map((c, i) => (
                          <span key={i} style={{ fontSize: 12, fontWeight: 700, padding: '3px 9px', borderRadius: 10, background: `${c.color === 'var(--muted)' ? 'rgba(148,163,184,0.12)' : c.color + '1f'}`, color: c.color, border: `1px solid ${c.color === 'var(--muted)' ? 'rgba(148,163,184,0.3)' : c.color + '55'}` }}>
                            {c.text}
                          </span>
                        ))}
                      </div>
                    );

                    return (
                      <Fragment>
                        {plannerStrip}
                        {/* มือถือ ≤768px: บอร์ดเลื่อนแนวนอนได้ + ป้ายพาร์ท sticky ซ้าย (desktop เต็มจอเดียวเหมือนเดิม) */}
                        <div style={isMobile ? { overflowX: 'auto', WebkitOverflowScrolling: 'touch' } : undefined}>
                        <div style={isMobile ? { minWidth: 640 } : undefined}>
                        {/* พาร์ทละ 1 บล็อก — ป้าย/รูปใหญ่อันเดียวครอบ 2 แถบเวลา (☀️ 08–20 บน / 🌙 20–08 ล่าง)
                            หัวชั่วโมงแสดงเวลาคู่บน-ล่างในคอลัมน์เดียวกัน (โครงเดียวกับบอร์ดหน้าจัดการไลน์) */}
                        <div style={{ display: 'flex', borderBottom: '1px solid var(--border2)', background: 'var(--bg2)', position: 'relative' }}>
                          <div style={{ width: LEFT_W, flexShrink: 0, borderRight: '1px solid var(--border2)', padding: '4px 8px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1, ...(isMobile ? { position: 'sticky', left: 0, zIndex: 3, background: 'var(--bg2)' } : null) }}>
                            <span>☀️ กะเช้า{isMobile ? '' : ' (แถบบน)'}</span>
                            <span>🌙 กะดึก{isMobile ? '' : ' (แถบล่าง)'}</span>
                          </div>
                          {/* ป้ายเวลาปัจจุบัน ลอยตรงตำแหน่ง playhead (คอลัมน์ใช้ร่วม 2 กะ — ไอคอนบอกว่าอยู่กะไหน) */}
                          {(() => {
                            const curHalf = HALVES.find(hf => nowMs >= hf.startMs && nowMs < hf.startMs + 12 * 3600000);
                            if (!curHalf) return null;
                            const t = new Date(nowMs);
                            return (
                              <div className="now-chip" style={{ left: `calc(${LEFT_W}px + (100% - ${LEFT_W}px) * ${(nowMs - curHalf.startMs) / (12 * 3600000)})` }}>
                                {curHalf.key === 'am' ? '☀️' : '🌙'} {String(t.getHours()).padStart(2, '0')}:{String(t.getMinutes()).padStart(2, '0')}
                              </div>
                            );
                          })()}
                          {HALVES[0].hours.map((h, i) => {
                            const hPm = HALVES[1].hours[i];
                            const amSlot = HALVES[0].startMs + i * 3600000;
                            const pmSlot = HALVES[1].startMs + i * 3600000;
                            const isNowAm = nowMs >= amSlot && nowMs < amSlot + 3600000;
                            const isNowPm = nowMs >= pmSlot && nowMs < pmSlot + 3600000;
                            return (
                              <div key={i} style={{
                                flex: 1, minWidth: 0, textAlign: 'center', padding: '3px 0', lineHeight: 1.3,
                                borderRight: '1px solid var(--border)',
                                background: (isNowAm || isNowPm) ? 'rgba(77,159,255,0.12)' : 'transparent',
                              }}>
                                <div style={{ fontSize: 11, fontWeight: isNowAm ? 800 : 500, color: isNowAm ? '#4d9fff' : 'var(--text2)' }}>{String(h).padStart(2, '0')}:00</div>
                                <div style={{ fontSize: 11, fontWeight: isNowPm ? 800 : 400, color: isNowPm ? '#4d9fff' : 'var(--muted)' }}>{String(hPm).padStart(2, '0')}:00</div>
                              </div>
                            );
                          })}
                        </div>
                        {productRows.map((row, ri) => {
                          const rowActual = row.cards.reduce((a, c) => a + (c.isDone ? (c.qty_ok ?? c.qty ?? 0) : (c.qty_actual ?? 0)), 0);
                          const rowDemand = row.cards.reduce((a, c) => a + (c.qty || 0), 0);
                          const doneCount = row.cards.filter(c => c.isDone).length;
                          const delayed   = computeQueuedPositionsFull(row.cards).filter(p => p.isDelayed).length;
                          const isOpen    = row.cards.some(c => c.sessionOpen);
                          const pct       = rowDemand > 0 ? Math.min((rowActual / rowDemand) * 100, 100) : 0;
                          const barColor  = pct >= 100 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444';

                          return (
                            <div key={row.key} style={{ display: 'flex', borderTop: '1px solid var(--border2)', overflow: 'hidden' }}>
                              {/* Left summary — ป้ายเดียวครอบทั้ง 2 แถบเวลา */}
                              <div style={{ width: LEFT_W, flexShrink: 0, padding: '4px 8px', borderRight: '1px solid var(--border2)', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7, overflow: 'hidden', ...(isMobile ? { position: 'sticky', left: 0, zIndex: 3, background: 'var(--card)' } : null) }}>
                                {row.img && <img src={row.img} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />}
                                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, minWidth: 0 }}>
                                  <div style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 700, lineHeight: 1.25, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', wordBreak: 'break-word' }}>
                                    {row.label}
                                    {/* บอร์ดรวมหลาย sub-line — ป้ายบอกว่าแถวนี้ของไลน์ไหน (product เดียวกันคนละไลน์ = คนละแถว) */}
                                    {multiSubLine && row.line && (
                                      <span style={{ marginLeft: 4, fontSize: 11, fontWeight: 800, color: '#4d9fff', background: 'rgba(77,159,255,0.14)', border: '1px solid rgba(77,159,255,0.4)', borderRadius: 5, padding: '0 5px', whiteSpace: 'nowrap' }}>{row.line}</span>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: 15, fontWeight: 900, color: barColor, lineHeight: 1 }}>{rowActual}</span>
                                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>/{rowDemand} ชิ้น · {doneCount}/{row.cards.length}ใบ</span>
                                    {delayed > 0 && <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 700 }}>⚠️{delayed}ใบ</span>}
                                    {isOpen && delayed === 0 && <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 700 }}>● Live</span>}
                                  </div>
                                </div>
                              </div>
                              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                {HALVES.map(half => (
                                  <div key={half.key} style={{ height: 36, display: 'flex', position: 'relative', borderTop: half.key === 'pm' ? '1px dashed var(--border)' : 'none' }}>
                                    {renderTimeline(row.cards, half, `${half.key}-${ri}`)}
                                    <span style={{ position: 'absolute', left: 3, bottom: 1, fontSize: 11, opacity: 0.55, zIndex: 2, pointerEvents: 'none' }}>{half.key === 'am' ? '☀️' : '🌙'}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                        </div>
                        </div>
                      </Fragment>
                    );
                  })()}

                  {/* ── Footer: per-session progress + OEE — จัดกลุ่มตามไลน์ย่อย (hierarchy) ── */}
                  {(() => {
                    const byChild = {};
                    sessions.forEach(s => { (byChild[s.line_name] = byChild[s.line_name] || []).push(s); });
                    const childNames = Object.keys(byChild).sort();
                    const multi = childNames.length > 1 || (childNames.length === 1 && childNames[0] !== lineName);
                    // ไม่รวมยอดข้ามโปรดัก (RH/LH คนละพาร์ท) — แต่ละบล็อกกะบอกชื่อโปรดักที่ผลิตแทน
                    return (
                  <div style={{ padding: '8px 14px 10px', borderTop: '1px solid var(--border2)' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                    {childNames.map(childName => {
                      const childSessions = [...byChild[childName]].sort((a, b) => (a.shift === b.shift ? 0 : a.shift === 'day' ? -1 : 1));
                      const active = childSessions.filter(s => (s.demand || 0) > 0 || (s.actual || 0) > 0);
                      const emptyCount = childSessions.length - active.length;
                      return (
                        <div key={childName} style={{ flex: '1 1 220px', minWidth: 200, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {multi && (
                            <div style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b', borderBottom: '1px solid var(--border)', paddingBottom: 3 }}>
                              🏭 {childName}
                              {emptyCount > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}> · {emptyCount} กะไม่มีแผน</span>}
                            </div>
                          )}
                          {active.length === 0 && (
                            <div style={{ fontSize: 13, color: 'var(--muted)' }}>ไม่มีแผนผลิต</div>
                          )}
                          {active.map(s => {
                      const pct      = s.demand > 0 ? Math.min((s.actual / s.demand) * 100, 100) : 0;
                      const tpct     = s.target > 0 ? Math.min((s.actual / s.target) * 100, 100) : 0;
                      const barColor = pct >= 100 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444';
                      const oee      = s.oeeData;
                      const oeeColor = (!oee || oee.oee == null) ? '#888' : oee.oee >= 0.85 ? '#22c55e' : oee.oee >= 0.65 ? '#f59e0b' : '#ef4444';
                      const doneCount = s.orders.filter(o => o.status === 'confirmed').length;

                      return (
                        <div key={s.id} style={{ minWidth: 180 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{s.shift === 'day' ? '☀️ กะเช้า' : '🌙 กะดึก'}</span>
                              <span style={{ fontSize: 20, fontWeight: 900, color: barColor, lineHeight: 1 }}>{s.actual}</span>
                              <span style={{ fontSize: 13, color: 'var(--muted)' }}>/ {s.demand} ชิ้น</span>
                              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{doneCount}/{s.orders.length} ใบ</span>
                              {(() => {
                                const prods = [...new Set(s.orders.map(o => nameByMatNo[o.mat_no] || o.mat_no).filter(Boolean))];
                                if (!prods.length) return null;
                                return (
                                  <span title={prods.join(' · ')} style={{ fontSize: 11, fontWeight: 700, color: '#4d9fff', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {prods[0]}{prods.length > 1 ? ` +${prods.length - 1}` : ''}
                                  </span>
                                );
                              })()}
                            </div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              {s.target > 0 && <span style={{ fontSize: 12, color: tpct >= 100 ? '#22c55e' : 'var(--muted)' }}>เป้า {tpct.toFixed(0)}%</span>}
                              <span style={{ fontSize: 15, fontWeight: 800, color: barColor }}>{pct.toFixed(0)}%</span>
                              {oee && <span style={{ fontSize: 15, fontWeight: 800, color: oeeColor }}>OEE {oee.oee != null ? `${(oee.oee * 100).toFixed(0)}%` : 'N/A'}</span>}
                            </div>
                          </div>
                          <div style={{ height: 5, borderRadius: 3, background: 'var(--border2)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3, transition: 'width 0.7s ease' }} />
                          </div>
                          {oee && s.status === 'open' && (
                            <div style={{ display: 'flex', gap: 10, marginTop: 5 }}>
                              {[{ l: 'A', v: oee.A, t: 'Availability' }, { l: 'P', v: oee.P, t: 'Performance' }, { l: 'Q', v: oee.Q, t: 'Quality' }].map(k => {
                                const c = k.v == null ? '#888' : k.v >= 0.85 ? '#22c55e' : k.v >= 0.65 ? '#f59e0b' : '#ef4444';
                                return (
                                  <span key={k.l} title={k.t} style={{ fontSize: 12, color: c, fontWeight: 700 }}>
                                    {k.l} {k.v != null ? `${(k.v * 100).toFixed(0)}%` : 'N/A'}
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
                  </div>
                    );
                  })()}

                </div>
              );
            })}
          </motion.div>
        );
      })()}

      {/* ── Bottom Grid ─────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : isUltra ? 'minmax(0,3fr) minmax(0,1fr)' : 'minmax(0,2fr) minmax(0,1fr)', gap: isWide ? 20 : 16 }}>

        {/* Line Floor Maps */}
        <motion.div {...stagger(12)}>
          <div className="card" style={{ padding: 20, height: '100%' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display)', marginBottom: 16 }}>
              🏭 Line Floor Maps
            </div>
            {visibleLayouts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)', fontSize: 15 }}>
                ยังไม่มีผัง — ไปตั้งค่าที่หน้า <strong>ตั้งค่าผังไลน์</strong>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : isUltra ? 'repeat(3, 1fr)' : '1fr 1fr', gap: isWide ? 14 : 12 }}>
                {visibleLayouts.map(layout => {
                  const cardLineNames = layoutLineNamesForCard(layout.line_name);
                  const lineWs = workstations.filter(w => cardLineNames.includes(w.line_name));
                  const lineStaff = lineWs.map(ws => stationEmpMap[String(ws.id)]).filter(e => e && (!shiftEmpIds || shiftEmpIds.has(e.id)));
                  // Use lineStats (same source as KPI cards) for the footer counts — sum across sub-lines merged into this card
                  const cardLineStats = lineStats.filter(l => cardLineNames.includes(l.name));
                  const footerPresent = cardLineStats.length ? cardLineStats.reduce((s, l) => s + l.linePresent, 0) : lineStaff.filter(e => e.is_present === true).length;
                  const footerTotal   = cardLineStats.length ? cardLineStats.reduce((s, l) => s + l.lineTotal, 0)   : lineStaff.length;
                  const footerAbsent  = cardLineStats.length ? (footerTotal - footerPresent) : lineStaff.filter(e => e.is_present === false).length;
                  return (
                    <div
                      key={layout.line_name}
                      onClick={() => setExpandedLine(layout.line_name)}
                      style={{ cursor: 'pointer', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border2)', background: '#111' }}
                    >
                      {/* Map thumbnail — marker ยึดกับตัวรูปจริง (contain) ตำแหน่งไม่เพี้ยนตามขนาดการ์ด */}
                      <ThumbMap
                        imageUrl={layout.image_url}
                        alt={layout.line_name}
                        markers={[
                          ...lineWs.map(ws => {
                            const emp = stationEmpMap[String(ws.id)];
                            if (!emp) return null;
                            if (shiftEmpIds && !shiftEmpIds.has(emp.id)) return null;
                            // Only show employees who are present
                            if (emp.is_present !== true) return null;
                            const fitLv = getFitLevel(emp.fitScore);
                            return {
                              id: ws.id,
                              top: ws.pos_top, left: ws.pos_left,
                              color: fitLv ? fitLv.color : '#aaa',
                              img: emp.image_url,
                              initial: (emp.name || '?')[0],
                              personAlarm: personAlarmOf(emp),
                            };
                          }).filter(Boolean),
                          // จุดเครื่องจักรที่กำลัง Downtime — กระพริบแดงบนผังย่อ
                          ...machinePoints
                            .filter(p => cardLineNames.includes(p.line_name) && dtAlarmByMachine[p.machine_no])
                            .map(p => ({
                              id: `mc-${p.id}`, alarm: true, label: p.machine_no,
                              top: `${parseFloat(p.pos_top) || 0}%`, left: `${parseFloat(p.pos_left) || 0}%`,
                            })),
                        ]}
                      />
                      {/* Line label */}
                      <div style={{ padding: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg3)' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '60%' }}>
                          {layout.line_name}
                        </span>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#22c55e', background: 'rgba(34,197,94,0.12)', padding: '2px 6px', borderRadius: 4 }}>✓ {footerPresent}/{footerTotal}</span>
                          {footerAbsent > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: '#e74c3c', background: 'rgba(231,76,60,0.12)', padding: '2px 6px', borderRadius: 4 }}>✗ {footerAbsent}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>

        {/* 4M Activity Feed */}
        <motion.div {...stagger(13)}>
          <div className="card" style={{ padding: 20, height: '100%' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display)', marginBottom: 16 }}>
              4M Activity Feed
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: isWide ? 600 : 420, overflowY: 'auto' }}>
              <AnimatePresence>
                {visibleFourMLogs.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '48px 20px' }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
                    <div style={{ fontSize: 15, color: 'var(--muted)' }}>ไม่มีการแจ้งเตือน 4M</div>
                    <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4, opacity: 0.6 }}>สถานะปกติ</div>
                  </div>
                ) : visibleFourMLogs.map((log, i) => {
                  const meta = getCatMeta(log.category);
                  return (
                    <motion.div key={log.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
                      <div style={{
                        padding: '10px 12px', borderRadius: 10,
                        background: meta.bg,
                        border: `1px solid ${meta.color}22`,
                        display: 'flex', gap: 10, alignItems: 'flex-start',
                      }}>
                        <div style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{meta.icon}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: meta.color }}>{log.category}</span>
                            <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{log.line_name}</span>
                          </div>
                          <div style={{ fontSize: 14, color: 'var(--text)', marginTop: 3, lineHeight: 1.4 }}>
                            {log.description}
                          </div>
                          {log.created_at && (
                            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                              {new Date(log.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </div>

      {/* ── Andon Alarm Panel — เจาะรายละเอียดว่า alarm ของไลน์มาจากอะไร ── */}
      {andonLine && (() => {
        const dts = andonLine.names.flatMap(n => dtAlarmByLine[n] || []);
        const fms = fourMLogs.filter(f => andonLine.names.includes(f.line_name));
        const CAT_ICON = { Man: '👤', Machine: '⚙️', Material: '📦', Method: '📋' };
        const fmtTime = (ts) => ts ? new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '—';
        // ── ระดับไฟ Andon: แดง = เครื่องหยุดค้างอยู่ · เหลือง = มีรายการรอดำเนินการ · เขียว = อนุมัติครบ/ปกติ ──
        const hasOngoingDT = dts.some(d => !d.ended_at && d.duration_min == null);
        const hasPendingFM = fms.some(f => f.status !== 'approved' && f.status !== 'rejected');
        const level = hasOngoingDT ? 'red' : (hasPendingFM || dts.length > 0) ? 'amber' : 'green';
        const LV = {
          red:   { color: '#ef4444', icon: '🔴', label: 'ANDON — RED',   desc: 'มีเครื่องจักรหยุดค้างอยู่ — ต้องดำเนินการทันที' },
          amber: { color: '#f59e0b', icon: '🟡', label: 'ANDON — YELLOW', desc: 'มีรายการรอดำเนินการ / รออนุมัติ' },
          green: { color: '#22c55e', icon: '🟢', label: 'ANDON — GREEN', desc: 'รายการทั้งหมดอนุมัติแล้ว · สถานะปกติ' },
        }[level];
        return (
          <div className="overlay" style={{ zIndex: 1100 }} onClick={() => setAndonLine(null)}>
            <div onClick={e => e.stopPropagation()} className={level === 'red' ? 'dt-alarm-banner' : undefined} style={{
              background: 'var(--card)', borderRadius: 16, padding: '20px 24px',
              width: 'min(94vw, 720px)', maxHeight: '90vh', overflowY: 'auto',
              border: `2px solid ${LV.color}88`,
              boxShadow: `0 20px 60px rgba(0,0,0,0.6), 0 0 30px ${LV.color}40`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className={level === 'red' ? 'dt-alarm-icon' : undefined} style={{ fontSize: 26 }}>{LV.icon}</span>
                  <div>
                    <div style={{ fontSize: 19, fontWeight: 900, color: LV.color, fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}>{LV.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{andonLine.title}</div>
                    <div style={{ fontSize: 12, color: LV.color, fontWeight: 700, marginTop: 2 }}>{LV.desc}</div>
                  </div>
                </div>
                <button onClick={() => setAndonLine(null)}
                  style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--muted)', padding: '0 4px' }}>✕</button>
              </div>

              {/* เครื่องจักร Downtime — กระพริบแดง */}
              <div style={{ fontSize: 13, fontWeight: 800, color: hasOngoingDT ? '#ef4444' : 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '4px 0 8px' }}>
                ⚙️ เครื่องจักรหยุด (Downtime) · {dts.length} รายการ
              </div>
              {dts.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0 14px' }}>ไม่มีเครื่องจักร Downtime ที่ยังแจ้งเตือน</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                  {dts.map(d => {
                    const elapsed = dtElapsedMin(d, now.getTime());
                    const ongoing = !d.ended_at && d.duration_min == null;
                    return (
                      <div key={d.id} className={ongoing ? 'dt-alarm-blink' : undefined} style={{
                        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
                        padding: '10px 14px', borderRadius: 10,
                        background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.45)',
                      }}>
                        <span style={{ fontSize: 16, fontWeight: 900, color: '#fca5a5', fontFamily: 'var(--font-display)' }}>⚙️ {d.machine_no || '—'}</span>
                        <span style={{ fontSize: 14, fontWeight: 800, color: '#ef4444' }}>{d.dr_downtime_types?.name_th || 'Downtime'}</span>
                        <span style={{ fontSize: 13, color: 'var(--text2)' }}>📍 {d.line_name}</span>
                        <span style={{ fontSize: 13, color: 'var(--muted)' }}>เริ่ม {fmtTime(d.started_at || d.created_at)}</span>
                        {ongoing
                          ? (elapsed != null && <span style={{ fontSize: 14, fontWeight: 900, color: '#fbbf24' }}>⏱ ค้างมาแล้ว {elapsed} นาที</span>)
                          : <span style={{ fontSize: 12, color: 'var(--muted)' }}>ปิดรายการแล้ว (เพิ่งบันทึก)</span>}
                        {d.detail && <span style={{ fontSize: 13, color: 'var(--text2)', width: '100%' }}>📝 {d.detail}</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 4M Alerts */}
              <div style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '4px 0 8px' }}>
                🚨 4M Changes · {fms.length} รายการ
              </div>
              {fms.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>ไม่มีรายการ 4M ของวันนี้</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {fms.map(f => (
                    <div key={f.id} style={{
                      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
                      padding: '10px 14px', borderRadius: 10,
                      background: 'var(--bg3)', border: '1px solid var(--border2)',
                      borderLeft: `3px solid ${f.status === 'approved' ? '#22c55e' : f.status === 'rejected' ? '#ef4444' : '#f59e0b'}`,
                    }}>
                      <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{CAT_ICON[f.category] || '🔧'} {f.category}</span>
                      <span style={{ fontSize: 13, color: 'var(--text2)' }}>📍 {f.line_name}</span>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtTime(f.created_at)}</span>
                      <span style={{
                        fontSize: 12, fontWeight: 800, padding: '2px 8px', borderRadius: 6,
                        background: f.status === 'approved' ? 'rgba(34,197,94,0.15)' : f.status === 'rejected' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
                        color: f.status === 'approved' ? '#22c55e' : f.status === 'rejected' ? '#ef4444' : '#f59e0b',
                      }}>
                        {f.status === 'approved' ? '✓ อนุมัติแล้ว' : f.status === 'rejected' ? '✕ ปฏิเสธ' : f.status === 'pending_qa' ? '🔍 รอ QA' : '⏳ รออนุมัติ'}
                      </span>
                      {f.description && <span style={{ fontSize: 13, color: 'var(--text)', width: '100%' }}>{f.description}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Expanded Line Map Modal */}
      {expandedLine && (() => {
        const layout = layouts.find(l => l.line_name === expandedLine);
        const cardLineNames = layoutLineNamesForCard(expandedLine);
        const lineWs = workstations.filter(w => cardLineNames.includes(w.line_name));
        if (!layout) return null;
        return (
          <div
            className="overlay"
            style={{ zIndex: 1000 }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: 'var(--card)',
                borderRadius: 14,
                padding: 16,
                // หด modal ตามขนาดรูปจริง — รูปถูกจำกัดทั้งกว้าง/สูงให้พอดีจอเดียว (ห้ามมี scroll)
                width: 'fit-content',
                maxWidth: '97vw',
                maxHeight: '97vh',
                overflow: 'hidden',
                boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>
                  🏭 {expandedLine}
                </div>
                <button
                  onClick={() => setExpandedLine(null)}
                  style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)', padding: '0 4px' }}
                >✕</button>
              </div>
              {/* inline-block ให้กรอบหดเท่ารูปจริง — img จำกัดทั้งสองแกน (ไม่ใช้ object-fit
                  เพื่อให้กล่อง img = รูปที่เห็นจริง แล้วพิกัด % ของ marker ตรงเสมอ) */}
              <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#111', display: 'inline-block', maxWidth: '100%' }}>
                <img
                  ref={mapImgRef}
                  src={layout.image_url}
                  alt={expandedLine}
                  onLoad={e => setMapBox({ w: e.currentTarget.clientWidth, h: e.currentTarget.clientHeight })}
                  style={{
                    maxWidth: 'min(95vw, 2200px)',
                    maxHeight: 'calc(97vh - 150px)', // เผื่อ header + legend + padding ของ modal
                    width: 'auto', height: 'auto',
                    display: 'block', opacity: 0.7,
                  }}
                />
                {(() => {
                  // เก็บ marker ที่จะแสดง + ตำแหน่งจริง (anchor) จาก pos_top/pos_left (เป็น %)
                  const markers = lineWs.map(ws => {
                    const emp = stationEmpMap[String(ws.id)];
                    if (!emp) return null;
                    if (shiftEmpIds && !shiftEmpIds.has(emp.id)) return null;
                    if (emp.is_present !== true) return null;
                    return {
                      ws, emp,
                      top: parseFloat(ws.pos_top) || 0, left: parseFloat(ws.pos_left) || 0,
                      ox: 0, oy: 0,
                    };
                  }).filter(Boolean);

                  // กันการ์ดซ้อนทับกัน: ผลักออกจากกันใน "พิกเซลจริง" ของภาพที่ render
                  // (แปลง % เป็น px ตามขนาดจริงของ mapBox ก่อนคำนวณ แล้วแปลงกลับเป็น % ตอน render)
                  const boxW = mapBox.w || 800, boxH = mapBox.h || 450;
                  // ขนาด marker จาก util กลาง (ห้ามตั้งสูตรเองในหน้า — UI-CONVENTIONS §1)
                  const { MK, SUB } = markerScale(boxW);
                  const MIN_PX_X = MK * 1.2, MIN_PX_Y = MK * 1.6; // ระยะห่างขั้นต่ำรวม nametag+badge
                  const pxMarkers = markers.map(m => ({ ...m, px: m.left / 100 * boxW, py: m.top / 100 * boxH, dox: 0, doy: 0 }));
                  for (let pass = 0; pass < 60; pass++) {
                    let moved = false;
                    for (let i = 0; i < pxMarkers.length; i++) {
                      for (let j = i + 1; j < pxMarkers.length; j++) {
                        const a = pxMarkers[i], b = pxMarkers[j];
                        const dx = (b.px + b.dox) - (a.px + a.dox);
                        const dy = (b.py + b.doy) - (a.py + a.doy);
                        const ndx = dx / MIN_PX_X, ndy = dy / MIN_PX_Y;
                        const dist = Math.sqrt(ndx * ndx + ndy * ndy) || 0.0001;
                        if (dist < 1) {
                          const overlap = (1 - dist) / 2;
                          const pushX = (ndx / dist) * overlap * MIN_PX_X;
                          const pushY = (ndy / dist) * overlap * MIN_PX_Y;
                          a.dox -= pushX; a.doy -= pushY;
                          b.dox += pushX; b.doy += pushY;
                          moved = true;
                        }
                      }
                    }
                    if (!moved) break;
                  }
                  // clamp ไม่ให้การ์ด (avatar+ชื่อ+badge) ตกขอบรูป — การ์ดถูก translate(-50%,-50%)
                  const EDGE_X = MK * 0.55, EDGE_TOP = MK * 0.55, EDGE_BOTTOM = MK * 1.35; // ค่ามาตรฐาน UI-CONVENTIONS §1.3
                  for (const m of pxMarkers) {
                    const fx = Math.min(Math.max(m.px + m.dox, EDGE_X), boxW - EDGE_X);
                    const fy = Math.min(Math.max(m.py + m.doy, EDGE_TOP), boxH - EDGE_BOTTOM);
                    m.dox = fx - m.px;
                    m.doy = fy - m.py;
                    m.ox = (m.dox / boxW) * 100;
                    m.oy = (m.doy / boxH) * 100;
                  }

                  return (
                    <>
                      {/* เส้นโยงกลับไปตำแหน่งจริง สำหรับการ์ดที่ถูกผลักออก */}
                      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 1, pointerEvents: 'none' }}
                        viewBox="0 0 100 100" preserveAspectRatio="none">
                        {pxMarkers.map(({ ws, top, left, ox, oy }) => {
                          if (Math.abs(ox) < 0.3 && Math.abs(oy) < 0.3) return null;
                          return (
                            <g key={`ln-${ws.id}`}>
                              <line x1={left} y1={top} x2={left + ox} y2={top + oy}
                                stroke="rgba(255,255,255,0.5)" strokeWidth={0.25} strokeDasharray="1.2 1" vectorEffect="non-scaling-stroke" />
                              <circle cx={left} cy={top} r={0.8} fill="rgba(255,255,255,0.7)" />
                            </g>
                          );
                        })}
                      </svg>
                      {pxMarkers.map(({ ws, emp, top, left, ox, oy }) => {
                        const fit = emp.fitScore;
                        const fitLv = getFitLevel(fit);
                        const color = fitLv ? fitLv.color : '#aaa';
                        const shortName = (emp.name || '').split(' ')[0];
                        const pAlarm = personAlarmOf(emp);
                        return (
                          <div key={ws.id}
                            onMouseEnter={e => { e.currentTarget.style.zIndex = 50; }}
                            onMouseLeave={e => { e.currentTarget.style.zIndex = 2; }}
                            title={pAlarm?.label}
                            style={{
                              // wrapper สูงเท่าวงกลมเท่านั้น — ป้ายทั้งหมดห้อยใต้แบบ absolute
                              // กันจุดกึ่งกลางวงกลมเลื่อนขึ้นครึ่งป้าย (UI-CONVENTIONS §1.1)
                              position: 'absolute', top: `${top + oy}%`, left: `${left + ox}%`,
                              transform: 'translate(-50%, -50%)', width: MK, height: MK,
                              zIndex: pAlarm ? 4 : 2,
                              transition: 'z-index 0s',
                            }}>
                            <div
                              className={pAlarm ? (pAlarm.kind === 'red' ? 'person-alarm-red' : 'person-alarm-amber') : undefined}
                              style={{
                                width: MK, height: MK, borderRadius: '50%',
                                border: `${Math.max(2, Math.round(MK * 0.06))}px solid ${color}`,
                                boxShadow: `0 0 10px ${color}99`,
                                overflow: 'hidden', background: '#1a1a1a',
                              }}>
                              {emp.image_url
                                ? <img src={emp.image_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(MK * 0.38), fontWeight: 800, color }}>{(emp.name || '?')[0]}</div>
                              }
                            </div>
                            <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
                            <div style={{
                              background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
                              borderRadius: 4, padding: '2px 8px',
                              fontSize: Math.max(11, Math.round(MK * 0.24)), fontWeight: 700, color: '#fff',
                              whiteSpace: 'nowrap', maxWidth: Math.max(MK * 1.9, 96),
                              overflow: 'hidden', textOverflow: 'ellipsis',
                              marginTop: -4, position: 'relative', zIndex: 1,
                            }}>{shortName}</div>
                            {fit !== null && (
                              <div style={{ fontSize: Math.max(11, Math.round(MK * 0.2)), fontWeight: 800, color, background: `${color}25`, padding: '1px 6px', borderRadius: 3, marginTop: -2 }}>{fit}%</div>
                            )}
                            {emp.has_extended_ot && (
                              <div style={{ fontSize: Math.max(11, Math.round(MK * 0.2)), fontWeight: 800, color: '#ef4444', background: 'rgba(239,68,68,0.2)', padding: '1px 6px', borderRadius: 3, marginTop: -2 }}>OT+23</div>
                            )}
                            {pAlarm && (
                              <div style={{
                                fontSize: Math.max(11, Math.round(MK * 0.22)), fontWeight: 800, whiteSpace: 'nowrap',
                                color: pAlarm.kind === 'red' ? '#fca5a5' : '#fde68a',
                                background: pAlarm.kind === 'red' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)',
                                padding: '1px 6px', borderRadius: 3, marginTop: 2,
                              }}>
                                {pAlarm.icon} {pAlarm.kind === 'red' ? 'PPE ไม่ครบ' : 'รอ 4M'}
                              </div>
                            )}
                            </div>
                          </div>
                        );
                      })}
                      {/* จุดเครื่องจักรบนผัง — เฉพาะเครื่องที่กำลัง Downtime กระพริบแดงพร้อมชื่อสาเหตุ
                          รูปทรงตาม UI-CONVENTIONS ข้อ 1: วงกลมขนาด SUB (0.6×MK จาก markerScale) + ป้ายใต้ พร้อม edge clamp ไม่ให้ตกขอบรูป */}
                      {machinePoints
                        .filter(p => cardLineNames.includes(p.line_name) && dtAlarmByMachine[p.machine_no])
                        .map(p => {
                          const alarms = dtAlarmByMachine[p.machine_no];
                          const first = alarms[0];
                          const elapsed = dtElapsedMin(first, now.getTime());
                          const ongoing = !first.ended_at && first.duration_min == null;
                          const MKS = SUB;
                          const rawL = (parseFloat(p.pos_left) || 0) / 100 * boxW;
                          const rawT = (parseFloat(p.pos_top) || 0) / 100 * boxH;
                          const leftPct = Math.min(Math.max(rawL, MKS * 0.55), boxW - MKS * 0.55) / boxW * 100;
                          const topPct  = Math.min(Math.max(rawT, MKS * 0.7), boxH - MKS * 1.35) / boxH * 100;
                          return (
                            <div key={`mc-${p.id}`}
                              title={alarms.map(d => `${d.dr_downtime_types?.name_th || 'Downtime'}${d.description ? ` — ${d.description}` : ''}`).join('\n')}
                              style={{
                                // wrapper สูงเท่าวงกลม — ป้ายห้อยใต้แบบ absolute (UI-CONVENTIONS §1.1)
                                position: 'absolute', top: `${topPct}%`, left: `${leftPct}%`,
                                transform: 'translate(-50%, -50%)', zIndex: 5,
                                width: MKS, height: MKS,
                              }}>
                              <div className="dt-alarm-blink" style={{
                                width: MKS, height: MKS, borderRadius: '50%',
                                border: `${Math.max(2, Math.round(MKS * 0.06))}px solid #ef4444`,
                                backgroundColor: 'rgba(239,68,68,0.25)', backdropFilter: 'blur(2px)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: Math.max(13, Math.round(MKS * 0.44)), lineHeight: 1,
                              }}>🚨</div>
                              <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, marginTop: 2 }}>
                              <div style={{
                                background: 'rgba(0,0,0,0.8)', borderRadius: 4, padding: '1px 6px',
                                fontSize: Math.max(11, Math.round(MKS * 0.24)), fontWeight: 800, color: '#fff',
                                whiteSpace: 'nowrap', maxWidth: Math.max(MKS * 1.9, 88), overflow: 'hidden', textOverflow: 'ellipsis',
                              }}>
                                {p.machine_no}
                              </div>
                              <div style={{
                                background: 'rgba(239,68,68,0.25)', borderRadius: 3, padding: '0 5px',
                                fontSize: Math.max(11, Math.round(MKS * 0.2)), fontWeight: 700, color: '#fca5a5',
                                whiteSpace: 'nowrap', maxWidth: Math.max(MKS * 2, 88), overflow: 'hidden', textOverflow: 'ellipsis',
                              }}>
                                {first.dr_downtime_types?.name_th || 'Downtime'}{ongoing && elapsed != null ? ` · ${elapsed} นาที` : ''}
                              </div>
                              </div>
                            </div>
                          );
                        })}
                    </>
                  );
                })()}
              </div>
              {/* Legend — same as skill matrix */}
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 4 }}>Skill Fit:</span>
                {SKILL_LEVELS.map(lv => (
                  <div key={lv.min} style={{ display: 'flex', alignItems: 'center', gap: 5, background: lv.bg, borderRadius: 6, padding: '3px 8px' }}>
                    <div style={{ width: 9, height: 9, borderRadius: '50%', background: lv.color, boxShadow: `0 0 4px ${lv.color}` }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: lv.color }}>{lv.min}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{lv.label}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, borderRadius: 6, padding: '3px 8px', background: 'rgba(128,128,128,0.1)' }}>
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#aaa' }} />
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>ไม่มีข้อกำหนด</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function Pill({ label, color }) {
  return (
    <div style={{
      fontSize: 13, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
      color, background: `${color}18`, border: `1px solid ${color}40`,
    }}>{label}</div>
  );
}

function AttendCol({ title, color, items, absent }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {title} ({items.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
        {items.map(l => (
          <div key={l.id} style={{
            padding: '6px 10px', borderRadius: 7,
            background: 'var(--bg3)',
            borderLeft: `3px solid ${color}`,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: `${color}20`, border: `1px solid ${color}40`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 800, color, flexShrink: 0,
            }}>
              {(l.employees?.name || '?').charAt(0).toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {l.employees?.name || '—'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {absent ? 'ขาดงาน' : (l.has_helmet && l.has_boots && l.has_gloves ? '🟢 PPE ครบ' : '🟡 PPE ไม่ครบ')}
              </div>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '16px 0' }}>ไม่มีข้อมูล</div>
        )}
      </div>
    </div>
  );
}
