/**
 * vsmPrint — พิมพ์/บันทึก PDF ใบ VSM (A3 แนวนอน)
 *
 * pattern เดียวกับฟอร์มพิมพ์อื่น (LPA/OJT/MO/Scrap): window.open + print
 * เลขฟอร์ม/Rev/ช่องลายเซ็น/โลโก้/footer อ่านจากทะเบียนกลาง doc_key 'vsm'
 * — ห้าม hardcode (ดู CLAUDE.md · /doc-forms) · ทะเบียนยังไม่ตั้งเลขฟอร์ม = ไม่มีแถบเลขฟอร์ม
 *
 * ⚠️ ตัวผังไม่ได้วาดใหม่ที่นี่ — รับ `svgHtml` ที่ clone มาจาก <VsmCanvas> ตัวจริงบนจอ
 *    (กฎ CLAUDE.md: ห้ามจำลอง layout ใบจริงมาไว้ในตัวพิมพ์ จะกลายเป็น layout ชุดที่ 2 ที่ต้องตามแก้)
 */
import { getDocForm, fullCode, withDocFoot, sigAt, pageCss } from '../utils/docForms';
import { fmtMct, fmtMinSec } from './vsmModel';
import tsLogoUrl from '../assets/TS logo.png';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function urlToDataUrl(url) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise(resolve => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve('');
      fr.readAsDataURL(blob);
    });
  } catch { return ''; }
}

const STATE_LABEL = { current: 'Current state', future: 'Future state', ideal: 'Ideal state' };

