/* ═══ 📚 คลัง PFMEA กลาง (Foundation PFMEA) — กฎ/สูตร pure · ไม่ import supabase/react ═══
   2026-09-15 · แบบเต็ม: docs/modules/pe-core-tools.md §คลัง PFMEA

   จุดเดียวที่เป็นเจ้าของ:
     · normalize ชื่อกระบวนการ/failure mode เพื่อจับคู่ (ต้องตรงกับ pe_master_norm() ฝั่ง SQL)
     · เทียบแถวพาร์ทกับ master → same / behind / better / diverged / unlinked
     · สร้าง "ข้อเสนออัพเดท master" จากพาร์ทที่ทำ action แล้วดีขึ้น (เสนอเท่านั้น — ห้ามเขียน master เอง)
     · แถวที่จะดึงจาก master เข้า OP (ข้าม failure mode ที่มีอยู่แล้ว)
     · ประกอบชุดเอกสารใหม่จากกระบวนการมาตรฐานที่เลือก
   ⚠️ RPN ต่ำกว่า ≠ ดีกว่าเสมอ — เสนอเฉพาะแถวที่มี action_taken + new S/O/D ครบ (มี "ของจริง" รองรับ) */

/** normalize เหมือน SQL pe_master_norm(): lower · ตัดเครื่องหมาย · ยุบช่องว่าง (a-z 0-9 ไทย) */
export const normText = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9ก-๙]+/g, ' ').trim();
/** key ของ master process จากชื่อ+ชนิด — ต้องตรงกับ seed ฝั่ง SQL */
export const masterKey = (name, kind = 'process') => `${normText(name).replace(/ /g, '_')}__${kind || 'process'}`;

export const rpnOf = (it) => (it?.severity && it?.occurrence && it?.detection) ? it.severity * it.occurrence * it.detection : null;
export const rpnNewOf = (it) => (it?.new_severity && it?.new_occurrence && it?.new_detection) ? it.new_severity * it.new_occurrence * it.new_detection : null;
/** RPN "ที่เป็นจริงตอนนี้" ของแถวพาร์ท = หลัง action ถ้ามีครบ ไม่งั้นค่าตั้งต้น */
export const effectiveRpn = (it) => rpnNewOf(it) ?? rpnOf(it);
export const hasAction = (it) => !!(it?.action_taken && String(it.action_taken).trim()) && rpnNewOf(it) != null;

export const CMP_META = {
  unlinked: { label: 'ยังไม่ผูก master', color: '#94a3b8', icon: '○' },
  same:     { label: 'ตรงกับ master',    color: '#22c55e', icon: '📚' },
  behind:   { label: 'master ใหม่กว่า',  color: '#f59e0b', icon: '⬆️' },
  better:   { label: 'ดีกว่า master',    color: '#a855f7', icon: '⭐' },
  diverged: { label: 'ต่างจาก master',   color: '#3b82f6', icon: '↔️' },
};

/** เทียบแถวพาร์ทกับ master item ที่มันผูกอยู่ */
export function compareToMaster(item, m) {
  if (!item?.master_item_id || !m) return { state: 'unlinked', rpnItem: effectiveRpn(item), rpnMaster: null, masterNewer: false };
  const rpnMaster = rpnOf(m);
  const rpnItem = effectiveRpn(item);
  const masterNewer = (m.version || 1) > (item.master_version || 1);
  let state = 'same';
  if (masterNewer) state = 'behind';
  else if (hasAction(item) && rpnItem != null && rpnMaster != null && rpnItem < rpnMaster) state = 'better';
  else if (rpnItem != null && rpnMaster != null && rpnItem !== rpnMaster) state = 'diverged';
  else if (normText(item.prevention) !== normText(m.prevention) || normText(item.detection_ctrl) !== normText(m.detection_ctrl)) state = 'diverged';
  return { state, rpnItem, rpnMaster, masterNewer };
}

const pickControls = (it, useNew = false) => ({
  severity:       useNew ? it.new_severity   : it.severity,
  occurrence:     useNew ? it.new_occurrence : it.occurrence,
  detection:      useNew ? it.new_detection  : it.detection,
  prevention:     it.prevention || null,
  detection_ctrl: it.detection_ctrl || null,
  causes:         it.causes || null,
  effects:        it.effects || null,
});

/** ข้อเสนอ "improve": แถวพาร์ทที่ทำ action แล้ว RPN ใหม่ต่ำกว่า master · ข้าม source ที่มีข้อเสนอค้างอยู่แล้ว */
export function improvementProposals(items, masterById, { setId = null, revisionId = null, by = null, pendingSourceIds = new Set() } = {}) {
  const out = [];
  for (const it of items || []) {
    const m = it.master_item_id ? masterById[it.master_item_id] : null;
    if (!m || !hasAction(it) || pendingSourceIds.has(it.id)) continue;
    const before = rpnOf(m), after = rpnNewOf(it);
    if (before == null || after == null || after >= before) continue;
    out.push({
      master_process_id: m.master_process_id, master_item_id: m.id, kind: 'improve',
      source_set_id: setId, source_item_id: it.id, revision_id: revisionId,
      before: pickControls(m), after: { ...pickControls(it, true), best_practice: String(it.action_taken).trim() },
      rpn_before: before, rpn_after: after,
      note: `RPN ${before} → ${after} หลัง action: ${String(it.action_taken).trim().slice(0, 120)}`,
      created_by_name: by,
    });
  }
  return out;
}

