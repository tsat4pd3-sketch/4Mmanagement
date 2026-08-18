/* ═══ 📉 วัดประสิทธิผล 8D จากข้อมูลจริง (เฟส 4 · docs/CLOSED-LOOP-8D-PE.md) ═══
   2026-08-18 · IATF 16949 §10.2.4 "ทวนสอบว่ามาตรการแก้ไขได้ผลจริง"

   ตอบคำถามเดียว: **ปิด 8D ไปแล้ว ของเสียลดจริงไหม**
   เทียบของเสียต่อ "วันผลิตจริง" ก่อน/หลังวันที่มาตรการมีผล (D6)

   ⚠️ กฎที่ห้ามแก้ย้อน:
     · ระบบรายงานตัวเลข **ไม่ตัดสินแทนคน** — ไม่ auto-reopen ใบ ไม่แก้สถานะเอง
     · "วัดไม่ได้" ต้องเป็นคำตอบของตัวเอง ห้ามกลายเป็น "ไม่ได้ผล" (สูตรอยู่ utils/capaEffect.js)
     · ปิดใบทั้งที่ตัวเลขไม่ลด = ทำได้ แต่ต้องยืนยัน แล้ว stamp ไว้ให้เห็นตลอดไป
       (บล็อกแข็งเกินไป คนจะเลี่ยงด้วยการไม่เปิด CAPA เลย ซึ่งแย่กว่า) */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabaseDR } from '../supabaseClient';
import { sumDefectQty } from '../utils/oee';
import {
  effectWindow, splitBeforeAfter, judgeEffect, effectSummaryText,
  VERDICTS, DEFAULT_WINDOW, todayStr,
} from '../utils/capaEffect';

