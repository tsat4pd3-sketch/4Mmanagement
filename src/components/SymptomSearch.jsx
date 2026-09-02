import { useState, useCallback, useMemo } from 'react';
import { supabaseDR } from '../supabaseClient';
import { noteSimilarity, clusterNotes, CLUSTER_THRESHOLD } from '../utils/textCluster';

/* ── 🔎 ค้นด้วย "อาการ" — สอบกลับจากปลายทางเข้าหาต้นเหตุ (2026-08-26 · คำถามหน้างาน) ────
   *"ลูกค้าแจ้ง ปัญหาตัดไม่ขาด — หา downtime/defect ที่เกี่ยวกับอาการนี้ได้มั้ย"*

   เดิมระบบสอบกลับเดินได้ทางเดียว: **รู้เลขใบผลิตก่อน** → เห็นทุกอย่างของใบนั้น
   ส่วนแผง "ลูกค้าแจ้งอาการอะไร" ก็ผูกกับใบที่เลือกไว้แล้ว + ต้องมี PFMEA ของพาร์ทนั้นด้วย
   ⇒ ถ้ามีแต่ "อาการ" ในมือ (เคลมเข้ามาลอยๆ) ไม่มีทางเริ่มต้นเลย
   (ตรวจทั้งระบบ 2026-08-26: `ilike` มีแค่ 3 จุด — เลขใบ/ชื่อพาร์ท/ชื่อคน · **ไม่มีที่ไหนค้น
    `description` ของ downtime/defect เลย**)

   ── วิธีค้น: 2 ทาง แล้วรวมผล ─────────────────────────────────────────────
   ทาง ก **ประเภทที่ชื่อคล้ายอาการ** — โหลด master (ไม่กี่สิบแถว) เทียบด้วย noteSimilarity
     แล้ว query ด้วย `.in('*_type_id', ids)` → แม่นที่สุด + ถูกที่สุด
     (หลัง reclassify 26/08 ประเภทมีชื่อเฉพาะเยอะ อาการที่ถามมักเป็น "ชื่อประเภท" ตรงๆ)
   ทาง ข **ข้อความที่พนักงานพิมพ์เอง** — `ilike` ด้วยคำค้น + ชิ้นส่วนของคำค้น
     (ภาษาไทยไม่มีช่องว่าง → ตัดเป็นชิ้นยาว 4 ให้จับข้อความที่เขียนต่างกันเล็กน้อยได้)
   → รวม → ตัดซ้ำ → จัดอันดับด้วย `noteSimilarity` (ตัวเดียวกับที่ Pareto ใช้จับกลุ่ม "อื่นๆ")

   ⚠️ **ค้นด้วย "คำ" ไม่ใช่ "ความหมาย"** — ต้องเขียนบอกบนจอ ไม่งั้นคนเข้าใจว่าไม่เจอ = ไม่เคยเกิด
   ⚠️ ยิง DB เฉพาะตอนกดค้น (ไม่ใช่ live search) — กฎ egress
   ⚠️ ระบบ **เสนอรายการที่น่าจะใช่** ไม่ได้สรุปสาเหตุ — คนตัดสินเสมอ (หลักเดียวกับแผง 8D)   */

