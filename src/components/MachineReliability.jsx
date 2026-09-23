/* ═══════════════════════════════════════════════════════════════════════════
   ⚙️ รายอุปกรณ์ — Downtime · MTTR · MTBF   (แท็บใน /mtn-repair · 2026-09-11)

   คำขอทีม MTN: "สรุป Downtime และ MTTR MTBF ในโหมดของเครื่องจักร เอาไว้เปรียบเทียบ
   การใช้งานของโปรแกรมจากส่วนกลาง" · คำสั่ง user: **นับจากเครื่องจริง ไม่เอาใบแจ้งซ่อม**
   และ **แยกได้ว่าเป็น เครื่อง / จิ๊ก / แม่พิมพ์**

   สูตรทั้งหมดอยู่ `src/utils/mtnMetrics.js` (pure + เทส 16 เคส) — ห้ามคำนวณเองในไฟล์นี้
   ⚠️ **2 โหมดตัวเลข (2026-09-14)** — audit เทียบกับ %A ของ Daily Report แล้วพบว่านิยามต่างกัน:
      · มุมเครื่อง = นาทีเต็มที่เครื่องตัวนั้นหยุด (ตอบ "เครื่องนี้เสียบ่อยแค่ไหน")
      · มุมไลน์   = ถ่วง 1/N บนไลน์เครื่องขนาน เหมือนสูตร %A (ตอบ "ไลน์เสียเวลาไปเท่าไหร่")
      **ต้องมีทั้งคู่** — เอาเลขมุมเครื่องไปเทียบจอ OEE ตรงๆ แล้วจะเถียงกันว่าจอไหนถูก
   ⚠️ เวลาเดินเครื่อง **หักเวลาพักตามนโยบาย** (`break_policies`) แล้ว — ต้องส่ง policies เข้าไปเสมอ
      ไม่ส่ง = uptime เกินจริง ~100-150 นาที/กะ (util จะตั้ง summary.hasBreakPolicy=false ให้เตือน)
   ⚠️ downtime 90 วัน > 8,000 แถว → ต้องดึงผ่าน `fetchAllRows` (กับดัก 1000 แถวของ PostgREST)
   ═══════════════════════════════════════════════════════════════════════════ */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import LineSelect from './LineSelect';
import fetchAllRows from '../utils/fetchAllRows';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { EQUIPMENT_KINDS, KIND_META } from '../utils/equipmentKinds';
import { parallelUnitsOf } from '../utils/lineTypes';
import { machineReliability, summarizeByKind, viewMetrics, poolRowPhases, fmtDur } from '../utils/mtnMetrics';
import TimeRangeBar from './TimeRangeBar';
import useTimeRange from '../utils/useTimeRange';
import { rangeDays } from '../utils/timeRange';

