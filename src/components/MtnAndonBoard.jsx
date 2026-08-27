/* ══════════════════════════════════════════════════════════════════════════
   🚨 จอห้องช่าง (Maintenance Andon Board) — `/dept-dashboard?dept=maintenance&view=andon`

   ที่มา (feedback หน้างาน 2026-08-24): จอ TV ในห้องช่างเปิด `/factory-map` อยู่
   ซึ่งเป็น "ผังภาพรวมทั้งโรงงาน" ใบเดียวกับที่ผู้บริหารดู — ตอบคำถามของช่างไม่ได้
   และ **ไม่มีเสียงเตือนเครื่องเบรคดาวน์เลย** (DowntimeSiren ไม่ได้ mount ที่หน้านั้น)

   รอบ 2 (2026-08-25): *"หน้าช่างก็สามารถแยกแผนกของช่างได้นะเพราะนั่งกันคนละห้อง ·
   พอมีอลาม จะมีกระพริบบอกตำแหน่งไลน์ที่แจ้งด้วยมั้ย ไม่อยากให้มีแต่ตัวหนังสือ ·
   ภาพที่ช่างเห็นก็อยากให้คล้ายแผนที่โรงงาน"*
     → **แยกทีมด้วย `?team=` ใน URL** (ห้องละบุ๊กมาร์ก — จอไม่ต้องมีคนกดทุกเช้า)
     → **ผังโรงงานจริงอยู่ซ้ายมือ ไลน์ที่แจ้งกระพริบตรงตำแหน่ง** (`<FactoryMiniMap>`)

   จอนี้ตอบ 3 คำถามของช่าง เรียงตามความเร่งด่วน — อ่านจากอีกฝั่งห้องได้:
     ① ตอนนี้เครื่องไหนหยุด · อยู่ตรงไหนของโรงงาน · กี่นาทีแล้ว   ← ใหญ่สุด + มีเสียง
     ② ใบซ่อมที่รับไปแล้วค้างอยู่ขั้นไหน
     ③ PM ที่เกินกำหนด/ครบวันนี้

   ⚠️ กฎที่ห้ามแหก (Andon · CLAUDE.md):
     · **หยุดตามแผน (planned) ห้ามแดง ห้ามส่งเสียง** — นับสต๊อก/5ส/ไม่มีแผนผลิต ไม่ใช่ความเสียหาย
       แต่ **ห้ามซ่อน** → แสดงแยกเป็นบล็อกเทาสงบ
     · **กระพริบเฉพาะแดง** (เรียกช่างแล้วยังไม่รับทราบ) · เกินเกณฑ์ = ส้ม "นิ่ง"
     · เสียงใช้ `DowntimeSiren mode="call_mtn"` ตัวเดียวกับ `/mtn-layout`
       (`open_15min` เป็นของจอฝ่ายผลิตตามกติกาเดิม — ที่นี่เห็นด้วยตา ไม่ส่งเสียงซ้ำ)
     · **กรองทีมแล้วต้องบอกว่าซ่อนไปกี่รายการ** — การจับคู่เครื่อง↔ทีมเป็นการ *เดา* จากชนิดอุปกรณ์
       (กฎเหล็ก: ชนิดอุปกรณ์ไม่ได้ล็อกว่าใครเป็นคนตรวจ) ห้ามให้ของหายเงียบ
     · **สถานะที่ระบบ "ไม่รู้" ต้องบอกว่าไม่รู้** — ไม่มี SCADA/มิเตอร์รายเครื่อง จึงบอกได้แค่
       "ไลน์นี้เปิดกะอยู่ / มีคนลง downtime ค้างไว้" **ห้ามเขียนว่า online/พลังงานเรียลไทม์**
     · **อ่านอย่างเดียว** ทุกอย่างที่กดได้ = ลิงก์ไปหน้าที่ทำงานจริง
   ══════════════════════════════════════════════════════════════════════════ */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { isOpenDT, isPlannedDT, dtElapsedMin, fmtDtElapsed, isOverDtThreshold, DT_OPEN_ALERT_MIN_DEFAULT } from '../utils/downtimeRules';
import { loadDtAlertMin } from '../utils/downtimeAlarm';
import { visibleInterval } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';
import { cachedMaster } from '../utils/masterCache';
import { OPEN_MO_STATUSES, MO_STATUS_LABEL } from '../utils/dieStatus';
import { MTN_TEAMS, deptNameOf, teamKeyOf, teamsForUser, teamForEquipmentKind } from '../utils/mtnTeams';
import DowntimeSiren from './DowntimeSiren';
import FactoryMiniMap from './FactoryMiniMap';

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 };
/* ⚠️ downtime ที่กรอกแค่จำนวนนาที (ไม่มี started_at) จะไม่รู้ว่าหยุดมากี่นาที — ต้องบอกว่า "ไม่รู้"
   ห้ามแปลงเป็น 0 (0 น. อ่านเป็น "เพิ่งหยุด" ซึ่งคนละเรื่องกับ "ไม่รู้เวลาเริ่ม")
   รูปแบบเดียวกับผังรวม/Dashboard — แก้ที่ downtimeRules.js ที่เดียว */
