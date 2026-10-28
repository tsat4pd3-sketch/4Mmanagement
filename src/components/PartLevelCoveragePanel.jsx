/* ═══ 📍 จุดเรียกเติม — ใครยังไม่ตั้ง (ทั้งโรงงานในจอเดียว · 2026-10-20) ═══════════════════

   ที่มา: ตรวจลูป "ผลิตเรียก → สโตร์เห็น" 20/10 (📄 `docs/modules/store-board-workflow.md`)
   ใบที่ไลน์เรียกเองมี 4 ใบทั้งระบบ · ที่เหลือสโตร์สร้างจาก forecast เพราะ **ขั้น "ถึง min แล้วเสนอให้เบิก"
   ไม่มีวันยิงถ้าไม่มีใครตั้งจุดเรียกเติม** — และเดิมเห็นได้ทีละไลน์ (แผงใน `/layout-setup`) เท่านั้น

   จอนี้ **อ่านอย่างเดียว ชี้งานค้าง** — ไม่เขียน/ไม่เดาค่า min ให้ใคร (ตั้งค่าจริงที่หน้าตั้งค่าไลน์)
   กฎการนับทั้งหมดอยู่ใน `src/utils/partLevelCoverage.js` (pure + เทส) — ห้ามนับเองในไฟล์นี้       */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { supabaseDR } from '../supabaseClient';
import { loadLinesRes } from '../utils/useProductionLines';
import { loadProductsMaster } from '../utils/useProducts';
import { fetchAllPages } from '../utils/fetchByIds';
import { partLevelCoverage } from '../utils/partLevelCoverage';
import MatLabel from './MatLabel';
import SearchInput from './SearchInput';
import { normSearch } from '../utils/thaiText';

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-sm)' };
const fmt = (n) => Number(n || 0).toLocaleString();

