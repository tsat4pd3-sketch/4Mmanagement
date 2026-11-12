/* ═══════════════════════════════════════════════════════════════════════════
   ⏳ แผง "ใบ MO ค้างขั้นเดิมนานเกินเกณฑ์" — อยู่หัวแท็บ 📋 รายการ MO   2026-10-13

   ทำอะไร: ตอบ 3 คำถามให้เห็นตอนเปิดหน้า (ไม่ต้องกรองเอง) — **ค้างเกิน 7 วันกี่ใบ ·
           ค้างที่ขั้นไหน/ทีมไหน · เก่าสุดกี่วัน** แล้วกดเข้าไปจัดการได้ทันที
   ใครใช้: ทีมช่าง + หัวหน้า/ผจก. ที่ต้องเซ็นขั้นท้าย (คนที่ต้องกดอยู่ในหน้านี้อยู่แล้ว)

   🏃 **แถบ "ไล่งาน" (05/11 · คำสั่ง user)** — ตอบคำถามถัดไปของหัวหน้าช่าง: **ใบกองนี้รอ *ใคร***
      วัดจริง 05/11: ใบค้าง ≥7 วัน 77 ใบ — **~47% รอฝ่ายที่แจ้ง** (ตรวจรับงาน/รับมอบ/ปิดใบ)
      ซึ่งหัวหน้าช่าง**เลื่อนขั้นให้เองไม่ได้** ต้องโทรตาม · แผงเดิมบอกแค่ชื่อขั้น คนต้องรู้เองว่า
      ขั้นไหนของฝั่งใคร ⇒ กองที่ "ไล่ได้เลย" กับ "ต้องไปตามคนอื่น" ปนกันอยู่ในเลขเดียว
      🔴 กฎการแบ่งฝั่ง/หาเป้า อยู่ `src/utils/moChase.js` — **ห้ามเทียบ `side`/เลขขั้นในไฟล์นี้**

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
/* 🏃 "ใบนี้รอใครลงมือ" — กฎการแบ่งฝั่ง/หาเป้าอยู่ util ที่เดียว (05/11 · ห้ามตัดสินฝั่งในไฟล์นี้) */
import { chaseSideMeta } from '../utils/moChase';
/* 🔗 โซ่ส่งต่อที่ขาด — กฎตัดสินอยู่ util ที่เดียว (11/11 · ห้ามเทียบสถานะใบลูกในไฟล์นี้) */
import { handoffGapMeta } from '../utils/moHandoffGaps';

