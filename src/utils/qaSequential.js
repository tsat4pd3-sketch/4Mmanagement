/**
 * qaSequential — "ตัวเดินกฎ" การตรวจแบบทีละชิ้น (sequential acceptance) · single source of truth
 * (2026-09-07 · ถอดจากวิธีทำงานจริงที่ user เล่า + กฎที่เคาะร่วมกัน)
 *
 * วิธีหน้างาน: หยิบชิ้นที่ 1 ไล่ตรวจ **ทุกจุด** → ค่อยหยิบชิ้นถัดไป (ไม่ใช่ตรวจจุดเดียว 5 ชิ้นรวด)
 * ผลต่อชิ้น = ผ่าน (ทุกจุดผ่าน/ข้าม) หรือ ตก (มีจุดไม่ผ่าน)
 *
 * กฎ (รอบที่ 1 = ตั้งแต่เปิดใบ · รอบถัดไปเริ่มหลังบันทึก action):
 *   รอบที่ 1
 *     · ชิ้นแรกผ่าน                     → ✅ ยอมรับ (ไม่ต้องหยิบชิ้นที่ 2)
 *     · ตกสะสมครบ FAILS_TO_ALARM (2)     → 🚨 alarm → รอ action   (ตก→ตก · ตก→ผ่าน→ตก)
 *     · ผ่านติดกัน PASSES_TO_ACCEPT (2)  → ✅ ยอมรับ               (ตก→ผ่าน→ผ่าน)
 *   รอบที่ ≥ 2 (หลัง action)
 *     · ตกแม้ชิ้นเดียว                  → 🚨 alarm ซ้ำทันที (เพิ่งบอกว่าแก้แล้ว ไม่ให้โควต้าตก)
 *     · ผ่านติดกัน 2 ชิ้น                → ✅ ยอมรับ
 *   → ทุกเส้นทางจบภายใน 3 ชิ้นต่อรอบ ไม่ต้องมีเพดานเพิ่ม
 *
 * ทำไมเลือก "ตกสะสม 2" ไม่ใช่ "ตกติดกัน 2": ผลสลับ ตก-ผ่าน-ตก-ผ่าน จะวนไม่จบ และตก 2 ใน 3 = กระบวนการยังไม่นิ่ง
 *
 * ⚠️ ทุกจอถามไฟล์นี้ว่า "ต่อไปทำอะไร" ห้ามเขียนกฎซ้ำในหน้า · คอลัมน์ seq_state/seq_round/alarm_count
 *    บนใบเป็นแค่ cache ที่แอปเขียนตามผลของ evalSequence — ความจริงคือแถว pieces + actions
 */

export const SEQ_RULE = Object.freeze({ FAILS_TO_ALARM: 2, PASSES_TO_ACCEPT: 2 });

/** ผลของ 1 ชิ้นจากคำตัดสินรายจุด — ทุกจุดต้องมีคำตอบ (ok/ng/na) ไม่ครบ = null (ยังบันทึกไม่ได้)
 *  @param {Array<'ok'|'ng'|'na'|null|undefined>} judgements */
export function pieceResult(judgements) {
  const js = judgements || [];
  if (!js.length || js.some(j => j !== 'ok' && j !== 'ng' && j !== 'na')) return null;
  return js.some(j => j === 'ng') ? 'fail' : 'pass';
}

/**
 * เดินกฎจากข้อเท็จจริงในตาราง
 * @param {Array<{round_no:number, piece_no:number, result:'pass'|'fail'}>} pieces
 * @param {Array<{round_no:number}>} actions   action ที่ปิดรอบนั้น (unique ต่อรอบ)
 * @returns {{
 *   state: 'inspecting'|'await_action'|'accepted',
 *   round: number,           รอบปัจจุบัน
 *   nextPiece: number,       เลขชิ้นถัดไป (นับต่อเนื่องทั้งใบ)
 *   piecesInRound: number, failsInRound: number, passStreak: number,
 *   alarmCount: number,      จำนวนครั้งที่ alarm แล้วทั้งใบ
 *   alarmRound: number|null, รอบที่กำลังรอ action (state = await_action)
 *   acceptedBy: 'first_pass'|'two_passes'|null,
 *   code: string             รหัสเหตุผลสำหรับป้ายบนจอ (ดู seqLabel)
 * }}
 */
