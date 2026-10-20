/* ══════════════════════════════════════════════════════════════════════════
   🎴 บอร์ด Heijunka ย่อของไลน์ที่เลือก — กล่องรายละเอียดไลน์บนผังรวม แท็บ 📦 ยอดผลิต (2026-10-16)

   user 16/10: *"เรื่องยอดผลิต เปลี่ยนจากผังเป็น heijunka ของไลน์ที่เลือกเลย ว่ามีงานอะไรบ้างที่กำลังผลิต
   ตกแผน ได้ตามเป้า"*
   · การ์ด = `buildBoardCards()` · คิว/ดีเลย์ = `positionAllCards()` · หลุดแผน = `planStatusOf()` + `<PlanSlipBar>`
     (ตัวเดียวกับบอร์ด /management · /dashboard) — **ห้ามคิดดีเลย์เองในไฟล์นี้**
   · อ่านอย่างเดียว · ไม่มีการลาก/แก้ใบ (งานนั้นอยู่ที่ /daily-report)
   ⚠️ โหลดไม่ได้ = เขียนบนจอ ห้ามขึ้น "ไม่มีงาน"
   ══════════════════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useState } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { SESSION_STATUSES_REAL } from '../utils/sessionStatus';
import { halfDayBreakIntervals } from '../utils/oee';
import { positionAllCards, orderKeyOf, planStatusOf } from '../utils/heijunkaQueue';
import { buildBoardCards, boardFrame, cardState, cardMade, groupBoardRows, CARD_STATE_META } from '../utils/boardCards';
import PlanSlipBar from './PlanSlipBar';

const fmtMs = (ms) => (ms == null ? '—' : new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }));
const ORDER_COLS = 'id, session_id, status, qty, qty_ok, qty_actual, qty_target, is_manual, is_backfill, prod_no, mat_no, machine_no, opened_at, confirmed_at';

/**
 * @param {{ lineName:string, family:string[], date:string, lines:object[], onSelectCard?:(c:object|null)=>void, height?:string }} p
 */
