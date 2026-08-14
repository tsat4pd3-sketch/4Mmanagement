import { useState, useEffect, useContext, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import PageHeader from '../components/PageHeader';
import useTabParam from '../utils/useTabParam';
import { fmtDate } from '../utils/dateFormat';
import PeExcelImportModal from '../components/PeExcelImportModal';

/* ═══ PE Core Tools — Process Flow / PFMEA / Control Plan (2026-08-13) ═══
   โมดูลของทีม Process Engineering — โครงถอดจากเอกสารจริง TSAT (PFC/FMEA/CNP-P703-01):
   กระดูกสันหลัง = "เลข Process (OP)" ใช้ร่วมทั้ง 3 เอกสาร → เก็บข้อมูลชุดเดียว แสดง 3 มุมมอง
   ตารางอยู่ Main project (เอกสารควบคุม authenticated) · อ้างเครื่อง/พาร์ทฝั่ง DR เป็น text (machine_no/mat_no)
   เฟส 1 = โครง + CRUD + RPN + revision history · เฟสถัดไป = ปุ่ม "ชน FMEA" จาก defect/NCR/MO + import Excel */

/* รูป product/drawing + รูปประกอบ OP — bucket pe-images (Main) · บีบ 2560px/q0.9 (tier drawing ต้องซูมอ่านได้)
   GIF ส่งดิบ ≤2MB ตามกติกา storage (วาดลง canvas = การขยับหายเงียบ) */
function resizeImage(file, maxPx = 2560, quality = 0.9) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('บีบรูปไม่สำเร็จ'))), 'image/jpeg', quality);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('อ่านไฟล์รูปไม่ได้'));
    img.src = URL.createObjectURL(file);
  });
}
const peImagePath = (url) => { const p = url?.split('/pe-images/')[1]; return p ? decodeURIComponent(p) : null; };
const removePeImage = (url) => { const p = peImagePath(url); if (p) supabase.storage.from('pe-images').remove([p]).catch(() => {}); };

const KIND_META = {
  process:       { icon: '🔧', label: 'Process' },
  incoming_insp: { icon: '📥', label: 'Incoming Insp.' },
  storage:       { icon: '📦', label: 'Storage' },
  transport:     { icon: '🚚', label: 'Transport' },
  inspection:    { icon: '🔍', label: 'Inspection' },
  rework:        { icon: '♻️', label: 'Rework' },
  warehouse:     { icon: '🏬', label: 'Warehouse' },
  delivery:      { icon: '📤', label: 'Delivery' },
};
const DOC_TYPES = [
  { key: 'pfc',  label: 'Process Flow Chart' },
  { key: 'fmea', label: 'PFMEA' },
  { key: 'cp',   label: 'Control Plan' },
];
const rpnOf = (it) => (it.severity && it.occurrence && it.detection) ? it.severity * it.occurrence * it.detection : null;
const rpnNewOf = (it) => (it.new_severity && it.new_occurrence && it.new_detection) ? it.new_severity * it.new_occurrence * it.new_detection : null;
const rpnColor = (v) => (v == null ? 'var(--muted)' : v >= 100 ? '#ef4444' : v >= 70 ? '#f59e0b' : '#22c55e');
const classChip = (c) => c ? (
  <span style={{ fontSize: 10, fontWeight: 800, borderRadius: 5, padding: '1px 6px',
    background: c === 'CC' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
    color: c === 'CC' ? '#ef4444' : '#f59e0b' }}>{c}</span>
) : null;

