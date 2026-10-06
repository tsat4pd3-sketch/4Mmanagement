import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { getWorkDate } from '../utils/workDate';
import {
  buildGrid, cellAt, valueAt, slSummary, gridSummary, minBreaches, firstShortDate,
  rackCount, rawPieces, rawCoverage,
} from '../utils/monitorGrid';
import { rowDefs, balanceRowKey, minRowKey } from '../utils/monitorBoards';
import { matText } from '../utils/matLabel';

/* ══ 📉 MonitorBoardGrid — ตารางบอร์ด Monitoring (พาร์ท × ช่วงเวลา × แถว) ════════════════
   ใช้ร่วมทุกแท็บ (ไลน์ปั๊ม · FG รายแร็ค · Argen · วัตถุดิบ · งานส่งชุบ) — ชุดแถวมาจาก
   `rowDefs(board)` ⇒ **ชีทใหม่ไม่ต้องมีคอมโพเนนต์ใหม่**

   🔴 เลขทุกตัวมาจาก `buildGrid()` — ห้ามคำนวณในไฟล์นี้ (ดู monitorGrid.js กฎเหล็กข้อแรก)

   ── ทำไมไม่วาด <input> ทุกช่อง ─────────────────────────────────────────────────────
   บอร์ดจริง 31 พาร์ท × 34 วัน × 7 แถว = **7,378 ช่อง** · ถ้าทุกช่องเป็น <input> จอค้าง
   บนเครื่องหน้างาน (จอ TV = Chromium 94) ⇒ ช่องเป็นข้อความ แล้ว**กดแล้วค่อยกลายเป็นช่องกรอก**
   (พฤติกรรมเดียวกับ Excel — คนคุ้นอยู่แล้ว) · Enter = ลงล่าง · Tab = ไปขวา · Esc = ยกเลิก

   🔴 กฎความซื่อสัตย์ที่จอนี้ต้องทำ (CLAUDE.md §กฎความซื่อสัตย์ของจอ)
   • ช่องที่คิดไม่ได้ = ขีด `–` **ห้ามโชว์ 0**
   • ไม่ใส่ยอดยกมา = แถบเตือนบนหัวตารางว่าพาร์ทไหน (ไม่ใช่ปล่อยให้เห็นตารางว่างแล้วเดาเอง)
   • โหลดไม่ครบ (`truncated`) = เขียนบนจอ
   • ค่าที่ระบบดึงมาเอง vs คนกรอก **ต้องแยกให้เห็น** (คนกรอก = ตัวหนา · ระบบ = สีจาง + ⚙)
   ⚠️ ห้ามใช้ `color-mix()` — จอ TV webOS = Chromium 94 ทิ้งทั้ง declaration (พื้นการ์ดโปร่ง)
   ═══════════════════════════════════════════════════════════════════════════════════════ */

const FS = 11.5;                                  // จอ TV ขั้นต่ำ 11px (UI-CONVENTIONS)
const COL_W = 62;
const HEAD_W = 290;

const fmtN = (v, dec = 0) => (v === null || v === undefined || !Number.isFinite(Number(v))
  ? '–'
  : Number(v).toLocaleString(undefined, { maximumFractionDigits: dec }));
const fmtPct = (v) => (v === null || v === undefined ? '–' : `${(v * 100).toFixed(1)}%`);
const dayLabel = (d) => {
  const t = new Date(`${d}T00:00:00`);
  const wd = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'][t.getDay()];
  return { top: wd, bot: `${t.getDate()}/${t.getMonth() + 1}`, weekend: t.getDay() === 0 || t.getDay() === 6 };
};

const card = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: 12,
};

