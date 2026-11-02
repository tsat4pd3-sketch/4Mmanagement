/* ═══════════════════════════════════════════════════════════════════════════
   ⏳ แผง "ใบ MO ค้างขั้นเดิมนานเกินเกณฑ์" — อยู่หัวแท็บ 📋 รายการ MO   2026-10-13

   ทำอะไร: ตอบ 3 คำถามให้เห็นตอนเปิดหน้า (ไม่ต้องกรองเอง) — **ค้างเกิน 7 วันกี่ใบ ·
           ค้างที่ขั้นไหน/ทีมไหน · เก่าสุดกี่วัน** แล้วกดเข้าไปจัดการได้ทันที
   ใครใช้: ทีมช่าง + หัวหน้า/ผจก. ที่ต้องเซ็นขั้นท้าย (คนที่ต้องกดอยู่ในหน้านี้อยู่แล้ว)

   ─── ข้อจำกัด / ของที่ห้ามทำ ─────────────────────────────────────────────────
   · สูตร "ค้างกี่วัน / ค้างขั้นไหน" อยู่ `src/utils/mtnStale.js` ทั้งหมด —
     **ห้ามคำนวณวันหรือเทียบเลขขั้นในไฟล์นี้** (เลขขั้นคนละความหมาย 2 ฟอร์ม · ด่าน mo-step-branch-via-stage)
   · **ไม่ยิงคิวรีเอง** — รับ `board` ที่หน้าแม่ประกอบจาก `orders` ที่โหลดไว้แล้ว (egress 0)
   · 🔴 **ว่างต้องเขียนว่า "ไม่มีใบค้าง" ห้ามซ่อนแผง** · โหลดไม่ครบ/นับไม่ได้ ต้องเขียนบนจอ
     (กฎความซื่อสัตย์ของจอ · UI-CONVENTIONS §5.5 ข้อ 2 "งานค้าง/คิวที่รอคน ห้ามเอาไปซ่อน")
   · สีมาจาก `statusTone.js` เท่านั้น — ห้ามตั้ง hex เอง (ด่าน status-palette-single-source)
   · ตัวเลขทุกตัวต้องมีฐานเทียบ ("293 / 391 ใบที่ยังไม่ปิด") — เลขลอยๆ อ่านไม่ออกว่ามากหรือน้อย (§6.17 ข้อ 4)
   ═══════════════════════════════════════════════════════════════════════════ */
import { useState } from 'react';
import CollapseCard from './CollapseCard';
import { statusColor, toneInk } from '../utils/statusTone';
import { staleTone } from '../utils/mtnStale';

const FIRST_ROWS = 8;   // โชว์ก่อน 8 ใบ ที่เหลือพับ + บอกจำนวนที่พับ (§5.5 "ห้ามตัดข้อมูลเงียบ")

/** ชิปตัวเลข — กดได้ = ปุ่ม (ตัวกรองของหน้าแม่) · กดไม่ได้ = span (ขั้นที่ไม่ใช่ stage เช่นใบตีกลับ) */
function Chip({ tone, label, sub, onClick, title }) {
  const c = statusColor(tone);
  const box = {
    display: 'inline-flex', alignItems: 'baseline', gap: 5, padding: '4px 9px', borderRadius: 999,
    border: `1px solid ${tone === 'none' ? 'var(--border2)' : c}`, background: 'var(--card)',
    /* ห้าม color-mix() — Chromium 94 (จอ TV webOS) parse ไม่ได้แล้วทิ้งทั้งบรรทัด */
    backgroundImage: tone === 'none' ? 'none' : `linear-gradient(${c}14, ${c}14)`,
    fontSize: 11.5, color: 'var(--text)', textAlign: 'left',
    cursor: onClick ? 'pointer' : 'default',
  };
  const inner = <>
    <span style={{ fontWeight: 700 }}>{label}</span>
    {sub != null && <span style={{ color: tone === 'none' ? 'var(--muted)' : c, fontWeight: 800 }}>{sub}</span>}
  </>;
  return onClick
    ? <button type="button" onClick={onClick} title={title} style={box}>{inner}</button>
    : <span title={title} style={box}>{inner}</span>;
}

