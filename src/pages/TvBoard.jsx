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
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import MtnAndonBoard from '../components/MtnAndonBoard';
import useIsMobile from '../utils/useIsMobile';
import { scopedLineNames, inSectionScope } from '../utils/sectionScope';
import { visibleInterval } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';
import { cachedMaster } from '../utils/masterCache';
import { OPEN_MO_STATUSES } from '../utils/dieStatus';

/* วันงาน — ตัด 08:00 ตามกฎทั้งระบบ (ห้าม toISOString: คืน UTC = เพี้ยน 1 วันช่วง 00:00-07:00 ไทย) */
function getWorkDate() {
  const d = new Date();
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DEPTS = [
  { key: 'maintenance', icon: '🔧', label: 'ช่างซ่อมบำรุง', sub: 'เครื่องหยุด · PM · ใบซ่อม' },
  { key: 'production', icon: '🏭', label: 'ฝ่ายผลิต', sub: 'เครื่องหยุด · ยอดผลิตเทียบเป้า' },
  { key: 'store', icon: '📦', label: 'สโตร์', sub: 'ไลน์ที่รอของ · พาร์ทจะขาด' },
];

export default function TvBoard() {
  const { role, lineId, sections } = useContext(UserContext);
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
  const [fs, setFs] = useState(false);
  const [barOpen, setBarOpen] = useState(false);   // แถบตั้งค่า — พับไว้ จอ TV ต้องเป็นเนื้อหาล้วน
  const workDate = getWorkDate();

  useEffect(() => {
    /* ทะเบียนไลน์เป็น master → cache (จอเปิดค้างทั้งวัน ห้าม poll ซ้ำ · กฎ egress)
       key ตั้งตาม "ชุดคอลัมน์" ไม่ใช่ชื่อหน้า — หน้าอื่นที่ต้องการชุดเดียวกันจะได้ใช้ cache ร่วมได้ */
    cachedMaster('production_lines:scope', async () => {
      const { data, error } = await supabase.from('production_lines').select('id, name, section, parent_line_name');
      if (error) throw error;
      return data || [];
    }).then(setLines).catch(() => setLines([]));
  }, []);

  useEffect(() => {
    const on = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  /* ── ขอบเขต: scope ของบัญชี (helper กลาง) แล้วค่อยกรองส่วนงานที่จอนี้เลือกทับ ── */
  const scopeSet = useMemo(() => {
    const base = scopedLineNames({ role, lineId, sections, lines });
    if (!secFilter) return base ? new Set(base) : null;
    const inSec = lines.filter(l => inSectionScope([secFilter], l.section)).map(l => l.name);
    // ⚠️ ยังไม่โหลดไลน์เสร็จ = อย่าเพิ่งกรอง (คืนทั้งหมด) ไม่งั้นจอว่างตอนเปิดมาแป๊บนึง
    if (!lines.length) return base ? new Set(base) : null;
    return new Set(base ? inSec.filter(n => base.includes(n)) : inSec);
  }, [role, lineId, sections, lines, secFilter]);
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
    if (!lines.length) return;
    try {
      const needPm = dept === 'maintenance';
      const needMo = dept !== 'store';
      const [moRes, planRes, clsRes] = await Promise.all([
        needMo
          ? supabaseDR.from('mtn_orders')
              .select('id, mo_no, machine_no, line_name, status, mtn_dept, report_at, problem_characteristic')
              .in('status', OPEN_MO_STATUSES).order('report_at', { ascending: false }).limit(300)
          : Promise.resolve({ data: [] }),
        needPm
          ? supabaseDR.from('pm_plans').select('id, checklist_id, plan_type, next_due_date, interval_days').eq('is_active', true)
          : Promise.resolve({ data: [] }),
        needPm
          ? supabaseDR.from('checklists').select('id, equipment_id, department').eq('module', 'mtn')
          : Promise.resolve({ data: [] }),
      ]);
      if (moRes.error) throw moRes.error;
      if (planRes.error) throw planRes.error;
      const cls = clsRes.data || [];
      const eqIds = [...new Set(cls.map(c => c.equipment_id).filter(Boolean))];
      const { data: jigs } = eqIds.length
        ? await supabaseDR.from('jigs').select('id, name, jig_no, machine_no, line_name').in('id', eqIds)
        : { data: [] };
      setD({ mo: moRes.data || [], plans: planRes.data || [], cls, jigs: jigs || [], loadErr: false });
      setErr(null);
    } catch (e) { setErr(e?.message || 'โหลดข้อมูลไม่สำเร็จ'); }
  }, [lines.length, dept]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // ใบซ่อม/แผน PM เปลี่ยนช้า — poll ห่างได้ (downtime สดมี realtime ในบอร์ดอยู่แล้ว)
    const stop = visibleInterval(load, RATE.ANALYTIC);
    return () => stop();
  }, [load]);

  const secOpts = useMemo(
    () => [...new Set(lines.map(l => l.section).filter(Boolean))].sort(), [lines]);
  const cur = DEPTS.find(x => x.key === dept);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: 'clamp(8px, 1vw, 14px)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* ── แถบบนสุด: บางที่สุดเท่าที่ยังบอกได้ว่า "จอนี้ของแผนกไหน" ──
          ทุกพิกเซลแนวตั้งที่แถบนี้กิน = พื้นที่ที่ผังเสียไป (บทเรียน 2026-08-26 "ยังสเกลแย่อยู่เลย")
          → ตัวเลือกทั้งหมดพับหลังปุ่ม ⚙️ · เปิดมาเจอเนื้อหาเลย */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16, fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
          {cur.icon} จอ TV · {cur.label}
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          {cur.sub} · วันงาน {workDate}
          {secFilter ? ` · เฉพาะ ${secFilter}` : ''}
          {scopeSet ? ` · ${scopeSet.size} ไลน์` : ' · ทุกไลน์'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={toggleFs} style={btn(fs)} title="เต็มจอ — เก็บแถบเบราว์เซอร์คืนพื้นที่ให้ผัง">⛶</button>
          <button onClick={() => setBarOpen(o => !o)} style={btn(barOpen)}>⚙️ ตั้งค่าจอ</button>
        </div>
      </div>

      {barOpen && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '9px 12px' }}>
          {DEPTS.map(x => (
            <button key={x.key} onClick={() => setParam('dept', x.key)} style={btn(dept === x.key)}>
              {x.icon} {x.label}
            </button>
          ))}
          <span style={{ width: 1, height: 20, background: 'var(--border2)' }} />
          {/* ส่วนงาน — ค่าที่ไม่มีในลิสต์ (ส่วนงานถูกเปลี่ยนชื่อ) ต้องยังเลือกเห็นได้ ห้ามหายเงียบ */}
          <select value={secFilter} onChange={e => setParam('sec', e.target.value)}
            style={{ width: 190, fontSize: 12.5, padding: '5px 8px', borderRadius: 8, background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)' }}>
            <option value="">ทุกส่วนงาน (ตามสิทธิ์)</option>
            {secOpts.map(s => <option key={s} value={s}>{s}</option>)}
            {secFilter && !secOpts.includes(secFilter) && <option value={secFilter}>⚠ {secFilter} (ไม่มีในทะเบียน)</option>}
          </select>
          <span style={{ width: 1, height: 20, background: 'var(--border2)' }} />
          {/* 🔊 ขอบเขตเสียง — ตัว <DowntimeSiren> ในบอร์ดอ่าน `?sound=` ตัวเดียวกัน */}
          <button onClick={() => setParam('sound', sp.get('sound') === 'all' ? '' : 'all')} style={btn(sp.get('sound') === 'all')}>
            {sp.get('sound') === 'all' ? '🔊 ดังทุกเครื่องหยุด' : '🔔 ดังเฉพาะเรียกช่าง'}
          </button>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            ตั้งเสร็จแล้ว <b>บุ๊กมาร์กหน้านี้ไว้ที่ทีวี</b> — ค่าอยู่ใน URL จอจะจำเอง ไม่ต้องมากดทุกเช้า
          </span>
        </div>
      )}

      {err && (
        <div style={{ background: 'var(--card)', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 10, padding: 12, fontSize: 13 }}>
          ⚠ โหลดข้อมูลไม่สำเร็จ — ตัวเลขบนจอยังไม่ใช่ของจริง ({err})
        </div>
      )}
      {!d && !err && (
        <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14, padding: 40 }}>กำลังโหลด...</div>
      )}
      {d && <MtnAndonBoard d={d} ctx={ctx} cards={dept} />}
    </div>
  );
}

const btn = (on) => ({
  fontSize: 12.5, fontWeight: 800, padding: '5px 12px', borderRadius: 999, cursor: 'pointer',
  background: on ? 'var(--accent)' : 'var(--bg3)', color: on ? '#08120a' : 'var(--text)',
  border: `1px solid ${on ? 'var(--accent)' : 'var(--border2)'}`,
});
