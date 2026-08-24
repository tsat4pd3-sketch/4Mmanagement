/* ═══ คำขอแก้เอกสาร PE (ลูปปิด 8D → PFMEA / PFC / Control Plan) ═══
   2026-08-17 · แบบเต็ม: docs/CLOSED-LOOP-8D-PE.md

   component เดียวใช้ 2 ฝั่ง:
     mode="source" — ในโมดัล 8D/CAPA ของ /qa : เสนอ + ดูสถานะ
     mode="inbox"  — ใน /pe-docs           : PE รับเรื่อง / ออก revision / ปฏิเสธ

   ⚠️ กฎที่ห้ามแก้ย้อน:
     · ระบบ **เสนอ** เท่านั้น — ไม่มีเส้นทางไหนเขียน pe_fmea_items/pe_cp_items เองอัตโนมัติ
     · `applied` ต้องผูก `pe_doc_revisions` จริง (DB check constraint บังคับอีกชั้น)
     · ปฏิเสธต้องมีเหตุผล — auditor ถามว่า "ทำไมเคสนี้ไม่แก้เอกสาร"
     · confidence ของข้อเสนอที่ระบบเดา ต้องโชว์เสมอ ห้ามซ่อน */

import { useState, useEffect, useCallback, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from './Toast';
import { UserContext } from '../App';
import { suggestChanges, matchDocSet, LEG_META, CR_STATUS, DOC_LABEL } from '../utils/peLink';
import { todayLocal as localToday } from '../utils/dateFormat';

const btn = (bg, fg = '#08130a') => ({ padding: '5px 11px', borderRadius: 7, border: 'none', background: bg, color: fg, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' });
const ghost = { padding: '5px 11px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' };
const inputSt = { width: '100%', padding: '6px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 12 };

function Pill({ label, color, title }) {
  return <span title={title} style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 999, fontSize: 10.5, fontWeight: 800, color, background: `${color}22`, border: `1px solid ${color}66`, whiteSpace: 'nowrap' }}>{label}</span>;
}

/** แถวคำขอ 1 รายการ */
function CrRow({ cr, canDecide, onDecide, onApply }) {
  const st = CR_STATUS[cr.status] || CR_STATUS.proposed;
  const leg = LEG_META[cr.leg];
  const isSug = cr.origin === 'suggested';
  return (
    <div style={{ padding: '9px 11px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
          <Pill label={DOC_LABEL[cr.doc_type] || cr.doc_type} color="#4d9fff" />
          {leg && <Pill label={leg.short} color={leg.color} title={leg.hint} />}
          <Pill label={st.label} color={st.color} />
          {isSug && (
            <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>
              🤖 ระบบเสนอ · ความมั่นใจ {cr.confidence != null ? `${Math.round(cr.confidence * 100)}%` : '—'}
            </span>
          )}
          {cr.ref_label && <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>จาก {cr.ref_label}</span>}
        </div>
        {cr.match_note && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>{cr.match_note}</div>}
        <div style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{cr.proposal}</div>
        {cr.status === 'rejected' && cr.reject_reason && (
          <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>เหตุผลที่ไม่แก้: {cr.reject_reason}</div>
        )}
        {cr.status === 'applied' && (
          <div style={{ fontSize: 11, color: '#22c55e', marginTop: 4 }}>✓ ออก revision แล้ว{cr.decided_by ? ` · ${cr.decided_by}` : ''}</div>
        )}
      </div>
      {canDecide && (cr.status === 'proposed' || cr.status === 'accepted') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {cr.status === 'proposed' && <button style={btn('#4d9fff', '#fff')} onClick={() => onDecide(cr, 'accepted')}>รับเรื่อง</button>}
          <button style={btn('#22c55e')} onClick={() => onApply(cr)}>✅ ออก revision</button>
          <button style={ghost} onClick={() => onDecide(cr, 'rejected')}>ไม่แก้</button>
        </div>
      )}
    </div>
  );
}

export default function PeChangeRequests({
  mode = 'source',
  source = null,          // { kind, id, label, partNo, lineName, symptom, rootCause, corrective, isCustomer }
  setId = null,           // mode='inbox'
  canPropose = false,
  canDecide = false,
  onCountChange,
}) {
  const { fullName } = useContext(UserContext);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sugs, setSugs] = useState(null);      // ผลจากตัวเสนอ (ยังไม่บันทึก)
  const [picked, setPicked] = useState({});
  const [manual, setManual] = useState(null);  // ฟอร์มเพิ่มเอง
  const [applyFor, setApplyFor] = useState(null);
  const [setInfo, setSetInfo] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('pe_change_requests').select('*').order('created_at', { ascending: false });
    if (mode === 'inbox') q = q.eq('set_id', setId).in('status', ['proposed', 'accepted']);
    else q = q.eq('ref_kind', source?.kind).eq('ref_id', source?.id);
    const { data, error } = await q;
    if (error) {
      /* ยังไม่ apply migration = ตารางไม่มี → บอกให้ชัด ห้ามเงียบ */
      if (error.code === '42P01') toast.error('ยังไม่ได้ติดตั้งตาราง pe_change_requests — แจ้ง admin ให้ apply migration 20260817_pe_change_requests');
      setRows([]);
    } else setRows(data || []);
    setLoading(false);
  }, [mode, setId, source?.kind, source?.id]);

  useEffect(() => {
    if (mode === 'inbox' ? setId : source?.id) load();
    else { setRows([]); setLoading(false); }
  }, [load, mode, setId, source?.id]);

  useEffect(() => { onCountChange?.(rows.length); }, [rows.length, onCountChange]);

  /* ── 🔍 ให้ระบบหาเอกสารที่เกี่ยว (3 ขาแบบ 8D) ─────────────────────────── */
  const runSuggest = async () => {
    if (!source) return;
    setBusy(true);
    try {
      const { data: sets } = await supabase.from('pe_doc_sets').select('id, part_no, mat_no, part_name, line_name');
      const m = matchDocSet(sets || [], source.partNo, source.lineName);
      if (!m.set) {
        setSetInfo(m);
        setSugs([]);
        toast.error(m.how === 'ambiguous_line'
          ? 'ไลน์นี้มีหลายพาร์ทในระบบ — ระบุเลขพาร์ทใน CAPA ก่อน'
          : 'ยังไม่มีชุดเอกสาร PE ของพาร์ทนี้ — นำเข้าที่ /pe-docs ก่อน');
        return;
      }
      setSetInfo(m);
      const { data: procs } = await supabase.from('pe_processes').select('id, op_no, name, set_id').eq('set_id', m.set.id);
      const ids = (procs || []).map((p) => p.id);
      const [{ data: fm }, { data: cp }] = await Promise.all([
        ids.length ? supabase.from('pe_fmea_items').select('*').in('process_id', ids) : { data: [] },
        ids.length ? supabase.from('pe_cp_items').select('*').in('process_id', ids) : { data: [] },
      ]);
      /* ขา systemic: แถว FMEA ของพาร์ทอื่น (จำกัดจำนวนกันดึงทั้งฐาน) */
      const others = (sets || []).filter((s) => s.id !== m.set.id);
      let otherFmea = [];
      if (others.length) {
        const { data: op } = await supabase.from('pe_processes').select('id, op_no, set_id').in('set_id', others.map((s) => s.id));
        const map = Object.fromEntries((op || []).map((p) => [p.id, p]));
        const { data: of } = (op || []).length
          ? await supabase.from('pe_fmea_items').select('id, process_id, failure_mode').in('process_id', (op || []).map((p) => p.id)).limit(4000)
          : { data: [] };
        const label = Object.fromEntries(others.map((s) => [s.id, s.part_no]));
        otherFmea = (of || []).map((f) => ({
          ...f, set_id: map[f.process_id]?.set_id,
          _setLabel: label[map[f.process_id]?.set_id], _opNo: map[f.process_id]?.op_no,
        })).filter((f) => f.set_id);
      }
      const list = suggestChanges(
        { symptom: source.symptom, rootCause: source.rootCause, corrective: source.corrective, isCustomer: source.isCustomer },
        { set: m.set, processes: procs || [], fmeaItems: fm || [], cpItems: cp || [] },
        otherFmea,
      ).map((x, i) => ({ ...x, _k: i, set_id: x.set_id || m.set.id }));
      setSugs(list);
      setPicked(Object.fromEntries(list.map((x) => [x._k, true])));
      if (!list.length) toast.info('ไม่พบจุดที่ควรแก้จากข้อมูลที่กรอก — ลองเติม D2/D4 ให้ละเอียดขึ้น');
    } catch (e) {
      toast.error(e?.message || 'ค้นเอกสารไม่สำเร็จ');
    } finally { setBusy(false); }
  };

  const saveSuggestions = async () => {
    const chosen = (sugs || []).filter((x) => picked[x._k]);
    if (!chosen.length) { toast.error('ยังไม่ได้เลือกรายการ'); return; }
    setBusy(true);
    const payload = chosen.map((x) => ({
      ref_kind: source.kind, ref_id: source.id, ref_label: source.label || null,
      set_id: x.set_id, doc_type: x.doc_type, leg: x.leg || null,
      process_id: x.process_id || null, fmea_item_id: x.fmea_item_id || null, cp_item_id: x.cp_item_id || null,
      origin: 'suggested', confidence: x.confidence ?? null, match_note: x.match_note || null,
      proposal: x.proposal, created_by: fullName || null,
    }));
    const { error } = await supabase.from('pe_change_requests').insert(payload);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`ส่งคำขอแก้เอกสาร ${chosen.length} รายการให้ทีม PE แล้ว`);
    setSugs(null); load();
  };

  const saveManual = async () => {
    const sid = setInfo?.set?.id;
    if (!manual?.proposal?.trim()) { toast.error('กรอกสิ่งที่ต้องแก้'); return; }
    if (!sid) { toast.error('กด "🔍 หาเอกสารที่เกี่ยว" ก่อน เพื่อจับคู่ชุดเอกสาร'); return; }
    setBusy(true);
    const { error } = await supabase.from('pe_change_requests').insert({
      ref_kind: source.kind, ref_id: source.id, ref_label: source.label || null,
      set_id: sid, doc_type: manual.doc_type, leg: manual.leg || null,
      origin: 'manual', proposal: manual.proposal.trim(), created_by: fullName || null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('เพิ่มคำขอแล้ว'); setManual(null); load();
  };

  const decide = async (cr, status) => {
    let reason = null;
    if (status === 'rejected') {
      reason = window.prompt('เหตุผลที่ไม่แก้เอกสาร (auditor จะถามข้อนี้):', '');
      if (reason == null) return;
      if (!reason.trim()) { toast.error('ต้องระบุเหตุผล'); return; }
    }
    const { error } = await supabase.from('pe_change_requests')
      .update({ status, reject_reason: reason?.trim() || null, decided_by: fullName || null, decided_at: new Date().toISOString() })
      .eq('id', cr.id);
    if (error) { toast.error(error.message); return; }
    toast.success(status === 'rejected' ? 'บันทึกว่าไม่แก้ พร้อมเหตุผลแล้ว' : 'รับเรื่องแล้ว');
    load();
  };

  /* ออก revision จริง → ผูกกลับเข้า pe_doc_revisions (ref_kind/ref_id เล่าที่มาเอง) */
  const doApply = async () => {
    const a = applyFor;
    if (!a?.content?.trim()) { toast.error('กรอกสรุปการแก้ไข'); return; }
    setBusy(true);
    const { data: rev, error: e1 } = await supabase.from('pe_doc_revisions').insert({
      set_id: a.cr.set_id, doc_type: a.cr.doc_type === 'pfc' ? 'pfc' : a.cr.doc_type,
      rev_no: a.rev_no ? Number(a.rev_no) : null, rev_date: a.rev_date || null,
      content: a.content.trim(), ref_kind: a.cr.ref_kind === 'capa' ? 'ncr' : a.cr.ref_kind,
      ref_id: a.cr.ref_id, issued_by: fullName || null,
    }).select('id').single();
    if (e1) { setBusy(false); toast.error(e1.message); return; }
    const { error: e2 } = await supabase.from('pe_change_requests')
      .update({ status: 'applied', revision_id: rev.id, decided_by: fullName || null, decided_at: new Date().toISOString() })
      .eq('id', a.cr.id);
    setBusy(false);
    if (e2) { toast.error(e2.message); return; }
    toast.success('ออก revision และปิดคำขอแล้ว ✓');
    setApplyFor(null); load();
  };

  /* วันที่ revision ใช้วันที่เครื่อง (local) — ตัวกลาง utils/dateFormat.todayLocal
     (เดิมเขียนเองที่นี่ แล้ว PEDocs ซึ่งเขียนคอลัมน์ rev_date เดียวกันใช้ UTC = คนละกติกา) */
  const openApply = (cr) => setApplyFor({
    cr, rev_no: '', rev_date: localToday(),
    content: cr.proposal.split('\n')[0].replace(/^🔴\s*/, '').slice(0, 200),
  });

  const pending = rows.filter((r) => r.status === 'proposed' || r.status === 'accepted').length;

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 11px', background: 'var(--bg2)', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 12.5 }}>🔗 เอกสารที่ต้องตามแก้</b>
        {pending > 0 && <Pill label={`ค้าง ${pending}`} color="#f59e0b" />}
        {rows.length === 0 && !loading && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>ยังไม่มีรายการ</span>}
        <span style={{ flex: 1 }} />
        {mode === 'source' && canPropose && (
          <>
            <button style={ghost} disabled={busy} onClick={runSuggest} title="ให้ระบบค้น PFMEA / Control Plan ที่เกี่ยวกับอาการและสาเหตุที่กรอกไว้">
              {busy ? '⏳ กำลังค้น...' : '🔍 หาเอกสารที่เกี่ยว'}
            </button>
            <button style={ghost} onClick={() => setManual({ doc_type: 'fmea', leg: 'occurrence', proposal: '', set_id: setInfo?.set?.id || '' })}>➕ เพิ่มเอง</button>
          </>
        )}
      </div>

      {mode === 'source' && (
        <div style={{ padding: '7px 11px', fontSize: 11, color: 'var(--muted)', borderBottom: rows.length || sugs ? '1px solid var(--border)' : 'none', lineHeight: 1.6 }}>
          IATF 16949 §10.2.3/10.2.4 — แก้ปัญหาแล้ว <b>ต้องทบทวน PFMEA และ Control Plan</b> ด้วย ·
          ระบบ<b>เสนอ</b>ให้เท่านั้น ทีม PE เป็นผู้ตัดสินและออก revision
        </div>
      )}

      {/* ผลจากตัวเสนอ — ยังไม่บันทึกจนกว่าจะกดส่ง */}
      {sugs && (
        <div style={{ padding: 11, borderBottom: '1px solid var(--border)', background: 'rgba(77,159,255,0.06)' }}>
          {setInfo?.set && (
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>
              ชุดเอกสารที่จับคู่ได้: <b style={{ color: 'var(--text)' }}>{setInfo.set.part_no}</b> {setInfo.set.part_name || ''}
              {setInfo.how === 'line_name' && <span style={{ color: '#f59e0b' }}> · จับคู่จากชื่อไลน์ (ไม่ใช่เลขพาร์ท) — ตรวจให้แน่ใจ</span>}
            </div>
          )}
          {!sugs.length ? (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>ไม่พบข้อเสนอ — ลองกรอก D2 (อาการ) และ D4 (สาเหตุ) ให้ละเอียดขึ้นแล้วค้นใหม่</div>
          ) : (
            <>
              <div style={{ fontSize: 11.5, color: 'var(--text2)', marginBottom: 6 }}>
                ระบบเสนอ {sugs.length} รายการ — <b>ติ๊กเฉพาะที่เห็นว่าใช่</b> แล้วส่งให้ทีม PE (ยังไม่มีอะไรถูกแก้)
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--card)' }}>
                {sugs.map((x) => (
                  <label key={x._k} style={{ display: 'flex', gap: 8, padding: '8px 10px', borderTop: '1px solid var(--border)', cursor: 'pointer', alignItems: 'flex-start' }}>
                    <input type="checkbox" style={{ width: 'auto', marginTop: 3 }} checked={!!picked[x._k]} onChange={(e) => setPicked((p) => ({ ...p, [x._k]: e.target.checked }))} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 3 }}>
                        <Pill label={DOC_LABEL[x.doc_type]} color="#4d9fff" />
                        {LEG_META[x.leg] && <Pill label={LEG_META[x.leg].short} color={LEG_META[x.leg].color} title={LEG_META[x.leg].hint} />}
                        <span style={{ fontSize: 10.5, color: x.confidence >= 0.6 ? '#22c55e' : x.confidence > 0 ? '#f59e0b' : '#ef4444' }}>
                          {x.confidence > 0 ? `ความมั่นใจ ${Math.round(x.confidence * 100)}%` : 'ไม่พบในเอกสาร'}
                        </span>
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{x.match_note}</div>
                      <div style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{x.proposal}</div>
                    </div>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 9 }}>
                <button style={ghost} onClick={() => setSugs(null)}>ยกเลิก</button>
                <button style={btn('var(--accent)')} disabled={busy} onClick={saveSuggestions}>ส่งให้ทีม PE</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ฟอร์มเพิ่มเอง */}
      {manual && (
        <div style={{ padding: 11, borderBottom: '1px solid var(--border)', display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select style={{ ...inputSt, width: 'auto' }} value={manual.doc_type} onChange={(e) => setManual((m) => ({ ...m, doc_type: e.target.value }))}>
              {Object.entries(DOC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select style={{ ...inputSt, width: 'auto' }} value={manual.leg} onChange={(e) => setManual((m) => ({ ...m, leg: e.target.value }))}>
              {Object.entries(LEG_META).map(([k, v]) => <option key={k} value={k}>{v.short} — {v.label}</option>)}
            </select>
            {!setInfo?.set && <span style={{ fontSize: 11, color: '#f59e0b', alignSelf: 'center' }}>กด "🔍 หาเอกสารที่เกี่ยว" ก่อน เพื่อจับคู่ชุดเอกสาร</span>}
          </div>
          <textarea rows={3} style={inputSt} placeholder="ต้องแก้อะไรในเอกสาร" value={manual.proposal} onChange={(e) => setManual((m) => ({ ...m, proposal: e.target.value }))} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button style={ghost} onClick={() => setManual(null)}>ยกเลิก</button>
            <button style={btn('var(--accent)')} disabled={busy || !setInfo?.set} onClick={saveManual}>เพิ่ม</button>
          </div>
        </div>
      )}

      {loading ? <div style={{ padding: 14, fontSize: 12, color: 'var(--muted)' }}>กำลังโหลด...</div>
        : rows.map((cr) => <CrRow key={cr.id} cr={cr} canDecide={canDecide} onDecide={decide} onApply={openApply} />)}

      {/* ออก revision */}
      {applyFor && (
        <div /* ⚠️ ฟอร์มกรอกข้อมูล — ไม่ปิดจาก backdrop กันเผลอแตะแล้วข้อมูลหาย (UI-CONVENTIONS §5) */ style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: 16 }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, width: 'min(560px, 100%)' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>✅ ออก revision — {DOC_LABEL[applyFor.cr.doc_type]}</h3>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.6 }}>
              บันทึกนี้จะไปอยู่ในประวัติ revision ของชุดเอกสาร <b>พร้อมที่มา</b> ({applyFor.cr.ref_label || applyFor.cr.ref_kind}) ·
              <b> แก้เนื้อหาเอกสารจริงที่ /pe-docs เอง</b> — ระบบไม่แก้ให้อัตโนมัติ
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, marginBottom: 9 }}>
              <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>Rev. (ถ้ามี)
                <input style={inputSt} value={applyFor.rev_no} onChange={(e) => setApplyFor((a) => ({ ...a, rev_no: e.target.value }))} placeholder="เช่น 17" />
              </label>
              <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>วันที่
                <input type="date" style={inputSt} value={applyFor.rev_date} onChange={(e) => setApplyFor((a) => ({ ...a, rev_date: e.target.value }))} />
              </label>
            </div>
            <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>สรุปการแก้ไข *
              <textarea rows={3} style={inputSt} value={applyFor.content} onChange={(e) => setApplyFor((a) => ({ ...a, content: e.target.value }))} />
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button style={ghost} onClick={() => setApplyFor(null)}>ยกเลิก</button>
              <button style={btn('#22c55e')} disabled={busy} onClick={doApply}>บันทึก revision</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
