import { useState, useEffect, useCallback } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import { checkWrite } from '../utils/dbWrite';
import { mailsMissingFiles } from '../utils/mailInbox';

/* ─── 📬 ไฟล์จากเมลรอนำเข้า (2026-09-30) ─────────────────────────────────────
   แถวในคิว `demand_mail_inbox` (DR) เกิดจากสคริปต์ Outlook บนเครื่อง user
   (tools/outlook-mail-ingest) → Edge Function `ingest-demand-mail`
   กด "เปิด" = ดาวน์โหลดไฟล์แล้วส่งเข้า **ตัวอ่านเดิมของหน้า** (`onOpen(files, rows)`)
   🔴 แผงนี้ไม่แกะไฟล์เอง ห้ามเขียนตรรกะ 830/862 ซ้ำที่นี่
   🔴 ค้างเกิน 24 ชม. = ขึ้นแดง (ห้ามกองเงียบ) · ว่าง = บอกว่าว่าง ไม่ซ่อนแผง
   เอกสาร: docs/modules/logistic-planner-sales.md §📬 ดึงไฟล์จากเมล */

const STALE_H = 24;
/** ชนิดไฟล์จากชื่อ (`830_…` / `862_…`) — ไว้เทียบว่าใบไหนใหม่กว่า · ไม่รู้ = null (ไม่เตือน) */
const kindOf = (name) => (String(name || '').match(/^(830|862)[_ .-]/) || [])[1] || null;
const tsOf = (r) => new Date(r.received_at || r.created_at).getTime();
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', {
  timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
}) : '—');

