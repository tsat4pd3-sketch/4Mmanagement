import { useState, useEffect, useMemo, useCallback } from 'react';
import { AUDIT_ACTIONS, AUDIT_SKIP_FIELDS, tableLabel, fieldLabel, rowLabel } from '../utils/auditLabels';

/* ── AuditLogViewer — จอกลางดูประวัติ "ใครแก้อะไร" (2026-08-19) ────────────────────
   ใช้ร่วมทั้งหน้า /audit-log (ทั้งระบบ) และแท็บย่อยในหน้างาน (จำกัดเฉพาะตารางของตัวเอง)
   **ห้ามเขียนจอดู audit ใหม่ที่อื่น** — ต่อยอดตัวนี้

   props:
     client     — supabase (Main) หรือ supabaseDR (DR) · audit_log มีคนละชุดต่อ project
     tables     — array ชื่อตาราง จำกัดขอบเขต (ไม่ส่ง = ทุกตารางที่มีประวัติ)
     limit      — จำนวนรายการล่าสุด (default 300)
     intro      — ข้อความอธิบายด้านบน
     fmtValue   — ฟังก์ชันแปลงค่าเฉพาะทาง (f, v) => string | undefined (undefined = ใช้ค่า default)
     showTable  — โชว์ตัวกรองตาราง (default true)

   ⚠️ โหลดไม่สำเร็จต้องบอกว่า "โหลดไม่ได้" ห้ามแสดงเป็น "ไม่มีประวัติ" — คนละความหมาย  */

const fmtDT = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const inp = { padding: '6px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 12.5 };

export default function AuditLogViewer({ client, tables, limit = 300, intro, fmtValue, showTable = true, reloadKey }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState('');
  const [fTable, setFTable]   = useState('');
  const [fActor, setFActor]   = useState('');
  const [q, setQ]             = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    let qb = client.from('audit_log').select('*').order('changed_at', { ascending: false }).limit(limit);
    if (tables?.length) qb = qb.in('table_name', tables);
    const { data, error } = await qb;
    if (error) { setErr(error.message); setRows([]); }
    else setRows(data || []);
    setLoading(false);
  }, [client, limit, tables?.join(',')]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { let alive = true; load().then(() => { if (!alive) return; }); return () => { alive = false; }; }, [load, reloadKey]);

  // ตัวเลือกตาราง/คนแก้ สร้างจากข้อมูลจริงที่โหลดมา — ไม่ hardcode ให้ตกหล่น
  const tableOpts = useMemo(() => [...new Set(rows.map(r => r.table_name))].sort((a, b) => tableLabel(a).localeCompare(tableLabel(b), 'th')), [rows]);
  const actorOpts = useMemo(() => [...new Set(rows.map(r => r.actor).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'th')), [rows]);

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return rows.filter(r => {
      if (fTable && r.table_name !== fTable) return false;
      if (fActor && r.actor !== fActor) return false;
      if (!kw) return true;
      return `${rowLabel(r)} ${tableLabel(r.table_name)} ${r.actor || ''}`.toLowerCase().includes(kw);
    });
  }, [rows, fTable, fActor, q]);

  const val = (f, v) => {
    const custom = fmtValue?.(f, v);
    if (custom !== undefined) return custom;
    if (v === null || v === undefined || v === '') return '(ว่าง)';
    if (typeof v === 'boolean') return v ? 'ใช่' : 'ไม่';
    if (Array.isArray(v)) return v.length ? v.join(', ') : '(ว่าง)';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  return (
    <div>
      {intro && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 7, padding: '8px 11px' }}>
          {intro}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        {showTable && (
          <select value={fTable} onChange={e => setFTable(e.target.value)} style={{ ...inp, width: 230 }}>
            <option value="">ทุกตาราง ({tableOpts.length})</option>
            {tableOpts.map(t => <option key={t} value={t}>{tableLabel(t)}</option>)}
          </select>
        )}
        <select value={fActor} onChange={e => setFActor(e.target.value)} style={{ ...inp, width: 180 }}>
          <option value="">ทุกคน</option>
          {actorOpts.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหาชื่อรายการ / คน" style={{ ...inp, width: 200 }} />
        <button onClick={load} style={{ ...inp, cursor: 'pointer', fontWeight: 700 }}>↻ รีเฟรช</button>
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          {shown.length} รายการ{rows.length >= limit ? ` (แสดง ${limit} ล่าสุด — เก่ากว่านี้ยังมีอีก)` : ''}
        </span>
      </div>

      {loading && <div style={{ color: 'var(--muted)', padding: 16, fontSize: 13 }}>กำลังโหลด…</div>}

      {/* โหลดไม่ได้ ≠ ไม่มีประวัติ — ต้องแยกให้ขาด */}
      {!!err && (
        <div style={{ color: '#f59e0b', padding: 12, fontSize: 12.5, background: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b', borderRadius: 8 }}>
          ⚠️ โหลดประวัติไม่ได้: {err}
          <br />(ถ้าเป็นเพราะตาราง <code>audit_log</code> ไม่มี — ต้อง apply migration <code>20260724_audit_log_main.sql</code> / <code>_dr.sql</code> ก่อน)
        </div>
      )}

      {!loading && !err && !shown.length && (
        <div style={{ color: 'var(--muted)', padding: 16, fontSize: 13 }}>
          {rows.length ? 'ไม่มีรายการตรงกับตัวกรอง' : 'ยังไม่มีประวัติการแก้ไข'}
        </div>
      )}

      <div style={{ display: 'grid', gap: 6 }}>{shown.map(r => {
        const act = AUDIT_ACTIONS[r.action] || { t: r.action, c: 'var(--text2)' };
        const fields = (r.changed_fields || []).filter(f => !AUDIT_SKIP_FIELDS.has(f));
        return (
          <div key={r.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderLeft: `3px solid ${act.c}`, borderRadius: 8, padding: '9px 11px' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 12.5 }}>
              <b style={{ color: act.c }}>{act.t}</b>
              <span style={{ color: 'var(--muted)' }}>{tableLabel(r.table_name)}</span>
              <b style={{ color: 'var(--text)' }}>{rowLabel(r)}</b>
              <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 11.5 }}>
                👤 {r.actor || '— (ระบบ/migration)'} · {fmtDT(r.changed_at)}
              </span>
            </div>
            {r.action === 'UPDATE' && !!fields.length && (
              <div style={{ marginTop: 5, display: 'grid', gap: 2 }}>
                {fields.map(f => (
                  <div key={f} style={{ fontSize: 11.5, color: 'var(--text2)' }}>
                    <span style={{ color: 'var(--muted)' }}>{fieldLabel(f)}:</span>{' '}
                    <span style={{ textDecoration: 'line-through', opacity: 0.65 }}>{val(f, r.old_data?.[f])}</span>
                    {' → '}<b>{val(f, r.new_data?.[f])}</b>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}</div>
    </div>
  );
}