export default function LineOrderBoard({ lineName, family, date, lines, onSelectCard, height }) {
  const [state, setState] = useState({ loading: true });
  const [selKey, setSelKey] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const famKey = (family || []).join('|');

  useEffect(() => {
    let alive = true;
    (async () => {
      setState({ loading: true }); setSelKey(null);
      try {
        const names = famKey ? famKey.split('|') : [lineName];
        const sRes = await supabaseDR.from('production_sessions')
          .select('id, line_name, shift, status, work_date, created_at, dr_products(name, target_per_shift, cycle_time_sec)')
          .eq('work_date', date).in('line_name', names).in('status', SESSION_STATUSES_REAL);
        if (sRes.error) throw sRes.error;
        const sessions = sRes.data || [];
        if (!sessions.length) { if (alive) setState({ loading: false, sessions: [] }); return; }
        const ids = sessions.map(s => s.id);
        const [oRes, bRes, mRes] = await Promise.all([
          /* cap-ok: prod_orders ของกะวันเดียว/ตระกูลไลน์เดียว — prod_orders ทั้งโรงงาน 60 วัน/ไลน์ สูงสุด 2,802 แต่ที่นี่ 1 วัน (วัด 20/10) */
          supabaseDR.from('prod_orders').select(ORDER_COLS).in('session_id', ids).limit(2000),
          supabaseDR.from('break_policies').select('*').eq('is_active', true),
          supabase.from('machine_points').select('line_name, machine_no').in('line_name', names),
        ]);
        if (oRes.error) throw oRes.error;
        if (bRes.error) throw bRes.error;   // ไม่มีพัก = หักซ้ำ/ตีดีเลย์ผิด ⇒ ห้ามถือว่าไม่มีพัก
        const orders = oRes.data || [];
        const mats = [...new Set(orders.map(o => o.mat_no).filter(Boolean))];
        const ct = {}, nm = {}, img = {}, pair = {};
        if (mats.length) {
          const pRes = await supabaseDR.from('dr_products').select('mat_no, name, cycle_time_sec, image_url, pair_mat_no').in('mat_no', mats);
          if (pRes.error) throw pRes.error;
          (pRes.data || []).forEach(p => { ct[p.mat_no] = p.cycle_time_sec || 0; nm[p.mat_no] = p.name || ''; img[p.mat_no] = p.image_url || ''; if (p.pair_mat_no) pair[p.mat_no] = p.pair_mat_no; });
        }
        const bySess = {}; orders.forEach(o => { (bySess[o.session_id] ||= []).push(o); });
        const mc = {}; (mRes.data || []).forEach(p => { (mc[p.line_name] ||= new Set()).add(p.machine_no); });
        if (alive) setState({ loading: false, sessions: sessions.map(s => ({ ...s, orders: bySess[s.id] || [] })), ct, nm, img, pair, breaks: bRes.data || [], mc });
      } catch (e) {
        if (alive) setState({ loading: false, error: e?.message || String(e) });
      }
    })();
    const t = setInterval(() => setNowMs(Date.now()), 60000);   // ดีเลย์เกิดจากนาฬิกาเดิน — คิดใหม่ทุกนาที ไม่ยิง DB
    return () => { alive = false; clearInterval(t); };
  }, [lineName, famKey, date]);

  const view = useMemo(() => {
    if (!state.sessions?.length) return null;
    const f = boardFrame(date);
    // 🏭 `lineName` = ข้อยกเว้นเวลาพักรายไลน์ (ทะเบียนกลาง · 20/10) — บอร์ดนี้เป็นของไลน์เดียว
    const breaks = f.halves.flatMap(h => halfDayBreakIntervals({ policies: state.breaks, half: h, lineName })).sort((a, b) => a[0] - b[0]);
    const cards = buildBoardCards(state.sessions, { ctByMat: state.ct, nameByMat: state.nm, imgByMat: state.img, nowMs });
    const linesByName = {}; (lines || []).forEach(l => { linesByName[l.name] = l; });
    const positioned = positionAllCards(cards, {
      breaks, ctByMat: state.ct, nowMs, frameEndMs: f.gridEndMs, roundIndexOf: f.roundIndexOf, roundStartOf: f.roundStartOf,
      flowByLine: linesByName, machineCountByLine: state.mc, pairMatByMat: state.pair,
    });
    const curHalf = f.halves.find(h => nowMs >= h.startMs && nowMs < h.startMs + 12 * 3600000);
    const plan = planStatusOf({ positioned, cards, breaks, ctByMat: state.ct, nowMs, frameEndMs: f.gridEndMs,
      shiftEndMs: curHalf ? curHalf.startMs + 12 * 3600000 : f.gridEndMs });
    const rows = groupBoardRows(cards).map(r => ({ ...r, cards: r.cards.map(c => {
      const pos = positioned.get(orderKeyOf(c));
      return { ...c, _state: cardState(c, pos), _made: cardMade(c), _pos: pos };
    }) }));
    const counts = {}; rows.forEach(r => r.cards.forEach(c => { counts[c._state] = (counts[c._state] || 0) + 1; }));
    return { rows, plan, counts, total: cards.length };
  }, [state, date, nowMs, lines]);

  const sel = useMemo(() => view?.rows.flatMap(r => r.cards).find(c => String(orderKeyOf(c)) === selKey) || null, [view, selKey]);
  useEffect(() => { onSelectCard?.(sel); }, [sel?.id, sel?._state, sel?._made]); // eslint-disable-line react-hooks/exhaustive-deps

  const box = { background: 'var(--bg3)', border: '1px dashed var(--border2)', borderRadius: 10, padding: '14px 12px', fontSize: 12.5, color: 'var(--text2)' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>🎴 Heijunka · งานของไลน์นี้</span>
      {state.loading ? <div style={box}>กำลังโหลดใบผลิต…</div>
        : state.error ? <div style={{ ...box, borderColor: '#ef4444', color: '#ef4444' }}>⚠ โหลดใบผลิตไม่สำเร็จ — {state.error}</div>
        : !view ? <div style={box}>ไม่มีการเปิดกะของไลน์นี้ในวันที่เลือก — ยังไม่มีงานบนบอร์ด</div>
        : (<>
          <PlanSlipBar st={view.plan} fmtMs={fmtMs} size={12} showOk />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 11.5 }}>
            {Object.entries(CARD_STATE_META).map(([k, m]) => (
              <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: view.counts[k] ? 'var(--text)' : 'var(--muted)', fontWeight: view.counts[k] ? 800 : 500 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: m.color }} />{m.label} {view.counts[k] || 0}
              </span>
            ))}
          </div>
          <div style={{ display: 'grid', gap: 8, alignContent: 'start', maxHeight: height, overflowY: height ? 'auto' : undefined, paddingRight: 2 }}>
            {view.rows.map(r => {
              const made = r.cards.reduce((a, c) => a + c._made, 0);
              const target = r.cards.reduce((a, c) => a + (Number(c.qty_target ?? c.qty) || 0), 0);
              return (
                <div key={r.key} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 10, padding: '8px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    {r.img ? <img src={r.img} alt="" loading="lazy" style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 6, background: 'var(--bg2)', flexShrink: 0 }} />
                      : <span style={{ width: 36, height: 36, borderRadius: 6, background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>📦</span>}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.mat_no}{r.line ? ` · ${r.line}` : ''}</div>
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: target > 0 && made >= target ? '#22c55e' : 'var(--text2)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                      {made.toLocaleString()}/{target.toLocaleString()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {r.cards.map(c => {
                      const m = CARD_STATE_META[c._state]; const k = String(orderKeyOf(c)); const on = k === selKey;
                      return (
                        <button key={k} onClick={() => setSelKey(on ? null : k)} title={`${c.prod_no || ''} · ${m.label}`}
                          style={{ minWidth: 74, padding: '4px 7px', borderRadius: 7, cursor: 'pointer', textAlign: 'left',
                            background: 'var(--card)', backgroundImage: `linear-gradient(${m.color}26, ${m.color}26)`,
                            border: `1.5px solid ${m.color}`, boxShadow: on ? `0 0 0 2px var(--text)` : 'none', color: 'var(--text)' }}>
                          <div style={{ fontSize: 11, fontWeight: 800, color: m.color, whiteSpace: 'nowrap' }}>{m.label.split(' ')[0]}</div>
                          <div style={{ fontSize: 11.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{c._made}/{c.qty ?? '—'}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{c.shift === 'night' ? '🌙' : '☀️'} {c.orderStartMs ? fmtMs(c.orderStartMs) : 'รอเปิด'}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>คลิกใบเพื่อดูรายละเอียด · จัด/ปิดใบที่หน้า Daily Report</div>
        </>)}
    </div>
  );
}

/** การ์ดรายละเอียดใบที่คลิก — หน้าแม่วางในคอลัมน์ขวา (หลักเดียวกับ MachineDetailCard) */
export function OrderDetailCard({ c }) {
  if (!c) return null;
  const m = CARD_STATE_META[c._state] || CARD_STATE_META.waiting;
  const row = (k, v) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span style={{ color: 'var(--muted)' }}>{k}</span><b style={{ color: 'var(--text)', textAlign: 'right' }}>{v}</b></div>;
  return (
    <div style={{ background: 'var(--bg3)', border: `1px solid ${m.color}66`, borderLeft: `4px solid ${m.color}`, borderRadius: 9, padding: '8px 10px', fontSize: 12, display: 'grid', gap: 3 }}>
      <div style={{ fontWeight: 800, color: 'var(--text)' }}>🎴 {c.prod_no || 'ใบไม่มีเลข'} — <span style={{ color: m.color }}>{m.label}</span></div>
      <div style={{ color: 'var(--text2)' }}>{c.productLabel} · {c.mat_no}{c.line_name ? ` · ${c.line_name}` : ''}</div>
      {row('ทำได้ / สั่ง', `${c._made} / ${c.qty ?? '—'}`)}
      {row('เปิดใบ', c.orderStartMs ? fmtMs(c.orderStartMs) : 'ยังไม่เปิด')}
      {row('ควรเสร็จ (ตาม CT)', c.ctSec > 0 && c.orderEndMs ? fmtMs(c.orderEndMs) : 'ไม่รู้ CT — ประเมินไม่ได้')}
      {c.confirmed_at && row('ปิดใบ', fmtMs(new Date(c.confirmed_at).getTime()))}
      {c.machine_no && row('เครื่อง', c.machine_no)}
      {c.is_backfill && <div style={{ color: 'var(--muted)' }}>ใบเปิดย้อนหลัง — ไม่ตัดสินดีเลย์</div>}
    </div>
  );
}
