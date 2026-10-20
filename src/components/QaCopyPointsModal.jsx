/**
 * QaCopyPointsModal — 📋 คัดลอกจุดตรวจของพาร์ทนี้ ไป "พาร์ทอื่น" ทีละหลายพาร์ท (/qa-setup · 2026-10-19)
 * คู่กับ PM "คัดลอกไปเครื่องอื่น" — หลักเดียวกัน ระบบเดียว (📄 docs/modules/inspection-point-setup.md)
 * ตัวเขียนจริง = `copyQaPointsToParts()` (`lib/qaPointsCopy.js`)
 *
 * 🔴 ปลายทางที่แก้ได้ = พาร์ทในไลน์ส่วนงานตัวเอง (`canWriteLine`) — ตัวที่แก้ไม่ได้ยังโชว์ (จาง) พร้อมเหตุผล
 *    และเช็คซ้ำตอนกดคัดลอก (ช่องติ๊กเป็นแค่ตัวเลือก ไม่ใช่ด่าน)
 * 🔴 ผลรายพาร์ท — สำเร็จ/ข้ามเพราะอะไร ห้ามสรุปก้อนเดียว
 */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { canWriteLine, writeBlockText } from '../utils/writeScope';
import { copyQaPointsToParts } from '../lib/qaPointsCopy';
import { QA_COPY_SKIP } from '../utils/qaPointCopy';
import InspectEditorModal from './inspect/InspectEditorModal';
import SearchInput from './SearchInput';
import { toast } from './Toast';

const partLabel = (p) => p?.part_no || p?.part_name || 'ชิ้นงาน';
const rowSt = (on, dim) => ({
  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, cursor: dim ? 'not-allowed' : 'pointer',
  background: on ? 'var(--accent-dim)' : 'var(--bg3)', border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
  opacity: dim ? 0.55 : 1,
});

