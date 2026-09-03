/**
 * QaFmeQueue — คิว "ฝ่ายผลิตเรียก QA มาตรวจ" (FME: First–Middle–End) · แผงบนแท็บใบตรวจใน /qa
 *
 * ที่มา (คำสั่ง user 2026-08-19): เดิมไม่มีช่องทางให้ผลิตเรียก QA มาตรวจเลย — QA ต้องเดินไปตรวจเอง
 * (pull) ระบบเลยไม่รู้ว่าตรวจตกหรือเปล่า · ตอนนี้ระบบ derive เองจากข้อมูลผลิต (push):
 *
 *   หน่วยงานตรวจ = ไลน์ × วันงาน × กะ × **รุ่น** — ไม่ใช่ต่อออเดอร์
 *   (ลอตนึงมี 50 เลขออเดอร์ = เรียกครั้งเดียว) · งานคู่ RH/LH นับเป็นรุ่นเดียวกัน
 *
 *   เรียกเมื่อ: เปลี่ยนกะ (รุ่นแรกของกะ) · เปลี่ยนรุ่น · จบรุ่น/ปิดกะ (End)
 *   ตัวสร้าง/ตัวเตือน = edge function `qa-fme-scan` (cron 5 นาที) — หน้านี้อ่านอย่างเดียว + กดรับงาน
 *
 * กติกาที่ยึด:
 *   - เกินเวลา = แดง **นิ่ง ไม่กระพริบ** (UI-CONVENTIONS §2 — กระพริบสงวนให้เครื่องหยุดที่ยังค้าง)
 *   - คิวว่างต้องขึ้น "ไม่มีคิว" เสมอ ห้ามซ่อนแผง (ผู้ใช้ต้องรู้ว่าระบบเช็คแล้ว)
 *   - ระบบปิดอยู่ก็ต้องบอกบนจอ + ชี้ทางเปิด ห้ามเงียบจนไม่มีใครรู้ว่ามีฟีเจอร์นี้
 */
import { useState, useEffect, useCallback, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from './Toast';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import { usePolling } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';
import QaFmeBoard from './QaFmeBoard';

const STAGE_META = {
  first:  { label: 'ชิ้นแรก',      icon: '1️⃣', color: '#f59e0b' },
  middle: { label: 'ระหว่างผลิต',  icon: '2️⃣', color: '#4d9fff' },
  end:    { label: 'ชิ้นสุดท้าย',  icon: '3️⃣', color: '#22c55e' },
};
const REASON_LABEL = {
  shift_start: 'เริ่มกะ', model_change: 'เปลี่ยนรุ่น', mid_run: 'ผลิตต่อเนื่องนาน',
  model_change_out: 'จบรุ่น (กำลังเปลี่ยนรุ่น)', shift_end: 'ปิดกะ',
};
/* สเตจในคิว ↔ stage ของใบตรวจ (qa_inspection_sheets.stage) */
// FME_SHEET_STAGE ย้ายไป utils/qaStages.js (single source of truth) — re-export ไว้เผื่อของเดิมอ้างถึง

const fmtTime = (iso) => {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }); } catch { return '-'; }
};

