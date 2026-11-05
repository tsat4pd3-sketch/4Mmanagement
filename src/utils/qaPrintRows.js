/* 🖨️ แถวของใบพิมพ์ QA (pure · มีเทส) — ใช้โดย src/lib/qaSheetPrint.js · 05/11
   🔴 จุดที่ยังไม่ตรวจต้องอยู่บนใบด้วย — พิมพ์แต่จุดที่มีผล = ใบดูเหมือนตรวจครบ */
const MAX_PIECE_COLS = 10;

/** ค่าของ 1 ชิ้นในช่องตาราง (pure) */
export function pieceCell(itemType, v) {
  if (v == null || v === '') return '';
  if (itemType === 'variable') return String(v);
  if (v === 'ok') return 'OK';
  if (v === 'ng') return 'NG';
  if (v === 'na') return '–';
  return String(v);
}

/**
 * แถวของใบพิมพ์ (pure · มีเทส) — ทุกจุดตรวจในมาตรฐาน + ผลถ้ามี · จุดที่มีผลแต่ไม่อยู่ในมาตรฐานแล้ว (ถูกปิดทีหลัง) ต่อท้าย
 * @returns {{ rows: object[], pieceCols: number, checkedN: number, totalN: number, ngN: number }}
 */
export function buildQaPrintRows({ items = [], results = [] } = {}) {
  const resById = new Map(results.map(r => [r.item_id, r]));
  const seen = new Set();
  const rows = [];
  const byBalloon = (a, b) => (Number(a.balloon_no) || 0) - (Number(b.balloon_no) || 0);
  for (const it of [...items].sort(byBalloon)) {
    const r = resById.get(it.id) || null;
    seen.add(it.id);
    rows.push({
      balloon: it.balloon_no, characteristic: r?.characteristic || it.characteristic, itemType: r?.item_type || it.item_type,
      spec: r?.spec_text || it.spec_text || '', method: it.method || '', sample: it.sample_size || null,
      values: Array.isArray(r?.values_json) ? r.values_json : [], judgement: r?.judgement || null,
      qtyChecked: r?.qty_checked ?? null, qtyNg: r?.qty_ng ?? null, note: r?.note || '', checked: !!r && r.judgement != null,
    });
  }
  for (const r of results) {
    if (seen.has(r.item_id)) continue;
    rows.push({
      balloon: r.balloon_no, characteristic: r.characteristic, itemType: r.item_type, spec: r.spec_text || '',
      method: '', sample: null, values: Array.isArray(r.values_json) ? r.values_json : [], judgement: r.judgement || null,
      qtyChecked: r.qty_checked ?? null, qtyNg: r.qty_ng ?? null, note: r.note || '', checked: r.judgement != null, retired: true,
    });
  }
  const pieceCols = Math.min(MAX_PIECE_COLS, Math.max(1, ...rows.map(r => Math.max(r.values.length, Number(r.sample) || 0))));
  return {
    rows, pieceCols,
    checkedN: rows.filter(r => r.checked).length,
    totalN: rows.length,
    ngN: rows.filter(r => r.judgement === 'ng').length,
  };
}