const fmtMin = fmtDtElapsed;
const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso)) / 86400000) : null);
const normNo = (s) => String(s || '').trim().toUpperCase();

const TEAM_ICON = { maintenance: '🔧', jig_maintenance: '🗜️', die_maintenance: '🔨', production: '🏭' };

/** จัดระดับความเร่งด่วนของ downtime ที่ยังเปิดค้าง — ใช้ทั้งสี ลำดับ และการกระพริบบนผัง
    ⚠️ "เกินเกณฑ์" ตัดสินจาก **เวลาที่ผ่านไปจริง** ไม่ใช่ธง `open_alerted_at`
       (ธงนั้น edge stamp ให้เฉพาะตอนแจ้ง Telegram สำเร็จ — Telegram ล่ม = จอนี้อ่านเครื่องที่หยุด
        มา 3 ชม. ว่า "⏱️ เพิ่งหยุด" · เจอจริง 2026-08-26) */
function severity(x, thrMin) {
  if (isPlannedDT(x)) return { k: 'planned', rank: 3, color: '#6b7280', label: '🗓️ หยุดตามแผน', blink: false };
  if (x.call_mtn && !x.call_mtn_ack_at) return { k: 'call', rank: 0, color: '#ef4444', label: '📞 เรียกช่าง', blink: true };
  if (isOverDtThreshold(x, thrMin)) return { k: 'over', rank: 1, color: '#f59e0b', label: '⏰ หยุดเกินเกณฑ์', blink: false };
  return { k: 'new', rank: 2, color: '#facc15', label: '⏱️ เพิ่งหยุด', blink: false };
}

