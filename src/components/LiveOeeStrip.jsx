import { useCallback, useState } from 'react';
import { supabaseDR } from '../supabaseClient';
import { buildCtMap, oeeTargetForLines, QBIN_EMBED } from '../utils/oee';
import { loadBreakPolicies, loadCtProducts, loadCtKanban, fetchOeeTargets } from '../utils/oeeMasters';
import { loadAffectsLanes } from '../utils/affectsLanes';
import { loadProductionLines } from '../utils/useProductionLines';
import { fetchByIds } from '../utils/fetchByIds';
import { useLiveBoard } from '../utils/useLiveBoard';
import { statusOf, toneVar, toneDim, toneLine } from '../utils/statusTone';
import { liveOeeByLine, sortLiveOee, LIVE_OEE_REASON } from '../lib/liveLineOee';

import { tr } from '../utils/i18n';
/* ═══ 🟢 OEE สดรายไลน์ — แถบในจอ Andon ฝ่ายผลิต (`/tv?dept=production` · 2026-11-11 · คำสั่ง user) ═══
   ตอบ "ตอนนี้ไลน์ไหนเดินได้แค่ไหน" — เฉพาะกะที่ **ยังเปิด** ของวันงานนี้ (กะปิดแล้วดูที่ /line-oee · /oee-analytics)
   · สูตร = `computeLiveOee` ตัวเดียวกับผังรวม/Line OEE/OEE Analytics (ผ่าน `lib/liveLineOee.js`) — ห้ามคิดเอง
   · สี = เทียบเป้า OEE ของกลุ่ม (`oeeTargetForLines` · กติกาเดียวกับ OBEYA/ผังรวม) · โหลดเป้าไม่ได้ = เทา ห้ามเดา 80/65
   · ประเมินไม่ได้ (กะเพิ่งเปิด/ยังไม่ปิดใบแรก/ไม่มี CT) = เขียนเหตุผล **ห้ามโชว์ 0%**
   · โหลดไม่ครบ = เขียนบนแถบ (ตัวเลขอาจต่ำกว่าจริง) ห้ามเงียบ
   ⚠️ จอ TV ต้องเบา: ยิงเฉพาะกะที่เปิดอยู่ (ไม่กี่สิบใบ) · ทะเบียน CT/พัก/คู่ ใช้ cache กลางร่วมกับจออื่น */