export default function QaFmeQueue({ scopedLineNames, onOpen }) {
  const { role } = useContext(UserContext);
  const canManage = can('qa', 'manage', role);
  const [rows, setRows] = useState([]);
  const [cfg, setCfg] = useState(null);
  const [missing, setMissing] = useState(false);   // ยังไม่ apply migration
  const [showCfg, setShowCfg] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  /* มุมมอง: รายการ (คิวที่ต้องทำตอนนี้) / ไทม์ไลน์ (ทั้งวัน เห็นว่าจะต้องไปไลน์ไหนกี่โมง)
     จำต่อเครื่องใน localStorage — QA แต่ละคนถนัดคนละแบบ (คำขอ user 2026-08-31) */
  const [view, setView] = useState(() => {
    try { return localStorage.getItem('qa_fme_view') === 'board' ? 'board' : 'list'; } catch { return 'list'; }
  });
  const setViewSaved = (v) => { setView(v); try { localStorage.setItem('qa_fme_view', v); } catch { /* โหมดส่วนตัว */ } };

  const load = useCallback(async () => {
    const [{ data: obs, error }, { data: c }] = await Promise.all([
      supabase.from('qa_fme_obligations').select('*')
        .in('status', ['pending', 'acked']).order('due_at').limit(60),
      supabase.from('qa_fme_config').select('*').eq('id', 1).maybeSingle(),
    ]);
    // 42P01 = ตารางยังไม่มี → บอกให้ชัดแทน error งงๆ (pattern เดียวกับ needMigration ในใบตรวจ)
    if (error?.code === '42P01') { setMissing(true); return; }
    setMissing(false);
    setCfg(c || null);
    const ok = scopedLineNames ? new Set(scopedLineNames) : null;
    setRows((obs || []).filter(o => !ok || ok.has(o.line_name)));
  }, [scopedLineNames]);

  useEffect(() => { load(); }, [load]);
  /* ⚠️ ยิง DB ต้องผ่าน usePolling — แท็บซ่อน/ล็อกจอแล้วต้องหยุดยิง (กฎ egress)
     และตัวสร้างงานคือ cron ฝั่ง server ทุก 5 นาที → poll ถี่กว่านั้นไม่ทำให้ QA รู้เร็วขึ้นเลย
     (เดิม setInterval 60 วิ = ถี่กว่าทุก RATE ในระบบ 5-10 เท่า และยิงต่อแม้ไม่มีคนดู)
     นาฬิกาแยกไว้ต่างหาก — ไม่ยิง DB จึงเดินได้ตามปกติให้ตัวนับเวลาบนจอไม่ค้าง */
  usePolling(load, RATE.ANALYTIC);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const saveCfg = async (patch) => {
    setBusy(true);
    const { error } = await supabase.from('qa_fme_config').update(patch).eq('id', 1);
    setBusy(false);
    if (error) { toast.error(`บันทึกไม่สำเร็จ: ${error.message}`); return; }
    setCfg(c => ({ ...c, ...patch }));
    toast.success('บันทึกแล้ว');
  };

  const skip = async (ob) => {
    const reason = window.prompt(`ยกเลิกงานตรวจนี้ (${ob.line_name} · ${ob.mat_no})\nเหตุผล:`);
    if (reason == null) return;
    if (!reason.trim()) { toast.error('ต้องระบุเหตุผล — งานตรวจที่หายไปโดยไม่มีเหตุผล ตรวจสอบย้อนหลังไม่ได้'); return; }
    const { error } = await supabase.from('qa_fme_obligations')
      .update({ status: 'cancelled', cancel_reason: reason.trim(), done_at: new Date().toISOString() }).eq('id', ob.id);
    if (error) { toast.error(`ยกเลิกไม่สำเร็จ: ${error.message}`); return; }
    load();
  };

  if (missing) return (
    <Box tone="warn">
      ⚠️ ระบบเรียกตรวจ FME ยังไม่พร้อมใช้ — ยังไม่ได้ apply migration <code>20260819_qa_fme_call.sql</code> (แจ้ง admin)
    </Box>
  );

  const late = rows.filter(o => new Date(o.due_at).getTime() < now && o.status === 'pending');
  const disabled = cfg && !cfg.is_enabled;

  return (
    <div style={{
      background: 'var(--card)', border: `1px solid ${late.length ? 'rgba(239,68,68,0.5)' : 'var(--border)'}`,
      borderRadius: 'var(--radius-lg)', padding: 12, marginBottom: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: rows.length || disabled ? 9 : 0 }}>
        <b style={{ fontSize: 14 }}>🔔 ฝ่ายผลิตเรียกตรวจ (FME)</b>
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          เรียกอัตโนมัติเมื่อ <b>เปลี่ยนกะ</b> / <b>เปลี่ยนรุ่น</b> — นับเป็นรุ่น ไม่ใช่ต่อออเดอร์
        </span>
        {late.length > 0 && (
          <span style={{ fontSize: 11.5, fontWeight: 700, color: '#ef4444', background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.4)', borderRadius: 6, padding: '2px 8px' }}>
            เกินเวลา {late.length} รายการ
          </span>
        )}
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 20, padding: 2 }}>
          {[{ k: 'list', t: '📋 รายการ' }, { k: 'board', t: '🗓️ ไทม์ไลน์' }].map(v => (
            <button key={v.k} onClick={() => setViewSaved(v.k)}
              title={v.k === 'board' ? 'เห็นทั้งวันว่าต้องไปตรวจไลน์ไหน กี่โมง' : 'คิวที่ต้องทำตอนนี้'}
              style={{ padding: '3px 11px', borderRadius: 18, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: 'none',
                background: view === v.k ? 'var(--accent-dim)' : 'transparent',
                color: view === v.k ? 'var(--accent)' : 'var(--muted)' }}>{v.t}</button>
          ))}
        </div>
        {canManage && (
          <button onClick={() => setShowCfg(v => !v)} style={btn('var(--bg3)', 'var(--text2)')}>⚙️ ตั้งค่าการเรียกตรวจ</button>
        )}
      </div>

      {disabled && (
        <Box tone="warn">
          ระบบเรียกตรวจ <b>ปิดอยู่</b> — ยังไม่มีการแจ้งเข้าห้อง Telegram และไม่มีการสร้างคิว
          {canManage ? ' · กด ⚙️ ตั้งค่าการเรียกตรวจ เพื่อเปิด' : ' · ให้หัวหน้า QA เปิดที่ ⚙️ ตั้งค่าการเรียกตรวจ'}
        </Box>
      )}

      {showCfg && cfg && canManage && (
        <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, padding: 11, margin: '9px 0' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, marginBottom: 9 }}>
            <input type="checkbox" checked={!!cfg.is_enabled} disabled={busy}
              onChange={e => saveCfg({ is_enabled: e.target.checked })} style={{ width: 'auto' }} />
            เปิดระบบเรียก QA ตรวจอัตโนมัติ (แจ้งเข้าห้อง Telegram)
          </label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Num label="ส่งผลภายใน (นาที)" value={cfg.first_due_min} onSave={v => saveCfg({ first_due_min: v, end_due_min: v })} />
            <Num label="เกินเวลา เตือนซ้ำทุก (นาที)" value={cfg.escalate_min} onSave={v => saveCfg({ escalate_min: v })} />
          </div>

          {/* Middle = ตามยอดผลิตรายพาร์ท คำนวณจาก lot size (คำสั่ง user 2026-08-20)
              เดิมเป็น "นาที" ตัวเดียวทั้งโรงงาน ซึ่งใช้กับของจริงไม่ได้ —
              ไลน์ลอทใหญ่ผลิตทั้งวันต้องตรวจซ้ำ · ไลน์ลอทสั้นอาจไม่ต้องมีเลย */}
          <div style={{ marginTop: 10, paddingTop: 9, borderTop: '1px dashed var(--border)' }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>🔁 ตรวจระหว่างผลิต (Middle)</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {[
                { k: 'lot', label: 'ตามยอดผลิต (lot size)' },
                { k: 'min', label: 'ตามเวลา (แบบเดิม)' },
                { k: 'off', label: 'ไม่ตรวจช่วงกลาง' },
              ].map(m => {
                const on = String(cfg.mid_mode ?? 'lot') === m.k;
                return (
                  <button key={m.k} onClick={() => saveCfg({ mid_mode: m.k })} disabled={busy}
                    style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
                      border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                      background: on ? 'var(--accent-dim)' : 'var(--bg2)', color: on ? 'var(--accent)' : 'var(--text2)' }}>
                    {m.label}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 9 }}>
              {String(cfg.mid_mode ?? 'lot') === 'lot' ? (
                <>
                  <Num label="ตรวจทุกๆ กี่ล็อต (1 = ทุกล็อต · 0.5 = ครึ่งล็อต)" value={cfg.mid_lot_ratio ?? 1}
                    min={0.1} step={0.1} onSave={v => saveCfg({ mid_lot_ratio: v })} />
                  <Num label="เพดานต่อรอบ (ครั้ง)" value={cfg.mid_max_per_run ?? 12}
                    min={1} onSave={v => saveCfg({ mid_max_per_run: v })} />
                  <Num label="คาบต่ำสุดที่ยอมรับ (ชิ้น)" value={cfg.mid_min_pcs ?? 10}
                    min={1} onSave={v => saveCfg({ mid_min_pcs: v })} />
                </>
              ) : String(cfg.mid_mode) === 'min' ? (
                <Num label="รุ่นวิ่งเกินกี่นาทีถึงเรียก" value={cfg.mid_after_min} onSave={v => saveCfg({ mid_after_min: v })} />
              ) : null}
            </div>
            {String(cfg.mid_mode ?? 'lot') === 'lot' && (
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 7, lineHeight: 1.7 }}>
                คาบตรวจคิดจาก <b>lot size ของพาร์ทเอง</b> (ตั้งที่ Product Master → 🎴 Kanban Std) ×
                ตัวคูณข้างบน — ลอทใหญ่ผลิตทั้งวันจะถูกเรียกหลายครั้ง · ลอทสั้นที่ผลิตไม่ถึง 1 ล็อตจะไม่ถูกเรียกเลย
                <br /><b style={{ color: '#f59e0b' }}>พาร์ทที่ยังไม่ตั้ง lot size จะไม่มีการตรวจ Middle</b> (ระบบไม่เดาให้)
                — First / End ยังทำงานตามปกติ
                <br />พาร์ทที่ตั้ง lot size ไว้ <b>เล็กกว่า "คาบต่ำสุดที่ยอมรับ"</b> (เช่น ตั้งไว้ 1 ชิ้น)
                ถือว่ายังตั้งไม่ถูก — ระบบจะไม่ตั้ง Middle ให้ แล้วรายงานไว้ให้ไปแก้ที่ Kanban Std
              </div>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8, lineHeight: 1.6 }}>
            ห้อง Telegram ที่รับแจ้ง ตั้งที่ <b>/notification-config</b> → หมวดคุณภาพ
            (<code>qa_fme_call</code> = เรียกตรวจ · <code>qa_fme_overdue</code> = เกินเวลา) ·
            เปิดใบตรวจของรุ่นนั้น = หยุดเตือนทันที · ปิดใบ = จบงาน
          </div>
        </div>
      )}

      {view === 'board' ? (
        <QaFmeBoard scopedLineNames={scopedLineNames} onOpen={onOpen} />
      ) : !rows.length ? (
        <div style={{ fontSize: 13, color: '#22c55e' }}>✅ ไม่มีคิวรอตรวจ</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map(o => {
            const sm = STAGE_META[o.stage] || STAGE_META.first;
            const isLate = o.status === 'pending' && new Date(o.due_at).getTime() < now;
            const lateMin = Math.round((now - new Date(o.due_at).getTime()) / 60000);
            return (
              <div key={o.id} style={{
                display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap',
                background: isLate ? 'rgba(239,68,68,0.08)' : 'var(--bg3)',
                border: `1px solid ${isLate ? 'rgba(239,68,68,0.45)' : 'var(--border2)'}`,
                borderLeft: `3px solid ${sm.color}`, borderRadius: 8, padding: '7px 10px',
              }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: sm.color, whiteSpace: 'nowrap' }}>{sm.icon} {sm.label}</span>
                <span style={{ fontSize: 13, minWidth: 0, flex: 1 }}>
                  <b>{o.line_name}</b> · {o.shift === 'night' ? 'กะดึก' : 'กะเช้า'} ·{' '}
                  <b>{o.mat_no}</b>{o.product_name ? <span style={{ color: 'var(--muted)' }}> {o.product_name}</span> : null}
                  <span style={{ color: 'var(--muted)' }}> · {REASON_LABEL[o.trigger_reason] || o.trigger_reason}</span>
                  {o.stage === 'middle' && (o.seq > 1 || o.at_qty) && (
                    <span style={{ color: 'var(--muted)' }}>
                      {' '}· ครั้งที่ {o.seq || 1}{o.at_qty ? ` (ผลิตครบ ${Number(o.at_qty).toLocaleString()} ชิ้น)` : ''}
                    </span>
                  )}
                  {!o.part_id && (
                    <span style={{ color: '#f59e0b' }}> · ⚠️ ยังไม่ผูกกับพาร์ทในระบบตรวจ (ตั้งที่ /qa-setup)</span>
                  )}
                </span>
                {o.status === 'acked' && (
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#4d9fff', whiteSpace: 'nowrap' }}>📝 กำลังตรวจ</span>
                )}
                <span style={{ fontSize: 11.5, whiteSpace: 'nowrap', color: isLate ? '#ef4444' : 'var(--muted)', fontWeight: isLate ? 700 : 400 }}>
                  {isLate ? `เกิน ${lateMin} นาที` : `ภายใน ${fmtTime(o.due_at)}`}
                </span>
                <button disabled={!o.part_id} onClick={() => onOpen?.(o)}
                  title={o.part_id ? 'เปิดใบตรวจของรุ่นนี้' : 'ผูกพาร์ทกับเลข MAT ที่ /qa-setup ก่อนถึงจะเปิดใบให้อัตโนมัติได้'}
                  style={{ ...btn('rgba(34,197,94,0.12)', '#22c55e'), opacity: o.part_id ? 1 : 0.45, cursor: o.part_id ? 'pointer' : 'not-allowed' }}>
                  เปิดใบตรวจ
                </button>
                <button onClick={() => skip(o)} title="ยกเลิกงานตรวจนี้ (ต้องระบุเหตุผล)"
                  style={btn('var(--bg2)', 'var(--muted)')}>✕</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const btn = (bg, color) => ({
  padding: '4px 11px', borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
  background: bg, color, border: '1px solid var(--border2)', whiteSpace: 'nowrap',
});

function Box({ tone, children }) {
  const c = tone === 'warn' ? '245,158,11' : '77,159,255';
  return (
    <div style={{ fontSize: 12.5, background: `rgba(${c},0.1)`, border: `1px solid rgba(${c},0.35)`,
      borderRadius: 8, padding: '7px 11px', margin: '4px 0' }}>{children}</div>
  );
}

/* ⚠️ ต้องรองรับทศนิยม — ตัวคูณล็อต (mid_lot_ratio) ใส่ 0.5 ได้ และ DB บังคับ > 0
   ถ้าใช้ parseInt เหมือนเดิม 0.5 จะกลายเป็น 0 แล้วเซฟไม่ผ่าน check constraint */
function Num({ label, value, onSave, min = 0, step }) {
  const [v, setV] = useState(String(value ?? 0));
  useEffect(() => { setV(String(value ?? 0)); }, [value]);
  const commit = () => {
    const raw = step ? parseFloat(v) : parseInt(v, 10);
    const n = Math.max(min, Number.isFinite(raw) ? raw : min);
    if (n !== Number(value)) onSave(n);
    setV(String(n));                       // สะท้อนค่าที่ถูก clamp กลับให้เห็น ไม่ปล่อยค่าที่ใช้ไม่ได้ค้างในช่อง
  };
  return (
    <label style={{ fontSize: 11.5, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 3 }}>
      {label}
      <input type="number" min={min} step={step || 1} value={v} onChange={e => setV(e.target.value)}
        onBlur={commit}
        style={{ width: 90, padding: '5px 8px', borderRadius: 6, fontSize: 12.5 }} />
    </label>
  );
}