export default function MonitorBoardGrid({
  board, parts = [], periods = [], manualMap, systemMap,
  onEditCell, editable = false, truncated = false, loadWarn = '',
  windowSize = 14,
}) {
  const rows = useMemo(() => rowDefs(board), [board]);
  const [winStart, setWinStart] = useState(0);
  const [q, setQ] = useState('');
  const [onlyProblem, setOnlyProblem] = useState(false);
  const [edit, setEdit] = useState(null);          // { partId, rowKey, periodKey, value }
  const inputRef = useRef(null);

  /* คอลัมน์ที่กำลังมองอยู่ — 🔴 คอลัมน์แรก (ยอดยกมา) ต้องติดมาเสมอ ไม่งั้นเลื่อนไปแล้ว
     ตัวเลข BALANCE ดูเหมือนโผล่มาจากไหนไม่รู้ (ยอดยกมาคือที่มาของทั้งแถว) */
  const seed = periods[0] || null;
  const win = useMemo(() => {
    if (periods.length <= windowSize) return periods;
    const body = periods.slice(1);
    const s = Math.max(0, Math.min(winStart, Math.max(0, body.length - (windowSize - 1))));
    return [periods[0], ...body.slice(s, s + windowSize - 1)];
  }, [periods, winStart, windowSize]);

  /* ── กริดคิดเต็มทุกคอลัมน์เสมอ (ไม่ใช่แค่ที่มองเห็น) ──────────────────────────────
     เพราะ BALANCE/UNBOUND เป็น recurrence — คิดแค่ช่วงที่มองเห็นจะได้ยอดยกมาผิด */
  const grid = useMemo(
    () => buildGrid({ parts, periods, rows, manual: manualMap, system: systemMap }),
    [parts, periods, rows, manualMap, systemMap],
  );

  const balKey = balanceRowKey(board);
  const minKey = minRowKey(board);
  const summary = useMemo(() => gridSummary({ grid, parts, rows }), [grid, parts, rows]);
  const breaches = useMemo(
    () => (balKey && minKey ? minBreaches({ grid, parts, balanceRow: balKey, minRow: minKey }) : []),
    [grid, parts, balKey, minKey],
  );
  const breachBy = useMemo(() => {
    const m = new Map();
    for (const b of breaches) m.set(`${b.partId}|${b.date}`, b);
    return m;
  }, [breaches]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = parts;
    if (needle) {
      list = list.filter((p) => [p.mat_no, p.part_no, p.part_name, p.model, p.rack]
        .some((v) => String(v || '').toLowerCase().includes(needle)));
    }
    if (onlyProblem && balKey) {
      list = list.filter((p) => firstShortDate({ grid, partId: p.id, balanceRow: balKey }) !== null
        || breaches.some((b) => b.partId === p.id));
    }
    return list;
  }, [parts, q, onlyProblem, grid, balKey, breaches]);

  useEffect(() => { if (edit && inputRef.current) inputRef.current.select(); }, [edit]);

  const startEdit = useCallback((partId, rowKey, periodKey, cur) => {
    if (!editable) return;
    setEdit({ partId, rowKey, periodKey, value: cur === null || cur === undefined ? '' : String(cur) });
  }, [editable]);

  const commit = useCallback(async (move) => {
    if (!edit) return;
    const { partId, rowKey, periodKey, value } = edit;
    setEdit(null);
    if (onEditCell) await onEditCell({ partId, rowKey, periodKey, value });
    if (!move) return;
    /* Enter = ลงแถวถัดไปที่กรอกได้ · Tab = คอลัมน์ถัดไป (พฤติกรรมแบบ Excel) */
    const pIdx = shown.findIndex((p) => p.id === partId);
    const rIdx = rows.findIndex((r) => r.key === rowKey);
    const cIdx = win.findIndex((w) => w.key === periodKey);
    if (move === 'down') {
      for (let i = rIdx + 1; i < rows.length; i++) {
        const c = cellAt(grid, partId, rows[i].key, periodKey);
        if (c?.editable) return startEdit(partId, rows[i].key, periodKey, c.v);
      }
      const next = shown[pIdx + 1];
      if (next) {
        const c = cellAt(grid, next.id, rows[0].key, periodKey);
        if (c?.editable) startEdit(next.id, rows[0].key, periodKey, c.v);
      }
    } else if (move === 'right' && cIdx >= 0 && win[cIdx + 1]) {
      const pk = win[cIdx + 1].key;
      const c = cellAt(grid, partId, rowKey, pk);
      if (c?.editable) startEdit(partId, rowKey, pk, c.v);
    }
  }, [edit, onEditCell, shown, rows, win, grid, startEdit]);

  if (!board) return null;
  if (!periods.length) {
    return (
      <div style={{ ...card, fontSize: FS + 1 }}>
        ⚠️ บอร์ดนี้ยังไม่มีคอลัมน์ช่วงเวลา — ตั้ง “วันเริ่ม” และ “จำนวนคอลัมน์” ก่อน
        {board.period_kind === 'date' ? ' (บอร์ดรายวันส่งต้องมีวันที่ลูกค้าสั่งอย่างน้อย 1 วัน)' : ''}
      </div>
    );
  }

  const unknownRecur = rows.filter((r) => r.unknownRecur);
  /* "วันนี้" ของโรงงาน = วันงาน (ก่อน 08:00 นับเป็นวันก่อนหน้า) ไม่ใช่วันปฏิทินของเครื่อง */
  const todayKey = getWorkDate();
  const body = periods.slice(1);
  const canPage = periods.length > windowSize;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* ── แถบความซื่อสัตย์: บอกตรงๆ ว่าอะไรยังไม่ครบ ก่อนให้ดูตัวเลข ───────────────── */}
      {(truncated || loadWarn || summary.partial || unknownRecur.length) ? (
        <div style={{
          ...card, padding: '8px 12px', fontSize: FS + 0.5, lineHeight: 1.7,
          borderColor: 'var(--accent2)', background: 'var(--bg2)',
        }}>
          {truncated ? <div>🔴 <b>โหลดข้อมูลไม่ครบ</b> — ช่องที่กรอกไว้มีมากกว่าที่ดึงมาได้ ตัวเลขบางแถวจะต่ำกว่าจริง</div> : null}
          {loadWarn ? <div>🔴 {loadWarn}</div> : null}
          {summary.partial ? (
            <div>
              ⚠️ <b>{summary.seedMissingCount} พาร์ทยังไม่ใส่ยอดยกมา</b> (ช่องคอลัมน์แรก
              {seed ? ` ${dayLabel(seed.date).bot}` : ''}) ⇒ แถวที่ต้องคำนวณของพาร์ทนั้นขึ้นขีด “–” ทั้งแถว
              — ระบบไม่เดายอดยกมาให้ เพราะ “ยกมา 0” กับ “ไม่รู้ว่ายกมาเท่าไหร่” ตัดสินใจคนละแบบ
              <div style={{ color: 'var(--muted)', marginTop: 2 }}>
                {summary.seedMissing.slice(0, 12).map((s) => s.mat_no || '(ไม่มีเลข)').join(' · ')}
                {summary.seedMissing.length > 12 ? ` … อีก ${summary.seedMissing.length - 12}` : ''}
              </div>
            </div>
          ) : null}
          {unknownRecur.length ? (
            <div>🔴 แถว {unknownRecur.map((r) => r.label).join(', ')} อ้างสูตรที่ระบบยังไม่มี ⇒ ขึ้นขีดทั้งแถว</div>
          ) : null}
        </div>
      ) : null}

      {/* ── แถบกรอง ─────────────────────────────────────────────────────────────── */}
      <div className="filter-bar" style={{ fontSize: FS + 0.5 }}>
        <div className="search-input grow">
          <span className="search-ico" aria-hidden="true">🔍</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหา MAT / PART NO. / ชื่อ / รุ่น" aria-label="ค้นหาพาร์ทในบอร์ด"
            style={{ paddingLeft: 30 }} />
          {q ? <button type="button" className="search-clear" aria-label="ล้างคำค้น" onClick={() => setQ('')}>✕</button> : null}
        </div>
        {balKey ? (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={onlyProblem} onChange={(e) => setOnlyProblem(e.target.checked)} />
            เฉพาะพาร์ทที่ของจะขาด
            {breaches.length ? <b style={{ color: 'var(--danger, #ef4444)' }}>({breaches.length})</b> : null}
          </label>
        ) : null}
        {canPage ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
            <button type="button" onClick={() => setWinStart((s) => Math.max(0, s - (windowSize - 1)))}
              disabled={winStart <= 0} aria-label="ย้อนช่วงวันที่">←</button>
            <span style={{ color: 'var(--muted)' }}>
              {win.length > 1 ? `${dayLabel(win[1].date).bot} – ${dayLabel(win[win.length - 1].date).bot}` : ''}
              {` (จาก ${body.length} ช่วง)`}
            </span>
            <button type="button"
              onClick={() => setWinStart((s) => Math.min(Math.max(0, body.length - (windowSize - 1)), s + (windowSize - 1)))}
              disabled={winStart >= body.length - (windowSize - 1)} aria-label="ช่วงวันที่ถัดไป">→</button>
          </div>
        ) : null}
      </div>

      {/* ── 🔴 บอกให้เห็นว่า "ช่องนี้แก้ได้" (2026-10-05 · ทีมวางแผนถามว่าแก้ตัวเลขไม่ได้ใช่ไหม
             ต้อง export file เข้าอย่างเดียว) — เดิมสัญญาณเดียวที่มีคือรูปเคอร์เซอร์ `cursor:'cell'`
             กับคำอธิบายที่อยู่ "ใต้ตาราง" ซึ่งต้องเลื่อนผ่านทุกแถวถึงจะเจอ ⇒ ไม่มีใครรู้ว่าคลิกได้
             กติกา: ความสามารถที่ไม่มีใครเห็น = ไม่มีอยู่จริง · ต้องบอกเหนือตาราง ก่อนตัวเลข ───── */}
      <div style={{
        ...card, padding: '7px 11px', fontSize: FS + 0.5, lineHeight: 1.7,
        borderColor: editable ? 'var(--accent)' : 'var(--border)',
        background: 'var(--bg2)',
      }}>
        {editable ? (
          <>✏️ <b>แก้ตัวเลขได้เลย — คลิกที่ช่องแล้วพิมพ์ทับ</b>
            <span style={{ color: 'var(--muted)' }}>
              {' · '}<b>Enter</b> ลงช่องล่าง{' · '}<b>Tab</b> ไปช่องขวา{' · '}<b>Esc</b> ยกเลิก
              {' · '}แถวที่ติดป้าย <b>ƒ สูตร</b> (พื้นเทา ตัวเอียง) ระบบคำนวณให้ พิมพ์ทับไม่ได้
              {' · '}ค่าที่คนกรอกชนะค่าที่ระบบดึงเสมอ
            </span>
          </>
        ) : (
          <>👁️ <b>อ่านอย่างเดียว</b>
            <span style={{ color: 'var(--muted)' }}> — บัญชีนี้ยังไม่มีสิทธิ์ <code>monitoring:manage</code> จึงแก้ตัวเลขในบอร์ดไม่ได้ (ขอสิทธิ์ที่หน้า /permissions)</span>
          </>
        )}
      </div>

      {/* ── ตาราง ───────────────────────────────────────────────────────────────── */}
      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: FS, width: 'max-content', minWidth: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...thSticky, width: HEAD_W, minWidth: HEAD_W, textAlign: 'left' }}>
                พาร์ท <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({shown.length}/{parts.length})</span>
              </th>
              <th style={{ ...thBase, minWidth: 108, textAlign: 'left' }}>แถว</th>
              {win.map((p, i) => {
                const d = dayLabel(p.date);
                const isSeed = p.key === seed?.key;
                const isToday = p.date === todayKey;
                return (
                  <th key={p.key} style={{
                    ...thBase, minWidth: COL_W, width: COL_W,
                    background: isToday ? 'var(--accent-dim)' : (isSeed ? 'var(--bg3)' : 'var(--bg2)'),
                    borderLeft: isToday ? '2px solid var(--accent)'
                      : (isSeed || i === 1 ? '2px solid var(--border2)' : thBase.borderLeft),
                    borderRight: isToday ? '2px solid var(--accent)' : undefined,
                  }}>
                    <div style={{
                      fontSize: FS - 1,
                      fontWeight: isToday ? 800 : undefined,
                      color: isToday ? 'var(--accent)'
                        : (isSeed ? 'var(--accent2)' : (d.weekend ? 'var(--muted)' : 'var(--text2)')),
                    }}>
                      {/* 🔴 ต้องบอกว่า "วันนี้" อยู่คอลัมน์ไหน (user 06/10) — บอร์ดกว้าง 34 คอลัมน์
                          ไล่หาวันที่เองทุกครั้ง = เสียเวลาและอ่านผิดแถว · ใช้ `getWorkDate()`
                          (ก่อน 08:00 = วันก่อนหน้า) ไม่ใช่วันปฏิทิน — กะดึกต้องชี้วันงานของตัวเอง */}
                      {isToday ? '📍 วันนี้' : (isSeed ? 'ยกมา' : (board.period_kind === 'week' ? 'สัปดาห์' : d.top))}
                    </div>
                    <div style={{ fontWeight: isToday ? 800 : undefined, color: isToday ? 'var(--accent)' : undefined }}>{d.bot}</div>
                  </th>
                );
              })}
              <th style={{ ...thBase, minWidth: 78, borderLeft: '2px solid var(--border2)' }}>FC</th>
              <th style={{ ...thBase, minWidth: 78 }}>Total SL</th>
              <th style={{ ...thBase, minWidth: 66 }}>%SL</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={win.length + 5} style={{ padding: 18, textAlign: 'center', color: 'var(--muted)' }}>
                {parts.length === 0 ? 'บอร์ดนี้ยังไม่มีพาร์ท — นำเข้าจากไฟล์ Excel หรือเพิ่มเอง' : 'ไม่มีพาร์ทที่ตรงเงื่อนไข'}
              </td></tr>
            ) : shown.map((part, pi) => {
              const sl = slSummary({
                grid, partId: part.id, fc: part.fc,
                slRow: board.sl_row || 'out', seedRow: balKey || 'balance',
                includeSeed: !!board.sl_includes_seed,
              });
              const shortAt = balKey ? firstShortDate({ grid, partId: part.id, balanceRow: balKey }) : null;
              /* 🔴 ยอด FG ของบอร์ดรายแร็คอยู่ใน "ช่องยอดยกมา" ของแถวคงเหลือ ไม่ใช่คอลัมน์ของพาร์ท
                 ⇒ จำนวนแร็คต้องคิดจากกริด ห้ามอ่านจากฟิลด์ที่ไม่มีอยู่ (เคยเขียน part.fg_qty ซึ่ง
                 ไม่มีใน schema ⇒ ได้ null เงียบๆ ทุกแถว) */
              const racks = board.kind === 'rack' && seed
                ? rackCount({ qty: valueAt(grid, part.id, balKey || 'balance', seed.key), packStd: part.packing })
                : null;
              /* บอร์ดวัตถุดิบ: กก. ⇄ ชิ้น + พอทำงานท้ายไลน์ไหม (สูตรใน monitorGrid ห้ามคิดที่นี่) */
              const raw = board.kind === 'raw' && seed ? (() => {
                const kg = valueAt(grid, part.id, 'on_hand_kg', seed.key);
                const q = valueAt(grid, part.id, 'queue_pcs', seed.key);
                return {
                  pieces: rawPieces({ onHandKg: kg, kgPerPiece: part.kg_per_piece, pieces: part.pieces_per_shot || 1 }),
                  cover: rawCoverage({ onHandKg: kg, queuePieces: q, kgPerPiece: part.kg_per_piece, pieces: part.pieces_per_shot || 1 }),
                };
              })() : null;
              return rows.map((row, ri) => {
                /* 🔴 แถวสูตร (recur) ต้องดู "ไม่ใช่ของที่เรากรอก" ตั้งแต่แรกเห็น (user 06/10:
                   *"แถวสูตรคำนวนกับแถวที่พิมพ์ได้ มันควรจะต่างกันมากกว่านี้"*)
                   เดิมต่างแค่ตัวอักษรจาง + ตัว ƒ เล็กๆ ⇒ บนจอจริงที่มี 7 แถว/พาร์ท แยกไม่ออก
                   ⇒ ทั้งแถวเปลี่ยนพื้น + ป้ายติดชื่อแถว + ตัวเลขเอียง (3 สัญญาณ ไม่ใช่สัญญาณเดียว) */
                const isCalc = row.kind === 'recur';
                const rowBg = isCalc ? 'var(--bg3)' : (pi % 2 ? 'var(--bg2)' : 'transparent');
                return (
                <tr key={`${part.id}|${row.key}`} style={{ background: rowBg }}>
                  {ri === 0 ? (
                    <td rowSpan={rows.length} style={{ ...tdSticky, width: HEAD_W, verticalAlign: 'top', background: pi % 2 ? 'var(--bg2)' : 'var(--card)' }}>
                      <PartHead part={part} board={board} shortAt={shortAt} racks={racks} raw={raw} />
                    </td>
                  ) : null}
                  <td style={{
                    ...tdBase, whiteSpace: 'nowrap', fontWeight: isCalc ? 400 : 700,
                    color: isCalc ? 'var(--muted)' : 'var(--text)',
                  }}>
                    {row.label}
                    {row.kind === 'system' ? <span title="ระบบดึงให้เอง — กรอกทับได้" style={{ color: 'var(--muted)' }}> ⚙</span> : null}
                    {isCalc ? (
                      <span title="ระบบคำนวณจากแถวอื่น — พิมพ์ทับไม่ได้"
                        style={{
                          marginLeft: 6, fontSize: FS - 1.5, fontWeight: 800, padding: '0 5px',
                          borderRadius: 4, border: '1px solid var(--border2)',
                          background: 'var(--bg2)', color: 'var(--muted)', whiteSpace: 'nowrap',
                        }}>ƒ สูตร</span>
                    ) : null}
                  </td>
                  {win.map((p, ci) => {
                    const c = cellAt(grid, part.id, row.key, p.key);
                    const isSeed = p.key === seed?.key;
                    const isToday = p.date === todayKey;
                    const editing = edit && edit.partId === part.id && edit.rowKey === row.key && edit.periodKey === p.key;
                    const br = balKey === row.key ? breachBy.get(`${part.id}|${p.date}`) : null;
                    const neg = balKey === row.key && c?.v !== null && c?.v < 0;
                    return (
                      <td key={p.key}
                        /* คลาสนี้ให้ hover + เส้นประใต้ตัวเลข = "ช่องนี้กดแก้ได้" (index.css · เฉพาะเครื่องที่มีเมาส์) */
                        className={c?.editable && editable ? 'mon-cell-edit' : undefined}
                        onClick={() => c?.editable && !editing && startEdit(part.id, row.key, p.key, c.v)}
                        title={br ? `ต่ำกว่า MIN ${fmtN(br.short)} ชิ้น (MIN ${fmtN(br.min)})` : (c?.src === 'system' ? 'ระบบดึงจากใบผลิต/สต๊อก — กดเพื่อกรอกทับ' : undefined)}
                        style={{
                          ...tdBase, textAlign: 'right', cursor: c?.editable && editable ? 'cell' : 'default',
                          minWidth: COL_W, width: COL_W, padding: editing ? 0 : tdBase.padding,
                          borderLeft: isToday ? '2px solid var(--accent)'
                            : (isSeed || ci === 1 ? '2px solid var(--border2)' : tdBase.borderLeft),
                          borderRight: isToday ? '2px solid var(--accent)' : undefined,
                          background: isToday ? 'var(--accent-dim)' : (isSeed ? 'var(--bg3)' : undefined),
                          color: neg || br ? '#f87171' : (c?.src === 'system' ? 'var(--text2)' : (isCalc ? 'var(--muted)' : 'var(--text)')),
                          /* ตัวเลขของแถวสูตร = เอียง ⇒ มองผ่านๆ ก็รู้ว่า "เครื่องคิดให้" ไม่ใช่ของที่ใครพิมพ์
                             (สีจางอย่างเดียวไม่พอ — ตัวเลขที่ระบบดึงมา `system` ก็จางเหมือนกัน แต่กรอกทับได้) */
                          fontStyle: isCalc ? 'italic' : undefined,
                          fontWeight: br || neg ? 700 : (c?.src === 'input' ? 600 : 400),
                        }}>
                        {editing ? (
                          <input ref={inputRef} autoFocus
                            value={edit.value}
                            inputMode={row.kind === 'date' ? 'text' : 'decimal'}
                            onChange={(e) => setEdit((s) => ({ ...s, value: e.target.value }))}
                            onBlur={() => commit(null)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); commit('down'); }
                              else if (e.key === 'Tab') { e.preventDefault(); commit('right'); }
                              else if (e.key === 'Escape') { e.preventDefault(); setEdit(null); }
                            }}
                            style={{
                              width: '100%', boxSizing: 'border-box', textAlign: 'right', fontSize: FS,
                              padding: '3px 5px', border: '2px solid var(--accent)', borderRadius: 3,
                              background: 'var(--bg)', color: 'var(--text)',
                            }} />
                        ) : (
                          row.kind === 'date'
                            ? (c?.v ? String(c.v).slice(5) : '–')
                            : fmtN(c?.v, row.key === 'on_hand_kg' || row.key === 'kg' ? 2 : 0)
                        )}
                      </td>
                    );
                  })}
                  {ri === 0 ? (
                    <>
                      <td rowSpan={rows.length} style={{ ...tdBase, textAlign: 'right', borderLeft: '2px solid var(--border2)', verticalAlign: 'top' }}>{fmtN(part.fc)}</td>
                      <td rowSpan={rows.length} style={{ ...tdBase, textAlign: 'right', verticalAlign: 'top' }}>
                        {fmtN(sl.totalSl)}
                        <div style={{ fontSize: FS - 1.5, color: 'var(--muted)' }}>
                          {sl.diffFc === null ? '' : `${sl.diffFc > 0 ? '+' : ''}${fmtN(sl.diffFc)}`}
                        </div>
                      </td>
                      <td rowSpan={rows.length} style={{
                        ...tdBase, textAlign: 'right', verticalAlign: 'top',
                        color: sl.pctSl === null ? 'var(--muted)' : (sl.pctSl >= 1 ? 'var(--accent)' : (sl.pctSl >= 0.8 ? 'var(--accent2)' : '#f87171')),
                        fontWeight: 600,
                      }}>{fmtPct(sl.pctSl)}</td>
                    </>
                  ) : null}
                </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>

      {/* ── ที่มาของตัวเลข (ต้องเขียนไว้ เพราะ 2 ชีทในไฟล์เดิมคิด Total SL คนละแบบ) ──── */}
      <div style={{ fontSize: FS, color: 'var(--muted)', lineHeight: 1.8 }}>
        <b>Total SL</b> ของบอร์ดนี้นับจากแถว <b>{rows.find((r) => r.key === (board.sl_row || 'out'))?.label || board.sl_row}</b>
        {board.sl_includes_seed ? ' + ยอดยกมา' : ''} (ข้ามคอลัมน์ยอดยกมาในการรวม)
        {' · '}<b>ƒ สูตร</b> = แถวที่ระบบคำนวณจากคอลัมน์ก่อนหน้า (พื้นเทา · ตัวเอียง) พิมพ์ทับไม่ได้
        {' · '}<b>⚙</b> = ระบบดึงจากใบผลิต/สต๊อกให้ กรอกทับได้ (ค่าที่คนกรอกชนะเสมอ)
        {' · '}<b>–</b> = ข้อมูลไม่พอให้คิด (ไม่ใช่ 0)
        {!editable ? <> · <b>อ่านอย่างเดียว</b> (ไม่มีสิทธิ์แก้บอร์ดนี้)</> : null}
      </div>
    </div>
  );
}