export default function PartLevelCoveragePanel() {
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState([]);     // ชื่อชุดข้อมูลที่โหลดไม่ครบ — ต้องเขียนบนจอ
  const [busy, setBusy] = useState(true);
  const [open, setOpen] = useState(() => new Set());
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    const [lnRes, stkRes, lvRes, rulesRes, prods] = await Promise.all([
      loadLinesRes(),
      fetchAllPages(() => supabaseDR.from('line_stock_summary').select('line_name, mat_no, part_name, qty_on_hand'),
        { orderBy: ['line_name', 'mat_no'] }),
      fetchAllPages(() => supabaseDR.from('line_part_levels').select('line_name, mat_no, min_qty, max_qty, is_active').eq('is_active', true),
        { orderBy: 'id' }),
      /* 🔴 ต้อง select `mode` — ช่องนี้คือ "ยอดเข้าทางไหน" ที่ `/line-stock` ใช้แสดง/แก้
         (ตั้งแต่ 26/10 `inflowDestOf()` ไม่ได้ข้ามกฎโหมดนี้แล้ว — ปลายทางอ่านจาก dest_line_name ตรงๆ) */
      supabaseDR.from('stock_inflow_rules').select('match_type, match_value, dest_line_name, is_active, mode').eq('is_active', true),
      loadProductsMaster().catch(() => null),
    ]);
    const bad = [
      ['ทะเบียนไลน์', lnRes.error ? { error: lnRes.error } : {}],
      ['ยอดสต็อกหน้าไลน์', stkRes],
      ['จุดเรียกเติมที่ตั้งไว้', lvRes],
      ['กฎรับเข้าคลัง', rulesRes],
      ['ทะเบียนสินค้า', prods ? {} : { error: 'load failed' }],
    ].filter(([, r]) => r.error || r.truncated).map(([n]) => n);
    setLoadErr(bad);
    setData(partLevelCoverage({
      stock: stkRes.rows || [],
      levels: lvRes.rows || [],
      products: prods || [],
      rules: rulesRes.data || [],
      lines: lnRes.data || [],
    }));
    setBusy(false);
  }, []);

  useEffect(() => { let alive = true; (async () => { await load(); if (!alive) return; })(); return () => { alive = false; }; }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = normSearch(q);
    if (!needle) return data.rows;
    return data.rows.filter(g => normSearch(g.line_name).includes(needle)
      || g.parts.some(p => normSearch(`${p.mat_no} ${p.part_name}`).includes(needle)));
  }, [data, q]);

  const t = data?.totals;
  const toggle = (k) => setOpen(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...card, padding: '14px 16px' }}>
        <div style={{ fontWeight: 800, fontSize: 15, fontFamily: 'var(--font-display)', marginBottom: 4 }}>
          📍 จุดเรียกเติมชิ้นส่วน — ไลน์ไหนยังไม่ตั้ง
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.65 }}>
          พาร์ทที่ <b>ไลน์ใช้</b> (ต้องเบิกจากสโตร์) และยังไม่มีใครตั้ง <b>min</b> ไว้ = ระบบจะ<b>ไม่เสนอให้เบิก</b>เลย
          ⇒ ไลน์ต้องไปโทร/เดินบอกสโตร์เอง · ตั้งค่าจริงที่ <b>⚙️ ตั้งค่าผัง → 🏭 ผลิต (ผังไลน์) → เลือกไลน์ → 📦 จุดเรียกเติมชิ้นส่วน</b>
          <br />
          ⚠️ นับจาก “พาร์ทที่เคยเดินผ่านไลน์นี้” (มีแถวในสรุปยอด — รวมแถวที่ยอดเหลือ 0)
          · พาร์ทที่ <b>ไลน์ผลิตเอง</b> ไม่นับที่นี่ (เป็น “ผลิตเติม” · ค่า min/max อยู่ที่ <b>/products → 🎴 Kanban Std</b>)
          · จอนี้ชี้อย่างเดียว ไม่ตั้งค่าแทนใคร
        </div>
      </div>

      {loadErr.length > 0 && (
        <div style={{ ...card, padding: '10px 14px', borderColor: '#ef4444', color: '#ef4444', fontSize: 12, fontWeight: 700 }}>
          ⚠ โหลดไม่ครบ: {loadErr.join(' · ')} — ตัวเลขข้างล่างอาจต่ำกว่าจริง (กดรีเฟรชหน้าอีกครั้ง)
        </div>
      )}
      {data?.linesUnknown && (
        <div style={{ ...card, padding: '10px 14px', borderColor: '#f59e0b', color: '#f59e0b', fontSize: 12, fontWeight: 700 }}>
          ⚠ อ่านทะเบียนไลน์ไม่ได้ — แยก “ไลน์ผลิต” ออกจาก “คลัง” ไม่ได้ จึงแสดงทุกชื่อปลายทางไปก่อน
        </div>
      )}

      {busy && !data ? (
        <div style={{ ...card, padding: '30px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>กำลังรวบรวม…</div>
      ) : !t ? null : (
        <>
          {/* สรุปทั้งโรงงาน — ตัวเลขที่เอาไปตามงานได้ */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, alignContent: 'start' }}>
            {[
              { k: 'พาร์ทที่ต้องเบิกจากสโตร์', v: fmt(t.consume), s: `${t.lines} ไลน์ที่มีของเดินผ่าน`, c: 'var(--text)' },
              { k: '🔴 ยังไม่มีใครเฝ้า', v: fmt(t.unwatched), s: t.consume ? `${Math.round((t.unwatched / t.consume) * 100)}% ของทั้งหมด` : '—', c: '#ef4444' },
              { k: '✅ ตั้ง min แล้ว', v: fmt(t.watched), s: `${t.linesDone} ไลน์ครบแล้ว`, c: '#22c55e' },
              { k: 'ไลน์ที่ยังขาด', v: fmt(t.linesWithGap), s: 'เรียงไว้ข้างล่างจากขาดมากสุด', c: '#f59e0b' },
            ].map(x => (
              <div key={x.k} style={{ ...card, padding: '12px 14px' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{x.k}</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: x.c, fontFamily: 'var(--font-display)', lineHeight: 1.25 }}>{x.v}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{x.s}</div>
              </div>
            ))}
          </div>

          {/* ของที่กันออก/ของที่เป็นผลิตเติม — ห้ามหายเงียบ ต้องบอกว่ากันอะไรออกไป */}
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.7 }}>
            กันออกจากตัวนับ: <b>{fmt(t.skipped)}</b> รายการของคลัง (STORE / FG WAREHOUSE / ปลายทางที่ไม่ใช่ไลน์ผลิต)
            · <b>{fmt(t.produce)}</b> รายการเป็นของที่ไลน์ผลิตเอง (ผลิตเติม)
            {t.rowNoMin > 0 && <> · 🟡 <b>{fmt(t.rowNoMin)}</b> รายการ<b>มีแถวจุดเรียกเติมแล้วแต่ไม่ได้ใส่ min</b> — ระบบยังไม่เตือนอะไรเลย</>}
          </div>

          <SearchInput value={q} onChange={setQ} placeholder="ค้นไลน์ / MAT / ชื่อพาร์ท" />

          {rows.length === 0 ? (
            <div style={{ ...card, padding: '26px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              {data.rows.length === 0 ? 'ยังไม่มียอดสต็อกหน้าไลน์ให้ตรวจ' : `ไม่มีไลน์/พาร์ทที่ตรงกับ "${q}"`}
            </div>
          ) : rows.map(g => {
            const folded = !open.has(g.line_name);
            const done = g.unwatched === 0;
            return (
              <div key={g.line_name} style={{ ...card, padding: 0, overflow: 'hidden' }}>
                <div onClick={() => toggle(g.line_name)}
                     style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'var(--bg2)', borderBottom: folded ? 'none' : '1px solid var(--border)', cursor: 'pointer', userSelect: 'none' }}>
                  <div style={{ fontWeight: 800, fontSize: 14.5, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)', width: 10 }}>{folded ? '▶' : '▼'}</span>
                    📍 {g.line_name}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {done
                      ? <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 10, background: 'rgba(34,197,94,0.12)', color: '#22c55e', fontWeight: 700 }}>✅ ตั้งครบ {g.consume} พาร์ท</span>
                      : <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 10, background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontWeight: 700 }}>🔴 ยังไม่ตั้ง {g.unwatched} / {g.consume} พาร์ท</span>}
                    {g.rowNoMin > 0 && <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 10, background: 'rgba(245,158,11,0.12)', color: '#f59e0b', fontWeight: 700 }}>🟡 {g.rowNoMin} แถวไม่ใส่ min</span>}
                    {g.produce > 0 && <span style={{ fontSize: 11, color: 'var(--muted)' }}>🏭 ผลิตเอง {g.produce}</span>}
                  </div>
                </div>
                <div style={{ display: folded ? 'none' : undefined, overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg2)' }}>
                        {[['#', 'left'], ['ชิ้นงาน', 'left'], ['คงเหลือหน้าไลน์', 'right'], ['จุดเรียกเติม', 'left']].map(([h, al]) => (
                          <th key={h} style={{ padding: '8px 14px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: al, whiteSpace: 'nowrap', textTransform: 'uppercase' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {g.parts.map((p, i) => (
                        <tr key={p.mat_no}>
                          <td style={{ padding: '9px 14px', borderTop: '1px solid var(--border)', fontSize: 11.5, color: 'var(--muted)' }}>{i + 1}</td>
                          <td style={{ padding: '9px 14px', borderTop: '1px solid var(--border)', maxWidth: 360 }}>
                            <MatLabel mat={p.mat_no} name={p.part_name} size={13} />
                          </td>
                          <td style={{ padding: '9px 14px', borderTop: '1px solid var(--border)', textAlign: 'right', fontSize: 13, fontWeight: 700, color: p.qty > 0 ? 'var(--text)' : '#ef4444' }}>
                            {fmt(p.qty)}{p.qty <= 0 && <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}> (หมด)</span>}
                          </td>
                          <td style={{ padding: '9px 14px', borderTop: '1px solid var(--border)', fontSize: 11.5 }}>
                            {p.watched
                              ? <span style={{ color: '#22c55e', fontWeight: 700 }}>✅ ตั้งแล้ว</span>
                              : p.hasRowNoMin
                                ? <span style={{ color: '#f59e0b', fontWeight: 700 }}>🟡 มีแถวแต่ไม่ได้ใส่ min — ระบบไม่เตือน</span>
                                : <span style={{ color: '#ef4444', fontWeight: 700 }}>🔴 ยังไม่ตั้ง</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
