/* ✍️ ขั้นอนุมัติใบตรวจ QA — หัวหน้า QA 1 ขั้น (2026-11-19 · คำสั่ง user)
   กฎทั้งหมดอยู่ `utils/qaApproval.js` (ใช้เกณฑ์ชุดเดียวกับขั้น 2 ของใบ PM) — ไฟล์นี้วาดอย่างเดียว
   · ไม่บล็อกอะไร: ใบปิดตามกฎลำดับชิ้นเหมือนเดิม · แผงนี้เพิ่มแค่การเซ็นทบทวน
   · อนุมัติ = ถามยืนยันผ่าน `confirmSign` (บอก อนุมัติอะไร · ใบไหน · ในนามใคร)
   · ตีกลับ = ต้องพิมพ์เหตุผล (ช่องเหตุผลคือด่านอยู่แล้ว ไม่ถามซ้ำ)
   · เขียน DB นับแถวด้วย `checkWriteRows` (RLS ปฏิเสธ update = 0 แถวเงียบ)
   📄 docs/modules/qa-inspection.md §✍️ ขั้นอนุมัติใบตรวจ */
import { useState, useEffect, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from './Toast';
import { can } from '../utils/permissions';
import { positionRank } from '../utils/positions';
import { checkWriteRows } from '../utils/dbWrite';
import { confirmSign } from '../utils/signConfirm';
import { createNotification } from '../lib/pmNotify';
import { toneVar, toneDim, toneLine } from '../utils/statusTone';
import { QA_APPROVAL, QA_REJECT_MIN, qaApprovalState, qaApproveVerdict, qaApproveText, qaApproveAssumedText, qaRejectReasonValid } from '../utils/qaApproval';
import { tr, dateLocale } from '../utils/i18n';

const fmtAt = (iso) => (iso ? new Date(iso).toLocaleString(dateLocale(), { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' }) : '');
export const sheetLabel = (s) => `${s.part_no || '—'} · ${s.work_date} ${s.shift === 'day' ? tr('กะเช้า') : tr('กะดึก')} ${tr("รอบ")} ${s.round_no}`;

export default function QaSheetApproval({ sheet, onChanged }) {
  const { role, fullName, position: myPosition, isSharedAccount } = useContext(UserContext);
  const canManage = can('qa', 'manage', role);
  const [myUid, setMyUid] = useState(null);
  const [inspPos, setInspPos] = useState({ uid: null, position: null });
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { let alive = true; supabase.auth.getUser().then(({ data }) => { if (alive) setMyUid(data?.user?.id ?? null); }); return () => { alive = false; }; }, []);
  // ตำแหน่งคนตรวจ (คนเปิดใบ) — อ่านไม่ได้ = ไม่รู้ ⇒ ไม่บล็อกแต่จอบอก (`assumed`)
  const inspUid = sheet?.created_by_uid || null;
  useEffect(() => {
    let alive = true;
    if (!inspUid) { setInspPos({ uid: null, position: null }); return undefined; }
    supabase.from('profiles').select('position').eq('id', inspUid).maybeSingle()
      .then(({ data }) => { if (alive) setInspPos({ uid: inspUid, position: data?.position ?? null }); });
    return () => { alive = false; };
  }, [inspUid]);
  useEffect(() => { setRejecting(false); setReason(''); }, [sheet?.id]);

  const state = qaApprovalState(sheet);
  if (!state) return null;
  const meta = QA_APPROVAL[state];
  const verdict = qaApproveVerdict({
    sheet, canManage, myUid, isShared: !!isSharedAccount,
    myRank: positionRank(myPosition),
    inspectorRank: inspPos.uid === inspUid ? positionRank(inspPos.position) : null,
  });

  const write = async (patch, label) => {
    // ด่านซ้ำตอนเขียนจริง — ปุ่มซ่อนอย่างเดียวไม่พอ
    if (!verdict.ok) { toast.info(qaApproveText(verdict)); return null; }
    setBusy(true);
    const res = await supabase.from('qa_inspection_sheets').update(patch)
      .eq('id', sheet.id).eq('approval_status', 'pending').select('*');
    setBusy(false);
    if (!checkWriteRows(res, label, { zeroMsg: `${label}${tr("ไม่สำเร็จ — ใบนี้อาจถูกอนุมัติ/ตีกลับไปแล้ว หรือไม่มีสิทธิ์แก้ใบตรวจ")}` })) return null;
    return res.data?.[0] || null;
  };

  const approve = async () => {
    const ok = await confirmSign({
      what: 'อนุมัติใบตรวจ QA', docLabel: 'ใบตรวจ', orderNo: sheetLabel(sheet),
      actor: fullName || '—', as: 'หัวหน้า QA',
      effect: 'ใบนี้ขึ้นสถานะ "อนุมัติแล้ว" — ผลตรวจในใบไม่เปลี่ยน',
    });
    if (!ok) return;
    const row = await write({ approval_status: 'approved', approved_by_uid: myUid, approved_by_name: fullName || null, approved_at: new Date().toISOString(), reject_reason: null }, 'อนุมัติใบตรวจ');
    if (!row) return;
    toast.success('อนุมัติใบตรวจแล้ว');
    if (row.created_by_uid && row.created_by_uid !== myUid) {
      createNotification(row.created_by_uid, { title: 'ใบตรวจ QA ได้รับการอนุมัติ', body: sheetLabel(row), type: 'success', refTable: 'qa_inspection_sheets', refId: row.id, link: `/qa?tab=sheet&sheet=${row.id}` })
        .catch(e => toast.info(`${tr("อนุมัติแล้ว แต่แจ้งคนตรวจไม่สำเร็จ")}: ${e.message}`));
    }
    onChanged?.(row);
  };

  const reject = async () => {
    if (!qaRejectReasonValid(reason)) { toast.error(`${tr("ต้องพิมพ์เหตุผลอย่างน้อย")} ${QA_REJECT_MIN} ${tr("ตัวอักษร")}`); return; }
    const row = await write({ approval_status: 'rejected', approved_by_uid: myUid, approved_by_name: fullName || null, approved_at: new Date().toISOString(), reject_reason: reason.trim() }, 'ตีกลับใบตรวจ');
    if (!row) return;
    toast.success('ตีกลับใบตรวจแล้ว');
    if (row.created_by_uid && row.created_by_uid !== myUid) {
      createNotification(row.created_by_uid, { title: 'ใบตรวจ QA ถูกตีกลับ', body: `${sheetLabel(row)} — ${row.reject_reason}`, type: 'error', refTable: 'qa_inspection_sheets', refId: row.id, link: `/qa?tab=sheet&sheet=${row.id}` })
        .catch(e => toast.info(`${tr("ตีกลับแล้ว แต่แจ้งคนตรวจไม่สำเร็จ")}: ${e.message}`));
    }
    onChanged?.(row);
  };

  const assumedTxt = state === 'pending' && verdict.ok ? qaApproveAssumedText(verdict.assumed) : '';
  const blockTxt = state === 'pending' && canManage && !verdict.ok ? qaApproveText(verdict) : '';

  return (
    <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: toneDim(meta.tone), border: `1px solid ${toneLine(meta.tone)}`,
      display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <b style={{ color: toneVar(meta.tone), fontSize: 13 }}>✍️ {tr(meta.label)}</b>
      {state !== 'pending' && (
        <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>
          {sheet.approved_by_name || '—'} · {fmtAt(sheet.approved_at)}
          {state === 'rejected' && sheet.reject_reason ? ` — ${tr('เหตุผล')}: ${sheet.reject_reason}` : ''}
        </span>
      )}
      {state === 'pending' && !canManage && <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>{tr('ใบปิดแล้ว ผลิตเดินต่อได้ตามปกติ — รอหัวหน้า QA เซ็นทบทวน')}</span>}
      {blockTxt && <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>{tr(blockTxt)}</span>}
      {assumedTxt && <span style={{ fontSize: 12, color: 'var(--amber)' }}>{tr(assumedTxt)}</span>}
      {state === 'pending' && verdict.ok && (
        <span style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
          {!rejecting && <button type="button" className="tbtn" disabled={busy} onClick={approve}
            style={{ padding: '6px 14px', fontSize: 12.5, fontWeight: 800, color: 'var(--green)', borderColor: 'var(--green-line)' }}>{tr('✓ อนุมัติ')}</button>}
          {!rejecting && <button type="button" className="tbtn" disabled={busy} onClick={() => setRejecting(true)}
            style={{ padding: '6px 14px', fontSize: 12.5, fontWeight: 700, color: 'var(--red)', borderColor: 'var(--red-line)' }}>{tr('↩ ตีกลับ')}</button>}
        </span>
      )}
      {rejecting && (
        <div style={{ flexBasis: '100%', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input id="qa-reject-reason" value={reason} onChange={e => setReason(e.target.value)} autoFocus
            placeholder={tr(`เหตุผลที่ตีกลับ (อย่างน้อย ${QA_REJECT_MIN} ตัวอักษร)`)}
            style={{ flex: 1, minWidth: 200, padding: '7px 10px', borderRadius: 8, fontSize: 13, background: 'var(--bg3-surf)', border: '1px solid var(--border2)', color: 'var(--text)' }} />
          <button type="button" className="tbtn" disabled={busy || !qaRejectReasonValid(reason)} onClick={reject}
            style={{ padding: '6px 14px', fontSize: 12.5, fontWeight: 800, color: 'var(--red)', borderColor: 'var(--red-line)' }}>{tr('ยืนยันตีกลับ')}</button>
          <button type="button" className="tbtn" disabled={busy} onClick={() => { setRejecting(false); setReason(''); }}
            style={{ padding: '6px 12px', fontSize: 12.5 }}>{tr('ยกเลิก')}</button>
        </div>
      )}
    </div>
  );
}

/* 📋 แถบ "ใบรออนุมัติ" — ให้เห็นว่าค้างกี่ใบ (ไม่บล็อกอะไร · user 19/11)
   · ขอบเขต = ไลน์ที่หน้านี้เห็นอยู่ (`scopedLineNames` · null = ทั้งโรงงาน) · ใบที่ไม่ผูกไลน์เห็นเสมอ
   · อ่านไม่ได้ = เขียนบอก ห้ามโชว์ "ไม่มีใบค้าง" (จอโกหก) · เพดาน 200 ใบ — เกินต้องบอก */
const PENDING_CAP = 200;
export function QaApprovalPendingBar({ scopedLineNames, onOpen, reloadKey }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const scopeKey = scopedLineNames ? scopedLineNames.join('|') : '*';
  useEffect(() => {
    let alive = true;
    supabase.from('qa_inspection_sheets')
      .select('id, part_id, part_no, line_name, work_date, shift, round_no, closed_at')
      .eq('approval_status', 'pending').order('work_date', { ascending: false }).limit(PENDING_CAP)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) { setErr(error.message); setRows(null); return; }
        setErr('');
        const ok = scopeKey === '*' ? null : new Set(scopeKey.split('|'));
        setRows((data || []).filter(r => !ok || !r.line_name || ok.has(r.line_name)));
      });
    return () => { alive = false; };
  }, [scopeKey, reloadKey]);

  if (err) return <div style={{ fontSize: 12.5, color: 'var(--amber)', margin: '0 0 10px' }}>{tr('อ่านรายการใบรออนุมัติไม่ได้')}: {err}</div>;
  if (!rows || rows.length === 0) return null;
  return (
    <div style={{ margin: '0 0 10px', padding: '8px 12px', borderRadius: 10, background: toneDim('warn'), border: `1px solid ${toneLine('warn')}` }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: toneVar('warn'), fontWeight: 800, fontSize: 13 }}>
        ✍️ {tr('ใบตรวจรอหัวหน้า QA อนุมัติ')} {rows.length}{rows.length >= PENDING_CAP ? '+' : ''} {tr('ใบ')} {open ? '▴' : '▾'}
      </button>
      {rows.length >= PENDING_CAP && <span style={{ fontSize: 12, color: 'var(--text2)', marginLeft: 8 }}>{tr(`แสดง ${PENDING_CAP} ใบล่าสุด`)}</span>}
      {open && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {rows.map(r => (
            <button key={r.id} type="button" className="tbtn" onClick={() => onOpen?.(r)}
              style={{ padding: '5px 10px', fontSize: 12 }}>
              {sheetLabel(r)}{r.line_name ? ` · ${r.line_name}` : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
