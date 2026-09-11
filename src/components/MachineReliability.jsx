/* ═══════════════════════════════════════════════════════════════════════════
   ⚙️ รายอุปกรณ์ — Downtime · MTTR · MTBF   (แท็บใน /mtn-repair · 2026-09-11)

   คำขอทีม MTN: "สรุป Downtime และ MTTR MTBF ในโหมดของเครื่องจักร เอาไว้เปรียบเทียบ
   การใช้งานของโปรแกรมจากส่วนกลาง" · คำสั่ง user: **นับจากเครื่องจริง ไม่เอาใบแจ้งซ่อม**
   และ **แยกได้ว่าเป็น เครื่อง / จิ๊ก / แม่พิมพ์**

   สูตรทั้งหมดอยู่ `src/utils/mtnMetrics.js` (pure + เทส 12 เคส) — ห้ามคำนวณเองในไฟล์นี้
   ⚠️ downtime 90 วัน > 8,000 แถว → ต้องดึงผ่าน `fetchAllRows` (กับดัก 1000 แถวของ PostgREST)
   ═══════════════════════════════════════════════════════════════════════════ */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import LineSelect from './LineSelect';
import fetchAllRows from '../utils/fetchAllRows';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { EQUIPMENT_KINDS, KIND_META } from '../utils/equipmentKinds';
import { machineReliability, summarizeByKind, fmtDur } from '../utils/mtnMetrics';

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
  const [days, setDays] = useState(30);
  const [line, setLine] = useState('');
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [raw, setRaw] = useState({ downtimes: [], sessions: [] });
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
      const since = new Date(Date.now() - Number(days) * 86400000).toISOString();
      const [dtRes, sesRes] = await Promise.all([
        fetchAllRows(supabaseDR, 'downtime_logs',
          'id, session_id, machine_no, started_at, ended_at, duration_min, description, dr_downtime_types(name_th, category)',
          qq => qq.gte('started_at', since).order('started_at').order('id')),
        fetchAllRows(supabaseDR, 'production_sessions',
          'id, line_name, work_date, shift, shift_min, start_time, end_time',
          qq => qq.gte('work_date', since.slice(0, 10)).order('work_date').order('id')),
      ]);
      if (!alive) return;
      const errs = [dtRes.error && 'downtime', sesRes.error && 'กะการผลิต'].filter(Boolean);
      if (errs.length) { setLoadErr(`โหลดไม่สำเร็จ: ${errs.join(' · ')} — ตัวเลขไม่ครบ`); toast.error(`โหลดข้อมูลไม่ครบ: ${errs.join(' · ')}`); }
      setRaw({ downtimes: dtRes.data || [], sessions: sesRes.data || [] });
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [days]);

  const sessionLineOf = useMemo(() => {
    const m = new Map(raw.sessions.map(s => [s.id, s.line_name]));
    return (id) => m.get(id) || '';
  }, [raw.sessions]);

  const lineFamilyOf = useCallback(
    (n) => (lineObjs.length ? getLineFamilyNames(lineObjs, n) : [n]),
    [lineObjs],
  );

  const { rows, summary } = useMemo(
    () => machineReliability({
      downtimes: raw.downtimes, machines, sessions: raw.sessions,
      lineFamilyOf, sessionLineOf,
    }),
    [raw, machines, lineFamilyOf, sessionLineOf],
  );

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
    });
  }, [rows, scopeLines, famOfSel, kind, q]);

  const kindRows = useMemo(() => summarizeByKind(shown), [shown]);
  const tot = useMemo(() => ({
    stops: shown.reduce((s, r) => s + r.stops, 0),
    dtMin: shown.reduce((s, r) => s + r.dtMin, 0),
    closed: shown.reduce((s, r) => s + r.closedStops, 0),
    up: shown.reduce((s, r) => s + (r.upMin ?? 0), 0),
    hasUp: shown.some(r => r.upMin != null),
  }), [shown]);

  if (loading) return <div style={{ fontSize: 13, color: 'var(--muted)', padding: '30px 0', textAlign: 'center' }}>กำลังคำนวณจาก downtime จริง…</div>;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* ── ตัวกรอง ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={days} onChange={e => setDays(Number(e.target.value))} style={{ ...inp, width: 140 }}>
          {[7, 30, 60, 90, 180].map(d => <option key={d} value={d}>{d} วันล่าสุด</option>)}
        </select>
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

      {loadErr && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: 10, padding: '9px 12px', fontSize: 12.5 }}>⚠️ {loadErr}</div>
      )}

      {/* ── บอกให้ชัดว่าเลขนี้คืออะไร — ไม่งั้นเอาไปเทียบกับระบบส่วนกลางแล้วเถียงกัน ── */}
      <div style={{ ...card, fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
        📐 <b>นับจาก downtime ที่หน้างานบันทึกจริง</b> (ไม่ใช่ใบแจ้งซ่อม) ในช่วง {days} วันล่าสุด ·
        หยุดตามแผน (PM/เปลี่ยนรุ่น) ไม่นับเป็น "ครั้งที่เสีย" แต่หักออกจากเวลาเดินเครื่อง
        <div><b>MTTR</b> = เวลาที่ไลน์หยุดเฉลี่ยต่อครั้ง (รวมเวลารอช่าง) — เฉลี่ยเฉพาะครั้งที่ปิดแล้ว</div>
        <div><b>MTBF</b> = เวลาเดินเครื่อง ÷ จำนวนครั้งที่เสีย · <b style={{ color: '#f59e0b' }}>เวลาเดินเครื่องเป็นค่าประมาณ</b> จากชั่วโมงกะของไลน์ที่อุปกรณ์สังกัด (ยังไม่มีตัวนับรายเครื่อง)</div>
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
                <th style={{ ...th, textAlign: 'right' }}>DT รวม</th>
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
                    </td>
                    <td style={td}>
                      {meta
                        ? <span>{meta.icon} {meta.label}</span>
                        : <span style={{ color: '#f59e0b', fontWeight: 700 }} title="เลขนี้ไม่มีในทะเบียนอุปกรณ์ — บอกชนิดไม่ได้">❔ ไม่อยู่ในทะเบียน</span>}
                    </td>
                    <td style={{ ...td, color: r.lineName ? 'inherit' : 'var(--muted)' }}>{r.lineName || '—'}</td>
                    <td style={tdNum}>{r.stops}{r.plannedStops > 0 && <span style={{ color: 'var(--muted)', fontSize: 11 }}> (+{r.plannedStops} ตามแผน)</span>}</td>
                    <td style={tdNum}>{fmtDur(r.dtMin)}</td>
                    <td style={{ ...tdNum, color: '#f59e0b', fontWeight: 700 }}>{fmtDur(r.mttrMin)}</td>
                    <td style={{ ...tdNum, color: r.mtbfMin == null ? 'var(--muted)' : '#3b82f6', fontWeight: 700 }}
                        title={r.mtbfMin == null ? 'ไม่รู้เวลาเดินเครื่อง (ไม่รู้ไลน์ หรือไม่มีกะในช่วงนี้)' : 'ประมาณจากชั่วโมงกะของไลน์'}>
                      {fmtDur(r.mtbfMin)}
                    </td>
                    <td style={{ ...tdNum, color: r.availPct == null ? 'var(--muted)' : r.availPct >= 95 ? '#22c55e' : r.availPct >= 90 ? '#f59e0b' : '#ef4444' }}>
                      {r.availPct == null ? '—' : `${r.availPct}%`}
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
