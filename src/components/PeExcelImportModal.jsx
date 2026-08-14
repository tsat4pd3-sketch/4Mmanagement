/**
 * 📥 นำเข้า PE Core Tools จากไฟล์ Excel (PFMEA / Control Plan / Process Flow)
 *
 * กติกา: **ต้องดู preview ก่อนเขียนฐานเสมอ** — ตัวแกะผูกกับ layout ฟอร์ม TSAT
 * ไฟล์ที่ layout ต่างจะได้ 0 แถว แล้วต้องขึ้นเตือน ห้าม import เงียบ (ดู peExcelImport.js)
 */
import { useState, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from './Toast';
import {
  sheetToGrid, parseFmeaSheet, parseCpSheet, parseCoverSheet,
  normSheetKey, isDataSheet, buildImportPlan, planSummary,
} from '../utils/peExcelImport';

const nz = (v) => { const s = String(v ?? '').trim(); return s || null; };
const CHUNK = 400;
const chunks = (a, n = CHUNK) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

const btn = { padding: '7px 12px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', cursor: 'pointer' };
const btnPrim = { ...btn, background: 'var(--accent)', borderColor: 'var(--accent)', color: '#04140a' };
const lbl = { fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block' };
const inp = { marginTop: 4, padding: '7px 9px', fontSize: 12, borderRadius: 7, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)' };

const FILES = [
  { key: 'fmea', label: '⚠️ PFMEA', hint: 'ชีทละ OP · ได้ทั้ง failure mode และประวัติแก้ไข' },
  { key: 'cp', label: '✅ Control Plan (CNP)', hint: 'ใช้สร้างรายการ OP + ชื่อขั้นงาน + เครื่องจักร' },
  { key: 'pfc', label: '🗺️ Process Flow (PFC)', hint: 'ใช้เฉพาะประวัติการแก้ไข (ไม่บังคับ)' },
];

/** อ่าน 1 ไฟล์ → { sheets, revs, unreadable } (xlsx เป็น lazy chunk — ห้าม import แบบ static) */
async function readWorkbook(file, kind) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const sheets = {}; const revs = []; const unreadable = [];

  for (const name of wb.SheetNames) {
    const { rows, merges } = sheetToGrid(XLSX, wb.Sheets[name]);
    const key = normSheetKey(name);
    // ⚠️ ตัดสินจาก "แกะได้กี่แถว" ไม่ใช่ชื่อชีท — ชีท cover ของฟอร์มนี้ชื่อ '060'/'061'
    //    ซึ่งขึ้นต้นด้วยเลขเหมือนชีท OP (เทียบชื่ออย่างเดียวจะเข้าใจผิด)
    const recs = kind === 'pfc' ? [] : (kind === 'cp' ? parseCpSheet(rows, merges) : parseFmeaSheet(rows, merges));
    if (isDataSheet(key) && recs.length) { sheets[key] = recs; continue; }
    const cover = parseCoverSheet(rows);
    if (cover.length) revs.push(...cover.map((r) => ({ ...r, doc_type: kind })));
    else if (isDataSheet(key)) unreadable.push(name);
  }
  return { sheets, revs, unreadable };
}

export default function PeExcelImportModal({ sets = [], currentSetId = '', onClose, onDone }) {
  const { fullName } = useContext(UserContext);
  const [files, setFiles] = useState({});
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('pick');           // pick → preview
  const [mode, setMode] = useState(currentSetId ? 'fill' : 'new');
  const [targetId, setTargetId] = useState(currentSetId);
  const [meta, setMeta] = useState({ part_no: '', part_name: '', model: '', customer: '', doc_no_pfc: '', doc_no_fmea: '', doc_no_cp: '' });

  const target = sets.find((s) => s.id === targetId);

  async function analyse() {
    if (!files.fmea && !files.cp) { toast.error('เลือกไฟล์ PFMEA หรือ Control Plan อย่างน้อย 1 ไฟล์'); return; }
    setBusy(true);
    try {
      const parts = {};
      const unread = [];
      for (const k of ['fmea', 'cp', 'pfc']) {
        if (!files[k]) continue;
        parts[k] = await readWorkbook(files[k], k);
        unread.push(...parts[k].unreadable.map((n) => `${k}: ${n}`));
      }
      const p = buildImportPlan({
        fmeaSheets: parts.fmea?.sheets || {},
        cpSheets: parts.cp?.sheets || {},
        revisions: [...(parts.fmea?.revs || []), ...(parts.cp?.revs || []), ...(parts.pfc?.revs || [])],
      });
      if (unread.length) p.warnings.push({ level: 'warn', text: `มี ${unread.length} ชีทที่ดูเหมือนชีท OP แต่แกะไม่ได้ (layout ไม่ตรงฟอร์ม) — ถูกข้าม`, rows: unread.map((t) => ({ sheet: t })) });
      setPlan(p);
      setStep('preview');
    } catch (e) {
      toast.error(`อ่านไฟล์ไม่สำเร็จ: ${e.message || e}`);
    } finally { setBusy(false); }
  }

  async function apply() {
    if (mode === 'new' && !meta.part_no.trim()) { toast.error('กรอก Part No. ของชุดใหม่ก่อน'); return; }
    if (mode === 'fill' && !targetId) { toast.error('เลือกชุดเอกสารปลายทางก่อน'); return; }
    const warn = mode === 'fill'
      ? `จะแทนที่รายการ PFMEA / Control Plan / ประวัติแก้ไข ทั้งหมดของชุด "${target?.part_no}" ด้วยข้อมูลจากไฟล์\n(ขั้นงาน OP เดิมที่แก้ไว้จะไม่ถูกลบ)\n\nยืนยัน?`
      : `จะสร้างชุดเอกสารใหม่ "${meta.part_no}" พร้อม ${plan.ops.length} OP\n\nยืนยัน?`;
    if (!window.confirm(warn)) return;

    setBusy(true);
    try {
      let sid = targetId;
      if (mode === 'new') {
        const { data, error } = await supabase.from('pe_doc_sets').insert({
          part_no: meta.part_no.trim(), part_name: nz(meta.part_name), model: nz(meta.model),
          customer: nz(meta.customer), doc_no_pfc: nz(meta.doc_no_pfc), doc_no_fmea: nz(meta.doc_no_fmea),
          doc_no_cp: nz(meta.doc_no_cp), status: 'active', created_by_name: fullName || null,
        }).select('id').single();
        if (error) throw error;
        sid = data.id;
      }

      /* OP — เพิ่มเฉพาะที่ยังไม่มี (ไม่ทับของที่คนแก้ไว้แล้ว) */
      const { data: exist, error: eP } = await supabase.from('pe_processes').select('id, op_no').eq('set_id', sid);
      if (eP) throw eP;
      const byOp = new Map((exist || []).map((p) => [p.op_no, p.id]));
      const add = plan.ops.filter((o) => !byOp.has(o.op_no)).map((o) => ({ set_id: sid, ...o }));
      for (const c of chunks(add)) {
        const { data, error } = await supabase.from('pe_processes').insert(c).select('id, op_no');
        if (error) throw error;
        for (const p of data) byOp.set(p.op_no, p.id);
      }

      /* ล้างรายการเดิมของชุดนี้ แล้วเติมจากไฟล์ */
      const pids = [...byOp.values()];
      if (pids.length) {
        for (const t of ['pe_fmea_items', 'pe_cp_items']) {
          const { error } = await supabase.from(t).delete().in('process_id', pids);
          if (error) throw error;
        }
      }
      const fRows = plan.fmea.filter((r) => byOp.has(r._op)).map((r) => ({
        process_id: byOp.get(r._op), seq: r._seq, item_function: nz(r.item_function),
        requirement: nz(r.requirement), failure_mode: r.failure_mode, effects: nz(r.effects),
        severity: r.severity, classification: nz(r.classification), causes: nz(r.causes),
        prevention: nz(r.prevention), occurrence: r.occurrence, detection_ctrl: nz(r.detection_ctrl),
        detection: r.detection, recommended_action: nz(r.recommended_action),
        responsibility: nz(r.responsibility), action_taken: nz(r.action_taken),
        new_severity: r.new_severity, new_occurrence: r.new_occurrence, new_detection: r.new_detection,
      }));
      const cRows = plan.cp.filter((r) => byOp.has(r._op)).map((r) => ({
        process_id: byOp.get(r._op), char_no: r.char_no, seq: r._seq,
        sub_op: nz([r.sub_op, String(r.sub_name || '').split('\n')[0]].filter(Boolean).join(' · ')),
        product_char: nz(r.product_char), process_char: nz(r.process_char), special_class: nz(r.special_class),
        person: nz(r.person), spec: nz(r.spec), method: nz(r.method), sample_size: nz(r.sample_size),
        frequency: nz(r.frequency), control_method: nz(r.control_method), reaction_plan: nz(r.reaction_plan),
      }));
      for (const [t, rows] of [['pe_fmea_items', fRows], ['pe_cp_items', cRows]]) {
        for (const c of chunks(rows)) { const { error } = await supabase.from(t).insert(c); if (error) throw error; }
      }

      /* ประวัติแก้ไข — แทนที่เฉพาะชนิดเอกสารที่อยู่ในไฟล์ที่อัพโหลดรอบนี้ */
      const types = [...new Set(plan.revisions.map((r) => r.doc_type))];
      if (types.length) {
        const { error } = await supabase.from('pe_doc_revisions').delete().eq('set_id', sid).in('doc_type', types);
        if (error) throw error;
        const rows = plan.revisions.map((r) => ({
          set_id: sid, doc_type: r.doc_type, rev_date: r.rev_date, suffix: nz(r.suffix),
          ecn_no: nz(r.ecn_no), content: nz(r.content), issued_by: nz(r.issued_by),
          checked_by: nz(r.checked_by), approved_by: nz(r.approved_by),
        }));
        for (const c of chunks(rows)) { const { error: e2 } = await supabase.from('pe_doc_revisions').insert(c); if (e2) throw e2; }
      }

      toast.success(`นำเข้าสำเร็จ · ${plan.ops.length} OP · PFMEA ${fRows.length} · Control Plan ${cRows.length} · ประวัติ ${plan.revisions.length}`);
      onDone?.(sid);
    } catch (e) {
      toast.error(`นำเข้าไม่สำเร็จ: ${e.message || e}`);
    } finally { setBusy(false); }
  }

  const summary = plan ? planSummary(plan) : [];
  const errs = plan?.warnings.filter((w) => w.level === 'error') || [];
  const warns = plan?.warnings.filter((w) => w.level !== 'error') || [];
  const nothing = plan && !plan.ops.length;

  return (
    <div className="overlay"><div className="modal" style={{ width: 'min(920px, 96vw)', maxHeight: '92vh', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>📥 นำเข้าจากไฟล์ Excel</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
      </div>

      {step === 'pick' && (<>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.6 }}>
          ใช้ไฟล์ฟอร์ม TSAT ได้เลยไม่ต้องจัดใหม่ — ระบบอ่านทุกชีท OP แล้วประกอบเป็นชุดเอกสารให้<br />
          <b style={{ color: 'var(--text2)' }}>จะให้ดูสรุปก่อนเสมอ ยังไม่เขียนฐานข้อมูลจนกว่าจะกดยืนยัน</b>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          {FILES.map((f) => (
            <div key={f.key} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 10, background: 'var(--bg2)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ minWidth: 190 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{f.label}</div>
                <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{f.hint}</div>
              </div>
              <input type="file" accept=".xlsx,.xlsm" style={{ width: 'auto', flex: 1, fontSize: 11.5 }}
                onChange={(e) => setFiles({ ...files, [f.key]: e.target.files?.[0] || null })} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button style={btn} onClick={onClose}>ยกเลิก</button>
          <button style={btnPrim} disabled={busy} onClick={analyse}>{busy ? 'กำลังอ่านไฟล์...' : '🔍 อ่านไฟล์ & ดูสรุป'}</button>
        </div>
      </>)}

      {step === 'preview' && plan && (<>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          {[['ขั้นงาน (OP)', plan.ops.length], ['PFMEA', plan.fmea.length], ['Control Plan', plan.cp.length], ['ประวัติแก้ไข', plan.revisions.length]].map(([k, v]) => (
            <div key={k} style={{ flex: '1 1 150px', padding: 10, background: 'var(--bg2)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{k}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: v ? 'var(--accent)' : 'var(--muted)' }}>{v}</div>
            </div>
          ))}
        </div>

        {errs.map((w, i) => (
          <div key={i} style={{ padding: 10, marginBottom: 8, borderRadius: 8, background: 'rgba(220,60,60,.12)', border: '1px solid rgba(220,60,60,.5)', fontSize: 12 }}>
            <b style={{ color: '#ff8a8a' }}>⛔ {w.text}</b>
            {w.rows && <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--muted)', fontFamily: 'monospace', maxHeight: 110, overflowY: 'auto' }}>
              {w.rows.map((r, j) => <div key={j}>ชีท {r.sheet}{r.op ? ` · OP ${r.op}` : ''}{r.text ? ` · ${r.text}` : ''}</div>)}
            </div>}
          </div>
        ))}
        {warns.map((w, i) => (
          <div key={i} style={{ padding: 10, marginBottom: 8, borderRadius: 8, background: 'rgba(240,170,60,.12)', border: '1px solid rgba(240,170,60,.45)', fontSize: 12, color: 'var(--text2)' }}>
            ⚠️ {w.text}
            {w.rows && <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--muted)', fontFamily: 'monospace' }}>{w.rows.map((r, j) => <div key={j}>{r.sheet}</div>)}</div>}
          </div>
        ))}

        {nothing ? (
          <div style={{ padding: 20, textAlign: 'center', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.7 }}>
            อ่านไฟล์ไม่ออก — layout ต่างจากฟอร์มที่ระบบรู้จัก<br />
            ระบบคาดว่า <b>PFMEA</b> ข้อมูลเริ่มแถว 10 คอลัมน์ B–S · <b>Control Plan</b> เริ่มแถว 12 มีเลข Char No. ที่คอลัมน์ D<br />
            ถ้าไฟล์เป็นฟอร์มคนละแบบ ให้ส่งไฟล์ให้ผู้ดูแลระบบเพิ่มรูปแบบใหม่ให้
          </div>
        ) : (<>
          <div style={{ maxHeight: 230, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12 }}>
            <table className="table-sticky" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead><tr style={{ background: 'var(--bg3)' }}>
                {['OP', 'ชื่อขั้นงาน', 'ชนิด', 'PFMEA', 'CP', 'child part / เครื่อง'].map((h) => (
                  <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {summary.map((o) => (
                  <tr key={o.op_no} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '5px 8px', fontFamily: 'monospace', fontWeight: 700 }}>{o.op_no}</td>
                    <td style={{ padding: '5px 8px' }}>{o.name}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--muted)' }}>{o.kind}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right' }}>{o.fmea || '—'}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right' }}>{o.cp || '—'}</td>
                    <td style={{ padding: '5px 8px', fontSize: 10.5, color: 'var(--muted)', whiteSpace: 'pre-wrap' }}>{[o.child_parts, o.remark].filter(Boolean).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ padding: 10, background: 'var(--bg2)', borderRadius: 8, border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', gap: 14, marginBottom: 8, fontSize: 12.5 }}>
              <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> สร้างชุดเอกสารใหม่
              </label>
              <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: sets.length ? 'pointer' : 'not-allowed', opacity: sets.length ? 1 : 0.5 }}>
                <input type="radio" checked={mode === 'fill'} disabled={!sets.length} onChange={() => setMode('fill')} /> เติมทับชุดที่มีอยู่
              </label>
            </div>
            {mode === 'new' ? (
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 8 }}>
                <label style={lbl}>Part No. *<input value={meta.part_no} onChange={(e) => setMeta({ ...meta, part_no: e.target.value })} placeholder="MB3B-16E062-CH" style={inp} /></label>
                <label style={lbl}>ชื่อพาร์ท<input value={meta.part_name} onChange={(e) => setMeta({ ...meta, part_name: e.target.value })} style={inp} /></label>
                <label style={lbl}>Model<input value={meta.model} onChange={(e) => setMeta({ ...meta, model: e.target.value })} placeholder="P703" style={inp} /></label>
                <label style={lbl}>ลูกค้า<input value={meta.customer} onChange={(e) => setMeta({ ...meta, customer: e.target.value })} placeholder="FORD" style={inp} /></label>
                <label style={lbl}>เลขเอกสาร PFC<input value={meta.doc_no_pfc} onChange={(e) => setMeta({ ...meta, doc_no_pfc: e.target.value })} style={inp} /></label>
                <label style={lbl}>เลขเอกสาร FMEA<input value={meta.doc_no_fmea} onChange={(e) => setMeta({ ...meta, doc_no_fmea: e.target.value })} style={inp} /></label>
                <label style={lbl}>เลขเอกสาร CP<input value={meta.doc_no_cp} onChange={(e) => setMeta({ ...meta, doc_no_cp: e.target.value })} style={inp} /></label>
              </div>
            ) : (
              <>
                <select value={targetId} onChange={(e) => setTargetId(e.target.value)} style={{ ...inp, width: '100%' }}>
                  <option value="">— เลือกชุดเอกสารปลายทาง —</option>
                  {sets.map((s) => <option key={s.id} value={s.id}>{s.part_no} · {s.part_name || ''}</option>)}
                </select>
                <div style={{ fontSize: 11, color: '#ffb86b', marginTop: 6 }}>
                  ⚠️ รายการ PFMEA / Control Plan / ประวัติแก้ไข เดิมของชุดนี้จะถูกแทนที่ทั้งหมด · ขั้นงาน OP ที่มีอยู่แล้วจะไม่ถูกลบ (เพิ่มเฉพาะ OP ใหม่)
                </div>
              </>
            )}
          </div>
        </>)}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button style={btn} onClick={() => setStep('pick')}>← เลือกไฟล์ใหม่</button>
          <button style={btn} onClick={onClose}>ยกเลิก</button>
          <button style={btnPrim} disabled={busy || nothing} onClick={apply}>{busy ? 'กำลังนำเข้า...' : '✅ ยืนยันนำเข้า'}</button>
        </div>
      </>)}
    </div></div>
  );
}