const inp = {
  padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
};
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 };
const th = { padding: '8px 10px', textAlign: 'left', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap' };
const td = { padding: '7px 10px', fontSize: 12.5, borderTop: '1px solid var(--border)' };
const tdNum = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

/* ชิปเลือกชนิด — "ไม่อยู่ในทะเบียน" เป็นกลุ่มของตัวเอง ห้ามยัดรวมกับเครื่องจักร
   (เลขที่คนพิมพ์เองอย่าง "เลเซอร์08" ยังไม่รู้ว่าเป็นอะไร — เดาแล้วตัวเลขมั่ว) */
const KIND_CHIPS = [
  { key: 'all', icon: '📦', label: 'ทั้งหมด' },
  ...EQUIPMENT_KINDS.map(k => ({ key: k.key, icon: k.icon, label: k.label })),
  { key: '_unknown', icon: '❔', label: 'ไม่อยู่ในทะเบียน' },
];

const fmtDate = (ms) => (ms
  ? new Date(ms).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short' })
  : '—');

export default function MachineReliability({ machines = [], lineObjs = [], scopeLines = null }) {
  /* ⏱️ ช่วงข้อมูล = แถบกลาง (UI §6.16) — เดิมเป็น dropdown "N วันล่าสุด" อย่างเดียว เลือกช่วงในอดีตไม่ได้
     · แผงนี้ฝังอยู่ในหน้าแม่ ⇒ ใช้ `?from=&to=` ร่วมกับแท็บอื่นของหน้าเดียวกัน (สลับแท็บแล้วช่วงไม่หาย)
     · `days` ยังคงไว้เพราะโค้ดคำนวณด้านล่างใช้ตัวเลขนี้ — แต่มาจากช่วงที่เลือกจริงแล้ว ไม่ใช่ค่าคงที่ */
  const tr = useTimeRange({ defaultDays: 30 });
  const days = rangeDays(tr.from, tr.to) || 30;
  const [line, setLine] = useState('');
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  /* โหมดนับ: 'full' = นาทีเต็ม (มุมเครื่อง) · 'line' = ถ่วง 1/N (มุมไลน์ ตรงกับ %A) */
  const [mode, setMode] = useState('full');
  /* รวมเครื่องที่ไม่เคยเสียในช่วงที่ดู (คำสั่ง user 2026-09-14) — ค่าเริ่มต้นเปิด เพราะไม่นับ = MTBF ต่ำกว่าจริง
     ปิดได้เมื่ออยากดูเฉพาะตัวที่มีปัญหา (ตารางสั้นลง) */
  const [withIdle, setWithIdle] = useState(true);
  const [raw, setRaw] = useState({ downtimes: [], sessions: [] });
  const [breaks, setBreaks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  /* โหลด downtime + กะ ของช่วงที่เลือก
     ⚠️ guard `alive` — สลับช่วงวันเร็วๆ แล้วคำตอบเก่ากลับมาทีหลัง = ทับจอด้วยข้อมูลผิดช่วง
        (กฎเหล็ก DB ข้อ 4 · stale-response race)
     ⚠️ downtime 90 วัน > 8,000 แถว → fetchAllRows เท่านั้น (select เปล่าได้ 1000 แถวแรก แล้วที่เหลือหายเงียบ) */
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setLoadErr('');
    /* 🔴 ต้องยึด "ช่วงที่เลือกจริง" ไม่ใช่ "N วันนับถอยจากตอนนี้" — ไม่งั้นพอเลือกช่วงในอดีต
       จำนวนวันถูกแต่หน้าต่างเวลาผิด (ยังลากถึงวันนี้เสมอ) = ตัวเลขไม่ตรงกับที่จอบอก */
      const since = new Date(`${tr.from}T00:00:00`).toISOString();
      const until = new Date(`${tr.to}T00:00:00`); until.setDate(until.getDate() + 1);
      const untilIso = until.toISOString();
      const [dtRes, sesRes] = await Promise.all([
        fetchAllRows(supabaseDR, 'downtime_logs',
          /* call_mtn_ack_at/fix_at = จังหวะ "ช่างรับงาน" และ "ซ่อมเสร็จ" — ใช้แยก MTTA ออกจากเวลาซ่อมจริง
             (ใบ MO ส่งค่ากลับมาให้ตั้งแต่ 2026-09-14 + backfill ของเก่าแล้ว) */
          'id, session_id, machine_no, started_at, ended_at, duration_min, description, call_mtn_ack_at, fix_at, dr_downtime_types(name_th, category)',
          qq => qq.gte('started_at', since).lt('started_at', untilIso).order('started_at').order('id')),
        fetchAllRows(supabaseDR, 'production_sessions',
          'id, line_name, work_date, shift, shift_min, start_time, end_time',
          qq => qq.gte('work_date', tr.from).lte('work_date', tr.to).order('work_date').order('id')),
      ]);
      if (!alive) return;
      const errs = [dtRes.error && 'downtime', sesRes.error && 'กะการผลิต'].filter(Boolean);
      if (errs.length) { setLoadErr(`โหลดไม่สำเร็จ: ${errs.join(' · ')} — ตัวเลขไม่ครบ`); toast.error(`โหลดข้อมูลไม่ครบ: ${errs.join(' · ')}`); }
      setRaw({ downtimes: dtRes.data || [], sessions: sesRes.data || [] });
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [tr.from, tr.to]);

  /* นโยบายเวลาพัก — ไม่ผูกกับช่วงวัน โหลดครั้งเดียว
     ⚠️ ต้องได้ process_type มาด้วย (สัญญาของ policyBreakForShift) แม้ตอนนี้ทุกแถวเป็น common */
  useEffect(() => {
    let alive = true;
    supabaseDR.from('break_policies').select('shift, process_type, start_time, duration_min, ot_scope')
      .eq('is_active', true)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) toast.error('โหลดนโยบายเวลาพักไม่สำเร็จ — เวลาเดินเครื่องจะสูงกว่าจริง');
        setBreaks(data || []);
      });
    return () => { alive = false; };
  }, []);

  const sessionLineOf = useMemo(() => {
    const m = new Map(raw.sessions.map(s => [s.id, s.line_name]));
    return (id) => m.get(id) || '';
  }, [raw.sessions]);

  const lineFamilyOf = useCallback(
    (n) => (lineObjs.length ? getLineFamilyNames(lineObjs, n) : [n]),
    [lineObjs],
  );

  /* N เครื่องขนานของไลน์ — parallel_stations (ตั้งที่ LineSetup) · parallel_machine ที่ไม่ตั้ง
     = fallback นับเครื่องในทะเบียนของไลน์นั้น (สูตรเดียวกับ computeOEE ใน DailyReport) */
  const parallelOf = useCallback((lineName) => {
    const row = lineObjs.find(l => l.name === lineName);
    if (!row) return 1;
    const fallback = new Set(machines.filter(m => m.line_name === lineName).map(m => m.machine_no)).size;
    return parallelUnitsOf(row, fallback);
  }, [lineObjs, machines]);

  const { rows, summary } = useMemo(
    () => machineReliability({
      downtimes: raw.downtimes, machines, sessions: raw.sessions,
      lineFamilyOf, sessionLineOf, breakPolicies: breaks, parallelOf, includeIdle: withIdle,
    }),
    [raw, machines, lineFamilyOf, sessionLineOf, breaks, parallelOf, withIdle],
  );

  const weighted = mode === 'line';

  // กรองตาม scope ส่วนงาน → ไลน์ที่เลือก → ชนิด → คำค้น
  const famOfSel = useMemo(
    () => (line ? new Set(lineFamilyOf(line)) : null),
    [line, lineFamilyOf],
  );
  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return rows.filter(r => {
      if (scopeLines && r.lineName && !scopeLines.has(r.lineName)) return false;
      if (famOfSel && !(r.lineName && famOfSel.has(r.lineName))) return false;
      if (kind === '_unknown' && r.kindKnown) return false;
      if (kind !== 'all' && kind !== '_unknown' && (!r.kindKnown || (r.kind || 'machine') !== kind)) return false;
      if (kw && !`${r.machineNo} ${r.machineName} ${r.lineName}`.toLowerCase().includes(kw)) return false;
      return true;
    })
      // เรียงตามโหมดที่เปิดอยู่ — ถ่วง 1/N แล้วลำดับ "เสียเวลามากสุด" เปลี่ยน
      .sort((a, b) => viewMetrics(b, weighted).dtMin - viewMetrics(a, weighted).dtMin || b.stops - a.stops);
  }, [rows, scopeLines, famOfSel, kind, q, weighted]);

  const kindRows = useMemo(() => summarizeByKind(shown, weighted), [shown, weighted]);
  // ช่วงย่อย (รอช่าง/ซ่อมจริง/กลับมารัน) ของชุดที่กรองอยู่ — ไม่ถ่วง 1/N (เป็นเวลาของเหตุการณ์ ไม่ใช่เวลาที่ไลน์เสีย)
  const ph = useMemo(() => poolRowPhases(shown), [shown]);
  const tot = useMemo(() => ({
    stops: shown.reduce((s, r) => s + r.stops, 0),
    dtMin: shown.reduce((s, r) => s + viewMetrics(r, weighted).dtMin, 0),
    closed: shown.reduce((s, r) => s + r.closedStops, 0),
  }), [shown, weighted]);

  if (loading) return <div style={{ fontSize: 13, color: 'var(--muted)', padding: '30px 0', textAlign: 'center' }}>กำลังคำนวณจาก downtime จริง…</div>;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* ⏱️ แถบกรองเวลามาตรฐาน (UI §6.16) — ใช้ `?from=&to=` ร่วมกับแท็บอื่นของหน้าแม่ */}
      <TimeRangeBar
        scale={tr.scale} from={tr.from} to={tr.to} today={tr.today} scales={null}
        onFrom={tr.setFrom} onTo={tr.setTo} onPreset={tr.setPreset} style={{ marginBottom: 12 }}
      />
      {/* ── ตัวกรอง ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <LineSelect lines={lineObjs} value={line} onChange={setLine} placeholder="ทุกไลน์" style={{ ...inp, width: 200 }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔎 ค้นเลขเครื่อง / ชื่อ / ไลน์"
               aria-label="ค้นหาอุปกรณ์" style={{ ...inp, width: 220 }} />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {KIND_CHIPS.map(c => {
          const on = kind === c.key;
          const n = c.key === 'all' ? rows.length
            : c.key === '_unknown' ? rows.filter(r => !r.kindKnown).length
            : rows.filter(r => r.kindKnown && (r.kind || 'machine') === c.key).length;
          return (
            <button key={c.key} onClick={() => setKind(c.key)} style={{
              padding: '5px 12px', borderRadius: 16, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border2)'}`,
              background: on ? 'var(--accent-dim)' : 'var(--bg3)', color: on ? 'var(--accent)' : 'var(--muted)',
            }}>{c.icon} {c.label} ({n})</button>
          );
        })}
      </div>

      {/* ── สลับมุมมองการนับ — ไลน์เครื่องขนานเท่านั้นที่ตัวเลข 2 ชุดต่างกัน ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>นับแบบ:</span>
        {[
          { key: 'full', label: '🔧 มุมเครื่อง (นาทีเต็ม)', tip: 'เครื่องตัวนั้นหยุดจริงกี่นาที — ใช้ตัดสินใจงานซ่อม/อะไหล่' },
          { key: 'line', label: '🏭 มุมไลน์ (ถ่วง 1/N)', tip: 'ไลน์เสียเวลาไปเท่าไหร่ — สูตรเดียวกับ %A ใน Daily Report (เครื่องขนาน N ตัว หยุด 1 ตัว = ไลน์เสีย 1/N)' },
        ].map(m => {
          const on = mode === m.key;
          return (
            <button key={m.key} onClick={() => setMode(m.key)} title={m.tip} style={{
              padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              border: `1.5px solid ${on ? '#3b82f6' : 'var(--border2)'}`,
              background: on ? 'rgba(59,130,246,0.12)' : 'var(--bg3)', color: on ? '#3b82f6' : 'var(--muted)',
            }}>{m.label}</button>
          );
        })}
        {summary.parallelLines > 0 && (
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            · มีผลกับ {summary.parallelLines} อุปกรณ์บนไลน์เครื่องขนาน (นอกนั้นตัวเลขเท่ากันทั้ง 2 โหมด)
          </span>
        )}
        {/* ไม่นับเครื่องที่ไม่เคยเสีย = MTBF รวมต่ำกว่าจริง — เปิดไว้เป็นค่าเริ่มต้น (user 2026-09-14) */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text2)', cursor: 'pointer', marginLeft: 4 }}
               title="เครื่องที่เดินทั้งช่วงโดยไม่เสียเลย ทำให้ MTBF ของกลุ่มสูงขึ้น — ไม่นับ = ตัวเลขต่ำกว่าจริง">
          <input type="checkbox" checked={withIdle} onChange={e => setWithIdle(e.target.checked)} />
          รวมเครื่องที่ไม่เคยเสีย{summary.idleCount > 0 && ` (${summary.idleCount})`}
        </label>
      </div>

      {loadErr && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: 10, padding: '9px 12px', fontSize: 12.5 }}>⚠️ {loadErr}</div>
      )}

      {/* ── บอกให้ชัดว่าเลขนี้คืออะไร — ไม่งั้นเอาไปเทียบกับระบบส่วนกลางแล้วเถียงกัน ── */}
      <div style={{ ...card, fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
        📐 <b>นับจาก downtime ที่หน้างานบันทึกจริง</b> (ไม่ใช่ใบแจ้งซ่อม) ในช่วง {days} วันล่าสุด ·
        หยุดตามแผน (PM/เปลี่ยนรุ่น) ไม่นับเป็น "ครั้งที่เสีย" แต่หักออกจากเวลาเดินเครื่อง
        <div><b>MTTR</b> = เวลาที่ไลน์หยุดเฉลี่ยต่อครั้ง (รวมเวลารอช่าง) — เฉลี่ยเฉพาะครั้งที่ปิดแล้ว</div>
        <div>
          <b>MTBF ของกลุ่ม</b> = Σ เวลาเดินเครื่อง ÷ Σ ครั้งที่เสีย (<b>รวมกอง ไม่ใช่เฉลี่ยค่าเฉลี่ยรายเครื่อง</b>) ·
          เครื่องที่ไม่เคยเสีย <b>นับชั่วโมงเดินเข้าตัวตั้งด้วย</b> แต่ MTBF รายตัวเป็น “—” (เสีย 0 ครั้ง หารไม่ได้)
          {summary.idleCount > 0 && <> · ช่วงนี้มี <b>{summary.idleCount} เครื่องที่ไม่เคยเสีย</b></>}
          <br />⚠️ แม่พิมพ์/จิ๊กไม่ถูกเติมเข้ามา — เป็นทูลที่ขึ้นเครื่องเป็นช่วงๆ ชั่วโมงเดินยังวัดไม่ได้
        </div>
        <div><b>MTBF</b> = เวลาเดินเครื่อง ÷ จำนวนครั้งที่เสีย · <b style={{ color: '#f59e0b' }}>เวลาเดินเครื่องเป็นค่าประมาณ</b> จากชั่วโมงกะของไลน์ที่อุปกรณ์สังกัด (ยังไม่มีตัวนับรายเครื่อง)</div>
        <div>
          ⏸️ เวลาเดินเครื่อง <b>หักเวลาพักตามนโยบายแล้ว</b>
          {summary.hasBreakPolicy
            ? <> (ช่วงนี้หักไป {fmtDur(summary.breakMin)} — นิยามเดียวกับ %A ใน Daily Report)</>
            : <b style={{ color: '#ef4444' }}> — ยังโหลดนโยบายพักไม่ได้ ตัวเลขนี้จะสูงกว่าจริง</b>}
        </div>
        <div style={{ color: weighted ? '#3b82f6' : 'var(--text2)' }}>
          {weighted
            ? <>🏭 <b>โหมดมุมไลน์</b> — DT บนไลน์เครื่องขนานถูกหาร 1/N เหมือนสูตร %A ⇒ <b>เอาไปเทียบกับจอ OEE / รายงานกะได้</b></>
            : <>🔧 <b>โหมดมุมเครื่อง</b> — นับนาทีเต็มที่อุปกรณ์ตัวนั้นหยุด ⇒ ตัวเลขจะ<b>สูงกว่า</b>ที่จอ OEE หักจากไลน์ บนไลน์เครื่องขนาน (ไม่ใช่ตัวเลขผิด คนละคำถามกัน)</>}
        </div>
      </div>

      {/* ── คุณภาพข้อมูล: บอกตรงๆ ว่าเทียบทะเบียนได้แค่ไหน ห้ามเงียบ ── */}
      {(summary.unmatched > 0 || summary.noMachineNo > 0 || summary.unknownShifts > 0) && (
        <div style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.45)', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, lineHeight: 1.7 }}>
          <b>⚠️ ความครบของข้อมูล</b> — เทียบทะเบียนอุปกรณ์ได้ {summary.matched} จาก {summary.equipCount} เลข
          {summary.unmatched > 0 && <div>· <b>{summary.unmatched} เลขไม่อยู่ในทะเบียน</b> (หน้างานพิมพ์ชื่อเล่น เช่น “เลเซอร์08”) — <b>ยังนับ downtime/MTTR ให้</b> แต่บอกชนิดและ MTBF ไม่ได้ · ดูได้ที่ชิป ❔ ไม่อยู่ในทะเบียน</div>}
          {summary.noMachineNo > 0 && <div>· downtime {summary.noMachineNo} ครั้งไม่ได้ระบุเครื่องเลย — ไม่เข้าตารางนี้</div>}
          {summary.unknownShifts > 0 && <div>· กะ {summary.unknownShifts} ใบหาชั่วโมงทำงานไม่ได้ → เวลาเดินเครื่อง (และ MTBF) ต่ำกว่าจริงเล็กน้อย</div>}
        </div>
      )}

      {/* ── 🕐 แยกช่วงเวลา: รอช่าง / ซ่อมจริง / กลับมารัน (2026-09-15) ──────────────────
          MTTR ที่โชว์ในตารางคือ "ไลน์หยุดนานเท่าไหร่" (รวมรอช่าง) · 3 ท่อนนี้ตอบว่าเสียเวลาไปกับอะไร
          ⚠️ วัดได้เฉพาะครั้งที่กดครบจังหวะจริง — ต้องโชว์ตัวหารและเหตุผลที่วัดไม่ได้เสมอ ห้ามเฉลี่ยเงียบ */}
      <div style={{ ...card, borderColor: ph.n > 0 ? 'var(--border)' : 'rgba(245,158,11,0.45)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>🕐 เวลาหายไปกับอะไร (ตั้งแต่เครื่องหยุด → กลับมารัน)</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            วัดแยกช่วงได้ <b style={{ color: ph.n > 0 ? '#22c55e' : '#f59e0b' }}>{ph.n}</b> ครั้ง
            {ph.oneShot > 0 && <> · ตัดใบที่กดรวดเดียว {ph.oneShot} ครั้ง</>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
          {[
            { k: 'mttaMin', icon: '⏳', label: 'รอช่าง (MTTA)', color: '#ef4444', tip: 'ตั้งแต่เครื่องหยุด จนช่างกดรับงาน — คิว/ระยะทาง/การแจ้ง' },
            { k: 'mttrPureMin', icon: '🔧', label: 'ซ่อมจริง (MTTR)', color: '#f59e0b', tip: 'ตั้งแต่ช่างรับงาน จนกดซ่อมเสร็จ — ทักษะช่าง/อะไหล่' },
            { k: 'restartMin', icon: '▶️', label: 'กลับมารัน', color: '#3b82f6', tip: 'ตั้งแต่ซ่อมเสร็จ จนไลน์เดินต่อ — ตรวจชิ้นแรก/warm-up' },
            { k: 'totalMin', icon: '🛑', label: 'รวม (Downtime)', color: 'var(--text)', tip: 'ผลรวมทั้ง 3 ท่อน = MTTR แบบ Restore ที่ตารางข้างล่างโชว์' },
          ].map(c => (
            <div key={c.k} title={c.tip} style={{ flex: 1, minWidth: 140, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px' }}>
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{c.icon} {c.label}</div>
              <div style={{ fontSize: 19, fontWeight: 800, color: c.color }}>{fmtDur(ph[c.k])}</div>
              {ph.n > 0 && ph.totalMin > 0 && c.k !== 'totalMin' && (
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{Math.round((ph[c.k] / ph.totalMin) * 100)}% ของเวลาที่หยุด</div>
              )}
            </div>
          ))}
        </div>
        {/* บอกตรงๆ ว่าทำไมถึงวัดไม่ได้ — คนหน้างานจะได้รู้ว่าต้องกดอะไรเพิ่ม */}
        {(summary.phaseGaps?.no_ack > 0 || summary.phaseGaps?.after_end > 0 || summary.phaseGaps?.no_fix > 0) && (
          <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 8, lineHeight: 1.7 }}>
            ทั้งช่วงที่ดู — ยังแยกช่วงไม่ได้เพราะ:
            {summary.phaseGaps.no_ack > 0 && <> · <b>{summary.phaseGaps.no_ack}</b> ครั้งไม่ได้กด “รับงาน”</>}
            {summary.phaseGaps.no_fix > 0 && <> · <b>{summary.phaseGaps.no_fix}</b> ครั้งไม่ได้กด “ซ่อมเสร็จ”</>}
            {summary.phaseGaps.after_end > 0 && <> · <b style={{ color: '#f59e0b' }}>{summary.phaseGaps.after_end}</b> ครั้งเปิด/รับใบซ่อม<b>หลังเครื่องกลับมารันแล้ว</b> (ใบ MO ถูกใช้เป็นเอกสารตามหลัง ไม่ใช่การจ่ายงานสด)</>}
            <div style={{ color: 'var(--muted)' }}>⇒ อยากได้ MTTA จริง ต้อง <b>กดรับงานตอนไปถึงหน้างาน</b> แล้วค่อยกดซ่อมเสร็จตอนซ่อมจบ</div>
          </div>
        )}
      </div>

      {/* ── สรุปตามชนิดอุปกรณ์ ── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ ...card, flex: 1, minWidth: 150 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>รวมที่กรองอยู่</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2 }}>{shown.length} <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>อุปกรณ์</span></div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>หยุด {tot.stops} ครั้ง · รวม {fmtDur(tot.dtMin)}</div>
        </div>
        {kindRows.map(k => {
          const meta = k.kind === '_unknown' ? { icon: '❔', label: 'ไม่อยู่ในทะเบียน' } : (KIND_META[k.kind] || KIND_META.machine);
          return (
            <div key={k.kind} style={{ ...card, flex: 1, minWidth: 190 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{meta.icon} {meta.label} · {k.equip} ตัว</div>
              <div style={{ display: 'flex', gap: 14, marginTop: 4, flexWrap: 'wrap' }}>
                <div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>MTTR</div><div style={{ fontSize: 16, fontWeight: 800, color: '#f59e0b' }}>{fmtDur(k.mttrMin)}</div></div>
                <div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>MTBF</div><div style={{ fontSize: 16, fontWeight: 800, color: '#3b82f6' }}>{fmtDur(k.mtbfMin)}</div></div>
                <div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>หยุด</div><div style={{ fontSize: 16, fontWeight: 800 }}>{k.stops}</div></div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── ตารางรายอุปกรณ์ ── */}
      {!shown.length ? (
        <div style={{ ...card, fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>
          ไม่มีอุปกรณ์ที่ตรงกับตัวกรอง — ลองขยายช่วงวันหรือเลือก “ทั้งหมด”
        </div>
      ) : (
        <div className="table-sticky" style={{ border: '1px solid var(--border)', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
            <thead style={{ background: 'var(--bg2)', position: 'sticky', top: 0, zIndex: 1 }}>
              <tr>
                <th style={th}>อุปกรณ์</th>
                <th style={th}>ชนิด</th>
                <th style={th}>ไลน์</th>
                <th style={{ ...th, textAlign: 'right' }}>หยุด (ครั้ง)</th>
                <th style={{ ...th, textAlign: 'right' }}>DT รวม{weighted && <span style={{ color: '#3b82f6' }}> (1/N)</span>}</th>
                <th style={{ ...th, textAlign: 'right' }}>MTTR</th>
                <th style={{ ...th, textAlign: 'right' }}>MTBF</th>
                <th style={{ ...th, textAlign: 'right' }}>พร้อมใช้</th>
                <th style={th}>สาเหตุหลัก</th>
                <th style={{ ...th, textAlign: 'right' }}>ล่าสุด</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const meta = r.kindKnown ? (KIND_META[r.kind] || KIND_META.machine) : null;
                const v = viewMetrics(r, weighted);   // ห้ามหยิบ r.dtMin ตรงๆ — สลับโหมดแล้วจะตกหล่น
                return (
                  <tr key={r.key}>
                    <td style={td}>
                      <b>{r.machineNo}</b>
                      {r.machineName && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.machineName}</div>}
                      {/* หลายสะกด = ต้นทางกรอกไม่นิ่ง — โชว์ให้ไปตามแก้ได้ */}
                      {r.rawNos.length > 1 && (
                        <div style={{ fontSize: 10.5, color: 'var(--muted)' }} title="เลขที่หน้างานพิมพ์มาแล้วระบบยุบเป็นเครื่องเดียวกัน">
                          ✎ กรอกมา {r.rawNos.length} แบบ: {r.rawNos.join(' · ')}
                        </div>
                      )}
                      {r.openStops > 0 && <div style={{ fontSize: 10.5, color: '#ef4444', fontWeight: 700 }}>🔴 ยังเปิดค้าง {r.openStops} ครั้ง</div>}
                      {r.neverFailed && <div style={{ fontSize: 10.5, color: '#22c55e', fontWeight: 700 }}>✅ ไม่เคยเสียในช่วงนี้</div>}
                    </td>
                    <td style={td}>
                      {meta
                        ? <span>{meta.icon} {meta.label}</span>
                        : <span style={{ color: '#f59e0b', fontWeight: 700 }} title="เลขนี้ไม่มีในทะเบียนอุปกรณ์ — บอกชนิดไม่ได้">❔ ไม่อยู่ในทะเบียน</span>}
                    </td>
                    <td style={{ ...td, color: r.lineName ? 'inherit' : 'var(--muted)' }}>
                      {r.lineName || '—'}
                      {r.parallelN > 1 && (
                        <div style={{ fontSize: 10.5, color: '#3b82f6' }} title={`ไลน์นี้มีเครื่องวิ่งขนาน ${r.parallelN} ตัว — โหมดมุมไลน์จะหาร DT ด้วย ${r.parallelN}`}>
                          ⇄ ขนาน {r.parallelN} ตัว
                        </div>
                      )}
                    </td>
                    <td style={tdNum}>{r.stops}{r.plannedStops > 0 && <span style={{ color: 'var(--muted)', fontSize: 11 }}> (+{r.plannedStops} ตามแผน)</span>}</td>
                    <td style={tdNum} title={r.parallelN > 1 ? `มุมเครื่อง ${fmtDur(r.dtMin)} · มุมไลน์ ${fmtDur(r.dtMinW)}` : undefined}>{fmtDur(v.dtMin)}</td>
                    <td style={{ ...tdNum, color: '#f59e0b', fontWeight: 700 }}
                        title={r.phaseN > 0 ? `แยกช่วง (${r.phaseN} ครั้ง): รอช่าง ${fmtDur(r.mttaMin)} · ซ่อมจริง ${fmtDur(r.mttrPureMin)} · กลับมารัน ${fmtDur(r.restartMin)}` : 'ยังแยกไม่ได้ — ต้องกดรับงาน/ซ่อมเสร็จตอนทำงานจริง'}>
                      {fmtDur(v.mttrMin)}{r.phaseN > 0 && <span style={{ fontSize: 10, color: 'var(--muted)' }}> ⏳{fmtDur(r.mttaMin)}</span>}
                    </td>
                    <td style={{ ...tdNum, color: v.mtbfMin == null ? 'var(--muted)' : '#3b82f6', fontWeight: 700 }}
                        title={v.mtbfMin == null ? 'ไม่รู้เวลาเดินเครื่อง (ไม่รู้ไลน์ หรือไม่มีกะในช่วงนี้)' : 'ประมาณจากชั่วโมงกะของไลน์ (หักเวลาพักแล้ว)'}>
                      {fmtDur(v.mtbfMin)}
                    </td>
                    <td style={{ ...tdNum, color: v.availPct == null ? 'var(--muted)' : v.availPct >= 95 ? '#22c55e' : v.availPct >= 90 ? '#f59e0b' : '#ef4444' }}>
                      {v.availPct == null ? '—' : `${v.availPct}%`}
                    </td>
                    <td style={{ ...td, fontSize: 11.5, color: 'var(--text2)' }}>{r.topCause || '—'}</td>
                    <td style={{ ...tdNum, fontSize: 11.5, color: 'var(--muted)' }}>{fmtDate(r.lastAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
