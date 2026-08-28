import { useState, useEffect, useCallback } from 'react';
import { supabaseDR } from '../supabaseClient';
import { orderTotal } from '../utils/pairTotals';
import { loadOpInfo, opInfoSync } from '../utils/opItems';
import { usePolling } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';

/* ═══ 📤 สั่งผลิตไปไลน์ไหน · ผลิตได้ตามที่มอบหมายไหม (แถบสรุปสำหรับฝั่ง Store) ═══
   ที่มา (user 2026-08-24): "สโตร์ควรเห็นทั้ง มอนิเตอร์ kanban ของสต๊อกที่กำลังจะต้องสั่งผลิต
   กับ kanban board ของฝ่ายผลิต ว่าสั่งผลิตอะไรไปไลน์ไหนบ้างเท่าไหร่ ผลิตได้ตามเป้าที่มอบหมายมั้ย"

   ⚠️ **ห้ามก๊อปบอร์ด Heijunka ของฝ่ายผลิตมา render ซ้ำที่นี่** (กฎเดิมใน CLAUDE.md — กัน drift)
      อันนี้เป็น "สรุปยอด" คนละอย่างกับบอร์ด · อยากเห็นบอร์ดจริงให้กด 📊 บอร์ดไลน์ ซึ่งเด้งไปตัวจริง

   กติกาตัวเลข (ห้ามคิดเอง — ใช้ helper กลาง):
   • ผลิตได้ = `confirmed ? (qty_ok ?? qty) : (qty_actual ?? 0)`   ← สูตรบังคับของระบบ
   • เป้า    = `qty_target ?? qty`
   • งานคู่ RH/LH นับเป็น 1 ครั้งปั๊ม + ยุบชั้น OP เข้าพาร์ทจริง → `orderTotal(...)`
   • ยังไม่เปิดกะ = บอกตรงๆ ห้ามโชว์ 0% แดง (ไม่ใช่ว่าไลน์ทำไม่ได้ แต่ยังไม่เริ่ม)

   ⚠️ **พับเก็บเป็นค่าเริ่มต้น** (user 2026-08-25: "ดูรก และอะไรเยอะไปหมด") — 15 ไลน์ = 15 การ์ด
      ดันเนื้อหาจริงของหน้า Store ลงไปครึ่งจอ · แถวสรุป (รวม X/Y ชิ้น + ไลน์ที่ตามหลัง)
      ยังเห็นตลอด **ห้ามซ่อนตัวเลขรวม** — พับแค่รายไลน์
   ═══════════════════════════════════════════════════════════════════════════ */

const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const OPEN_KEY = 'esm_prod_strip_open';

/* `defaultOpen` = ค่าตั้งต้นเมื่อ **เครื่องนี้ยังไม่เคยเลือก** — ใช้กับจอ TV ของฝ่ายผลิต
   ที่ยอดผลิตคือเนื้อหาหลักของจอ (ไม่ใช่ของแถมเหมือนบนหน้า Store)
   ⚠️ ห้ามบังคับเปิดตายตัว: คนกดพับแล้วต้องพับอยู่ (ค่าที่เก็บไว้ชนะเสมอ) */
