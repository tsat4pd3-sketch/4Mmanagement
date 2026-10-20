import { useEffect } from 'react';
import useTvShell from '../utils/useTvShell';
import { boardFlipSec, SUBPAGE_ATTR } from '../utils/displayRotation';

/* ══ 📖 BoardPager — แถบ "กดเปลี่ยนหน้า" ของบอร์ดที่ห้ามเลื่อน (2026-09-25 · คำสั่ง user) ══
   *"ต้องไม่เป็น overflow ดูจบได้ในหน้าเดียว … ให้ใช้หลักการกดเปลี่ยนหน้า คล้ายๆ ตัวประชุมแถวเช้า"*
   หน้าตา/ปุ่มชุดเดียวกับโหมดประชุมใน `/morning-meeting` (◀ n/N ▶ + จุดบอกหน้า + ลูกศรคีย์บอร์ด)
   🔴 ใช้ตัวนี้ทุกบอร์ดที่แบ่งหน้า **ห้ามวาดปุ่ม ◀ ▶ เองในหน้า** — ไม่งั้นแต่ละบอร์ดจะเปลี่ยนหน้าคนละท่า
   🔴 **มีหน้าเดียว = ไม่โชว์ปุ่ม** แต่ยัง **กันที่ไว้เท่าเดิม** (คืนแถบเปล่าความสูงเท่ากัน)
      เหตุผลที่ห้ามคืน `null`: ความสูงที่บอร์ดใช้ได้ถูก *วัด* จากที่ว่างจนถึงก้นจอ → ที่ว่างนั้น
      กำหนดว่าหน้าหนึ่งใส่ได้กี่แผ่น → ซึ่งกำหนดว่ามีกี่หน้า → ซึ่งกำหนดว่าจะโชว์แถบนี้ไหม
      = **วงจรป้อนกลับ** ถ้าแถบหาย/โผล่แล้วความสูงเปลี่ยน จอจะกระพริบสลับไปมาไม่นิ่ง
      (วัดจริง 25/09: เหลือเลื่อน 3-120px แบบสุ่มตามจังหวะ) ⇒ สูงคงที่เสมอ = วัดครั้งเดียวจบ

   คีย์บอร์ด ← → เปิดให้เสมอเมื่อมีหลายหน้า (รีโมตพรีเซนเตอร์ส่วนใหญ่ยิงปุ่มลูกศร ⇒ ใช้กับจอ TV ได้เลย)
   ⚠️ ไม่ดักคีย์เมื่อโฟกัสอยู่ในช่องกรอก — ไม่งั้นพิมพ์ในช่องค้นหาแล้วจอเปลี่ยนหน้าหนีไปเอง
   ══════════════════════════════════════════════════════════════════════════════════════ */
/** ความสูงคงที่ของแถบ — ต้องเท่ากันทั้งตอนมีปุ่มและตอนเป็นแถบเปล่า */
const barH = (compact, tv) => (tv ? 52 : compact ? 34 : 40);   // 📺 จอประชุม (UI §6.32) สูงขึ้นแต่ยังคงที่ทุกหน้า

export default function BoardPager({ page, count, onPage, labels = [], compact = false }) {
  const tv = useTvShell();   // จอประชุม: เลขหน้า/จุด/ชื่อแผ่น อ่านได้จากระยะ 2–3 ม.
  useEffect(() => {
    if (!(count > 1)) return undefined;
    const onKey = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); onPage(Math.min(count - 1, page + 1)); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); onPage(Math.max(0, page - 1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, count, onPage]);

  /* 📺 จอ TV กดไม่ได้ (20/10 · UI §6.33) ⇒ หมุนหน้าย่อยเองทุกบอร์ด (เดิมบางบอร์ดหมุนเอง บางบอร์ดไม่ เช่น SQDCM)
     จังหวะ = boardFlipSec · บอร์ดที่หมุนเองอยู่แล้วด้วยจังหวะเดียวกัน = ตั้งค่าเดียวกัน ไม่เด้งซ้อน · ตัววนจอรอจนครบ (subpageGate) */
  useEffect(() => {
    if (!tv || !(count > 1)) return undefined;
    const sec = boardFlipSec(count);
    if (!sec) return undefined;
    const t = setTimeout(() => onPage((page + 1) % count), sec * 1000);
    return () => clearTimeout(t);
  }, [tv, page, count, onPage]);

  // สูงคงที่เสมอ — ดูเหตุผลเรื่องวงจรป้อนกลับในหัวไฟล์
  if (!(count > 1)) return <div style={{ height: barH(compact, tv), flexShrink: 0 }} />;

  const btn = (disabled) => ({
    fontSize: tv ? 22 : compact ? 14 : 16, fontWeight: 800, lineHeight: 1,
    padding: tv ? '6px 14px' : compact ? '4px 9px' : '6px 12px', borderRadius: 8, cursor: disabled ? 'default' : 'pointer',
    background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)',
    opacity: disabled ? 0.4 : 1,
  });

  /* จุดเยอะเกินไปจะดันแถวแตกบรรทัด → ความสูงเปลี่ยน → วงจรป้อนกลับอีก ⇒ เกิน 12 หน้าเลิกโชว์จุด
     (เลข n/N บอกครบอยู่แล้ว) · `nowrap` + `clip` กันแตกบรรทัดทุกกรณี */
  const showDots = count <= 12;
  return (
    <div {...{ [SUBPAGE_ATTR]: `${page + 1}/${count}` }} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
      flexWrap: 'nowrap', flexShrink: 0, overflow: 'clip', height: barH(compact, tv),
    }}>
      <button type="button" onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0}
        title="หน้าก่อน (←)" style={btn(page === 0)}>◀</button>

      <span style={{ fontSize: tv ? 22 : compact ? 12 : 13, fontWeight: 800, color: 'var(--text2)', minWidth: 42, textAlign: 'center' }}>
        {page + 1}/{count}
      </span>

      <button type="button" onClick={() => onPage(Math.min(count - 1, page + 1))} disabled={page === count - 1}
        title="หน้าถัดไป (→)" style={btn(page === count - 1)}>▶</button>

      {/* จุดบอกหน้า — กดข้ามไปหน้าไหนก็ได้ · title บอกว่าหน้านั้นมีแผ่นอะไร (จอ TV ไม่มีเมาส์ก็ยังนับจุดได้) */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 3 }}>
        {showDots && Array.from({ length: count }, (_, i) => (
          <button key={i} type="button" onClick={() => onPage(i)} title={labels[i] || `หน้า ${i + 1}`}
            aria-label={labels[i] || `หน้า ${i + 1}`} aria-current={i === page ? 'true' : undefined}
            style={{
              width: tv ? 16 : 10, height: tv ? 16 : 10, borderRadius: '50%', border: 'none', padding: 0, cursor: 'pointer',
              background: i === page ? 'var(--accent)' : 'var(--border2)',
            }} />
        ))}
      </div>

      {labels[page] && (
        <span style={{ fontSize: tv ? 20 : compact ? 11 : 11.5, color: tv ? 'var(--text2)' : 'var(--muted)', maxWidth: tv ? 720 : 360,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {labels[page]}
        </span>
      )}
    </div>
  );
}
