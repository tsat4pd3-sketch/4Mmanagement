/**
 * MaterialRequests — ใบขอเบิก/คืนสินค้าคงคลัง FM-STO-003 Rev.01 (paperless)
 * แท็บ 📦 ใน /qa
 *
 * ที่มา (user 2026-08-24): QA ต้องเขียนใบเบิกชิ้นงานจากฝ่ายผลิตไปทดสอบแบบทำลาย
 * แล้วของที่ถูกทำลายต้องไปโผล่ในใบรายงานของเสีย
 * → **ScrapReport ดึงได้ 2 ทาง: Daily Report (ของเสียจากการผลิต) + ใบเบิกนี้ (ของที่เอาไปทดสอบ)**
 *
 * ⚠️ ตารางอยู่ DR project (`material_requests` / `material_request_items`) เพราะปลายทางคือ
 *    `scrap_report_items` (DR) และตัวเลือกรหัสสินค้ามาจาก `parts_master` (DR)
 *    → DR เป็น anon ไม่มี RLS จริง **สิทธิ์คุมที่ UI ด้วยคีย์เดิม scrap:record / scrap:manage**
 *      (ไม่เพิ่ม permission key ใหม่ — เลี่ยงกับดัก seed enum_range)
 */
import { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { usePerms } from '../utils/usePerms';
import { toast } from './Toast';
import ReadOnlyNote from './ReadOnlyNote';
import InfoMore from './InfoMore';
import { toHierarchicalOptions } from '../utils/lineHierarchy';
import { scopedLineNames } from '../utils/sectionScope';
import {
  movesFor, moveNeeds, moveLabel, KIND_LABEL, statusMeta, nextReqNo, isPullable,
} from '../utils/materialRequest';
import { printMaterialRequest } from '../lib/materialRequestPrint';
import { notifyEvent } from '../utils/notifyEvent';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const monthOf = (d) => String(d || '').slice(0, 7);

const EMPTY_ITEM = () => ({
  _key: crypto.randomUUID(), mat_no: '', description: '', qty: '', unit: 'Pcs',
  qty_issued: '', produced_date: '', batch_no: '',
});

const SIGS = [
  { k: 'made_by', label: 'จัดทำโดย', group: 'req' },
  { k: 'approved_by', label: 'อนุมัติโดย', group: 'req' },
  { k: 'received_by', label: 'รับ/คืนสินค้าคงคลังโดย', group: 'req' },
  { k: 'recorded_by', label: 'บันทึกโดย', group: 'store' },
  { k: 'checked_by', label: 'ตรวจสอบโดย', group: 'store' },
];

export default function MaterialRequests() {
  const { role, lineId, sections = [], fullName } = useContext(UserContext);
  const { can } = usePerms();
  const canRecord = can('scrap', 'record');
  const canManage = can('scrap', 'manage');

  const [rows, setRows] = useState([]);
  const [lines, setLines] = useState([]);
  const [signers, setSigners] = useState([]);
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [warn, setWarn] = useState('');
  const [month, setMonth] = useState(() => monthOf(today()));
  const [fStatus, setFStatus] = useState('');
  const [editor, setEditor] = useState(null);   // { req, items }
  const [picker, setPicker] = useState(null);   // { itemKey } | null
  const [pq, setPq] = useState('');

  /* ── scope มาตรฐาน: leader = ทั้งครอบครัวไลน์ตัวเอง · อื่น = ตาม sections ── */
  //   helper กลาง scopedLineNames — เดิมเทียบ sections.includes(l.section) ตรงตัว (ไม่ normalize
  //   ช่องว่าง/ตัวพิมพ์เหมือน inSectionScope) และไม่มี fallback เมื่อกรองแล้วไม่เหลือไลน์ (audit รอบ 11)
  const scopedLines = useMemo(() => {
    const names = scopedLineNames({ role, lineId, sections, lines });
    if (!names) return lines;
    const set = new Set(names);
    return lines.filter(l => set.has(l.name));
  }, [lines, role, lineId, sections]);
  const scopeNames = useMemo(() => new Set(scopedLines.map(l => l.name)), [scopedLines]);

  useEffect(() => {
    // production_lines + profiles อยู่ Main · parts_master อยู่ DR
    supabase.from('production_lines').select('id, name, section, parent_line_name').order('name')
      .then(({ data }) => setLines(data || []));
    supabase.from('profiles').select('id, full_name, signature_url').not('signature_url', 'is', null)
      .then(({ data }) => setSigners(data || []));
    supabaseDR.from('parts_master').select('mat_no, part_name, uom').eq('is_active', true)
      .order('mat_no').limit(2000)
      .then(({ data }) => setParts(data || []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setWarn('');
    const from = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const to = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    let q = supabaseDR.from('material_requests').select('*')
      .gte('request_date', from).lte('request_date', to)
      .order('request_date', { ascending: false }).order('created_at', { ascending: false });
    if (fStatus) q = q.eq('status', fStatus);
    const { data, error } = await q;
    if (error) {
      setWarn(error.code === '42P01'
        ? 'ยังไม่ได้ apply migration ของใบเบิก — แจ้งผู้ดูแลระบบ'
        : `โหลดไม่สำเร็จ: ${error.message}`);
    }
    setRows(data || []);
    setLoading(false);
  }, [month, fStatus]);
  useEffect(() => { load(); }, [load]);

  // ใบที่ไม่ได้ระบุไลน์ = เห็นได้ทุกคน (ใบของหน่วยงานสนับสนุนไม่ผูกไลน์)
  const visible = useMemo(
    () => rows.filter(r => !r.line_name || !scopeNames.size || scopeNames.has(r.line_name)),
    [rows, scopeNames],
  );
  const hidden = rows.length - visible.length;

  /* ── เปิดฟอร์ม ── */
  const openNew = () => {
    const d = today();
    setEditor({
      req: {
        kind: 'withdraw', move_code: 'prod', request_date: d, need_date: d,
        requester_name: fullName || '', requester_dept: 'QUALITY',
        plant_code: '2140', status: 'draft',
        doc_no: nextReqNo(d, rows.length),
        made_by_name: fullName || '', made_by_date: d,
        made_by_sig_url: signers.find(s => s.full_name === fullName)?.signature_url || null,
      },
      items: [EMPTY_ITEM()],
    });
  };

  const openEdit = async (r) => {
    const { data, error } = await supabaseDR.from('material_request_items')
      .select('*').eq('request_id', r.id).order('seq');
    if (error) return toast.error(`โหลดรายการไม่สำเร็จ: ${error.message}`);
    setEditor({
      req: { ...r },
      items: (data || []).map(it => ({ ...it, _key: it.id })).concat(data?.length ? [] : [EMPTY_ITEM()]),
    });
  };

  const setReq = (patch) => setEditor(e => ({ ...e, req: { ...e.req, ...patch } }));
  const setItem = (key, patch) =>
    setEditor(e => ({ ...e, items: e.items.map(it => it._key === key ? { ...it, ...patch } : it) }));
  const addItem = () => setEditor(e => ({ ...e, items: [...e.items, EMPTY_ITEM()] }));
  const delItem = (key) => setEditor(e => ({ ...e, items: e.items.filter(it => it._key !== key) }));

  /* ── บันทึก ── */
  const save = async (nextStatus) => {
    const { req, items } = editor;
    if (!req.request_date) return toast.error('ยังไม่ได้ใส่วันที่เบิก');
    const real = items.filter(it => String(it.mat_no || '').trim() || String(it.description || '').trim());
    if (!real.length) return toast.error('ยังไม่มีรายการสินค้าสักรายการ');
    const noQty = real.filter(it => !(Number(it.qty) > 0));
    if (noQty.length) return toast.error(`มี ${noQty.length} รายการที่ยังไม่ได้ใส่จำนวน`);

    const payload = { ...req, updated_by_name: fullName || null };
    delete payload.id;
    if (nextStatus) payload.status = nextStatus;

    let id = req.id;
    if (id) {
      const { data, error } = await supabaseDR.from('material_requests')
        .update(payload).eq('id', id).select('id');
      if (error) return toast.error(`บันทึกไม่สำเร็จ: ${error.message}`);
      if (!data?.length) return toast.error('บันทึกไม่สำเร็จ — ไม่พบใบนี้แล้ว');
    } else {
      const { data, error } = await supabaseDR.from('material_requests')
        .insert(payload).select().single();
      if (error) return toast.error(`สร้างใบไม่สำเร็จ: ${error.message}`);
      id = data.id;
    }

    // รายการ: ลบทิ้งแล้วเขียนใหม่ (จำนวนน้อย ลำดับสำคัญ — pattern เดียวกับ scrap_report_items)
    // ⚠️ แถวที่ถูกใบ scrap อ้างอยู่จะถูกลบด้วย → FK เป็น on delete set null ใบ scrap ไม่หาย
    //    แต่ลิงก์สืบย้อนจะขาด จึงคง id เดิมไว้เมื่อแถวนั้นยังอยู่
    const keep = real.filter(it => it.id).map(it => it.id);
    let delQ = supabaseDR.from('material_request_items').delete().eq('request_id', id);
    if (keep.length) delQ = delQ.not('id', 'in', `(${keep.join(',')})`);
    const { error: eDel } = await delQ;
    if (eDel) return toast.error(`ล้างรายการเดิมไม่สำเร็จ: ${eDel.message}`);

    const up = real.map((it, i) => ({
      ...(it.id ? { id: it.id } : {}),
      request_id: id, seq: i + 1,
      mat_no: it.mat_no || null, description: it.description || null,
      qty: it.qty === '' ? null : Number(it.qty),
      unit: it.unit || 'Pcs',
      qty_issued: it.qty_issued === '' || it.qty_issued == null ? null : Number(it.qty_issued),
      produced_date: it.produced_date || null, batch_no: it.batch_no || null,
      updated_by_name: fullName || null,
    }));
    const { error: eUp } = await supabaseDR.from('material_request_items').upsert(up);
    if (eUp) return toast.error(`บันทึกรายการไม่สำเร็จ: ${eUp.message}`);

    // แจ้งเมื่อใบถูก "ส่งขออนุมัติ" (ไม่ใช่ตอนร่าง) — คนอนุมัติต้องรู้ว่ามีใบรออยู่
    if (nextStatus && nextStatus !== 'draft') notifyEvent({
      event: 'material_request', type: 'info', ref_table: 'material_requests', ref_id: id,
      line_name: req.line_name || null, actor: fullName,
      lines: [
        `📄 ${req.doc_no || '(ยังไม่ออกเลขใบ)'} · ${req.kind === 'return' ? 'คืนของ' : 'เบิกของ'}${req.move_code ? ` (${req.move_code})` : ''}`,
        `🏭 ไลน์: ${req.line_name || '—'} · หน่วยงาน: ${req.requester_dept || '—'}`,
        `📦 ${real.length} รายการ · รวม ${real.reduce((s, it) => s + (Number(it.qty) || 0), 0)} ชิ้น`,
        req.detail ? `📝 ${String(req.detail).slice(0, 200)}` : '',
      ],
    });
    toast.success(nextStatus ? `บันทึกและเปลี่ยนสถานะเป็น "${statusMeta(nextStatus).label}" ✓` : 'บันทึกแล้ว ✓');
    setEditor(null);
    load();
  };

  const setStatus = async (r, s) => {
    const { data, error } = await supabaseDR.from('material_requests')
      .update({ status: s, updated_by_name: fullName || null }).eq('id', r.id).select('id');
    if (error) return toast.error(`เปลี่ยนสถานะไม่สำเร็จ: ${error.message}`);
    if (!data?.length) return toast.error('เปลี่ยนสถานะไม่สำเร็จ');
    toast.success(`เปลี่ยนเป็น "${statusMeta(s).label}" ✓`);
    load();
  };

  const remove = async (r) => {
    if (!window.confirm(`ลบใบ ${r.doc_no || ''} ?\nรายการในใบจะถูกลบด้วย · ใบรายงานของเสียที่ดึงจากใบนี้ไปแล้วจะยังอยู่ แต่ลิงก์สืบย้อนจะขาด`)) return;
    const { error } = await supabaseDR.from('material_requests').delete().eq('id', r.id);
    if (error) return toast.error(`ลบไม่สำเร็จ: ${error.message}`);
    toast.success('ลบแล้ว'); load();
  };

  const doPrint = async (r) => {
    const { data } = await supabaseDR.from('material_request_items')
      .select('*').eq('request_id', r.id).order('seq');
    const ok = await printMaterialRequest({ req: r, items: data || [] });
    if (!ok) toast.error('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต popup ของเว็บนี้ก่อน');
  };

  /* ── ตัวเลือกรหัสสินค้า (parts_master = ทะเบียนกลาง ตามกฎ CLAUDE.md) ── */
  const pickList = useMemo(() => {
    const q = pq.trim().toLowerCase();
    const src = q
      ? parts.filter(p => `${p.mat_no} ${p.part_name}`.toLowerCase().includes(q))
      : parts;
    return src.slice(0, 200);
  }, [parts, pq]);

  const applyPart = (p) => {
    if (picker?.itemKey) {
      setItem(picker.itemKey, { mat_no: p.mat_no, description: p.part_name || '', unit: p.uom || 'Pcs' });
    } else {
      setEditor(e => ({
        ...e,
        items: [...e.items, { ...EMPTY_ITEM(), mat_no: p.mat_no, description: p.part_name || '', unit: p.uom || 'Pcs' }],
      }));
    }
    setPicker(null); setPq('');
  };

  const wrap = { padding: '4px 2px' };

  return (
    <div style={wrap}>
      <ReadOnlyNote show={!canRecord} role={role} what="ออกใบเบิก/คืนสินค้าคงคลัง" permKey="scrap:record" />

      {warn && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12.5 }}>
          ⚠️ {warn}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
        <div>
          <label style={lblSt}>เดือน</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ width: 150, ...inpSt }} />
        </div>
        <div>
          <label style={lblSt}>สถานะ</label>
          <select value={fStatus} onChange={e => setFStatus(e.target.value)} style={{ width: 150, ...inpSt }}>
            <option value="">ทั้งหมด</option>
            {['draft', 'submitted', 'approved', 'issued', 'cancelled'].map(s =>
              <option key={s} value={s}>{statusMeta(s).label}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }} />
        {canRecord && <button onClick={openNew} style={btnSt('var(--accent)')}>＋ ออกใบเบิกใหม่</button>}
      </div>

      <InfoMore style={{ marginBottom: 10 }} id="mr_help"
        lead={<>📦 ใบนี้ใช้เบิกชิ้นงานจากฝ่ายผลิตไปทดสอบ — ของที่ทดสอบแล้วดึงเข้า<b>ใบรายงานของเสีย</b>ได้</>}>
        ที่หน้า <b>ใบรายงานของเสีย</b> กดปุ่ม “⤵ ดึงจากใบเบิก QA” แล้วเลือกใบ —
        รายการจะถูกเติมให้พร้อมผูกกลับมาที่ใบเบิกใบนี้ (สืบย้อนได้ว่าชิ้นไหนเบิกด้วยใบไหน)
        <br />⚠️ ดึงได้เฉพาะใบที่ <b>อนุมัติแล้ว</b> ขึ้นไป — ใบที่ยังไม่อนุมัติแปลว่ายังไม่ได้ของ
        จะรายงานว่าทำลายไปแล้วไม่ได้
        <br />จำนวนที่ดึงไปใช้ <b>“จำนวนที่จ่ายจริง”</b> ก่อนเสมอ ไม่มีค่อยใช้จำนวนที่ขอเบิก
      </InfoMore>

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลด...</div>
      ) : !visible.length ? (
        <div style={{ padding: 26, textAlign: 'center', color: 'var(--muted)', border: '1px dashed var(--border2)', borderRadius: 8 }}>
          ยังไม่มีใบเบิกในเดือนนี้{hidden > 0 && ` (ซ่อน ${hidden} ใบของส่วนงานอื่น)`}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 760 }}>
            <thead><tr>
              {['เลขที่', 'วันที่เบิก', 'ประเภท', 'ผู้ขอเบิก', 'หน่วยงาน', 'รายละเอียด', 'สถานะ', ''].map((h, i) =>
                <th key={i} style={thSt}>{h}</th>)}
            </tr></thead>
            <tbody>
              {visible.map(r => {
                const st = statusMeta(r.status);
                return (
                  <tr key={r.id}>
                    <td style={tdSt}><b>{r.doc_no || '—'}</b></td>
                    <td style={tdSt}>{r.request_date}</td>
                    <td style={tdSt}>{KIND_LABEL[r.kind] || r.kind}
                      <span style={{ color: 'var(--muted)', fontSize: 11 }}> · {moveLabel(r.kind, r.move_code)}</span></td>
                    <td style={tdSt}>{r.requester_name || '—'}</td>
                    <td style={tdSt}>{r.requester_dept || '—'}</td>
                    <td style={tdSt}>{r.detail || '—'}</td>
                    <td style={tdSt}>
                      <span style={{ color: st.color, fontWeight: 700 }}>{st.label}</span>
                      {isPullable(r) && <span title="ดึงเข้าใบรายงานของเสียได้" style={{ marginLeft: 4 }}>⤵</span>}
                    </td>
                    <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>
                      <button onClick={() => openEdit(r)} style={miniBtn}>{canRecord ? '✏️' : '👁'}</button>
                      <button onClick={() => doPrint(r)} style={miniBtn} title="พิมพ์ / PDF">🖨️</button>
                      {canRecord && r.status === 'draft' && <button onClick={() => setStatus(r, 'submitted')} style={miniBtn} title="ส่งขออนุมัติ">📤</button>}
                      {canManage && r.status === 'submitted' && <button onClick={() => setStatus(r, 'approved')} style={miniBtn} title="อนุมัติ">✅</button>}
                      {canRecord && r.status === 'approved' && <button onClick={() => setStatus(r, 'issued')} style={miniBtn} title="สโตร์จ่ายของแล้ว">📦</button>}
                      {canManage && <button onClick={() => remove(r)} style={miniBtn} title="ลบ">🗑</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {hidden > 0 && visible.length > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>ซ่อน {hidden} ใบของส่วนงานอื่น (ตามขอบเขตของบัญชีนี้)</div>
      )}

      {editor && (
        <Editor
          editor={editor} setReq={setReq} setItem={setItem} addItem={addItem} delItem={delItem}
          canRecord={canRecord} role={role} signers={signers} scopedLines={scopedLines}
          onPick={(k) => setPicker({ itemKey: k })}
          onClose={() => setEditor(null)} onSave={save}
        />
      )}

      {picker && (
        <Modal title="เลือกรหัสสินค้าคงคลัง (จากทะเบียนกลาง Parts Master)" dismissable onClose={() => { setPicker(null); setPq(''); }}>
          <input autoFocus value={pq} onChange={e => setPq(e.target.value)}
            placeholder="ค้นด้วยรหัส MAT หรือชื่อพาร์ท" style={{ ...inpSt, width: '100%', marginBottom: 8 }} />
          {!parts.length && (
            <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 8 }}>
              ⚠️ ยังไม่มีข้อมูลใน Parts Master — กรอกรหัส/ชื่อเองได้ในตาราง แล้วไปลงทะเบียนที่ Product Master → 🗂 Parts Master
            </div>
          )}
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {pickList.map(p => (
              <div key={p.mat_no} onClick={() => applyPart(p)}
                style={{ padding: '7px 9px', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 12.5 }}>
                <b>{p.mat_no}</b> <span style={{ color: 'var(--text2)' }}>{p.part_name}</span>
                {p.uom && <span style={{ color: 'var(--muted)', fontSize: 11 }}> · {p.uom}</span>}
              </div>
            ))}
            {!pickList.length && parts.length > 0 &&
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>ไม่พบรายการที่ตรงกับคำค้น</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ── ฟอร์มใบเบิก ─────────────────────────────────────────────────────────── */
function Editor({ editor, setReq, setItem, addItem, delItem, canRecord, role, signers, scopedLines, onPick, onClose, onSave }) {
  const { req, items } = editor;
  const moves = movesFor(req.kind);
  const needs = moveNeeds(req.kind, req.move_code);
  const ro = !canRecord;

  // เปลี่ยนประเภท (เบิก↔คืน) แล้วตัวเลือกย่อยชุดเดิมอาจไม่มีอยู่ → ล้างค่า (UI-CONVENTIONS §5.3)
  const changeKind = (k) => {
    const ok = movesFor(k).some(m => m.code === req.move_code);
    setReq({ kind: k, ...(ok ? {} : { move_code: movesFor(k)[0].code }) });
  };

  const pickSigner = (k, id) => {
    const p = signers.find(s => s.id === id);
    setReq({ [`${k}_name`]: p?.full_name || null, [`${k}_sig_url`]: p?.signature_url || null });
  };

  return (
    <Modal title={`${req.id ? 'แก้ไข' : 'ออก'}ใบขอ${KIND_LABEL[req.kind]}สินค้าคงคลัง (FM-STO-003)`} onClose={onClose} width={1020}>
      <ReadOnlyNote show={ro} role={role} compact what="แก้ใบเบิก" permKey="scrap:record" />

      {/* mgrid = กติกากลางของ grid ในโมดัล (UI-CONVENTIONS §4) — มือถือยุบเป็นคอลัมน์เดียว */}
      <div className="mgrid" style={grid3}>
        <F label="เลขที่เอกสาร"><input value={req.doc_no || ''} readOnly={ro} onChange={e => setReq({ doc_no: e.target.value })} style={inpSt} /></F>
        <F label="ประเภท">
          <select value={req.kind} disabled={ro} onChange={e => changeKind(e.target.value)} style={inpSt}>
            <option value="withdraw">ขอเบิก</option>
            <option value="return">ขอคืน</option>
          </select>
        </F>
        <F label="สถานะ"><input value={statusMeta(req.status).label} readOnly style={{ ...inpSt, color: statusMeta(req.status).color, fontWeight: 700 }} /></F>

        <F label="ชื่อผู้ขอเบิก"><input value={req.requester_name || ''} readOnly={ro} onChange={e => setReq({ requester_name: e.target.value })} style={inpSt} /></F>
        <F label="หน่วยงาน / ตำแหน่ง"><input value={req.requester_dept || ''} readOnly={ro} onChange={e => setReq({ requester_dept: e.target.value })} style={inpSt} /></F>
        <F label="ไลน์ที่ขอของ (ใช้จับคู่ใบของเสีย)">
          <select value={req.line_name || ''} disabled={ro} onChange={e => setReq({ line_name: e.target.value || null })} style={inpSt}>
            <option value="">— ไม่ระบุ —</option>
            {toHierarchicalOptions(scopedLines).map(({ line: l, depth }) =>
              <option key={l.id} value={l.name}>{' '.repeat(depth * 3)}{l.name}</option>)}
          </select>
        </F>

        <F label="วันที่เบิก *"><input type="date" value={req.request_date || ''} readOnly={ro} onChange={e => setReq({ request_date: e.target.value })} style={inpSt} /></F>
        <F label="วันที่ต้องการสินค้า"><input type="date" value={req.need_date || ''} readOnly={ro} onChange={e => setReq({ need_date: e.target.value })} style={inpSt} /></F>
        <F label={`ประเภทของการ${KIND_LABEL[req.kind]}`}>
          <select value={req.move_code || ''} disabled={ro} onChange={e => setReq({ move_code: e.target.value })} style={inpSt}>
            {moves.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
        </F>

        {/* ช่องข้างช่องติ๊กบนใบ — โผล่เฉพาะที่ประเภทนั้นต้องใช้ */}
        {needs === 'dest' && <F label="Storage Location ปลายทาง"><input value={req.dest_storage_location || ''} readOnly={ro} onChange={e => setReq({ dest_storage_location: e.target.value })} style={inpSt} /></F>}
        {needs === 'order' && <F label="Production Order"><input value={req.order_no || ''} readOnly={ro} onChange={e => setReq({ order_no: e.target.value })} style={inpSt} /></F>}
        {needs === 'cc' && <F label="Cost Center"><input value={req.cost_center || ''} readOnly={ro} onChange={e => setReq({ cost_center: e.target.value })} style={inpSt} /></F>}

        <F label="รหัสโรงงาน (Plant)"><input value={req.plant_code || ''} readOnly={ro} onChange={e => setReq({ plant_code: e.target.value })} style={inpSt} /></F>
        <F label="รหัสคลังสินค้า / สโตร์"><input value={req.storage_location || ''} readOnly={ro} onChange={e => setReq({ storage_location: e.target.value })} style={inpSt} /></F>
      </div>

      <F label="รายละเอียด" full>
        <input value={req.detail || ''} readOnly={ro} onChange={e => setReq({ detail: e.target.value })}
          placeholder="เช่น Test ประจำปี" style={{ ...inpSt, width: '100%' }} />
      </F>

      {/* ── รายการสินค้า ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 6px' }}>
        <b style={{ fontSize: 13 }}>รายการสินค้าคงคลัง</b>
        <span style={{ flex: 1 }} />
        {canRecord && <>
          <button onClick={() => onPick(null)} style={btnSt()}>🗂 เลือกจาก Parts Master</button>
          <button onClick={addItem} style={btnSt()}>＋ เพิ่มแถว</button>
        </>}
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
          <thead><tr>
            {['#', 'รหัสสินค้าคงคลัง', 'รายละเอียด', 'จำนวนที่ขอ', 'หน่วย', 'จ่าย/รับคืนจริง', 'วันที่ผลิต', 'Batch No.', ''].map((h, i) =>
              <th key={i} style={thSt}>{h}</th>)}
          </tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it._key}>
                <td style={tdSt}>{i + 1}</td>
                <td style={tdSt}>
                  <div style={{ display: 'flex', gap: 3 }}>
                    <input value={it.mat_no || ''} readOnly={ro} onChange={e => setItem(it._key, { mat_no: e.target.value })} style={{ ...inpSt, width: 100 }} />
                    {canRecord && <button onClick={() => onPick(it._key)} style={miniBtn} title="เลือกจากทะเบียน">🗂</button>}
                  </div>
                </td>
                <td style={tdSt}><input value={it.description || ''} readOnly={ro} onChange={e => setItem(it._key, { description: e.target.value })} style={{ ...inpSt, width: 230 }} /></td>
                <td style={tdSt}><input type="number" min="0" value={it.qty ?? ''} readOnly={ro} onChange={e => setItem(it._key, { qty: e.target.value })} style={{ ...inpSt, width: 72 }} /></td>
                <td style={tdSt}><input value={it.unit || ''} readOnly={ro} onChange={e => setItem(it._key, { unit: e.target.value })} style={{ ...inpSt, width: 54 }} /></td>
                <td style={tdSt}><input type="number" min="0" value={it.qty_issued ?? ''} readOnly={ro} onChange={e => setItem(it._key, { qty_issued: e.target.value })} style={{ ...inpSt, width: 84 }} /></td>
                <td style={tdSt}><input type="date" value={it.produced_date || ''} readOnly={ro} onChange={e => setItem(it._key, { produced_date: e.target.value })} style={{ ...inpSt, width: 130 }} /></td>
                <td style={tdSt}><input value={it.batch_no || ''} readOnly={ro} onChange={e => setItem(it._key, { batch_no: e.target.value })} style={{ ...inpSt, width: 90 }} /></td>
                <td style={tdSt}>{canRecord && <button onClick={() => delItem(it._key)} style={miniBtn}>🗑</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
        “จ่าย/รับคืนจริง” สโตร์เป็นคนกรอก — ใบรายงานของเสียจะยึดจำนวนนี้ก่อน ไม่มีค่อยใช้จำนวนที่ขอ
      </div>

      {/* ── ลายเซ็น ── */}
      <div style={{ margin: '14px 0 6px', fontSize: 13, fontWeight: 700 }}>ลายเซ็น</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {SIGS.map(s => (
          <div key={s.k} style={{ flex: '1 1 180px', minWidth: 170, border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 3 }}>
              {s.label} <span style={{ fontWeight: 400 }}>({s.group === 'req' ? 'ผู้เบิก/คืน' : 'ผู้จ่ายสินค้า'})</span>
            </div>
            <select disabled={ro} value={signers.find(x => x.full_name === req[`${s.k}_name`])?.id || ''}
              onChange={e => pickSigner(s.k, e.target.value)} style={{ ...inpSt, width: '100%' }}>
              <option value="">— เลือก —</option>
              {signers.map(x => <option key={x.id} value={x.id}>{x.full_name}</option>)}
            </select>
            <input type="date" disabled={ro} value={req[`${s.k}_date`] || ''}
              onChange={e => setReq({ [`${s.k}_date`]: e.target.value || null })} style={{ ...inpSt, width: '100%', marginTop: 4 }} />
            {req[`${s.k}_sig_url`] &&
              <img src={req[`${s.k}_sig_url`]} alt="" style={{ height: 26, marginTop: 4, background: '#fff', borderRadius: 4, padding: 2 }} />}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>
        ลายเซ็นดึงจากโปรไฟล์ผู้ใช้ — ใครยังไม่มีให้ไปบันทึกที่เมนูโปรไฟล์ → จัดการลายเซ็น
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button onClick={onClose} style={btnSt()}>ปิด</button>
        {canRecord && <>
          <button onClick={() => onSave()} style={btnSt()}>💾 บันทึก</button>
          {req.status === 'draft' &&
            <button onClick={() => onSave('submitted')} style={btnSt('var(--accent)')}>📤 บันทึก + ส่งขออนุมัติ</button>}
        </>}
      </div>
    </Modal>
  );
}

/* ── ชิ้นส่วน UI ─────────────────────────────────────────────────────────── */
const inpSt = { padding: '6px 8px', fontSize: 12.5, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)' };
const lblSt = { fontSize: 11, color: 'var(--muted)', fontWeight: 700, display: 'block', marginBottom: 3 };
const thSt = { padding: '6px 8px', textAlign: 'left', fontSize: 11, color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border2)' };
const tdSt = { padding: '4px 6px', fontSize: 12.5, color: 'var(--text)', borderBottom: '1px solid var(--border)', verticalAlign: 'middle' };
const miniBtn = { border: '1px solid var(--border2)', background: 'var(--bg3)', borderRadius: 6, cursor: 'pointer', fontSize: 12, padding: '3px 6px', marginRight: 3 };
const grid3 = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, marginBottom: 8 };
const btnSt = (accent) => ({
  padding: '7px 13px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  border: `1px solid ${accent || 'var(--border2)'}`,
  background: accent ? 'var(--accent-dim)' : 'var(--bg3)', color: accent || 'var(--text2)',
});

const F = ({ label, children, full }) => (
  <div style={full ? { gridColumn: '1 / -1' } : undefined}>
    <label style={lblSt}>{label}</label>
    {children}
  </div>
);

/* ⚠️ `dismissable` default = false — modal ที่มีฟอร์มกรอก **ห้ามปิดจากการคลิกพื้นหลัง**
   (UI-CONVENTIONS §5 · คำสั่ง user 2026-07-09: เผลอแตะแล้วข้อมูลที่พิมพ์อยู่หายทั้งฟอร์ม)
   ใบขอเบิก FM-STO-003 มีช่องกรอก ~20 ช่อง + ตารางรายการที่คีย์ทีละแถว = เสียหายจริง
   ส่วน popup เลือกของ (picker) ไม่มีอะไรให้เสีย จึงส่ง dismissable ได้ */
function Modal({ title, onClose, children, width = 620, dismissable = false }) {
  return (
    <div className="modal-scroll" onClick={dismissable ? onClose : undefined} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '3vh 12px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 14, width: `min(${width}px, 97vw)`, maxHeight: '94vh', overflowY: 'auto', padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