export function evalSequence(pieces = [], actions = []) {
  const ps = [...(pieces || [])].filter(p => p && (p.result === 'pass' || p.result === 'fail'))
    .sort((a, b) => (a.piece_no ?? 0) - (b.piece_no ?? 0));
  const actionRounds = new Set((actions || []).map(a => Number(a.round_no)).filter(Number.isFinite));
  const maxPiece = ps.reduce((m, p) => Math.max(m, Number(p.piece_no) || 0), 0);

  let round = 1, fails = 0, streak = 0, inRound = 0, alarmCount = 0;
  let code = 'start';
  const out = (state, extra = {}) => ({
    state, round, nextPiece: maxPiece + 1, piecesInRound: inRound, failsInRound: fails, passStreak: streak,
    alarmCount, alarmRound: state === 'await_action' ? round : null, acceptedBy: null, code, ...extra,
  });

  // ด่านความสอดคล้อง: ชิ้นของรอบ r (>1) ต้องมี action ปิดทุกรอบก่อนหน้า ไม่งั้นถือว่าข้อมูลผิด
  // (แถวรอบใหม่ถูกเขียนโดยไม่ผ่านขั้น action) → ไม่เดินกฎต่อ ให้จอบอกให้ชัด
  for (const p of ps) {
    const r = Number(p.round_no) || 1;
    for (let k = 1; k < r; k++) if (!actionRounds.has(k)) return out('await_action', { code: 'inconsistent_round' });
  }

  for (const p of ps) {
    const r = Number(p.round_no) || 1;
    // ชิ้นของรอบถัดไปโผล่ก่อนมี action ปิดรอบ = ข้อมูลไม่สอดคล้อง → ไม่เดินต่อ ให้จอบอกว่ารอ action อยู่
    while (r > round) {
      if (!actionRounds.has(round)) return out('await_action', { code: 'inconsistent_round' });
      round++; fails = 0; streak = 0; inRound = 0;
    }
    inRound++;
    if (p.result === 'pass') {
      streak++;
      if (round === 1 && inRound === 1) { code = 'first_pass'; return out('accepted', { acceptedBy: 'first_pass', nextPiece: maxPiece + 1 }); }
      if (streak >= SEQ_RULE.PASSES_TO_ACCEPT) { code = 'two_passes'; return out('accepted', { acceptedBy: 'two_passes' }); }
      code = round === 1 ? 'pass_need_one_more' : 'after_action_pass_need_one_more';
    } else {
      fails++; streak = 0;
      const alarm = round === 1 ? fails >= SEQ_RULE.FAILS_TO_ALARM : true;
      if (alarm) {
        alarmCount++;
        code = round === 1 ? 'alarm_two_fails' : 'alarm_after_action';
        if (actionRounds.has(round)) {
          // action ปิดรอบนี้แล้ว → รอบถัดไป (ชิ้นถัดไปที่บันทึกจะเป็นของรอบใหม่)
          round++; fails = 0; streak = 0; inRound = 0; code = 'after_action_start';
          continue;
        }
        return out('await_action');
      }
      code = 'fail_need_next';
    }
  }
  return out('inspecting');
}

/** ป้ายภาษาไทยสำหรับจอ — จุดเดียว ห้ามแต่งข้อความซ้ำในหน้า */
export function seqLabel(seq) {
  if (!seq) return '';
  const n = seq.nextPiece;
  switch (seq.code) {
    case 'start': return `หยิบชิ้นที่ 1 ไล่ตรวจทุกจุด — ผ่านหมด = ยอมรับได้เลย`;
    case 'first_pass': return 'ชิ้นแรกผ่านทุกจุด = ยอมรับ ✅';
    case 'two_passes': return `ผ่านติดกัน ${SEQ_RULE.PASSES_TO_ACCEPT} ชิ้น = ยอมรับ ✅`;
    case 'fail_need_next': return `ชิ้นที่ ${n - 1} ตก — ต้องตรวจชิ้นที่ ${n} (ตกอีก = ต้องแก้ไข)`;
    case 'pass_need_one_more': return `ชิ้นที่ ${n - 1} ผ่าน — ต้องผ่านอีก 1 ชิ้นติดกันถึงยอมรับ (ชิ้นที่ ${n})`;
    case 'alarm_two_fails': return `🚨 ตกสะสม ${SEQ_RULE.FAILS_TO_ALARM} ชิ้นในรอบนี้ — ต้องแก้ไข (action) ก่อนตรวจต่อ`;
    case 'alarm_after_action': return `🚨 แก้ไขแล้วยังตกอีก (alarm ครั้งที่ ${seq.alarmCount}) — ต้องแก้ไขใหม่ก่อนตรวจต่อ`;
    case 'after_action_start': return `แก้ไขแล้ว (รอบที่ ${seq.round}) — ต้องผ่านติดกัน ${SEQ_RULE.PASSES_TO_ACCEPT} ชิ้น เริ่มที่ชิ้นที่ ${n}`;
    case 'after_action_pass_need_one_more': return `ชิ้นที่ ${n - 1} ผ่าน — ต้องผ่านอีก 1 ชิ้น (ชิ้นที่ ${n}) ถึงยอมรับ`;
    case 'inconsistent_round': return '⚠️ ข้อมูลรอบไม่สอดคล้อง (มีชิ้นของรอบถัดไปก่อนบันทึก action) — แจ้ง admin';
    default: return '';
  }
}
