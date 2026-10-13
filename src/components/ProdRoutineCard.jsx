/* ══════════════════════════════════════════════════════════════════════════
   📋 การ์ด "งานประจำกะที่ยังไม่ทำ" บนจอ TV ฝ่ายผลิต (`/tv?dept=production`) · 2026-10-12

   ที่มา (user 12/10): *"เครื่องจักรยังไม่ตรวจ AM หรืองาน routine อื่นๆ ที่ผลิตต้องทำก็ควรจะโชว์นะ"*

   3 ระบบ = แท็บของ `/daily-checker` (AM · Poka-Yoke · LPA) — กฎทั้งหมดอยู่ `src/utils/prodRoutine.js`
     · AM โหลด/ตัดสินด้วย `loadDailyAm()` + `dailyAmLineStatus()` (`lib/dailyAmBoard.js`) **ที่เดียวทั้งระบบ**
       — ห้ามคิวรี inspections เอง (กฎ CLAUDE.md §AM↔PM · มีด่าน)
     · Poka-Yoke / LPA อ่านตาราง Main ตรง (เลือกเฉพาะคอลัมน์ · กรองวัน/กะฝั่ง server)
   ⚠️ อ่านอย่างเดียว — กดแถวแล้วไปหน้าที่ลงมือจริง (`/daily-checker?tab=…`) · ไม่มีปุ่มเขียน (จอ kiosk)
   ⚠️ โหลดไม่สำเร็จ = เขียนบนจอว่าระบบไหนดึงไม่ได้ **ห้ามขึ้น "✅ ครบ"** (จอที่ยืนยันสิ่งที่ไม่จริง แย่กว่าจอว่าง)
   ══════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { loadDailyAm, dailyAmLineStatus } from '../lib/dailyAmBoard';
import { pokayokeByLine, lpaByLine, routineRows } from '../utils/prodRoutine';
import { useLiveBoard } from '../utils/useLiveBoard';
import { usePolling } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';
import { statusColor } from '../utils/statusTone';

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 };
const SHOW = 6;   // จอ TV ไม่มีใครเลื่อน — เกินนี้พับเป็น "+ อีก N ไลน์" (บอกยอดที่ซ่อนเสมอ)
const names = (arr, n = 3) => (arr.length > n ? `${arr.slice(0, n).join(', ')} +${arr.length - n}` : arr.join(', '));

/**
 * 🪝 โหลด + สรุปงานประจำกะ — ยกเป็น hook ให้บอร์ดแม่เอาตัวเลขไปขึ้นพาดหัวได้ด้วย (ตัวเลขชุดเดียว)
 * @param {{ enabled:boolean, inScope:(l:string)=>boolean, lines:object[] }} p
 */