const lbl = { fontSize: 12, fontWeight: 700, color: 'var(--muted)' };
const thSt = { padding: '7px 9px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap' };
const tdSt = { padding: '7px 9px', fontSize: 12, color: 'var(--text2)', borderTop: '1px solid var(--border)', verticalAlign: 'top' };
const btnSm = { padding: '3px 9px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 11, fontWeight: 700, cursor: 'pointer' };
const btnPrim = { padding: '7px 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#08130a', fontWeight: 800, fontSize: 13, cursor: 'pointer' };
const multiline = (t) => (t || '').split('\n').filter(Boolean).map((l, i) => <div key={i}>{l}</div>);

export default function PEDocs() {
  const { role, fullName } = useContext(UserContext);
  const canEdit = can('pe', 'edit', role);
  const canApprove = can('pe', 'approve', role);

  const [sets, setSets] = useState([]);
  const [procs, setProcs] = useState([]);       // ของ set ที่เลือก
  const [fmea, setFmea] = useState([]);
  const [cp, setCp] = useState([]);
  const [revs, setRevs] = useState([]);
  const [machines, setMachines] = useState([]); // DR — datalist เครื่อง
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  const [sp, setSp] = useSearchParams();
  const setId = sp.get('set') || '';
  const [tab, setTab] = useTabParam(['flow', 'fmea', 'cp', 'rev'], 'flow');
  const [procFilter, setProcFilter] = useState('');   // process_id ที่โฟกัสในแท็บ FMEA/CP ('' = ทุก OP)
  const [rpnOnly, setRpnOnly] = useState(false);      // FMEA: เฉพาะ RPN ≥ 100

  const [setModal, setSetModal] = useState(null);
  const [procModal, setProcModal] = useState(null);
  const [fmeaModal, setFmeaModal] = useState(null);
  const [cpModal, setCpModal] = useState(null);
  const [revModal, setRevModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [setImgFile, setSetImgFile] = useState(null);    // รูปรออัปโหลดของ modal ชุดเอกสาร
  const [importOpen, setImportOpen] = useState(false);   // 📥 นำเข้าจากไฟล์ Excel
  const [procImgFile, setProcImgFile] = useState(null);  // รูปรออัปโหลดของ modal OP
  const [imgView, setImgView] = useState(null);          // lightbox ดูรูปเต็ม

  const loadSets = useCallback(async () => {
    setLoading(true);
    const [{ data: s }, { data: mc }, { data: ln }] = await Promise.all([
      supabase.from('pe_doc_sets').select('*').order('part_no'),
      supabaseDR.from('machines').select('machine_no, machine_name, line_name').eq('is_active', true).order('machine_no'),
      supabase.from('production_lines').select('id, name, parent_line_name').order('name'),
    ]);
    setSets(s || []);
    setMachines(mc || []);
    setLines(ln || []);
    setLoading(false);
  }, []);
  useEffect(() => { loadSets(); }, [loadSets]);

  const loadDetail = useCallback(async (id) => {
    if (!id) { setProcs([]); setFmea([]); setCp([]); setRevs([]); return; }
    setDetailLoading(true);
    const { data: p } = await supabase.from('pe_processes').select('*').eq('set_id', id).order('seq').order('op_no');
    const ids = (p || []).map(x => x.id);
    const [{ data: f }, { data: c }, { data: r }] = await Promise.all([
      ids.length ? supabase.from('pe_fmea_items').select('*').in('process_id', ids).order('seq').order('created_at') : { data: [] },
      ids.length ? supabase.from('pe_cp_items').select('*').in('process_id', ids).order('char_no').order('seq') : { data: [] },
      // เรียงด้วยวันที่ก่อน (cover จริงไม่ระบุเลข rev รายแถว — seed ใส่ null) แล้วค่อย rev_no
      supabase.from('pe_doc_revisions').select('*').eq('set_id', id).order('rev_date', { ascending: false, nullsFirst: false }).order('rev_no', { ascending: false, nullsFirst: false }),
    ]);
    setProcs(p || []); setFmea(f || []); setCp(c || []); setRevs(r || []);
    setDetailLoading(false);
  }, []);
  useEffect(() => { loadDetail(setId); }, [setId, loadDetail]);

  const curSet = sets.find(s => s.id === setId) || null;
  const procById = useMemo(() => Object.fromEntries(procs.map(p => [p.id, p])), [procs]);
  const pickSet = (id) => { const next = new URLSearchParams(sp); if (id) next.set('set', id); else next.delete('set'); setSp(next); };

  /* ── save helpers (ทุกตัวเช็ค error ตามกฎ supabase-js คืน {error} ไม่ throw) — คืน row ที่บันทึก (null = fail) ── */
  const saveRow = async (table, form, patch, after) => {
    setSaving(true);
    const q = form.id
      ? supabase.from(table).update(patch).eq('id', form.id).select('*').single()
      : supabase.from(table).insert(patch).select('*').single();
    const { data, error } = await q;
    setSaving(false);
    if (error) { toast.error(error.code === '23505' ? 'เลข OP นี้มีอยู่แล้วในชุดเอกสาร' : error.message); return null; }
    toast.success('บันทึกแล้ว');
    after?.();
    return data;
  };
  const deleteRow = async (table, id, label, after, imgUrl) => {
    if (!window.confirm(`ลบ${label}?`)) return;
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    if (imgUrl) removePeImage(imgUrl);   // ลบไฟล์หลัง DB สำเร็จ (กฎ storage — best-effort)
    toast.success('ลบแล้ว');
    after?.();
  };
  // อัปโหลดรูป → คืน public URL (GIF ส่งดิบ ≤2MB · อื่นบีบ 2560/q0.9) — เรียกหลัง DB row มี id แล้ว
  const uploadPeImage = async (path, file) => {
    let blob = file;
    if (file.type === 'image/gif') {
      if (file.size > 2 * 1024 * 1024) { toast.error('GIF ต้องไม่เกิน 2MB'); return null; }
    } else {
      blob = await resizeImage(file).catch(e => { toast.error(e.message); return null; });
      if (!blob) return null;
    }
    const ext = file.type === 'image/gif' ? 'gif' : 'jpg';
    const full = `${path}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('pe-images').upload(full, blob, { upsert: true, contentType: file.type === 'image/gif' ? 'image/gif' : 'image/jpeg' });
    if (error) { toast.error(`อัปโหลดรูปไม่สำเร็จ: ${error.message}`); return null; }
    return supabase.storage.from('pe-images').getPublicUrl(full).data.publicUrl;
  };
  // แนบรูปให้ row หลัง save: อัปโหลด → update image_url → ลบไฟล์เก่า (หลัง DB สำเร็จเท่านั้น)
  const attachImage = async (table, row, file, pathPrefix) => {
    if (!file || !row) return;
    const url = await uploadPeImage(pathPrefix, file);
    if (!url) return;
    const { error } = await supabase.from(table).update({ image_url: url }).eq('id', row.id);
    if (error) { toast.error(error.message); return; }
    if (row.image_url) removePeImage(row.image_url);
  };

  /* ── สรุป FMEA ทั้งชุด (top RPN) ── */
  // seq ของ item เริ่มนับใหม่ทุก OP → ต้องเรียงด้วย (ลำดับ OP, seq) ฝั่ง client ไม่งั้นหลาย OP สลับแถวปนกัน
  const bySeqInOp = useCallback((a, b) => {
    const pa = procById[a.process_id], pb = procById[b.process_id];
    return (Number(pa?.seq) || 0) - (Number(pb?.seq) || 0) || (a.seq || 0) - (b.seq || 0) || (a.char_no || 0) - (b.char_no || 0);
  }, [procById]);
  const fmeaView = useMemo(() => {
    let list = fmea.map(it => ({ ...it, rpn: rpnOf(it), rpnNew: rpnNewOf(it) }));
    if (procFilter) list = list.filter(it => it.process_id === procFilter);
    if (rpnOnly) list = list.filter(it => (it.rpn || 0) >= 100);
    return list.sort(bySeqInOp);
  }, [fmea, procFilter, rpnOnly, bySeqInOp]);
  const cpView = useMemo(() => (procFilter ? cp.filter(it => it.process_id === procFilter) : [...cp]).sort(bySeqInOp), [cp, procFilter, bySeqInOp]);
  const highRpn = useMemo(() => fmea.map(it => ({ ...it, rpn: rpnOf(it) })).filter(it => (it.rpn || 0) >= 100).length, [fmea]);

  if (loading) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>กำลังโหลด...</div>;

  const lineOpts = lines.filter(l => l.parent_line_name || !lines.some(x => x.parent_line_name === l.name));

  return (
    <div style={{ padding: 'clamp(12px,3vw,28px)', maxWidth: 'min(97vw, 1600px)', margin: '0 auto' }}>
      <PageHeader icon="📐" title="PE Core Tools — Flow / PFMEA / Control Plan"
        sub="เอกสารวิศวกรรมกระบวนการ ยึดเลข Process (OP) ร่วมกันทั้ง 3 เอกสาร — ข้อมูลชุดเดียว 3 มุมมอง"
        tabs={curSet ? [
          { key: 'flow', label: `🗺️ Flow (${procs.length} OP)` },
          { key: 'fmea', label: `⚠️ PFMEA (${fmea.length})${highRpn ? ` · 🔴${highRpn}` : ''}` },
          { key: 'cp',   label: `✅ Control Plan (${cp.length})` },
          { key: 'rev',  label: `🕘 Revisions (${revs.length})` },
        ] : undefined}
        tab={tab} onTab={setTab} />

      {/* ── เลือกชุดเอกสาร (1 พาร์ท = 1 ชุด PFC+FMEA+CP) ── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <select value={setId} onChange={e => pickSet(e.target.value)} style={{ width: 'auto', minWidth: 280, padding: '8px 10px', fontSize: 13, borderRadius: 8, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
          <option value="">— เลือกพาร์ท/ชุดเอกสาร —</option>
          {sets.map(s => <option key={s.id} value={s.id}>{s.part_no} · {s.part_name || ''} {s.status === 'obsolete' ? '(obsolete)' : ''}</option>)}
        </select>
        {curSet?.image_url && (
          <img src={curSet.image_url} alt="product" onClick={() => setImgView(curSet.image_url)}
            style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', cursor: 'zoom-in' }} />
        )}
        {curSet && (
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            {curSet.model ? `Model ${curSet.model} · ` : ''}{curSet.line_name ? `🏭 ${curSet.line_name} · ` : ''}
            {curSet.doc_no_pfc || '—'} / {curSet.doc_no_fmea || '—'} / {curSet.doc_no_cp || '—'}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {canEdit && <button style={btnSm} onClick={() => setImportOpen(true)} title="อัพโหลดไฟล์ Excel ฟอร์ม TSAT ที่มีอยู่แล้ว ไม่ต้องพิมพ์ใหม่">📥 นำเข้า Excel</button>}
        {canEdit && curSet && <button style={btnSm} onClick={() => { setSetImgFile(null); setSetModal({ ...curSet }); }}>✏️ แก้ข้อมูลชุด</button>}
        {canEdit && <button style={btnPrim} onClick={() => { setSetImgFile(null); setSetModal({ part_no: '', part_name: '', mat_no: '', model: '', customer: '', line_name: '', doc_no_pfc: '', doc_no_fmea: '', doc_no_cp: '', status: 'active', remark: '' }); }}>➕ ชุดเอกสารใหม่</button>}
      </div>

      {!curSet ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--muted)', fontSize: 13 }}>
          เลือกพาร์ทด้านบน{canEdit ? ' หรือกด "➕ ชุดเอกสารใหม่" เพื่อเริ่มพาร์ทแรก' : ''} — 1 ชุด = PFC + PFMEA + Control Plan ของพาร์ทนั้น
        </div>
      ) : detailLoading ? (
        <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 30 }}>กำลังโหลด...</div>
      ) : (
        <>
          {/* ── ตัวกรอง OP (ใช้ร่วมแท็บ FMEA/CP) ── */}
          {(tab === 'fmea' || tab === 'cp') && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <select value={procFilter} onChange={e => setProcFilter(e.target.value)} style={{ width: 'auto', padding: '6px 10px', fontSize: 12, borderRadius: 8, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                <option value="">ทุก OP</option>
                {procs.map(p => <option key={p.id} value={p.id}>OP {p.op_no} · {p.name}</option>)}
              </select>
              {tab === 'fmea' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text2)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={rpnOnly} onChange={e => setRpnOnly(e.target.checked)} />
                  เฉพาะ RPN ≥ 100
                </label>
              )}
            </div>
          )}

          {/* ══ แท็บ Flow ══ */}
          {tab === 'flow' && (
            <div>
              {canEdit && (
                <button style={{ ...btnPrim, marginBottom: 10 }} onClick={() => { setProcImgFile(null); setProcModal({ set_id: curSet.id, op_no: '', seq: (procs.length ? Math.max(...procs.map(p => Number(p.seq) || 0)) + 10 : 10), name: '', kind: 'process', machine_no: '', line_name: curSet.line_name || '', child_parts: '', connector: '', special_class: '', sccaf_no: '', remark: '' }); }}>➕ เพิ่ม Process (OP)</button>
              )}
              <div className="table-sticky" style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                  <thead style={{ background: 'var(--bg2)' }}>
                    <tr>{['OP', 'ชนิด', 'ชื่อกระบวนการ', 'รูป', 'เครื่อง', 'ไลน์/พื้นที่', 'Child part / Nut', 'CC/SC', 'เชื่อม', 'FMEA', 'CP', ''].map((h, i) => <th key={i} style={thSt}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {procs.length === 0 && <tr><td colSpan={12} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>ยังไม่มี process — เริ่มจากเพิ่ม OP ตามผัง flow (10, 20, ... หรือ 100.1)</td></tr>}
                    {procs.map(p => {
                      const km = KIND_META[p.kind] || KIND_META.process;
                      const nf = fmea.filter(f => f.process_id === p.id).length;
                      const nc = cp.filter(c => c.process_id === p.id).length;
                      return (
                        <tr key={p.id}>
                          <td style={{ ...tdSt, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>{p.op_no}</td>
                          <td style={tdSt}>{km.icon} {km.label}</td>
                          <td style={{ ...tdSt, fontWeight: 700, color: 'var(--text)' }}>{p.name}{p.remark ? <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>{p.remark}</div> : null}</td>
                          <td style={tdSt}>{p.image_url
                            ? <img src={p.image_url} alt="" loading="lazy" onClick={() => setImgView(p.image_url)} style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', cursor: 'zoom-in' }} />
                            : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                          <td style={{ ...tdSt, fontFamily: 'monospace' }}>{p.machine_no || '—'}</td>
                          <td style={tdSt}>{p.line_name || '—'}</td>
                          <td style={{ ...tdSt, fontSize: 11 }}>{multiline(p.child_parts)}</td>
                          <td style={tdSt}>{classChip(p.special_class)}{p.sccaf_no ? <div style={{ fontSize: 10, color: 'var(--muted)' }}>SCCAF {p.sccaf_no}</div> : null}</td>
                          <td style={{ ...tdSt, fontWeight: 700 }}>{p.connector || ''}</td>
                          <td style={tdSt}><button style={{ ...btnSm, color: nf ? 'var(--accent)' : 'var(--muted)' }} onClick={() => { setProcFilter(p.id); setTab('fmea'); }}>{nf} แถว</button></td>
                          <td style={tdSt}><button style={{ ...btnSm, color: nc ? 'var(--accent)' : 'var(--muted)' }} onClick={() => { setProcFilter(p.id); setTab('cp'); }}>{nc} จุด</button></td>
                          <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>
                            {canEdit && <>
                              <button style={btnSm} onClick={() => { setProcImgFile(null); setProcModal({ ...p }); }}>✏️</button>{' '}
                              <button style={btnSm} onClick={() => deleteRow('pe_processes', p.id, ` OP ${p.op_no} (FMEA/CP ของ OP นี้จะถูกลบด้วย)`, () => loadDetail(setId), p.image_url)}>🗑</button>
                            </>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ══ แท็บ PFMEA ══ */}
          {tab === 'fmea' && (
            <div>
              {canEdit && (
                <button style={{ ...btnPrim, marginBottom: 10 }} disabled={!procs.length}
                  onClick={() => setFmeaModal({ process_id: procFilter || procs[0]?.id, seq: 0, requirement: '', failure_mode: '', effects: '', severity: '', classification: '', causes: '', prevention: '', occurrence: '', detection_ctrl: '', detection: '', recommended_action: '', responsibility: '', target_date: '', action_taken: '', new_severity: '', new_occurrence: '', new_detection: '' })}>
                  ➕ เพิ่ม Failure Mode
                </button>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {fmeaView.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>ยังไม่มีแถว FMEA{rpnOnly ? ' ที่ RPN ≥ 100' : ''}</div>}
                {fmeaView.map(it => {
                  const p = procById[it.process_id];
                  return (
                    <div key={it.id} style={{ background: 'var(--card)', border: `1px solid ${(it.rpn || 0) >= 100 ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`, borderRadius: 10, padding: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, fontWeight: 800, background: 'rgba(77,159,255,0.13)', color: '#4d9fff', borderRadius: 5, padding: '2px 7px' }}>OP {p?.op_no} {p?.name}</span>
                        {it.item_function && <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--bg3)', color: 'var(--text2)', borderRadius: 5, padding: '2px 7px' }}>{it.item_function}</span>}
                        {classChip(it.classification)}
                        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{it.failure_mode}</span>
                        <span style={{ flex: 1 }} />
                        <span title="S × O × D" style={{ fontSize: 13, fontWeight: 800, color: rpnColor(it.rpn) }}>
                          RPN {it.rpn ?? '—'}{it.rpnNew != null && <span style={{ color: rpnColor(it.rpnNew) }}> → {it.rpnNew}</span>}
                        </span>
                        {canEdit && <>
                          <button style={btnSm} onClick={() => setFmeaModal({ ...it, target_date: it.target_date || '' })}>✏️</button>
                          <button style={btnSm} onClick={() => deleteRow('pe_fmea_items', it.id, 'แถว FMEA นี้', () => loadDetail(setId))}>🗑</button>
                        </>}
                      </div>
                      <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(230px,100%), 1fr))', gap: 10, marginTop: 8, fontSize: 11, color: 'var(--text2)' }}>
                        <div><b style={lbl}>Requirement</b>{multiline(it.requirement) || '—'}</div>
                        <div><b style={lbl}>Effects</b>{multiline(it.effects)}<div style={{ marginTop: 2 }}>S = <b style={{ color: 'var(--text)' }}>{it.severity ?? '—'}</b></div></div>
                        <div><b style={lbl}>Causes</b>{multiline(it.causes)}<div style={{ marginTop: 2 }}>O = <b style={{ color: 'var(--text)' }}>{it.occurrence ?? '—'}</b></div></div>
                        <div><b style={lbl}>Prevention</b>{multiline(it.prevention)}</div>
                        <div><b style={lbl}>Detection</b>{multiline(it.detection_ctrl)}<div style={{ marginTop: 2 }}>D = <b style={{ color: 'var(--text)' }}>{it.detection ?? '—'}</b></div></div>
                        {(it.recommended_action || it.action_taken) && (
                          <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: 8 }}>
                            <b style={lbl}>Action</b>{multiline(it.recommended_action)}
                            {it.responsibility && <div style={{ color: 'var(--muted)' }}>👤 {it.responsibility}{it.target_date ? ` · เป้า ${fmtDate(it.target_date)}` : ''}</div>}
                            {it.action_taken && <div style={{ marginTop: 4, color: '#22c55e' }}>✔ {it.action_taken}</div>}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ══ แท็บ Control Plan ══ */}
          {tab === 'cp' && (
            <div>
              {canEdit && (
                <button style={{ ...btnPrim, marginBottom: 10 }} disabled={!procs.length}
                  onClick={() => setCpModal({ process_id: procFilter || procs[0]?.id, char_no: (cpView.length ? Math.max(...cpView.map(c => c.char_no || 0)) + 1 : 1), seq: 0, product_char: '', process_char: '', special_class: '', person: '', spec: '', method: '', sample_size: '', frequency: '', control_method: '', reaction_plan: '' })}>
                  ➕ เพิ่มจุดควบคุม
                </button>
              )}
              <div className="table-sticky" style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
                  <thead style={{ background: 'var(--bg2)' }}>
                    <tr>{['OP', 'No.', 'Characteristics (Product / Process)', 'CC/SC', 'ผู้คุม', 'Spec/Tolerance', 'วิธีวัด', 'Sample', 'ความถี่', 'Control method', 'Reaction plan', ''].map((h, i) => <th key={i} style={thSt}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {cpView.length === 0 && <tr><td colSpan={12} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>ยังไม่มีจุดควบคุม</td></tr>}
                    {cpView.map(it => {
                      const p = procById[it.process_id];
                      return (
                        <tr key={it.id}>
                          <td style={{ ...tdSt, fontFamily: 'monospace', fontWeight: 800, color: 'var(--text)' }}>
                            {p?.op_no}
                            {it.sub_op && <div style={{ fontFamily: 'inherit', fontSize: 10, fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{it.sub_op}</div>}
                          </td>
                          <td style={tdSt}>{it.char_no ?? '—'}</td>
                          <td style={tdSt}>
                            {it.product_char && <div style={{ fontWeight: 700, color: 'var(--text)' }}>{it.product_char}</div>}
                            {it.process_char && <div style={{ color: 'var(--muted)' }}>⚙ {it.process_char}</div>}
                          </td>
                          <td style={tdSt}>{classChip(it.special_class)}</td>
                          <td style={tdSt}>{it.person || '—'}</td>
                          <td style={{ ...tdSt, fontSize: 11 }}>{multiline(it.spec)}</td>
                          <td style={{ ...tdSt, fontSize: 11 }}>{multiline(it.method)}</td>
                          <td style={tdSt}>{it.sample_size || '—'}</td>
                          <td style={tdSt}>{it.frequency || '—'}</td>
                          <td style={{ ...tdSt, fontSize: 11 }}>{multiline(it.control_method)}</td>
                          <td style={{ ...tdSt, fontSize: 11 }}>{multiline(it.reaction_plan)}</td>
                          <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>
                            {canEdit && <>
                              <button style={btnSm} onClick={() => setCpModal({ ...it })}>✏️</button>{' '}
                              <button style={btnSm} onClick={() => deleteRow('pe_cp_items', it.id, 'จุดควบคุมนี้', () => loadDetail(setId))}>🗑</button>
                            </>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ══ แท็บ Revisions ══ */}
          {tab === 'rev' && (
            <div>
              {canApprove && (
                <button style={{ ...btnPrim, marginBottom: 10 }}
                  onClick={() => setRevModal({ set_id: curSet.id, doc_type: 'fmea', rev_no: (Math.max(0, ...revs.filter(r => r.doc_type === 'fmea').map(r => r.rev_no || 0)) + 1), rev_date: new Date().toISOString().slice(0, 10), suffix: curSet.part_no, ecn_no: '', content: '', ref_kind: '', ref_id: '', issued_by: fullName || '', checked_by: '', approved_by: '' })}>
                  ➕ ออก Revision ใหม่
                </button>
              )}
              <div className="table-sticky" style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                  <thead style={{ background: 'var(--bg2)' }}>
                    <tr>{['เอกสาร', 'Rev', 'วันที่', 'Suffix (Part no.)', 'ECN', 'เนื้อหาการแก้ไข', 'ต้นเหตุ', 'ออก/ตรวจ/รับรอง', ''].map((h, i) => <th key={i} style={thSt}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {revs.length === 0 && <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>ยังไม่มีประวัติ revision</td></tr>}
                    {revs.map(r => (
                      <tr key={r.id}>
                        <td style={{ ...tdSt, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>{DOC_TYPES.find(d => d.key === r.doc_type)?.label || r.doc_type}</td>
                        <td style={{ ...tdSt, fontWeight: 800 }}>{r.rev_no ?? '—'}</td>
                        <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>{r.rev_date ? fmtDate(r.rev_date) : '—'}</td>
                        <td style={{ ...tdSt, fontFamily: 'monospace' }}>{r.suffix || '—'}</td>
                        <td style={{ ...tdSt, fontFamily: 'monospace' }}>{r.ecn_no || '—'}</td>
                        <td style={tdSt}>{multiline(r.content)}</td>
                        <td style={{ ...tdSt, fontSize: 11 }}>{r.ref_kind ? `${r.ref_kind}${r.ref_id ? ` · ${r.ref_id}` : ''}` : '—'}</td>
                        <td style={{ ...tdSt, fontSize: 11 }}>{[r.issued_by, r.checked_by, r.approved_by].filter(Boolean).join(' / ') || '—'}</td>
                        <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>
                          {canApprove && <>
                            <button style={btnSm} onClick={() => setRevModal({ ...r, rev_date: r.rev_date || '' })}>✏️</button>{' '}
                            <button style={btnSm} onClick={() => deleteRow('pe_doc_revisions', r.id, `revision ${r.rev_no ?? ''}`, () => loadDetail(setId))}>🗑</button>
                          </>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ══ modal: ชุดเอกสาร ══ */}
      {setModal && (
        <div className="overlay"><div className="modal" style={{ width: 'min(640px, 95vw)', maxHeight: '90vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{setModal.id ? '✏️ แก้ข้อมูลชุดเอกสาร' : '➕ ชุดเอกสารใหม่ (1 พาร์ท)'}</h3>
            <button onClick={() => setSetModal(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
          </div>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={lbl}>Part No. (ลูกค้า) *<input value={setModal.part_no} onChange={e => setSetModal({ ...setModal, part_no: e.target.value })} placeholder="MB3B-16E060-CH" style={{ marginTop: 4, fontFamily: 'monospace' }} /></label>
            <label style={lbl}>MAT SAP<input value={setModal.mat_no || ''} onChange={e => setSetModal({ ...setModal, mat_no: e.target.value })} placeholder="เลขภายใน (โยงข้อมูลผลิต)" style={{ marginTop: 4, fontFamily: 'monospace' }} /></label>
            <label style={{ ...lbl, gridColumn: '1 / -1' }}>Part Name<input value={setModal.part_name || ''} onChange={e => setSetModal({ ...setModal, part_name: e.target.value })} placeholder="REINF ASY FRT FNDR INR BDY RH" style={{ marginTop: 4 }} /></label>
            <label style={lbl}>Model<input value={setModal.model || ''} onChange={e => setSetModal({ ...setModal, model: e.target.value })} placeholder="P703" style={{ marginTop: 4 }} /></label>
            <label style={lbl}>Customer<input value={setModal.customer || ''} onChange={e => setSetModal({ ...setModal, customer: e.target.value })} placeholder="FORD" style={{ marginTop: 4 }} /></label>
            <label style={lbl}>ไลน์หลักที่ผลิต
              <select value={setModal.line_name || ''} onChange={e => setSetModal({ ...setModal, line_name: e.target.value })} style={{ marginTop: 4 }}>
                <option value="">— ไม่ระบุ —</option>
                {lineOpts.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
              </select>
            </label>
            <label style={lbl}>สถานะ
              <select value={setModal.status} onChange={e => setSetModal({ ...setModal, status: e.target.value })} style={{ marginTop: 4 }}>
                <option value="active">active</option><option value="obsolete">obsolete</option>
              </select>
            </label>
            <label style={lbl}>Doc No. PFC<input value={setModal.doc_no_pfc || ''} onChange={e => setSetModal({ ...setModal, doc_no_pfc: e.target.value })} placeholder="PFC-P703-01" style={{ marginTop: 4 }} /></label>
            <label style={lbl}>Doc No. FMEA<input value={setModal.doc_no_fmea || ''} onChange={e => setSetModal({ ...setModal, doc_no_fmea: e.target.value })} placeholder="FMEA-P703-01" style={{ marginTop: 4 }} /></label>
            <label style={lbl}>Doc No. Control Plan<input value={setModal.doc_no_cp || ''} onChange={e => setSetModal({ ...setModal, doc_no_cp: e.target.value })} placeholder="CNP-P703-01" style={{ marginTop: 4 }} /></label>
            <label style={{ ...lbl, gridColumn: '1 / -1' }}>หมายเหตุ<input value={setModal.remark || ''} onChange={e => setSetModal({ ...setModal, remark: e.target.value })} style={{ marginTop: 4 }} /></label>
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={lbl}>รูป Product / Drawing</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                {(setImgFile || setModal.image_url) && (
                  <img src={setImgFile ? URL.createObjectURL(setImgFile) : setModal.image_url} alt=""
                    style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                )}
                <input type="file" accept="image/*" onChange={e => { setSetImgFile(e.target.files?.[0] || null); e.target.value = ''; }} style={{ fontSize: 11, width: 'auto' }} />
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button style={btnSm} onClick={() => setSetModal(null)}>ยกเลิก</button>
            <button style={btnPrim} disabled={saving} onClick={async () => {
              if (!setModal.part_no?.trim()) { toast.error('กรอก Part No. ก่อน'); return; }
              const patch = {
                part_no: setModal.part_no.trim(), mat_no: setModal.mat_no?.trim() || null,
                part_name: setModal.part_name?.trim() || null, model: setModal.model?.trim() || null,
                customer: setModal.customer?.trim() || null, line_name: setModal.line_name || null,
                doc_no_pfc: setModal.doc_no_pfc?.trim() || null, doc_no_fmea: setModal.doc_no_fmea?.trim() || null,
                doc_no_cp: setModal.doc_no_cp?.trim() || null, status: setModal.status, remark: setModal.remark?.trim() || null,
              };
              if (!setModal.id) patch.created_by_name = fullName || null;
              const row = await saveRow('pe_doc_sets', setModal, patch, null);
              if (row) {
                await attachImage('pe_doc_sets', row, setImgFile, `set/${row.id}/product`);
                const { data } = await supabase.from('pe_doc_sets').select('*').order('part_no');
                setSets(data || []);
                if (!setModal.id) pickSet(row.id);
                setSetModal(null); setSetImgFile(null);
              }
            }}>{saving ? 'กำลังบันทึก...' : '💾 บันทึก'}</button>
          </div>
        </div></div>
      )}

      {/* ══ modal: นำเข้าจากไฟล์ Excel (ฟอร์ม TSAT ที่มีอยู่แล้ว) ══ */}
      {importOpen && (
        <PeExcelImportModal sets={sets} currentSetId={setId}
          onClose={() => setImportOpen(false)}
          onDone={async (sid) => {
            setImportOpen(false);
            const { data } = await supabase.from('pe_doc_sets').select('*').order('part_no');
            setSets(data || []);
            pickSet(sid);
          }} />
      )}

      {/* ══ modal: process (OP) ══ */}
      {procModal && (
        <div className="overlay"><div className="modal" style={{ width: 'min(640px, 95vw)', maxHeight: '90vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{procModal.id ? `✏️ แก้ OP ${procModal.op_no}` : '➕ เพิ่ม Process (OP)'}</h3>
            <button onClick={() => setProcModal(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
          </div>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={lbl}>เลข OP *<input value={procModal.op_no} onChange={e => setProcModal({ ...procModal, op_no: e.target.value })} placeholder="130 หรือ 100.8" style={{ marginTop: 4, fontFamily: 'monospace' }} /></label>
            <label style={lbl}>ลำดับ (เรียงผัง)<input type="number" step="any" value={procModal.seq} onChange={e => setProcModal({ ...procModal, seq: e.target.value })} style={{ marginTop: 4 }} /></label>
            <label style={{ ...lbl, gridColumn: '1 / -1' }}>ชื่อกระบวนการ *<input value={procModal.name} onChange={e => setProcModal({ ...procModal, name: e.target.value })} placeholder="PROJECTION WELD NUT" style={{ marginTop: 4 }} /></label>
            <label style={lbl}>ชนิด
              <select value={procModal.kind} onChange={e => setProcModal({ ...procModal, kind: e.target.value })} style={{ marginTop: 4 }}>
                {Object.entries(KIND_META).map(([k, m]) => <option key={k} value={k}>{m.icon} {m.label}</option>)}
              </select>
            </label>
            <label style={lbl}>เครื่องจักร (M/C No.)
              <input list="pe-machines" value={procModal.machine_no || ''} onChange={e => setProcModal({ ...procModal, machine_no: e.target.value })} placeholder="SP-82" style={{ marginTop: 4, fontFamily: 'monospace' }} />
              <datalist id="pe-machines">{machines.map(m => <option key={m.machine_no} value={m.machine_no}>{m.machine_name || ''} · {m.line_name || ''}</option>)}</datalist>
            </label>
            <label style={lbl}>ไลน์/พื้นที่
              <select value={procModal.line_name || ''} onChange={e => setProcModal({ ...procModal, line_name: e.target.value })} style={{ marginTop: 4 }}>
                <option value="">— ไม่ระบุ —</option>
                {lineOpts.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
              </select>
            </label>
            <label style={lbl}>ตัวเชื่อมผัง (A-G)<input value={procModal.connector || ''} onChange={e => setProcModal({ ...procModal, connector: e.target.value })} style={{ marginTop: 4 }} /></label>
            <label style={lbl}>Special Char.
              <select value={procModal.special_class || ''} onChange={e => setProcModal({ ...procModal, special_class: e.target.value })} style={{ marginTop: 4 }}>
                <option value="">—</option><option value="CC">CC (Critical)</option><option value="SC">SC (Significant)</option>
              </select>
            </label>
            <label style={lbl}>SCCAF No.<input value={procModal.sccaf_no || ''} onChange={e => setProcModal({ ...procModal, sccaf_no: e.target.value })} placeholder="63, 64" style={{ marginTop: 4 }} /></label>
            <label style={{ ...lbl, gridColumn: '1 / -1' }}>Child part / Nut ที่ใช้ (บรรทัดละตัว)<textarea rows={2} value={procModal.child_parts || ''} onChange={e => setProcModal({ ...procModal, child_parts: e.target.value })} placeholder={'W520771-S NUT WELD M6\nMB3B-16C172-AC'} style={{ marginTop: 4 }} /></label>
            <label style={{ ...lbl, gridColumn: '1 / -1' }}>หมายเหตุ<input value={procModal.remark || ''} onChange={e => setProcModal({ ...procModal, remark: e.target.value })} style={{ marginTop: 4 }} /></label>
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={lbl}>รูปประกอบ OP (ชิ้นงาน/จุดเชื่อม/drawing)</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                {(procImgFile || procModal.image_url) && (
                  <img src={procImgFile ? URL.createObjectURL(procImgFile) : procModal.image_url} alt=""
                    style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                )}
                <input type="file" accept="image/*" onChange={e => { setProcImgFile(e.target.files?.[0] || null); e.target.value = ''; }} style={{ fontSize: 11, width: 'auto' }} />
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button style={btnSm} onClick={() => setProcModal(null)}>ยกเลิก</button>
            <button style={btnPrim} disabled={saving} onClick={async () => {
              if (!procModal.op_no?.trim() || !procModal.name?.trim()) { toast.error('กรอกเลข OP และชื่อกระบวนการก่อน'); return; }
              const patch = {
                set_id: procModal.set_id, op_no: procModal.op_no.trim(), seq: Number(procModal.seq) || 0,
                name: procModal.name.trim(), kind: procModal.kind, machine_no: procModal.machine_no?.trim() || null,
                line_name: procModal.line_name || null, child_parts: procModal.child_parts?.trim() || null,
                connector: procModal.connector?.trim() || null, special_class: procModal.special_class || null,
                sccaf_no: procModal.sccaf_no?.trim() || null, remark: procModal.remark?.trim() || null,
              };
              const row = await saveRow('pe_processes', procModal, patch, null);
              if (row) {
                await attachImage('pe_processes', row, procImgFile, `set/${row.set_id}/op-${row.op_no.replace(/[^\w.-]/g, '')}`);
                loadDetail(setId);
                setProcModal(null); setProcImgFile(null);
              }
            }}>{saving ? 'กำลังบันทึก...' : '💾 บันทึก'}</button>
          </div>
        </div></div>
      )}

      {/* ══ modal: FMEA item ══ */}
      {fmeaModal && (
        <div className="overlay"><div className="modal" style={{ width: 'min(860px, 96vw)', maxHeight: '92vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{fmeaModal.id ? '✏️ แก้แถว FMEA' : '➕ เพิ่ม Failure Mode'}</h3>
            <button onClick={() => setFmeaModal(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
          </div>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={lbl}>Process (OP) *
              <select value={fmeaModal.process_id || ''} onChange={e => setFmeaModal({ ...fmeaModal, process_id: e.target.value })} style={{ marginTop: 4 }}>
                {procs.map(p => <option key={p.id} value={p.id}>OP {p.op_no} · {p.name}</option>)}
              </select>
            </label>
            <label style={lbl}>Classification
              <select value={fmeaModal.classification || ''} onChange={e => setFmeaModal({ ...fmeaModal, classification: e.target.value })} style={{ marginTop: 4 }}>
                <option value="">—</option><option value="CC">CC</option><option value="SC">SC</option>
              </select>
            </label>
            <label style={{ ...lbl, gridColumn: '1 / -1' }}>Item / Function (กลุ่มในฟอร์ม เช่น INCOMING INSP. / PROGRESSIVE / REWORK)<input value={fmeaModal.item_function || ''} onChange={e => setFmeaModal({ ...fmeaModal, item_function: e.target.value })} style={{ marginTop: 4 }} /></label>
            <label style={{ ...lbl, gridColumn: '1 / -1' }}>Requirement<textarea rows={2} value={fmeaModal.requirement || ''} onChange={e => setFmeaModal({ ...fmeaModal, requirement: e.target.value })} placeholder="- Nut thread Q'ty 1 Pc." style={{ marginTop: 4 }} /></label>
            <label style={{ ...lbl, gridColumn: '1 / -1' }}>Potential Failure Mode *<input value={fmeaModal.failure_mode} onChange={e => setFmeaModal({ ...fmeaModal, failure_mode: e.target.value })} placeholder="- Missing nut" style={{ marginTop: 4 }} /></label>
            <label style={{ ...lbl, gridColumn: '1 / -1' }}>Effects (แยกบรรทัด TSAT4 / Assembly plant / End user)<textarea rows={3} value={fmeaModal.effects || ''} onChange={e => setFmeaModal({ ...fmeaModal, effects: e.target.value })} placeholder={'TSAT4: Sorted 100% and rework offline\nAssembly plant: Can\'t assembled\nEnd user: ...'} style={{ marginTop: 4 }} /></label>
            <label style={{ ...lbl, gridColumn: '1 / -1' }}>Causes (บรรทัดละสาเหตุ)<textarea rows={3} value={fmeaModal.causes || ''} onChange={e => setFmeaModal({ ...fmeaModal, causes: e.target.value })} placeholder={'- Nut feeder wrong position\n- Nut feeder broken'} style={{ marginTop: 4 }} /></label>
            <label style={lbl}>Controls — Prevention<textarea rows={3} value={fmeaModal.prevention || ''} onChange={e => setFmeaModal({ ...fmeaModal, prevention: e.target.value })} placeholder={'- PPM check sheet\n- PM check sheet'} style={{ marginTop: 4 }} /></label>
            <label style={lbl}>Controls — Detection<textarea rows={3} value={fmeaModal.detection_ctrl || ''} onChange={e => setFmeaModal({ ...fmeaModal, detection_ctrl: e.target.value })} placeholder={'- Visual check\n- Poka-yoke'} style={{ marginTop: 4 }} /></label>
            {[['severity', 'S (1-10)'], ['occurrence', 'O (1-10)'], ['detection', 'D (1-10)']].map(([k, t]) => (
              <label key={k} style={lbl}>{t}<input type="number" min="1" max="10" value={fmeaModal[k] ?? ''} onChange={e => setFmeaModal({ ...fmeaModal, [k]: e.target.value })} style={{ marginTop: 4, width: 110, display: 'block' }} /></label>
            ))}
            <div style={{ alignSelf: 'end', fontSize: 13, fontWeight: 800, color: rpnColor((Number(fmeaModal.severity) || 0) * (Number(fmeaModal.occurrence) || 0) * (Number(fmeaModal.detection) || 0) || null) }}>
              RPN = {(Number(fmeaModal.severity) || 0) * (Number(fmeaModal.occurrence) || 0) * (Number(fmeaModal.detection) || 0) || '—'}
            </div>
            <label style={{ ...lbl, gridColumn: '1 / -1' }}>Recommended Action<textarea rows={2} value={fmeaModal.recommended_action || ''} onChange={e => setFmeaModal({ ...fmeaModal, recommended_action: e.target.value })} style={{ marginTop: 4 }} /></label>
            <label style={lbl}>ผู้รับผิดชอบ<input value={fmeaModal.responsibility || ''} onChange={e => setFmeaModal({ ...fmeaModal, responsibility: e.target.value })} placeholder="PD / QA / PE" style={{ marginTop: 4 }} /></label>
            <label style={lbl}>วันเป้าหมาย<input type="date" value={fmeaModal.target_date || ''} onChange={e => setFmeaModal({ ...fmeaModal, target_date: e.target.value })} style={{ marginTop: 4, width: 150, display: 'block' }} /></label>
            <label style={{ ...lbl, gridColumn: '1 / -1' }}>Action Taken (ผลที่ทำจริง)<textarea rows={2} value={fmeaModal.action_taken || ''} onChange={e => setFmeaModal({ ...fmeaModal, action_taken: e.target.value })} style={{ marginTop: 4 }} /></label>
            {[['new_severity', 'S ใหม่'], ['new_occurrence', 'O ใหม่'], ['new_detection', 'D ใหม่']].map(([k, t]) => (
              <label key={k} style={lbl}>{t}<input type="number" min="1" max="10" value={fmeaModal[k] ?? ''} onChange={e => setFmeaModal({ ...fmeaModal, [k]: e.target.value })} style={{ marginTop: 4, width: 110, display: 'block' }} /></label>
            ))}
            <div style={{ alignSelf: 'end', fontSize: 13, fontWeight: 800, color: rpnColor((Number(fmeaModal.new_severity) || 0) * (Number(fmeaModal.new_occurrence) || 0) * (Number(fmeaModal.new_detection) || 0) || null) }}>
              RPN ใหม่ = {(Number(fmeaModal.new_severity) || 0) * (Number(fmeaModal.new_occurrence) || 0) * (Number(fmeaModal.new_detection) || 0) || '—'}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button style={btnSm} onClick={() => setFmeaModal(null)}>ยกเลิก</button>
            <button style={btnPrim} disabled={saving} onClick={async () => {
              if (!fmeaModal.process_id) { toast.error('เลือก OP ก่อน'); return; }
              if (!fmeaModal.failure_mode?.trim()) { toast.error('กรอก Failure Mode ก่อน'); return; }
              const num = (v) => (v !== '' && v != null ? Number(v) : null);
              const patch = {
                process_id: fmeaModal.process_id, seq: Number(fmeaModal.seq) || 0,
                item_function: fmeaModal.item_function?.trim() || null,
                requirement: fmeaModal.requirement?.trim() || null, failure_mode: fmeaModal.failure_mode.trim(),
                effects: fmeaModal.effects?.trim() || null, severity: num(fmeaModal.severity),
                classification: fmeaModal.classification || null, causes: fmeaModal.causes?.trim() || null,
                prevention: fmeaModal.prevention?.trim() || null, occurrence: num(fmeaModal.occurrence),
                detection_ctrl: fmeaModal.detection_ctrl?.trim() || null, detection: num(fmeaModal.detection),
                recommended_action: fmeaModal.recommended_action?.trim() || null,
                responsibility: fmeaModal.responsibility?.trim() || null, target_date: fmeaModal.target_date || null,
                action_taken: fmeaModal.action_taken?.trim() || null,
                new_severity: num(fmeaModal.new_severity), new_occurrence: num(fmeaModal.new_occurrence), new_detection: num(fmeaModal.new_detection),
              };
              if (await saveRow('pe_fmea_items', fmeaModal, patch, () => loadDetail(setId))) setFmeaModal(null);
            }}>{saving ? 'กำลังบันทึก...' : '💾 บันทึก'}</button>
          </div>
        </div></div>
      )}

      {/* ══ modal: CP item ══ */}
      {cpModal && (
        <div className="overlay"><div className="modal" style={{ width: 'min(760px, 96vw)', maxHeight: '92vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{cpModal.id ? '✏️ แก้จุดควบคุม' : '➕ เพิ่มจุดควบคุม (Control Plan)'}</h3>
            <button onClick={() => setCpModal(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
          </div>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={lbl}>Process (OP) *
              <select value={cpModal.process_id || ''} onChange={e => setCpModal({ ...cpModal, process_id: e.target.value })} style={{ marginTop: 4 }}>
                {procs.map(p => <option key={p.id} value={p.id}>OP {p.op_no} · {p.name}</option>)}
              </select>
            </label>
            <label style={lbl}>Char No.<input type="number" value={cpModal.char_no ?? ''} onChange={e => setCpModal({ ...cpModal, char_no: e.target.value })} style={{ marginTop: 4, width: 110, display: 'block' }} /></label>
            <label style={{ ...lbl, gridColumn: '1 / -1' }}>Sub-op (กลุ่มในใบ CP เช่น "130.3 · PROGRESSIVE")<input value={cpModal.sub_op || ''} onChange={e => setCpModal({ ...cpModal, sub_op: e.target.value })} style={{ marginTop: 4 }} /></label>
            <label style={lbl}>Product Characteristic<input value={cpModal.product_char || ''} onChange={e => setCpModal({ ...cpModal, product_char: e.target.value })} placeholder="QUANTITY OF NUT" style={{ marginTop: 4 }} /></label>
            <label style={lbl}>Process Characteristic<input value={cpModal.process_char || ''} onChange={e => setCpModal({ ...cpModal, process_char: e.target.value })} placeholder="WELDING PARAMETER" style={{ marginTop: 4 }} /></label>
            <label style={lbl}>Special Char.
              <select value={cpModal.special_class || ''} onChange={e => setCpModal({ ...cpModal, special_class: e.target.value })} style={{ marginTop: 4 }}>
                <option value="">—</option><option value="CC">CC</option><option value="SC">SC</option>
              </select>
            </label>
            <label style={lbl}>ผู้คุม (Person in charge)<input value={cpModal.person || ''} onChange={e => setCpModal({ ...cpModal, person: e.target.value })} placeholder="PD / QA / JIG MTN" style={{ marginTop: 4 }} /></label>
            <label style={{ ...lbl, gridColumn: '1 / -1' }}>Spec / Tolerance<textarea rows={2} value={cpModal.spec || ''} onChange={e => setCpModal({ ...cpModal, spec: e.target.value })} placeholder="≥ 20 NM. / FOLLOW SOP NO. FTM-P703-068" style={{ marginTop: 4 }} /></label>
            <label style={lbl}>วิธีวัด (Measurement)<textarea rows={2} value={cpModal.method || ''} onChange={e => setCpModal({ ...cpModal, method: e.target.value })} placeholder="TORQUE TEST / VISUAL CHECK" style={{ marginTop: 4 }} /></label>
            <label style={lbl}>Control Method (เอกสาร)<textarea rows={2} value={cpModal.control_method || ''} onChange={e => setCpModal({ ...cpModal, control_method: e.target.value })} placeholder="PPM NO.FM-PD3-001" style={{ marginTop: 4 }} /></label>
            <label style={lbl}>Sample Size<input value={cpModal.sample_size || ''} onChange={e => setCpModal({ ...cpModal, sample_size: e.target.value })} placeholder="1 PC. / 3 PCS." style={{ marginTop: 4 }} /></label>
            <label style={lbl}>ความถี่<input value={cpModal.frequency || ''} onChange={e => setCpModal({ ...cpModal, frequency: e.target.value })} placeholder="EVERY SHIFT / EVERY 2 HOUR" style={{ marginTop: 4 }} /></label>
            <label style={{ ...lbl, gridColumn: '1 / -1' }}>Reaction Plan<textarea rows={2} value={cpModal.reaction_plan || ''} onChange={e => setCpModal({ ...cpModal, reaction_plan: e.target.value })} placeholder="STOP PROCESS AND ADJUST MACHINE" style={{ marginTop: 4 }} /></label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button style={btnSm} onClick={() => setCpModal(null)}>ยกเลิก</button>
            <button style={btnPrim} disabled={saving} onClick={async () => {
              if (!cpModal.process_id) { toast.error('เลือก OP ก่อน'); return; }
              if (!cpModal.product_char?.trim() && !cpModal.process_char?.trim()) { toast.error('กรอก characteristic อย่างน้อย 1 ช่อง'); return; }
              const patch = {
                process_id: cpModal.process_id, char_no: cpModal.char_no !== '' && cpModal.char_no != null ? Number(cpModal.char_no) : null,
                sub_op: cpModal.sub_op?.trim() || null,
                seq: Number(cpModal.seq) || 0, product_char: cpModal.product_char?.trim() || null,
                process_char: cpModal.process_char?.trim() || null, special_class: cpModal.special_class || null,
                person: cpModal.person?.trim() || null, spec: cpModal.spec?.trim() || null,
                method: cpModal.method?.trim() || null, sample_size: cpModal.sample_size?.trim() || null,
                frequency: cpModal.frequency?.trim() || null, control_method: cpModal.control_method?.trim() || null,
                reaction_plan: cpModal.reaction_plan?.trim() || null,
              };
              if (await saveRow('pe_cp_items', cpModal, patch, () => loadDetail(setId))) setCpModal(null);
            }}>{saving ? 'กำลังบันทึก...' : '💾 บันทึก'}</button>
          </div>
        </div></div>
      )}

      {/* ══ modal: revision ══ */}
      {revModal && (
        <div className="overlay"><div className="modal" style={{ width: 'min(640px, 95vw)', maxHeight: '90vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{revModal.id ? '✏️ แก้ Revision' : '➕ ออก Revision ใหม่'}</h3>
            <button onClick={() => setRevModal(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
          </div>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={lbl}>เอกสาร
              <select value={revModal.doc_type} onChange={e => setRevModal({ ...revModal, doc_type: e.target.value })} style={{ marginTop: 4 }}>
                {DOC_TYPES.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </label>
            <label style={lbl}>Rev No.<input type="number" value={revModal.rev_no ?? ''} onChange={e => setRevModal({ ...revModal, rev_no: e.target.value })} style={{ marginTop: 4, width: 110, display: 'block' }} /></label>
            <label style={lbl}>วันที่<input type="date" value={revModal.rev_date || ''} onChange={e => setRevModal({ ...revModal, rev_date: e.target.value })} style={{ marginTop: 4, width: 150, display: 'block' }} /></label>
            <label style={lbl}>Suffix (Part no. ณ ตอนนั้น)<input value={revModal.suffix || ''} onChange={e => setRevModal({ ...revModal, suffix: e.target.value })} style={{ marginTop: 4, fontFamily: 'monospace' }} /></label>
            <label style={lbl}>ECN No.<input value={revModal.ecn_no || ''} onChange={e => setRevModal({ ...revModal, ecn_no: e.target.value })} style={{ marginTop: 4, fontFamily: 'monospace' }} /></label>
            <label style={lbl}>ต้นเหตุ
              <select value={revModal.ref_kind || ''} onChange={e => setRevModal({ ...revModal, ref_kind: e.target.value })} style={{ marginTop: 4 }}>
                <option value="">—</option>
                <option value="claim">เคลมลูกค้า</option><option value="ncr">NCR</option>
                <option value="defect">ของเสียภายใน</option><option value="downtime">Downtime</option>
                <option value="mtn">ใบซ่อม MO</option><option value="other">อื่นๆ</option>
              </select>
            </label>
            <label style={{ ...lbl, gridColumn: '1 / -1' }}>เลขอ้างอิงต้นเหตุ (เลขเคลม/NCR/MO)<input value={revModal.ref_id || ''} onChange={e => setRevModal({ ...revModal, ref_id: e.target.value })} placeholder="เช่น WLS6033" style={{ marginTop: 4, fontFamily: 'monospace' }} /></label>
            <label style={{ ...lbl, gridColumn: '1 / -1' }}>เนื้อหาการแก้ไข *<textarea rows={3} value={revModal.content} onChange={e => setRevModal({ ...revModal, content: e.target.value })} placeholder="Process 210 Missing nut m6 (WLS00292)" style={{ marginTop: 4 }} /></label>
            <label style={lbl}>ผู้ออก<input value={revModal.issued_by || ''} onChange={e => setRevModal({ ...revModal, issued_by: e.target.value })} style={{ marginTop: 4 }} /></label>
            <label style={lbl}>ผู้ตรวจสอบ<input value={revModal.checked_by || ''} onChange={e => setRevModal({ ...revModal, checked_by: e.target.value })} style={{ marginTop: 4 }} /></label>
            <label style={lbl}>ผู้รับรอง<input value={revModal.approved_by || ''} onChange={e => setRevModal({ ...revModal, approved_by: e.target.value })} style={{ marginTop: 4 }} /></label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button style={btnSm} onClick={() => setRevModal(null)}>ยกเลิก</button>
            <button style={btnPrim} disabled={saving} onClick={async () => {
              if (!revModal.content?.trim()) { toast.error('กรอกเนื้อหาการแก้ไขก่อน'); return; }
              const patch = {
                set_id: revModal.set_id, doc_type: revModal.doc_type,
                rev_no: revModal.rev_no !== '' && revModal.rev_no != null ? Number(revModal.rev_no) : null,
                rev_date: revModal.rev_date || null, suffix: revModal.suffix?.trim() || null,
                ecn_no: revModal.ecn_no?.trim() || null, content: revModal.content.trim(),
                ref_kind: revModal.ref_kind || null, ref_id: revModal.ref_id?.trim() || null,
                issued_by: revModal.issued_by?.trim() || null, checked_by: revModal.checked_by?.trim() || null,
                approved_by: revModal.approved_by?.trim() || null,
              };
              if (await saveRow('pe_doc_revisions', revModal, patch, () => loadDetail(setId))) setRevModal(null);
            }}>{saving ? 'กำลังบันทึก...' : '💾 บันทึก'}</button>
          </div>
        </div></div>
      )}

      {/* ══ lightbox ดูรูปเต็ม (viewer ไม่ใช่ฟอร์ม — คลิกที่ไหนก็ปิดได้) ══ */}
      {imgView && (
        <div onClick={() => setImgView(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out', padding: 16 }}>
          <img src={imgView} alt="" style={{ maxWidth: '94vw', maxHeight: '90vh', borderRadius: 8 }} />
        </div>
      )}
    </div>
  );
}
