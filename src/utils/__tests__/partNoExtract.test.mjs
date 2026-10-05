/* ตัวถอด Part No. ออกจาก Object description ของ SAP — เทสกับสตริงจริงจากทะเบียน
   (คำขอ user 2026-10-05 · ตัวเลขที่วัดได้เขียนไว้หัวไฟล์ src/utils/partNoExtract.js) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learnPartNoVocab, extractPartNo, stripPartNo, proposePartNos, shapeOf } from '../partNoExtract.js';

/* เบอร์จริงจากทะเบียน (parts_master.part_no + dr_products.p_no) — ใช้ "เรียน" คำนำหน้า */
const SAMPLE_PART_NOS = [
  'MB3B-8A297-CB', 'MB3B 8A297 CB', 'MB3B-8226-AA', 'MB3B-8227-AA', 'MB3B 8226 AA',
  'MB3B-16C274-CE', 'MB3B-16C275-CD', 'MB3B-16A127-AA', 'MB3B 16A126 AB', 'MB3B-16E036-BA',
  'MB3B-E10564-AA', 'MB3B-E10565-AA', 'MB3B-E102D04-BC', 'MB3B-8B410-AA', 'MB3B-8B411-AA',
  'MB3B-8C347-CA', 'MB3B-16860-AA', 'MB3B-8B222-BE', 'MB3B-16E025-CC', 'MB3B-E108A26-AA',
  'RB3B-E111E50-AB', 'RB3B E111E50 AB', 'RB3B-8C306-BC', 'RB3B-16E024-AA', 'RB3B-E02446-BA',
  'RB3B-8B224-AA', 'RB3B-8B225-AA', 'RB3B-16E060-BA', 'RB3B-16088-AA', 'RB3B-8C347-AB',
  'N1WB-17A835-RA', 'N1WB-17B984-RB', 'N1WB-17B985-RB', 'N1WB-E16470-AB', 'N1WB-E16471-AB',
  'N1WB-E20022-AB', 'N1WB-E20023-AB', 'N1WB-E286F72-AC', 'N1WB-E286F73-AC', 'N1WB-17B756-RE',
  'N1WB-17E850-RPIA01', 'N1WB-17E850-RPIA05', 'N1WB17E850-R-PIA04', 'N1WB-17G799-BPIA01',
  'MB3C-4C193-A-PIA-01', 'MB3C-5F095-A-PIA-01', 'MB3C-9068-A-PIA-01', 'MB3C-5F096-X-PIA-01',
  'TB3C-5F097-X-PIA-01', 'TB3C-5F094-X-PIA-01', 'TB3C-5A154-X-PIA-01',
  'EB3B-41108A70-AA', 'EB3B41108A70AA', 'EB3B16A764AA',
  'W520781-S300', 'W520771-S300', 'W520772-S300', 'W715264-S', 'W520771', 'W716914-S300', 'W717477-S450B', 'W716051-S450B',
  'DA6V71435', 'DA6V54761', 'DA6T60542', 'DA6T60552', 'DA6T60A31',
  'R1WB-17K824-AAW', 'R1WB-17K825-AAW', 'SB3C-5F094-A-PIA-01', 'PB3C-5F094-X-PIA-01',
];
const VOCAB = learnPartNoVocab(SAMPLE_PART_NOS, { minSeen: 3 });

test('เรียนคำนำหน้าจากข้อมูลจริงได้ และไม่หยิบคำอังกฤษล้วนมาเป็นคำนำหน้า', () => {
  for (const p of ['MB3B', 'RB3B', 'N1WB', 'MB3C', 'TB3C']) {
    assert.ok(VOCAB.prefixes.has(p), `ควรเรียน ${p} ได้`);
  }
  // คำอังกฤษล้วน (ไม่มีตัวเลข) ห้ามกลายเป็นคำนำหน้า — เคยหลุดเพราะบางแถวกรอกสลับช่อง
  for (const bad of ['BRKT', 'REIN', 'MOUN', 'SUPT']) {
    assert.ok(!VOCAB.prefixes.has(bad), `${bad} ไม่ใช่คำนำหน้าเบอร์`);
  }
});

test('ถอดเบอร์ที่อยู่ในวงเล็บ — รูปแบบที่หน้างานใช้มากสุด', () => {
  const cases = [
    ['BRKT RAD SUPT UPR RH(MB3B8226AA)', 'MB3B8226AA'],
    ['PLT FRT S/M INR REINF RH(MB3BE10564AA)', 'MB3BE10564AA'],
    ['REINF RAD GRL OPG PNL RH (MB3B-8B410-AA)', 'MB3B-8B410-AA'],
    ['MOUNTING PLATE RH(N1WB-17B984-RB)', 'N1WB-17B984-RB'],
    ['BRKT RNG/BD RH (N1WB-E16470-AB)', 'N1WB-E16470-AB'],
    ['BRKT-DRIVE SHAFT(MB3C-4C193-A-PIA-01)BL', 'MB3C-4C193-A-PIA-01'],
  ];
  for (const [text, want] of cases) {
    const hit = extractPartNo(text, VOCAB);
    assert.ok(hit, `ควรถอดได้: ${text}`);
    assert.equal(hit.partNo, want, text);
  }
});