/**
 * @param board     ผลจาก `buildMoStaleBoard()` — `null` = ยังโหลดไม่เสร็จ
 * @param loadErr   ข้อความ error ของการโหลดใบ (มี = ยอดด้านล่าง "ไม่ครบ" ต้องเขียนบอก)
 * @param partial   true = ใบถูกตัดที่เพดานคิวรี (ใบเก่ากว่านั้นไม่ได้โหลดมา)
 * @param onStage   กดชิปขั้น → ตั้งตัวกรอง `?wait=<stage>` ของหน้าแม่
 * @param onTeam    กดชิปทีม → ตั้งตัวกรองทีมช่างของหน้าแม่
 * @param teamName  คีย์ทีม → ชื่อทีม (ค่าใน DB เป็น key · ห้ามโชว์ key ดิบ)
 * @param statusLabel ป้ายสถานะของใบ — ต้องเป็น `moStatusLabel` ห้ามอ่านตาราง label ดิบ
 */
export default function MoStalePanel({
  board, loadErr = '', partial = false, onStage, onTeam, teamName = (k) => k,
  statusLabel = () => '', onOpen,
}) {
  const [all, setAll] = useState(false);
  if (!board) return null;    // ยังโหลดไม่เสร็จ — หน้าแม่โชว์ "กำลังโหลด…" อยู่แล้ว

  const { days, hardDays, open, stale, hard, approx, unknown, oldest, byStage, byTeam, rows } = board;
  const headTone = staleTone(stale > 0 ? (hard > 0 ? hardDays : days) : null);
  /* 🔴 พับไว้แต่ "แถบต้องส่งเสียง" (28/10 · คำสั่ง user: "default เป็น hide … แต่แถบเป็นสีแดงเลย ถ้ามีงานค้าง")
     พับแล้วแถบขาวเปล่า = แผงเตือนที่ไม่เตือนอะไร คนเลื่อนผ่าน
     🔴 ห้ามใช้ `color-mix()` (Chromium 94 ทิ้งทั้ง declaration = แถบหาย) — ใช้ rgba ตรงๆ
     เกณฑ์เดียวกับตัวเลขในหัว (`headTone`) ไม่ตั้งสีชุดที่ 2 */
  const headSkin = headTone === 'bad'
    ? { background: 'rgba(239,68,68,0.13)', border: '1px solid rgba(239,68,68,0.55)' }
    : headTone === 'warn'
      ? { background: 'rgba(245,158,11,0.11)', border: '1px solid rgba(245,158,11,0.50)' }
      : null;
  const rowsShown = all ? rows : rows.slice(0, FIRST_ROWS);
  const lbl = { fontSize: 11.5, color: 'var(--muted)', fontWeight: 700, marginRight: 2 };

  return (
    <CollapseCard
      /* 📱 มือถือเริ่มแบบพับ (15/10) — หัวการ์ดบอกยอดค้าง/เกิน 30 วันอยู่แล้ว · กางแล้วกิน ~2 จอบน 360×640 ดันรายการ MO ตกจอ
         กางเองครั้งหนึ่ง = CollapseCard จำต่อเครื่อง · จอคอมเหมือนเดิม */
      /* 🔴 พับเป็นค่าเริ่มต้น**ทุกจอ** (28/10 · คำสั่ง user) — เดิมจอคอมกางอัตโนมัติเมื่อมีใบค้าง
         ซึ่งดันรายการ MO ตกจอทุกครั้งที่เปิดหน้า · ข้อมูลที่ต้องรู้อยู่บนแถบหมดแล้ว
         (ยอดค้าง · เก่าสุดกี่วัน · เกิน 30 วันกี่ใบ) กางเองครั้งหนึ่ง = จำต่อเครื่อง */
      id="mo-stale" storePrefix="mo" defaultOpen={false}
      style={{ marginBottom: 10, padding: '10px 13px', ...headSkin }}
      title={<span style={{ fontSize: 13 }}>
        ⏳ ค้างขั้นเดิมเกิน {days} วัน{' '}
        <b style={{ color: toneInk(headTone), fontSize: 15 }}>{stale}</b>
        <span style={{ color: 'var(--muted)', fontWeight: 600 }}> / {open} ใบที่ยังไม่ปิด</span>
        {oldest != null && <span style={{ color: 'var(--muted)', fontWeight: 600 }}> · เก่าสุด {oldest} วัน</span>}
      </span>}
      right={hard > 0 && (
        <span style={{ fontSize: 11.5, fontWeight: 800, color: statusColor('bad'), flexShrink: 0 }}>
          🔴 เกิน {hardDays} วัน {hard} ใบ
        </span>
      )}
    >
      {/* เกณฑ์การนับ — ต้องเขียนไว้ เพราะสรุปเช้า/Telegram นับจาก "วันแจ้ง" จึงได้เลขมากกว่าโดยเจตนา */}
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 7, lineHeight: 1.5 }}>
        นับจาก<b> เวลาที่ใบเข้าขั้นปัจจุบัน</b> (ไม่ใช่วันแจ้ง) — ใบที่เพิ่งถูกเลื่อนขั้นจะเริ่มนับใหม่
        · สรุปเช้า/Telegram นับจาก<b> วันแจ้ง</b> จึงได้ยอดมากกว่าปกติ
        · นับ<b> ทุกใบที่ยังไม่ปิดในขอบเขตของคุณ</b> ไม่ขึ้นกับตัวกรองด้านบน
      </div>

      {/* ── ความซื่อสัตย์ของจอ: ยอดนี้ครบหรือไม่ครบ ต้องรู้ก่อนอ่านเลข ── */}
      {loadErr && (
        <div role="alert" style={{ fontSize: 11.5, fontWeight: 700, color: statusColor('bad'), marginBottom: 6 }}>
          ⚠️ โหลดใบซ่อมไม่สำเร็จ ({loadErr}) — ยอดค้างด้านล่าง<b>ไม่ใช่ของครบ</b>
        </div>
      )}
      {partial && (
        <div style={{ fontSize: 11.5, color: 'var(--text2)', marginBottom: 6 }}>
          ⚠️ ใบถูกตัดที่เพดานคิวรี — ใบที่เก่ากว่านั้นไม่ได้โหลดมา ยอดค้างจริงอาจมากกว่านี้
        </div>
      )}
      {unknown > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--text2)', marginBottom: 6 }}>
          ❓ <b>{unknown} ใบไม่มีวันเวลาให้นับ</b> — ยังไม่รู้ว่าค้างนานแค่ไหน (ไม่ถูกนับรวมใน {stale} ใบข้างบน)
        </div>
      )}
      {approx > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--text2)', marginBottom: 6 }}>
          ℹ️ <b>{approx} ใบไม่มีเวลาเข้าขั้น</b> จึงนับจากวันแจ้งไปก่อน — ตัวเลขของใบเหล่านี้<b>เก่ากว่าความจริง</b>
        </div>
      )}

      {stale === 0 && !loadErr ? (
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)' }}>
          ✅ ไม่มีใบค้างขั้นเดิมเกิน {days} วัน{open > 0 ? ` (ใบที่ยังไม่ปิด ${open} ใบ อยู่ในเกณฑ์ทั้งหมด)` : ''}
        </div>
      ) : (
        <>
          {/* ── ค้างที่ขั้นไหน — กดชิปเพื่อกรองลิสต์ด้วย ?wait= ของหน้าแม่ ──
              ขั้นมาจาก stepMeta() ในฝั่ง util · ถัง `status:` คือใบที่ไม่อยู่ในลูปขั้น (ตีกลับ/ส่งซ่อมนอก) กรองด้วย wait ไม่ได้ */}
          <div style={{ marginBottom: 7 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <span style={lbl}>ค้างที่ขั้น:</span>
              {byStage.filter(s => s.stale > 0).map(s => (
                <Chip key={s.key} tone={staleTone(s.hard > 0 ? hardDays : days)}
                  label={`${s.icon} ${s.title}`} sub={`${s.stale} ใบ`}
                  onClick={s.stage && onStage ? () => onStage(s.stage) : undefined}
                  title={[`ค้างเกิน ${days} วัน ${s.stale} ใบ (จากทั้งขั้น ${s.n} ใบ)`,
                    s.hard > 0 && `เกิน ${hardDays} วัน ${s.hard} ใบ`,
                    s.oldest != null && `เก่าสุด ${s.oldest} วัน`,
                    s.stage ? 'กดเพื่อกรองลิสต์เฉพาะขั้นนี้' : 'ใบนอกลำดับขั้น — กรองด้วย "รอขั้นไหน" ไม่ได้',
                  ].filter(Boolean).join(' · ')} />
              ))}
            </div>
          </div>
          {/* ── ค้างของทีมไหน — กดเพื่อกรองทีมช่าง ── */}
          <div style={{ marginBottom: 9, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span style={lbl}>ทีมช่าง:</span>
            {byTeam.filter(t => t.stale > 0).map(t => (
              <Chip key={t.dept || '(none)'} tone={staleTone(t.hard > 0 ? hardDays : days)}
                label={t.dept ? (teamName(t.dept) || t.dept) : '(ไม่ระบุทีม)'} sub={`${t.stale} ใบ`}
                onClick={t.dept && onTeam ? () => onTeam(t.dept) : undefined}
                title={[`ค้างเกิน ${days} วัน ${t.stale} ใบ (จากทั้งทีม ${t.n} ใบ)`,
                  t.oldest != null && `เก่าสุด ${t.oldest} วัน`,
                  t.dept ? 'กดเพื่อกรองลิสต์เฉพาะทีมนี้' : 'ใบที่ยังไม่ระบุทีมช่าง — กรองด้วยทีมไม่ได้',
                ].filter(Boolean).join(' · ')} />
            ))}
          </div>

          {/* ── ใบที่ค้างนานสุดขึ้นก่อน ── */}
          <div style={{ display: 'grid', gap: 3, alignContent: 'start' }}>
            {rowsShown.map(o => (
              <div key={o.id} onClick={onOpen ? () => onOpen(o) : undefined}
                style={{
                  display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'baseline', fontSize: 11.5,
                  color: 'var(--text2)', padding: '3px 6px', borderRadius: 6,
                  borderLeft: `3px solid ${statusColor(o._tone)}`, background: 'var(--bg3)',
                  cursor: onOpen ? 'pointer' : 'default',
                }}>
                <b style={{ color: toneInk(o._tone), minWidth: 62 }}>{o._stale.days} วัน</b>
                <b style={{ color: 'var(--text)' }}>{o.mo_no || '(ยังไม่ออกเลข MO)'}</b>
                <span>· {o._stale.icon} รอ{o._stale.title}</span>
                <span>· {teamName(o.mtn_dept) || '(ไม่ระบุทีม)'}</span>
                {o.line_name && <span>· {o.line_name}</span>}
                {o.machine_no && <span>· {o.machine_no}</span>}
                {o.problem_characteristic && <span style={{ color: 'var(--muted)' }}>· {o.problem_characteristic}</span>}
                {statusLabel(o) && <span style={{ color: 'var(--muted)' }}>· {statusLabel(o)}</span>}
                {!o._stale.exact && <span style={{ color: 'var(--muted)' }}>· ⓘ นับจากวันแจ้ง (ไม่มีเวลาเข้าขั้น)</span>}
              </div>
            ))}
            {rows.length > rowsShown.length && (
              <button type="button" onClick={() => setAll(true)}
                style={{ justifySelf: 'start', marginTop: 2, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                  background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border2)',
                  borderRadius: 'var(--ctl-r)', padding: '4px 11px' }}>
                ▼ แสดงอีก {rows.length - rowsShown.length} ใบ
              </button>
            )}
            {all && rows.length > FIRST_ROWS && (
              <button type="button" onClick={() => setAll(false)}
                style={{ justifySelf: 'start', marginTop: 2, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                  background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border2)',
                  borderRadius: 'var(--ctl-r)', padding: '4px 11px' }}>
                ▲ ย่อเหลือ {FIRST_ROWS} ใบ
              </button>
            )}
          </div>
        </>
      )}
    </CollapseCard>
  );
}
