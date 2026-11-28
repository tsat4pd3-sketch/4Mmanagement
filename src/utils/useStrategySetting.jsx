/* ══ 📘 Setting → กลยุทธ์ (ทุกกิจกรรม · 28/11) — อัปโหลด/เปลี่ยน/ลบ PDF · คืน { tools, body } ให้หน้าวาง (ดู `src/components/StrategyBook.jsx`) ══ */
import { useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from '../components/Toast';
import { Book } from '../components/StrategyBook';
import { tr } from './i18n';
import { uploadOpts } from './storageUpload';
import { checkWrite, checkWriteRows } from './dbWrite';
import { askConfirm } from './askConfirm';
import { actorFields } from './actorStamp';
import { fmtDateTime } from './dateFormat';
import { STRATEGY_BUCKET as BUCKET, assertStrategyPdf, useStrategy } from './strategyPdf';

export default /** Setting → กลยุทธ์ · คืน { tools, body } — หน้าเอา tools ไปวางที่ Tool Bar (เพิ่ม = อัปโหลด · แก้ไข = เปลี่ยนไฟล์ · ลบ) */
function useStrategySetting(code, title, canEdit) {
  const s = useStrategy(code);
  const file = useRef(null);
  const [busy, setBusy] = useState(false);
  const row = s.row;

  const remove = async () => {
    if (!row || !await askConfirm(`${tr('ลบเอกสารกลยุทธ์')} "${row.file_name || 'PDF'}" ${tr('ของ')} ${title} ?`)) return;
    const res = await supabase.from('act_strategy').delete().eq('activity', code).select('activity');
    if (!checkWriteRows(res, tr('ลบกลยุทธ์'))) return;
    if (row.file_path) { const rm = await supabase.storage.from(BUCKET).remove([row.file_path]); checkWrite(rm, tr('ลบไฟล์ PDF')); }
    toast.success(tr('ลบเอกสารกลยุทธ์แล้ว'));
    s.reload();
  };

  const upload = async (f) => {
    setBusy(true);
    try {
      const ok = await assertStrategyPdf(f);
      if (ok.error) { toast.error(tr(ok.error)); return; }
      const path = `strategy/${code}/${Date.now()}.pdf`;
      const up = await supabase.storage.from(BUCKET).upload(path, f, uploadOpts({ contentType: 'application/pdf' }));
      if (up.error) { toast.error(`${tr('อัปโหลดไม่สำเร็จ')}: ${up.error.message}`); return; }
      const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      const a = actorFields();
      const res = await supabase.from('act_strategy').upsert([{
        activity: code, url, file_path: path, file_name: f.name.slice(0, 200), pages: ok.pages, updated_at: new Date().toISOString(),
        ...(a.updated_by_name ? { updated_by_name: a.updated_by_name } : {}), ...(a.updated_by_uid ? { updated_by: a.updated_by_uid } : {}),
      }], { onConflict: 'activity' }).select('activity');
      if (!checkWriteRows(res, tr('บันทึกกลยุทธ์'))) { await supabase.storage.from(BUCKET).remove([path]); return; }
      /* ไฟล์เก่า: ลบหลังแถวใหม่บันทึกสำเร็จแล้วเท่านั้น (ลบพลาด = ไฟล์ค้าง ไม่กระทบจอ) */
      if (row?.file_path && row.file_path !== path) await supabase.storage.from(BUCKET).remove([row.file_path]);
      toast.success(`${tr('บันทึกกลยุทธ์แล้ว')} ${ok.pages} ${tr('หน้า')}`);
      s.reload();
    } finally { setBusy(false); }
  };

  const pick = () => file.current?.click();
  const why = !canEdit ? 'ไม่มีสิทธิ์แก้กลยุทธ์' : busy ? 'กำลังอัปโหลด…' : null;
  /* ป้ายเป็นไทยล้วน — ToolBar แปลตอนวาด */
  const tools = [
    { key: 'add', label: 'เพิ่ม', onClick: pick, disabled: !canEdit || busy || !!row, why: why || 'มีเอกสารแล้ว — ใช้ปุ่มแก้ไขเพื่อเปลี่ยนไฟล์' },
    { key: 'edit', label: 'แก้ไข', onClick: pick, disabled: !canEdit || busy || !row, why: why || 'ยังไม่มีเอกสาร — ใช้ปุ่มเพิ่ม' },
    { key: 'delete', label: 'ลบ', onClick: remove, disabled: !canEdit || busy || !row, why: why || 'ยังไม่มีเอกสาร' },
  ];

  const body = (
    <>
      <input ref={file} type="file" accept="application/pdf,.pdf" hidden aria-label={tr('ไฟล์ PDF กลยุทธ์')}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
      {s.err && <div style={{ color: 'var(--red)', fontSize: 13 }}>{s.err}</div>}
      {busy && <div style={{ fontSize: 13, color: 'var(--blue)' }}>{tr('กำลังตรวจและอัปโหลด PDF…')}</div>}
      {!canEdit && <div style={{ fontSize: 12, color: 'var(--amber)' }}>{tr('ดูอย่างเดียว — บัญชีนี้ยังไม่มีสิทธิ์แก้กลยุทธ์')}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
        <span style={{ fontWeight: 700, color: 'var(--text)' }}>{row ? (row.file_name || 'กลยุทธ์.pdf') : tr('เอกสารกลยุทธ์')}</span>
        <span style={{ color: 'var(--muted)' }}>
          {row ? `${row.pages} ${tr('หน้า')} · ${fmtDateTime(row.updated_at)}${row.updated_by_name ? ` · ${row.updated_by_name}` : ''}` : tr('PDF สัดส่วน 16:9 ไม่เกิน 5 หน้า · ไม่เกิน 20 MB')}
        </span>
      </div>
      {s.loading ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>{tr('กำลังโหลด…')}</div>
        : row ? <Book url={row.url} title={title} />
          : <div style={{ color: 'var(--muted)', fontSize: 13, padding: '24px 0' }}>{tr('ยังไม่มีเอกสารกลยุทธ์ — กดปุ่ม ➕ เพิ่ม บน Tool Bar เพื่ออัปโหลด PDF')}</div>}
    </>
  );
  return { tools, body, reload: s.reload };
}
