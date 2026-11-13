/* ══════════════════════════════════════════════════════════════════════════
   📺 จอ TV (`/tv`) — หน้าสำหรับ "แขวนไว้อย่างเดียว" บนสมาร์ททีวี

   ที่มา (user 2026-08-28):
   *"เป็นหน้าสำหรับเปิดจอทีวีเลยดีมั้ย มีหน้าที่ display อย่างเดียว ให้ระบบเบาที่สุด
     เวลารันบน browser smart tv โดยแยกแผนกได้เลย — ช่างก็ดูสถานะเครื่องจากโรงงาน
     ผลิตก็ดูสถานะเครื่อง+ยอดผลิตจากผัง สโตร์ก็ดูสถานะว่ามีงานต้องไปส่งให้ไลน์ผลิตไหนที่รอของอยู่
     อาจจะมีดรอปดาวน์และฟิลเตอร์กรองแยกสิ่งที่อยากเห็น"*

   ⚠️⚠️ **นี่คือ "เปลือก" ไม่ใช่บอร์ดใบใหม่** — เนื้อในคือ `<MtnAndonBoard>` ตัวเดียวกับ
        ที่เคยเป็นแท็บ 🚨 จอห้องช่าง ใน `/dept-dashboard` เป๊ะๆ ต่างกันแค่ `cards` (คอลัมน์ขวา)
        กฎที่วางไว้ตั้งแต่ 2026-08-27: *"ถ้าจะแยกจอ ให้ทำเป็น `?cards=` บนบอร์ดเดิม
        **ห้ามสร้างบอร์ดที่ 2**"* — ก๊อปบอร์ดไปทำอีกใบ = drift แน่นอน
        (บทเรียนบอร์ด Heijunka ของ Dashboard vs Management ที่ก๊อปกันแล้วต่างกันไปเรื่อยๆ)

   **"เบาที่สุด" ทำได้จริงตรงไหน** (เทียบกับเปิด `/dept-dashboard?view=andon` ทิ้งไว้):
     • ไม่มี sidebar / rail / กระดิ่ง / PageHeader / breadcrumb  → DOM น้อยลงมาก
     • ไม่โหลด `KpiMonthly` · ไม่โหลด View ของ 4 ส่วนงาน (ProductionView/StoreView/QaView)
     • **loader เบากว่า `loadMaintenance` มาก** — บอร์ดใช้แค่ `mo/plans/cls/jigs`
       ส่วน `sess30`+`dt30` (30 วัน ≈ 270 กะ + downtime ทั้งเดือน) เป็นของ `MaintenanceView`
       ซึ่งจอนี้ไม่ได้ใช้เลย → ตัดทิ้ง = ยิง DB น้อยลง 2 คิวรีก้อนใหญ่ต่อรอบโหลด
     • `data-perf="lite"` (App.jsx ตั้งให้ role `display` อยู่แล้ว) ปิด animation/shadow

   ⚠️ **อ่านอย่างเดียว** — ทุกอย่างที่กดได้คือลิงก์ไปหน้าที่ทำงานจริง
   ⚠️ ตัวเลือกทั้งหมดอยู่ใน **URL** (`?dept=` `?team=` `?sound=` `?sec=`) เพื่อให้แต่ละห้อง
      บุ๊กมาร์กของตัวเองแล้วเปิดค้างได้ **โดยไม่ต้องมีคนมากดทุกเช้า** (หลักเดียวกับ `?team=`/`?sound=` เดิม)
   ══════════════════════════════════════════════════════════════════════════ */