export default function DemandMailInbox({ refreshKey, onOpen, fullName }) {
  const [rows, setRows] = useState([]);
  const [latestDone, setLatestDone] = useState({});
  const [missing, setMissing] = useState([]);         // เมลที่หัวเรื่องบอกว่ามีไฟล์ แต่ไฟล์ไม่มาถึง   // ชนิด → เวลาเมลของฉบับล่าสุดที่นำเข้าแล้ว
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await supabaseDR.from('demand_mail_inbox')
      .select('id, file_name, subject, sender, received_at, size_bytes, storage_path, created_at')
      .eq('status', 'pending').order('received_at', { ascending: false }).limit(30);
    setErr(error ? error.message : null);
    setRows(data || []);
    /* 🔴 ฉบับเก่ากว่าที่นำเข้าไปแล้ว = ห้ามนำเข้าทับ — 862 แทนที่ใบ pending ทั้งช่วง
       ⇒ ไฟล์ 25/09 ที่นำเข้าหลังไฟล์ 01/10 จะดึงออเดอร์ถอยหลังกลับไป (เปิดเครื่องทีหลังแล้วเมลค้างหลายฉบับ = เกิดได้จริง) */
    const { data: done } = await supabaseDR.from('demand_mail_inbox')
      .select('file_name, received_at, created_at').eq('status', 'imported')
      .order('received_at', { ascending: false }).limit(20);
    const latest = {};
    (done || []).forEach(r => { const k = kindOf(r.file_name); if (k && !(latest[k] >= tsOf(r))) latest[k] = tsOf(r); });
    setLatestDone(latest);
    /* 📭 หัวเรื่องบอก "830 & 862" แต่ไฟล์มาไม่ครบ = ห้ามเงียบ (05/10 ได้แค่ 830 · บอร์ดถือแผนเก่าโดยไม่มีใครรู้)
       ดู 7 วันล่าสุดทุกสถานะ ⇒ เมลที่นำเข้าไปแล้วก็ยังเตือนได้ว่าขาดอีกไฟล์ */
    const since = new Date(Date.now() - 15 * 86400000).toISOString();   // เผื่อรอบ 830 (ทั้งสัปดาห์) ของเมลเก่าสุดในจอ
    const { data: recent, error: eRecent } = await supabaseDR.from('demand_mail_inbox')
      .select('message_id, subject, file_name, received_at').gte('received_at', since).limit(200);
    /* นำเข้าเอง (ลากไฟล์) ก็นับว่าได้ของแล้ว — 862 = kind 'orders' · 830 = 'forecast' */
    const { data: batches, error: eB } = await supabaseDR.from('demand_upload_batches')
      .select('kind, file_name, uploaded_at').gte('uploaded_at', new Date(Date.now() - 15 * 86400000).toISOString()).limit(200);
    const imports = (batches || []).filter(b => /^EDI /.test(b.file_name || '')).map(b => ({ kind: b.kind === 'orders' ? '862' : b.kind === 'forecast' ? '830' : null, at: b.uploaded_at }));
    setMissing(eRecent || eB ? [] : mailsMissingFiles(recent || [], { imports }).slice(0, 3));
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const open = async (r) => {
    setBusy(r.id);
    try {
      const { data, error } = await supabaseDR.storage.from('demand-mail').download(r.storage_path);
      if (error) throw error;
      await onOpen([new File([data], r.file_name)], [r]);
    } catch (e) { toast.error(`เปิดไฟล์จากเมลไม่ได้: ${e.message}`); }
    setBusy(null);
  };

  const skip = async (r) => {
    const note = window.prompt(`ข้ามไฟล์ ${r.file_name} — เหตุผล (เช่น ไฟล์ซ้ำ/นำเข้ามือไปแล้ว)`);
    if (note == null) return;
    const res = await supabaseDR.from('demand_mail_inbox')
      .update({ status: 'skipped', note: note || null, handled_by: fullName || null, handled_at: new Date().toISOString() })
      .eq('id', r.id).select('id');
    if (!checkWrite(res, 'ข้ามไฟล์จากเมล')) return;
    if (!res.data?.length) { toast.error('บันทึกไม่สำเร็จ (0 แถว)'); return; }
    load();
  };

  const now = Date.now();
  /** ใบนี้มีฉบับใหม่กว่า (ในคิว หรือ นำเข้าไปแล้ว) ไหม */
  const newerOf = (r) => {
    const k = kindOf(r.file_name);
    if (!k) return null;
    if (latestDone[k] > tsOf(r)) return 'นำเข้าฉบับใหม่กว่าไปแล้ว';
    if (rows.some(o => o.id !== r.id && kindOf(o.file_name) === k && tsOf(o) > tsOf(r))) return 'มีฉบับใหม่กว่าในคิว';
    return null;
  };
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginBottom: 12, background: 'var(--bg2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: rows.length ? 8 : 0 }}>
        <span style={{ fontWeight: 800, fontSize: 13, color: 'var(--text)' }}>📬 ไฟล์จากเมลรอนำเข้า</span>
        <span style={{ fontSize: 12, color: rows.length ? 'var(--accent2)' : 'var(--muted)', fontWeight: 700 }}>
          {err ? '' : rows.length ? `${rows.length} ไฟล์` : 'ไม่มีไฟล์ค้าง'}
        </span>
        <button type="button" onClick={load} style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 10px', borderRadius: 6,
          background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text2)', cursor: 'pointer' }}>↻</button>
      </div>
      {err && <div style={{ fontSize: 12, color: '#ef4444' }}>⚠ โหลดคิวไฟล์จากเมลไม่ได้: {err}</div>}
      {missing.map(m => (
        <div key={m.message_id || m.subject} style={{ fontSize: 12, color: '#ef4444', fontWeight: 700, marginTop: 4,
          padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.5)', background: 'var(--card)' }}>
          📭 เมล "{m.subject}" ({fmtTime(m.received_at)}) หัวเรื่องบอกว่ามีไฟล์ {m.missing.join(' + ')} แต่ระบบได้รับแค่
          {m.got.length ? ` ${m.got.join(' + ')}` : 'ไม่มีไฟล์'} — ข้อมูล {m.missing.join('/')} ของวันนั้นยังไม่เข้าระบบ ·
          เช็คเมลต้นทางว่าแนบมาครบไหม (ชื่อไฟล์ต้องขึ้นต้น {m.missing.map(k => `${k}_`).join(' / ')}) หรือลากไฟล์มาอัพเองด้านล่าง
        </div>
      ))}
      {rows.map(r => {
        const ageH = (now - new Date(r.received_at || r.created_at).getTime()) / 3600000;
        const newer = newerOf(r);
        const stale = ageH > STALE_H && !newer;
        return (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 8px',
            borderRadius: 8, marginTop: 4, background: 'var(--card)',
            border: `1px solid ${stale ? 'rgba(239,68,68,0.5)' : 'var(--border)'}` }}>
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>📄 {r.file_name}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {fmtTime(r.received_at)} · {r.sender || '—'} · {r.subject || ''}
              </div>
            </div>
            {newer && <span style={{ fontSize: 12, color: 'var(--accent2)', fontWeight: 700 }}
              title="ไฟล์ 862/830 ฉบับใหม่แทนที่ฉบับเก่าทั้งช่วง — นำเข้าฉบับเก่าทีหลังจะดึงยอดถอยหลัง">⚠ {newer} — ควรกดข้าม</span>}
            {stale && <span style={{ fontSize: 12, color: '#ef4444', fontWeight: 700 }}>ค้าง {Math.floor(ageH)} ชม.</span>}
            <button type="button" disabled={busy === r.id} onClick={() => {
              if (newer && !window.confirm(`${r.file_name}: ${newer}\nนำเข้าฉบับเก่าจะแทนที่ข้อมูลที่ใหม่กว่า — ยืนยันเปิด?`)) return;
              open(r);
            }}
              style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
                background: 'var(--accent)', color: 'var(--accent-ink)', border: '1px solid var(--accent)' }}>
              {busy === r.id ? 'กำลังเปิด…' : '📥 เปิดเพื่อนำเข้า'}
            </button>
            <button type="button" onClick={() => skip(r)}
              style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                background: 'var(--bg2)', color: 'var(--text2)', border: '1px solid var(--border)' }}>ข้าม</button>
          </div>
        );
      })}
    </div>
  );
}
