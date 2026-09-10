/**
 * 📜 ประวัติ order เข้าระบบ — แท็บใน /customer-demand
 *
 * ที่มา (user 2026-09-09): *"สิ่งที่อัพโหลดไป ให้มี log และ tab เข้าไปดูด้วยสิ รวมถึงงาน add order"*
 *
 * ตอบคำถามเดียว: **"ยอดนี้มาจากไหน ใครทำ เมื่อไหร่"** → รวม 3 ทางเข้าในไทม์ไลน์เดียว
 * (📄 EDI 862/830 · 📥 e-SMART ที่ลูกค้ายืนยัน · ➕ คีย์มือ order ด่วน)
 *
 * ⚠️ อ่านอย่างเดียว ไม่มีปุ่มเขียนข้อมูล → ไม่ต้อง seed permission key ใหม่ (ใช้ page:/customer-demand เดิม)
 * ⚠️ การรวม/กรอง/สรุป อยู่ `src/utils/orderIntakeLog.js` (pure · เทส 12 เคส) — ห้ามคำนวณซ้ำในไฟล์นี้
 * ⚠️ แหล่งไหนโหลดไม่สำเร็จ **ต้องขึ้นแถบแดงบอก ห้ามเงียบ** — ลิสต์ที่ขาดแหล่งไปเงียบๆ
 *    จะถูกอ่านว่า "ไม่มีใครอัพ" ทั้งที่แค่คิวรีล้ม/ตารางยังไม่ apply
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabaseDR } from '../supabaseClient';
import { fileNameStamp } from '../utils/pullSignal';
import { INTAKE_KINDS, mergeIntakeLog, intakeSummary, filterIntake } from '../utils/orderIntakeLog';

const card = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: 16,
};
const inputSt = {
  padding: '7px 10px', borderRadius: 8, fontSize: 12, background: 'var(--bg2)',
  border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--font-body)',
};
const chip = (on, color) => ({
  padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 800, cursor: 'pointer',
  fontFamily: 'var(--font-body)', whiteSpace: 'nowrap',
  background: on ? `${color}22` : 'var(--bg2)', color: on ? color : 'var(--text2)',
  border: `1px solid ${on ? color : 'var(--border)'}`,
});
const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
const pad2 = (n) => String(n).padStart(2, '0');
const dstr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return dstr(d); };
const whenLabel = (v) => {
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return '—';
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

const PAGE = 40;   // แสดงทีละ 40 รายการ — ห้ามตัดข้อมูลเงียบ ต้องมีปุ่ม "แสดงอีก"

export default function OrderIntakeLog({ shipToMap, custLabel }) {
  const [from, setFrom] = useState(daysAgo(14));
  const [to, setTo] = useState(dstr(new Date()));
  const [kind, setKind] = useState('all');
  const [shipTo, setShipTo] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [errs, setErrs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState(null);        // batch_id ที่กางดูรายละเอียด

  const load = useCallback(async () => {
    setLoading(true);
    // ขอบบนเป็นวันถัดไปตอนเที่ยงคืน เพื่อให้รวมทั้งวันของ `to` (uploaded_at เป็น timestamptz)
    const lo = `${from}T00:00:00`;
    const hiD = new Date(`${to}T00:00:00`); hiD.setDate(hiD.getDate() + 1);
    const hi = `${dstr(hiD)}T00:00:00`;
    const [pull, edi, man] = await Promise.all([
      supabaseDR.from('customer_pull_batches').select('*')
        .gte('uploaded_at', lo).lt('uploaded_at', hi).order('uploaded_at', { ascending: false }).limit(500),
      supabaseDR.from('demand_upload_batches').select('*')
        .gte('uploaded_at', lo).lt('uploaded_at', hi).order('uploaded_at', { ascending: false }).limit(500),
      supabaseDR.from('customer_shipping_orders')
        .select('id, customer, mat_no, customer_part_no, part_name, qty, due_date, ship_time, status, created_at, created_by_name')
        .eq('source', 'manual').gte('created_at', lo).lt('created_at', hi)
        .order('created_at', { ascending: false }).limit(500),
    ]);
    // ⚠️ ห้ามกลืน error — บอกทีละแหล่งว่าอันไหนหาย (ตารางใหม่ยังไม่ apply = 42P01 · คอลัมน์ = 42703)
    const e = [];
    if (pull.error) e.push(`e-SMART: ${pull.error.message}`);
    if (edi.error) e.push(`EDI: ${edi.error.message}`);
    let manRows = man.data;
    if (man.error) {
      // ยังไม่มีคอลัมน์ created_by_name → ถอยไปดึงแบบเดิม (log ยังใช้ได้ แค่ไม่รู้ว่าใครคีย์)
      const retry = await supabaseDR.from('customer_shipping_orders')
        .select('id, customer, mat_no, customer_part_no, part_name, qty, due_date, ship_time, status, created_at')
        .eq('source', 'manual').gte('created_at', lo).lt('created_at', hi)
        .order('created_at', { ascending: false }).limit(500);
      manRows = retry.data;
      if (retry.error) e.push(`คีย์มือ: ${retry.error.message}`);
      else e.push('คีย์มือ: ยังไม่ได้ apply migration — ไม่รู้ว่าใครเป็นคนคีย์ (ใบใหม่จะเก็บชื่อให้เอง)');
    }
    setErrs(e);
    setRows(mergeIntakeLog({ pullBatches: pull.data, ediBatches: edi.data, manualOrders: manRows }));
    setLoading(false);
    setLimit(PAGE);
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => filterIntake(rows, { kind, shipTo, q }), [rows, kind, shipTo, q]);
  const sum = useMemo(() => intakeSummary(shown), [shown]);
  const hidden = shown.length - Math.min(limit, shown.length);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={card}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* ⚠️ input ใน flex row ต้องกำหนด width เอง (index.css ตั้ง input{width:100%}) */}
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...inputSt, width: 150 }} />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>ถึง</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...inputSt, width: 150 }} />
          <select value={shipTo} onChange={e => setShipTo(e.target.value)} style={{ ...inputSt, width: 190 }}>
            <option value="">— ทุกลูกค้า —</option>
            {Object.keys(shipToMap || {}).sort().map(c => (
              <option key={c} value={c}>{custLabel ? custLabel(c) : c}</option>
            ))}
          </select>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 ค้นชื่อไฟล์ / MAT / คนทำ"
            style={{ ...inputSt, width: 230, flex: '1 1 200px', minWidth: 0 }} />
          <button onClick={load} style={{ ...inputSt, cursor: 'pointer', fontWeight: 700, width: 'auto' }}>↻ โหลดใหม่</button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          <button onClick={() => setKind('all')} style={chip(kind === 'all', 'var(--accent)')}>ทั้งหมด ({sum.total})</button>
          {Object.entries(INTAKE_KINDS).map(([k, m]) => (
            <button key={k} onClick={() => setKind(k)} style={chip(kind === k, m.color)}>{m.label} ({sum[k] || 0})</button>
          ))}
        </div>
        {sum.esmart > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>
            ผลจาก e-SMART ในช่วงนี้ — อัพเดท <b style={{ color: '#22c55e' }}>{sum.ordersUpdated}</b> ใบ ·
            สร้างใหม่ <b style={{ color: '#0ea5e9' }}>{sum.ordersCreated}</b> ใบ
            {sum.ordersSkipped > 0 && <> · <b style={{ color: '#f59e0b' }}>{sum.ordersSkipped}</b> รายการที่ไม่ได้แตะ (ทำไปแล้ว/จับคู่ไม่ได้)</>}
          </div>
        )}
      </div>

      {errs.map((m, i) => (
        <div key={i} style={{ ...card, padding: '9px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', fontSize: 12 }}>
          🔴 โหลดไม่ครบ — {m}
        </div>
      ))}

      {loading && <div style={{ ...card, fontSize: 12, color: 'var(--text2)' }}>⏳ กำลังโหลด…</div>}

      {!loading && !shown.length && (
        <div style={{ ...card, fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>
          ไม่มีรายการในช่วงนี้{rows.length > 0 && ` — มี ${rows.length} รายการแต่ถูกตัวกรองซ่อนไว้`}
        </div>
      )}

      {/* ⚠️ ให้ทั้งหน้าเลื่อนตามปกติ ห้ามครอบลิสต์ด้วยกล่อง scroll ซ้อน (UI-CONVENTIONS §6.8) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shown.slice(0, limit).map(e => (
          <IntakeCard key={e.key} e={e} custLabel={custLabel}
            open={open === e.key} onToggle={() => setOpen(open === e.key ? null : e.key)} />
        ))}
      </div>

      {hidden > 0 && (
        <button onClick={() => setLimit(l => l + PAGE)}
          style={{ ...inputSt, cursor: 'pointer', fontWeight: 800, padding: '10px', width: '100%' }}>
          ▼ แสดงอีก {Math.min(PAGE, hidden)} (ทั้งหมด {shown.length})
        </button>
      )}
    </div>
  );
}

function IntakeCard({ e, custLabel, open, onToggle }) {
  const m = INTAKE_KINDS[e.kind] || {};
  const canOpen = e.kind === 'esmart' && e.ref?.batch_id;
  return (
    <div style={{
      ...card, padding: 12, borderLeft: `4px solid ${m.color}`,
      background: 'var(--card)', backgroundImage: `linear-gradient(${m.color}0a, ${m.color}0a)`,
    }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: m.color, whiteSpace: 'nowrap' }}>{m.label}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', flex: '1 1 220px', minWidth: 0, wordBreak: 'break-word' }}>
          {e.title}
        </span>
        {/* ⭐ โชว์ 2 เวลาคู่กัน (user 2026-09-10): **เวลาที่ลูกค้าออกไฟล์** (จากชื่อไฟล์ ISO) กับ
            **เวลาที่อัพเข้าระบบ** ⇒ ทวนสอบได้ว่าไฟล์เป็นของรอบไหนจริง และช้าไปกี่นาที
            (เวลาออกไฟล์คือไม้บรรทัดที่ตัวอ่านใช้ตัดสินวันที่ด้วย — ดู fileNameStamp) */}
        <span style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap', textAlign: 'right' }}>
          {(() => {
            const made = e.kind === 'esmart' ? fileNameStamp(e.title) : null;
            if (!made) return null;
            const lagMin = Math.round((new Date(e.at).getTime() - made.getTime()) / 60000);
            const late = Number.isFinite(lagMin) && lagMin > 120;   // อัพช้ากว่า 2 ชม. = ข้อมูลเก่าแล้ว
            return (
              <>🕐 ออกไฟล์ <b style={{ color: 'var(--text)' }}>{whenLabel(made)}</b>
                {Number.isFinite(lagMin) && lagMin >= 0 && (
                  <span style={{ color: late ? '#f59e0b' : 'var(--muted)' }}> (อัพหลังจากนั้น {lagMin} นาที)</span>
                )}
                <br />
              </>
            );
          })()}
          📥 อัพเข้าระบบ {whenLabel(e.at)} · {e.by || <span style={{ color: 'var(--muted)' }}>ไม่ระบุผู้ทำ</span>}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
        {e.ship_to && <span style={{ fontSize: 12, fontWeight: 700, color: '#0ea5e9' }}>{custLabel ? custLabel(e.ship_to) : e.ship_to}</span>}
        {e.detail && <span style={{ fontSize: 12, color: 'var(--text2)' }}>{e.detail}</span>}
        {e.kind === 'esmart' && (
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>
            📄 {fmt(e.stats.rows)} แถว{e.stats.fresh !== e.stats.rows && ` (ใหม่ ${fmt(e.stats.fresh)})`}
            {' · '}✏️ อัพเดท <b style={{ color: '#22c55e' }}>{fmt(e.stats.updated)}</b>
            {' · '}➕ สร้าง <b style={{ color: '#0ea5e9' }}>{fmt(e.stats.created)}</b>
            {e.stats.skipped > 0 && <> · <span style={{ color: '#f59e0b' }}>🔒 ไม่แตะ {fmt(e.stats.skipped)}</span></>}
          </span>
        )}
        {e.kind === 'edi' && <span style={{ fontSize: 12, color: 'var(--text2)' }}>📄 {fmt(e.stats.rows)} แถว</span>}
        {e.kind === 'manual' && (
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>
            <b style={{ color: 'var(--text)' }}>{fmt(e.stats.qty)}</b> ชิ้น · สถานะ {e.ref?.status || '—'}
          </span>
        )}
        {canOpen && (
          <button onClick={onToggle} style={{ ...chip(open, m.color), marginLeft: 'auto', fontSize: 11 }}>
            {open ? '▲ ปิดรายละเอียด' : '▼ ดูรายการที่ลูกค้าดึง'}
          </button>
        )}
      </div>
      {open && canOpen && <PullBatchDetail batchId={e.ref.batch_id} />}
    </div>
  );
}