import { sortLike } from '../utils/listOrder';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { loadProductionLines } from '../utils/useProductionLines';
import { UserContext } from '../App';
import MtnAndonBoard from '../components/MtnAndonBoard';
import MoTvBoard from '../components/MoTvBoard';
import { MO_TV_GROUPS } from '../utils/moTvBoard';
import useIsMobile from '../utils/useIsMobile';
import { lineScope, inSectionScope } from '../utils/sectionScope';
import { visibleInterval } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';
import { useLiveBoard } from '../utils/useLiveBoard';
import { OPEN_MO_STATUSES } from '../utils/dieStatus';
// วันงาน — ของกลาง (ตัด 08:00 · 12/10 เลิกก๊อปฟังก์ชันไว้ในไฟล์ตามกฎ CLAUDE.md)
import { useWorkDate } from '../utils/useWorkDate';   // 📅 จอแขวนเปิดค้างข้ามวัน — ต้องอัปเดตวันงานเอง (12/11)
import SectionScopeSelect from '../components/SectionScopeSelect';
import { tr } from '../utils/i18n';
import TabBar from '../components/TabBar';   // แถบเลือกมุมมอง = แท็บเส้นใต้มาตรฐาน (UI §6.36 ข้อ 0)


const DEPTS = [
  { key: 'maintenance', icon: '🔧', label: 'ช่างซ่อมบำรุง', sub: 'เครื่องหยุด · PM · ใบซ่อม' },
  { key: 'production', icon: '🏭', label: 'ฝ่ายผลิต', sub: 'เครื่องหยุด · ยอดผลิตเทียบเป้า' },
  { key: 'store', icon: '📦', label: 'สโตร์', sub: 'ไลน์เรียกของ · รอบส่งค้าง · พาร์ทจะขาด' },
  /* 🧾 ใบแจ้งซ่อม MO ตามขั้น (03/11 · ประชุม 02/11 ข้อ B6 "จอ TV ทีม MTN วนหน้า MO") — `?mo=<กอง>` `?team=`
     เนื้อใน = `<MoTvBoard>` (โหลดเอง + realtime เอง) · ตั้งรอบวนหลายกองที่ /display-rotation */
  { key: 'mo', icon: '🧾', label: 'ใบแจ้งซ่อม MO', sub: 'ใบค้างตามขั้น · รอรับงาน · กำลังซ่อม · รอตรวจรับ' },
];