test('ถอดเบอร์ที่ต่อท้ายด้วยคำไทย (ก่อนชุบ/หลังชุบ/ก่อนแพ็ค)', () => {
  const cases = [
    ['REINF FRT BMPR-N1WB-17A835-RAก่อนชุบ', 'N1WB-17A835-RA'],
    ['BRKASY RR BMPR-N1WB-17E850-RPIA01หลังชุบ', 'N1WB-17E850-RPIA01'],
    ['REINF RAD SUPT LWR-MB3B-8B222-BEก่อนแพ็ค', 'MB3B-8B222-BE'],
    ['REINF MTNG LWR LH-MB3B-16E025-CCก่อนแพ็ค', 'MB3B-16E025-CC'],
  ];
  for (const [text, want] of cases) {
    assert.equal(extractPartNo(text, VOCAB)?.partNo, want, text);
  }
});

test('🔴 ห้ามจับเกินไปติดคำท้าย — ตัวตัดคือ "ขอบคำ" ไม่ใช่พจนานุกรมคำ', () => {
  const cases = [
    ['REINF FRT FNDR RH-SAPRE-MB3B-16C274-CE-SODECIA', 'MB3B-16C274-CE'],
    ['BRKT ENG ELETR GRD(MB3BE102D04BC)BLANK', 'MB3BE102D04BC'],
    ['PACK REINF TNL LWR-SA-RB3B-E111E50-AB', 'RB3B-E111E50-AB'],
    ['BRA FLR TNL-SA-RB3B-E111E50-AB-FMCSA', 'RB3B-E111E50-AB'],
  ];
  for (const [text, want] of cases) {
    assert.equal(extractPartNo(text, VOCAB)?.partNo, want, text);
  }
});

test('🔴 ชื่อที่ไม่มีเบอร์ ต้องคืน null — ห้ามเดาให้', () => {
  for (const text of [
    'BRKT HOD LAT SUPT',
    'PNL FRT FNDR INR TO RAD SUPT RH',
    'NUT WELD 10MM HF THDLS 10',
    'WSS-M1A367-A38 50G50G 2.00X(40X20)X695',   // สเปกวัตถุดิบ ไม่ใช่เบอร์พาร์ท
    'REINF ASY RAD SUPT LWR (FVL)',
    '',
  ]) {
    assert.equal(extractPartNo(text, VOCAB), null, `ต้องไม่เดา: ${text}`);
  }
});

test('ไม่มีคลังคำ (ทะเบียนว่าง) = ไม่เสนออะไรเลย ไม่ใช่เดามั่ว', () => {
  const empty = learnPartNoVocab([], { minSeen: 3 });
  assert.equal(extractPartNo('BRKT RAD SUPT UPR RH(MB3B8226AA)', empty), null);
  assert.equal(extractPartNo('x', null), null);
});

test('เบอร์ที่มีในทะเบียนอยู่แล้ว = ความมั่นใจสูง และบอกเหตุผลได้', () => {
  const hit = extractPartNo('SUPT ASY RAD(MB3B-8A297-CB)AAT', VOCAB);
  assert.equal(hit.partNo, 'MB3B-8A297-CB');
  assert.equal(hit.confidence, 'high');
  assert.match(hit.reason, /ทะเบียน/);
});

test('พาร์ทใหม่ที่ยังไม่เคยมีในทะเบียน ยังถอดได้ด้วยไวยากรณ์ (prefix+เลข+suffix)', () => {
  // เบอร์สมมติที่ไม่อยู่ใน SAMPLE เลย แต่คำนำหน้าเป็นของลูกค้ารายเดิม
  const hit = extractPartNo('BRKT TEST NEW RH(MB3B-19X777-ZZ)', VOCAB);
  assert.ok(hit, 'ไวยากรณ์ควรรับพาร์ทใหม่ได้');
  assert.equal(hit.partNo, 'MB3B-19X777-ZZ');
  assert.ok(!VOCAB.known.has('MB3B19X777ZZ'), 'เบอร์นี้ต้องไม่เคยอยู่ในทะเบียน');
});

