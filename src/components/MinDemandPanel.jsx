/* 🔔 MinDemandPanel — "ของถึง min แล้ว · ต้องจัดแผนลง" (ที่เดียวทั้งระบบ · 2026-11-15)
 *
 * user 13/11: *"เมื่อ stock ลดลงถึง min จะแสดงความต้องการไปหาไลน์ผลิตเจ้าของงานนั้นเพื่อให้เตรียมตัว
 * และไปฝ่ายวางแผนเพื่อเห็นว่ามีงานตัวไหนต้องจัดแผนลง"*
 *
 * 🔴 ตัวตัดสินอยู่ `utils/replenish.js` (`minAlerts`) — คอมโพเนนต์นี้**วาดอย่างเดียว ห้ามคิดเอง**
 *    2 จอ (ผลิต/วางแผน) ต้องเห็นเลขเดียวกัน
 * 🔴 **"ติด min" ตอบได้ · "ต้องผลิตเท่าไหร่" ยังตอบไม่ได้** (ทะเบียนชิ้นส่วนไม่มี max เลยสักแถว)
 *    ⇒ `refillPcs == null` ต้องเขียนว่า "ยังไม่ตั้ง max" **ห้ามโชว์ 0 ห้ามเดา**
 * 🔴 โหลดไม่ครบ = เขียนบนจอ ห้ามแสดงเป็น "ไม่มีของติด min" (ลิสต์ว่าง 2 ความหมาย)
 * 🔴 **"ตอบไม่ได้เพราะทะเบียนตั้งผิดที่" (`wrongPlace`) ต้องแยกออกมาให้เห็นเป็นรายการที่แก้ได้**
 *    (วัดจริง 18/11: 35 จาก 41 คู่ · ของอยู่ STORE/ไลน์ประกอบ แต่ทะเบียนตั้งที่ไลน์ปั๊ม)
 *    ยุบรวมกับกอง "ตอบไม่ได้" ทั่วไป = ไม่มีใครรู้ว่ามันแก้ได้ แล้วมันค้างอยู่อย่างนั้นตลอด
 *    🔴 **เป็นข้อเสนอ — ห้ามมีปุ่มย้ายทะเบียนให้เองในแผงนี้** (คนตัดสินที่ /line-stock)
 */
import React from 'react';
import { tr } from '../utils/i18n';
import MatLabel from './MatLabel';
import InfoMore from './InfoMore';
import { toneVar, toneDim, toneLine } from '../utils/statusTone';

const fmt = (n) => Number(n || 0).toLocaleString();