import { tr } from '../utils/i18n';
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
  /* 🏃 แผงไล่งาน (05/11 · คำสั่ง user "ทำแผงไล่ MO ค้างให้หัวหน้าช่าง") — `chase` = ผลจาก
     `buildMoChaseBoard()` · `null` = หน้าแม่ยังไม่ส่งมา (แผงเดิมทำงานเหมือนเดิมเป๊ะ) */
  chase = null, onText, onLine,
  /* 🔗 โซ่ส่งต่อที่ขาด (11/11 · คำสั่ง user) — ผลจาก `buildHandoffGapBoard()`
     `null` = หน้าแม่ยังไม่ส่งมา (แผงเดิมทำงานเหมือนเดิมเป๊ะ) · `onOpenId(id)` = เปิดใบแม่ */
  gaps = null, gapsErr = '', gapsCapped = false, onOpenId,
}) {
  const [side, setSide] = useState('');   // ฝั่งที่กางอยู่ ('' = ยังไม่เลือก)
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

          {/* ══ 🏃 ไล่งาน: ใบกองนี้รอ "ใคร" ลงมือ (05/11 · คำสั่ง user) ══════════════════
              🔴 ฝั่ง/เป้า มาจาก `utils/moChase.js` — ห้ามเทียบ side หรือเลขขั้นที่นี่
              🔴 กดแล้วตั้ง**ตัวกรองของแถบด้านบน** (ไลน์ / ทีม / ขั้น / คำค้น) ไม่สร้างตัวกรองชุดที่ 2
              🔴 ถังที่ชี้เป้าไม่ได้ (ไม่มีชื่อช่าง/ไม่มีไลน์/ไม่รู้ฝั่ง) ต้องโชว์ — ซ่อน = งานหายจากคนไล่ */}
          {chase && chase.sides.length > 0 && (
            <div style={{ marginBottom: 9, paddingTop: 7, borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 5 }}>
                <span style={lbl}>รอใครลงมือ:</span>
                {chase.sides.map(s2 => (
                  <Chip key={s2.side} tone={s2.tone}
                    label={`${s2.meta.icon} ${s2.meta.label}`}
                    sub={`${s2.n} ใบ`}
                    onClick={() => setSide(side === s2.side ? '' : s2.side)}
                    title={[s2.meta.hint,
                      s2.hard > 0 && `เกิน ${hardDays} วัน ${s2.hard} ใบ`,
                      s2.oldest != null && `เก่าสุด ${s2.oldest} วัน`,
                      side === s2.side ? 'กดอีกครั้งเพื่อย่อ' : 'กดเพื่อดูว่าต้องไปตามใคร',
                    ].filter(Boolean).join(' · ')} />
                ))}
              </div>
              {/* ❓ ใบที่นับวันไม่ได้ ไม่ได้อยู่ในแถบนี้เลย — ต้องเขียนบอก ไม่ใช่ปล่อยให้ยอดไม่ตรงกันเงียบๆ */}
              {chase.unknownAge > 0 && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>
                  ❓ อีก <b>{chase.unknownAge} ใบ</b> ไม่มีวันเวลาให้นับ จึงยังไม่รู้ว่ารอใครนานแค่ไหน (ไม่อยู่ในแถบนี้)
                </div>
              )}
              {!side ? (
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  กดกองด้านบนเพื่อดูรายชื่อ “ต้องไปตามใคร” — เรียงใบที่ดองนานสุดขึ้นก่อน
                </div>
              ) : (() => {
                const sel = chase.sides.find(x => x.side === side);
                if (!sel) return null;
                return (<>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4, lineHeight: 1.5 }}>
                    {sel.meta.icon} <b>{sel.meta.label}</b> — {sel.meta.hint}
                  </div>
                  <div style={{ display: 'grid', gap: 3, alignContent: 'start' }}>
                    {sel.targets.map(t => {
                      /* กดได้เมื่อมีตัวกรองที่ "ปลายทางตรงกับเป้า" จริงๆ — ไม่มี = ไม่ทำปุ่มหลอก */
                      const act = t.line && onLine ? () => onLine(t.line)
                        : t.text && onText ? () => onText(t.text)
                          : t.stage && onStage ? () => onStage(t.stage)
                            : undefined;
                      return (
                        <div key={t.key} onClick={act}
                          style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'baseline', fontSize: 11.5,
                            color: 'var(--text2)', padding: '4px 7px', borderRadius: 'var(--r-md)', background: 'var(--bg3)',
                            borderLeft: `3px solid ${statusColor(t.tone)}`, cursor: act ? 'pointer' : 'default' }}
                          title={[`ค้างเกิน ${days} วัน ${t.n} ใบ`,
                            t.hard > 0 && `เกิน ${hardDays} วัน ${t.hard} ใบ`,
                            t.oldest != null && `เก่าสุด ${t.oldest} วัน`,
                            act ? 'กดเพื่อกรองลิสต์ด้านล่างเฉพาะกองนี้' : 'ชี้เป้าไม่ได้ — กรองอัตโนมัติไม่ได้ ต้องเปิดดูทีละใบ',
                          ].filter(Boolean).join(' · ')}>
                          <b style={{ color: toneInk(t.tone), minWidth: 62 }}>{t.oldest} วัน</b>
                          <b style={{ color: 'var(--text)' }}>{t.label}</b>
                          {t.whoShort && t.kind !== 'role' && <span style={{ color: 'var(--muted)' }}>· ต้องกดโดย {t.whoShort}</span>}
                          <span>· {t.n} ใบ</span>
                          {t.hard > 0 && <span style={{ color: statusColor('bad'), fontWeight: 700 }}>· เกิน {hardDays} วัน {t.hard} ใบ</span>}
                          {t.kind === 'no_target' && <span style={{ color: 'var(--muted)' }}>· ⓘ ใบไม่มีข้อมูลให้ชี้ตัวคน</span>}
                        </div>
                      );
                    })}
                  </div>
                </>);
              })()}
            </div>
          )}

          {/* ── ใบที่ค้างนานสุดขึ้นก่อน ── */}
          <div style={{ display: 'grid', gap: 3, alignContent: 'start' }}>
            {rowsShown.map(o => (
              <div key={o.id} onClick={onOpen ? () => onOpen(o) : undefined}
                style={{
                  display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'baseline', fontSize: 11.5,
                  color: 'var(--text2)', padding: '3px 6px', borderRadius: 'var(--r-md)',
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
                {tr('▼ แสดงอีก')} {rows.length - rowsShown.length} {tr('ใบ')}
              </button>
            )}
            {all && rows.length > FIRST_ROWS && (
              <button type="button" onClick={() => setAll(false)}
                style={{ justifySelf: 'start', marginTop: 2, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                  background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border2)',
                  borderRadius: 'var(--ctl-r)', padding: '4px 11px' }}>
                {tr('▲ ย่อเหลือ')} {FIRST_ROWS} {tr('ใบ')}
              </button>
            )}
          </div>
        </>
      )}

      {/* ── 🔗 ส่งต่อแล้วแต่ปลายทางไม่มีใครทำ ───────────────────────────────────────
          🔴 ใบแม่จบที่ `transferred` (สถานะจบ) ⇒ **ไม่อยู่ในกองใบค้างข้างบน** ถ้าไม่มีแผงนี้
             ปัญหาที่ส่งต่อไปแล้วปลายทางถูกลบ/ยกเลิก จะไม่โผล่ที่ไหนในระบบเลย
          · แยกบล็อกจากกองค้าง เพราะคนละชุดข้อมูลและคนละการแก้ (ต้องเปิดใบใหม่ให้ ไม่ใช่ไปตามขั้น)
          · โหลดล้ม/ชนเพดาน = เขียนบนจอ ห้ามโชว์ 0 (กฎความซื่อสัตย์ของจอ) */}
      {gapsErr ? (
        <div role="alert" style={{ marginTop: 10, fontSize: 12, fontWeight: 700,
          color: statusColor('bad'), background: 'var(--card)',
          border: `1px solid ${statusColor('bad')}55`, borderRadius: 'var(--r-md)', padding: '7px 10px' }}>
          ⚠️ อ่านโซ่การส่งต่อไม่สำเร็จ — ยังไม่รู้ว่ามีใบที่ส่งต่อแล้วปลายทางหายไปหรือเปล่า
          <div style={{ fontWeight: 400, color: 'var(--text2)', marginTop: 2 }}>{gapsErr}</div>
        </div>
      ) : gaps && gaps.total > 0 && (
        <div style={{ marginTop: 10, borderTop: '1px dashed var(--border2)', paddingTop: 9 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 6 }}>
            🔗 ส่งต่อแล้วแต่ปลายทางไม่มีใครทำ · <b style={{ color: statusColor('bad') }}>{gaps.total} ใบ</b>
            <div style={{ fontSize: 11.5, fontWeight: 400, color: 'var(--text2)', marginTop: 2 }}>
              ใบต้นทางปิดไปแล้ว (ส่งต่อ = จบที่ทีมนั้น) — ใบพวกนี้<b>ไม่อยู่ในกองค้างข้างบน</b> และไม่อยู่ในคิวของใคร
            </div>
          </div>
          {gapsCapped && (
            <div style={{ fontSize: 11.5, color: statusColor('warn'), fontWeight: 700, marginBottom: 5 }}>
              ⚠️ โซ่ส่งต่อชนเพดานที่โหลด — อาจมีมากกว่าที่เห็น
            </div>
          )}
          <div style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
            {gaps.groups.map(g => (
              <div key={g.key}>
                <div style={{ fontSize: 12, fontWeight: 800, color: statusColor(g.tone) }}>
                  {g.icon} {g.label} · {g.n} ใบ
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text2)', marginBottom: 4 }}>{g.hint}</div>
                <div style={{ display: 'grid', gap: 4, alignContent: 'start' }}>
                  {g.rows.map(r => {
                    const meta = handoffGapMeta(r.kind);
                    const body = (
                      <>
                        <b>{r.moNo || '(ใบต้นทางไม่มีเลข)'}</b>
                        {r.lineName ? ` · ${r.lineName}` : ''}{r.machineNo ? ` · ${r.machineNo}` : ''}
                        {r.toDeptLabel ? <> · ส่งให้ <b>{r.toDeptLabel}</b></> : null}
                        {' · '}
                        {r.days == null
                          ? <span style={{ color: statusColor('warn') }}>ไม่มีวันเวลาให้นับ</span>
                          : <span style={{ color: statusColor(meta.tone) }}>{r.days} วันแล้ว</span>}
                        {r.problem ? <div style={{ color: 'var(--text2)', fontWeight: 400 }}>ปัญหา: {r.problem}</div> : null}
                        {r.reason ? <div style={{ color: 'var(--text2)', fontWeight: 400 }}>เหตุที่ส่งต่อ: {r.reason}</div> : null}
                        {r.childStatusLabel ? (
                          <div style={{ color: 'var(--text2)', fontWeight: 400 }}>
                            ใบปลายทาง: {r.childStatusLabel}{r.childReason ? ` — ${r.childReason}` : ''}
                          </div>
                        ) : null}
                      </>
                    );
                    const sty = {
                      textAlign: 'left', fontSize: 11.5, lineHeight: 1.5, padding: '5px 9px',
                      background: 'var(--bg2)', color: 'var(--text)',
                      border: `1px solid ${statusColor(meta.tone)}55`, borderRadius: 'var(--r-md)',
                    };
                    return (r.fromOrderId && onOpenId) ? (
                      <button key={r.id} type="button" onClick={() => onOpenId(r.fromOrderId)}
                        title="เปิดใบต้นทาง — เนื้อปัญหาอยู่ในใบนี้" style={{ ...sty, cursor: 'pointer' }}>
                        {body}
                      </button>
                    ) : <div key={r.id} style={sty}>{body}</div>;
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </CollapseCard>
  );
}