const DEFAULT_BACK_DAYS = 90;
const ROW_LIMIT = 500;              // ต่อชนิด — ชนเพดานต้องบอก ห้ามตัดเงียบ
const MAX_PATTERNS = 8;             // .or() ยาวเกินไป = URL โดน proxy ตัด

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayWork = () => { const d = new Date(); if (d.getHours() < 8) d.setDate(d.getDate() - 1); return ymd(d); };
const backDays = (n) => { const d = new Date(); if (d.getHours() < 8) d.setDate(d.getDate() - 1); d.setDate(d.getDate() - n); return ymd(d); };
const fmtDay = (s) => { if (!s) return '—'; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' }); };
const flat = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');

/* ชิ้นส่วนของคำค้นสำหรับ ilike
   ⚠️ ต้องตัด , ( ) % _ " \ ออกก่อน — PostgREST `.or()` แยกเงื่อนไขด้วย comma และ
      % _ เป็น wildcard ของ LIKE → คำค้นที่มีอักขระพวกนี้จะทำให้ filter เพี้ยน/พัง */
export function ilikePatterns(q) {
  const clean = String(q || '').replace(/[,()%_"\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const out = new Set([clean]);
  clean.split(' ').forEach((w) => { if (w.length >= 3) out.add(w); });   // อังกฤษ/ผสม
  const f = clean.replace(/\s/g, '');
  if (f.length >= 6) {                                                   // ไทย — ไม่มีช่องว่างให้ตัด
    for (let i = 0; i + 4 <= f.length; i += 2) out.add(f.slice(i, i + 4));
  }
  return [...out].filter(Boolean).slice(0, MAX_PATTERNS);
}

/* คะแนนความเกี่ยว: เจอคำค้นตรงตัว = สูงสุด · ไม่งั้นใช้ความคล้ายข้อความ
   เทียบทั้ง "ชื่อประเภท" และ "ข้อความที่พิมพ์" แล้วเอาตัวที่ดีกว่า */
export function relevance(q, typeName, description) {
  const fq = flat(q);
  if (!fq) return 0;
  const hit = flat(typeName).includes(fq) || flat(description).includes(fq);
  const sim = Math.max(noteSimilarity(q, description || ''), noteSimilarity(q, typeName || ''));
  return hit ? Math.max(sim, 0.9) : sim;
}

export default function SymptomSearch({ inScope, onOpenOrder }) {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(backDays(DEFAULT_BACK_DAYS));
  const [to, setTo] = useState(todayWork());
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);      // null = ยังไม่เคยค้น (ต่างจาก [] = ค้นแล้วไม่เจอ)
  const [err, setErr] = useState(null);

  const run = useCallback(async () => {
    const term = q.trim();
    if (!term) return;
    setBusy(true); setErr(null);
    try {
      const pats = ilikePatterns(term);
      const orText = pats.map((p) => `description.ilike.%${p}%`).join(',');

      // ── ทาง ก: ประเภทที่ "ชื่อ" คล้ายอาการ (master เล็ก เทียบฝั่ง client ได้เต็มที่) ──
      const [dtT, defT] = await Promise.all([
        supabaseDR.from('dr_downtime_types').select('id, name_th, category'),
        supabaseDR.from('dr_defect_types').select('id, name_th'),
      ]);
      if (dtT.error) throw dtT.error;
      if (defT.error) throw defT.error;
      const pickTypes = (rows) => (rows || []).filter((t) =>
        flat(t.name_th).includes(flat(term)) || noteSimilarity(term, t.name_th || '') >= CLUSTER_THRESHOLD);
      const dtTypeIds = pickTypes(dtT.data).map((t) => t.id);
      const defTypeIds = pickTypes(defT.data).map((t) => t.id);

      const DT_COLS = 'id, machine_no, description, duration_min, started_at, downtime_type_id, session_id, dr_downtime_types(name_th, category), production_sessions!inner(work_date, line_name, shift)';
      const DEF_COLS = 'id, description, qty_ng, qty_suspect, logged_at, defect_type_id, prod_order_id, session_id, dr_defect_types(name_th), prod_orders(prod_no, mat_no, part_name), production_sessions!inner(work_date, line_name, shift)';
      const inRange = (qb, cols) => qb.select(cols)
        .gte('production_sessions.work_date', from).lte('production_sessions.work_date', to)
        .limit(ROW_LIMIT);

      // ยิง 4 ก้อน: (ประเภทตรง | ข้อความใกล้เคียง) × (downtime | defect)
      // แยกก้อนแทนการ .or() รวม เพราะ PostgREST ผสม .in() กับ .or() ในคิวรีเดียวแล้วอ่านยาก/พลาดง่าย
      const jobs = [
        dtTypeIds.length ? inRange(supabaseDR.from('downtime_logs'), DT_COLS).in('downtime_type_id', dtTypeIds) : null,
        orText ? inRange(supabaseDR.from('downtime_logs'), DT_COLS).or(orText) : null,
        defTypeIds.length ? inRange(supabaseDR.from('defect_logs'), DEF_COLS).in('defect_type_id', defTypeIds) : null,
        orText ? inRange(supabaseDR.from('defect_logs'), DEF_COLS).or(orText) : null,
      ];
      const out = await Promise.all(jobs.map((j) => (j ? j : Promise.resolve({ data: [], error: null }))));
      const bad = out.find((r) => r.error);
      if (bad) throw bad.error;
      const hitCap = out.some((r) => (r.data || []).length >= ROW_LIMIT);

      // รวม + ตัดซ้ำ (แถวเดียวมาได้ทั้ง 2 ทาง) + ให้คะแนน + กรอง scope
      const pack = (rows, kind, viaType) => (rows || []).map((r) => ({
        ...r, _kind: kind, _viaType: viaType,
        _type: (kind === 'dt' ? r.dr_downtime_types : r.dr_defect_types)?.name_th || '',
      }));
      const all = [
        ...pack(out[0].data, 'dt', true), ...pack(out[1].data, 'dt', false),
        ...pack(out[2].data, 'def', true), ...pack(out[3].data, 'def', false),
      ];
      const byId = new Map();
      all.forEach((r) => {
        const k = `${r._kind}:${r.id}`;
        const prev = byId.get(k);
        if (prev) { prev._viaType = prev._viaType || r._viaType; return; }
        byId.set(k, r);
      });

      const scored = [...byId.values()]
        .filter((r) => inScope(r.production_sessions?.line_name))
        .map((r) => ({ ...r, _score: relevance(term, r._type, r.description) }))
        // ประเภทตรง = เก็บเสมอ · ที่มาจากข้อความต้องผ่านเกณฑ์ความคล้าย (ไม่งั้น 4-gram จะลากขยะเข้ามา)
        .filter((r) => r._viaType || r._score >= CLUSTER_THRESHOLD)
        .sort((a, b) => b._score - a._score
          || String(b.production_sessions?.work_date).localeCompare(String(a.production_sessions?.work_date)));

      setRes({ term, rows: scored, hitCap, typeHits: dtTypeIds.length + defTypeIds.length, pats });
    } catch (e) {
      console.error('[SymptomSearch]', e);
      setErr(e?.message || String(e));
      setRes(null);
    } finally { setBusy(false); }
  }, [q, from, to, inScope]);

  /* สรุป + จัดกลุ่ม "แบบการเขียน" — บอกว่าอาการนี้ถูกบันทึกกี่สำนวน (ไว้ใช้เป็นคำค้นรอบหน้า) */
  const sum = useMemo(() => {
    if (!res) return null;
    const dt = res.rows.filter((r) => r._kind === 'dt');
    const def = res.rows.filter((r) => r._kind === 'def');
    const days = new Set(res.rows.map((r) => r.production_sessions?.work_date).filter(Boolean));
    const lines = new Set(res.rows.map((r) => r.production_sessions?.line_name).filter(Boolean));
    const machines = new Set(dt.map((r) => r.machine_no).filter(Boolean));
    const { clusters } = clusterNotes(res.rows, (r) => r.description || r._type, () => 1);
    return {
      dt, def, days: days.size, lines: [...lines].sort(), machines: [...machines].sort(),
      dtMin: dt.reduce((a, r) => a + (Number(r.duration_min) || 0), 0),
      ngQty: def.reduce((a, r) => a + (Number(r.qty_ng) || 0) + (Number(r.qty_suspect) || 0), 0),
      clusters: clusters.slice(0, 6),
    };
  }, [res]);

  const box = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' };
  const th = { textAlign: 'left', fontSize: 11.5, color: 'var(--muted)', fontWeight: 700, padding: '6px 8px', whiteSpace: 'nowrap' };
  const td = { fontSize: 12.5, padding: '6px 8px', borderTop: '1px solid var(--border)', verticalAlign: 'top' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={box}>
        <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 8 }}>🔎 ค้นจากอาการที่ลูกค้าแจ้ง</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 260px', minWidth: 220 }}>
            <label style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700 }}>อาการ</label>
            <input value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
              placeholder="เช่น ตัดไม่ขาด · นัทไม่มี · เป็นครีบ · โรบอทชนจิ๊ก"
              style={{ width: '100%', marginTop: 3 }} />
          </div>
          <div>
            <label style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700 }}>ตั้งแต่</label>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={{ width: 150, marginTop: 3 }} />
          </div>
          <div>
            <label style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700 }}>ถึง</label>
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} style={{ width: 150, marginTop: 3 }} />
          </div>
          <button onClick={run} disabled={busy || !q.trim()}
            style={{ padding: '9px 18px', borderRadius: 8, border: 'none', fontWeight: 800, fontSize: 13,
                     background: busy || !q.trim() ? 'var(--bg3)' : 'var(--accent)', color: busy || !q.trim() ? 'var(--muted)' : '#fff',
                     cursor: busy || !q.trim() ? 'default' : 'pointer' }}>
            {busy ? 'กำลังค้น…' : '🔎 ค้นหา'}
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 7, lineHeight: 1.55 }}>
          ค้นจาก <b>ชื่อประเภท</b> + <b>ข้อความที่พนักงานพิมพ์</b> ของ <b>ของเสีย</b> และ <b>เครื่องหยุด</b> ในช่วงวันที่เลือก
          · เป็นการค้นด้วย <b>คำ</b> ไม่ใช่ความหมาย — ลองคำใกล้เคียงหลายแบบด้วย
        </div>
      </div>

      {err && (
        <div style={{ ...box, borderColor: '#ef4444', color: '#fca5a5', fontSize: 12.5 }}>
          ⚠️ ค้นไม่สำเร็จ — {err}
          <div style={{ color: 'var(--muted)', marginTop: 4 }}>ยังไม่ใช่คำตอบว่า “ไม่เจอ” · ลองใหม่อีกครั้ง ถ้ายังไม่ได้แจ้งผู้ดูแลระบบ</div>
        </div>
      )}

      {res && res.rows.length === 0 && (
        <div style={{ ...box, fontSize: 12.5, lineHeight: 1.7 }}>
          <b>ไม่พบรายการที่ตรงกับ “{res.term}”</b> ในช่วง {fmtDay(from)} – {fmtDay(to)}
          <div style={{ color: 'var(--muted)', marginTop: 6 }}>
            ⚠️ <b>ไม่เจอ ≠ ไม่เคยเกิด</b> — อาจเกิดจริงแต่ถูกบันทึกด้วยคำอื่น หรือลงเป็นประเภทกว้างๆ โดยไม่ได้กรอกรายละเอียด
            <div style={{ marginTop: 4 }}>ลอง: ใช้คำสั้นลง (เช่น “ตัดไม่ขาด” → “ตัดไม่”) · ขยายช่วงวัน · ลองคำที่หน้างานใช้จริง</div>
          </div>
        </div>
      )}

      {res && sum && res.rows.length > 0 && (
        <>
          <div style={{ ...box, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
            <div><div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700 }}>เจอทั้งหมด</div>
              <div style={{ fontSize: 22, fontWeight: 900 }}>{res.rows.length} <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>ครั้ง</span></div></div>
            <div><div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700 }}>🚫 ของเสีย</div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{sum.def.length} <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>ครั้ง · {sum.ngQty.toLocaleString()} ชิ้น</span></div></div>
            <div><div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700 }}>🔧 เครื่องหยุด</div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{sum.dt.length} <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>ครั้ง · {sum.dtMin.toLocaleString()} นาที</span></div></div>
            <div><div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700 }}>กระจายตัว</div>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{sum.days} วัน · {sum.lines.length} ไลน์{sum.machines.length ? ` · ${sum.machines.length} เครื่อง` : ''}</div></div>
          </div>

          {sum.clusters.length > 1 && (
            <div style={{ ...box }}>
              <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>📝 อาการนี้ถูกเขียนไว้กี่แบบ</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {sum.clusters.map((c, i) => (
                  <span key={i} title={c.samples.length ? `เขียนแบบอื่น: ${c.samples.join(' · ')}` : undefined}
                    style={{ fontSize: 11.5, fontWeight: 700, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 999, padding: '3px 10px' }}>
                    {c.name} <b>×{c.count}</b>{c.variants > 1 ? <span style={{ color: 'var(--muted)' }}> ({c.variants} สำนวน)</span> : null}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
                ใช้เป็นคำค้นรอบหน้าได้ — สำนวนที่ต่างกันมากอาจหลุดจากผลค้นครั้งนี้
              </div>
            </div>
          )}

          {res.hitCap && (
            <div style={{ ...box, borderColor: '#f59e0b', color: '#fbbf24', fontSize: 12.5 }}>
              ⚠️ ผลค้นชนเพดาน {ROW_LIMIT} รายการต่อชนิด — ที่แสดงอาจไม่ครบ ให้แคบช่วงวันลงแล้วค้นใหม่
            </div>
          )}

          <div style={{ ...box, padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
              <thead><tr style={{ background: 'var(--bg3)' }}>
                <th style={th}>วันที่</th><th style={th}>ไลน์ / กะ</th><th style={th}>ชนิด</th>
                <th style={th}>ประเภท</th><th style={th}>เครื่อง / ชิ้นงาน</th>
                <th style={{ ...th, textAlign: 'right' }}>จำนวน</th><th style={th}>ข้อความที่บันทึก</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {res.rows.slice(0, 200).map((r) => {
                  const s = r.production_sessions || {};
                  const isDt = r._kind === 'dt';
                  const prodNo = r.prod_orders?.prod_no;
                  return (
                    <tr key={`${r._kind}:${r.id}`}>
                      <td style={td}>{fmtDay(s.work_date)}</td>
                      <td style={td}>{s.line_name || '—'}<div style={{ color: 'var(--muted)', fontSize: 11 }}>{s.shift === 'night' ? 'กะดึก' : 'กะเช้า'}</div></td>
                      <td style={td}><span style={{ fontSize: 11.5, fontWeight: 800, color: isDt ? '#f59e0b' : '#ef4444' }}>{isDt ? '🔧 เครื่องหยุด' : '🚫 ของเสีย'}</span></td>
                      <td style={td}>{r._type || '—'}
                        {r._viaType && <div style={{ fontSize: 10.5, color: 'var(--accent)', fontWeight: 700 }}>ชื่อประเภทตรง</div>}</td>
                      <td style={td}>{isDt ? (r.machine_no || <span style={{ color: 'var(--muted)' }}>ไม่ระบุเครื่อง</span>)
                        : (r.prod_orders?.part_name || r.prod_orders?.mat_no || '—')}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {isDt ? `${Number(r.duration_min) || 0} น.` : `${(Number(r.qty_ng) || 0) + (Number(r.qty_suspect) || 0)} ชิ้น`}</td>
                      <td style={{ ...td, maxWidth: 320 }}>{r.description || <span style={{ color: 'var(--muted)' }}>— ไม่ได้กรอกรายละเอียด —</span>}</td>
                      <td style={td}>
                        {!isDt && prodNo && onOpenOrder && (
                          <button onClick={() => onOpenOrder(prodNo)}
                            style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 9px', borderRadius: 6, cursor: 'pointer',
                                     background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', whiteSpace: 'nowrap' }}>
                            → สอบกลับใบนี้
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {res.rows.length > 200 && (
              <div style={{ fontSize: 11.5, color: 'var(--muted)', padding: '8px 12px' }}>
                แสดง 200 จาก {res.rows.length} รายการ (เรียงตามความเกี่ยวข้อง) — แคบช่วงวันเพื่อดูให้ครบ
              </div>
            )}
          </div>

          <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
            ⚠️ รายการข้างบนคือ <b>สิ่งที่น่าจะเกี่ยวกับอาการนี้</b> ไม่ใช่ข้อสรุปว่าเป็นสาเหตุ —
            เลือกใบที่สงสัยแล้วกด “สอบกลับใบนี้” เพื่อดูหลักฐานเต็ม (คน/เครื่อง/4M/PFMEA) แล้วตัดสินเอง
            {sum.dt.length > 0 && <> · เครื่องหยุดไม่มีเลขใบผลิตผูกไว้ ให้ดูจากไลน์+วันที่แล้วเปิดกะนั้นใน Daily Report</>}
          </div>
        </>
      )}
    </div>
  );
}