/* หัวแถวพาร์ท — เลขที่ยาวต้อง clamp ไม่ให้ดันตารางบาน (ไฟล์จริงมีชื่อยาว 72 ตัวอักษร) */
function PartHead({ part, board, shortAt, racks = null, raw = null }) {
  const sub = [];
  if (part.model) sub.push(part.model);
  if (part.rack) sub.push(`แร็ค ${part.rack}`);
  if (part.lot_qty) sub.push(`LOT ${fmtN(part.lot_qty)}`);
  if (part.packing) sub.push(`บรรจุ ${fmtN(part.packing)}`);
  if (part.ct_sec) sub.push(`CT ${part.ct_sec}s`);
  if (part.pieces_per_shot > 1) sub.push(`${part.pieces_per_shot} ชิ้น/จังหวะ`);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, maxWidth: HEAD_W - 16 }}>
      {/* 🔴 `matText(mat, index, row)` — อาร์กิวเมนต์แรกคือ "เลข MAT" ไม่ใช่ทั้งแถว
          เดิมส่ง `matText(part)` ⇒ หัวพาร์ททุกแถวขึ้น `MAT [object Object]` แทนเลขจริง (แก้ 05/10)
          ชื่อพาร์ทวาดเป็นบรรทัดของตัวเองข้างล่าง (clamp 2 บรรทัด) จึงไม่ส่ง `name` เข้ามาซ้ำ */}
      <div style={{ fontWeight: 700, fontSize: FS + 0.5 }}>
        {matText(part.mat_no, null, { pNo: part.part_no }) || part.mat_no || '(ไม่มีเลข)'}
      </div>
      {part.part_name ? (
        <div style={{
          color: 'var(--text2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          overflow: 'hidden', fontSize: FS - 0.5,
        }} title={part.part_name}>{part.part_name}</div>
      ) : null}
      {sub.length ? <div style={{ color: 'var(--muted)', fontSize: FS - 1 }}>{sub.join(' · ')}</div> : null}
      {part.spec ? <div style={{ color: 'var(--muted)', fontSize: FS - 1 }} title={part.spec}>{String(part.spec).slice(0, 40)}</div> : null}
      {part.mat_after ? <div style={{ color: 'var(--muted)', fontSize: FS - 1 }}>หลังชุบ: {part.mat_after}</div> : null}
      {racks !== null ? <div style={{ color: 'var(--muted)', fontSize: FS - 1 }}>≈ {fmtN(racks, 1)} แร็ค</div> : null}
      {raw ? (
        <div style={{ fontSize: FS - 1, color: 'var(--muted)' }}>
          {raw.pieces === null
            ? <span title="ไม่รู้อัตราใช้เหล็ก หรือยังไม่ลงยอดคงเหลือ ⇒ คิดเป็นชิ้นไม่ได้">ทำได้ – ชิ้น</span>
            : <>ทำได้ ~{fmtN(raw.pieces)} ชิ้น</>}
          {raw.cover.enough === null
            ? <span title="ข้อมูลไม่พอ — ห้ามตอบว่าพอหรือไม่พอ"> · เทียบงานท้ายไลน์ไม่ได้</span>
            : (raw.cover.enough
              ? <span style={{ color: 'var(--accent)' }}> · เหล็กพอ (เหลือ {fmtN(raw.cover.diff, 1)} กก.)</span>
              : <span style={{ color: '#f87171', fontWeight: 700 }}> · เหล็กขาด {fmtN(-raw.cover.diff, 1)} กก.</span>)}
        </div>
      ) : null}
      {shortAt ? <div style={{ color: '#f87171', fontWeight: 700, fontSize: FS - 0.5 }}>⚠ ของขาด {shortAt.slice(5)}</div> : null}
      {!part.in_registry && part.mat_no ? (
        <div style={{ color: 'var(--accent2)', fontSize: FS - 1 }} title="พาร์ทนี้ยังไม่อยู่ในทะเบียนสินค้า (dr_products) ⇒ ระบบดึงยอดผลิต/CT ให้ไม่ได้">
          ⚠ ยังไม่อยู่ในทะเบียนสินค้า
        </div>
      ) : null}
    </div>
  );
}

/* ⚠️ sticky เกาะได้เพราะ <main> ใน App.jsx เป็น overflowX:'clip' (กับดัก CSS ใน CLAUDE.md) */
const thBase = {
  padding: '4px 6px', borderBottom: '2px solid var(--border2)', borderLeft: '1px solid var(--border)',
  background: 'var(--bg2)', position: 'sticky', top: 0, zIndex: 2, fontWeight: 600, whiteSpace: 'nowrap',
};
const thSticky = { ...thBase, left: 0, zIndex: 3 };
const tdBase = {
  padding: '3px 6px', borderBottom: '1px solid var(--border)', borderLeft: '1px solid var(--border)',
  whiteSpace: 'nowrap',
};
const tdSticky = { ...tdBase, position: 'sticky', left: 0, zIndex: 1, borderRight: '2px solid var(--border2)' };

export { fmtN as monitorFmt };
