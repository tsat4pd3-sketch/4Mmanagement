/* ══════════════════════════════════════════════════════════════════════════
   ⏱ ทบทวน Cycle Time — "ระบบเสนอ วิศวกรตัดสิน"   (2026-09-18 · คำสั่ง user)

   user: *"ปกติก็ต้อง CT มาตรฐานนะ แต่ adaptive เอาไว้โชว์ให้เห็นว่า actual ที่ทำได้
           และอาจจะรอวิศวกรอนุมัติปรับ ก็จะกลายเป็น CT มาตรฐานใหม่"*

   🔴 สัญญาที่ห้ามผิด:
     · **%P หารด้วย CT มาตรฐานเสมอ** — จอนี้ไม่ไปแตะสูตร OEE เลย
     · **ระบบไม่เขียน master เอง** — ต้องกดอนุมัติ (สิทธิ์ `ct:approve` = admin/manager/engineer)
     · อนุมัติแล้วเขียนผ่าน `dr_products` ⇒ `fn_audit` บันทึกเอง ⇒ โผล่ใน `v_ct_history`
       **ห้ามเขียนประวัติซ้อนเอง**
   สูตร/เกณฑ์คัดข้อมูลอยู่ `src/utils/ctReview.js` ที่เดียว (pure + มีเทส) ห้ามคำนวณซ้ำในไฟล์นี้
   ══════════════════════════════════════════════════════════════════════════ */
import { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import { supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import { toast } from './Toast';
import { checkWrite } from '../utils/dbWrite';
import LineSelect from './LineSelect';
import { summarizeObservedCt, FLAG_TEXT, SAMPLE_RULES } from '../utils/ctReview';

const DAYS_BACK = 60;
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' };
const th = { textAlign: 'left', fontSize: 11, color: 'var(--muted)', fontWeight: 700, padding: '6px 8px', whiteSpace: 'nowrap' };
const td = { fontSize: 12.5, padding: '6px 8px', borderTop: '1px solid var(--border)' };
const fmt = v => v == null ? '—' : (Math.round(v * 10) / 10).toLocaleString();

export default function CtReview({ lines = [] }) {
  const { role, lineId, sections, fullName } = useContext(UserContext);
  const canApprove = can('ct', 'approve', role);

  const [line, setLine]       = useState('');
  const [rows, setRows]       = useState([]);      // ผลสรุปต่อ MAT
  const [queue, setQueue]     = useState([]);      // ข้อเสนอที่รออนุมัติ
  const [loading, setLoading] = useState(false);
  const [busy, setBusy]       = useState('');
  const [err, setErr]         = useState('');
  const [span, setSpan]       = useState(null);

  /* ── คิวข้อเสนอ (ไม่ขึ้นกับไลน์ที่เลือก — วิศวกรต้องเห็นทุกใบที่ค้าง) ── */
  const loadQueue = useCallback(async () => {
    const { data, error } = await supabaseDR.from('ct_proposals')
      .select('id, mat_no, product_name, line_name, ct_standard, ct_observed, sample_orders, dropped_orders, p25, p75, flags, sample_from, sample_to, created_by_name, created_at')
      .eq('status', 'proposed').order('created_at', { ascending: false }).limit(200);
    if (error) { setErr('โหลดคิวข้อเสนอไม่สำเร็จ: ' + error.message); return; }
    setQueue(data || []);
  }, []);
  useEffect(() => { loadQueue(); }, [loadQueue]);

  /* ── คำนวณ CT ที่สังเกตได้ของไลน์ที่เลือก ──
     ⚠️ egress: select เฉพาะคอลัมน์ที่ใช้จริง (กฎเหล็ก 11 ใน CLAUDE.md) */
  useEffect(() => {
    if (!line) { setRows([]); setSpan(null); return; }
    let alive = true;                       // กัน stale-response race (กฎเหล็ก 4)
    (async () => {
      setLoading(true); setErr('');
      const since = new Date(Date.now() - DAYS_BACK * 86400000).toISOString().slice(0, 10);
      const [sRes, pRes, bRes] = await Promise.all([
        supabaseDR.from('production_sessions')
          .select('id, work_date, shift, start_time, end_time')
          .eq('line_name', line).eq('status', 'closed').gte('work_date', since)
          .order('work_date', { ascending: false }).limit(400),
        supabaseDR.from('dr_products').select('mat_no, name, cycle_time_sec, process_type').eq('line_name', line),
        supabaseDR.from('break_policies').select('shift, start_time, duration_min, process_type, ot_scope'),
      ]);
      if (!alive) return;
      const bad = [sRes, pRes, bRes].find(r => r.error);
      if (bad) { setErr('โหลดข้อมูลไม่สำเร็จ: ' + bad.error.message); setLoading(false); return; }

      const sessions = sRes.data || [];
      if (!sessions.length) { setRows([]); setSpan(null); setLoading(false); return; }
      const ids = sessions.map(s => s.id);

      const [oRes, dRes] = await Promise.all([
        supabaseDR.from('prod_orders')
          .select('session_id, mat_no, status, qty, qty_ok, opened_at, confirmed_at')
          .in('session_id', ids).eq('status', 'confirmed').limit(5000),
        supabaseDR.from('downtime_logs')
          .select('session_id, started_at, ended_at, duration_min')
          .in('session_id', ids).limit(5000),
      ]);
      if (!alive) return;
      if (oRes.error || dRes.error) {
        setErr('โหลดใบผลิต/downtime ไม่สำเร็จ: ' + (oRes.error || dRes.error).message);
        setLoading(false); return;
      }

      const sessById = {}; sessions.forEach(s => { sessById[s.id] = s; });
      const dtBy = {}; (dRes.data || []).forEach(d => (dtBy[d.session_id] ||= []).push(d));
      const byMat = {};
      (oRes.data || []).forEach(o => {
        const s = sessById[o.session_id]; if (!s || !o.mat_no) return;
        (byMat[o.mat_no] ||= []).push({ order: o, session: s, downtimes: dtBy[o.session_id] || [] });
      });

      const prodBy = {}; (pRes.data || []).forEach(p => { prodBy[p.mat_no] = p; });
      const out = Object.entries(byMat).map(([matNo, rs]) => {
        const p = prodBy[matNo] || {};
        const sum = summarizeObservedCt(matNo, rs, {
          ctStd: Number(p.cycle_time_sec) || 0,
          breakPolicies: bRes.data || [],
          processType: p.process_type || null,
        });
        return { ...sum, name: p.name || '', nRaw: rs.length };
      }).filter(r => r.nRaw > 0)
        .sort((a, b) => (Math.abs(b.gapPct ?? -1) - Math.abs(a.gapPct ?? -1)));

      const ds = sessions.map(s => s.work_date).sort();
      setSpan({ from: ds[0], to: ds[ds.length - 1], sessions: sessions.length });
      setRows(out);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [line]);

  const inQueue = useMemo(() => new Set(queue.map(q => q.mat_no)), [queue]);

  /* ── เสนอปรับ (ยังไม่แตะ master) ── */
  const propose = async (r) => {
    setBusy(r.matNo);
    const ok = checkWrite(await supabaseDR.from('ct_proposals').insert({
      mat_no: r.matNo, product_name: r.name || null, line_name: line,
      ct_standard: r.ctStd, ct_observed: Math.round(r.p50 * 10) / 10,
      sample_orders: r.n, dropped_orders: r.nDropped,
      p25: r.p25 == null ? null : Math.round(r.p25 * 10) / 10,
      p75: r.p75 == null ? null : Math.round(r.p75 * 10) / 10,
      sample_from: span?.from || null, sample_to: span?.to || null,
      flags: r.flags, created_by_name: fullName || null,
    }), 'เสนอปรับ CT');
    setBusy('');
    if (ok) { toast.success(`เสนอปรับ CT ของ ${r.matNo} เข้าคิวแล้ว — รอวิศวกรอนุมัติ`); loadQueue(); }
  };

  /* ── อนุมัติ = เขียน master จริง (ทางเดียวที่ CT มาตรฐานเปลี่ยน) ── */
  const approve = async (q) => {
    if (!window.confirm(
      `อนุมัติปรับ CT ของ ${q.mat_no}\n\n`
      + `${q.ct_standard ?? '—'} → ${q.ct_observed} วินาที/ชิ้น\n\n`
      + 'CT มาตรฐานจะถูกเปลี่ยนทันที และ %P ของกะถัดไปจะคิดจากค่าใหม่\n'
      + '(กะที่ปิดไปแล้วไม่กระทบ — ค่าที่ stamp ไว้ไม่ถูกคำนวณใหม่)')) return;
    setBusy(q.id);
    // 🔴 RLS ปฏิเสธ UPDATE = 0 แถวเงียบ (กฎเหล็ก 2) ⇒ ต้อง .select() แล้วนับแถว
    const upd = await supabaseDR.from('dr_products')
      .update({ cycle_time_sec: q.ct_observed }).eq('mat_no', q.mat_no).select('mat_no');
    if (!checkWrite(upd, 'เขียน CT มาตรฐาน')) { setBusy(''); return; }
    if (!upd.data?.length) {
      toast.error(`ไม่พบสินค้า ${q.mat_no} ใน Product Master — CT ไม่ถูกเปลี่ยน`);
      setBusy(''); return;
    }
    const ok = checkWrite(await supabaseDR.from('ct_proposals').update({
      status: 'accepted', decided_by: fullName || null, decided_at: new Date().toISOString(),
    }).eq('id', q.id).select('id'), 'ปิดใบข้อเสนอ');
    setBusy('');
    if (ok) {
      toast.success(`อนุมัติแล้ว — CT ของ ${q.mat_no} เป็น ${q.ct_observed} วินาที/ชิ้น (ดูประวัติได้ที่ v_ct_history)`);
      loadQueue(); setLine(l => l);
    }
  };

  const reject = async (q) => {
    const reason = window.prompt(`ปฏิเสธข้อเสนอของ ${q.mat_no} — เหตุผล (บังคับ)`);
    if (reason == null) return;
    if (!reason.trim()) { toast.error('ต้องระบุเหตุผล'); return; }
    setBusy(q.id);
    const ok = checkWrite(await supabaseDR.from('ct_proposals').update({
      status: 'rejected', reject_reason: reason.trim(),
      decided_by: fullName || null, decided_at: new Date().toISOString(),
    }).eq('id', q.id).select('id'), 'ปฏิเสธข้อเสนอ');
    setBusy('');
    if (ok) { toast.info('ปฏิเสธแล้ว'); loadQueue(); }
  };

  const gapColor = g => g == null ? 'var(--muted)'
    : Math.abs(g) > SAMPLE_RULES.BIG_GAP_PCT ? '#f59e0b' : (Math.abs(g) < 5 ? 'var(--muted)' : 'var(--text)');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ ...card, borderColor: 'var(--accent)' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)', marginBottom: 4 }}>
          ⏱ ทบทวน Cycle Time — ระบบเสนอ วิศวกรตัดสิน
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.6 }}>
          เทียบ <b>CT มาตรฐาน</b> (ที่ใช้คิด %P) กับ <b>CT ที่สังเกตได้จริง</b> จากใบผลิตย้อนหลัง {DAYS_BACK} วัน ·
          <b> ระบบไม่แก้ CT เอง</b> — ต้องมีคนกดอนุมัติเท่านั้น และ %P ยังหารด้วย CT มาตรฐานเสมอ<br />
          คัดเฉพาะใบที่เชื่อได้: ปิดใบครบ · ≥ {SAMPLE_RULES.MIN_QTY_PER_ORDER} ชิ้น · หัก downtime + เวลาพักแล้ว ·
          ตัดใบที่ได้ผลเป็นไปไม่ได้ทิ้ง (มักมาจาก<b>ลง downtime เกินจริง</b>) · ใช้<b>มัธยฐาน</b>ไม่ใช่ค่าเฉลี่ย
        </div>
      </div>

      {queue.length > 0 && (
        <div style={{ ...card, borderColor: '#f59e0b' }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: '#f59e0b', marginBottom: 8 }}>
            📋 รออนุมัติ {queue.length} รายการ {!canApprove && <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· บัญชีคุณไม่มีสิทธิ์อนุมัติ (ต้องเป็นวิศวกร/ผู้จัดการ)</span>}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead><tr>
                <th style={th}>MAT.NO</th><th style={th}>ชิ้นงาน</th><th style={th}>ไลน์</th>
                <th style={{ ...th, textAlign: 'right' }}>มาตรฐาน</th>
                <th style={{ ...th, textAlign: 'right' }}>เสนอ</th>
                <th style={{ ...th, textAlign: 'right' }}>อ้างอิง</th>
                <th style={th}>ผู้เสนอ</th><th style={th} />
              </tr></thead>
              <tbody>
                {queue.map(q => (
                  <tr key={q.id}>
                    <td style={{ ...td, fontWeight: 700 }}>{q.mat_no}</td>
                    <td style={{ ...td, color: 'var(--text2)' }}>{q.product_name || '—'}</td>
                    <td style={{ ...td, color: 'var(--text2)' }}>{q.line_name || '—'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmt(q.ct_standard)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: 'var(--accent)' }}>{fmt(q.ct_observed)}</td>
                    <td style={{ ...td, textAlign: 'right', fontSize: 11.5, color: 'var(--text2)' }}>
                      {q.sample_orders} ใบ{q.dropped_orders ? ` · ตัดทิ้ง ${q.dropped_orders}` : ''}<br />
                      <span style={{ color: 'var(--muted)' }}>{fmt(q.p25)}–{fmt(q.p75)} วิ</span>
                    </td>
                    <td style={{ ...td, fontSize: 11.5, color: 'var(--text2)' }}>{q.created_by_name || '—'}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {canApprove && (
                        <>
                          <button className="tbtn" disabled={busy === q.id} onClick={() => approve(q)}
                            style={{ background: 'var(--accent)', color: '#fff', border: 'none', marginRight: 6 }}>
                            ✓ อนุมัติ
                          </button>
                          <button className="tbtn" disabled={busy === q.id} onClick={() => reject(q)}>✕ ปฏิเสธ</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>ไลน์</span>
          <LineSelect lines={lines} value={line} onChange={setLine}
            role={role} lineId={lineId} sections={sections} style={{ width: 260 }} />
          {span && (
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              จาก {span.sessions} กะที่ปิดแล้ว · {span.from} → {span.to}
            </span>
          )}
        </div>

        {err && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>⚠ {err}</div>}
        {!line && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>เลือกไลน์เพื่อดูว่าพาร์ทไหน CT ควรทบทวน</div>}
        {line && loading && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>⏳ กำลังคำนวณจากใบผลิตจริง…</div>}
        {line && !loading && !err && rows.length === 0 &&
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>ไลน์นี้ยังไม่มีใบผลิตที่ปิดครบในช่วง {DAYS_BACK} วัน</div>}

        {rows.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
              <thead><tr>
                <th style={th}>MAT.NO</th><th style={th}>ชิ้นงาน</th>
                <th style={{ ...th, textAlign: 'right' }}>CT มาตรฐาน</th>
                <th style={{ ...th, textAlign: 'right' }}>สังเกตได้ (กลาง)</th>
                <th style={{ ...th, textAlign: 'right' }}>กระจาย p25–p75</th>
                <th style={{ ...th, textAlign: 'right' }}>ใบที่ใช้</th>
                <th style={{ ...th, textAlign: 'right' }}>ต่าง</th>
                <th style={th}>ข้อสังเกต</th><th style={th} />
              </tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.matNo}>
                    <td style={{ ...td, fontWeight: 700 }}>{r.matNo}</td>
                    <td style={{ ...td, color: 'var(--text2)', maxWidth: 230 }}>{r.name || '—'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{r.ctStd == null
                      ? <span style={{ color: '#f59e0b' }}>ยังไม่ตั้ง</span> : fmt(r.ctStd)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmt(r.p50)}</td>
                    <td style={{ ...td, textAlign: 'right', fontSize: 11.5, color: 'var(--muted)' }}>{fmt(r.p25)}–{fmt(r.p75)}</td>
                    <td style={{ ...td, textAlign: 'right', fontSize: 11.5 }}>
                      {r.n}{r.nDropped ? <span style={{ color: '#f59e0b' }}> (ตัด {r.nDropped})</span> : ''}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: gapColor(r.gapPct) }}>
                      {r.gapPct == null ? '—' : `${r.gapPct > 0 ? '+' : ''}${Math.round(r.gapPct)}%`}
                    </td>
                    <td style={{ ...td, fontSize: 11, color: 'var(--text2)', maxWidth: 300 }}>
                      {r.flags.map(f => FLAG_TEXT[f]).filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {inQueue.has(r.matNo)
                        ? <span style={{ fontSize: 11, color: '#f59e0b' }}>อยู่ในคิวแล้ว</span>
                        : r.canPropose
                          ? <button className="tbtn" disabled={busy === r.matNo} onClick={() => propose(r)}>เสนอปรับ</button>
                          : <span style={{ fontSize: 11, color: 'var(--muted)' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
