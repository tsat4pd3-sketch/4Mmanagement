import { demandByDay, simulate, prodRate, advise, demandKeysOf, rowMatchesProduct, demandOf } from '../demandSupply.js';
let pass=0; const bad=[];
const ok=(n,g,w)=>{const a=JSON.stringify(g),b=JSON.stringify(w); a===b?pass++:bad.push(`${n}\n   got ${a}\n   want ${b}`)};

// ── ข้อมูลจริงของ 10100384 (order 17/8-1/9 · stock 6,119) ──
const orders=[['2026-08-17',900],['2026-08-18',200],['2026-08-19',920],['2026-08-20',870],['2026-08-21',400],
 ['2026-08-24',530],['2026-08-25',960],['2026-08-26',900],['2026-08-27',940],['2026-08-28',100],['2026-09-01',630]]
 .map(([due_date,qty])=>({due_date,qty}));
const D=demandByDay(orders,[]);
ok('order รวม 7,350', Object.values(D.byDay).reduce((a,v)=>a+v.order,0), 7350);
ok('hasOrder/hasForecast', [D.hasOrder,D.hasForecast], [true,false]);

// ผลิตจริงจากภาพหน้าจอ (18/8=500, 17/8=340, 14/8=380 …) — ในช่วง order มีแค่ 17-18/8
const prod={'2026-08-17':340,'2026-08-18':500,'2026-08-19':0};
const sim=simulate({from:'2026-08-17',to:'2026-09-01',prodByDay:prod,demByDay:D.byDay,openingStock:6119,today:'2026-08-19'});
ok('เดินครบทุกวัน ไม่ข้ามวัน', sim.days.length, 16);
ok('วันแรก stock = 6119+340-900', sim.days[0].stock, 5559);
ok('ปลายช่วง = 6119+840-7350', sim.endStock, 6119+840-7350);
// 6,119 + 840 ผลิต − 7,350 สั่ง = −391 → ขาดวันสุดท้ายจริง (ถ้าหยุดผลิตตั้งแต่วันนี้)
ok('ติดลบวันสุดท้าย', sim.firstShort, '2026-09-01');
const adv=advise(sim, prodRate(prod));
ok('สรุป: ต้องเร่ง', adv.key, 'short');
ok('ขาด 391 ชิ้น', adv.need, 391);
console.log('  →', adv.icon, adv.label, '·', adv.text);

// ── เคสของขาด ──
const s2=simulate({from:'2026-08-17',to:'2026-09-01',prodByDay:{},demByDay:D.byDay,openingStock:1000,today:'2026-08-19'});
const a2=advise(s2, 500);
ok('สต็อกน้อย = ต้องเร่ง', a2.key, 'short');
ok('firstShort ถูกวัน', s2.firstShort, '2026-08-18');
console.log('  →', a2.icon, a2.text);

// ── กฎข้อ 2: order ชนะ forecast ห้ามบวกทับ ──
const D3=demandByDay([{due_date:'2026-08-17',qty:900}],[{period_month:'2026-08-17',qty:4020}]);
ok('วันที่มีทั้งคู่ → ใช้ order เท่านั้น', demandOf(D3.byDay['2026-08-17']), 900);
ok('วันที่มีแต่ forecast → เกลี่ย 7 วัน', Math.round(demandOf(D3.byDay['2026-08-20'])), Math.round(4020/7));

// ── จับคู่เลขลูกค้า ──
const keys=demandKeysOf({mat_no:'10100384',p_no:'RB3B-16E060-BA'});
ok('เลข SAP ตรง', rowMatchesProduct({mat_no:'10100384'},keys), true);
ok('เลขลูกค้าเว้นวรรคต่างกันก็ตรง', rowMatchesProduct({mat_no:'RB3B 16E060 BA'},keys), true);
ok('customer_part_no ก็เทียบ', rowMatchesProduct({mat_no:'x',customer_part_no:'rb3b16e060ba'},keys), true);
ok('พาร์ทอื่นไม่ตรง', rowMatchesProduct({mat_no:'10100385'},keys), false);

// ── prodRate หารด้วยวันที่ผลิตจริง ไม่ใช่วันปฏิทิน ──
ok('อัตรา = 420 (ไม่ใช่ 280)', prodRate({'a':340,'b':500,'c':0}), 420);
ok('ไม่มีข้อมูล = null', prodRate({}), null);

console.log(bad.length?`\n❌\n  ${bad.join('\n  ')}\n\nผ่าน ${pass} ล้มเหลว ${bad.length}`:`\n✅ ผ่านทั้งหมด ${pass} เคส`);