export async function printVsm({ map, model, svgHtml, legendHtml, section = null }) {
  const df = await getDocForm('vsm', {
    title: 'แผนผังสายธารคุณค่า (Value Stream Map)',
    sig_blocks: ['Approved By', 'Checked By', 'Issued By'],
  }, section ? { section } : {});

  const logo = await urlToDataUrl(df.logo_url || tsLogoUrl);
  const code = fullCode(df);
  const h = model.header, I = model.info, T = model.totals;

  const stateBoxes = ['current', 'future', 'ideal']
    .map(s => `<span style="margin-right:16px">${map.state === s ? '☑' : '☐'} ${STATE_LABEL[s]}</span>`).join('');

  const sigs = [
    { ...sigAt(df, 0), val: map.approved_by },
    { ...sigAt(df, 1), val: map.checked_by },
    { ...sigAt(df, 2), val: map.issued_by },
  ];

  const field = (k, v) => `<div><span class="k">${esc(k)}</span><span class="v">${esc(v ?? '—')}</span></div>`;

  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<title>VSM ${esc(h.matNo)}</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;800&display=swap" rel="stylesheet">
<style>
  @page { size: ${pageCss(df, 'A3 landscape')}; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family:'Sarabun',sans-serif; color:#111827; margin:0; background:#fff; }
  .hd { display:flex; align-items:stretch; border:1.4px solid #374151; }
  .hd .logo { width:150px; display:flex; align-items:center; justify-content:center; border-right:1.2px solid #374151; padding:6px }
  .hd .logo img { max-width:100%; max-height:46px }
  .hd .mid { flex:1; padding:6px 12px; border-right:1.2px solid #374151 }
  .hd .mid h1 { margin:0; font-size:16px; font-weight:800 }
  .hd .mid .sub { font-size:11px; color:#4b5563; margin-top:2px }
  .hd .meta { width:290px; padding:6px 10px; font-size:10.5px }
  .hd .meta div { display:flex; justify-content:space-between; gap:8px; line-height:1.55 }
  .hd .meta .k { color:#4b5563 } .hd .meta .v { font-weight:700 }
  .states { font-size:11px; padding:5px 12px; border:1.2px solid #374151; border-top:none }
  .map { border:1.2px solid #374151; border-top:none; padding:4px }
  .map svg { width:100%; height:auto }
  .foot { display:flex; gap:8px; margin-top:6px; align-items:stretch }
  .legend { flex:1; border:1.2px solid #374151; padding:4px 6px }
  .legend .t { font-size:10px; font-weight:800; margin-bottom:2px }
  .sigs { display:flex; gap:8px }
  .sig { width:150px; border:1.2px solid #374151; padding:4px 6px; text-align:center; font-size:10px }
  .sig .lbl { color:#4b5563 } .sig .sp { height:38px } .sig .nm { border-top:1px dotted #6b7280; padding-top:2px; font-weight:600 }
  .note { font-size:9.5px; color:#6b7280; margin-top:4px }
  html, body { margin:0; padding:0 }
</style></head><body>
  <div id="sheet">
  <div class="hd">
    <div class="logo">${logo ? `<img src="${logo}" alt="">` : ''}</div>
    <div class="mid">
      <h1>${esc(df.title || 'แผนผังสายธารคุณค่า (Value Stream Map)')}</h1>
      <div class="sub">${esc(map.title || '')}</div>
      <div class="sub" style="margin-top:4px">
        <b>Part Name:</b> ${esc(h.partName)} &nbsp;·&nbsp;
        <b>Part No.:</b> ${esc(h.partNo || h.matNo)} &nbsp;·&nbsp;
        <b>Model:</b> ${esc(h.model || '—')} &nbsp;·&nbsp;
        <b>Customer:</b> ${esc(h.customer || '—')}
      </div>
    </div>
    <div class="meta">
      ${field('Working day', I.workingDays ? `${I.workingDays} วัน/เดือน` : '—')}
      ${field('Order', I.orderMonth ? `${I.orderMonth.toLocaleString('th-TH')} pcs/month` : '—')}
      ${field('Order', I.orderDay ? `${I.orderDay.toLocaleString('th-TH')} pcs/day` : '—')}
      ${field('A/T', I.atSec ? `${I.atSec.toLocaleString('th-TH')} sec` : '—')}
      ${field('T/T', I.ttSec ? `${I.ttSec.toLocaleString('th-TH')} sec` : '—')}
      ${field('Effective Date', map.effective_date)}
    </div>
  </div>
  <div class="states">${stateBoxes}
    <span style="float:right;color:#4b5563">ข้อมูล ${esc(map.period_from || '')} – ${esc(map.period_to || '')}</span>
  </div>
  <div class="map">${svgHtml}</div>
  <div class="foot">
    <div class="legend"><div class="t">สัญลักษณ์ (Symbols)</div>${legendHtml}</div>
    <div class="sigs">
      ${sigs.map(s => `<div class="sig">
        <div class="lbl">${esc(s.label)}</div><div class="sp"></div>
        <div class="nm">${esc(s.val || s.name || '')}</div></div>`).join('')}
    </div>
  </div>
  <div class="note">
    PLT = ${T.pltDays ?? '—'} วัน · PT = ${fmtMinSec(T.ptSec) ?? '—'} ·
    <b style="color:#dc2626">MCT = ${fmtMct(T.pltDays, T.ptSec) ?? '—'}</b> ·
    %VA = VA ÷ (VA + NVA) × 100 = ${T.vaPct == null ? '—' : T.vaPct + '%'}
    &nbsp;(NVA = PLT × A/T)
    ${code ? '' : ' · เอกสารนี้ยังไม่ได้ตั้งเลขฟอร์มในทะเบียน (/doc-forms)'}
  </div>
  </div>
<script>
  // บังคับจบใน 1 หน้า — zoom ลดกล่อง layout จริง (transform: scale ไม่ลด เบราว์เซอร์ยังนับหลายหน้า)
  (function () {
    function fit() {
      var el = document.getElementById('sheet');
      var maxH = 283 * (96 / 25.4);
      el.style.zoom = 1;
      var h = el.scrollHeight;
      if (h > maxH) el.style.zoom = Math.max(0.45, (maxH / h) * 0.995);
      window.focus(); window.print();
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ setTimeout(fit, 60); });
    else window.addEventListener('load', function(){ setTimeout(fit, 160); });
  })();
</script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(withDocFoot(html, 'vsm', section ? { section } : {}));
  w.document.close();
  return true;
}