/** รายการดึงจริงของไฟล์นั้น (จาก customer_pull_signals) — โหลดตอนกางเท่านั้น */
function PullBatchDetail({ batchId }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    supabaseDR.from('customer_pull_signals')
      .select('customer_part_no, part_name, mat_no, pulled_at, containers, qty_per_container, qty, dock_code')
      .eq('batch_id', batchId).order('customer_part_no').order('pulled_at').limit(500)
      .then(({ data, error }) => { if (!alive) return; setRows(data || []); if (error) setErr(error.message); });
    return () => { alive = false; };
  }, [batchId]);

  if (err) return <div style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>🔴 อ่านรายการไม่ได้: {err}</div>;
  if (!rows) return <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>⏳ กำลังโหลด…</div>;
  if (!rows.length) {
    return (
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
        ไม่มีแถวผูกกับไฟล์นี้ — ทุกแถวเคยนำเข้าจากไฟล์ก่อนหน้าแล้ว (ระบบไม่นับซ้ำ)
      </div>
    );
  }
  const th = { padding: '5px 8px', fontSize: 11, fontWeight: 800, color: 'var(--text2)', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
  const td = { padding: '4px 8px', fontSize: 12, borderBottom: '1px solid var(--border)' };
  const tdR = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  return (
    <div style={{ overflowX: 'auto', marginTop: 10, border: '1px solid var(--border)', borderRadius: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
        <thead><tr style={{ background: 'var(--bg2)' }}>
          <th style={th}>เลขพาร์ทลูกค้า</th><th style={th}>MAT</th><th style={th}>เวลาที่ลูกค้าดึง</th>
          <th style={{ ...th, textAlign: 'right' }}>ภาชนะ</th>
          <th style={{ ...th, textAlign: 'right' }}>ต่อภาชนะ</th>
          <th style={{ ...th, textAlign: 'right' }}>รวม</th>
          <th style={th}>Dock</th>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ ...td, fontWeight: 700 }}>{r.customer_part_no}
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>{r.part_name || ''}</div></td>
              <td style={{ ...td, fontFamily: 'monospace', color: r.mat_no ? '#0ea5e9' : 'var(--muted)' }}>{r.mat_no || '—'}</td>
              <td style={td}>{whenLabel(r.pulled_at)}</td>
              <td style={tdR}>{fmt(r.containers)}</td>
              <td style={tdR}>{fmt(r.qty_per_container)}</td>
              <td style={{ ...tdR, fontWeight: 800 }}>{fmt(r.qty)}</td>
              <td style={td}>{r.dock_code || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
