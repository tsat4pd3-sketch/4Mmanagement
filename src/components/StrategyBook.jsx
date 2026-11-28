/* ══ 📘 กลยุทธ์ของกิจกรรม — PDF 16:9 ไม่เกิน 5 หน้า (2026-11-28 · คำสั่ง user · ยกแบบจากระบบ Core) ═══════════════
   · ทุกกิจกรรมใช้ตัวนี้: Dashboard → กลยุทธ์ = `<StrategyBook>` (เปิดแบบ e-book) · Setting → กลยุทธ์ = `useStrategySetting()`
     (Tool Bar: เพิ่ม = อัปโหลด · แก้ไข = เปลี่ยนไฟล์ · ลบ)
   · ข้อมูล: ตาราง `act_strategy` (1 แถวต่อกิจกรรม · คีย์ = รหัส act01–act09) + ไฟล์ bucket `act-public` (อ่านสาธารณะ)
   · ตรวจก่อนอัป: เป็น PDF · ≤ 20 MB (เพดาน bucket) · 1–5 หน้า · ทุกหน้า 16:9 แนวนอน (±2%) — ไม่ผ่าน = ไม่อัป + บอกเหตุผล
   · PDF ไม่บีบ (ไม่ใช่รูป) — เพดานขนาด/หน้าคือตัวคุม egress (ทะเบียน UPLOAD_SITES ใน regressionGuards)
   · สิทธิ์เขียน = RLS `has_perm('act_5s:manage')` ของ act_strategy + storage (ชั่วคราวทุกกิจกรรม จนกว่ากิจกรรมนั้นมีคีย์ของตัวเอง)
   · pdfjs โหลดเฉพาะตอนเปิดกลยุทธ์ (import แบบ lazy) — หน้าอื่น/จอ TV ไม่โหลด */
import { useCallback, useEffect, useRef, useState } from 'react';
import { tr } from '../utils/i18n';
import { pagesOf, useStrategy } from '../utils/strategyPdf';

const btn = { width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--border2)', background: 'var(--card)', color: 'var(--text)', cursor: 'pointer', fontSize: 20, lineHeight: 1, display: 'grid', placeItems: 'center', boxShadow: 'var(--shadow-sm)' };

/** e-book: หน้าเดียว 16:9 · ◀ ▶ / ปุ่มลูกศรคีย์บอร์ด / รูปย่อ · เต็มจอ */
export function Book({ url, title }) {
  const [got, setGot] = useState({ url: null, list: [], err: '' });
  const [at, setAt] = useState({ url: null, n: 0 });
  const box = useRef(null);
  useEffect(() => {
    let alive = true;
    pagesOf(url).then(list => alive && setGot({ url, list, err: '' }), () => alive && setGot({ url, list: [], err: 'เปิดเอกสาร PDF ไม่ได้' }));
    return () => { alive = false; };
  }, [url]);
  const list = got.url === url ? got.list : [];
  const cur = at.url === url ? at.n : 0;
  const go = useCallback((n) => { if (n >= 0 && n < list.length) setAt({ url, n }); }, [list.length, url]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.closest?.('input, textarea, select, [role="dialog"], .modal')) return;
      if (e.key === 'ArrowRight') go(cur + 1);
      if (e.key === 'ArrowLeft') go(cur - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cur, go]);
  if (got.url !== url) return <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>{tr('กำลังเปิดเอกสาร…')}</div>;
  if (got.err || !list.length) return <div style={{ padding: 16, color: 'var(--red)', fontSize: 13 }}>{tr('เปิดเอกสาร PDF ไม่ได้')}</div>;
  const full = () => (document.fullscreenElement ? document.exitFullscreen() : box.current?.requestFullscreen?.());
  const wide = { width: '100%', maxWidth: 'min(1280px, calc((100vh - 300px) * 16 / 9))', margin: '0 auto' };
  return (
    <div ref={box} style={{ display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ ...wide, position: 'relative' }}>
        {[-1, 1].map(d => {
          const off = d < 0 ? cur === 0 : cur === list.length - 1;
          return (
            <button key={d} type="button" aria-label={tr(d < 0 ? 'หน้าก่อน' : 'หน้าถัดไป')} onClick={() => go(cur + d)} disabled={off}
              style={{ ...btn, position: 'absolute', top: '50%', transform: 'translateY(-50%)', [d < 0 ? 'left' : 'right']: 10, zIndex: 1, opacity: off ? 0 : 1, cursor: off ? 'default' : 'pointer' }}>
              {d < 0 ? '‹' : '›'}
            </button>
          );
        })}
        <img key={cur} src={list[cur]} alt={`${title} ${tr('หน้า')} ${cur + 1}`}
          style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', objectFit: 'contain', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'var(--card)', boxShadow: 'var(--shadow-sm)', }} />
      </div>
      <div style={{ ...wide, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, flex: 1, minWidth: 0, overflowX: 'auto', padding: '2px 0' }}>
          {list.map((src, i) => (
            <button key={i} type="button" aria-label={`${tr('หน้า')} ${i + 1}`} aria-current={i === cur ? 'page' : undefined} onClick={() => go(i)}
              style={{ width: 88, flexShrink: 0, padding: 0, borderRadius: 'var(--r-sm, 6px)', overflow: 'hidden', cursor: 'pointer', background: 'var(--card)',
                border: `2px solid ${i === cur ? 'var(--accent)' : 'var(--border)'}`, opacity: i === cur ? 1 : 0.7 }}>
              <img src={src} alt="" style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', objectFit: 'cover' }} />
            </button>
          ))}
        </div>
        <span style={{ fontSize: 13, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{cur + 1} / {list.length}</span>
        <button type="button" className="pg-btn" onClick={full} title={tr('เต็มจอ')}>⛶ {tr('เต็มจอ')}</button>
      </div>
    </div>
  );
}

const panel = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-sm)', padding: 16 };
const note = { ...panel, color: 'var(--muted)', fontSize: 13 };

/** Dashboard → กลยุทธ์ */
export function StrategyBook({ code, title }) {
  const s = useStrategy(code);
  if (s.loading) return <div style={note}>{tr('กำลังโหลด…')}</div>;
  if (s.err) return <div style={{ ...note, color: 'var(--red)' }}>{s.err}</div>;
  if (!s.row) return <div style={note}>{tr('ยังไม่มีเอกสารกลยุทธ์ — ผู้ดูแลกิจกรรมอัปโหลด PDF (16:9 ไม่เกิน 5 หน้า) ที่ Setting → กลยุทธ์')}</div>;
  return <div style={panel}><Book url={s.row.url} title={title} /></div>;
}

