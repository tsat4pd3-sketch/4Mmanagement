/**
 * QaPieceStepper — แผง "ตรวจทีละชิ้น" ของใบตรวจ QA (sequential acceptance · 2026-09-07)
 *
 * วิธีหน้างาน (คำสั่ง user): หยิบชิ้นที่ 1 ไล่ตรวจ **ทุกจุด** ให้ครบ ค่อยหยิบชิ้นถัดไป
 * ไม่ใช่วัดจุดเดียว 5 ชิ้นรวด (จอเดิม 1 แถว = 1 จุด × ช่อง #1-#5 = ผิดทิศกับมือคนตรวจ)
 *
 * แผงนี้ "ไม่รู้กฎ" — ถาม `evalSequence` (utils/qaSequential) ว่าต่อไปทำอะไร แล้ววาดตามนั้น:
 *   inspecting   → ฟอร์มชิ้นที่ N (ทุกจุด 1 คอลัมน์) + ปุ่มบันทึกชิ้น
 *   await_action → 🚨 แถบแดง (นิ่ง ไม่กระพริบ — UI-CONVENTIONS §2) + ฟอร์ม action (สิทธิ์ qa:record_action)
 *   accepted     → ✅ ปิดใบแล้ว
 * ชิ้นที่ตก → บังคับลง disposition (rework/scrap/hold) + remark ก่อนบันทึก (modal ฟอร์ม ห้ามปิดจาก backdrop)
 *
 * ค่าที่ตัดสินอัตโนมัติมาจาก utils/qaSpec (judgeVariable) — จุดเดียวกับ label สเปค ห้ามเขียนซ้ำ
 */
import { useState, useMemo, useEffect } from 'react';
import { toast } from './Toast';
import { specLabel, judgeVariable } from '../utils/qaSpec';
import { pieceResult, seqLabel, SEQ_RULE } from '../utils/qaSequential';

const JUDGE = {
  ok: { label: 'ผ่าน', color: '#22c55e' },
  ng: { label: 'ไม่ผ่าน', color: '#ef4444' },
  na: { label: 'ข้าม', color: '#6b7280' },
};
export const DISPOSITION = {
  rework: { label: '🔧 Rework (ซ่อมได้)', color: '#f59e0b' },
  scrap:  { label: '🔴 Scrap (ลงถังแดง)', color: '#ef4444' },
  hold:   { label: '⏸ Hold (กักไว้รอตัดสิน)', color: '#a78bfa' },
};
const FOUR_M = ['Man', 'Machine', 'Material', 'Method'];

const Chip = ({ label, color }) => (
  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
    background: `${color}22`, color, border: `1px solid ${color}55`, whiteSpace: 'nowrap' }}>{label}</span>
);
// ห้ามผสม `border` (shorthand) กับ `borderColor` ใน style เดียวกัน — React เตือนทุก rerender → ประกอบ border จาก borderColor ที่ส่งมาแทน
const btn = (bg, color, extra = {}) => {
  const { borderColor, ...rest } = extra;
  return {
    padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12,
    background: bg, color, border: `1px solid ${borderColor || (bg === 'var(--bg3)' ? 'var(--border2)' : bg)}`, ...rest,
  };
};

/** คำตัดสินที่ใช้จริงของจุดในชิ้นนี้ — variable ที่ตั้ง limit ตัดสินเองจากค่า · ที่เหลือใช้ปุ่ม */
function effectiveJudge(item, d) {
  if (!d) return null;
  if (d.judge === 'na') return 'na';
  if (item.item_type === 'variable') {
    const auto = judgeVariable(item, [d.value]);
    if (auto) return auto;                        // มี limit + กรอกค่าแล้ว = ตัดสินอัตโนมัติ
    return d.judge || null;                       // ไม่มี limit → คนกด
  }
  return d.judge || null;
}

