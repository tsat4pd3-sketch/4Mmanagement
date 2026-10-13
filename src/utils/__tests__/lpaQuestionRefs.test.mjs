import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LPA_QUESTION_REF_TABLES, loadLpaQuestionRefs, lpaQuestionScope, lpaScopeText,
  lpaQuestionBlockMessage, lpaDeleteConfirmText, savedOnlyAnswers,
} from '../lpaQuestionRefs.js';

/* client ปลอม — คืนจำนวนตาม map ที่ส่งเข้ามา (หรือ error ถ้าใส่ error ไว้) */
const fakeClient = (byTable) => ({
  from(table) {
    const r = byTable[table];
    const q = {
      select: () => q,
      eq: () => (r && r.error ? Promise.resolve({ error: r.error, count: null })
                              : Promise.resolve({ error: null, count: r?.count ?? 0 })),
    };
    return q;
  },
});

test('เคสจริง 12/10 — ข้อที่มีคำตอบในใบตรวจอยู่แล้ว ลบไม่ได้ (ต้องให้ปิดใช้งานแทน)', async () => {
  const q = { id: 'q1', seq: 23, question: 'ANDON', line_name: null };
  const refs = await loadLpaQuestionRefs(fakeClient({ lpa_audit_answers: { count: 2444 } }), 'q1');
  assert.equal(refs.total, 2444);
  assert.equal(refs.partial, false);
  const msg = lpaQuestionBlockMessage(q, refs);
  assert.ok(msg && msg.includes('ลบไม่ได้'), 'ต้องบล็อก');
  assert.ok(msg.includes('2,444'), 'ต้องบอกจำนวนที่อ้างอยู่');
  assert.ok(msg.includes('ส่วนรวม'), 'ต้องบอกว่าเป็นข้อของส่วนรวม');
  assert.ok(msg.includes('ปิดใช้งาน'), 'ต้องเสนอทางออก');
});

test('ข้อที่ยังไม่มีใครตอบ = ลบได้ (คืน null)', async () => {
  const refs = await loadLpaQuestionRefs(fakeClient({ lpa_audit_answers: { count: 0 } }), 'q2');
  assert.equal(lpaQuestionBlockMessage({ id: 'q2', question: 'ใหม่' }, refs), null);
});

test('นับไม่ได้ = ห้ามลบ (fail-closed)', async () => {
  const refs = await loadLpaQuestionRefs(fakeClient({ lpa_audit_answers: { error: { code: '08006', message: 'network' } } }), 'q3');
  assert.equal(refs.partial, true);
  assert.ok(lpaQuestionBlockMessage({ id: 'q3' }, refs).includes('ยังลบไม่ได้'));
});

test('ตาราง/คอลัมน์ยังไม่มี (42P01/42703) = นับเป็น 0 ไม่ใช่นับไม่ได้', async () => {
  for (const code of ['42P01', '42703']) {
    const refs = await loadLpaQuestionRefs(fakeClient({ lpa_audit_answers: { error: { code } } }), 'q4');
    assert.equal(refs.partial, false, code);
    assert.equal(refs.total, 0, code);
  }
});

test('ไม่มี client / ไม่มี id = partial (ห้ามลบ)', async () => {
  assert.equal((await loadLpaQuestionRefs(null, 'q')).partial, true);
  assert.equal((await loadLpaQuestionRefs(fakeClient({}), '')).partial, true);
});

test('ขอบเขต: common vs เฉพาะไลน์ — ข้อความยืนยันต้องบอกเสมอว่ากำลังลบของใคร', () => {
  const common = { id: 'a', seq: 22, question: 'VISUAL', line_name: null, hidden_for_lines: ['L1', 'L2'] };
  assert.equal(lpaQuestionScope(common).common, true);
  assert.equal(lpaQuestionScope(common).hiddenCount, 2);
  assert.ok(lpaScopeText(common).includes('ทุกไลน์'));
  const cText = lpaDeleteConfirmText(common);
  assert.ok(cText.includes('ส่วนรวม'), 'ต้องเตือนว่าเป็นของส่วนรวม');
  assert.ok(cText.includes('ทุกไลน์'));
  assert.ok(cText.includes('ซ่อนเฉพาะไลน์นี้'), 'ต้องเสนอทางเลือกที่กระทบน้อยกว่า');

  const own = { id: 'b', seq: 25, question: 'เฝ้าระวัง', line_name: 'GOR' };
  assert.equal(lpaQuestionScope(own).common, false);
  assert.ok(lpaScopeText(own).includes('GOR'));
  const oText = lpaDeleteConfirmText(own);
  assert.ok(oText.includes('GOR'), 'ต้องบอกชื่อไลน์');
  assert.ok(oText.includes('ไลน์อื่นไม่กระทบ'));
  assert.ok(!oText.includes('ส่วนรวม'));
});

test('savedOnlyAnswers — คำตอบของข้อที่ถูกถอดออกจากเช็คลิสต์ ต้องไม่หายจากใบเก่า', () => {
  const answers = {
    live1: { answer: 'Y', note: '', text: 'ข้อที่ยังอยู่' },
    gone1: { answer: 'N', note: 'พบปัญหา', text: 'ANDON (ถูกลบไปแล้ว)' },
    empty: { answer: '', note: '' },                       // ไม่เคยตอบ = ไม่ต้องพก
  };
  const out = savedOnlyAnswers(answers, [{ id: 'live1' }]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { question_id: 'gone1', question_text: 'ANDON (ถูกลบไปแล้ว)', answer: 'N', note: 'พบปัญหา' });
  // ใบใหม่ที่ยังไม่มีคำตอบเก่า = ไม่มีอะไรเพิ่ม (พฤติกรรมเดิมเป๊ะ)
  assert.deepEqual(savedOnlyAnswers({}, [{ id: 'live1' }]), []);
  assert.deepEqual(savedOnlyAnswers(undefined, undefined), []);
});

test('ทะเบียนปลายทางต้องครบ — lpa_audit_answers.question_id', () => {
  assert.deepEqual(LPA_QUESTION_REF_TABLES.map(t => [t[0], t[2]]), [['lpa_audit_answers', 'question_id']]);
});
