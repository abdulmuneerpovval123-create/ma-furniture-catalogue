/* M A FURNITURE - customer catalogue
   Everything on this page comes from data/catalog.json, which the /admin panel edits. */
(function(){
"use strict";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const inr=n=>"₹"+Number(n).toLocaleString("en-IN",{maximumFractionDigits:0});
let DATA=null, S={}, CATS=[], PRODS=[];
const FILTER={};                       // category id -> selected subgroup id ("" = all)

/* ---------- links ---------- */
function siteBase(){
  if(S.siteUrl) return S.siteUrl.replace(/\/?$/,"/");
  return location.origin+location.pathname.replace(/[^/]*$/,"");
}
const abs=p=>{ try{ return new URL(p,siteBase()).href }catch(e){ return p } };
const productUrl=p=>siteBase()+"#"+p.code;
const waLink=text=>`https://wa.me/${String(S.whatsapp||"").replace(/\D/g,"")}?text=${encodeURIComponent(text)}`;
const catOf=p=>CATS.find(c=>c.id===p.category)||{name:"",subgroups:[]};
const subOf=p=>(catOf(p).subgroups||[]).find(g=>g.id===p.subgroup)||{name:""};

/* ---------- placeholder art for products without photos ---------- */
const SKETCH={
  wardrobe3:'<svg viewBox="0 0 120 140" fill="none" stroke="currentColor" stroke-width="2"><rect x="10" y="8" width="100" height="124" rx="2"/><path d="M43 8v124M77 8v124"/><path d="M38 64v14M48 64v14M72 64v14"/><path d="M10 132h100M16 132v5M104 132v5"/></svg>',
  wardrobe4:'<svg viewBox="0 0 140 150" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="8" width="124" height="24" rx="2"/><path d="M39 8v24M70 8v24M101 8v24"/><rect x="8" y="34" width="124" height="108" rx="2"/><path d="M39 34v108M70 34v108M101 34v108"/><path d="M34 80v14M44 80v14M65 80v14M75 80v14M96 80v14M106 80v14"/></svg>',
  bed:'<svg viewBox="0 0 160 110" fill="none" stroke="currentColor" stroke-width="2"><rect x="18" y="10" width="124" height="50" rx="4"/><path d="M30 22h100M30 34h100M30 46h100"/><rect x="10" y="60" width="140" height="30" rx="3"/><path d="M14 70h132"/><rect x="34" y="50" width="38" height="12" rx="5"/><rect x="88" y="50" width="38" height="12" rx="5"/><path d="M16 90v8M144 90v8"/></svg>',
  desk2:'<svg viewBox="0 0 150 110" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 30h134"/><rect x="100" y="30" width="36" height="70"/><path d="M100 54h36M100 78h36M113 42h10M113 66h10"/><path d="M14 30v70M14 70h86"/></svg>',
  chair:'<svg viewBox="0 0 140 130" fill="none" stroke="currentColor" stroke-width="2"><path d="M34 14c0-4 3-6 6-6h60c3 0 6 2 6 6v56H34z"/><path d="M42 20h56M42 32h56M42 44h56M42 56h56"/><path d="M20 62h100v16H20z"/><path d="M16 62V48c0-4 4-6 8-6h10M124 62V48c0-4-4-6-8-6h-10"/><path d="M26 78l-6 44M114 78l6 44M46 78l-2 44M94 78l2 44"/></svg>',
  sofa:'<svg viewBox="0 0 160 100" fill="none" stroke="currentColor" stroke-width="2"><path d="M24 50V24c0-6 4-10 10-10h92c6 0 10 4 10 10v26"/><rect x="8" y="44" width="22" height="38" rx="6"/><rect x="130" y="44" width="22" height="38" rx="6"/><path d="M30 60h100v22H30z"/><path d="M80 60v22M16 82v8M144 82v8"/></svg>'
};
const sketchFor=p=>SKETCH[p.sketch]||(/wardrobe/.test(p.category)?SKETCH.wardrobe3:/bed/.test(p.category)?SKETCH.bed:/study|desk/.test(p.category)?SKETCH.desk2:/outdoor|chair/.test(p.category)?SKETCH.chair:SKETCH.sofa);
function media(p,idx=0,lazy=true){
  const src=(p.images||[])[idx];
  if(src) return `<img src="${esc(src)}" alt="${esc(p.name)}${p.material?", "+esc(p.material):""}" ${lazy?'loading="lazy"':""} decoding="async" style="object-position:${esc(p.imagePos||"50% 55%")}">`;
  return `<div class="sketch" style="position:absolute;inset:0">${sketchFor(p)}<span class="soon">Photos coming soon</span></div>`;
}
const hasPrice=p=>p.showPrice&&p.price!=null&&p.price!=="";

/* ---------- enquiry bag (kept on this device only) ---------- */
let BAG=[];
try{ BAG=JSON.parse(localStorage.getItem("maf-bag")||"[]") }catch(e){ BAG=[] }
const saveBag=()=>{ try{ localStorage.setItem("maf-bag",JSON.stringify(BAG)) }catch(e){} };
const inBag=code=>BAG.find(b=>b.code===code);
const maxBag=()=>Math.max(1,Number(S.maxEnquiry)||4);
function defaultOpts(p){ const o={}; (p.options||[]).forEach(x=>{ if(x.values&&x.values.length) o[x.name]=x.values[0] }); return o }
function addToBag(code,opts){
  const p=PRODS.find(x=>x.code===code); if(!p) return false;
  const ex=inBag(code);
  if(ex){ ex.opts=opts||ex.opts; saveBag(); syncBag(); toast("Updated in your enquiry"); return true }
  if(BAG.length>=maxBag()){ toast(`You can enquire about up to ${maxBag()} designs at a time`); openBag(); return false }
  BAG.push({code,opts:opts||defaultOpts(p)}); saveBag(); syncBag(); toast(`Added ${p.name} to your enquiry`); return true;
}
function removeFromBag(code){ BAG=BAG.filter(b=>b.code!==code); saveBag(); syncBag(); }
function syncBag(){
  BAG=BAG.filter(b=>PRODS.some(p=>p.code===b.code));
  const n=BAG.length;
  $("#bagCount").textContent=n; $("#bagFabCount").textContent=n; $("#bagFab").hidden=n===0;
  $$("[data-bag]").forEach(b=>{ const on=!!inBag(b.dataset.bag); b.setAttribute("aria-pressed",on);
    if(b.classList.contains("save")){ b.innerHTML=on?ICON_BAG_ON:ICON_BAG; b.setAttribute("aria-label",(on?"Remove from":"Add to")+" enquiry") }
    else b.textContent=on?"In your enquiry ✓":"Add to enquiry"; });
  $("#picked").innerHTML=BAG.map(b=>{ const p=PRODS.find(x=>x.code===b.code); return `<span class="pill">${esc(p.name)}<button type="button" data-unbag="${esc(b.code)}" aria-label="Remove ${esc(p.name)}">×</button></span>` }).join("");
  if($("#bagDlg").open) renderBag();
}
const ICON_BAG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/><path d="M12 11v6M9 14h6"/></svg>';
const ICON_BAG_ON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M6 8h12l-1 12H7L6 8z" fill="currentColor" fill-opacity=".18"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/><path d="M9 14l2 2 4-4"/></svg>';

/* ---------- WhatsApp message ---------- */
function itemBlock(p,opts,i,total){
  const L=[];
  L.push(`*${total>1?(i+1)+". ":""}${p.code} · ${p.name}*`);
  if(p.images&&p.images[0]) L.push(`Photo: ${abs(p.images[0])}`);
  const c=catOf(p), g=subOf(p);
  L.push(`Category: ${c.name}${g.name?" › "+g.name:""}`);
  if(p.material) L.push(`Material: ${p.material}`);
  if(p.summary) L.push(`Size / seating: ${p.summary}`);
  const specs=(p.specs||[]).filter(r=>r&&r[0]&&r[1]&&!/^(Upholstery|Seating|Finish)$/i.test(r[0])).slice(0,10);
  if(specs.length){ L.push("Specifications:"); specs.forEach(([k,v])=>L.push(`  • ${k}: ${v}`)) }
  const o=Object.entries(opts||{}).filter(([,v])=>v);
  if(o.length) L.push(`Selected options: ${o.map(([k,v])=>`${k} – ${v}`).join("; ")}`);
  if(hasPrice(p)) L.push(`Listed price: ${inr(p.price)}`);
  L.push(`Details: ${productUrl(p)}`);
  return L.join("\n");
}
function enquiryText(items,customer){
  const list=items.map(it=>({p:PRODS.find(x=>x.code===it.code),opts:it.opts})).filter(x=>x.p);
  const head=`Hello ${S.brand||"M A FURNITURE"},\n`+(list.length>1?`I'd like to enquire about these ${list.length} products from your catalogue:`:`I'd like to enquire about this product from your catalogue:`);
  const blocks=list.map((x,i)=>itemBlock(x.p,x.opts,i,list.length));
  const cust=[];
  if(customer){ if(customer.name) cust.push(`Name: ${customer.name}`); if(customer.phone) cust.push(`Phone: ${customer.phone}`); if(customer.city) cust.push(`City / area: ${customer.city}`); if(customer.msg) cust.push(`Message: ${customer.msg}`) }
  return [head,"",blocks.join("\n\n"),cust.length?"\n"+cust.join("\n"):"","","Please share the price, sizes and availability."].join("\n").replace(/\n{3,}/g,"\n\n");
}

/* ---------- rendering ---------- */
function card(p){
  const on=!!inBag(p.code);
  const tags=(p.render?["Design render",...(p.tags||[])]:(p.tags||[]));
  return `<article class="card" data-code="${esc(p.code)}">
    <button class="media" data-open="${esc(p.code)}" aria-label="View details of ${esc(p.name)}">${media(p)}
      <span class="tags">${tags.map(t=>`<span class="tag ${t==="Design render"?"render":/^(Signature|Bestseller|Sofa cum bed|New)$/i.test(t)?"gold":""}">${esc(t)}</span>`).join("")}</span>
      ${hasPrice(p)?`<span class="swing"><span><small>Price</small>${inr(p.price)}</span></span>`:""}</button>
    <div class="body">
      <div class="meta"><code>${esc(p.code)}</code><span>${esc(p.summary||"")}</span></div>
      <h4>${esc(p.name)}</h4>
      <p>${esc(p.description||"")}</p>
      ${(p.keys||[]).length?`<ul class="keys">${p.keys.map(k=>`<li>${esc(k)}</li>`).join("")}</ul>`:""}
      <div class="actions">
        <button class="btn" data-open="${esc(p.code)}">View details</button>
        <a class="btn btn-wa" target="_blank" rel="noopener" href="${waLink(enquiryText([{code:p.code,opts:defaultOpts(p)}]))}">Enquire</a>
        <button class="btn save bag-add" type="button" data-bag="${esc(p.code)}" aria-pressed="${on}" aria-label="${on?"Remove from":"Add to"} enquiry">${on?ICON_BAG_ON:ICON_BAG}</button>
      </div>
    </div></article>`;
}
function catProducts(c){ return PRODS.filter(p=>p.category===c.id) }
function renderCatalogue(){
  const out=CATS.map(c=>{
    const items=catProducts(c); if(!items.length) return "";
    const subs=(c.subgroups||[]).map(g=>({...g,items:items.filter(p=>p.subgroup===g.id)})).filter(g=>g.items.length);
    const loose=items.filter(p=>!subs.some(g=>g.id===p.subgroup));
    if(loose.length) subs.push({id:"_other",name:"More designs",items:loose});
    const f=FILTER[c.id]||"";
    const shown=f?subs.filter(g=>g.id===f):subs;
    return `<section class="room" id="${esc(c.id)}"><div class="wrap">
      <div class="room-head"><div><div class="eyebrow">${esc(c.name)} · ${items.length} ${items.length===1?"design":"designs"}</div><h2>${esc(c.title||c.name)}</h2></div><p>${esc(c.intro||"")}</p></div>
      ${subs.length>1?`<div class="subfilter" role="group" aria-label="Filter ${esc(c.name)}">
        <button type="button" data-filter="${esc(c.id)}" data-sub="" aria-pressed="${!f}">All <small>${items.length}</small></button>
        ${subs.map(g=>`<button type="button" data-filter="${esc(c.id)}" data-sub="${esc(g.id)}" aria-pressed="${f===g.id}">${esc(g.name)} <small>${g.items.length}</small></button>`).join("")}</div>`:""}
      ${shown.map(g=>`${subs.length>1?`<div class="sub"><h3>${esc(g.name)}</h3></div>`:""}<div class="grid">${g.items.map(card).join("")}</div>`).join("")}
      ${items.some(p=>!(p.images||[]).length)?`<p class="note">Designs marked “Photos coming soon” are being photographed. Ask on WhatsApp for current photos.</p>`:""}
    </div></section>`;
  }).join("");
  $("#catalogue").innerHTML=out||`<div class="wrap loading">New designs are being added. Please check back soon.</div>`;
  const live=CATS.filter(c=>catProducts(c).length);
  $("#rail").innerHTML=live.map(c=>`<a class="chip" href="#${esc(c.id)}">${esc(c.name)} <small>${catProducts(c).length}</small></a>`).join("")+`<a class="chip" href="#contact">Contact</a>`;
  $("#nav").innerHTML=live.map(c=>`<a href="#${esc(c.id)}">${esc(c.name)}</a>`).join("")+`<a href="#contact">Contact</a>`;
  $("#factCount").textContent=PRODS.filter(p=>(p.images||[]).length).length;
  if(live[0]) $("#browseBtn").href="#"+live[0].id;
  syncBag(); spy();
}
function renderShell(){
  const set=(id,v)=>{ const el=document.getElementById(id); if(el&&v!=null) el.textContent=v };
  set("brandName",S.brand); set("brandSub",S.subtitle); set("tagline",S.tagline); set("heroTitle",S.heroTitle); set("heroAccent",S.heroAccent); set("heroText",S.heroText);
  set("subLine",(S.subtitle||"").replace(/,\s*/g," · ").replace(/\s*&\s*/g," · ")); set("phoneTxt",S.phoneDisplay); set("addrTxt",S.address); set("hoursTxt",S.hours);
  set("footBrand",S.brand); set("footSub",S.subtitle); set("yr",new Date().getFullYear());
  document.title=(S.brand?S.brand.replace(/\b(\w)(\w*)/g,(m,a,b)=>a+b.toLowerCase()):"Furniture")+" Catalogue";
  const general=waLink(`Hello ${S.brand||""}, I saw your catalogue and would like to know more.`);
  ["#topWa","#fab"].forEach(s=>$(s).href=general); $$(".heroWa").forEach(a=>a.href=general);
  const heroImgs=(S.heroImages&&S.heroImages.length?S.heroImages:PRODS.filter(p=>(p.images||[]).length).slice(0,3).map(p=>p.images[0])).slice(0,3);
  const first=PRODS.find(p=>(p.images||[])[0]===heroImgs[0]);
  $("#heroArt").innerHTML=heroImgs.map((src,i)=>`<figure><img src="${esc(src)}" alt="" ${i?'loading="lazy"':'fetchpriority="high"'} decoding="async" style="object-position:50% 58%">${i===0&&first?`<figcaption class="plate"><b>${esc(first.name)}</b><code>${esc(first.code)}</code></figcaption>`:""}</figure>`).join("");
}

/* ---------- product dialog ---------- */
const dlg=$("#dlg"), bagDlg=$("#bagDlg");
[dlg,bagDlg].forEach(d=>{
  if(typeof d.showModal!=="function"){ /* older iOS / Android browsers */
    d.showModal=function(){this.setAttribute("open","");this.classList.add("dlg-fallback");document.documentElement.style.overflow="hidden";this.scrollTop=0};
    d.close=function(){this.removeAttribute("open");this.classList.remove("dlg-fallback");document.documentElement.style.overflow=""};
    Object.defineProperty(d,"open",{get(){return this.hasAttribute("open")}});
  }
  d.addEventListener("click",e=>{ if(e.target===d) d.close() });
});
$("#dClose").onclick=()=>dlg.close(); $("#bagClose").onclick=()=>bagDlg.close();
let CUR=null;
function openP(code,presetOpts){
  const p=PRODS.find(x=>x.code===code); if(!p) return; CUR=p;
  const sel=presetOpts||(inBag(code)||{}).opts||defaultOpts(p);
  const c=catOf(p), g=subOf(p);
  const notes=[p.styled?"Shown in a digitally styled room setting. The design is ours; colour and fabric can be changed.":"",p.render?"Image is a design render of this model. The finished piece is made to the same design in your chosen finish.":""].filter(Boolean);
  $("#dBody").innerHTML=`<div class="pic">${media(p,0,false)}${(p.images||[]).length>1?`<div class="thumbs">${p.images.map((src,i)=>`<button type="button" data-thumb="${i}" aria-label="Photo ${i+1}" aria-pressed="${i===0}"><img src="${esc(src)}" alt=""></button>`).join("")}</div>`:""}</div>
   <div class="info">
     <div class="meta"><code>${esc(p.code)}</code><span>${esc(c.name)}${g.name?" · "+esc(g.name):""}</span></div>
     <h3 id="dTitle">${esc(p.name)}</h3>
     ${hasPrice(p)?`<div class="pricetag"><small>Price</small>${inr(p.price)}</div>`:""}
     <p>${esc(p.description||"")}</p>
     ${(p.features||[]).length?`<ul class="feat">${p.features.map(f=>`<li>${esc(f)}</li>`).join("")}</ul>`:""}
     ${(p.options||[]).filter(o=>o.values&&o.values.length).length?`<div class="opts" id="opts"><h4>Choose your options</h4>${p.options.filter(o=>o.values&&o.values.length).map((o,i)=>`<label for="opt-${i}">${esc(o.name)}<select id="opt-${i}" data-optname="${esc(o.name)}">${o.values.map(v=>`<option${sel[o.name]===v?" selected":""}>${esc(v)}</option>`).join("")}</select></label>`).join("")}</div>`:""}
     ${(p.specs||[]).length?`<div class="specs"><table><caption>Specifications</caption><tbody>${p.specs.map(([k,v])=>`<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table></div>`:""}
     ${notes.map(n=>`<p class="sample">${esc(n)}</p>`).join("")}<p class="sample">Specifications are for reference. Exact materials, sizes and finishes are confirmed at the time of order.</p>
     <div class="actions" style="flex-wrap:wrap">
       <a class="btn btn-wa" id="dWa" target="_blank" rel="noopener">Enquire on WhatsApp</a>
       <button class="btn" type="button" id="dBag" data-bagmodal="${esc(p.code)}">${inBag(p.code)?"Update enquiry":"Add to enquiry"}</button>
     </div>
   </div>`;
  updateDialogWa();
  if(!dlg.open) dlg.showModal();
  try{ history.replaceState(null,"","#"+p.code) }catch(e){}
}
function dialogOpts(){ const o={}; $$("#opts select").forEach(s=>o[s.dataset.optname]=s.value); return o }
function updateDialogWa(){ if(CUR&&$("#dWa")) $("#dWa").href=waLink(enquiryText([{code:CUR.code,opts:dialogOpts()}])) }
dlg.addEventListener("close",()=>{ if(/^#MAF-/i.test(location.hash)){ try{ history.replaceState(null,"",location.pathname+location.search) }catch(e){} } });

/* ---------- enquiry dialog ---------- */
function openBag(){ renderBag(); if(!bagDlg.open) bagDlg.showModal() }
function renderBag(){
  const items=BAG.map(b=>({b,p:PRODS.find(x=>x.code===b.code)})).filter(x=>x.p);
  const f=JSON.parse(sessionStorage.getItem("maf-cust")||"{}");
  $("#bagBody").innerHTML=`<div><div class="eyebrow">Your enquiry</div><h3 id="bagTitle">${items.length?`${items.length} design${items.length>1?"s":""} selected`:"No designs yet"}</h3></div>
    <p class="lim">Add up to ${maxBag()} designs and send them to us in one WhatsApp message.</p>
    ${items.length?`<ul class="bag-list">${items.map(({b,p})=>`<li class="bag-item"><div class="th">${(p.images||[])[0]?`<img src="${esc(p.images[0])}" alt="">`:""}</div>
      <div><code>${esc(p.code)}</code><b>${esc(p.name)}</b><p>${Object.entries(b.opts||{}).map(([k,v])=>`${esc(k)}: ${esc(v)}`).join(" · ")||"As shown"}</p><button class="ch" type="button" data-open="${esc(p.code)}">Change options</button></div>
      <button class="rm" type="button" data-unbag="${esc(p.code)}" aria-label="Remove ${esc(p.name)}">×</button></li>`).join("")}</ul>`
      :`<div class="bag-empty">Tap the bag icon on any design to add it here.</div>`}
    ${items.length?`<div class="bag-fields">
      <div class="row2"><label for="b-name">Your name <span class="opt">(optional)</span><input id="b-name" value="${esc(f.name||"")}" autocomplete="name"></label>
      <label for="b-city">City / area <span class="opt">(optional)</span><input id="b-city" value="${esc(f.city||"")}" autocomplete="address-level2"></label></div>
      <label for="b-msg">Message <span class="opt">(optional)</span><textarea id="b-msg" placeholder="Room size, colours you like, budget…">${esc(f.msg||"")}</textarea></label></div>
    <div class="actions"><a class="btn btn-wa" id="bagSend" target="_blank" rel="noopener">Send enquiry on WhatsApp</a><button class="btn" type="button" id="bagClear">Clear list</button></div>`:""}`;
  updateBagWa();
}
function bagCustomer(){ const g=id=>($(id)||{}).value||""; return {name:g("#b-name").trim(),city:g("#b-city").trim(),msg:g("#b-msg").trim()} }
function updateBagWa(){ const a=$("#bagSend"); if(!a) return; const c=bagCustomer(); try{ sessionStorage.setItem("maf-cust",JSON.stringify(c)) }catch(e){} a.href=waLink(enquiryText(BAG,c)) }

/* ---------- events ---------- */
let tt; function toast(m){ const t=$("#toast"); t.textContent=m; t.classList.add("show"); clearTimeout(tt); tt=setTimeout(()=>t.classList.remove("show"),2000) }
function copy(text,btn){
  const done=()=>{ const o=btn.textContent; btn.textContent="Copied"; setTimeout(()=>btn.textContent=o,1400) };
  try{ navigator.clipboard.writeText(text).then(done,()=>toast("Select the number and copy it")) }catch(e){ toast("Select the number and copy it") }
}
document.addEventListener("click",e=>{
  const t=e.target;
  const f=t.closest("[data-filter]"); if(f){ FILTER[f.dataset.filter]=f.dataset.sub; renderCatalogue(); const sec=document.getElementById(f.dataset.filter); if(sec&&sec.getBoundingClientRect().top<0) sec.scrollIntoView({block:"start"}); try{ history.replaceState(null,"","#"+f.dataset.filter+(f.dataset.sub?"/"+f.dataset.sub:"")) }catch(_){ } return }
  const o=t.closest("[data-open]"); if(o){ if(bagDlg.open&&o.closest("#bagDlg")) bagDlg.close(); openP(o.dataset.open); return }
  const bm=t.closest("[data-bagmodal]"); if(bm){ if(addToBag(bm.dataset.bagmodal,dialogOpts())) bm.textContent="Update enquiry"; return }
  const b=t.closest("[data-bag]"); if(b){ inBag(b.dataset.bag)?removeFromBag(b.dataset.bag):addToBag(b.dataset.bag); return }
  const u=t.closest("[data-unbag]"); if(u){ removeFromBag(u.dataset.unbag); return }
  const th=t.closest("[data-thumb]"); if(th&&CUR){ const im=$("#dBody .pic > img"); if(im) im.src=CUR.images[+th.dataset.thumb]; $$("[data-thumb]").forEach(x=>x.setAttribute("aria-pressed",x===th)); return }
  if(t.closest("#bagBtn")||t.closest("#bagFab")){ openBag(); return }
  if(t.closest("#bagClear")){ BAG=[]; saveBag(); syncBag(); renderBag(); return }
  if(t.closest("#copyPhone")){ copy(S.phoneDisplay||"",t.closest("#copyPhone")); return }
});
document.addEventListener("change",e=>{ if(e.target.closest("#opts")) updateDialogWa() });
document.addEventListener("input",e=>{ if(e.target.closest(".bag-fields")) updateBagWa() });
$("#inq").addEventListener("submit",e=>{
  e.preventDefault();
  const f=e.target.elements, name=f.cname.value.trim(), phone=f.cphone.value.trim(), err=$("#err"); err.hidden=true;
  if(!name){ err.textContent="Please add your name so we know who to reply to."; err.hidden=false; f.cname.focus(); return }
  if(phone.replace(/\D/g,"").length<10){ err.textContent="Please enter a 10-digit phone number."; err.hidden=false; f.cphone.focus(); return }
  const cust={name,phone,city:f.ccity.value.trim(),msg:f.cmsg.value.trim()};
  const text=BAG.length?enquiryText(BAG,cust):`Hello ${S.brand},\n\nName: ${cust.name}\nPhone: ${cust.phone}${cust.city?"\nCity / area: "+cust.city:""}${cust.msg?"\nMessage: "+cust.msg:""}\n\nPlease share your designs and prices.`;
  window.open(waLink(text),"_blank","noopener");
});
$("#menuBtn").onclick=()=>{ const n=$("#nav"); const o=n.classList.toggle("open"); $("#menuBtn").setAttribute("aria-expanded",o) };
$("#nav").addEventListener("click",e=>{ if(e.target.tagName==="A"){ $("#nav").classList.remove("open"); $("#menuBtn").setAttribute("aria-expanded","false") } });

let io=null;
function spy(){
  if(io) io.disconnect(); if(!("IntersectionObserver" in window)) return;
  io=new IntersectionObserver(es=>es.forEach(en=>{ if(!en.isIntersecting) return; const id=en.target.id;
    $$(".nav a,.chip").forEach(a=>a.classList.toggle("on",a.getAttribute("href")==="#"+id));
    const chip=document.querySelector(`.chip[href="#${CSS.escape(id)}"]`), rail=$("#rail"); if(chip&&rail) rail.scrollTo({left:chip.offsetLeft-rail.clientWidth/2+chip.clientWidth/2,behavior:"smooth"});
  }),{rootMargin:"-45% 0px -50% 0px"});
  [...CATS.map(c=>c.id),"contact"].forEach(id=>{ const el=document.getElementById(id); if(el) io.observe(el) });
}

/* #living-room   #bedroom-sets/4-door   #MAF-LR-01 */
const LEGACY={living:"living-room",bedroom:"bedroom-sets"};
function fromHash(){
  let h=decodeURIComponent(location.hash.slice(1)); if(!h) return;
  if(/^MAF-/i.test(h)){ const p=PRODS.find(x=>x.code.toUpperCase()===h.toUpperCase()); if(p) openP(p.code); return }
  let [cid,sub]=h.split("/"); cid=LEGACY[cid]||cid;
  const c=CATS.find(x=>x.id===cid);
  if(c){ if(sub!==undefined&&(c.subgroups||[]).some(g=>g.id===sub)){ FILTER[c.id]=sub; renderCatalogue() }
    const el=document.getElementById(c.id); if(el) requestAnimationFrame(()=>{ el.scrollIntoView({block:"start"}); el.classList.add("arrived"); setTimeout(()=>el.classList.remove("arrived"),2200) }); return }
  const el=document.getElementById(h); if(el) el.scrollIntoView({block:"start"});
}
window.addEventListener("hashchange",fromHash);

/* ---------- load ---------- */
async function load(){
  try{
    const r=await fetch("data/catalog.json?v="+Date.now(),{cache:"no-store"});
    if(!r.ok) throw new Error("HTTP "+r.status);
    DATA=await r.json();
  }catch(e){
    $("#catalogue").innerHTML=`<div class="wrap" style="padding-block:60px"><div class="loaderr"><h3>The catalogue didn't load</h3><p>Please check your connection and refresh the page. You can also message us on WhatsApp${S.phoneDisplay?": "+esc(S.phoneDisplay):""}.</p></div></div>`;
    console.error("Catalogue data failed to load",e); return;
  }
  S=DATA.settings||{};
  CATS=(DATA.categories||[]).slice();
  PRODS=(DATA.products||[]).filter(p=>p.active!==false).sort((a,b)=>(a.order||0)-(b.order||0));
  try{ renderShell() }catch(e){ console.error(e) }
  try{ renderCatalogue() }catch(e){ console.error(e) }
  fromHash();
}
load();
})();