export default function QaPieceStepper({
  items, results, pieces, actions, seq, sheet, part, workDate, shift,
  canRecord, canAction, busy, isMobile, fullName, onSavePiece, onSaveAction,
}) {
  const [draft, setDraft] = useState({});            // item_id → { value, judge, note }
  const [dispo, setDispo] = useState(null);          // modal disposition ของชิ้นที่ตก
  const [act, setAct] = useState({ text: '', by: fullName || '', fourM: false, category: 'Machine' });
  useEffect(() => { setDraft({}); }, [sheet?.id, seq?.nextPiece]);   // เปลี่ยนใบ/ชิ้น → เริ่มกรอกใหม่
  useEffect(() => { setAct(a => ({ ...a, by: a.by || fullName || '' })); }, [fullName]);

  const fs = isMobile ? 16 : 13;                     // 16px กัน iOS ซูมตอนโฟกัส
  const inputSt = { width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: fs, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)' };

  const judges = useMemo(() => Object.fromEntries(items.map(i => [i.id, effectiveJudge(i, draft[i.id])])), [items, draft]);
  const result = pieceResult(items.map(i => judges[i.id]));
  const missing = items.filter(i => !judges[i.id]);
  const ngNoNote = items.filter(i => judges[i.id] === 'ng' && !(draft[i.id]?.note || '').trim());
  const failedItems = items.filter(i => judges[i.id] === 'ng');

  const setD = (id, patch) => setDraft(p => ({ ...p, [id]: { ...(p[id] || {}), ...patch } }));
  const passAllAttr = () => {
    // เฉพาะจุดที่ยังไม่มีคำตอบ และไม่ใช่ variable ที่ตั้ง limit (พวกนั้นต้องกรอกค่าจริง)
    setDraft(p => {
      const n = { ...p };
      items.forEach(i => {
        const needValue = i.item_type === 'variable' && (i.lsl != null || i.usl != null);
        if (!judges[i.id] && !needValue) n[i.id] = { ...(n[i.id] || {}), judge: 'ok' };
      });
      return n;
    });
  };

  const submitPiece = () => {
    if (!canRecord) { toast.error('ไม่มีสิทธิ์บันทึกผลตรวจ'); return; }
    if (missing.length) { toast.error(`ยังไม่ได้ตรวจ ${missing.length} จุด (#${missing.slice(0, 5).map(i => i.balloon_no).join(', #')}${missing.length > 5 ? ' …' : ''}) — ต้องครบทุกจุดก่อนบันทึกชิ้น`); return; }
    if (ngNoNote.length) { toast.error(`จุดที่ไม่ผ่านต้องกรอก "เสียอย่างไร" (#${ngNoNote.map(i => i.balloon_no).join(', #')})`); return; }
    const payload = {
      result,
      judgements: Object.fromEntries(items.map(i => [i.id, { judge: judges[i.id], value: draft[i.id]?.value ?? '', note: (draft[i.id]?.note || '').trim() }])),
      failedItems: failedItems.map(i => ({
        item_id: i.id, balloon_no: String(i.balloon_no ?? ''), characteristic: i.characteristic,
        spec_text: specLabel(i), value: draft[i.id]?.value ?? null, note: (draft[i.id]?.note || '').trim() || null,
      })),
    };
    if (result === 'fail') { setDispo({ disposition: 'rework', remark: '', payload }); return; }
    onSavePiece(payload);
  };

  const submitDispo = () => {
    if (!dispo.disposition) { toast.error('เลือก disposition ของชิ้นที่ตก'); return; }
    if (!dispo.remark.trim()) { toast.error('ต้อง remark ว่าจะทำอะไรกับชิ้นนี้ (ชิ้นที่ตกไม่ใช่ defect อัตโนมัติ แต่ต้องมีเหตุผลกำกับ)'); return; }
    onSavePiece({ ...dispo.payload, disposition: dispo.disposition, remark: dispo.remark.trim() });
    setDispo(null);
  };

  const submitAction = () => {
    if (!canAction) { toast.error('ไม่มีสิทธิ์บันทึก action (ต้องเปิดคีย์ qa:record_action ที่ /permissions)'); return; }
    if (!act.text.trim()) { toast.error('บอกว่าแก้ไขอะไร — ใบตรวจต้องสืบย้อนได้ว่า alarm นี้ปิดด้วยอะไร'); return; }
    if (!act.by.trim()) { toast.error('ระบุชื่อคนทำ action'); return; }
    onSaveAction({ text: act.text.trim(), by: act.by.trim(), fourM: act.fourM ? { category: act.category } : null });
    setAct(a => ({ ...a, text: '', fourM: false }));
  };

  const state = seq?.state || 'inspecting';
  const tone = state === 'accepted' ? '#22c55e' : state === 'await_action' ? '#ef4444' : seq?.failsInRound ? '#f59e0b' : '#4d9fff';
  const roundPieces = (pieces || []).filter(p => p.round_no === seq?.round);
  const failedInRound = roundPieces.filter(p => p.result === 'fail');

  return (
    <div style={{ background: 'var(--card)', border: `1px solid ${tone}66`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
      {/* ป้ายสถานะจากตัวเดินกฎ */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontWeight: 800, fontSize: 14 }}>
          {state === 'accepted' ? '✅ ยอมรับแล้ว' : state === 'await_action' ? '🚨 รอ action แก้ไข' : `🔩 ชิ้นที่ ${seq?.nextPiece ?? 1}`}
        </span>
        <Chip label={`รอบที่ ${seq?.round ?? 1}`} color="#6b7280" />
        {seq?.alarmCount > 0 && <Chip label={`alarm ${seq.alarmCount} ครั้ง`} color="#ef4444" />}
        <span style={{ fontSize: 12.5, color: tone, fontWeight: 700 }}>{seqLabel(seq)}</span>
      </div>

      {/* ประวัติชิ้น + action ของใบนี้ */}
      {(pieces?.length > 0 || actions?.length > 0) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, fontSize: 11.5 }}>
          {[...(pieces || [])].sort((a, b) => a.piece_no - b.piece_no).map(p => (
            <span key={p.id || p.piece_no} title={p.failed_items?.length ? `ตก: ${p.failed_items.map(f => `#${f.balloon_no} ${f.characteristic}`).join(' · ')}${p.remark ? `\n${p.remark}` : ''}` : 'ผ่านทุกจุด'}
              style={{ padding: '3px 9px', borderRadius: 999, fontWeight: 700,
                background: p.result === 'pass' ? 'rgba(34,197,94,0.14)' : 'rgba(239,68,68,0.14)',
                color: p.result === 'pass' ? '#22c55e' : '#ef4444', border: `1px solid ${p.result === 'pass' ? '#22c55e55' : '#ef444455'}` }}>
              ชิ้น {p.piece_no} {p.result === 'pass' ? '✓' : `✕${p.disposition ? ` · ${DISPOSITION[p.disposition]?.label?.split(' ')[1] || p.disposition}` : ''}`}
              {p.round_no > 1 ? ` (รอบ ${p.round_no})` : ''}
            </span>
          ))}
          {(actions || []).map(a => (
            <span key={a.id || a.round_no} title={String(a.action_text || '')}
              style={{ padding: '3px 9px', borderRadius: 999, fontWeight: 700, background: 'rgba(245,158,11,0.14)', color: '#f59e0b', border: '1px solid #f59e0b55' }}>
              🛠 action รอบ {a.round_no}: {String(a.action_text || '—').slice(0, 40)}{String(a.action_text || '').length > 40 ? '…' : ''} — {a.action_by || '—'}
              {a.four_m_log_id ? ' · 📋 4M' : ''}
            </span>
          ))}
        </div>
      )}

      {/* ── รอ action ── */}
      {state === 'await_action' && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12.5, marginBottom: 8, lineHeight: 1.6 }}>
            ชิ้นที่ตกในรอบนี้: {failedInRound.map(p => `ชิ้น ${p.piece_no} (${(p.failed_items || []).map(f => `#${f.balloon_no}`).join(', ') || '—'})`).join(' · ') || '—'}
            <br />ฝ่ายผลิตบันทึกว่าแก้ไขอะไร แล้ว QA กลับมาตรวจต่อ ต้องผ่านติดกัน {SEQ_RULE.PASSES_TO_ACCEPT} ชิ้นถึงยอมรับ (ตกอีกชิ้นเดียว = alarm ซ้ำ)
          </div>
          {canAction ? (
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: isMobile ? 'minmax(0,1fr)' : '2fr 1fr', alignItems: 'start' }}>
              <textarea style={{ ...inputSt, minHeight: 64, gridColumn: isMobile ? undefined : '1 / -1' }} placeholder="แก้ไขอะไร / ปรับอะไร (บังคับกรอก)"
                value={act.text} onChange={e => setAct(a => ({ ...a, text: e.target.value }))} />
              <input style={inputSt} placeholder="ชื่อคนทำ action" value={act.by} onChange={e => setAct(a => ({ ...a, by: e.target.value }))} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                <input type="checkbox" checked={act.fourM} onChange={e => setAct(a => ({ ...a, fourM: e.target.checked }))} style={{ width: 'auto' }} />
                เปิดใบ 4M จากการแก้ไขนี้
                {act.fourM && (
                  <select style={{ ...inputSt, width: 'auto', padding: '4px 8px' }} value={act.category} onChange={e => setAct(a => ({ ...a, category: e.target.value }))}>
                    {FOUR_M.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
              </label>
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button disabled={busy} onClick={submitAction} style={btn('#f59e0b', '#fff')}>🛠 บันทึก action แล้วให้ QA ตรวจต่อ</button>
                <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  ใบ 4M เปิดเมื่อ action เป็นการเปลี่ยน คน/เครื่อง/วัตถุดิบ/วิธี — เข้าคิวอนุมัติหัวหน้า → QA ตามปกติ · rework ชิ้นเดียวไม่ต้องเปิด
                </span>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: '#f59e0b' }}>
              รอฝ่ายผลิต/หัวหน้าไลน์บันทึก action — role ของคุณไม่มีสิทธิ์ <code>qa:record_action</code> (admin เปิดให้ได้ที่ /permissions)
            </div>
          )}
        </div>
      )}

      {/* ── ฟอร์มชิ้นที่ N ── */}
      {state === 'inspecting' && canRecord && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map(i => {
              const d = draft[i.id] || {};
              const j = judges[i.id];
              const needValue = i.item_type === 'variable' && (i.lsl != null || i.usl != null);
              const color = j ? JUDGE[j].color : 'var(--border2)';
              return (
                <div key={i.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '7px 10px',
                  borderRadius: 8, background: 'var(--bg3)', borderLeft: `4px solid ${color}` }}>
                  <span style={{ minWidth: 34, height: 22, padding: '0 8px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 800, fontSize: 12, color: '#fff', background: j ? JUDGE[j].color : '#4d9fff' }}>{i.balloon_no}</span>
                  <div style={{ flex: '1 1 180px', minWidth: 160 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{i.characteristic}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>สเปค: {specLabel(i)}{i.method ? ` · ${i.method}` : ''}</div>
                  </div>
                  {i.item_type === 'variable' && (
                    <input type="number" step="any" inputMode="decimal" placeholder="ค่าที่วัด" value={d.value ?? ''}
                      onChange={e => setD(i.id, { value: e.target.value, judge: d.judge === 'na' ? null : d.judge })}
                      style={{ ...inputSt, width: isMobile ? 110 : 96, padding: '6px 8px' }} />
                  )}
                  {!needValue && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      {['ok', 'ng'].map(k => (
                        <button key={k} className="tbtn" onClick={() => setD(i.id, { judge: k })}
                          style={{ ...btn(d.judge === k ? JUDGE[k].color : 'var(--bg2)', d.judge === k ? '#fff' : JUDGE[k].color, { padding: isMobile ? '9px 12px' : '6px 10px', borderColor: JUDGE[k].color }) }}>
                          {k === 'ok' ? '✓ ผ่าน' : '✕ ไม่ผ่าน'}
                        </button>
                      ))}
                    </div>
                  )}
                  {needValue && j && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: JUDGE[j].color, whiteSpace: 'nowrap' }}>{j === 'na' ? 'ข้าม' : `อัตโนมัติ: ${JUDGE[j].label}`}</span>
                  )}
                  <button className="tbtn" title="ไม่ได้ตรวจจุดนี้ในชิ้นนี้" onClick={() => setD(i.id, { judge: d.judge === 'na' ? null : 'na', value: d.judge === 'na' ? d.value : '' })}
                    style={btn(d.judge === 'na' ? JUDGE.na.color : 'var(--bg2)', d.judge === 'na' ? '#fff' : 'var(--muted)', { padding: isMobile ? '9px 10px' : '6px 9px', borderColor: 'var(--border2)' })}>ข้าม</button>
                  {j === 'ng' && (
                    <input style={{ ...inputSt, flex: '1 1 100%', border: '1px solid rgba(239,68,68,0.5)' }} placeholder="เสียอย่างไร / เจอที่ไหน (บังคับกรอก)"
                      value={d.note ?? ''} onChange={e => setD(i.id, { note: e.target.value })} />
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
            <button disabled={busy} onClick={passAllAttr} style={btn('var(--bg3)', 'var(--text2)')} title="ติ๊กผ่านให้จุดที่ยังไม่ตอบ (ยกเว้นจุดที่ต้องกรอกค่าวัด)">✓ ผ่านทุกจุดที่เหลือ</button>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: result === 'fail' ? '#ef4444' : result === 'pass' ? '#22c55e' : 'var(--muted)', fontWeight: 700 }}>
              {result === 'fail' ? `ชิ้นนี้ตก ${failedItems.length} จุด` : result === 'pass' ? 'ชิ้นนี้ผ่านทุกจุด' : `เหลืออีก ${missing.length} จุด`}
            </span>
            <button disabled={busy || !result} onClick={submitPiece}
              style={btn(result === 'fail' ? '#ef4444' : 'var(--accent)', '#fff', { fontWeight: 800, opacity: result ? 1 : 0.5 })}>
              {result === 'fail' ? `✕ บันทึกชิ้นที่ ${seq?.nextPiece} (ตก) →` : `✓ บันทึกชิ้นที่ ${seq?.nextPiece}`}
            </button>
          </div>
        </>
      )}
      {state === 'inspecting' && !canRecord && (
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>ไม่มีสิทธิ์บันทึกผลตรวจ (qa:record) — ดูอย่างเดียว</div>
      )}
      {state === 'accepted' && (
        <div style={{ fontSize: 12.5, color: '#22c55e' }}>
          ปิดใบแล้ว {sheet?.closed_at ? `เมื่อ ${new Date(sheet.closed_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}` : ''}{sheet?.closed_by ? ` โดย ${sheet.closed_by}` : ''}
        </div>
      )}

      {/* ── modal disposition ของชิ้นที่ตก — ฟอร์ม: ไม่ปิดจาก backdrop (UI-CONVENTIONS §5) ── */}
      {dispo && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid rgba(239,68,68,0.5)', borderRadius: 12, padding: 16, width: 'min(560px, 100%)' }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>✕ ชิ้นที่ {seq?.nextPiece} ตก {dispo.payload.failedItems.length} จุด — จะทำอะไรกับชิ้นนี้</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.6 }}>
              {dispo.payload.failedItems.map(f => `#${f.balloon_no} ${f.characteristic}${f.value != null && f.value !== '' ? ` = ${f.value}` : ''} (${f.spec_text})${f.note ? ` — ${f.note}` : ''}`).join(' · ')}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {Object.entries(DISPOSITION).map(([k, m]) => (
                <button key={k} onClick={() => setDispo(d => ({ ...d, disposition: k }))}
                  style={btn(dispo.disposition === k ? m.color : 'var(--bg3)', dispo.disposition === k ? '#fff' : m.color, { borderColor: m.color })}>{m.label}</button>
              ))}
            </div>
            <textarea style={{ ...inputSt, minHeight: 64 }} placeholder="remark: จะซ่อมยังไง / กักไว้ที่ไหน / ทำไมทิ้ง (บังคับกรอก)"
              value={dispo.remark} onChange={e => setDispo(d => ({ ...d, remark: e.target.value }))} />
            {dispo.disposition === 'scrap' && (
              <div style={{ fontSize: 11.5, color: '#ef4444', marginTop: 6 }}>ระบบจะสร้างรายการ 🔴 ถังแดง 1 ชิ้นผูกกับใบตรวจนี้ให้ทันที</div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setDispo(null)} style={btn('var(--bg3)', 'var(--text2)')}>ยกเลิก</button>
              <button disabled={busy} onClick={submitDispo} style={btn('#ef4444', '#fff', { fontWeight: 800 })}>บันทึกชิ้นที่ {seq?.nextPiece} (ตก)</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