export default function MinDemandPanel({
  rows = [], summary = null, error = null, loading = false,
  title = 'ของถึง min แล้ว — ต้องจัดแผนลง',
  onAdd = null,            // (mat, qty) => void · ส่งมาเฉพาะจอวางแผน (จอผลิตดูอย่างเดียว)
  showOwnerLine = true,    // จอผลิตกรองไลน์ตัวเองแล้ว ไม่ต้องย้ำ
  emptyText = 'ยังไม่มีพาร์ทไหนถึง min',
  max = 24,
}) {
  const at = (rows || []).filter(r => r?.state === 'at_min');
  const wrong = (rows || []).filter(r => r?.wrongPlace && r?.elsewhere?.line_name);
  const unknown = summary?.unknown ?? (rows || []).filter(r => r?.state === 'unknown').length;
  const shown = at.slice(0, max);

  return (
    <div style={{
      border: `1px solid ${toneLine('warn')}`, background: toneDim('warn'),
      borderRadius: 'var(--r-md)', padding: '10px 12px', display: 'grid', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 12.5, color: toneVar('warn') }}>🔔 {tr(title)}</b>
        <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>
          {loading ? tr('กำลังโหลด…') : `${at.length} ${tr('พาร์ท')}`}
          {!loading && summary?.lines ? ` · ${summary.lines} ${tr('ไลน์')}` : ''}
        </span>
        {/* 🔴 ตอบไม่ได้กี่รายการ ต้องขึ้นเสมอ — ซ่อน = จอโกหกว่าดูครบแล้ว */}
        {!loading && unknown > 0 && (
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            · {unknown} {tr('รายการยังตัดสินไม่ได้')}
            {wrong.length > 0 ? ` (${tr('ในนี้')} ${wrong.length} ${tr('เป็นทะเบียนตั้งผิดที่ — แก้ได้')})` : ''}
          </span>
        )}
      </div>

      {error && (
        <div style={{ fontSize: 11.5, color: toneVar('bad') }}>
          ⚠ {tr('โหลดไม่ครบ —')} {error} · {tr('ตัวเลขบนจออาจขาด ห้ามอ่านว่า "ไม่มีของถึง min"')}
        </div>
      )}

      {!loading && !error && at.length === 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{tr(emptyText)}</div>
      )}

      {shown.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {shown.map(r => (
            <div key={`${r.line_name}|${r.mat_no}`}
              title={`${r.mat_no} · ${tr('คงเหลือ')} ${fmt(r.onHand)} / min ${fmt(r.min)}`
                + (r.ownerLine ? `\n${tr('ไลน์เจ้าของงาน')}: ${r.ownerLine}` : '')
                + (r.line_name !== r.ownerLine ? `\n${tr('ของกองอยู่ที่')}: ${r.line_name}` : '')
                + (r.refillPcs == null ? `\n${tr('ยังไม่ตั้ง max — บอกไม่ได้ว่าต้องผลิตเท่าไหร่')}` : '')}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
                border: '1px solid var(--border2)', borderRadius: 'var(--r-md)',
                background: 'var(--card-surf)', fontSize: 11.5,
              }}>
              <MatLabel mat={r.mat_no} name={r.part_name} size={11.5} style={{ flexWrap: 'nowrap' }} />
              <span style={{ color: toneVar('warn'), fontWeight: 800, whiteSpace: 'nowrap' }}>
                {fmt(r.onHand)}/{fmt(r.min)}
              </span>
              {showOwnerLine && r.ownerLine && (
                <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>· {r.ownerLine}</span>
              )}
              {/* 🔴 ไม่รู้ max = เขียนบอก ห้ามโชว์ 0 */}
              <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                {r.refillPcs == null ? `· ${tr('ยังไม่ตั้ง max')}` : `· ${tr('เติมถึง max')} ${fmt(r.refillPcs)}`}
              </span>
              {onAdd && (
                <button type="button" style={{ fontSize: 11 }}
                  onClick={() => onAdd(r.mat_no, r.refillPcs || 0)}>{tr('+ เข้าแผน')}</button>
              )}
            </div>
          ))}
          {at.length > shown.length && (
            <span style={{ fontSize: 11.5, color: 'var(--muted)', alignSelf: 'center' }}>
              … {tr('อีก')} {at.length - shown.length} {tr('พาร์ท')}
            </span>
          )}
        </div>
      )}

      {/* 🔎 ตอบไม่ได้เพราะ "ทะเบียนตั้งผิดที่" — **แก้ได้** จึงต้องแยกออกมา ไม่ยุบรวมกับกองตอบไม่ได้ */}
      {!loading && wrong.length > 0 && (
        <div style={{ display: 'grid', gap: 4, paddingTop: 2, borderTop: '1px solid var(--border2)' }}>
          {/* 🔴 ตัวเลข "กี่พาร์ท" ห้ามพับ (กฎความซื่อสัตย์) · คำอธิบาย/วิธีแก้ยาวเกิน 1 บรรทัด → InfoMore (UI §6.10)
              เดิมเป็นข้อความ 123 ตัวอักษรวางนิ่ง — `audit/textsweep.mjs` จับได้ 23/11 */}
          <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>
            🔎 <b>{wrong.length}</b> {tr('พาร์ท — ทะเบียนตั้ง min ผิดที่')}
            <InfoMore id="min-wrongplace" label={tr('แก้ยังไง')}>
              {tr('บัญชีที่ไลน์ในทะเบียนนิ่ง แต่ของขยับจริงที่อื่น — ย้ายทะเบียนที่')}{' '}
              <code style={{ fontSize: 11 }}>/line-stock</code> {tr('แล้วสัญญาณจะเดินเอง')}
            </InfoMore>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {wrong.slice(0, max).map(r => (
              <div key={`w|${r.line_name}|${r.mat_no}`} title={r.why || ''}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '3px 7px',
                  border: '1px dashed var(--border2)', borderRadius: 'var(--r-md)',
                  background: 'var(--card)', fontSize: 11,
                }}>
                <MatLabel mat={r.mat_no} name={r.part_name} size={11} style={{ flexWrap: 'nowrap' }} />
                <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                  {r.line_name} → <b style={{ color: 'var(--text2)' }}>{r.elsewhere.line_name}</b>
                </span>
              </div>
            ))}
            {wrong.length > max && (
              <span style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center' }}>
                … {tr('อีก')} {wrong.length - max} {tr('พาร์ท')}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 🔴 ทะเบียนเปื้อนต้องเห็น ไม่งั้นมันจะเปื้อนต่อไปเรื่อยๆ */}
      {!loading && summary?.fgRows > 0 && (
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          ⚠ {tr('ทะเบียนยังมี FG ปนอยู่')} {summary.fgRows} {tr('แถว — FG ไม่ควรตั้ง min/max ที่ไลน์')}
        </div>
      )}
    </div>
  );
}