/** ข้อเสนอ "new_item": แถวใน OP ที่ผูก master แล้ว แต่ failure mode ไม่มีใน master */
export function newItemProposals(items, procs, masterItems, { setId = null, revisionId = null, by = null, pendingSourceIds = new Set() } = {}) {
  const procById = Object.fromEntries((procs || []).map(p => [p.id, p]));
  const byProc = {};
  for (const m of masterItems || []) (byProc[m.master_process_id] ||= []).push(m);
  const out = [];
  for (const it of items || []) {
    if (it.master_item_id || pendingSourceIds.has(it.id)) continue;
    const mpid = procById[it.process_id]?.master_process_id;
    if (!mpid) continue;
    const fm = normText(it.failure_mode);
    if (!fm || (byProc[mpid] || []).some(m => normText(m.failure_mode) === fm)) continue;
    out.push({
      master_process_id: mpid, master_item_id: null, kind: 'new_item',
      source_set_id: setId, source_item_id: it.id, revision_id: revisionId,
      before: null, after: { requirement: it.requirement || null, failure_mode: it.failure_mode, classification: it.classification || null, ...pickControls(it, hasAction(it)), best_practice: hasAction(it) ? String(it.action_taken).trim() : null },
      rpn_before: null, rpn_after: effectiveRpn(it),
      note: `failure mode ใหม่ที่ master ยังไม่มี: ${it.failure_mode}`,
      created_by_name: by,
    });
  }
  return out;
}

/** แถวที่จะ insert เข้า pe_fmea_items จาก master (ข้าม failure mode ที่ OP มีอยู่แล้ว) */
export function pullRows(masterItems, processId, existingItems = []) {
  const have = new Set((existingItems || []).map(i => normText(i.failure_mode)).filter(Boolean));
  const maxSeq = (existingItems || []).reduce((m, i) => Math.max(m, i.seq || 0), 0);
  const rows = [];
  let seq = maxSeq;
  for (const m of [...(masterItems || [])].filter(m => m.is_active !== false).sort((a, b) => (a.seq || 0) - (b.seq || 0))) {
    if (have.has(normText(m.failure_mode))) continue;
    seq += 1;
    rows.push({
      process_id: processId, seq, requirement: m.requirement || null, failure_mode: m.failure_mode, effects: m.effects || null,
      severity: m.severity ?? null, classification: m.classification || null, causes: m.causes || null,
      prevention: m.prevention || null, occurrence: m.occurrence ?? null, detection_ctrl: m.detection_ctrl || null, detection: m.detection ?? null,
      recommended_action: m.best_practice || null,
      master_item_id: m.id, master_version: m.version || 1,
    });
  }
  return { rows, skipped: (masterItems || []).length - rows.length };
}

/** ค่าใหม่ของ master item เมื่อรับข้อเสนอ (version +1) — คนกดยืนยันแล้วเท่านั้น */
export function applyProposal(masterItem, proposal) {
  const a = proposal?.after || {};
  const next = { ...masterItem, version: (masterItem?.version || 1) + 1 };
  for (const k of ['severity', 'occurrence', 'detection', 'prevention', 'detection_ctrl', 'causes', 'effects', 'requirement', 'classification']) {
    if (a[k] !== undefined && a[k] !== null && a[k] !== '') next[k] = a[k];
  }
  if (a.best_practice) next.best_practice = a.best_practice;
  return next;
}

/** เสนอ master process ให้ OP จากชื่อ (ตรง key ก่อน · ไม่ตรง = คล้ายที่สุดด้วยคำร่วม) */
export function suggestMaster(procName, kind, masters) {
  const key = masterKey(procName, kind);
  const exact = (masters || []).find(m => m.key === key);
  if (exact) return { master: exact, exact: true };
  const words = new Set(normText(procName).split(' ').filter(w => w.length > 2));
  if (!words.size) return { master: null, exact: false };
  let best = null, bestScore = 0;
  for (const m of masters || []) {
    const mw = normText(m.name).split(' ').filter(w => w.length > 2);
    const hit = mw.filter(w => words.has(w)).length;
    const score = hit / Math.max(words.size, mw.length || 1);
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return bestScore >= 0.5 ? { master: best, exact: false, score: bestScore } : { master: null, exact: false };
}

/** ประกอบ OP + แถว FMEA สำหรับชุดเอกสารใหม่จาก master ที่เลือก (เรียงตาม selected · op_no 10,20,30…) */
export function buildSetFromMaster(selected, masterItemsByProc, { setId, step = 10 } = {}) {
  const procs = [], items = [];
  (selected || []).forEach((m, i) => {
    const op_no = String(m.op_no || (i + 1) * step);
    procs.push({ _key: m.id, set_id: setId, op_no, seq: (i + 1) * step, name: m.name, kind: m.kind || 'process', master_process_id: m.id, line_name: m.line_name || null, machine_no: m.machine_no || null });
    const { rows } = pullRows(masterItemsByProc[m.id] || [], null, []);
    rows.forEach(r => items.push({ ...r, _procKey: m.id }));
  });
  return { procs, items };
}

/** สรุปสถานะทั้งชุดเทียบ master (ใช้แถบบนแท็บ FMEA) */
export function setMasterSummary(items, masterById) {
  const c = { unlinked: 0, same: 0, behind: 0, better: 0, diverged: 0 };
  for (const it of items || []) c[compareToMaster(it, it.master_item_id ? masterById[it.master_item_id] : null).state] += 1;
  return c;
}