export default function TvBoard({ onOpenMenu = null }) {
  const { role, lineId, sections, scopeIdx } = useContext(UserContext);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [sp, setSp] = useSearchParams();

  const dept = DEPTS.find(x => x.key === sp.get('dept'))?.key || 'maintenance';
  const setParam = (k, v) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v); else n.delete(k);
    setSp(n, { replace: true });
  };
  /* กรองส่วนงานที่จอนี้อยากเห็น (นอกเหนือจาก scope ของบัญชี) — จอในห้อง PD3 ไม่ต้องเห็นไลน์ PD1
     ⚠️ เป็นตัวกรอง "เพิ่มเติม" ห้ามใช้ปลด scope: กรองซ้อนบน scope เดิมเสมอ */
  const secFilter = sp.get('sec') || '';

  const [lines, setLines] = useState([]);
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  /* ทะเบียนไลน์: 'loading' | 'ok' | 'empty' | ข้อความ error — 05/10 (QC audit): เดิม `.catch(() => setLines([]))`
     ⇒ โหลดล้ม = lines ว่างตลอดกาล ⇒ loader ไม่ยิง ⇒ จอ TV ค้าง "กำลังโหลด..." ทั้งวันโดยไม่มีใครรู้
     ตอนนี้: ล้ม = เขียนบนจอ + ลองใหม่เองทุก 30 วิ (จอไม่มีคนเฝ้า) + ปุ่มลองใหม่ */
  const [linesState, setLinesState] = useState('loading');
  const [linesTry, setLinesTry] = useState(0);
  const [fs, setFs] = useState(false);
  const [barOpen, setBarOpen] = useState(false);   // แถบตั้งค่า — พับไว้ จอ TV ต้องเป็นเนื้อหาล้วน
  /* 🔴 ห้ามใช้ `getWorkDate()` ตรงๆ ที่นี่ — จอแขวนเปิดค้างไม่มีอะไรสั่ง re-render
     ⇒ พอข้าม 08:00 จะยังถามวันงานเมื่อวาน = "ไม่มีไลน์เปิด" เทาทั้งจอ (บั๊กหน้างาน 12/11) */
  const workDate = useWorkDate();

  useEffect(() => {
    /* ทะเบียนไลน์เป็น master → cache กลาง (จอเปิดค้างทั้งวัน ห้าม poll ซ้ำ · กฎ egress)
       25/09: เดิมตั้งคีย์ของตัวเอง (`production_lines:scope`) = แยก cache กับหน้าอื่นที่อ่านไลน์เหมือนกัน
       ⇒ ย้ายมาใช้ `loadProductionLines()` คีย์เดียวทั้งแอป (ดู src/utils/useProductionLines.js) */
    let alive = true, t = null;
    loadProductionLines()
      .then(d => { if (!alive) return; setLines(d || []); setLinesState((d || []).length ? 'ok' : 'empty'); })
      .catch(e => {
        if (!alive) return;
        console.error('[TvBoard] โหลดทะเบียนไลน์ไม่สำเร็จ:', e);
        setLinesState(e?.message || String(e) || 'โหลดทะเบียนไลน์ไม่สำเร็จ');
        t = setTimeout(() => setLinesTry(n => n + 1), 30000);
      });
    return () => { alive = false; if (t) clearTimeout(t); };
  }, [linesTry]);

  useEffect(() => {
    const on = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  /* ── ขอบเขต: scope ของบัญชี (helper กลาง) แล้วค่อยกรองส่วนงานที่จอนี้เลือกทับ ──
     🔭 09/11 (user: "จอ TV ต้องโชว์เฉพาะส่วนงาน/ไลน์ของบัญชี" แบบ FactoryMap) — เดิมเรียก
     `scopedLineNames()` **ไม่ส่ง `scopeIdx`** ⇒ ขอบเขตระดับแผนก/กลุ่ม/ไลน์เดี่ยว (ผังองค์กร) ตกหมด
     แล้วถอยไปเทียบชื่อ `l.section` ตรงตัว · ตอนนี้ใช้ `lineScope()` ตัวเดียวกับ FactoryMap
     · `unsure` (ตัดขอบเขตไม่ได้) = แสดงตามเดิม **แต่หัวจอเขียนบอก** ห้ามเงียบ */
  const acctScope = useMemo(() => lineScope({ role, lineId, sections: sections || [], lines, scopeIdx }),
    [role, lineId, sections, lines, scopeIdx]);
  // ไลน์ที่จอนี้ใช้จริงตามบัญชี — ชุดว่าง (ตัดไม่ได้) = ทั้งโรงงาน เหมือน scopeSet ข้างล่าง
  const acctLines = acctScope.unlimited || !acctScope.lines.length ? lines : acctScope.lines;
  const scopeSet = useMemo(() => {
    const base = acctScope.unlimited ? null : (acctScope.names.length ? acctScope.names : null);
    if (!secFilter) return base ? new Set(base) : null;
    const inSec = lines.filter(l => inSectionScope([secFilter], l.section)).map(l => l.name);
    // ⚠️ ยังไม่โหลดไลน์เสร็จ = อย่าเพิ่งกรอง (คืนทั้งหมด) ไม่งั้นจอว่างตอนเปิดมาแป๊บนึง
    if (!lines.length) return base ? new Set(base) : null;
    return new Set(base ? inSec.filter(n => base.includes(n)) : inSec);
  }, [acctScope, lines, secFilter]);
  const inScope = useCallback((name) => !scopeSet || !name || scopeSet.has(name), [scopeSet]);

  const ctx = useMemo(() => ({
    workDate, lines, inScope, navigate, isMobile, role,
    scopeNames: scopeSet ? [...scopeSet] : null,
  }), [workDate, lines, inScope, navigate, isMobile, role, scopeSet]);

  /* ── loader ของจอนี้ — **เอาเฉพาะที่บอร์ดใช้จริง** ──
     `MtnAndonBoard` ใช้ d.mo / d.plans / d.cls / d.jigs เท่านั้น
     (downtime สด + กะที่เปิด บอร์ดโหลดเองพร้อม realtime อยู่แล้ว — ห้ามโหลดซ้ำที่นี่)
     ⚠️ กรองสถานะใบซ่อมฝั่ง server (`OPEN_MO_STATUSES`) แทนดึง 500 ใบล่าสุดมากรองในเบราว์เซอร์ */
  const load = useCallback(async () => {
    if (!lines.length || dept === 'mo') return;   // มุมมอง MO โหลดเองใน <MoTvBoard>
    try {
      const needPm = dept === 'maintenance';
      const needMo = dept !== 'store';
      const [moRes, planRes, clsRes] = await Promise.all([
        needMo
          ? supabaseDR.from('mtn_orders')
              .select('id, mo_no, machine_no, line_name, status, mtn_dept, report_at, problem_characteristic, quality_related, qa_skipped_at')
              .in('status', OPEN_MO_STATUSES).order('report_at', { ascending: false }).limit(300)
          : Promise.resolve({ data: [] }),
        needPm
          ? supabaseDR.from('pm_plans').select('id, checklist_id, plan_type, next_due_date, interval_days, last_done_at, cycle_basis, deferred_to, deferred_at').eq('is_active', true)
          : Promise.resolve({ data: [] }),
        needPm
          ? supabaseDR.from('checklists').select('id, equipment_id, department').eq('module', 'mtn')
          : Promise.resolve({ data: [] }),
      ]);
      if (moRes.error) throw moRes.error;
      if (planRes.error) throw planRes.error;
      const cls = clsRes.data || [];
      const eqIds = [...new Set(cls.map(c => c.equipment_id).filter(Boolean))];
      const { data: jigs, error: jErr } = eqIds.length
        ? await supabaseDR.from('jigs').select('id, name, jig_no, machine_no, line_name').in('id', eqIds)
        : { data: [] };
      if (jErr) throw jErr;   // ไม่รู้ชื่ออุปกรณ์ = แผน PM ขึ้นไม่ครบ ห้ามเงียบ
      setD({ mo: moRes.data || [], plans: planRes.data || [], cls, jigs: jigs || [], loadErr: false });
      setErr(null);
    } catch (e) { setErr(e?.message || 'โหลดข้อมูลไม่สำเร็จ'); }
  }, [lines.length, dept]);

  /* 🔴 2026-09-15 — เดิม **poll ล้วน ไม่มี realtime เลย** (ยิงเต็มทุก 20 นาที 24 ชม.
     ไม่ว่ามีอะไรเปลี่ยนหรือไม่) · ตารางเพิ่งถูกใส่ publication ในรอบนี้ realtime จึงเพิ่งใช้ได้จริง
     useLiveBoard = realtime หลัก + เพดาน coalesce + poll ข้ามรอบเมื่อไม่มี event
     ดู src/utils/useLiveBoard.js · docs/POLLING-AUDIT-2026-09-15.md */
  useLiveBoard(load, { tables: ['mtn_orders', 'inspections'], topic: 'tv-board', rate: RATE.ANALYTIC, enabled: dept !== 'mo' });

  /* ตัวเลือกส่วนงาน = เฉพาะส่วนงานที่มีไลน์อยู่ในขอบเขตบัญชี (จำกัดอยู่) · ไม่จำกัด = ทุกส่วนงานเหมือนเดิม */
  const secOpts = useMemo(() => {
    return sortLike(acctLines.map(l => l.section), []);
  }, [acctLines]);
  const scopeHiddenLines = lines.length - acctLines.length;
  const cur = DEPTS.find(x => x.key === dept);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: 'clamp(8px, 1vw, 14px)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* ── แถบบนสุด: บางที่สุดเท่าที่ยังบอกได้ว่า "จอนี้ของแผนกไหน" ──
          ทุกพิกเซลแนวตั้งที่แถบนี้กิน = พื้นที่ที่ผังเสียไป (บทเรียน 2026-08-26 "ยังสเกลแย่อยู่เลย")
          → ตัวเลือกทั้งหมดพับหลังปุ่ม ⚙️ · เปิดมาเจอเนื้อหาเลย
          ph-chrome = กรอบจอ TV ซ่อน (แถบบนของกรอบบอกชื่อ/มุมมอง/วันงานแทน · index.css) */}
      <div className="ph-chrome" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16, fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
          {cur.icon} Andon Board · {tr(cur.label)}
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          {cur.sub} {tr('· วันงาน')} {workDate}
          {secFilter ? ` · เฉพาะ ${secFilter}` : ''}
          {scopeSet ? ` · ${scopeSet.size} ไลน์` : ' · ทุกไลน์'}
          {/* กรองตามขอบเขตบัญชีแล้วต้องบอกว่าซ่อนกี่ไลน์ · ตัดขอบเขตไม่ได้ต้องบอกว่ากำลังโชว์ทั้งโรงงาน */}
          {scopeHiddenLines > 0 && ` · ไม่แสดงไลน์นอกขอบเขตบัญชี ${scopeHiddenLines} ไลน์`}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {/* ☰ เมนู (13/10 · feedback user) — เดิมเข้ามาแล้วไปหน้าอื่นไม่ได้ · ไม่ส่ง onOpenMenu (บัญชีจอแขวน) = ไม่วาด */}
          {onOpenMenu && <button onClick={onOpenMenu} style={btn(false)} title={tr('เปิดเมนู — ไปหน้าอื่น (จอยังโล่งเหมือนเดิมจนกว่าจะกด)')}>{tr('เมนู')}</button>}
          <button onClick={toggleFs} style={btn(fs)} title={tr('เต็มจอ — เก็บแถบเบราว์เซอร์คืนพื้นที่ให้ผัง')}>⛶</button>
          <button onClick={() => setBarOpen(o => !o)} style={btn(barOpen)}>{tr('ตั้งค่าจอ')}</button>
        </div>
      </div>

      {barOpen && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '9px 12px' }}>
          <TabBar size="sm" value={dept} onChange={k => setParam('dept', k)} tabs={DEPTS.map(x => ({ key: x.key, label: x.label }))} />
          <span style={{ width: 1, height: 20, background: 'var(--border2)' }} />
          {/* ส่วนงาน — ค่าที่ไม่มีในลิสต์ (ส่วนงานถูกเปลี่ยนชื่อ) ต้องยังเลือกเห็นได้ ห้ามหายเงียบ */}
          <SectionScopeSelect lines={lines} value={secFilter} onChange={s => setParam('sec', s)} only={secOpts} width={220}
            title={tr('ทุกส่วนงานที่บัญชีนี้มีสิทธิ์เห็น')} />
          {dept === 'mo' && <>
            <span style={{ width: 1, height: 20, background: 'var(--border2)' }} />
            {[{ key: '', icon: '🧾', label: 'ทุกขั้น' }, ...MO_TV_GROUPS].map(x => (
              <button key={x.key || 'all'} onClick={() => setParam('mo', x.key)} style={btn((sp.get('mo') || '') === x.key)}>{x.icon} {tr(x.label)}</button>
            ))}
          </>}
          <span style={{ width: 1, height: 20, background: 'var(--border2)' }} />
          {/* 🔊 ขอบเขตเสียง — ตัว <DowntimeSiren> ในบอร์ดอ่าน `?sound=` ตัวเดียวกัน */}
          {/* จอสโตร์เงียบเป็นค่าเริ่มต้น (เสียงเรียกช่างไม่ใช่งานสโตร์ · 12/10) — เปิดได้ด้วย `?sound=all` */}
          <button onClick={() => setParam('sound', sp.get('sound') === 'all' ? '' : 'all')} style={btn(sp.get('sound') === 'all')}>
            {sp.get('sound') === 'all' ? tr('ดังทุกเครื่องหยุด') : dept === 'store' ? tr('ไม่มีเสียง') : tr('ดังเฉพาะเรียกช่าง')}
          </button>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            ตั้งเสร็จแล้ว <b>{tr('บุ๊กมาร์กหน้านี้ไว้ที่ทีวี')}</b> — ค่าอยู่ใน URL จอจะจำเอง ไม่ต้องมากดทุกเช้า
          </span>
        </div>
      )}

      {/* 🔭 ตัดขอบเขตบัญชีไม่ได้ = ต้องเขียนบนจอ (นอก ph-chrome — กรอบจอ TV ซ่อนแถบบน) */}
      {acctScope.unsure && lines.length > 0 && (
        <div role="status" style={{ background: 'var(--card)', border: '1px solid var(--amber)', color: 'var(--amber)', borderRadius: 'var(--r-md)', padding: '8px 12px', fontSize: 13, fontWeight: 700 }}>
          {/* ชุดว่าง = scopeSet เป็น null = ทั้งโรงงาน (พฤติกรรมเดิมของ scopedLineNames) — เขียนตามจริง */}
          {acctLines !== lines
            ? '⚠ หาไลน์ของบัญชีนี้ไม่เจอ — แสดงตามส่วนงานของบัญชีแทน'
            : '⚠ ตัดขอบเขตบัญชีไม่ได้ — กำลังแสดงทั้งโรงงาน'}
        </div>
      )}
      {err && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--red)', color: 'var(--red)', borderRadius: 'var(--r-md)', padding: 12, fontSize: 13 }}>
          ⚠ โหลดข้อมูลไม่สำเร็จ — ตัวเลขบนจอยังไม่ใช่ของจริง ({err})
        </div>
      )}
      {linesState !== 'loading' && linesState !== 'ok' && (
        <div role="alert" style={{ background: 'var(--card)', border: '1px solid var(--red)', color: 'var(--red)', borderRadius: 'var(--r-md)', padding: 12, fontSize: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>⚠ {linesState === 'empty'
            ? 'ไม่พบทะเบียนไลน์ผลิต — จอนี้แสดงอะไรไม่ได้ (ตั้งไลน์ที่หน้า ตั้งค่าไลน์ผลิต)'
            : `โหลดทะเบียนไลน์ไม่สำเร็จ — กำลังลองใหม่อัตโนมัติทุก 30 วินาที (${linesState})`}</span>
          <button onClick={() => { setLinesState('loading'); setLinesTry(n => n + 1); }}
            style={{ fontSize: 13, padding: '4px 12px', borderRadius: 'var(--r-md)', border: '1px solid var(--red)', background: 'transparent', color: 'var(--red)', cursor: 'pointer' }}>{tr('ลองใหม่')}</button>
        </div>
      )}
      {dept !== 'mo' && !d && !err && (linesState === 'loading' || linesState === 'ok') && (
        <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14, padding: 40 }}>{tr('กำลังโหลด...')}</div>
      )}
      {dept === 'mo'
        ? (linesState === 'ok' && <MoTvBoard inScope={inScope} isMobile={isMobile} />)
        : (d && <MtnAndonBoard d={d} ctx={ctx} cards={dept} />)}
    </div>
  );
}

/* ปุ่มคำสั่งในแถบตั้งค่าจอ = ทรงเดียวกับ .pg-btn (06/11 · เดิมแคปซูล 999) · on = ขอบ+ตัวอักษร accent */
const btn = (on) => ({
  height: 30, fontSize: 12.5, fontWeight: 600, padding: '0 12px', borderRadius: 'var(--r-md)', cursor: 'pointer',
  background: on ? 'var(--accent-dim)' : 'var(--card)', color: on ? 'var(--accent)' : 'var(--text)',
  border: `1px solid ${on ? 'var(--accent)' : 'var(--border2)'}`,
});