export default function LiveOeeStrip({ workDate, scopeNames = null, onOpenLine }) {
  const scopeKey = (scopeNames || []).join('|');   // prop เป็น array — ผูก deps ด้วยเนื้อ (กฎ DB ข้อ 9)
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      let sq = supabaseDR.from('production_sessions')
        .select('id, line_name, status, shift, start_time, shift_min, work_date, created_at')
        .eq('work_date', workDate).eq('status', 'open');
      if (scopeKey) sq = sq.in('line_name', scopeKey.split('|'));
      const { data: sess, error: e1 } = await sq;
      if (e1) throw e1;
      const ids = (sess || []).map(s => s.id);
      if (!ids.length) { setD({ rows: [], partial: false, tgOf: () => null }); setErr(''); return; }

      const [oR, dtR, dfR, prods, kstds, breaks, affects, lines, tg] = await Promise.all([
        fetchByIds(ids, c => supabaseDR.from('prod_orders')
          .select('id, session_id, status, qty, qty_ok, qty_actual, qty_target, mat_no, opened_at').in('session_id', c)),
        fetchByIds(ids, c => supabaseDR.from('downtime_logs')
          .select('id, session_id, duration_min, started_at, ended_at, machine_no, dr_downtime_types(category)').in('session_id', c)),
        fetchByIds(ids, c => supabaseDR.from('defect_logs')
          // prod_orders(mat_no) = ชี้ CT ของ NG เข้าตัวเศษ %P · QBIN_EMBED = ของสงสัยที่ QA ยังไม่ตัดสินไม่เข้า %Q
          .select(`id, session_id, qty_ng, qty_suspect, is_trial, prod_orders(mat_no), dr_defect_types(excl_from_q), ${QBIN_EMBED}`).in('session_id', c)),
        loadCtProducts().catch(() => null),
        loadCtKanban().catch(() => null),
        loadBreakPolicies().catch(() => null),
        loadAffectsLanes().catch(() => ({})),
        loadProductionLines().catch(() => null),
        fetchOeeTargets(),
      ]);
      const partial = !!(oR.error || dtR.error || dfR.error || oR.truncated || dtR.truncated || dfR.truncated
        || prods == null || kstds == null || breaks == null || lines == null);
      const procByMat = {}; const pairMap = prods ? {} : null;   // โหลดไม่ได้ = null (ไม่ยุบคู่) ห้าม {}
      (prods || []).forEach(p => { procByMat[p.mat_no] = p.process_type; if (p.pair_mat_no) pairMap[p.mat_no] = p.pair_mat_no; });
      const rows = liveOeeByLine({
        sessions: sess, orders: oR.rows, downtimes: dtR.rows, defects: dfR.rows,
        ctMap: buildCtMap({ kanbanStds: kstds || [], products: prods || [] }),
        lines: lines || [], breakPolicies: breaks || [], pairMap, affectsBy: affects || {}, procByMat,
        nowMs: Date.now(),
      });
      const tgOf = (ln) => oeeTargetForLines([ln], lines || [], tg.byGroup)?.oee ?? null;
      setD({ rows: sortLiveOee(rows, tgOf), partial, tgFail: !!tg.error, tgOf });
      setErr('');
    } catch (e) { setErr(String(e?.message || e)); }
  }, [workDate, scopeKey]);

  useLiveBoard(load, { tables: ['production_sessions', 'prod_orders', 'downtime_logs', 'defect_logs'], topic: 'live-oee-strip' });

  if (err) return (
    <div style={{ padding: '8px 11px', borderRadius: 'var(--r-md)', border: `1px solid ${toneLine('bad')}`, background: toneDim('bad'), fontSize: 11.5, color: toneVar('bad'), marginBottom: 12 }}>
      🔴 โหลด OEE สดไม่ได้ — {err}
    </div>
  );
  if (!d) return null;

  const judged = d.rows.filter(r => r.oee != null);
  const below = judged.filter(r => statusOf(r.oee, d.tgOf(r.line)) === 'bad').length;

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 12px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: d.rows.length ? 8 : 0 }}>
        <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-display)' }}>{tr('🟢 OEE สด — กะที่กำลังเดิน')}</span>
        {d.rows.length > 0 && (
          <span style={{ fontSize: 12, fontWeight: 800, color: below ? toneVar('bad') : 'var(--text2)' }}>
            {d.rows.length} {tr('ไลน์เปิดกะ')}{below ? ` · ต่ำกว่าเป้า ${below} ไลน์` : ''}{judged.length < d.rows.length ? ` · ประเมินไม่ได้ ${d.rows.length - judged.length}` : ''}
          </span>
        )}
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          {d.rows.length ? 'คิดถึงตอนนี้ · ตัวเลขจริงยืนยันตอนปิดกะ · สีเทียบเป้าของกลุ่ม' : 'ยังไม่มีไลน์ไหนเปิดกะของวันงานนี้'}
        </span>
        {d.partial && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)' }}>{tr('⚠ โหลดข้อมูลได้ไม่ครบ — บางไลน์อาจต่ำกว่าจริง')}</span>}
        {d.tgFail && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)' }}>{tr('⚠ โหลดเป้า OEE ไม่ได้ — ยังไม่ตัดสินสี')}</span>}
      </div>
      {d.rows.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {d.rows.map(r => {
            const tg = d.tgOf(r.line);
            const st = statusOf(r.oee, tg);
            const c = toneVar(st);
            return (
              <div key={r.sessionId} onClick={() => onOpenLine?.(r.line)}
                title={r.oee != null ? `${r.line} · A ${r.A}% · P ${r.P}% · Q ${r.Q}%${tg != null ? ` · เป้า ${tg.toFixed(1)}%` : ''}` : `${r.line} · ${LIVE_OEE_REASON[r.reason] || ''}`}
                style={{ cursor: onOpenLine ? 'pointer' : 'default', minWidth: 130, flex: '0 1 auto', background: 'var(--bg2)',
                  border: `1px solid ${r.oee == null ? 'var(--border)' : toneLine(st)}`, borderRadius: 9, padding: '7px 11px' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>
                  {r.line}{r.shift === 'night' ? ' 🌙' : ''}
                </div>
                {r.oee != null ? (
                  <>
                    <div style={{ fontSize: 18, fontWeight: 900, color: c, fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums' }}>
                      {r.oee.toFixed(1)}%
                      {tg != null && <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginLeft: 5 }}>{tr('เป้า')} {tg.toFixed(0)}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                      A {r.A} · P {r.P} · Q {r.Q}
                    </div>
                    {(r.ctPartial || r.pOver) && (
                      <div style={{ fontSize: 11, color: 'var(--amber)' }}>{r.pOver ? tr('⚠ %P ตัน — เช็คข้อมูล') : tr('⚠ CT ไม่ครบ — %P ต่ำกว่าจริง')}</div>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>— {LIVE_OEE_REASON[r.reason] || 'ประเมินไม่ได้'}</div>
                )}
                {r.openCount > 1 && <div style={{ fontSize: 11, color: 'var(--amber)' }}>{tr('⚠ เปิดค้าง')} {r.openCount} {tr('กะ')}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