export default function QaCopyPointsModal({ part, itemCount, parts, lines, wctx, onClose, onDone, onOpenPart }) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState([]);
  const [withDrawings, setWithDrawings] = useState(false);
  const [counts, setCounts] = useState(null);       // { [partId]: { items, dwgs } } · null = กำลังโหลด · ค่า null รายตัว = นับไม่ได้
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);

  const others = useMemo(() => parts.filter(p => p.id !== part.id), [parts, part.id]);
  const otherIds = others.map(p => p.id).join(',');

  /* นับจุดตรวจ/แผ่นแบบของปลายทาง — เพื่อบอกล่วงหน้าว่าตัวไหนจะถูกข้าม (ตัวคัดลอกเช็คซ้ำเองอีกชั้น) */
  useEffect(() => {
    let alive = true;
    const ids = otherIds ? otherIds.split(',') : [];
    (async () => {
      const head = (t, id) => supabase.from(t).select('id', { count: 'exact', head: true }).eq('part_id', id);
      const res = await Promise.all(ids.map(async id => {
        const [a, b] = await Promise.all([head('qa_inspection_items', id), head('qa_part_drawings', id)]);
        return [id, { items: a.error ? null : a.count, dwgs: b.error ? null : b.count }];
      }));
      if (alive) setCounts(Object.fromEntries(res));
    })();
    return () => { alive = false; };
  }, [otherIds, report]);

  const writeOf = (p) => canWriteLine(wctx, p.line_name, lines);
  const shown = others.filter(p => {
    const q = search.trim().toLowerCase();
    return !q || [p.part_no, p.part_name, p.customer, p.model, p.line_name].some(v => (v || '').toLowerCase().includes(q));
  });
  const blockedN = others.filter(p => !writeOf(p).ok).length;

  const toggle = (p) => {
    const w = writeOf(p);
    if (!w.ok) { toast.info(writeBlockText(w, { what: 'พาร์ทของไลน์นี้' })); return; }
    if (counts?.[p.id]?.items > 0) { toast.info(`${partLabel(p)} มีจุดตรวจอยู่แล้ว — จะไม่ทับ แก้ที่พาร์ทนั้นแทน`); return; }
    setPicked(s => s.includes(p.id) ? s.filter(x => x !== p.id) : [...s, p.id]);
  };

  const run = async () => {
    // 🔐 ด่านซ้ำตอนกดจริง — คัดเฉพาะพาร์ทที่ยังแก้ได้ ณ ตอนนี้
    const targets = others.filter(p => picked.includes(p.id) && writeOf(p).ok);
    if (!targets.length) { toast.info('เลือกพาร์ทปลายทางก่อน'); return; }
    if (!window.confirm(
      `คัดลอก ${itemCount} จุดตรวจของ ${partLabel(part)} ไปอีก ${targets.length} พาร์ท\n`
      + (withDrawings ? '+ แผ่นแบบ (เฉพาะพาร์ทที่ยังไม่มีแบบ — หมุดอยู่ตำแหน่งเดิม)\n' : '(ไม่คัดลอกแบบ — ต้องปักหมุดใหม่บนแบบของพาร์ทนั้น)\n')
      + '\n⚠️ พาร์ทที่ "มีจุดตรวจอยู่แล้ว" จะถูกข้าม ไม่ทับของเดิม\n\nยืนยัน?')) return;
    setBusy(true); setReport(null);
    try {
      const { results } = await copyQaPointsToParts(part.id, targets.map(p => p.id), { withDrawings });
      const nameOf = id => partLabel(others.find(p => p.id === id)) || id;
      setReport(results.map(r => ({ ...r, label: nameOf(r.partId) })));
      if (results.some(r => r.copied)) { setPicked([]); onDone?.(); }
    } catch (e) {
      toast.error(`คัดลอกไม่สำเร็จ: ${e.message}`);
    } finally { setBusy(false); }
  };

  const ok = (report || []).filter(r => r.copied);
  const skip = (report || []).filter(r => !r.copied);

  return (
    <InspectEditorModal title={`📋 คัดลอกจุดตรวจของ ${partLabel(part)} ไปพาร์ทอื่น`}
      subtitle={`${itemCount} จุด · สเปค/Rank/Stage/ความถี่ไปครบ · รูปโคลสอัพคัดลอกไปด้วย`}
      onClose={onClose} onSave={run} saving={busy}
      saveLabel={picked.length ? `📋 คัดลอกไป ${picked.length} พาร์ท` : 'เลือกพาร์ทปลายทาง'}>
      <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
        ใช้กับพาร์ทพี่น้องที่สเปคเหมือนกัน (เช่น RH/LH · ต่างลูกค้า) — ตั้งพาร์ทเดียวแล้วคัดลอก ไม่ต้องพิมพ์ซ้ำ
        <br />📍 <b>หมุด</b>: พาร์ทปลายทางใช้แบบคนละแผ่น ⇒ หมุดถูกถอดออก จุดตรวจขึ้นเป็น "ยังไม่วางตำแหน่ง" ให้ปักใหม่ใน 🎯
      </div>

      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, cursor: 'pointer' }}>
        <input type="checkbox" checked={withDrawings} onChange={e => setWithDrawings(e.target.checked)} style={{ marginTop: 3 }} />
        <span>คัดลอก<b>แผ่นแบบ (Drawing)</b> ไปด้วย — เฉพาะพาร์ทที่ยังไม่มีแบบเลย · หมุดอยู่ตำแหน่งเดิม
          <span style={{ color: 'var(--muted)' }}> (ใช้เมื่อแบบเป็นแผ่นเดียวกันจริง · พาร์ทที่มีแบบอยู่แล้วไม่ถูกแตะ)</span></span>
      </label>

      <SearchInput value={search} onChange={setSearch} grow={false} placeholder="ค้น Part No. / ชื่อ / ลูกค้า / ไลน์..." />
      {blockedN > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>🔒 {blockedN} พาร์ทอยู่ไลน์นอกส่วนงานของคุณ — แสดงจาง เลือกไม่ได้</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 6, alignContent: 'start' }}>
        {shown.map(p => {
          const c = counts?.[p.id];
          const w = writeOf(p);
          const has = c?.items > 0;
          const on = picked.includes(p.id);
          return (
            <div key={p.id} role="checkbox" aria-checked={on} tabIndex={0} style={rowSt(on, !w.ok || has)}
              onClick={() => toggle(p)} onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(p); } }}>
              <span style={{ fontSize: 15 }}>{on ? '☑️' : '⬜'}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{partLabel(p)}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {[p.part_name, p.line_name].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <span style={{ fontSize: 11, color: has ? 'var(--accent2)' : 'var(--muted)', whiteSpace: 'nowrap', textAlign: 'right' }}>
                {!counts ? '…' : c?.items == null ? 'นับไม่ได้' : has ? `มี ${c.items} จุดแล้ว` : 'ยังไม่มีจุด'}
                {counts && c?.dwgs != null && <><br />แบบ {c.dwgs} แผ่น</>}
              </span>
            </div>
          );
        })}
        {!shown.length && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{others.length ? 'ไม่พบพาร์ทที่ค้น' : 'ยังไม่มีพาร์ทอื่นในทะเบียน'}</div>}
      </div>

      {report && (
        <div style={{ fontSize: 12, lineHeight: 1.8, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
          <b style={{ color: 'var(--accent)' }}>✅ คัดลอกสำเร็จ {ok.length} พาร์ท</b>
          {ok.map(r => (
            <div key={r.partId}>
              · {r.label} — {r.count} จุด{r.drawings ? ` + แบบ ${r.drawings} แผ่น (หมุดตามเดิม)` : ' · ต้องปักหมุดใหม่'}
              {onOpenPart && <button onClick={() => onOpenPart(r.partId)} style={{ marginLeft: 8, fontSize: 11, padding: '1px 8px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--card)', color: 'var(--text2)', cursor: 'pointer' }}>เปิดพาร์ทนี้ →</button>}
            </div>
          ))}
          {!!skip.length && (
            <div style={{ color: 'var(--accent2)', marginTop: 3 }}>
              ⚠️ ข้าม {skip.length} พาร์ท — {skip.map(r => `${r.label} (${QA_COPY_SKIP[r.reason] || r.reason}${r.message ? `: ${r.message}` : ''})`).join(' · ')}
            </div>
          )}
        </div>
      )}
    </InspectEditorModal>
  );
}