test('ตัดเบอร์ออกแล้วเหลือชื่อล้วน · ทั้งบรรทัดเป็นเบอร์ = คืนข้อความเดิม', () => {
  const t1 = 'BRKT RAD SUPT UPR RH(MB3B8226AA)';
  assert.equal(stripPartNo(t1, extractPartNo(t1, VOCAB)), 'BRKT RAD SUPT UPR RH');
  const t2 = 'MB3B-8226-AA';
  assert.equal(stripPartNo(t2, extractPartNo(t2, VOCAB)), t2, 'ทั้งบรรทัดคือเบอร์ ห้ามคืนค่าว่าง');
  assert.equal(stripPartNo('ชื่ออะไรก็ได้', null), 'ชื่ออะไรก็ได้');
});

test('🔴 มีเบอร์เดิมอยู่แล้วแต่ไม่ตรง = conflict ห้ามนับเป็น "เสนอ" และห้ามทับเงียบ', () => {
  const rows = [
    { mat_no: '1', part_name: 'SUPT ASY RAD(MB3B-8A297-CB)', part_no: 'MB3B-8A297-BC' }, // ทะเบียนสลับ CB/BC
    { mat_no: '2', part_name: 'BRKT RAD SUPT UPR RH(MB3B8226AA)', part_no: '' },
    { mat_no: '3', part_name: 'BRKT HOD LAT SUPT', part_no: '' },
    { mat_no: '4', part_name: 'MOUNTING PLATE RH(N1WB-17B984-RB)', part_no: 'N1WB 17B984 RB' }, // เขียนคนละแบบ = ไม่ชน
  ];
  const r = proposePartNos(rows, VOCAB);
  assert.equal(r.conflict, 1, 'ต้องจับได้ 1 แถวที่ขัดกับทะเบียน');
  assert.equal(r.proposed, 2);
  assert.equal(r.skipped, 1);
  assert.equal(r.byMat.get('1').conflict, true);
  assert.equal(r.byMat.get('1').current, 'MB3B-8A297-BC', 'ต้องเก็บค่าเดิมไว้ให้คนเทียบ');
  assert.equal(r.byMat.get('4').conflict, false, 'ขีด/ช่องว่างต่างกัน = เบอร์เดียวกัน');
});

test('shapeOf แปลงทรงถูกต้อง (ใช้เทียบ "ทรงที่เคยเห็น")', () => {
  assert.equal(shapeOf('MB3B8A297CB'), 'AA9A9A999AA');
  assert.equal(shapeOf('W520781S300'), 'A999999A999');
});

test('🔴 เบอร์ต้องไม่กินคำอังกฤษท้ายชื่อมาเป็น suffix (เคสจริง 05/10)', () => {
  // `771S300N` + suffix `UT` เข้ารูปเดิมได้ ⇒ เคยอ่านเป็น "W520771-S300 NUT"
  // กฎ "ตัวก่อน suffix ต้องเป็นตัวเลข" ตัดทิ้ง
  const hit = extractPartNo('W520771-S300 NUT WELD M6 HF 10', VOCAB);
  assert.equal(hit?.partNo, 'W520771-S300');
});

test('🔴 ทะเบียนที่กรอกตกหล่น (W520771) ต้องไม่ชนะตัวเต็ม (W520771-S300)', () => {
  assert.ok(VOCAB.known.has('W520771'), 'เทสนี้ต้องมีตัวตกหล่นอยู่ในทะเบียนด้วย');
  assert.equal(extractPartNo('W520771-S300 NUT WELD M6 HF 10', VOCAB)?.partNo, 'W520771-S300');
});

test('เบอร์ตระกูลที่คำนำหน้ายังไม่ถึงเกณฑ์เรียน ยังจับได้ถ้ามีในทะเบียน', () => {
  // W715 เจอครั้งเดียว ⇒ ไม่ถูกเรียนเป็นคำนำหน้า แต่ `W715264-S` มีในทะเบียนตรงๆ
  assert.ok(!VOCAB.prefixes.has('W715'), 'W715 ต้องยังไม่ถูกเรียนเป็นคำนำหน้า');
  assert.equal(extractPartNo('TRIM PIN 7X2.7-6.9 PLA W715264-S', VOCAB)?.partNo, 'W715264-S');
});

test('ความมั่นใจแยก 2 ระดับอย่างซื่อสัตย์: ตรงทะเบียน = สูง · ถอดด้วยรูปแบบ = กลาง', () => {
  assert.equal(extractPartNo('BRKT RAD SUPT UPR RH(MB3B-8226-AA)', VOCAB).confidence, 'high');
  const neo = extractPartNo('BRKT TEST NEW RH(MB3B-19X777-ZZ)', VOCAB);
  assert.equal(neo.confidence, 'medium');
  assert.match(neo.reason, /ยังไม่มี/);
});