export default function MtnAndonBoard({ d, ctx }) {
  const { inScope, navigate, isMobile, workDate } = ctx;
  const { mtnTeams, sections } = useContext(UserContext);
  const [sp, setSp] = useSearchParams();

  const [dts, setDts] = useState([]);
  const [openLines, setOpenLines] = useState([]);   // ไลน์ที่เปิดกะอยู่วันนี้
  const [mcKind, setMcKind] = useState({});         // machine_no → equipment_kind
  const [dtErr, setDtErr] = useState(null);
  const [thr, setThr] = useState(DT_OPEN_ALERT_MIN_DEFAULT);  // เกณฑ์ "หยุดเกินกี่นาที" (dt_alert_config)
  const [zoom, setZoom] = useState(null);           // ไลน์ที่กดจากผัง → เจาะดูปัญหาของไลน์นั้น
  const [, setTick] = useState(0);                  // นาฬิกาเดิน — ให้ "กี่นาทีแล้ว" ขยับเอง

  /* ความสูงคอลัมน์ขวา = **ความสูงจริงของผัง** (วัดด้วย ResizeObserver ไม่ใช่เดา `100vh - Npx`)
     จอ TV ไม่มีใครเลื่อนหน้าจอ — เดิมการ์ด PM หลุดใต้ fold มองไม่เห็นตลอดกาล
     ⚠️ กฎ UI §6.8: ถ้าจำเป็นต้องมีกรอบเลื่อน **ห้ามเดาความสูง header** ต้องวัดจริง
        (เดาแล้วกล่องยื่นพ้นจอ = สกรอลบาร์อยู่นอกจอ เนื้อหาท้ายเข้าไม่ถึงถาวร — เคสจริง /line-stock)
     ที่นี่วัดจากพี่น้องในกริดเดียวกันจึงตรงเสมอ และไม่เกิดลูป (คอลัมน์ซ้ายสูงตามเนื้อหาตัวเอง) */
  const leftRef = useRef(null);
  const [leftH, setLeftH] = useState(null);
  // ความสูงจริงของบรรทัดคำอธิบายใต้ผัง — ส่งให้ผังหักออกจากพื้นที่ที่มันใช้ได้ (ห้ามเดาเป็นตัวเลขคงที่
  // เพราะบรรทัดนี้ตัดคำเป็น 2 แถวเองเมื่อคอลัมน์แคบ)
  const legRef = useRef(null);
  const [legH, setLegH] = useState(30);
  useEffect(() => {
    const el = leftRef.current;
    if (!el || isMobile || typeof ResizeObserver === 'undefined') { setLeftH(null); return; }
    const ro = new ResizeObserver(() => setLeftH(el.getBoundingClientRect().height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [isMobile]);
  useEffect(() => {
    const el = legRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setLegH(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── ทีมที่กำลังดู — อยู่ใน URL เพื่อให้จอแต่ละห้องบุ๊กมาร์กของตัวเองได้ ──
     ยังไม่เลือก = ทีมของบัญชีที่เปิดจอ (ถ้ามีทีมเดียว) · ไม่งั้น = ทุกทีม */
  const myTeams = useMemo(() => teamsForUser(mtnTeams, sections), [mtnTeams, sections]);
  const urlTeam = teamKeyOf(sp.get('team'));
  const team = MTN_TEAMS.includes(urlTeam) ? urlTeam : (sp.get('team') === 'all' ? null : (myTeams.length === 1 ? myTeams[0] : null));
  const setTeam = (t) => { const n = new URLSearchParams(sp); n.set('team', t || 'all'); setSp(n, { replace: true }); };

  const load = useCallback(async () => {
    /* เปิดค้าง = ยังไม่ปิดรายการ (ไม่มีทั้งเวลาจบและจำนวนนาที) — เกณฑ์เดียวกับ DowntimeSiren
       ⚠️ คอลัมน์ชื่อประเภทคือ `name_th` (dr_*_types ทุกตัว) — ใส่ `name` = 42703 คิวรีล้มทั้งก้อนเงียบ */
    const [dtRes, sessRes] = await Promise.all([
      supabaseDR.from('downtime_logs')
        .select('id, machine_no, description, started_at, call_mtn, call_mtn_at, call_mtn_ack_at, open_alerted_at, open_ack_at, duration_min, ended_at, dr_downtime_types(name_th, category), production_sessions(line_name, status, shift)')
        .is('duration_min', null).is('ended_at', null),
      supabaseDR.from('production_sessions').select('line_name, status').eq('work_date', workDate),
    ]);
    if (dtRes.error) { setDtErr(dtRes.error.message); return; }
    setDtErr(null);
    // เอาเฉพาะของกะที่ยังเปิดจริง + อยู่ในขอบเขตที่ผู้ใช้ดูแล
    setDts((dtRes.data || []).filter(x =>
      ['open', 'pending_close'].includes(x.production_sessions?.status) && inScope(x.production_sessions?.line_name)));
    setOpenLines([...new Set((sessRes.data || [])
      .filter(s => ['open', 'pending_close'].includes(s.status) && inScope(s.line_name))
      .map(s => s.line_name))]);
  }, [inScope, workDate]);

  useEffect(() => { loadDtAlertMin().then(setThr); }, []);

  useEffect(() => {
    load();
    const stopPoll = visibleInterval(load, RATE.ANDON);      // กันเหนียวเผื่อ realtime หลุด
    const ch = supabaseDR.channel('mtn-andon')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'downtime_logs' }, () => setTimeout(load, 400))
      .subscribe();
    const clk = setInterval(() => setTick(t => t + 1), 30000); // นาฬิกาอย่างเดียว ไม่ยิง DB
    return () => { stopPoll(); supabaseDR.removeChannel(ch); clearInterval(clk); };
  }, [load]);

  // ทะเบียนเครื่อง (master — cache ตามกฎ egress) ใช้เดาว่าเครื่องนี้ปกติทีมไหนดูแล
  useEffect(() => {
    cachedMaster('machines:kind', async () => {
      const { data, error } = await supabaseDR.from('machines').select('machine_no, equipment_kind').eq('is_active', true);
      if (error) throw error;
      return data || [];
    }).then(rows => {
      const m = {}; (rows || []).forEach(r => { if (r.machine_no) m[normNo(r.machine_no)] = r.equipment_kind; });
      setMcKind(m);
    }).catch(() => setMcKind({}));   // เดาทีมไม่ได้ = ทุกอย่างตกกลุ่ม "ไม่ระบุ" ซึ่งแสดงทุกทีมอยู่แล้ว
  }, []);

  /* ── ทีมของ downtime แต่ละรายการ ──
     ลำดับ: (1) มีใบซ่อมเปิดของเครื่องนั้น → ใช้ `mtn_orders.mtn_dept` = ข้อเท็จจริง
            (2) ไม่มี → เดาจากชนิดอุปกรณ์
            (3) ไม่รู้จักเครื่อง/ไม่ได้ระบุเครื่อง → null = "ไม่ระบุ" → **แสดงให้ทุกทีมเห็น** */
  const moTeamByMc = useMemo(() => {
    const m = {};
    (d.mo || []).filter(o => OPEN_MO_STATUSES.includes(o.status) && o.machine_no)
      .forEach(o => { const k = normNo(o.machine_no); if (!m[k]) m[k] = teamKeyOf(o.mtn_dept); });
    return m;
  }, [d.mo]);
  const teamOfDt = useCallback((x) => {
    const k = normNo(x.machine_no);
    if (!k) return null;
    if (moTeamByMc[k]) return moTeamByMc[k];
    const kind = mcKind[k];
    return kind ? teamForEquipmentKind(kind) : null;
  }, [moTeamByMc, mcKind]);

  const allRows = useMemo(() => dts
    .filter(isOpenDT)
    .map(x => ({ ...x, _s: severity(x, thr), _min: dtElapsedMin(x), _team: teamOfDt(x) }))
    .sort((a, b) => a._s.rank - b._s.rank || (b._min ?? -1) - (a._min ?? -1)), [dts, teamOfDt, thr]);

  // ทีมที่ไม่ระบุ (ไม่รู้เครื่อง) ต้องเห็นเสมอ — ปล่อยหลุดจอไม่ได้
  const rows = useMemo(() => (team ? allRows.filter(r => !r._team || r._team === team) : allRows), [allRows, team]);
  const hiddenByTeam = allRows.length - rows.length;

  const live = rows.filter(r => r._s.k !== 'planned');
  const planned = rows.filter(r => r._s.k === 'planned');
  const nCall = live.filter(r => r._s.k === 'call').length;

  /* ── สถานะรายไลน์สำหรับระบายสีบนผัง ──
     🔴 มี downtime นอกแผนค้าง (กระพริบถ้ายังไม่มีใครรับสายเรียกช่าง) · 🟢 เปิดกะอยู่ · ⚪ ไม่ได้เปิดกะ
     ⚠️ "เปิดกะอยู่" ≠ "เครื่องเดินอยู่" — ระบบยังไม่มีสัญญาณรายเครื่อง (ต้องมี SCADA) ห้ามเขียนว่า online */
  const lineState = useMemo(() => {
    const m = {};
    live.forEach(r => {
      const ln = r.production_sessions?.line_name; if (!ln) return;
      const cur = m[ln];
      if (!cur) { m[ln] = { rank: r._s.rank, color: r._s.color, blink: r._s.blink, min: r._min }; return; }
      // ไลน์เดียวหยุดหลายเครื่อง → เอาสีของตัวที่ด่วนสุด · นาทีของตัวที่หยุดนานสุด
      // · กระพริบถ้ามีสักตัวที่เรียกช่างแล้วยังไม่รับทราบ (สร้าง object ใหม่ ห้าม mutate — React Compiler)
      const worse = r._s.rank < cur.rank;
      const mx = Math.max(cur.min ?? -1, r._min ?? -1);
      m[ln] = {
        rank: worse ? r._s.rank : cur.rank,
        color: worse ? r._s.color : cur.color,
        blink: cur.blink || r._s.blink,
        min: mx < 0 ? null : mx,
      };
    });
    return m;
  }, [live]);
  const openSet = useMemo(() => new Set(openLines), [openLines]);
  const stateOf = useCallback((lineName) => {
    const st = lineState[lineName];
    if (st) return { color: st.color, blink: st.blink, label: `หยุด ${fmtMin(st.min)}` };
    if (openSet.has(lineName)) return { color: '#22c55e', blink: false, label: null };
    return null;   // ไม่ได้เปิดกะ → เทาจาง
  }, [lineState, openSet]);

  /* ── ใบซ่อมค้าง (จาก loader ของส่วนงานซ่อมบำรุง — ไม่ยิงซ้ำ) ── */
  const allMo = useMemo(() => (d.mo || [])
    .filter(o => OPEN_MO_STATUSES.includes(o.status))
    .filter(o => !o.line_name || inScope(o.line_name))
    .sort((a, b) => String(a.report_at || '').localeCompare(String(b.report_at || ''))), [d.mo, inScope]);
  const mo = useMemo(() => (team ? allMo.filter(o => !o.mtn_dept || teamKeyOf(o.mtn_dept) === team) : allMo), [allMo, team]);
  const moHidden = allMo.length - mo.length;
  const moByStep = useMemo(() => {
    const m = {}; mo.forEach(o => { m[o.status] = (m[o.status] || 0) + 1; }); return m;
  }, [mo]);

  /* ── PM เกินกำหนด / ครบใน 3 วัน (กรองทีมด้วย `checklists.department` = ตัวจริงว่าใครตรวจ) ── */
  const pm = useMemo(() => {
    const clById = {}; (d.cls || []).forEach(c => { clById[c.id] = c; });
    const jigById = {}; (d.jigs || []).forEach(j => { jigById[j.id] = j; });
    return (d.plans || []).filter(p => p.next_due_date).map(p => {
      const cl = clById[p.checklist_id];
      const j = jigById[cl?.equipment_id];
      return {
        ...p, dept: teamKeyOf(cl?.department),
        name: j?.name || j?.jig_no || j?.machine_no || 'อุปกรณ์ (ไม่พบชื่อ)', line: j?.line_name || '',
        days: Math.round((new Date(`${p.next_due_date}T00:00:00`) - new Date(`${workDate}T00:00:00`)) / 86400000),
      };
    }).filter(p => p.days <= 3 && (!team || !p.dept || p.dept === team)).sort((a, b) => a.days - b.days);
  }, [d, workDate, team]);

  const big = isMobile ? 1 : 2;   // ตัวคูณขนาดตัวอักษรสำหรับจอ TV

  return (
    <>
      <DowntimeSiren mode="call_mtn" />

      {/* ── แถบสรุปบนสุด — อ่านจากอีกฝั่งห้องได้ · ชิปเลือกทีมอยู่ในแถวนี้ด้วย ──
          ⚠️ ชิปทีมเคยเป็นแถวของตัวเองเหนือแถบสรุป — ยุบเข้ามาเพราะบนจอ TV ทุกแถวที่เพิ่ม
          คือความสูงที่ผังเสียไป (ผังคือพระเอกของจอนี้) · ยังเลือกทีมได้ครบเหมือนเดิม */}
      <div style={{
        ...card, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', justifyContent: 'space-between',
        borderColor: nCall ? '#ef4444' : live.length ? '#f59e0b' : 'var(--border)',
        background: nCall ? 'rgba(239,68,68,0.10)' : live.length ? 'rgba(245,158,11,0.08)' : 'var(--card)',
      }}>
        <div style={{ fontSize: 15 * big, fontWeight: 900, color: nCall ? '#ef4444' : live.length ? '#f59e0b' : '#22c55e' }}>
          {nCall ? `📞 เรียกช่าง ${nCall} เครื่อง` : live.length ? `🔧 เครื่องหยุดอยู่ ${live.length} เครื่อง` : '✅ ไม่มีเครื่องหยุดอยู่ตอนนี้'}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {MTN_TEAMS.map(t => (
            <button key={t} onClick={() => setTeam(t)} style={chip(team === t)}>
              {TEAM_ICON[t] || '🔧'} {deptNameOf(t)}
            </button>
          ))}
          <button onClick={() => setTeam(null)} style={chip(!team)}>👁 ทุกทีม</button>
          {myTeams.length === 1 && !sp.get('team') && (
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>· ตั้งต้นตามทีมของบัญชีนี้</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12.5 * big, fontWeight: 800 }}>
          <span style={{ color: mo.length ? '#f59e0b' : '#22c55e' }}>🛠️ ใบซ่อมค้าง {mo.length}</span>
          <span style={{ color: pm.filter(p => p.days < 0).length ? '#ef4444' : 'var(--muted)' }}>📅 PM เกินกำหนด {pm.filter(p => p.days < 0).length}</span>
        </div>
      </div>

      {/* ⚠️ กรองทีมแล้วต้องบอกว่าซ่อนอะไรไป — การจับคู่เครื่อง↔ทีมเป็นการเดาจากชนิดอุปกรณ์ */}
      {team && (hiddenByTeam > 0 || moHidden > 0) && (
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          👁 ซ่อนของทีมอื่น: เครื่องหยุด {hiddenByTeam} · ใบซ่อม {moHidden} — กด “ทุกทีม” เพื่อดูครบ
          (เครื่องที่ยังไม่รู้ว่าทีมไหนดูแล จะแสดงให้ทุกทีมเห็นเสมอ)
        </div>
      )}

      {/* โหลด downtime ไม่สำเร็จ = ต้องบอก ห้ามขึ้นจอเขียว "ไม่มีเครื่องหยุด" ทั้งที่แค่ดึงไม่ได้ */}
      {dtErr && (
        <div style={{ ...card, borderColor: '#ef4444', color: '#ef4444', fontSize: 13 }}>
          ⚠ ดึงสถานะเครื่องหยุดไม่สำเร็จ — ตัวเลขด้านล่างยังไม่ใช่ของจริง ({dtErr})
        </div>
      )}
      {d.loadErr && (
        <div style={{ ...card, borderColor: '#f59e0b', color: '#f59e0b', fontSize: 13 }}>
          ⚠ ข้อมูล downtime ย้อนหลังโหลดไม่ครบ — ตัวเลขสรุปอาจต่ำกว่าจริง
        </div>
      )}

      {/* ผังคือพระเอกของจอนี้ (user 2026-08-26 "เน้นแผนผังดีมั้ย") — แต่ **ห้ามแลกกับลิสต์ข้อความ**
          ผังตอบ "อยู่ตรงไหน" · ลิสต์ตอบ "อะไร/นานแค่ไหน" ช่างต้องได้ทั้งคู่จากที่นั่งเดียว
          → ผังกินพื้นที่มากขึ้น (1.7fr) + สูงขึ้น · ลิสต์ยังกว้างพอไม่ตัดบรรทัด (≥300px) */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,2.8fr) minmax(300px,1fr)', gap: 12, alignItems: 'start' }}>
        {/* ══ 🗺️ ผังโรงงาน — ไลน์ที่แจ้งกระพริบตรงตำแหน่งจริง · กดกรอบ = เจาะดูปัญหาของไลน์นั้น ══ */}
        <div ref={leftRef} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <FactoryMiniMap stateOf={stateOf} onPick={setZoom} bottomReserve={legH + 14} />
          {/* คำอธิบายทั้งหมดยุบเหลือ "บรรทัดเดียว" — ทุกบรรทัดใต้ผังคือความสูงที่ผังเสียไป
              ⚠️ ห้ามตัดข้อความทิ้ง: legend บอกว่าสีไหนแปลว่าอะไร · ประโยคท้ายกันคนเข้าใจว่า
              เป็นสถานะเครื่องเรียลไทม์ (ยังไม่มี SCADA/มิเตอร์รายเครื่อง — กฎ CLAUDE.md) */}
          <div ref={legRef} style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 11px', fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
            <span>👆 กดกรอบไลน์ = ดูปัญหาของไลน์นั้น</span>
            <span><b style={{ color: '#ef4444' }}>■</b> เรียกช่าง (กระพริบ)</span>
            <span><b style={{ color: '#f59e0b' }}>■</b> หยุดเกินเกณฑ์</span>
            <span><b style={{ color: '#facc15' }}>■</b> เพิ่งหยุด</span>
            <span><b style={{ color: '#22c55e' }}>■</b> เปิดกะอยู่</span>
            <span><b style={{ color: '#6b7280' }}>■</b> ไม่ได้เปิดกะ</span>
            <span>· สีมาจาก <b>กะที่เปิด + downtime ที่คนลงไว้</b> ยังไม่มีสัญญาณรายเครื่อง (ต้องต่อ SCADA/มิเตอร์ก่อน)</span>
          </div>
        </div>

        {/* ══ ① เครื่องหยุด ② ใบซ่อม ③ PM ══
            ⚠️ จอ TV ไม่มีใครเลื่อนหน้าจอ — เดิมคอลัมน์นี้ยาวกว่าจอจนการ์ด PM หลุดใต้ fold
            สูงเท่า "ผังที่วัดได้จริง" แล้วเลื่อนในกรอบแทน (ห้ามเดา 100vh − Npx · กฎ §6.8)
            ยอดรวม (ใบซ่อมค้าง / PM เกินกำหนด) อยู่บนแถบสรุปด้านบนซึ่งเห็นเสมอ → ไม่มีอะไรหายเงียบ */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 10,
          maxHeight: leftH || undefined, overflowY: leftH ? 'auto' : undefined,
          paddingRight: leftH ? 4 : undefined,
        }}>
          <div style={{ fontSize: 13 * big, fontWeight: 900 }}>🚨 เครื่องที่หยุดอยู่ตอนนี้</div>

          {!live.length && (
            <div style={{ ...card, textAlign: 'center', padding: 24, fontSize: 13 * big, fontWeight: 800, color: '#22c55e' }}>
              ✅ ไม่มีเครื่องหยุดอยู่ตอนนี้
            </div>
          )}

          {/* ⚠️ เรียงข้อมูลตามที่ช่างต้องรู้: **ไลน์ (ไปที่ไหน) + หยุดมานานแค่ไหน** มาก่อน
              แล้วค่อยเครื่อง/ประเภท/หมายเหตุ · คำอธิบายยาวไปท้ายสุดเป็นตัวเล็ก
              (เดิมเอา "⚠ ไม่ระบุเครื่อง" เป็นหัวเรื่องตัวใหญ่ + คำอธิบาย 2 บรรทัด แล้วเวลาถูกดันไปขวา
               พอคอลัมน์แคบบนจอ ultrawide ข้อความตัดบรรทัดจนอ่านไม่ออก · user ทัก 2026-08-26) */}
          {live.map(r => (
            <div key={r.id} className={r._s.blink ? 'dt-alarm-blink' : undefined}
              onClick={() => navigate('/mtn-repair')}
              style={{
                ...card, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3,
                borderColor: r._s.color, borderLeft: `7px solid ${r._s.color}`,
                background: r._s.k === 'call' ? 'rgba(239,68,68,0.12)' : 'var(--card)',
              }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontSize: 14 * big, fontWeight: 900, color: 'var(--text)', lineHeight: 1.15, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.production_sessions?.line_name || 'ไม่ระบุไลน์'}
                </span>
                <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 16 * big, fontWeight: 900, color: r._s.color, lineHeight: 1, whiteSpace: 'nowrap' }}>
                  {fmtMin(r._min)}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11 * big }}>
                <span style={{ fontWeight: 800, color: r.machine_no ? 'var(--text2)' : 'var(--accent2)' }}>
                  {r.machine_no || '⚠ ไม่ระบุเครื่อง'}
                </span>
                <span style={{ color: 'var(--muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.dr_downtime_types?.name_th || 'ไม่ระบุประเภท'}
                </span>
                <span style={{ marginLeft: 'auto', flexShrink: 0, fontWeight: 800, color: r._s.color }}>{r._s.label}</span>
              </div>
              {r.description && <div style={{ fontSize: 10.5 * big, color: 'var(--muted)' }}>💬 {r.description}</div>}
              {r._min == null && <div style={{ fontSize: 10 * big, color: 'var(--muted)' }}>⏱ ไม่ได้ระบุเวลาเริ่ม — บอกไม่ได้ว่าหยุดมานานแค่ไหน</div>}
              {/* ⚠️ ไม่มี machine_no = จับคู่ทีมไม่ได้ → ขึ้นให้ทุกทีมเห็น และต่อประวัติเครื่อง/ใบซ่อมไม่ได้ */}
              {!r.machine_no && (
                <div style={{ fontSize: 10 * big, color: 'var(--accent2)', lineHeight: 1.4 }}>
                  ผู้แจ้งไม่ได้เลือกเครื่องตอนลง Downtime — จัดคิวให้ทีมไม่ได้ (จึงแสดงให้ทุกทีม)
                </div>
              )}
            </div>
          ))}

          {/* ⚠️ หยุดตามแผนไม่ใช่ alarm — แต่ห้ามซ่อน (ช่างต้องรู้ว่าเครื่องไหนหยุดอยู่ด้วยเหตุอะไร) */}
          {planned.length > 0 && (
            <div style={{ ...card, background: 'var(--bg3)' }}>
              <div style={{ fontSize: 11 * big, fontWeight: 800, color: 'var(--muted)', marginBottom: 6 }}>
                🗓️ หยุดตามแผน {planned.length} รายการ (ไม่นับเป็น Andon)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {planned.map(r => (
                  <span key={r.id} style={{ fontSize: 10.5 * big, color: 'var(--text2)', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 7, padding: '3px 8px' }}>
                    {r.machine_no || r.production_sessions?.line_name} · {r.dr_downtime_types?.name_th || ''} · {fmtMin(r._min)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div style={card}>
            <div style={{ fontSize: 12.5 * big, fontWeight: 900, marginBottom: 8 }}>🛠️ ใบซ่อมค้าง ({mo.length})</div>
            {!mo.length && <div style={{ fontSize: 11.5 * big, color: '#22c55e', fontWeight: 700 }}>✅ ไม่มีใบค้าง</div>}
            {mo.length > 0 && (<>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 9 }}>
                {OPEN_MO_STATUSES.filter(k => moByStep[k]).map(k => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 * big }}>
                    <span style={{ color: 'var(--text2)' }}>{MO_STATUS_LABEL[k] || k}</span>
                    <b style={{ color: 'var(--text)' }}>{moByStep[k]}</b>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10 * big, fontWeight: 800, color: 'var(--muted)', marginBottom: 4 }}>ค้างนานสุด</div>
              {mo.slice(0, 4).map(o => {
                const age = daysSince(o.report_at);
                return (
                  <div key={o.id} onClick={() => navigate('/mtn-repair')}
                    style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', borderTop: '1px solid var(--border)', fontSize: 10.5 * big }}>
                    <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.machine_no || o.line_name || o.mo_no || '-'}
                    </span>
                    <b style={{ flexShrink: 0, color: age >= 3 ? '#ef4444' : 'var(--muted)' }}>{age != null ? `${age} วัน` : '-'}</b>
                  </div>
                );
              })}
            </>)}
          </div>

          <div style={card}>
            <div style={{ fontSize: 12.5 * big, fontWeight: 900, marginBottom: 8 }}>📅 PM ที่ต้องทำ</div>
            {!pm.length && <div style={{ fontSize: 11.5 * big, color: 'var(--muted)' }}>ไม่มีแผนที่ครบกำหนดใน 3 วัน</div>}
            {pm.slice(0, 6).map(p => (
              <div key={p.id} onClick={() => navigate('/pm?tab=plan')}
                style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', borderTop: '1px solid var(--border)', fontSize: 10.5 * big }}>
                <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                <b style={{ flexShrink: 0, color: p.days < 0 ? '#ef4444' : p.days === 0 ? '#f59e0b' : 'var(--muted)' }}>
                  {p.days < 0 ? `เกิน ${Math.abs(p.days)} วัน` : p.days === 0 ? 'วันนี้' : `อีก ${p.days} วัน`}
                </b>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ══ 🔎 กดกรอบบนผัง → เจาะดูปัญหาของไลน์นั้น (2026-08-26 · user "กดเข้าไปดูในกรอบที่มีปัญหา") ══
          ⚠️ ใช้ข้อมูลที่โหลดมาแล้วทั้งหมด **ไม่ยิง DB เพิ่ม** — จอนี้เปิดค้างทั้งวัน (กฎ egress)
          ⚠️ ไลน์ที่ไม่มีปัญหาก็กดได้ ต้องตอบว่า "ปกติ" ไม่ใช่จอว่าง */}
      {zoom && (() => {
        const z = String(zoom).trim().toUpperCase();
        const eqOf = (v) => String(v || '').trim().toUpperCase() === z;
        const zDt = rows.filter(r => eqOf(r.production_sessions?.line_name));
        const zNos = new Set(zDt.map(r => normNo(r.machine_no)).filter(Boolean));
        const zMo = mo.filter(o => eqOf(o.line_name) || zNos.has(normNo(o.machine_no)));
        const zPm = pm.filter(p => eqOf(p.line));
        const zLive = zDt.filter(r => r._s.k !== 'planned');
        return (
          <div onClick={() => setZoom(null)} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, width: '100%', maxWidth: 720, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px 12px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 19, fontWeight: 900, color: 'var(--text)' }}>🔎 {zoom}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                    {zLive.length ? `🔴 เครื่องหยุดอยู่ ${zLive.length} รายการ` : '✅ ไม่มีเครื่องหยุดอยู่ตอนนี้'}
                    {' · '}🛠️ ใบซ่อมค้าง {zMo.length}{' · '}📅 PM ถึงกำหนด {zPm.length}
                  </div>
                </div>
                <button onClick={() => setZoom(null)} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', color: 'var(--text2)', fontSize: 15 }}>✕</button>
              </div>

              <div style={{ overflowY: 'auto', padding: '14px 18px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', marginBottom: 5 }}>🚨 เครื่องที่หยุดอยู่</div>
                  {!zDt.length ? <div style={{ fontSize: 12.5, color: '#22c55e', fontWeight: 700 }}>✅ ไม่มีรายการหยุดค้างของไลน์นี้</div> : (
                    <div style={{ display: 'grid', gap: 6 }}>
                      {zDt.map(r => (
                        <div key={r.id} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderLeft: `4px solid ${r._s.color}`, borderRadius: 8, padding: '7px 10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <b style={{ fontSize: 13, color: r.machine_no ? 'var(--text)' : 'var(--accent2)' }}>{r.machine_no || '⚠ ไม่ระบุเครื่อง'}</b>
                            <span style={{ fontSize: 12, color: 'var(--text2)' }}>{r.dr_downtime_types?.name_th || 'ไม่ระบุประเภท'}</span>
                            <span style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 900, color: r._s.color }}>{fmtMin(r._min)}</span>
                          </div>
                          <div style={{ fontSize: 11.5, color: r._s.color, fontWeight: 700, marginTop: 2 }}>{r._s.label}</div>
                          {r.description && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>💬 {r.description}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', marginBottom: 5 }}>🛠️ ใบซ่อมที่ยังไม่ปิด</div>
                  {!zMo.length ? <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>ไม่มีใบค้างของไลน์นี้</div> : (
                    <div style={{ display: 'grid', gap: 4 }}>
                      {zMo.slice(0, 8).map(o => (
                        <div key={o.id} onClick={() => navigate('/mtn-repair')} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                          <b style={{ color: 'var(--text)', flexShrink: 0 }}>{o.mo_no || '⏳ รอออกเลข'}</b>
                          <span style={{ color: 'var(--muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {o.machine_no || 'ไม่ระบุเครื่อง'}{o.problem_characteristic ? ` · ${o.problem_characteristic}` : ''}
                          </span>
                          <span style={{ marginLeft: 'auto', flexShrink: 0, color: '#f59e0b', fontWeight: 700 }}>{MO_STATUS_LABEL[o.status] || o.status}</span>
                        </div>
                      ))}
                      {zMo.length > 8 && <div style={{ fontSize: 11, color: 'var(--muted)' }}>+ อีก {zMo.length - 8} ใบ</div>}
                    </div>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', marginBottom: 5 }}>📅 PM ที่ถึงกำหนด (ภายใน 3 วัน)</div>
                  {!zPm.length ? <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>ไม่มีแผนที่ถึงกำหนดของไลน์นี้</div> : (
                    <div style={{ display: 'grid', gap: 4 }}>
                      {zPm.map(p => (
                        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                          <span style={{ color: 'var(--text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                          <b style={{ marginLeft: 'auto', flexShrink: 0, color: p.days < 0 ? '#ef4444' : p.days === 0 ? '#f59e0b' : 'var(--muted)' }}>
                            {p.days < 0 ? `เกิน ${Math.abs(p.days)} วัน` : p.days === 0 ? 'วันนี้' : `อีก ${p.days} วัน`}
                          </b>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  <button onClick={() => navigate('/mtn-repair')} style={chip(true)}>🔧 ใบแจ้งซ่อม</button>
                  <button onClick={() => navigate('/pm-schedule')} style={chip(false)}>🗓️ แผน PM</button>
                  <button onClick={() => navigate(`/factory-map`)} style={chip(false)}>🗺️ ผังรวมโรงงาน</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}

const chip = (on) => ({
  fontSize: 12.5, fontWeight: 800, padding: '5px 12px', borderRadius: 999, cursor: 'pointer',
  background: on ? 'var(--accent)' : 'var(--bg3)', color: on ? '#08120a' : 'var(--text)',
  border: `1px solid ${on ? 'var(--accent)' : 'var(--border2)'}`,
});
