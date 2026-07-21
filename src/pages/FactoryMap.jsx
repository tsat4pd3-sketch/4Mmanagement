import { useState, useEffect, useContext, useRef, useCallback, useMemo } from 'react';
import imageCompression from 'browser-image-compression';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import { toast } from '../components/Toast';

/* ── ผังรวมโรงงาน (Factory Master Map) — polygon อิสระ + เลือก metric, 2026-07-16 ──────
   รูปผังใหญ่ทั้งโรงงาน 1 รูป + วาด polygon ล้อมแต่ละไลน์ (L/U ได้) ระบายสีตาม metric ที่เลือก
   metric: ยอดผลิต / OEE / Downtime / ของเสีย — เลือกดูได้ · มี side panel จัดอันดับไลน์ (ใช้พื้นที่ข้าง)
   - View: ทุก role · Edit (อัปโหลด/วาด/ย้าย/ลบ): can('factory_map','edit')
   - points = [[x,y],...] เป็น % ของรูปจริง (0-100) · SVG polygon preserveAspectRatio=none + non-scaling stroke
*/

function getWorkDate() {
  const d = new Date();
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// สีตามหมวดสถานะ (คำนวณต่อ metric) — down = แดงกระพริบ (Andon), อื่นๆ นิ่ง
const CAT = {
  good: { color: '#22c55e', label: 'ดี' },
  ok:   { color: '#f59e0b', label: 'เฝ้าระวัง' },
  bad:  { color: '#ef4444', label: 'ต้องแก้' },
  down: { color: '#ef4444', label: 'Downtime', blink: true },
  idle: { color: '#6b7280', label: 'ไม่มีแผน/ปิดกะ' },
};

// นิยาม metric แต่ละตัว — value(ค่าเรียงอันดับ) · text(บนกรอบ) · cat(หมวดสี) · worstFirst(เรียง side panel)
const METRICS = {
  productivity: {
    label: '📦 ยอดผลิต', worstFirst: true,
    value: s => s.hasOpen || s.target > 0 ? (s.target > 0 ? Math.round(s.actual / s.target * 100) : 0) : null,
    text: s => s.target > 0 ? `${s.actual}/${s.target} · ${Math.round(s.actual / s.target * 100)}%` : (s.hasOpen ? '— ไม่มีเป้า' : ''),
    cat: s => !s.hasOpen && s.target === 0 ? 'idle' : s.target === 0 ? 'ok' : (() => { const p = s.actual / s.target * 100; return p >= 95 ? 'good' : p >= 80 ? 'ok' : 'bad'; })(),
  },
  oee: {
    label: '⚙️ OEE', worstFirst: true,
    value: s => s.oee,
    text: s => s.oee != null ? `OEE ${Math.round(s.oee)}%${s.oeeLive ? ' (สด)' : ''}` : (s.hasOpen ? 'กำลังเก็บข้อมูล...' : ''),
    cat: s => s.oee == null ? 'idle' : s.oee >= 80 ? 'good' : s.oee >= 65 ? 'ok' : 'bad',
  },
  breakdown: {
    label: '🔧 Downtime', worstFirst: true, desc: true,
    value: s => s.dtMin,
    text: s => s.dtActive ? `🔴 หยุด ${s.dtMin} น.` : s.dtMin > 0 ? `${s.dtMin} นาที` : (s.hasOpen ? 'ไม่มี' : ''),
    cat: s => s.dtActive ? 'down' : !s.hasOpen && s.dtMin === 0 ? 'idle' : s.dtMin === 0 ? 'good' : s.dtMin < 30 ? 'ok' : 'bad',
  },
  ng: {
    label: '🚫 ของเสีย', worstFirst: true, desc: true,
    value: s => s.ng,
    text: s => s.ng > 0 ? `NG ${s.ng}` : (s.hasOpen ? 'NG 0' : ''),
    cat: s => !s.hasOpen && s.ng === 0 ? 'idle' : s.ng === 0 ? 'good' : s.ng < 20 ? 'ok' : 'bad',
  },
  manpower: {
    label: '👷 คน/เข้างาน', worstFirst: false,
    value: s => s.headTotal > 0 ? Math.round(s.present / s.headTotal * 100) : null,
    text: s => s.headTotal > 0 ? `${s.present}/${s.headTotal} คน${s.ppeBad ? ` · ⚠PPE ${s.ppeBad}` : ''}` : '',
    cat: s => s.headTotal === 0 ? 'idle' : (() => { const p = s.present / s.headTotal * 100; return p >= 95 ? 'good' : p >= 80 ? 'ok' : 'bad'; })(),
  },
  pm: {
    label: '🛠️ PM เครื่องจักร', worstFirst: true, desc: true,
    value: s => s.pmTotal ? s.pmOverdue * 1000 + s.pmDueSoon : null,   // overdue สำคัญกว่า due-soon เสมอ
    text: s => s.pmTotal ? (s.pmOverdue ? `⚠ เกินกำหนด ${s.pmOverdue}` : s.pmDueSoon ? `ใกล้ครบ ${s.pmDueSoon}` : `PM ปกติ (${s.pmTotal})`) : '',
    cat: s => !s.pmTotal ? 'idle' : s.pmOverdue ? 'bad' : s.pmDueSoon ? 'ok' : 'good',
  },
};

const round = (v) => Math.round(v * 100) / 100;
const centroid = (pts) => pts.length
  ? [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]
  : [50, 50];
const EMPTY_ST = { actual: 0, target: 0, hasOpen: false, oee: null, oeeLive: false, dtMin: 0, dtActive: false, ng: 0,
  headTotal: 0, present: 0, ppeBad: 0, pmTotal: 0, pmOverdue: 0, pmDueSoon: 0 };

export default function FactoryMap() {
  const { role } = useContext(UserContext);
  const canEdit = can('factory_map', 'edit', role);

  const [imageUrl, setImageUrl] = useState(null);
  const [mapId, setMapId] = useState(null);
  const [regions, setRegions] = useState([]);
  const [lineStatus, setLineStatus] = useState({});   // production metrics (DR)
  const [manpower, setManpower] = useState({});        // คน/เข้างาน (Main)
  const [pmStatus, setPmStatus] = useState({});        // PM เครื่องจักร (DR)
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [aspect, setAspect] = useState(null);
  const [metric, setMetric] = useState('productivity');
  const [highlight, setHighlight] = useState(null); // line_name ที่คลิกจาก panel (เน้นชั่วคราว)

  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState([]);
  const [hoverPt, setHoverPt] = useState(null);
  const [snapFirst, setSnapFirst] = useState(false);
  const [assignFor, setAssignFor] = useState(null);
  const [assignLine, setAssignLine] = useState('');
  const wrapRef = useRef(null);
  const dragRef = useRef(null);
  const shiftRef = useRef(false);
  const lastRawRef = useRef(null);

  const M = METRICS[metric];

  /* ── โหลดผัง + รูปทรง + ไลน์ ── */
  const loadMap = useCallback(async () => {
    const [{ data: fm }, { data: rg }, { data: ln }] = await Promise.all([
      supabase.from('factory_map').select('id, image_url').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('factory_line_regions').select('id, line_name, points'),
      supabase.from('production_lines').select('id, name, parent_line_name').order('name'),
    ]);
    setImageUrl(fm?.image_url || null);
    setMapId(fm?.id || null);
    setRegions((rg || []).map(r => ({ ...r, points: Array.isArray(r.points) ? r.points : [] })));
    setLines(ln || []);
    setLoading(false);
  }, []);
  useEffect(() => { loadMap(); }, [loadMap]);

  /* ── metric รายไลน์ (DR) — refresh 30 วิ · เก็บทุก metric ในรอบเดียว ── */
  const loadStatus = useCallback(async () => {
    const workDate = getWorkDate();
    const { data: sessions } = await supabaseDR
      .from('production_sessions').select('id, line_name, status, oee, qty_ng, ng_qty, start_time, shift_min').eq('work_date', workDate);
    if (!sessions?.length) { setLineStatus({}); return; }
    const sessIds = sessions.map(s => s.id);
    const [{ data: orders }, { data: dts }, { data: prods }] = await Promise.all([
      supabaseDR.from('prod_orders').select('session_id, status, qty, qty_ok, qty_actual, qty_target, qty_ng, mat_no').in('session_id', sessIds),
      supabaseDR.from('downtime_logs').select('session_id, duration_min, ended_at, started_at').in('session_id', sessIds),
      supabaseDR.from('dr_products').select('mat_no, cycle_time_sec'),
    ]);
    const ctMap = {}; (prods || []).forEach(p => { ctMap[p.mat_no] = p.cycle_time_sec || 0; });
    const ordBySess = {}; (orders || []).forEach(o => { (ordBySess[o.session_id] ||= []).push(o); });
    const dtBySess = {}; (dts || []).forEach(d => { (dtBySess[d.session_id] ||= []).push(d); });
    const nowMs = Date.now();

    // OEE สด (กะยังเปิด) ≈ A×P×Q จากข้อมูลปัจจุบัน — สูตรย่อของ computeSessionOEE (DailyReport/Dashboard)
    // A = เวลารันจริง/เวลาที่ผ่านไป · P = เวลามาตรฐานที่ผลิตได้/เวลารัน · Q = ดี/ทั้งหมด · (ปิดกะแล้ว = ใช้ค่าที่ stamp ไว้)
    const liveOee = (s, os, dl) => {
      if (!s.start_time) return null;
      const opened = new Date(`${workDate}T${s.start_time.slice(0, 5)}:00`).getTime();
      let elapsed = (nowMs - opened) / 60000;
      if (s.shift_min) elapsed = Math.min(elapsed, s.shift_min);
      if (elapsed < 10) return null; // เพิ่งเปิดกะ ยังประเมินไม่ได้
      const dtM = dl.reduce((a, d) => {
        if (d.ended_at || d.duration_min != null) return a + (Number(d.duration_min) || 0);
        return a + (d.started_at ? Math.max(0, (nowMs - new Date(d.started_at).getTime()) / 60000) : 0); // ค้างอยู่ = นับถึงตอนนี้
      }, 0);
      const runMin = Math.max(1, elapsed - dtM);
      let stdMin = 0, produced = 0, ng = 0;
      os.forEach(o => {
        const q = o.status === 'confirmed' ? (o.qty_ok ?? o.qty ?? 0) : (o.qty_actual ?? 0);
        produced += q; stdMin += q * (ctMap[o.mat_no] || 0) / 60; ng += o.qty_ng || 0;
      });
      const A = Math.min(1, runMin / elapsed);
      const P = Math.min(1, runMin > 0 ? stdMin / runMin : 0);
      const Q = produced > 0 ? Math.max(0, (produced - ng) / produced) : 1;
      const oee = Math.round(A * P * Q * 100);
      return isFinite(oee) ? Math.max(0, Math.min(100, oee)) : null;
    };

    const byLine = {};
    sessions.forEach(s => {
      const os = ordBySess[s.id] || [];
      const target = os.reduce((a, o) => a + (o.qty_target ?? o.qty ?? 0), 0);
      const actual = os.reduce((a, o) => a + (o.status === 'confirmed' ? (o.qty_ok ?? o.qty ?? 0) : (o.qty_actual ?? 0)), 0);
      const dl = dtBySess[s.id] || [];
      const dtMin = dl.reduce((a, d) => a + (Number(d.duration_min) || 0), 0);
      const dtActive = dl.some(d => !d.ended_at && d.duration_min == null);
      // ปิดกะแล้ว → ใช้ oee ที่ stamp · ยังเปิด → คำนวณสด
      const oeeVal = s.oee != null ? Number(s.oee) : liveOee(s, os, dl);
      const isLive = s.oee == null && oeeVal != null;
      const acc = byLine[s.line_name] || { ...EMPTY_ST, oeeSum: 0, oeeN: 0 };
      byLine[s.line_name] = {
        actual: acc.actual + actual, target: acc.target + target,
        hasOpen: acc.hasOpen || s.status === 'open',
        dtMin: acc.dtMin + Math.round(dtMin), dtActive: acc.dtActive || dtActive,
        ng: acc.ng + (s.qty_ng ?? s.ng_qty ?? 0),
        oeeSum: acc.oeeSum + (oeeVal != null ? oeeVal : 0), oeeN: acc.oeeN + (oeeVal != null ? 1 : 0),
        oeeLive: acc.oeeLive || isLive,
      };
    });
    const out = {};
    Object.entries(byLine).forEach(([name, v]) => { out[name] = { ...v, oee: v.oeeN ? Math.round(v.oeeSum / v.oeeN) : null }; });
    setLineStatus(out);
  }, []);
  useEffect(() => { loadStatus(); const t = setInterval(loadStatus, 30000); return () => clearInterval(t); }, [loadStatus]);

  /* ── manpower รายไลน์ (Main: employees + daily_production_logs วันนี้) — refresh 60 วิ ── */
  const loadManpower = useCallback(async () => {
    const workDate = getWorkDate();
    const [{ data: emps }, { data: pls }, { data: logs }] = await Promise.all([
      supabase.from('employees').select('id, line_id').eq('is_active', true),
      supabase.from('production_lines').select('id, name'),
      supabase.from('daily_production_logs').select('employee_id, is_present, has_helmet, has_boots, has_gloves').eq('work_date', workDate),
    ]);
    const lineOfId = {}; (pls || []).forEach(l => { lineOfId[l.id] = l.name; });
    const empLine = {}; (emps || []).forEach(e => { empLine[e.id] = lineOfId[e.line_id]; });
    const logMap = {}; (logs || []).forEach(l => { logMap[l.employee_id] = l; });
    const out = {};
    (emps || []).forEach(e => {
      const ln = empLine[e.id]; if (!ln) return;
      const o = out[ln] || { headTotal: 0, present: 0, ppeBad: 0 };
      o.headTotal++;
      const log = logMap[e.id];
      if (log?.is_present) { o.present++; if (!(log.has_helmet && log.has_boots && log.has_gloves)) o.ppeBad++; }
      out[ln] = o;
    });
    setManpower(out);
  }, []);
  useEffect(() => { loadManpower(); const t = setInterval(loadManpower, 60000); return () => clearInterval(t); }, [loadManpower]);

  /* ── PM เครื่องจักรรายไลน์ (DR: machines → checklists → pm_plans) — refresh 5 นาที ── */
  const loadPM = useCallback(async () => {
    const { data: machines } = await supabaseDR.from('machines').select('id, line_name').eq('is_active', true);
    if (!machines?.length) { setPmStatus({}); return; }
    const lineOfMachine = {}; machines.forEach(m => { lineOfMachine[m.id] = m.line_name; });
    const { data: cls } = await supabaseDR.from('checklists').select('id, equipment_id').eq('module', 'mtn').in('equipment_id', machines.map(m => m.id));
    if (!cls?.length) { setPmStatus({}); return; }
    const lineOfChecklist = {}; (cls || []).forEach(c => { lineOfChecklist[c.id] = lineOfMachine[c.equipment_id]; });
    const { data: plans } = await supabaseDR.from('pm_plans').select('checklist_id, next_due_date').eq('is_active', true).in('checklist_id', cls.map(c => c.id));
    const now = new Date(); const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const soon = new Date(now.getTime() + 7 * 864e5); const soonStr = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
    const out = {};
    (plans || []).forEach(p => {
      const ln = lineOfChecklist[p.checklist_id]; if (!ln) return;
      const o = out[ln] || { pmTotal: 0, pmOverdue: 0, pmDueSoon: 0 };
      o.pmTotal++;
      if (p.next_due_date && p.next_due_date < today) o.pmOverdue++;
      else if (p.next_due_date && p.next_due_date <= soonStr) o.pmDueSoon++;
      out[ln] = o;
    });
    setPmStatus(out);
  }, []);
  useEffect(() => { loadPM(); const t = setInterval(loadPM, 300000); return () => clearInterval(t); }, [loadPM]);

  // ── family rollup: ตีกรอบ "ไลน์บนสุด (top-level)" แล้วรวมยอดของลูกขึ้นมา ──
  // (ข้อมูลจริง: พนักงาน/บางเมตริกผูกกับไลน์แม่ · บางอันผูกกับลูก → รวมทั้งครอบครัวจึงครบ)
  // ไลน์ไม่มีลูก = โชว์ตัวเอง (เช่น LINE A 800 Ton) · ไลน์มีลูก = ตัวเอง + ลูกทั้งหมด
  const childrenOf = useMemo(() => {
    const m = {};
    lines.forEach(l => { if (l.parent_line_name) (m[l.parent_line_name] ||= []).push(l.name); });
    return m;
  }, [lines]);
  const familyNames = (name) => [name, ...(childrenOf[name] || [])];
  // ตีกรอบเฉพาะ "ไลน์บนสุด (top-level)" = parent_line_name IS NULL — 1 กรอบ/กลุ่ม (รวมยอดลูกด้วย stOf)
  const topNames = useMemo(() => lines.filter(l => !l.parent_line_name).map(l => l.name), [lines]);
  const stOf = (name) => {
    const agg = { ...EMPTY_ST, oeeSum: 0, oeeN: 0 };
    familyNames(name).forEach(n => {
      const p = lineStatus[n];
      if (p) { agg.actual += p.actual || 0; agg.target += p.target || 0; agg.hasOpen = agg.hasOpen || p.hasOpen; agg.dtMin += p.dtMin || 0; agg.dtActive = agg.dtActive || p.dtActive; agg.ng += p.ng || 0; agg.oeeSum += p.oeeSum || 0; agg.oeeN += p.oeeN || 0; agg.oeeLive = agg.oeeLive || p.oeeLive; }
      const m = manpower[n];
      if (m) { agg.headTotal += m.headTotal || 0; agg.present += m.present || 0; agg.ppeBad += m.ppeBad || 0; }
      const pm = pmStatus[n];
      if (pm) { agg.pmTotal += pm.pmTotal || 0; agg.pmOverdue += pm.pmOverdue || 0; agg.pmDueSoon += pm.pmDueSoon || 0; }
    });
    agg.oee = agg.oeeN ? Math.round(agg.oeeSum / agg.oeeN) : null;
    return agg;
  };
  const catColor = (name) => CAT[M.cat(stOf(name))];

  // side panel: ไลน์ที่มีกะวันนี้ ∪ ไลน์ที่ตีกรอบไว้ — เรียงตาม metric (ปัญหาขึ้นบน)
  const ranked = useMemo(() => {
    // แสดงไลน์บนสุด (หน่วยปฏิบัติการ) + กรอบที่วาดไว้ (เผื่อของเดิมที่วาดระดับลูก) — ไม่ลิสต์ลูกแยก (รวมใน rollup แล้ว)
    const names = new Set([...topNames, ...regions.map(r => r.line_name)]);
    const arr = [...names].map(name => ({ name, st: stOf(name), val: M.value(stOf(name)), cat: M.cat(stOf(name)) }));
    arr.sort((a, b) => {
      const av = a.val, bv = b.val;
      if (av == null && bv == null) return a.name.localeCompare(b.name);
      if (av == null) return 1; if (bv == null) return -1;
      return M.desc ? bv - av : av - bv;
    });
    return arr;
  }, [lineStatus, manpower, pmStatus, regions, metric, topNames]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── อัปโหลดรูปผัง (บีบเบา 2560/2.5MB/q0.9) ── */
  const handleUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = '';
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const isGif = file.type === 'image/gif' || ext === 'gif';
    if (isGif && file.size > 2 * 1024 * 1024) return toast.error('GIF ต้องไม่เกิน 2MB');
    try {
      setUploading(true);
      const blob = isGif ? file : await imageCompression(file, { maxSizeMB: 2.5, maxWidthOrHeight: 2560, initialQuality: 0.9 });
      const path = `factory/map_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('employee-photos').upload(path, blob);
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('employee-photos').getPublicUrl(path);
      const row = mapId
        ? await supabase.from('factory_map').update({ image_url: pub.publicUrl, updated_at: new Date().toISOString() }).eq('id', mapId).select('id').single()
        : await supabase.from('factory_map').insert({ image_url: pub.publicUrl }).select('id').single();
      if (row.error) throw row.error;
      const prev = imageUrl;
      if (prev?.includes('/employee-photos/factory/')) {
        const oldName = decodeURIComponent(prev.split('/employee-photos/')[1] || '');
        if (oldName.startsWith('factory/')) supabase.storage.from('employee-photos').remove([oldName]).catch(() => {});
      }
      setMapId(row.data.id); setImageUrl(pub.publicUrl); setAspect(null);
      toast.success('อัปโหลดผังโรงงานแล้ว');
    } catch (err) { toast.error('อัปโหลดไม่สำเร็จ: ' + err.message); }
    finally { setUploading(false); }
  };

  const pctFromEvent = (clientX, clientY) => {
    const r = wrapRef.current.getBoundingClientRect();
    return { x: Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)), y: Math.min(100, Math.max(0, ((clientY - r.top) / r.height) * 100)) };
  };
  const framedTopCount = regions.filter(r => topNames.includes(r.line_name)).length;
  const assignableLines = () => topNames.filter(n => !regions.some(r => r.line_name === n));

  /* ── หาจุดที่จะวาง: แม่เหล็กจุดแรก > Shift ตั้งฉาก > ปกติ ── */
  const resolveDrawPoint = (p, shift) => {
    if (draft.length >= 3) { const f = draft[0]; if (Math.hypot(f[0] - p.x, f[1] - p.y) < 3) return { pt: [f[0], f[1]], snap: true }; }
    if (shift && draft.length) {
      const last = draft[draft.length - 1];
      return Math.abs(p.x - last[0]) >= Math.abs(p.y - last[1]) ? { pt: [round(p.x), last[1]], snap: false } : { pt: [last[0], round(p.y)], snap: false };
    }
    return { pt: [round(p.x), round(p.y)], snap: false };
  };
  const onMapClick = (e) => {
    if (!editing || !drawing) return;
    if (e.target.closest('[data-handle]') || e.target.closest('button')) return;
    const { pt, snap } = resolveDrawPoint(pctFromEvent(e.clientX, e.clientY), e.shiftKey);
    if (snap) return finishDraw();
    setDraft(prev => [...prev, pt]);
  };
  const onMapMove = (e) => {
    if (drawing) {
      lastRawRef.current = { x: e.clientX, y: e.clientY };
      if (draft.length) { const { pt, snap } = resolveDrawPoint(pctFromEvent(e.clientX, e.clientY), e.shiftKey); setHoverPt(pt); setSnapFirst(snap); }
      return;
    }
    if (dragRef.current) {
      const p = pctFromEvent(e.clientX, e.clientY);
      const d = dragRef.current, dx = p.x - d.px, dy = p.y - d.py;
      setRegions(prev => prev.map(r => {
        if (r.id !== d.id) return r;
        const pts = d.base.map((pt, i) => (d.vi === -1 || d.vi === i) ? [Math.min(100, Math.max(0, round(pt[0] + dx))), Math.min(100, Math.max(0, round(pt[1] + dy)))] : pt);
        return { ...r, points: pts };
      }));
    }
  };
  const finishDraw = () => {
    const pts = draft;
    setDraft([]); setHoverPt(null); setSnapFirst(false); setDrawing(false);
    if (pts.length < 3) return;
    if (!assignableLines().length) return toast.error('ทุกไลน์ถูกวางกรอบแล้ว');
    setAssignLine(''); setAssignFor(pts);
  };
  const confirmAssign = async () => {
    if (!assignLine) return toast.error('เลือกไลน์ก่อน');
    const pts = assignFor; setAssignFor(null);
    const { data, error } = await supabase.from('factory_line_regions').insert({ line_name: assignLine, points: pts }).select().single();
    if (error) return toast.error('บันทึกไม่สำเร็จ: ' + error.message);
    setRegions(prev => [...prev, { ...data, points: pts }]);
    toast.success(`ตีกรอบ ${assignLine} แล้ว`);
  };
  const cancelDraw = () => { setDraft([]); setHoverPt(null); setSnapFirst(false); setDrawing(false); };

  useEffect(() => {
    if (!drawing) return;
    const recompute = () => {
      if (!lastRawRef.current || !draft.length) return;
      const { pt, snap } = resolveDrawPoint(pctFromEvent(lastRawRef.current.x, lastRawRef.current.y), shiftRef.current);
      setHoverPt(pt); setSnapFirst(snap);
    };
    const down = (e) => { if (e.key === 'Shift') { shiftRef.current = true; recompute(); } if (e.key === 'Escape') cancelDraw(); };
    const up = (e) => { if (e.key === 'Shift') { shiftRef.current = false; recompute(); } };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const startDrag = (e, region, vi) => {
    if (!editing || drawing) return;
    e.stopPropagation();
    wrapRef.current?.setPointerCapture?.(e.pointerId);
    const p = pctFromEvent(e.clientX, e.clientY);
    dragRef.current = { id: region.id, vi, px: p.x, py: p.y, base: region.points.map(pt => [...pt]) };
  };
  const endDrag = async () => {
    if (!dragRef.current) return;
    const id = dragRef.current.id; dragRef.current = null;
    const r = regions.find(x => x.id === id);
    if (r) await supabase.from('factory_line_regions').update({ points: r.points }).eq('id', id);
  };
  const deleteRegion = async (id) => {
    const rg = regions.find(r => r.id === id);
    if (!window.confirm(`ลบกรอบไลน์ "${rg?.line_name || ''}" ?`)) return;
    setRegions(prev => prev.filter(r => r.id !== id));
    const { error } = await supabase.from('factory_line_regions').delete().eq('id', id);
    if (error) toast.error(error.message);
  };

  const onImgLoad = (e) => setAspect(e.target.naturalWidth / e.target.naturalHeight);
  const wrapStyle = aspect ? { width: `min(100%, calc((100vh - 210px) * ${aspect}))` } : { width: '100%' };
  const ptsStr = (pts) => pts.map(p => `${p[0]},${p[1]}`).join(' ');
  const flashLine = (name) => { setHighlight(name); setTimeout(() => setHighlight(h => h === name ? null : h), 2000); };

  return (
    <div className="page-content" style={{ maxWidth: 'min(98vw, 2400px)', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(16px,3vw,22px)', color: 'var(--text)' }}>🗺️ ผังรวมโรงงาน</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>ทุกไลน์บนผังเดียว — เลือกดูได้หลายมุมมอง · อัปเดตทุก 30 วินาที</p>
        </div>
        {canEdit && <button onClick={() => { setEditing(v => !v); cancelDraw(); }} style={btn(editing)}>{editing ? '✓ เสร็จ' : '✏️ แก้ผัง'}</button>}
      </div>

      {/* เลือก metric */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {Object.entries(METRICS).map(([k, m]) => (
          <button key={k} onClick={() => setMetric(k)} style={btn(metric === k)}>{m.label}</button>
        ))}
      </div>

      {editing && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
          <label style={{ ...btn(false), display: 'inline-flex', alignItems: 'center', gap: 6, cursor: uploading ? 'default' : 'pointer' }}>
            {uploading ? '⏳ กำลังอัปโหลด...' : (imageUrl ? '🖼️ เปลี่ยนรูปผัง' : '🖼️ อัปโหลดรูปผังโรงงาน')}
            <input type="file" accept="image/*" onChange={handleUpload} disabled={uploading} style={{ display: 'none' }} />
          </label>
          {imageUrl && !drawing && <button onClick={() => { setDrawing(true); setDraft([]); }} disabled={!assignableLines().length} style={btn(false)}>✏️ วาดกรอบไลน์ใหม่</button>}
          {drawing && (
            <>
              <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>🖊️ คลิกทีละจุดล้อมพื้นที่ (L/U ได้) · กด <b>Shift</b> = เส้นตั้งฉาก · เข้าใกล้จุดแรก = ดูดปิดรูป</span>
              <button onClick={finishDraw} disabled={draft.length < 3} style={btn(true)}>✓ เสร็จ ({draft.length} จุด)</button>
              <button onClick={() => setDraft(p => p.slice(0, -1))} disabled={!draft.length} style={btn(false)}>↩ ลบจุดล่าสุด</button>
              <button onClick={cancelDraw} style={btn(false)}>✕ ยกเลิก</button>
            </>
          )}
          {!drawing && <span style={{ fontSize: 12, color: 'var(--muted)' }}>ลากกลางรูป=ย้าย · ลากจุดมุม=ปรับรูปทรง</span>}
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>ตีกรอบแล้ว {framedTopCount}/{topNames.length} ไลน์ (กลุ่มบนสุด · รวมยอดลูกให้อัตโนมัติ)</span>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลด...</div>
      ) : !imageUrl ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)', background: 'var(--card)', border: '1px dashed var(--border2)', borderRadius: 12 }}>
          ยังไม่มีรูปผังโรงงาน — {canEdit ? 'กด "✏️ แก้ผัง" แล้วอัปโหลดรูป' : 'ให้ผู้ดูแลอัปโหลดรูปผังก่อน'}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* ── ผัง ── */}
          <div style={{ flex: '1 1 640px', minWidth: 0, display: 'flex', justifyContent: 'center' }}>
          <div ref={wrapRef} onClick={onMapClick} onPointerMove={onMapMove} onPointerUp={endDrag} onPointerCancel={endDrag}
            style={{ position: 'relative', ...wrapStyle, maxHeight: 'calc(100vh - 200px)', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', cursor: drawing ? 'crosshair' : 'default', touchAction: 'none', background: '#0a0a0f' }}>
            <img src={imageUrl} alt="ผังโรงงาน" onLoad={onImgLoad} style={{ display: 'block', width: '100%', height: 'auto', pointerEvents: 'none', userSelect: 'none' }} />
            {/* scrim บางๆ ให้กรอบเด่นแต่ยังเห็นผังชัด (ไม่หรี่จนภาพหม่น) */}
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(6,8,14,0.14)', pointerEvents: 'none' }} />

            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
              {regions.map(r => {
                const cat = M.cat(stOf(r.line_name)); const meta = CAT[cat]; const hl = highlight === r.line_name;
                return (
                  <polygon key={r.id} data-region points={ptsStr(r.points)}
                    className={meta.blink ? 'region-alarm' : undefined}
                    fill={meta.blink ? undefined : `${meta.color}${hl ? '55' : '33'}`} stroke={meta.blink ? undefined : meta.color}
                    strokeWidth={hl ? '4' : '2'} vectorEffect="non-scaling-stroke" strokeLinejoin="round"
                    style={{ pointerEvents: editing && !drawing ? 'auto' : 'none', cursor: editing && !drawing ? 'move' : 'default' }}
                    onPointerDown={(e) => startDrag(e, r, -1)} />
                );
              })}
              {drawing && draft.length > 0 && (
                <polyline points={ptsStr(hoverPt ? [...draft, hoverPt] : draft)} fill={snapFirst ? 'rgba(34,197,94,0.18)' : 'rgba(77,159,255,0.12)'} stroke={snapFirst ? '#22c55e' : '#4d9fff'} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeDasharray="3 2" />
              )}
            </svg>

            {drawing && draft.map((pt, i) => (
              <div key={`d-${i}`} style={{ position: 'absolute', left: `${pt[0]}%`, top: `${pt[1]}%`, width: i === 0 ? (snapFirst ? 22 : 16) : 11, height: i === 0 ? (snapFirst ? 22 : 16) : 11, transform: 'translate(-50%,-50%)', borderRadius: '50%', background: i === 0 ? (snapFirst ? 'rgba(34,197,94,0.35)' : 'rgba(77,159,255,0.3)') : '#4d9fff', border: `2px solid ${i === 0 ? '#22c55e' : '#fff'}`, pointerEvents: 'none', transition: 'width .1s,height .1s' }} />
            ))}

            {/* ป้าย = การ์ดทึบมีขอบสีสถานะ (อ่านออกทุกพื้นหลัง) + จุดแดงถ้า downtime ค้าง */}
            {regions.map(r => {
              const [cx, cy] = centroid(r.points); const st = stOf(r.line_name); const meta = CAT[M.cat(st)]; const txt = M.text(st);
              return (
                <div key={`lbl-${r.id}`} style={{ position: 'absolute', left: `${cx}%`, top: `${cy}%`, transform: 'translate(-50%,-50%)', pointerEvents: 'none' }}>
                  {/* ป้ายโปร่งแสง + เส้นสีสถานะด้านล่าง — อ่านออกแต่ยังเห็นผังทะลุ (ไม่ทึบทับภาพ) */}
                  <div style={{ background: 'rgba(10,12,20,0.5)', borderBottom: `2.5px solid ${meta.color}`, borderRadius: 5, padding: '1px 7px 2px', textAlign: 'center', textShadow: '0 1px 3px rgba(0,0,0,0.95)' }}>
                    <div style={{ fontSize: 'clamp(11px,1vw,14px)', fontWeight: 800, color: '#fff', whiteSpace: 'nowrap', lineHeight: 1.25 }}>
                      {st.dtActive && metric !== 'breakdown' && <span className="dt-alarm-icon" style={{ color: '#ef4444' }}>🔴 </span>}{r.line_name}
                    </div>
                    {txt && <div style={{ fontSize: 'clamp(10px,0.9vw,12.5px)', fontWeight: 800, color: meta.color, whiteSpace: 'nowrap', lineHeight: 1.2 }}>{txt}</div>}
                  </div>
                </div>
              );
            })}

            {editing && !drawing && regions.map(r => {
              const [cx, cy] = centroid(r.points);
              return (
                <div key={`h-${r.id}`}>
                  {r.points.map((pt, i) => (
                    <div key={i} data-handle onPointerDown={(e) => startDrag(e, r, i)} style={{ position: 'absolute', left: `${pt[0]}%`, top: `${pt[1]}%`, width: 14, height: 14, transform: 'translate(-50%,-50%)', background: '#4d9fff', border: '2px solid #fff', borderRadius: 3, cursor: 'grab', touchAction: 'none' }} />
                  ))}
                  <button onClick={(e) => { e.stopPropagation(); deleteRegion(r.id); }} title={`ลบกรอบ ${r.line_name}`} style={{ position: 'absolute', left: `${cx}%`, top: `${cy}%`, transform: 'translate(-50%,-140%)', width: 22, height: 22, borderRadius: 6, border: 'none', background: 'rgba(239,68,68,0.92)', color: '#fff', fontSize: 13, cursor: 'pointer', lineHeight: 1 }}>✕</button>
                </div>
              );
            })}
          </div>
          </div>

          {/* ── side panel: สรุป + จัดอันดับไลน์ตาม metric (ใช้พื้นที่ข้าง) ── */}
          {!editing && (() => {
            const counts = ranked.reduce((a, r) => { a[r.cat] = (a[r.cat] || 0) + 1; return a; }, {});
            const maxVal = Math.max(1, ...ranked.map(r => (r.val == null ? 0 : Math.abs(r.val))));
            const isPct = ['productivity', 'oee', 'manpower'].includes(metric);
            return (
            <aside style={{ flex: '0 0 340px', maxWidth: '100%', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>{M.label} — จัดอันดับ</div>
              {/* สรุปจำนวนไลน์ตามสถานะ */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                {['bad', 'down', 'ok', 'good', 'idle'].filter(c => counts[c]).map(c => (
                  <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: CAT[c].color, background: `${CAT[c].color}1a`, border: `1px solid ${CAT[c].color}44`, padding: '3px 9px', borderRadius: 20 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: CAT[c].color }} />{counts[c]} {CAT[c].label}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>{M.desc ? 'มาก → น้อย (ปัญหาขึ้นบน)' : 'น้อย → มาก (ตามหลังขึ้นบน)'} · คลิกแถวเพื่อเน้นบนผัง</div>
              {ranked.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--muted)', padding: 20, textAlign: 'center' }}>ยังไม่มีข้อมูลวันนี้</div>
              ) : ranked.map(({ name, st, cat, val }, i) => {
                const meta = CAT[cat]; const txt = M.text(st); const hasRegion = regions.some(r => r.line_name === name);
                const barW = val == null ? 0 : isPct ? Math.min(100, Math.abs(val)) : Math.round(Math.abs(val) / maxVal * 100);
                return (
                  <div key={name} onClick={() => hasRegion && flashLine(name)}
                    style={{ padding: '8px 10px', borderRadius: 9, marginBottom: 5, cursor: hasRegion ? 'pointer' : 'default', background: highlight === name ? 'var(--bg2)' : 'var(--bg3)', border: `1px solid ${highlight === name ? meta.color : 'var(--border2)'}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', width: 18, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                      <span className={meta.blink ? 'dt-alarm-blink' : undefined} style={{ width: 11, height: 11, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                      <div style={{ minWidth: 0, flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {name}{!hasRegion && <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}> · ยังไม่ตีกรอบ</span>}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: meta.color, whiteSpace: 'nowrap', flexShrink: 0 }}>{txt || '—'}</div>
                    </div>
                    {/* แถบเทียบสัดส่วน */}
                    <div style={{ height: 5, borderRadius: 3, background: 'var(--bg)', marginTop: 6, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${barW}%`, background: meta.color, borderRadius: 3, transition: 'width .3s' }} />
                    </div>
                  </div>
                );
              })}
            </aside>
            );
          })()}
        </div>
      )}

      {editing && imageUrl && assignableLines().length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>ยังไม่ได้ตีกรอบ: <span style={{ color: '#f59e0b' }}>{assignableLines().join(', ')}</span></div>
      )}

      {assignFor && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '22px 24px', width: '100%', maxWidth: 360 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>🖊️ ตีกรอบให้ไลน์ไหน?</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>เลือกไลน์ที่จะผูกกับรูปที่วาด ({assignFor.length} จุด)</div>
            <select value={assignLine} onChange={e => setAssignLine(e.target.value)} autoFocus style={{ width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 14, marginBottom: 16 }}>
              <option value="">— เลือกไลน์ —</option>
              {assignableLines().map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setAssignFor(null)} style={{ flex: 1, padding: '11px 0', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)' }}>ยกเลิก</button>
              <button onClick={confirmAssign} disabled={!assignLine} style={{ flex: 2, padding: '11px 0', borderRadius: 9, fontSize: 13, fontWeight: 800, cursor: assignLine ? 'pointer' : 'not-allowed', background: assignLine ? 'var(--accent)' : 'var(--muted)', color: '#fff', border: 'none' }}>✓ ตีกรอบ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const btn = (active) => ({
  padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  border: `1px solid ${active ? 'var(--accent)' : 'var(--border2)'}`,
  background: active ? 'var(--accent-dim)' : 'var(--bg3)', color: active ? 'var(--accent)' : 'var(--text2)',
});
