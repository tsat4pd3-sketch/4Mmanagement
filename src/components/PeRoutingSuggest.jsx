/**
 * PeRoutingSuggest — modal "🔀 เสนอ routing เข้า VSM" จากรายการ OP ของ PFC (/pe-docs)
 *
 * ⚠️ กฎเหล็ก: ระบบเสนอ คนตรวจ/ติ๊ก/แก้ แล้วกดยืนยันถึงเขียน `part_routings`
 *    (ห้าม insert อัตโนมัติ — หลักเดียวกับ AI intake / missingLinksFromRouting)
 * ตัวแปลงเป็น pure ที่ src/utils/peRouting.js (มีเทส) — ที่นี่ทำแค่โหลด/แสดง/เขียน DB
 * part_routings อยู่ฝั่ง DR (anon) และอยู่ใน DR_AUDIT_TABLES → updated_by_name ถูก stamp ให้เอง
 */
import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import { proposeRoutingFromPfc, resolveMatForSet, toRoutingRows } from '../utils/peRouting';

const inp = { fontSize: 12, padding: '4px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)' };
const KIND_TH = { process: '🔧 ขั้นผลิต', inspection: '🔍 จุดตรวจ' };

export default function PeRoutingSuggest({ set, procs, lines = [], onClose }) {
  const [products, setProducts] = useState(null);   // dr_products (DR) — ใช้ resolve MAT + ให้ VSM หาต่อ
  const [matNo, setMatNo] = useState(null);
  const [how, setHow] = useState(null);             // set_mat / p_no / ambiguous / none
  const [candidates, setCandidates] = useState([]);
  const [existing, setExisting] = useState([]);     // routing เดิมที่ active ของ mat นี้
  // modal mount ใหม่ทุกครั้งที่เปิด (routingOpen && <...>) — เสนอครั้งเดียวตอน mount ผ่าน initializer
  // (ไม่ทำใน effect: setState sync ใน effect = cascading render — กฎ react-hooks/set-state-in-effect)
  const [{ steps: steps0, skipped }] = useState(() => proposeRoutingFromPfc(procs));
  const [steps, setSteps] = useState(steps0);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      const { data, error } = await supabaseDR.from('dr_products')
        .select('mat_no, p_no, name, line_name').not('mat_no', 'is', null);
      if (dead) return;
      if (error) { toast.error(`โหลดสินค้าไม่สำเร็จ: ${error.message}`); setProducts([]); return; }
      setProducts(data || []);
      const r = resolveMatForSet(set, data || []);
      setMatNo(r.matNo); setHow(r.how); setCandidates(r.candidates || []);
    })();
    return () => { dead = true; };
  }, [set]);

  useEffect(() => {
    // matNo มีทางเดียว null → เลือกแล้ว (ไม่ย้อนกลับ) — ไม่ต้อง reset existing ตอน null
    if (!matNo) return;
    let dead = false;
    supabaseDR.from('part_routings').select('id, seq, step_name, line_name').eq('mat_no', matNo).eq('is_active', true).order('seq')
      .then(({ data, error }) => {
        if (dead) return;
        if (error) toast.error(`เช็ค routing เดิมไม่สำเร็จ: ${error.message}`);
        setExisting(data || []);
      });
    return () => { dead = true; };
  }, [matNo]);

  const included = useMemo(() => steps.filter(s => s.include).length, [steps]);
  const setStep = (i, patch) => setSteps(prev => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const lineNames = useMemo(() => [...new Set(lines.map(l => l.name))], [lines]);
  const matched = matNo ? products?.find(p => p.mat_no === matNo) : null;

  const confirm = async () => {
    const rows = toRoutingRows(matNo, steps);
    if (!rows.length) { toast.error('ยังไม่ได้ติ๊กขั้นไหนเลย'); return; }
    if (existing.length && !window.confirm(
      `พาร์ท ${matNo} มี routing เดิมอยู่ ${existing.length} ขั้น — แทนที่ทั้งชุด?\n(ชุดเดิมถูกปิดใช้งานเก็บเป็นประวัติ ไม่ลบทิ้ง)`)) return;
    setSaving(true);
    const oldIds = existing.map(r => r.id);
    if (oldIds.length) {
      // ปิดชุดเดิมก่อน (unique index (mat_no,seq) เฉพาะแถว active) — นับแถวเสมอตามกฎ RLS-เงียบ
      const { data: off, error } = await supabaseDR.from('part_routings')
        .update({ is_active: false }).in('id', oldIds).select('id');
      if (error || (off || []).length !== oldIds.length) {
        toast.error(`ปิดชุดเดิมไม่สำเร็จ${error ? `: ${error.message}` : ' (แก้ได้ไม่ครบ)'}`);
        setSaving(false); return;
      }
    }
    const { error: insErr } = await supabaseDR.from('part_routings').insert(rows);
    if (insErr) {
      // กู้ชุดเดิมกลับ — ห้ามปล่อยให้ routing หายทั้งที่ของใหม่ไม่เข้า
      if (oldIds.length) await supabaseDR.from('part_routings').update({ is_active: true }).in('id', oldIds).select('id');
      toast.error(`บันทึกไม่สำเร็จ: ${insErr.message}${oldIds.length ? ' — คืนชุดเดิมให้แล้ว' : ''}`);
      setSaving(false); return;
    }
    setSaving(false); setDone(true);
    toast.success(`บันทึก routing ${rows.length} ขั้นของ ${matNo} แล้ว`);
  };

  return (
    <div className="overlay"><div className="modal" style={{ width: 'min(860px, 96vw)', maxHeight: '92vh', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>🔀 เสนอ routing เข้า VSM — {set.part_no}</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.6 }}>
        ระบบแปลงรายการ OP ของ PFC เป็นร่างลำดับกระบวนการ (ตาราง <b>part_routings</b> ที่ใบ VSM ใช้) —
        <b style={{ color: 'var(--text)' }}> ตรวจ/ติ๊กออก/แก้ชื่อ แล้วกดยืนยัน ระบบไม่บันทึกเองอัตโนมัติ</b> ·
        CT / C/O / LOT / คน ไม่ต้องกรอก (VSM ไปหาจากข้อมูลจริงให้)
      </div>

      {products == null ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>⏳ กำลังโหลด…</div>
      ) : done ? (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>✅ บันทึก routing แล้ว</div>
          <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 14 }}>
            เปิดหน้า VSM เลือกสินค้า <b>{matNo}</b> แล้วกด "⚡ สร้างร่างจากข้อมูลจริง" — ผังจะแตกเป็นหลายกล่องตาม routing นี้
          </div>
          <Link to="/vsm" style={{ fontSize: 13, fontWeight: 700, color: '#08130a', background: 'var(--accent)', padding: '8px 18px', borderRadius: 6, textDecoration: 'none' }}>
            🗺️ ไปหน้า VSM
          </Link>
        </div>
      ) : !matNo ? (
        <div style={{ background: 'rgba(245,158,11,0.12)', borderLeft: '3px solid #f59e0b', borderRadius: 6, padding: '10px 14px', fontSize: 12.5, color: 'var(--text)' }}>
          {how === 'ambiguous' ? <>
            ⚠️ เลขพาร์ท {set.part_no} ตรงกับหลาย MAT SAP — <b>เลือกให้ชัดก่อน (ระบบไม่เดาให้)</b>:
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {candidates.map(c => (
                <button key={c.mat_no} onClick={() => { setMatNo(c.mat_no); setHow('picked'); }}
                  style={{ ...inp, cursor: 'pointer', fontWeight: 700 }}>
                  {c.mat_no} · {c.name}{c.line_name ? ` · ${c.line_name}` : ''}
                </button>
              ))}
            </div>
          </> : <>
            ⚠️ ชุดเอกสารนี้ยังไม่ผูกเลข MAT SAP และเทียบเลขพาร์ท ({set.part_no}) กับ p_no ใน Product Master ไม่เจอ —
            routing ต้องผูกกับ MAT ถึงจะโยงข้อมูลผลิตได้ · <b>กรอก "MAT SAP" ที่ปุ่ม ✏️ แก้ข้อมูลชุด ก่อน</b>
            (หรือตั้ง p_no ของสินค้าที่ Product Master ให้ตรงกับ {set.part_no})
          </>}
        </div>
      ) : <>
        <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
          ผูกกับ MAT SAP: <b style={{ color: 'var(--text)', fontFamily: 'monospace' }}>{matNo}</b>
          {matched ? ` · ${matched.name}` : ''}
          <span style={{ color: 'var(--muted)' }}>
            {how === 'set_mat' ? ' (จากชุดเอกสาร)' : how === 'p_no' ? ` (จับคู่ p_no ${set.part_no})` : ''}
          </span>
          {!matched && <span style={{ color: '#f59e0b' }}> · ⚠ เลขนี้ยังไม่มีใน Product Master — ใบ VSM จะยังเลือกไม่ได้จนกว่าจะเพิ่มสินค้า</span>}
        </div>

        {existing.length > 0 && (
          <div style={{ background: 'rgba(245,158,11,0.12)', borderLeft: '3px solid #f59e0b', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: 'var(--text)', marginBottom: 10 }}>
            ⚠️ พาร์ทนี้มี routing อยู่แล้ว {existing.length} ขั้น ({existing.map(r => r.step_name).slice(0, 3).join(' → ')}{existing.length > 3 ? ' → …' : ''}) —
            ยืนยันจะ<b>แทนที่ทั้งชุด</b> (ชุดเดิมเก็บเป็นประวัติ)
          </div>
        )}
        {included > 10 && (
          <div style={{ fontSize: 11.5, color: '#f59e0b', marginBottom: 8 }}>
            💡 ติ๊กไว้ {included} ขั้น — ใบ VSM ที่อ่านง่ายมักมี 5–8 กล่อง ลองติ๊กออกขั้นย่อย (เช่นจุดตรวจ/สปอตซ้ำๆ) ให้เหลือขั้นหลัก
          </div>
        )}

        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead style={{ background: 'var(--bg2)' }}>
              <tr>{['✓', 'OP', 'ชนิด', 'ชื่อขั้น (แก้ได้)', 'ไลน์', 'เครื่อง', 'จุดพักหลังขั้น (WIP)'].map((h, i) =>
                <th key={i} style={{ padding: '6px 8px', fontSize: 11, color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {steps.map((s, i) => (
                <tr key={i} style={{ opacity: s.include ? 1 : 0.45 }}>
                  <td style={{ padding: '4px 8px', borderTop: '1px solid var(--border)' }}>
                    <input type="checkbox" checked={s.include} onChange={e => setStep(i, { include: e.target.checked })} />
                  </td>
                  <td style={{ padding: '4px 8px', borderTop: '1px solid var(--border)', fontFamily: 'monospace', fontSize: 12, color: 'var(--text)' }}>{s.op_no}</td>
                  <td style={{ padding: '4px 8px', borderTop: '1px solid var(--border)', fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{KIND_TH[s.kind] || s.kind}</td>
                  <td style={{ padding: '4px 6px', borderTop: '1px solid var(--border)' }}>
                    <input value={s.name} onChange={e => setStep(i, { name: e.target.value })} style={{ ...inp, width: 220 }} />
                  </td>
                  <td style={{ padding: '4px 6px', borderTop: '1px solid var(--border)' }}>
                    <input value={s.line_name || ''} onChange={e => setStep(i, { line_name: e.target.value })}
                      list="pe-rt-lines" placeholder="—" style={{ ...inp, width: 130 }} />
                  </td>
                  <td style={{ padding: '4px 8px', borderTop: '1px solid var(--border)', fontFamily: 'monospace', fontSize: 12, color: 'var(--text2)' }}>{s.machine_no || '—'}</td>
                  <td style={{ padding: '4px 6px', borderTop: '1px solid var(--border)' }}>
                    <input value={s.wip_label || ''} onChange={e => setStep(i, { wip_label: e.target.value })}
                      placeholder="เช่น Store Semi" style={{ ...inp, width: 130 }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="pe-rt-lines">{lineNames.map(n => <option key={n} value={n} />)}</datalist>
        </div>

        {skipped.length > 0 && (
          <details style={{ marginTop: 8, fontSize: 11.5, color: 'var(--muted)' }}>
            <summary style={{ cursor: 'pointer' }}>ข้าม {skipped.length} รายการ (ทางเข้า child part / ขนส่ง / rework / จุดพักที่แปลงเป็น WIP แล้ว)</summary>
            {skipped.map((s, i) => (
              <div key={i} style={{ padding: '2px 0 0 14px' }}>
                OP {s.op_no || '—'} · {s.name || '—'} — {s.reason === 'wip' ? `→ เป็นจุดพักหลัง OP ${s.target}` : s.kind}
              </div>
            ))}
          </details>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}>ยกเลิก</button>
          <button onClick={confirm} disabled={saving || !included}
            style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#08130a', fontSize: 13, fontWeight: 800, cursor: 'pointer', opacity: (saving || !included) ? 0.5 : 1 }}>
            {saving ? '⏳ กำลังบันทึก…' : `✅ ยืนยันบันทึก ${included} ขั้น`}
          </button>
        </div>
      </>}
    </div></div>
  );
}