const inputSt = { width: '100%', padding: '6px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 12 };
const btn = (bg, fg = '#08130a') => ({ padding: '5px 11px', borderRadius: 7, border: 'none', background: bg, color: fg, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' });

function Note({ tone = 'muted', children }) {
  const c = { muted: 'var(--muted)', warn: '#f59e0b', bad: '#ef4444' }[tone];
  return (
    <div style={{ padding: '8px 11px', borderRadius: 8, border: `1px ${tone === 'muted' ? 'dashed' : 'solid'} ${tone === 'muted' ? 'var(--border2)' : `${c}66`}`, background: tone === 'muted' ? 'transparent' : `${c}14`, fontSize: 11.5, color: tone === 'muted' ? 'var(--muted)' : c, lineHeight: 1.6 }}>
      {children}
    </div>
  );
}

/** แถบเทียบก่อน/หลัง — ภาษาภาพเดียวกับ /improvements */
function Bars({ m }) {
  const max = Math.max(m.beforePerDay, m.afterPerDay, 0.001);
  const rows = [
    ['ก่อนแก้', m.beforePerDay, m.beforeTotal, m.beforeDays, '#ef4444'],
    ['หลังแก้', m.afterPerDay, m.afterTotal, m.afterDays, m.afterPerDay <= m.beforePerDay ? '#22c55e' : '#ef4444'],
  ];
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {rows.map(([label, perDay, total, days, color]) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ width: 54, fontSize: 11.5, fontWeight: 700, color: 'var(--text2)' }}>{label}</span>
          <div style={{ flex: 1, height: 15, background: 'var(--bg3)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, (perDay / max) * 100)}%`, height: '100%', background: color, borderRadius: 4, transition: 'width .4s' }} />
          </div>
          <span style={{ width: 170, textAlign: 'right', fontSize: 11.5, fontWeight: 800, color: 'var(--text)' }}>
            {perDay.toFixed(1)} ชิ้น/วัน{' '}
            <span style={{ fontWeight: 600, color: 'var(--muted)' }}>({total} / {days} วันผลิต)</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * @param {object}   capa      แถว qa_capa ที่กำลังเปิดอยู่
 * @param {function} onChange  (patch) => void  แก้ค่าใน state ของโมดัลแม่
 * @param {boolean}  canEdit         ตั้งค่าการวัดได้ไหม (qa:record)
 * @param {boolean}  canWriteResult  เขียนช่อง "ผลตรวจประสิทธิผล" ได้ไหม (qa:manage — ต้องตรงกับ gate ของช่องนั้น)
 * @param {function} onResult        (judge, measure, loading) => void  ส่งผลกลับให้แม่ใช้ตอนกดปิดใบ
 */
export default function CapaEffectiveness({ capa, onChange, canEdit, canWriteResult, onResult }) {
  const [types, setTypes] = useState([]);
  const [data, setData] = useState(null);      // { m, sessions } หรือ null
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [noTrial, setNoTrial] = useState(false);  // ยังไม่มีธงงานทดลองในฐาน = ตัวเลขรวม try-out ปนมา
  const [typesErr, setTypesErr] = useState(false);
  const [capped, setCapped] = useState(false);    // หน้าต่างเทียบยังเดินไม่ครบ = ผลระหว่างทาง
  const seqRef = useRef(0);                       // กันผลลัพธ์เก่ากลับมาทับผลใหม่ (ช่องไลน์/พาร์ทพิมพ์อิสระ)

  const pivot = capa.d6_effective_from || '';
  const win = Number(capa.eff_window_days) || DEFAULT_WINDOW;
  const closed = capa.status === 'closed';

  /* ── ใบที่ปิดแล้ว: อ่านค่าที่ stamp ไว้ ห้ามคำนวณใหม่ ──
     (ของเสียถูกแก้/เพิ่มทีหลังได้ — คำนวณสดจะทำให้ใบเก่าเปลี่ยนคำตอบเองเงียบๆ)
     ⚠️ ต้อง useMemo — ถ้าสร้าง object ใหม่ทุก render, load จะเปลี่ยน identity แล้วยิง DB วนไม่จบ */
  const stamped = useMemo(
    () => (closed && capa.eff_verdict
      ? { j: { verdict: capa.eff_verdict, ...VERDICTS[capa.eff_verdict], reason: capa.eff_snapshot?.reason || '' }, m: capa.eff_snapshot }
      : null),
    [closed, capa.eff_verdict, capa.eff_snapshot],
  );

  /* ⚠️ supabase-js **คืน** { error } ไม่ throw → .catch() เป็นโค้ดตาย
     โหลดประเภทไม่ได้แล้วเงียบ = dropdown ว่าง → คนวัดแบบ "ทุกประเภททั้งไลน์" โดยไม่รู้ตัว
     ซึ่งให้ verdict คนละตัวกับที่ตั้งใจ */
  useEffect(() => {
    (async () => {
      const { data: d, error } = await supabaseDR.from('dr_defect_types')
        .select('id, name_th, is_active').eq('is_active', true).order('sort_order');
      if (error) { console.warn('[capaEffect] โหลดประเภทของเสียไม่ได้', error); setTypesErr(true); return; }
      setTypes(d || []); setTypesErr(false);
    })();
  }, []);

  const load = useCallback(async () => {
    if (stamped) return;
    /* กันผลลัพธ์เก่าทับผลใหม่ — ช่อง "ไลน์ผลิต"/"เลขพาร์ท" เป็น input พิมพ์อิสระ
       response ของชื่อที่พิมพ์ค้างกลางคันอาจกลับมาช้ากว่าแล้ว setData ทับตัวที่ถูก */
    const reqId = ++seqRef.current;
    const fresh = () => reqId === seqRef.current;
    const w = effectWindow(pivot, win);
    if (!w || !capa.line_name) { setData(null); setCapped(false); return; }
    setLoading(true); setErr('');
    try {
      const { data: sessions, error: e1 } = await supabaseDR.from('production_sessions')
        .select('id, work_date').eq('line_name', capa.line_name)
        .gte('work_date', w.from).lte('work_date', w.to).limit(2000);
      if (e1) throw e1;
      if (!fresh()) return;
      if (!sessions?.length) { setData({ m: null, empty: true }); return; }

      /* ⚠️ ต้อง select excl_from_q ผ่าน join — ไม่งั้นเห็นแค่ is_trial แล้วงานทดลอง
         ที่ตั้งไว้ที่ "ประเภท" จะหลุดเข้ามาปนกับของเสียจริง (กฎ oee.js §7) */
      const ids = sessions.map((s) => s.id);
      /* ธงงานทดลอง (20260817_defect_trial_flag) อาจยังไม่ apply → ถอยไป select ชุดเดิม
         ⚠️ ถอยแล้วต้องบอกบนจอ: ตัวเลขจะรวมงานทดลองปนเข้ามา ไม่ใช่แค่ "ไม่มีธง" */
      const FULL = 'session_id, qty_ng, qty_suspect, is_trial, defect_type_id, prod_orders(mat_no), dr_defect_types(excl_from_q)';
      const SLIM = 'session_id, qty_ng, qty_suspect, defect_type_id, prod_orders(mat_no)';
      let sel = FULL, noTrialFlag = false, rows = [];
      for (let i = 0; i < ids.length; i += 120) {           // .in() ยาวเกินไป proxy ตัด
        const run = async (s) => {
          let q = supabaseDR.from('defect_logs').select(s).in('session_id', ids.slice(i, i + 120));
          if (capa.eff_defect_type_id) q = q.eq('defect_type_id', capa.eff_defect_type_id);
          return q;
        };
        let { data: d, error: e2 } = await run(sel);
        if (e2?.code === '42703' && sel === FULL) {
          sel = SLIM; noTrialFlag = true;
          ({ data: d, error: e2 } = await run(SLIM));
        }
        if (e2) throw e2;
        rows = rows.concat(d || []);
      }
      if (!fresh()) return;
      setNoTrial(noTrialFlag); setCapped(w.capped);
      // จำกัดเฉพาะพาร์ทของใบนี้ ถ้าระบุ (mat_no ของ dr_products ≠ part_no ลูกค้าเสมอไป → เทียบทั้ง 2 ทาง)
      const pn = (capa.part_no || '').trim().toUpperCase().replace(/[\s-]/g, '');
      const filtered = pn
        ? rows.filter((r) => {
          const m = (r.prod_orders?.mat_no || '').toUpperCase().replace(/[\s-]/g, '');
          return !m || m === pn;   // ไม่รู้ mat = ไม่ตัดทิ้ง (ดีกว่าตัดของจริงหาย)
        })
        : rows;
      setData({ m: splitBeforeAfter(sessions, filtered, pivot, (r) => sumDefectQty(r, 'line')), matched: filtered.length, raw: rows.length });
    } catch (e) {
      if (!fresh()) return;
      setErr(e?.message || String(e));
      setData(null);
    } finally { if (fresh()) setLoading(false); }
  }, [pivot, win, capa.line_name, capa.part_no, capa.eff_defect_type_id, stamped]);

  /* debounce — ไม่งั้นยิง query ทุกตัวอักษรที่พิมพ์ในช่องไลน์/เลขพาร์ท */
  useEffect(() => { const t = setTimeout(load, 450); return () => clearTimeout(t); }, [load]);

  /* ⚠️ ต้องคืน verdict เสมอ ห้ามคืน null —
     null ทำให้ตอนกดปิดใบ ไม่เข้าทั้ง 2 สาขา confirm แล้ว **ไม่ stamp eff_verdict**
     → ใบนั้นหายจาก KPI "8D ที่ของเสียลดจริง" และคิว "ปิดแล้วแต่ไม่ลด" แบบเงียบ
     (ขัดกฎเฟส 4 ข้อ 5: stamp ผลไว้เสมอ) · `loading` แยกไว้กันปิดตอนตัวเลขยังไม่นิ่ง */
  const judged = useMemo(() => {
    if (stamped) return stamped.j;
    if (!pivot) return judgeEffect(null);                              // no_pivot
    if (!capa.line_name) return judgeEffect({ beforeDays: 0, afterDays: 0 }); // no_data — ไม่รู้ว่าไลน์ไหน
    if (data?.empty) return judgeEffect({ beforeDays: 0, afterDays: 0 });
    if (!data?.m) return judgeEffect({ beforeDays: 0, afterDays: 0 }); // โหลดพัง/ยังไม่เสร็จ = ยังไม่รู้ (ไม่ใช่ "ไม่ได้ผล")
    return judgeEffect(data.m);
  }, [stamped, pivot, capa.line_name, data]);

  useEffect(() => { onResult?.(judged, stamped ? stamped.m : data?.m, loading); }, [judged, data, stamped, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = stamped ? stamped.m : data?.m;
  const V = judged ? VERDICTS[judged.verdict] : null;
  const typeLabel = capa.eff_defect_type_label || types.find((t) => t.id === capa.eff_defect_type_id)?.name_th || '';

  return (
    <div style={{ marginTop: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg2)' }}>
      <div style={{ padding: '9px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 800 }}>📉 ประสิทธิผลจากข้อมูลจริง</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>ของเสียต่อวันผลิต ก่อน/หลังมาตรการมีผล</span>
        {V && !loading && (
          <span style={{ marginLeft: 'auto', padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 800, color: V.color, background: `${V.color}22`, border: `1px solid ${V.color}66` }}>
            {V.short}
          </span>
        )}
        {stamped && <span style={{ fontSize: 11, color: 'var(--muted)' }}>· ค่าที่บันทึกไว้ตอนปิดใบ</span>}
      </div>

      <div style={{ padding: 12, display: 'grid', gap: 10 }}>
        {/* ── ตัวแปรของการวัด ── */}
        {!closed && (
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '160px 130px 1fr', gap: 10 }}>
            <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>
              วันที่มาตรการมีผลจริง (D6) *
              <input type="date" style={{ ...inputSt, marginTop: 4 }} value={pivot} max={todayStr()} disabled={!canEdit}
                onChange={(e) => onChange({ d6_effective_from: e.target.value || null })} />
            </label>
            <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>
              หน้าต่างเทียบ
              <select style={{ ...inputSt, marginTop: 4 }} value={win} disabled={!canEdit}
                onChange={(e) => onChange({ eff_window_days: Number(e.target.value) })}>
                {[14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} วัน</option>)}
              </select>
            </label>
            <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>
              ประเภทของเสียที่วัด (ว่าง = ทุกประเภทของพาร์ทนี้)
              <select style={{ ...inputSt, marginTop: 4 }} value={capa.eff_defect_type_id || ''} disabled={!canEdit}
                onChange={(e) => {
                  const t = types.find((x) => x.id === e.target.value);
                  onChange({ eff_defect_type_id: e.target.value || null, eff_defect_type_label: t?.name_th || null });
                }}>
                <option value="">— ทุกประเภท —</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name_th}</option>)}
              </select>
            </label>
          </div>
        )}

        {/* ── สิ่งที่ยังขาด — บอกตรงๆ ว่าต้องเติมอะไร ห้ามปล่อยจอว่าง ── */}
        {!capa.line_name && <Note tone="warn">⚠️ ยังไม่ได้ระบุ <b>ไลน์ผลิต</b> — ระบบหาข้อมูลการผลิตไม่ได้ (กรอกช่อง "ไลน์ผลิต" ด้านบน)</Note>}
        {capa.line_name && !pivot && !closed && (
          <Note tone="warn">
            ⚠️ ยังไม่ได้ระบุ <b>วันที่มาตรการมีผลจริง</b> — ระบบยังวัดไม่ได้<br />
            เป็นคนละวันกับวันปิดใบ: ใส่วันที่ของ D6 ที่มาตรการเริ่มใช้จริงหน้างาน
          </Note>
        )}
        {!capa.part_no && capa.line_name && pivot && (
          <Note>ℹ️ ไม่ได้ระบุเลขพาร์ท — ระบบนับของเสียของ<b>ทั้งไลน์</b> อาจถูกรบกวนจากพาร์ทอื่น (กรอกเลขพาร์ทเพื่อให้แคบลง)</Note>
        )}

        {/* ใบเก่าที่ปิดก่อนมีระบบวัด — ไม่มีค่า stamp ให้อ่าน ต้องบอกว่าเลขนี้คำนวณสด "ตอนนี้"
            ห้ามให้เข้าใจผิดว่าเป็นค่าที่บันทึกไว้ตอนปิดใบ */}
        {closed && !capa.eff_verdict && (
          <Note>ℹ️ ใบนี้ปิดไปก่อนที่ระบบจะมีการวัดประสิทธิผล — {pivot ? <>ตัวเลขข้างล่าง<b>คำนวณสด ณ ตอนนี้</b> ไม่ใช่ค่าที่บันทึกไว้ตอนปิดใบ</> : <>และไม่ได้ระบุวันที่มาตรการมีผล จึงย้อนวัดให้ไม่ได้</>}</Note>
        )}
        {typesErr && <Note tone="warn">⚠️ โหลดรายการ <b>ประเภทของเสีย</b> ไม่สำเร็จ — ตอนนี้วัดแบบ "ทุกประเภท" เลือกเจาะจงประเภทไม่ได้</Note>}
        {noTrial && <Note tone="warn">⚠️ ฐานข้อมูลยังไม่มีธง <b>งานทดลอง (try-out)</b> — ตัวเลขนี้จึงรวมของเสียตอนลองแม่พิมพ์/ลองงานใหม่เข้ามาด้วย (apply migration 20260817_defect_trial_flag แล้วจะแยกให้อัตโนมัติ)</Note>}
        {err && <Note tone="bad">🔴 โหลดข้อมูลไม่สำเร็จ — <b>ตัวเลขที่เห็นอาจไม่ครบ</b><br />{err}</Note>}
        {loading && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>กำลังคำนวณ…</div>}

        {/* ── ผลลัพธ์ ── */}
        {m && judged && (
          <>
            <Bars m={m} />
            <div style={{ padding: '8px 11px', borderRadius: 8, background: `${V.color}14`, border: `1px solid ${V.color}55`, fontSize: 12, color: V.color, fontWeight: 700, lineHeight: 1.6 }}>
              {V.label}{judged.reason ? ` — ${judged.reason}` : ''}
              {judged.verdict === 'worse' || judged.verdict === 'not_effective' ? (
                <div style={{ fontWeight: 600, marginTop: 3 }}>
                  ต้องกลับไปทบทวน D4 (สาเหตุราก) — สาเหตุที่ระบุอาจไม่ใช่ตัวจริง หรือมาตรการยังไม่ถูกทำจริงหน้างาน
                </div>
              ) : null}
            </div>
            {m.afterTotal > 0 && judged.verdict !== 'too_early' && (
              <Note tone={judged.verdict === 'effective' ? 'muted' : 'warn'}>
                {judged.verdict === 'effective' ? 'ℹ️' : '⚠️'} หลังมาตรการยัง<b>เกิดซ้ำ {m.afterTotal} ชิ้น</b> ({m.afterCount} ครั้ง)
                {typeLabel ? ` ในประเภท "${typeLabel}"` : ''} — ถ้าเป็นอาการเดียวกับที่ลูกค้าเคลม ยังปิดไม่ได้จริง
              </Note>
            )}
          </>
        )}
        {capped && m && <Note>⏳ หน้าต่างเทียบ {win} วัน<b>ยังเดินไม่ครบ</b> — ผลนี้เป็นค่าระหว่างทาง จะนิ่งขึ้นเมื่อครบหน้าต่าง</Note>}
        {data?.empty && <Note tone="warn">⚠️ ไม่พบกะที่เปิดผลิตของไลน์ <b>{capa.line_name}</b> ในช่วงที่วัด — ตรวจว่าชื่อไลน์ตรงกับที่ใช้ใน Daily Report ไหม</Note>}

        {/* ── เติมผลลงช่องประสิทธิผล (คนแก้ต่อได้) ── */}
        {!closed && m && judged && canWriteResult && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button style={btn('#4d9fff', '#fff')} onClick={() => onChange({
              effectiveness: [capa.effectiveness?.trim(), effectSummaryText(m, judged, { pivot, windowDays: win, typeLabel })].filter(Boolean).join('\n\n'),
            })}>📌 เติมตัวเลขนี้ลงช่องประสิทธิผล</button>
          </div>
        )}

        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6, borderTop: '1px dashed var(--border2)', paddingTop: 8 }}>
          หารด้วย <b>จำนวนวันที่ไลน์ผลิตจริง</b> ไม่ใช่วันปฏิทิน (ไลน์หยุด ของเสียเป็น 0 ไม่ได้แปลว่าได้ผล) ·
          {noTrial ? '' : 'ไม่นับ'}<b>งานทดลอง</b>{noTrial ? ' ถูกนับรวมอยู่' : ' (try-out)'} · ตัวเลขนี้เป็น<b>สัญญาณ ไม่ใช่คำตัดสิน</b> — คนเป็นผู้สรุป
        </div>
      </div>
    </div>
  );
}