export default function ProdProgressStrip({ workDate, scopeNames = null, onOpenLine, defaultOpen = false }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(OPEN_KEY);
      return v == null ? defaultOpen : v === '1';
    } catch { return defaultOpen; }
  });
  const toggle = () => setOpen(o => {
    try { localStorage.setItem(OPEN_KEY, o ? '0' : '1'); } catch { /* private mode */ }
    return !o;
  });

  const load = useCallback(async () => {
    try {
      await loadOpInfo();
      let sq = supabaseDR.from('production_sessions')
        .select('id, line_name, shift, status').eq('work_date', workDate);
      if (scopeNames?.length) sq = sq.in('line_name', scopeNames);
      const { data: sess, error: e1 } = await sq;
      if (e1) throw e1;
      const ids = (sess || []).map(s => s.id);
      if (!ids.length) { setD({ lines: [], noShift: true }); setErr(''); return; }

      const [{ data: po, error: e2 }, { data: prods }] = await Promise.all([
        supabaseDR.from('prod_orders')
          .select('session_id, mat_no, qty, qty_target, qty_ok, qty_actual, status').in('session_id', ids),
        supabaseDR.from('dr_products').select('mat_no, pair_mat_no').eq('is_active', true),
      ]);
      if (e2) throw e2;
      const pairOf = (m) => (prods || []).find(p => p.mat_no === m)?.pair_mat_no ?? null;
      const opMap = opInfoSync();
      const lineOf = Object.fromEntries((sess || []).map(s => [s.id, s.line_name]));

      const byLine = {};
      (po || []).forEach(o => {
        const ln = lineOf[o.session_id];
        if (!ln) return;
        (byLine[ln] = byLine[ln] || { line: ln, orders: [], cnt: 0, open: 0 }).orders.push(o);
        byLine[ln].cnt++;
        if (o.status === 'open') byLine[ln].open++;
      });
      (sess || []).forEach(s => { byLine[s.line_name] = byLine[s.line_name] || { line: s.line_name, orders: [], cnt: 0, open: 0 }; });

      const lines = Object.values(byLine).map(g => {
        const target = orderTotal(g.orders, o => Number(o.qty_target ?? o.qty ?? 0), pairOf, opMap);
        const made = orderTotal(g.orders,
          o => (o.status === 'confirmed' ? Number(o.qty_ok ?? o.qty ?? 0) : Number(o.qty_actual ?? 0)), pairOf, opMap);
        return { ...g, target, made, pct: target > 0 ? (made / target) * 100 : null };
      }).sort((a, b) => (a.pct ?? 999) - (b.pct ?? 999));   // ตามหลังสุดขึ้นก่อน
      setD({ lines, noShift: false });
      setErr('');
    } catch (e) { setErr(String(e.message || e)); }
  }, [workDate, scopeNames]);

  useEffect(() => { load(); }, [load]);
  usePolling(load, RATE.BOARD);

  // ⚠️ โหลดไม่ได้ = บอก ห้ามโชว์ว่างเปล่าเหมือนไม่มีงาน
  if (err) return (
    <div style={{ padding: '8px 11px', borderRadius: 8, border: '1px solid #ef444466', background: '#ef444414', fontSize: 11.5, color: '#ef4444', marginBottom: 12 }}>
      🔴 โหลดความคืบหน้าการผลิตไม่ได้ — {err}
    </div>
  );
  if (!d) return null;

  const tot = d.lines.reduce((a, l) => ({ target: a.target + l.target, made: a.made + l.made }), { target: 0, made: 0 });
  const totPct = tot.target > 0 ? (tot.made / tot.target) * 100 : null;
  const col = (p) => (p == null ? 'var(--muted)' : p >= 100 ? '#22c55e' : p >= 85 ? '#f59e0b' : '#ef4444');

  // ไลน์ที่ยังตามหลัง (<85%) — เลขนี้ต้องเห็นแม้พับอยู่ ไม่งั้นพับแล้วปัญหาหายไปด้วย
  const behind = d.lines.filter(l => l.pct != null && l.pct < 85).length;

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
      <div onClick={toggle} style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', cursor: 'pointer', marginBottom: open && d.lines.length ? 8 : 0 }}>
        <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-display)' }}>
          {open ? '▾' : '▸'} 📤 สั่งผลิตไปไลน์ไหน · ทำได้ตามที่มอบหมายไหม
        </span>
        {totPct != null && (
          <span style={{ fontSize: 12, fontWeight: 800, color: col(totPct) }}>
            รวม {fmt(tot.made)}/{fmt(tot.target)} ชิ้น ({totPct.toFixed(0)}%)
          </span>
        )}
        {!open && behind > 0 && (
          <span style={{ fontSize: 11.5, fontWeight: 800, color: '#ef4444' }}>· ตามหลัง {behind} ไลน์</span>
        )}
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          วันงาน {workDate}
          {d.noShift ? ' · ยังไม่มีไลน์ไหนเปิดกะ'
            : open ? ' · กดชื่อไลน์เพื่อเปิดบอร์ดจริงของไลน์นั้น' : ` · แตะดูรายไลน์ (${d.lines.length})`}
        </span>
      </div>

      {!open ? null : d.noShift ? (
        /* ยังไม่เปิดกะ ≠ ไลน์ทำไม่ได้ — ห้ามโชว์ 0% แดง */
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>— ยังไม่มีไลน์ไหนเปิดกะของวันงานนี้</div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {d.lines.map(l => (
            <div key={l.line}
              onClick={() => onOpenLine?.(l.line)}
              title={l.target > 0
                ? `${l.line} · ใบสั่งผลิต ${l.cnt} ใบ (ยังเปิดอยู่ ${l.open}) · เป้า ${fmt(l.target)} ชิ้น · ทำได้ ${fmt(l.made)} ชิ้น`
                : `${l.line} · เปิดกะแล้วแต่ยังไม่มีใบสั่งผลิต`}
              style={{
                cursor: onOpenLine ? 'pointer' : 'default', minWidth: 150, flex: '0 1 auto',
                background: 'var(--bg2)', border: `1px solid ${l.pct == null ? 'var(--border)' : `${col(l.pct)}55`}`,
                borderRadius: 9, padding: '7px 11px',
              }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>{l.line}</div>
              {l.target > 0 ? (
                <>
                  <div style={{ fontSize: 15, fontWeight: 900, color: col(l.pct), fontFamily: 'var(--font-display)' }}>
                    {fmt(l.made)}<span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>/{fmt(l.target)}</span>
                    <span style={{ fontSize: 11, marginLeft: 5 }}>{l.pct.toFixed(0)}%</span>
                  </div>
                  <div style={{ height: 4, borderRadius: 3, background: 'var(--bg3)', overflow: 'hidden', margin: '3px 0 2px' }}>
                    <div style={{ width: `${Math.min(100, l.pct)}%`, height: '100%', background: col(l.pct) }} />
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>🎫 {l.cnt} ใบ{l.open > 0 ? ` · ยังเปิด ${l.open}` : ''}</div>
                </>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>เปิดกะแล้ว · ยังไม่มีใบสั่งผลิต</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
