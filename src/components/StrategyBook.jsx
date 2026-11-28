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
import useFitHeight from '../utils/useFitHeight';

const ctl = { width: 34, height: 34, borderRadius: 'var(--r-md)', border: 'none', background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: 20, lineHeight: 1, display: 'grid', placeItems: 'center' };

/** e-book (28/11 คำสั่ง user "ให้เกือบเต็มจอ · กดไป-กลับเหมือนเปิดกระดาษหนังสือ"):
    หน้าเดียว 16:9 ใหญ่สุดเท่าที่จอเหลือ (วัดจริงด้วย useFitHeight · เต็มจอ = สูงเต็มจอ) · แถบควบคุมเดียวใต้หน้า ‹ หน้า n / N › ⛶
    · พลิกหน้าแบบหนังสือจริง (28/11 รอบ 2 · user "ไปถัดไปแต่อนิเมชั่นเหมือนย้อนกลับ · เร็วไป"):
      ไป = หน้าเดิมยกขอบขวาแล้วพับไปทางซ้ายรอบสัน (เปิดเผยหน้าถัดไปที่อยู่ข้างใต้) · กลับ = หน้าก่อนพับกลับมาจากซ้ายทับหน้าเดิม
      ใช้ 2 ชั้น: พื้น (หน้าที่อยู่นิ่ง) + แผ่นที่กำลังพลิก · 0.9 วิ · keyframes `book-turn-*` ใน index.css · ปิดเมื่อ reduced-motion
    · ลูกศรคีย์บอร์ด ← → พลิกได้ */
export function Book({ url, title }) {
  const [got, setGot] = useState({ url: null, list: [], err: '' });
  const [at, setAt] = useState({ url: null, n: 0, dir: 0, from: 0, turning: false });
  const [isFull, setFull] = useState(false);
  const box = useRef(null);
  const [fitRef, fitH] = useFitHeight(0, 260);
  useEffect(() => {
    let alive = true;
    pagesOf(url).then(list => alive && setGot({ url, list, err: '' }), () => alive && setGot({ url, list: [], err: 'เปิดเอกสาร PDF ไม่ได้' }));
    return () => { alive = false; };
  }, [url]);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const list = got.url === url ? got.list : [];
  const cur = at.url === url ? at.n : 0;
  const go = useCallback((n) => { if (n >= 0 && n < list.length && n !== cur) setAt({ url, n, dir: n > cur ? 1 : -1, from: cur, turning: true }); }, [list.length, url, cur]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.closest?.('input, textarea, select, [role="dialog"], .modal')) return;
      if (e.key === 'ArrowRight') go(cur + 1);
      if (e.key === 'ArrowLeft') go(cur - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cur, go]);
  const BAR = 46;   // แถบควบคุมใต้หน้า
  const pageH = isFull ? window.innerHeight - BAR - 24 : (fitH != null ? fitH - BAR : null);
  const pageW = pageH != null ? `min(100%, ${Math.max(320, Math.floor(pageH * 16 / 9))}px)` : 'min(100%, 1100px)';
  const pageStyle = { display: 'block', width: '100%', aspectRatio: '16 / 9', objectFit: 'contain', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'var(--card)', boxShadow: 'var(--shadow-md)' };
  const full = () => (document.fullscreenElement ? document.exitFullscreen() : box.current?.requestFullscreen?.());
  const dir = at.url === url ? at.dir : 0;
  const turning = at.url === url && at.turning;
  const from = at.url === url ? at.from : 0;
  const endTurn = () => setAt(a => ({ ...a, turning: false }));
  const ready = got.url === url && !got.err && list.length > 0;
  /* 🔴 กล่องนอกต้องเป็นตัวเดิมตลอด (useFitHeight วัด element ตัวแรกที่ผูก ref) — สลับเฉพาะเนื้อหาข้างใน */
  return (
    <div ref={(el) => { box.current = el; fitRef.current = el; }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'var(--bg)', ...(isFull ? { padding: 12 } : null) }}>
      {!ready ? (
        <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: got.url === url ? 'var(--red)' : 'var(--muted)' }}>
          {tr(got.url === url ? 'เปิดเอกสาร PDF ไม่ได้' : 'กำลังเปิดเอกสาร…')}
        </div>
      ) : (
        <>
          <div style={{ width: pageW, perspective: 2600, position: 'relative' }}>
            {/* พื้น: ไป = หน้าใหม่ (ถูกเปิดเผยใต้แผ่นที่พลิกออก) · กลับ = หน้าเดิม (แผ่นก่อนหน้าพับกลับมาทับ) */}
            <img className="book-page" src={list[turning && dir < 0 ? from : cur]} alt={`${title} ${tr('หน้า')} ${cur + 1}`}
              onClick={(e) => { if (turning) return; const r = e.currentTarget.getBoundingClientRect(); go(e.clientX - r.left > r.width / 2 ? cur + 1 : cur - 1); }}
              style={{ ...pageStyle, cursor: 'pointer' }} />
            {turning && (
              <img key={`${from}>${cur}`} className="book-page book-turn" src={list[dir > 0 ? from : cur]} alt="" aria-hidden="true" onAnimationEnd={endTurn}
                style={{ ...pageStyle, position: 'absolute', inset: 0, transformOrigin: 'left center', backfaceVisibility: 'hidden', pointerEvents: 'none',
                  animation: `${dir > 0 ? 'book-turn-next' : 'book-turn-prev'} .9s cubic-bezier(.45,.05,.35,1) forwards` }} />
            )}
          </div>
          <div style={{ height: BAR - 6, display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--text2)' }}>
            <button type="button" style={{ ...ctl, opacity: cur === 0 ? 0.3 : 1 }} disabled={cur === 0} onClick={() => go(cur - 1)} aria-label={tr('หน้าก่อน')}>‹</button>
            <span style={{ minWidth: 76, textAlign: 'center' }}>{tr('หน้า')} {cur + 1} / {list.length}</span>
            <button type="button" style={{ ...ctl, opacity: cur === list.length - 1 ? 0.3 : 1 }} disabled={cur === list.length - 1} onClick={() => go(cur + 1)} aria-label={tr('หน้าถัดไป')}>›</button>
            <button type="button" style={{ ...ctl, fontSize: 16, marginLeft: 8 }} onClick={full} aria-label={tr(isFull ? 'ออกจากเต็มจอ' : 'เต็มจอ')} title={tr(isFull ? 'ออกจากเต็มจอ' : 'เต็มจอ')}>⛶</button>
          </div>
        </>
      )}
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
  return <Book url={s.row.url} title={title} />;   // ไม่มีกรอบการ์ด — หน้ากระดาษวางบนพื้นหน้าเลย (แบบเว็บกิจกรรมเดิม)
}