export function useProdRoutine({ enabled, inScope, lines }) {
  const [amRaw, setAmRaw] = useState(null);
  const [poka, setPoka] = useState({ devices: [], checks: [] });
  const [lpa, setLpa] = useState({ plans: [], audits: [] });
  const [errs, setErrs] = useState([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const linesKey = (lines || []).length;   // primitive ใน deps (กฎ DB ข้อ 9)

  const load = useCallback(async () => {
    const res = await loadDailyAm({ lines: lines?.length ? lines : null });
    const e = [];
    if (!res.ok) e.push(`AM: ${res.error?.message || res.error}`);
    else setAmRaw(res);   // ล้ม = คงค่าเดิม (ล้างเป็นว่าง = จอบอก "ไม่มีจุดตรวจ" ซึ่งผิด)
    const si = res.ok ? res.shift : null;
    if (si) {
      const monthKey = si.workDateStr.slice(0, 7);
      const [devRes, plRes, auRes] = await Promise.all([
        supabase.from('pokayoke_devices').select('id, line_name, name, code, is_active').eq('is_active', true).limit(1000),
        supabase.from('lpa_plans').select('line_name, lpa_plan_days(day, plan_leader, plan_supervisor, plan_manager, plan_gm)')
          .eq('month_key', monthKey).eq('shift', si.shift).limit(500),
        supabase.from('lpa_audits').select('line_name, layer').eq('audit_date', si.workDateStr).eq('shift', si.shift).limit(1000),
      ]);
      let checks = [];
      if (!devRes.error && devRes.data?.length) {
        const cRes = await supabase.from('pokayoke_checks').select('device_id, result')
          .eq('check_date', si.workDateStr).eq('shift', si.shift).limit(1000);
        if (cRes.error) e.push(`Poka-Yoke: ${cRes.error.message}`); else checks = cRes.data || [];
      }
      if (devRes.error) e.push(`Poka-Yoke: ${devRes.error.message}`);
      else setPoka({ devices: devRes.data || [], checks });
      if (plRes.error || auRes.error) e.push(`LPA: ${(plRes.error || auRes.error).message}`);
      else setLpa({ plans: plRes.data || [], audits: auRes.data || [] });
    }
    setErrs(e);
    setNowMs(Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- linesKey แทน lines (array prop)
  }, [linesKey]);

  /* รีเฟรช: realtime ใบตรวจ AM + ใบผลิต (DR · เปิดใบแรก = เริ่มนับกรอบ 60 นาที)
     + poll **ไม่ผ่าน idle gate** ทุก 15 นาที — `pokayoke_checks`/`lpa_audits` (Main) ไม่อยู่ใน publication
     และ AM "เลยกรอบ" เกิดจากนาฬิกาเดิน ⇒ gate จะข้ามรอบจนถึงเพดาน 2 ชม. (ข้อยกเว้นกฎ DB ข้อ 8 ที่ตั้งใจ) */
  useLiveBoard(load, { tables: ['inspections', 'prod_orders'], topic: 'tv-prod-routine', rate: RATE.ANALYTIC, enabled });
  usePolling(load, RATE.BOARD, { enabled, immediate: false });
  useEffect(() => {
    if (!enabled) return undefined;
    const t = setInterval(() => setNowMs(Date.now()), 60000);   // นาฬิกา "เลยกรอบ AM" เดินเอง ไม่ยิง DB
    return () => clearInterval(t);
  }, [enabled]);

  return useMemo(() => {
    if (!amRaw) return { loaded: false, errs, rows: [], counts: null, shift: null };
    const keep = (obj) => Object.fromEntries(Object.entries(obj).filter(([ln]) => !inScope || inScope(ln)));
    const open = amRaw.openSessionLines || new Set();
    const am = keep(dailyAmLineStatus({ ...amRaw, shift: amRaw.shift.shift, now: new Date(nowMs) }));
    const pk = keep(pokayokeByLine(poka.devices, poka.checks, open));
    const day = Number(amRaw.shift.workDateStr.slice(8, 10));
    const lp = keep(lpaByLine(lpa.plans, lpa.audits, day, open));
    const openInScope = [...open].filter(ln => !inScope || inScope(ln)).length;
    return { loaded: true, errs, ...routineRows({ am, poka: pk, lpa: lp }), shift: amRaw.shift, openInScope };
  }, [amRaw, poka, lpa, nowMs, inScope, errs]);
}

/** แถวงาน 1 อย่าง — หัว 1 บรรทัด + รายชื่อ 1 บรรทัด (ตัดด้วย … · ชื่อเต็มที่ title) จอ TV ห้ามตัดบรรทัดจนสูงล้น */
const ONE = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
function Item({ tone, head, sub, onClick, big }) {
  return (
    <div onClick={onClick} style={{ cursor: 'pointer', minWidth: 0 }} title={sub ? `${head} — ${sub}` : head}>
      <div style={{ ...ONE, fontSize: 12 * big, fontWeight: 800, color: tone }}>{head}</div>
      {sub && <div style={{ ...ONE, fontSize: 11.5, fontWeight: 600, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}

export default function ProdRoutineCard({ data, navigate, big = 1 }) {
  const { loaded, errs, rows, counts, shift, openInScope } = data;
  const bad = statusColor('bad'), warn = statusColor('warn'), good = statusColor('good');
  const go = (tab) => navigate?.(`/daily-checker?tab=${tab}`);

  return (<>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13 * big, fontWeight: 900 }}>📋 งานประจำกะที่ยังไม่ทำ</span>
      {shift && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{shift.label} · {shift.workDateStr} · เฉพาะไลน์ที่เปิดกะ ({openInScope ?? 0})</span>}
    </div>
    {errs.length > 0 && (
      <div style={{ ...card, borderColor: bad, color: bad, fontSize: 12.5 }}>
        ⚠ ดึงงานประจำกะไม่ครบ — รายการด้านล่างอาจไม่ครบ ({errs.join(' · ')})
      </div>
    )}
    {!loaded && !errs.length && <div style={{ ...card, color: 'var(--muted)', fontSize: 12.5 }}>กำลังโหลดงานประจำกะ…</div>}
    {loaded && !errs.length && !rows.length && (
      <div style={{ ...card, textAlign: 'center', padding: 18, fontSize: 13 * big, fontWeight: 800, color: openInScope ? good : 'var(--muted)' }}>
        {openInScope ? '✅ ไลน์ที่เปิดกะทำงานประจำครบแล้ว' : 'ยังไม่มีไลน์ไหนเปิดกะ — ยังไม่ต้องทำงานประจำกะ'}
      </div>
    )}
    {rows.slice(0, SHOW).map(r => {
      const tone = r.ng > 0 || r.am?.late ? bad : warn;
      return (
        <div key={r.line} style={{ ...card, display: 'flex', flexDirection: 'column', gap: 4, borderLeft: `7px solid ${tone}`, borderColor: tone }}>
          <div style={{ fontSize: 14 * big, fontWeight: 900, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.line}</div>
          {r.ng > 0 && <Item tone={bad} onClick={() => go('pm')} big={big} head={`🚨 ตรวจพบผิดปกติ ${r.ng} จุด`} sub={names(r.ngNames)} />}
          {r.am && <Item tone={r.am.late ? bad : warn} onClick={() => go('pm')} big={big}
            head={`🔧 AM ยังไม่ตรวจ ${r.am.n}/${r.am.total}${r.am.late ? ' · เลยกรอบ' : ''}`} sub={names(r.am.names)} />}
          {r.poka && <Item tone={warn} onClick={() => go('pokayoke')} big={big}
            head={`🛡️ Poka-Yoke ยังไม่ทดสอบ ${r.poka.n}/${r.poka.total} จุด`} sub={names(r.poka.names)} />}
          {r.lpa && <Item tone={warn} onClick={() => go('lpa')} big={big}
            head={`📋 LPA แผนวันนี้ยังไม่ตรวจ`} sub={`ชั้น ${r.lpa.layers.join(', ')}`} />}
        </div>
      );
    })}
    {rows.length > SHOW && (
      <div onClick={() => go('pm')} style={{ ...card, cursor: 'pointer', fontSize: 12 * big, fontWeight: 800, color: 'var(--text2)', padding: 10 }}>
        + อีก {rows.length - SHOW} ไลน์ — ดูที่ Daily Checker ›
      </div>
    )}
    {counts && rows.length > 0 && (
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
        รวม: AM ค้าง {counts.am} เครื่อง (เลยกรอบ {counts.amLate}) · Poka-Yoke ค้าง {counts.poka} จุด · LPA ค้าง {counts.lpa} ชั้น
      </div>
    )}
  </>);
}
