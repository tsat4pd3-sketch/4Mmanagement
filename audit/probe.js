// detector ที่นับเฉพาะ "ล้นจริงที่ตาเห็น" — ตัด 3 กรณีที่ไม่ใช่ล้น:
//  1) อยู่ใน <svg> (svg clip ลูกอยู่แล้ว)
//  2) มีบรรพบุรุษที่ overflow hidden/clip (โดนตัดไปแล้ว มองไม่เห็น)
//  3) มีบรรพบุรุษที่เลื่อนข้างเองได้ (มี scroller ของตัวเอง = ตั้งใจ)
export const PROBE = `(()=>{const VW=innerWidth
 const anc=(el,f)=>{let n=el.parentElement;while(n&&n!==document.documentElement){if(f(n,getComputedStyle(n)))return true;n=n.parentElement}return false}
 const scrollX=el=>anc(el,(n,s)=>(s.overflowX==='auto'||s.overflowX==='scroll')&&n.scrollWidth>n.clientWidth+1)
 // "ถูก clip แล้วไม่เห็น" นับว่าโอเค เฉพาะเมื่อคนตัดเป็นกล่องข้างใน (เช่น ellipsis)
 // ⚠️ ไม่นับ main/body/#root — พวกนั้นคือคนตัดของที่ "ล้นจอ" ซึ่งคือสิ่งที่เรากำลังตามหา
 const OUTER=new Set(['MAIN','BODY'])
 const clipped=el=>anc(el,(n,s)=>{ if(OUTER.has(n.tagName)||n.id==='root')return false
   if(!['hidden','clip'].includes(s.overflowX)&&!['hidden','clip'].includes(s.overflowY))return false
   return n.getBoundingClientRect().right <= VW+2 })
 const vis=el=>{const s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&el.getBoundingClientRect().width>0}
 const bad=[...document.querySelectorAll('body *')].filter(el=>vis(el)&&!el.closest('svg')
   &&el.getBoundingClientRect().right>VW+2&&!scrollX(el)&&!clipped(el))
 const st=new Set(bad)
 return bad.filter(el=>!st.has(el.parentElement)).slice(0,3).map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el)
  return \`\${el.tagName}\${typeof el.className==='string'&&el.className?'.'+el.className.split(' ')[0]:''} r=\${Math.round(r.right)} w=\${Math.round(r.width)} minW=\${s.minWidth} "\${(el.textContent||'').trim().slice(0,30)}"\`})})()`
