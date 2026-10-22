/* M A FURNITURE - catalogue admin
   How it is secured:
   - Saving uses a GitHub access token that can only write to this one repository.
   - The token is stored in config/admin.enc.json, encrypted with your admin password
     (PBKDF2-SHA256, 600,000 rounds -> AES-256-GCM). Without the password it is unreadable.
   - Costs, vendors and hidden prices are stored in data/private.enc.json, encrypted the same way.
   - The password and token are only held in this tab's memory and are forgotten when you lock or close it. */
(function(){
"use strict";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const inr=n=>(n==null||n==="")?"—":"₹"+Number(n).toLocaleString("en-IN",{maximumFractionDigits:0});
const slug=s=>String(s||"").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g,"").trim().replace(/[\s_]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"");
const ITER=600000, CONFIG_PATH="config/admin.enc.json", CATALOG_PATH="data/catalog.json", PRIVATE_PATH="data/private.enc.json";
const app=$("#app");
let tt; function toast(m,ms=2600){ const t=$("#toast"); t.textContent=m; t.classList.add("show"); clearTimeout(tt); tt=setTimeout(()=>t.classList.remove("show"),ms) }
function busy(msg){ let b=$(".busy"); if(!msg){ if(b) b.remove(); return } if(!b){ b=document.createElement("div"); b.className="busy"; b.setAttribute("role","alert"); document.body.appendChild(b) } b.innerHTML=`<div>${esc(msg)}</div>` }

/* ---------- bytes / base64 ---------- */
const enc=new TextEncoder(), dec=new TextDecoder();
function bytesToB64(bytes){ let s=""; for(let i=0;i<bytes.length;i+=0x8000) s+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000)); return btoa(s) }
function b64ToBytes(b64){ const s=atob(b64.replace(/\s/g,"")); const a=new Uint8Array(s.length); for(let i=0;i<s.length;i++) a[i]=s.charCodeAt(i); return a }
const strToB64=str=>bytesToB64(enc.encode(str));
const b64ToStr=b64=>dec.decode(b64ToBytes(b64));

/* ---------- encryption ---------- */
async function deriveKey(password,salt,iter){
  const base=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",hash:"SHA-256",salt,iterations:iter},base,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
async function encryptJSON(obj,password){
  const salt=crypto.getRandomValues(new Uint8Array(16)), iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await deriveKey(password,salt,ITER);
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,enc.encode(JSON.stringify(obj))));
  return {v:1,kdf:"PBKDF2-SHA256",iter:ITER,cipher:"AES-256-GCM",salt:bytesToB64(salt),iv:bytesToB64(iv),ct:bytesToB64(ct)};
}
async function decryptJSON(env,password){
  const key=await deriveKey(password,b64ToBytes(env.salt),env.iter||ITER);
  const pt=await crypto.subtle.decrypt({name:"AES-GCM",iv:b64ToBytes(env.iv)},key,b64ToBytes(env.ct));
  return JSON.parse(dec.decode(pt));
}

/* ---------- session (memory only) ---------- */
const SES={token:"",owner:"",repo:"",branch:"main",password:""};
let CAT=null, PRIV={}, VIEW="products", EDIT=null, PENDING=[], REMOVED=[], DIRTY=false;
let idleTimer; function bumpIdle(){ clearTimeout(idleTimer); idleTimer=setTimeout(()=>{ if(SES.token){ lock(); toast("Locked after 30 minutes without activity",4000) } },30*60*1000) }
["click","keydown","input"].forEach(ev=>document.addEventListener(ev,bumpIdle,{passive:true}));
function lock(){ SES.token=""; SES.password=""; CAT=null; PRIV={}; EDIT=null; PENDING=[]; showLogin() }
window.addEventListener("beforeunload",e=>{ if(DIRTY){ e.preventDefault(); e.returnValue="" } });

/* ---------- GitHub contents API ---------- */
async function gh(method,path,body){
  const url=`https://api.github.com/repos/${encodeURIComponent(SES.owner)}/${encodeURIComponent(SES.repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`+(method==="GET"?`?ref=${encodeURIComponent(SES.branch)}&t=${Date.now()}`:"");
  const r=await fetch(url,{method,cache:"no-store",headers:{"Accept":"application/vnd.github+json","Authorization":"Bearer "+SES.token,"X-GitHub-Api-Version":"2022-11-28",...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});
  if(method==="GET"&&r.status===404) return null;
  if(!r.ok){ let m=""; try{ m=(await r.json()).message||"" }catch(e){} const err=new Error(`GitHub ${r.status}${m?": "+m:""}`); err.status=r.status; throw err }
  return r.status===204?null:r.json();
}
async function readFile(path){ const f=await gh("GET",path); return f?{sha:f.sha,text:b64ToStr(f.content||"")}:null }
async function writeFile(path,contentB64,message,sha){ return gh("PUT",path,{message,content:contentB64,branch:SES.branch,...(sha?{sha}:{})}) }
async function deleteFile(path,message){ const f=await gh("GET",path); if(!f) return; await gh("DELETE",path,{message,sha:f.sha,branch:SES.branch}) }

/* Read the latest catalog, apply a change, write it back. Retries once if someone else saved in between. */
async function commitCatalog(mutate,message){
  for(let attempt=0;attempt<2;attempt++){
    const f=await readFile(CATALOG_PATH); if(!f) throw new Error("data/catalog.json is missing from the repository");
    const fresh=JSON.parse(f.text); mutate(fresh); fresh.updated=new Date().toISOString();
    try{ await writeFile(CATALOG_PATH,strToB64(JSON.stringify(fresh,null,1)),message,f.sha); CAT=fresh; return fresh }
    catch(e){ if(attempt===0&&(e.status===409||e.status===422)) continue; throw e }
  }
}
async function commitPrivate(message){
  const env=await encryptJSON(PRIV,SES.password);
  for(let attempt=0;attempt<2;attempt++){
    const f=await readFile(PRIVATE_PATH);
    try{ await writeFile(PRIVATE_PATH,strToB64(JSON.stringify(env)),message,f&&f.sha); return }
    catch(e){ if(attempt===0&&(e.status===409||e.status===422)) continue; throw e }
  }
}
function friendly(e){
  const s=e&&e.status;
  if(s===401) return "GitHub refused the token. It may have expired: open Settings → Replace GitHub token.";
  if(s===403) return "GitHub refused the save. Check the token has 'Contents: Read and write' for this repository.";
  if(s===404) return "Repository or branch not found. Check the repository name and branch in Settings.";
  if(e&&/Failed to fetch|NetworkError/i.test(e.message)) return "No connection to GitHub. Check your internet and try again.";
  return (e&&e.message)||"Something went wrong.";
}

/* ---------- repo guess from github.io address ---------- */
function guessRepo(){
  const h=location.hostname, m=/^([\w-]+)\.github\.io$/i.exec(h); if(!m) return {owner:"",repo:""};
  const seg=location.pathname.split("/").filter(Boolean);
  const repo=seg.length&&seg[0]!=="admin"?seg[0]:`${m[1]}.github.io`;
  return {owner:m[1],repo};
}
const siteBase=()=>{ const s=(CAT&&CAT.settings&&CAT.settings.siteUrl)||""; if(s) return s.replace(/\/?$/,"/"); return location.href.split("#")[0].replace(/admin\/(index\.html)?(\?.*)?$/,"") };

/* ===================== GATE: setup / login ===================== */
async function boot(){
  let cfg=null;
  try{ const r=await fetch("../"+CONFIG_PATH+"?t="+Date.now(),{cache:"no-store"}); if(r.ok) cfg=await r.json() }catch(e){}
  if(cfg&&cfg.ct) showLogin(cfg); else showSetup();
}
function gate(inner){ app.innerHTML=`<div class="wrap gate"><div class="gatebox">${inner}</div></div>` }
let CFG=null;
function showLogin(cfg){
  if(cfg) CFG=cfg; if(!CFG){ boot(); return }
  gate(`<div class="brandline">M A FURNITURE</div><div><div class="eyebrow">Owner admin</div><h1>Sign in</h1></div>
    <form id="loginF" class="catcard" novalidate>
      <label for="l-pass">Admin password<input id="l-pass" type="password" autocomplete="current-password" required></label>
      <div class="err" id="l-err" hidden></div>
      <button class="btn btn-dark" type="submit" id="l-go">Unlock admin</button>
    </form>
    <p class="help"><a href="../">← Back to the catalogue</a></p>`);
  $("#l-pass").focus();
  $("#loginF").onsubmit=async e=>{
    e.preventDefault(); const pw=$("#l-pass").value, err=$("#l-err"); err.hidden=true; if(!pw) return;
    $("#l-go").disabled=true; $("#l-go").textContent="Checking…";
    try{ const c=await decryptJSON(CFG,pw); Object.assign(SES,{token:c.token,owner:c.owner,repo:c.repo,branch:c.branch||"main",password:pw}); }
    catch(_){ err.textContent="That password is not correct."; err.hidden=false; $("#l-go").disabled=false; $("#l-go").textContent="Unlock admin"; $("#l-pass").select(); return }
    await loadData();
  };
}
function showSetup(){
  const g=guessRepo();
  gate(`<div class="brandline">M A FURNITURE</div><div><div class="eyebrow">First-time setup</div><h1>Set up your admin</h1></div>
    <p>Connect this catalogue to its GitHub repository once. After this you only need your password.</p>
    <form id="setupF" class="catcard" novalidate>
      <div class="row2"><label for="s-owner">GitHub username<input id="s-owner" value="${esc(g.owner)}" autocapitalize="off" spellcheck="false"></label>
      <label for="s-repo">Repository name<input id="s-repo" value="${esc(g.repo)}" autocapitalize="off" spellcheck="false"></label></div>
      <label for="s-branch">Branch<input id="s-branch" value="main" autocapitalize="off"></label>
      <label for="s-token">GitHub access token <span class="hint">(fine-grained, this repository only, Contents: Read and write)</span><input id="s-token" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…"></label>
      <div class="row2"><label for="s-pass">New admin password<input id="s-pass" type="password" autocomplete="new-password"></label>
      <label for="s-pass2">Repeat password<input id="s-pass2" type="password" autocomplete="new-password"></label></div>
      <p class="warn">Use at least 12 characters, ideally a few unrelated words. This password protects your token and your private costs. It cannot be recovered if lost; you would set up again with a new token.</p>
      <div class="err" id="s-err" hidden></div>
      <button class="btn btn-dark" type="submit" id="s-go">Connect and save</button>
    </form>
    <p class="help">Step-by-step help is in the README file in your repository.</p>`);
  $("#setupF").onsubmit=async e=>{
    e.preventDefault(); const v=id=>$(id).value.trim(), err=$("#s-err"); err.hidden=true;
    const owner=v("#s-owner"), repo=v("#s-repo"), branch=v("#s-branch")||"main", token=v("#s-token"), pw=$("#s-pass").value, pw2=$("#s-pass2").value;
    const fail=m=>{ err.textContent=m; err.hidden=false };
    if(!owner||!repo) return fail("Enter your GitHub username and repository name.");
    if(!token) return fail("Paste your GitHub access token.");
    if(pw.length<12) return fail("Choose a password of at least 12 characters.");
    if(pw!==pw2) return fail("The two passwords don't match.");
    $("#s-go").disabled=true; $("#s-go").textContent="Connecting…";
    Object.assign(SES,{token,owner,repo,branch,password:pw});
    try{
      const r=await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,{headers:{"Accept":"application/vnd.github+json","Authorization":"Bearer "+token,"X-GitHub-Api-Version":"2022-11-28"}});
      if(r.status===401) throw Object.assign(new Error(""),{status:401});
      if(r.status===404) throw Object.assign(new Error(""),{status:404});
      const info=await r.json(); if(info.permissions&&info.permissions.push===false) throw Object.assign(new Error(""),{status:403});
      if(!(await readFile(CATALOG_PATH))) throw new Error("data/catalog.json was not found in that repository and branch. Upload the full site folder first.");
      const env=await encryptJSON({token,owner,repo,branch},pw);
      const old=await readFile(CONFIG_PATH);
      await writeFile(CONFIG_PATH,strToB64(JSON.stringify(env)),"Admin setup",old&&old.sha);
      CFG=env; toast("Admin connected. Your password now unlocks it on any device.",4000);
      await loadData();
    }catch(ex){ SES.token=""; fail(friendly(ex)); $("#s-go").disabled=false; $("#s-go").textContent="Connect and save" }
  };
}
async function loadData(){
  busy("Loading your catalogue…");
  try{
    const f=await readFile(CATALOG_PATH); if(!f) throw new Error("data/catalog.json is missing");
    CAT=JSON.parse(f.text);
    const p=await readFile(PRIVATE_PATH);
    PRIV=p?await decryptJSON(JSON.parse(p.text),SES.password).catch(()=>{ toast("Private costs file could not be opened with this password",4000); return {} }):{};
    busy(); bumpIdle(); render();
  }catch(e){ busy(); SES.token=""; gate(`<div class="brandline">M A FURNITURE</div><h1>Couldn't load</h1><p>${esc(friendly(e))}</p><button class="btn btn-dark" id="retry">Try again</button>`); $("#retry").onclick=()=>showLogin() }
}

/* ===================== SHELL ===================== */
function render(){
  app.innerHTML=`<header class="abar"><div class="wrap"><a class="brand" href="../" target="_blank" rel="noopener"><b>${esc(CAT.settings.brand||"M A FURNITURE")}</b><small>Catalogue admin</small></a><span class="grow"></span>
      <a class="btn" href="../" target="_blank" rel="noopener">View site</a><button class="btn" id="lockBtn" type="button">Lock</button></div></header>
    <div class="wrap"><nav class="tabs" role="tablist">${[["products","Products"],["categories","Categories"],["settings","Settings"],["qr","QR codes"]].map(([k,l])=>`<button role="tab" type="button" data-tab="${k}" aria-selected="${VIEW===k}">${l}</button>`).join("")}</nav></div>
    <main class="wrap panel" id="panel"></main>`;
  $("#lockBtn").onclick=()=>{ if(DIRTY&&!confirmLeave()) return; lock() };
  $$("[data-tab]").forEach(b=>b.onclick=()=>{ if(DIRTY&&!confirmLeave()) return; VIEW=b.dataset.tab; EDIT=null; DIRTY=false; render() });
  ({products:EDIT?renderEditor:renderProducts,categories:renderCategories,settings:renderSettings,qr:renderQR}[VIEW])();
}
let leaveArmed=0; function confirmLeave(){ if(Date.now()-leaveArmed<4000){ DIRTY=false; return true } leaveArmed=Date.now(); toast("You have unsaved changes. Click again to leave without saving.",4000); return false }
const catById=id=>(CAT.categories||[]).find(c=>c.id===id);
const subName=(p)=>{ const c=catById(p.category); const g=c&&(c.subgroups||[]).find(x=>x.id===p.subgroup); return (c?c.name:"(no category)")+(g?" › "+g.name:"") };

/* ===================== PRODUCTS LIST ===================== */
let LQ="", LC="";
function renderProducts(){
  const P=$("#panel");
  const list=(CAT.products||[]).slice().sort((a,b)=>(a.order||0)-(b.order||0)).filter(p=>(!LC||p.category===LC)&&(!LQ||[p.code,p.name,p.material,(PRIV[p.code]||{}).vendor].join(" ").toLowerCase().includes(LQ.toLowerCase())));
  P.innerHTML=`<div class="phead"><div><h1>Products</h1><p>${CAT.products.length} products. Changes appear on your site about a minute after you save.</p></div>
    <div class="tools"><input type="search" id="lq" placeholder="Search code, name or vendor" value="${esc(LQ)}" aria-label="Search products">
    <select id="lc" aria-label="Filter by category"><option value="">All categories</option>${CAT.categories.map(c=>`<option value="${esc(c.id)}"${LC===c.id?" selected":""}>${esc(c.name)}</option>`).join("")}</select>
    <button class="btn btn-dark" id="addP" type="button">+ Add product</button></div></div>
    ${list.length?`<div class="otable"><table><thead><tr><th></th><th>Code</th><th>Product</th><th>Category</th><th class="num">Price</th><th class="num">Cost</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map(p=>{ const pr=PRIV[p.code]||{}; const price=p.price!=null?p.price:pr.hiddenPrice; return `<tr><td>${(p.images||[])[0]?`<img class="thumb" src="../${esc(p.images[0])}" alt="" loading="lazy">`:`<span class="thumb"></span>`}</td><td><code>${esc(p.code)}</code></td><td class="nm">${esc(p.name)}</td><td class="nm">${esc(subName(p))}</td>
      <td class="num">${price!=null&&price!==""?inr(price)+(p.showPrice?"":" <span class='hint'>(hidden)</span>"):"—"}</td><td class="num">${inr(pr.cost)}</td>
      <td>${p.active===false?`<span class="pill-off">Hidden</span>`:`<span class="pill-live">Live</span>`}</td><td><button type="button" data-edit="${esc(p.code)}">Edit</button></td></tr>` }).join("")}
    </tbody></table></div>`:`<div class="empty">No products match. <button class="btn" type="button" id="clrF">Clear filters</button></div>`}`;
  const q=$("#lq"); q.oninput=()=>{ LQ=q.value; const pos=q.selectionStart; renderProducts(); const n=$("#lq"); n.focus(); try{ n.setSelectionRange(pos,pos) }catch(e){} };
  $("#lc").onchange=e=>{ LC=e.target.value; renderProducts() };
  $("#addP").onclick=()=>openEditor(null);
  if($("#clrF")) $("#clrF").onclick=()=>{ LQ=""; LC=""; renderProducts() };
  $$("[data-edit]").forEach(b=>b.onclick=()=>openEditor(b.dataset.edit));
}

/* ===================== PRODUCT EDITOR ===================== */
function nextCode(catId){
  const inCat=CAT.products.filter(p=>p.category===catId);
  let prefix=null, max=0;
  inCat.forEach(p=>{ const m=/^(.*?-)(\d+)$/.exec(p.code); if(m){ prefix=prefix||m[1]; if(m[1]===prefix) max=Math.max(max,+m[2]) } });
  if(!prefix){ const c=catById(catId)||{name:"X"}; const ini=c.name.replace(/[^A-Za-z ]/g,"").split(/\s+/).filter(Boolean).map(w=>w[0]).join("").toUpperCase().slice(0,2).padEnd(2,"X"); prefix=`MAF-${ini}-` }
  let n=max+1, code; do{ code=prefix+String(n).padStart(2,"0"); n++ }while(CAT.products.some(p=>p.code===code)); return code;
}
function openEditor(code){
  const src=code?CAT.products.find(p=>p.code===code):null;
  const c0=LC||(CAT.categories[0]||{}).id||"";
  EDIT=src?JSON.parse(JSON.stringify(src)):{code:nextCode(c0),name:"",category:c0,subgroup:((catById(c0)||{}).subgroups||[{}])[0].id||"",summary:"",material:"",description:"",keys:[],tags:[],features:[],specs:[],options:[],images:[],imagePos:"50% 55%",styled:false,render:false,price:null,showPrice:false,active:true,order:(Math.max(0,...CAT.products.map(p=>p.order||0))+1)};
  EDIT._isNew=!src; EDIT._priv=JSON.parse(JSON.stringify(PRIV[EDIT.code]||{}));
  PENDING=[]; REMOVED=[]; DIRTY=false; VIEW="products"; render(); window.scrollTo(0,0);
}
const lines=t=>t.split("\n").map(s=>s.trim()).filter(Boolean);
function renderEditor(){
  const p=EDIT, pr=p._priv, c=catById(p.category)||{subgroups:[]};
  const posKey=p.imagePos||"50% 55%";
  $("#panel").innerHTML=`<div class="phead"><div><button class="btn" type="button" id="back">← All products</button><h1 style="margin-top:12px">${p._isNew?"Add product":esc(p.name||p.code)}</h1><p>${p._isNew?"Fill in the details and save. It will appear on your site about a minute later.":"Edit any field and save. Customers see the change about a minute later."}</p></div></div>
  <form id="edF" novalidate>
  <div class="ed">
    <div class="catcard">
      <section class="box"><h2>Basics</h2>
        <div class="row2"><label for="e-name">Product name<input id="e-name" value="${esc(p.name)}" placeholder="e.g. Forest Crescent U-Sofa" required></label>
        <label for="e-code">Item code <span class="hint">${p._isNew?"(suggested, can change)":"(fixed)"}</span><input id="e-code" value="${esc(p.code)}" ${p._isNew?"":"readonly"} autocapitalize="characters" spellcheck="false"></label></div>
        <div class="row2"><label for="e-cat">Category<select id="e-cat">${CAT.categories.map(x=>`<option value="${esc(x.id)}"${x.id===p.category?" selected":""}>${esc(x.name)}</option>`).join("")}</select></label>
        <label for="e-sub">Sub-type<select id="e-sub">${(c.subgroups||[]).map(g=>`<option value="${esc(g.id)}"${g.id===p.subgroup?" selected":""}>${esc(g.name)}</option>`).join("")||`<option value="">(add sub-types under Categories)</option>`}</select></label></div>
        <div class="row2"><label for="e-sum">Size / seating / set contents<input id="e-sum" value="${esc(p.summary)}" placeholder="e.g. 7-seater, or Bed + 4-door wardrobe"></label>
        <label for="e-mat">Material / finish<input id="e-mat" value="${esc(p.material)}" placeholder="e.g. Forest green velvet"></label></div>
        <label for="e-desc">Description<textarea id="e-desc" class="tall" placeholder="2–4 sentences customers will read">${esc(p.description)}</textarea></label>
        <div class="row2"><label for="e-keys">Key points on the card <span class="hint">(one per line, 2–4)</span><textarea id="e-keys">${esc((p.keys||[]).join("\n"))}</textarea></label>
        <label for="e-tags">Tags on the photo <span class="hint">(one per line, e.g. Bestseller, New)</span><textarea id="e-tags">${esc((p.tags||[]).join("\n"))}</textarea></label></div>
        <label for="e-feat">Feature bullets in the details <span class="hint">(one per line)</span><textarea id="e-feat" class="tall">${esc((p.features||[]).join("\n"))}</textarea></label>
      </section>
      <section class="box"><h2>Specifications</h2><p class="help">Shown as a table in the details and sent in WhatsApp enquiries.</p>
        <div class="kv" id="specRows">${(p.specs||[]).map((r,i)=>specRow(r,i)).join("")}</div>
        <button class="btn addrow" type="button" id="addSpec">+ Add specification</button>
      </section>
      <section class="box"><h2>Customer options</h2><p class="help">Customers pick these before enquiring, e.g. Fabric: Velvet, Suede. The first value is the default.</p>
        <div class="kv" id="optRows">${(p.options||[]).map((o,i)=>optRow(o,i)).join("")}</div>
        <button class="btn addrow" type="button" id="addOpt">+ Add option</button>
      </section>
    </div>
    <div class="catcard">
      <section class="box"><h2>Photos</h2>
        <div class="imgs" id="imgs"></div>
        <label class="drop" id="drop" for="e-files"><span><b>Add photos</b><br>Tap to choose or drop images here. They're resized automatically.</span></label>
        <input id="e-files" type="file" accept="image/*" multiple hidden>
        <label for="e-pos">Photo framing on cards<select id="e-pos">${[["50% 30%","Show more of the top"],["50% 55%","Centre"],["50% 75%","Show more of the bottom"]].map(([v,l])=>`<option value="${v}"${posKey===v?" selected":""}>${l}</option>`).join("")}${["50% 30%","50% 55%","50% 75%"].includes(posKey)?"":`<option value="${esc(posKey)}" selected>Custom (${esc(posKey)})</option>`}</select></label>
        <div class="checks"><label><input type="checkbox" id="e-styled"${p.styled?" checked":""}> Styled room setting</label><label><input type="checkbox" id="e-render"${p.render?" checked":""}> Design render</label></div>
      </section>
      <section class="box"><h2>Price &amp; visibility</h2>
        <div class="row2"><label for="e-price">Price (₹) <span class="hint">(optional)</span><input id="e-price" inputmode="numeric" value="${esc(p.price!=null?p.price:(pr.hiddenPrice!=null?pr.hiddenPrice:""))}" placeholder="e.g. 85000"></label>
        <label for="e-order">Display order<input id="e-order" inputmode="numeric" value="${esc(p.order||"")}"></label></div>
        <div class="checks"><label><input type="checkbox" id="e-show"${p.showPrice?" checked":""}> Show price to customers</label><label><input type="checkbox" id="e-active"${p.active!==false?" checked":""}> Show this product on the site</label></div>
        <p class="help">When the price is not shown, it is saved encrypted with your private details and never reaches customers.</p>
      </section>
      <section class="box private"><h2>Private details</h2><p class="help">Only visible here after you unlock the admin. Stored encrypted.</p>
        <div class="row2"><label for="e-cost">Making cost (₹)<input id="e-cost" inputmode="numeric" value="${esc(pr.cost!=null?pr.cost:"")}"></label>
        <label for="e-floor">Lowest price to accept (₹)<input id="e-floor" inputmode="numeric" value="${esc(pr.floor!=null?pr.floor:"")}"></label></div>
        <div class="row2"><label for="e-vendor">Vendor / supplier<input id="e-vendor" value="${esc(pr.vendor||"")}"></label>
        <label for="e-vphone">Vendor phone<input id="e-vphone" inputmode="tel" value="${esc(pr.vphone||"")}"></label></div>
        <label for="e-notes">Notes<textarea id="e-notes" placeholder="Fabric code, board brand, making time…">${esc(pr.notes||"")}</textarea></label>
        <div class="status" id="e-margin"></div>
      </section>
    </div>
  </div>
  <div class="savebar"><div class="wrap"><button class="btn btn-dark" type="submit" id="e-save">${p._isNew?"Publish product":"Save changes"}</button><button class="btn" type="button" id="e-cancel">Cancel</button><span class="grow"></span>
    ${p._isNew?"":`<button class="btn btn-danger" type="button" id="e-del">Delete product</button>`}<span class="err" id="e-err" hidden></span></div></div>
  </form>`;
  drawImgs(); margin();
  $("#back").onclick=$("#e-cancel").onclick=()=>{ if(DIRTY&&!confirmLeave()) return; EDIT=null; DIRTY=false; render() };
  $("#edF").addEventListener("input",()=>{ DIRTY=true; margin() });
  $("#e-cat").onchange=e=>{ readForm(); p.category=e.target.value; const nc=catById(p.category)||{subgroups:[]}; p.subgroup=(nc.subgroups[0]||{}).id||""; if(p._isNew) p.code=nextCode(p.category); DIRTY=true; renderEditor() };
  $("#addSpec").onclick=()=>{ readForm(); p.specs.push(["",""]); renderEditor(); const r=$$("#specRows .r"); r[r.length-1].querySelector("input").focus() };
  $("#addOpt").onclick=()=>{ readForm(); p.options.push({name:"",values:[]}); renderEditor(); const r=$$("#optRows .r"); r[r.length-1].querySelector("input").focus() };
  $("#panel").onclick=e=>{
    const rs=e.target.closest("[data-rmspec]"); if(rs){ readForm(); p.specs.splice(+rs.dataset.rmspec,1); DIRTY=true; renderEditor(); return }
    const ro=e.target.closest("[data-rmopt]"); if(ro){ readForm(); p.options.splice(+ro.dataset.rmopt,1); DIRTY=true; renderEditor(); return }
  };
  const fi=$("#e-files"), drop=$("#drop");
  fi.onchange=()=>{ addFiles([...fi.files]); fi.value="" };
  ["dragenter","dragover"].forEach(ev=>drop.addEventListener(ev,e=>{ e.preventDefault(); drop.classList.add("over") }));
  ["dragleave","drop"].forEach(ev=>drop.addEventListener(ev,e=>{ e.preventDefault(); drop.classList.remove("over") }));
  drop.addEventListener("drop",e=>addFiles([...e.dataTransfer.files].filter(f=>/^image\//.test(f.type))));
  $("#edF").onsubmit=e=>{ e.preventDefault(); saveProduct() };
  if($("#e-del")) $("#e-del").onclick=e=>{ const b=e.currentTarget; if(!b.classList.contains("armed")){ b.classList.add("armed"); b.textContent="Click again to delete"; setTimeout(()=>{ b.classList.remove("armed"); b.textContent="Delete product" },4000); return } deleteProduct() };
}
const specRow=(r,i)=>`<div class="r"><input aria-label="Specification name" value="${esc(r[0])}" placeholder="e.g. Frame" data-sk="${i}"><input aria-label="Specification value" value="${esc(r[1])}" placeholder="e.g. Seasoned hardwood" data-sv="${i}"><button class="iconbtn" type="button" data-rmspec="${i}" aria-label="Remove">×</button></div>`;
const optRow=(o,i)=>`<div class="r o"><input aria-label="Option name" value="${esc(o.name)}" placeholder="e.g. Fabric" data-on="${i}"><input aria-label="Option choices" value="${esc((o.values||[]).join(", "))}" placeholder="Choices, separated by commas" data-ov="${i}"><button class="iconbtn" type="button" data-rmopt="${i}" aria-label="Remove">×</button></div>`;
const numOrNull=v=>{ v=String(v||"").replace(/[,₹\s]/g,""); if(v==="") return null; const n=Number(v); return isFinite(n)&&n>=0?n:NaN };
function readForm(){
  const p=EDIT, v=id=>($(id)||{value:""}).value;
  p.name=v("#e-name").trim(); if(p._isNew) p.code=v("#e-code").trim().toUpperCase();
  p.category=v("#e-cat"); p.subgroup=v("#e-sub"); p.summary=v("#e-sum").trim(); p.material=v("#e-mat").trim(); p.description=v("#e-desc").trim();
  p.keys=lines(v("#e-keys")); p.tags=lines(v("#e-tags")); p.features=lines(v("#e-feat"));
  p.specs=$$("#specRows .r").map(r=>[r.querySelector("[data-sk]").value.trim(),r.querySelector("[data-sv]").value.trim()]);
  p.options=$$("#optRows .r").map(r=>({name:r.querySelector("[data-on]").value.trim(),values:r.querySelector("[data-ov]").value.split(",").map(s=>s.trim()).filter(Boolean)}));
  p.imagePos=v("#e-pos"); p.styled=$("#e-styled").checked; p.render=$("#e-render").checked;
  p._price=numOrNull(v("#e-price")); p.showPrice=$("#e-show").checked; p.active=$("#e-active").checked; p.order=Number(v("#e-order"))||p.order||0;
  Object.assign(p._priv,{cost:numOrNull(v("#e-cost")),floor:numOrNull(v("#e-floor")),vendor:v("#e-vendor").trim(),vphone:v("#e-vphone").trim(),notes:v("#e-notes").trim()});
}
function margin(){
  const price=numOrNull(($("#e-price")||{}).value), cost=numOrNull(($("#e-cost")||{}).value), el=$("#e-margin"); if(!el) return;
  el.textContent=(price&&cost!=null&&!isNaN(price)&&!isNaN(cost))?`Profit per piece ${inr(price-cost)} · margin ${((price-cost)/price*100).toFixed(0)}%`:"";
}
function drawImgs(){
  const p=EDIT, box=$("#imgs");
  const all=[...(p.images||[]).map(src=>({src:"../"+src,key:src,isNew:false})),...PENDING.map(x=>({src:x.url,key:x.id,isNew:true}))];
  box.innerHTML=all.length?all.map((x,i)=>`<figure class="${i===0?"first":""}"><img src="${esc(x.src)}" alt="">${x.isNew?`<span class="new">New</span>`:""}<figcaption>${i>0?`<button type="button" data-first="${esc(x.key)}">Make main</button>`:`<button type="button" disabled>Main photo</button>`}<button type="button" data-rmimg="${esc(x.key)}">Remove</button></figcaption></figure>`).join(""):`<p class="help">No photos yet. Products without photos show a “Photos coming soon” panel.</p>`;
  box.onclick=e=>{
    const f=e.target.closest("[data-first]"), r=e.target.closest("[data-rmimg]"); if(!f&&!r) return; DIRTY=true;
    const key=(f||r).dataset[f?"first":"rmimg"];
    if(r){ if(p.images.includes(key)){ p.images=p.images.filter(s=>s!==key); REMOVED.push(key) } else PENDING=PENDING.filter(x=>x.id!==key) }
    else{ if(p.images.includes(key)) p.images=[key,...p.images.filter(s=>s!==key)]; else{ const x=PENDING.find(y=>y.id===key); PENDING=[x,...PENDING.filter(y=>y!==x)]; p._newFirst=true } }
    if(f&&p.images.includes(key)) p._newFirst=false;
    drawImgs();
  };
}
async function resizeImage(file){
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((ok,no)=>{ const i=new Image(); i.onload=()=>ok(i); i.onerror=()=>no(new Error("Not a readable image")); i.src=url });
    const max=1400, s=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
    const c=document.createElement("canvas"); c.width=Math.round(img.naturalWidth*s); c.height=Math.round(img.naturalHeight*s);
    const x=c.getContext("2d"); x.fillStyle="#fff"; x.fillRect(0,0,c.width,c.height); x.drawImage(img,0,0,c.width,c.height);
    const blob=await new Promise(ok=>c.toBlob(ok,"image/jpeg",0.82));
    return {blob,url:URL.createObjectURL(blob)};
  }finally{ URL.revokeObjectURL(url) }
}
async function addFiles(files){
  if(!files.length) return; busy(`Preparing ${files.length} photo${files.length>1?"s":""}…`);
  try{ for(const f of files){ const r=await resizeImage(f); PENDING.push({id:"new-"+Math.random().toString(36).slice(2),blob:r.blob,url:r.url}) } DIRTY=true }
  catch(e){ toast("One of the files couldn't be read as an image") }
  busy(); drawImgs();
}
async function saveProduct(){
  readForm(); const p=EDIT, err=$("#e-err"); err.hidden=true;
  const fail=m=>{ err.textContent=m; err.hidden=false; toast(m,4000) };
  if(!p.name) return fail("Add a product name.");
  if(!/^[A-Z0-9][A-Z0-9-]{1,30}$/.test(p.code)) return fail("Item code can use letters, numbers and dashes, e.g. MAF-LR-17.");
  if(p._isNew&&CAT.products.some(x=>x.code===p.code)) return fail("That item code is already used.");
  if(!p.category) return fail("Choose a category.");
  if([p._price,p._priv.cost,p._priv.floor].some(x=>Number.isNaN(x))) return fail("Prices must be numbers, like 85000.");
  p.specs=p.specs.filter(r=>r[0]||r[1]); p.options=p.options.filter(o=>o.name&&o.values.length);
  try{
    const uploaded=[];
    for(let i=0;i<PENDING.length;i++){
      busy(`Uploading photo ${i+1} of ${PENDING.length}…`);
      const path=`images/${p.code.toLowerCase()}-${Date.now().toString(36)}${i}.jpg`;
      const bytes=new Uint8Array(await PENDING[i].blob.arrayBuffer());
      await writeFile(path,bytesToB64(bytes),`Photo for ${p.code}`); uploaded.push(path);
    }
    const images=p._newFirst?[...uploaded,...p.images]:[...p.images,...uploaded];
    const pub={code:p.code,name:p.name,category:p.category,subgroup:p.subgroup,summary:p.summary,material:p.material,description:p.description,keys:p.keys,tags:p.tags,features:p.features,specs:p.specs,options:p.options,images,imagePos:p.imagePos,styled:p.styled,render:p.render,
      price:p.showPrice?p._price:null,showPrice:!!(p.showPrice&&p._price!=null),order:p.order,active:p.active,updatedAt:new Date().toISOString()};
    if(p.sketch&&!images.length) pub.sketch=p.sketch;
    busy("Publishing…");
    await commitCatalog(c=>{ const i=c.products.findIndex(x=>x.code===p.code); if(i>=0) c.products[i]=pub; else c.products.push(pub) },`${p._isNew?"Add":"Update"} ${p.code} ${p.name}`);
    const priv={...p._priv,hiddenPrice:(!p.showPrice&&p._price!=null)?p._price:null};
    Object.keys(priv).forEach(k=>{ if(priv[k]==null||priv[k]==="") delete priv[k] });
    const before=JSON.stringify(PRIV[p.code]||{});
    if(Object.keys(priv).length) PRIV[p.code]=priv; else delete PRIV[p.code];
    if(JSON.stringify(PRIV[p.code]||{})!==before){ busy("Saving private details…"); await commitPrivate(`Private details ${p.code}`) }
    for(const path of REMOVED){ if(!CAT.products.some(x=>(x.images||[]).includes(path))){ try{ busy("Removing old photos…"); await deleteFile(path,`Remove photo from ${p.code}`) }catch(e){} } }
    busy(); DIRTY=false; PENDING=[]; REMOVED=[];
    toast(`Saved. ${p.name} will be live in about a minute.`,4000);
    EDIT=null; render();
  }catch(e){ busy(); fail(friendly(e)) }
}
async function deleteProduct(){
  const p=EDIT;
  try{
    busy("Deleting…");
    await commitCatalog(c=>{ c.products=c.products.filter(x=>x.code!==p.code) },`Delete ${p.code} ${p.name}`);
    if(PRIV[p.code]){ delete PRIV[p.code]; await commitPrivate(`Remove private details ${p.code}`) }
    for(const path of (p.images||[])){ if(!CAT.products.some(x=>(x.images||[]).includes(path))){ try{ await deleteFile(path,`Remove photo of ${p.code}`) }catch(e){} } }
    busy(); DIRTY=false; toast(`${p.name||p.code} deleted.`); EDIT=null; render();
  }catch(e){ busy(); toast(friendly(e),5000) }
}

/* ===================== CATEGORIES ===================== */
function renderCategories(){
  const count=(cid,sid)=>CAT.products.filter(p=>p.category===cid&&(sid===undefined||p.subgroup===sid)).length;
  $("#panel").innerHTML=`<div class="phead"><div><h1>Categories &amp; sub-types</h1><p>Each category becomes a section on the site. Sub-types become the filter buttons inside it, like “3 Door” and “4 Door”.</p></div></div>
    <div class="cats">${CAT.categories.map((c,i)=>`<form class="box catcard" data-cat="${esc(c.id)}" novalidate>
      <div class="catbar"><h2>${esc(c.name)} <span class="hint">· ${count(c.id)} products · link #${esc(c.id)}</span></h2>
        <div class="tools"><button class="btn" type="button" data-move="-1"${i===0?" disabled":""} aria-label="Move up">↑</button><button class="btn" type="button" data-move="1"${i===CAT.categories.length-1?" disabled":""} aria-label="Move down">↓</button></div></div>
      <div class="row3"><label>Name in menus<input name="name" value="${esc(c.name)}"></label><label>Section heading<input name="title" value="${esc(c.title||"")}"></label><label>Link id <span class="hint">(fixed)</span><input value="${esc(c.id)}" readonly></label></div>
      <label>Intro text<textarea name="intro">${esc(c.intro||"")}</textarea></label>
      <h3>Sub-types</h3>
      <div class="subrows">${(c.subgroups||[]).map((g,j)=>`<div class="r"><input name="sub-${j}" data-sid="${esc(g.id)}" value="${esc(g.name)}" aria-label="Sub-type name"><code>${count(c.id,g.id)} products</code><button class="iconbtn" type="button" data-rmsub="${esc(g.id)}" aria-label="Remove sub-type"${count(c.id,g.id)?` title="Move its products first" disabled`:""}>×</button></div>`).join("")}</div>
      <div class="tools"><input name="newsub" placeholder="New sub-type, e.g. 2 Door" aria-label="New sub-type name"><button class="btn" type="button" data-addsub>+ Add sub-type</button></div>
      <div class="tools"><button class="btn btn-dark" type="submit">Save category</button><span class="grow"></span><button class="btn btn-danger" type="button" data-delcat${count(c.id)?` disabled title="Move or delete its products first"`:""}>Delete category</button></div>
    </form>`).join("")}
    <form class="box catcard" id="newCat" novalidate><h2>Add a category</h2>
      <div class="row3"><label>Name<input name="name" placeholder="e.g. Dining"></label><label>Section heading<input name="title" placeholder="e.g. Dining Tables & Chairs"></label><label>Sub-types <span class="hint">(comma separated)</span><input name="subs" placeholder="4 Seater, 6 Seater"></label></div>
      <label>Intro text<textarea name="intro"></textarea></label>
      <div class="tools"><button class="btn btn-dark" type="submit">Create category</button></div></form></div>`;
  $$("[data-cat]").forEach(f=>{
    const id=f.dataset.cat, cat=()=>CAT.categories.find(c=>c.id===id);
    f.onsubmit=async e=>{ e.preventDefault(); const E=f.elements, name=E.name.value.trim(); if(!name) return toast("Category needs a name");
      const subs=[...f.querySelectorAll("[data-sid]")].map(inp=>({id:inp.dataset.sid,name:inp.value.trim()||inp.dataset.sid}));
      await saveCats(c=>{ const x=c.categories.find(k=>k.id===id); Object.assign(x,{name,title:E.title.value.trim(),intro:E.intro.value.trim(),subgroups:subs}) },`Update category ${name}`) };
    f.querySelector("[data-addsub]").onclick=async()=>{ const n=f.elements.newsub.value.trim(); if(!n) return toast("Type the sub-type name first");
      let sid=slug(n)||"type"; const used=(cat().subgroups||[]).map(g=>g.id); let k=2; const base=sid; while(used.includes(sid)) sid=base+"-"+k++;
      await saveCats(c=>{ const x=c.categories.find(k=>k.id===id); x.subgroups=x.subgroups||[]; x.subgroups.push({id:sid,name:n}) },`Add sub-type ${n} to ${cat().name}`) };
    f.querySelectorAll("[data-rmsub]").forEach(b=>b.onclick=async()=>{ const sid=b.dataset.rmsub; await saveCats(c=>{ const x=c.categories.find(k=>k.id===id); x.subgroups=x.subgroups.filter(g=>g.id!==sid) },`Remove sub-type from ${cat().name}`) });
    f.querySelectorAll("[data-move]").forEach(b=>b.onclick=async()=>{ const d=+b.dataset.move; await saveCats(c=>{ const i=c.categories.findIndex(k=>k.id===id), j=i+d; if(j<0||j>=c.categories.length) return; [c.categories[i],c.categories[j]]=[c.categories[j],c.categories[i]] },`Reorder categories`) });
    const del=f.querySelector("[data-delcat]"); del.onclick=async()=>{ if(!del.classList.contains("armed")){ del.classList.add("armed"); del.textContent="Click again to delete"; setTimeout(()=>{ del.classList.remove("armed"); del.textContent="Delete category" },4000); return }
      await saveCats(c=>{ if(c.products.some(p=>p.category===id)) throw new Error("This category still has products."); c.categories=c.categories.filter(k=>k.id!==id) },`Delete category ${cat().name}`) };
  });
  $("#newCat").onsubmit=async e=>{ e.preventDefault(); const f=e.target.elements, name=f.name.value.trim(); if(!name) return toast("Give the category a name");
    let id=slug(name)||"category", k=2; const base=id; while(CAT.categories.some(c=>c.id===id)) id=base+"-"+k++;
    const subs=f.subs.value.split(",").map(s=>s.trim()).filter(Boolean).map(n=>({id:slug(n)||"type",name:n}));
    await saveCats(c=>{ c.categories.push({id,name,title:f.title.value.trim()||name,intro:f.intro.value.trim(),subgroups:subs}) },`Add category ${name}`) };
}
async function saveCats(mutate,msg){ try{ busy("Saving…"); await commitCatalog(mutate,msg); busy(); toast("Saved. The site updates in about a minute."); renderCategories() }catch(e){ busy(); toast(friendly(e),5000) } }

/* ===================== SETTINGS ===================== */
function renderSettings(){
  const s=CAT.settings||{};
  const imgs=[...new Set(CAT.products.flatMap(p=>p.images||[]))];
  const F=(k,l,h="")=>`<label for="st-${k}">${l}${h?` <span class="hint">${h}</span>`:""}<input id="st-${k}" value="${esc(s[k]==null?"":s[k])}"></label>`;
  $("#panel").innerHTML=`<div class="phead"><div><h1>Settings</h1><p>Shop details used across the site and in WhatsApp messages.</p></div></div>
  <div class="ed"><form class="box" id="stF" novalidate><h2>Shop details</h2>
    <div class="row2">${F("brand","Shop name")}${F("subtitle","Subtitle under the logo")}</div>
    <div class="row2">${F("whatsapp","WhatsApp number","(with country code, digits only, e.g. 916235290961)")}${F("phoneDisplay","Phone as shown on the site")}</div>
    <div class="row2">${F("address","Showroom address")}${F("hours","Opening hours")}</div>
    <h3>Opening section</h3>
    ${F("tagline","Small line above the heading")}
    <div class="row2">${F("heroTitle","Heading")}${F("heroAccent","Heading, second part (brass)")}</div>
    <label for="st-heroText">Intro paragraph<textarea id="st-heroText">${esc(s.heroText||"")}</textarea></label>
    <h3>Opening photos</h3>
    <div class="row3">${[0,1,2].map(i=>`<label for="st-hi${i}">Photo ${i+1}<select id="st-hi${i}">${imgs.map(src=>`<option${(s.heroImages||[])[i]===src?" selected":""}>${esc(src)}</option>`).join("")}</select></label>`).join("")}</div>
    <h3>Enquiries &amp; links</h3>
    <div class="row2"><label for="st-maxEnquiry">Most designs in one enquiry<input id="st-maxEnquiry" inputmode="numeric" value="${esc(s.maxEnquiry||4)}"></label>${F("siteUrl","Public site address","(leave empty to use the current address)")}</div>
    <div class="tools"><button class="btn btn-dark" type="submit">Save settings</button></div></form>
  <div class="catcard">
    <form class="box private" id="pwF" novalidate><h2>Change admin password</h2>
      <label for="pw-old">Current password<input id="pw-old" type="password" autocomplete="current-password"></label>
      <div class="row2"><label for="pw-new">New password<input id="pw-new" type="password" autocomplete="new-password"></label><label for="pw-new2">Repeat new password<input id="pw-new2" type="password" autocomplete="new-password"></label></div>
      <div class="tools"><button class="btn btn-dark" type="submit">Change password</button></div></form>
    <form class="box" id="tkF" novalidate><h2>Replace GitHub token</h2><p class="help">Do this when your token expires. Current repository: <code>${esc(SES.owner)}/${esc(SES.repo)}</code> (${esc(SES.branch)}).</p>
      <label for="tk-new">New token<input id="tk-new" type="password" autocomplete="off" spellcheck="false"></label>
      <div class="tools"><button class="btn btn-dark" type="submit">Save new token</button></div></form>
  </div></div>`;
  $("#stF").onsubmit=async e=>{ e.preventDefault(); const g=k=>($("#st-"+k)||{value:""}).value.trim();
    const wa=g("whatsapp").replace(/\D/g,""); if(wa.length<10) return toast("Enter the WhatsApp number with country code, e.g. 916235290961",4000);
    const max=Math.max(1,Math.min(10,parseInt(g("maxEnquiry"),10)||4));
    const next={brand:g("brand"),subtitle:g("subtitle"),whatsapp:wa,phoneDisplay:g("phoneDisplay"),address:g("address"),hours:g("hours"),tagline:g("tagline"),heroTitle:g("heroTitle"),heroAccent:g("heroAccent"),heroText:$("#st-heroText").value.trim(),heroImages:[0,1,2].map(i=>($("#st-hi"+i)||{}).value).filter(Boolean),maxEnquiry:max,siteUrl:g("siteUrl")};
    try{ busy("Saving…"); await commitCatalog(c=>{ c.settings={...c.settings,...next} },"Update shop settings"); busy(); toast("Settings saved. The site updates in about a minute."); render() }catch(ex){ busy(); toast(friendly(ex),5000) } };
  $("#pwF").onsubmit=async e=>{ e.preventDefault(); const o=$("#pw-old").value, n=$("#pw-new").value, n2=$("#pw-new2").value;
    if(o!==SES.password) return toast("Current password is not correct"); if(n.length<12) return toast("New password needs at least 12 characters"); if(n!==n2) return toast("New passwords don't match");
    try{ busy("Re-encrypting with the new password…"); const env=await encryptJSON({token:SES.token,owner:SES.owner,repo:SES.repo,branch:SES.branch},n);
      const f=await readFile(CONFIG_PATH); await writeFile(CONFIG_PATH,strToB64(JSON.stringify(env)),"Change admin password",f&&f.sha); SES.password=n; CFG=env;
      if(Object.keys(PRIV).length||await readFile(PRIVATE_PATH)) await commitPrivate("Re-encrypt private details");
      busy(); toast("Password changed. Use the new one next time."); renderSettings() }catch(ex){ busy(); toast(friendly(ex),5000) } };
  $("#tkF").onsubmit=async e=>{ e.preventDefault(); const t=$("#tk-new").value.trim(); if(!t) return toast("Paste the new token");
    const old=SES.token; SES.token=t;
    try{ busy("Checking the new token…"); const f=await readFile(CONFIG_PATH); const env=await encryptJSON({token:t,owner:SES.owner,repo:SES.repo,branch:SES.branch},SES.password);
      await writeFile(CONFIG_PATH,strToB64(JSON.stringify(env)),"Replace GitHub token",f&&f.sha); CFG=env; busy(); toast("New token saved."); renderSettings() }
    catch(ex){ SES.token=old; busy(); toast(friendly(ex),5000) } };
}

/* ===================== QR CODES ===================== */
function qrTargets(){ return [{h:"",label:"Full catalogue",sub:"All products"},...CAT.categories.filter(c=>CAT.products.some(p=>p.category===c.id&&p.active!==false)).flatMap(c=>[{h:c.id,label:c.name,sub:c.title||""},...(c.subgroups||[]).filter(g=>CAT.products.some(p=>p.category===c.id&&p.subgroup===g.id&&p.active!==false)).map(g=>({h:c.id+"/"+g.id,label:c.name+" · "+g.name,sub:c.title||c.name,small:true}))])] }
function renderQR(){
  const T=qrTargets(), base=siteBase();
  $("#panel").innerHTML=`<div class="phead"><div><h1>Showroom QR codes</h1><p>Each QR opens the catalogue at that section or sub-type. Download a card, print it and place it beside the furniture.</p></div>
    <div class="tools"><label class="checks"><input type="checkbox" id="qrSubs"> Show sub-type codes too</label></div></div>
    <p class="help" style="margin-bottom:14px">Links use <code>${esc(base)}</code>. If that is not your public address, set it under Settings.</p>
    <div class="qrgrid">${T.map((t,i)=>`<div class="qrcard" data-small="${t.small?1:0}"${t.small?" hidden":""}><div class="qrimg">${QR.svg(base+(t.h?"#"+t.h:""))}</div><div class="qrinfo"><h3>${esc(t.label)}</h3><code class="qrlink">${esc(base+(t.h?"#"+t.h:""))}</code>
      <div class="qrbtns"><button class="btn" type="button" data-qcopy="${i}">Copy link</button><button class="btn btn-dark" type="button" data-qdl="${i}">Download card</button></div></div></div>`).join("")}</div>`;
  $("#qrSubs").onchange=e=>$$("[data-small='1']").forEach(c=>c.hidden=!e.target.checked);
  $("#panel").onclick=async e=>{
    const c=e.target.closest("[data-qcopy]"), d=e.target.closest("[data-qdl]");
    if(c){ const t=T[+c.dataset.qcopy]; const url=base+(t.h?"#"+t.h:""); try{ await navigator.clipboard.writeText(url); c.textContent="Copied"; setTimeout(()=>c.textContent="Copy link",1400) }catch(_){ toast("Select the link text and copy it") } }
    if(d){ const t=T[+d.dataset.qdl]; const cv=await qrCard(t,base); const a=document.createElement("a"); a.download=`MA-Furniture-QR-${(t.h||"catalogue").replace(/\//g,"-")}.png`; a.href=cv.toDataURL("image/png"); document.body.appendChild(a); a.click(); a.remove() }
  };
}
async function qrCard(t,base){
  const s=CAT.settings||{}, W=1200,H=1650,c=document.createElement("canvas");c.width=W;c.height=H;const x=c.getContext("2d");
  try{ await document.fonts.load('64px "Marcellus"'); await document.fonts.load('600 30px "Figtree"') }catch(e){}
  const serif='"Marcellus",Georgia,serif',sans='"Figtree",Arial,sans-serif';
  x.fillStyle="#FBFAF7";x.fillRect(0,0,W,H);x.fillStyle="#3F2C1F";x.fillRect(0,0,W,250);
  x.textAlign="center";x.fillStyle="#F3EBDD";x.font=`64px ${serif}`;if("letterSpacing" in x)x.letterSpacing="14px";x.fillText(s.brand||"M A FURNITURE",W/2,130);if("letterSpacing" in x)x.letterSpacing="4px";
  x.font=`500 24px ${sans}`;x.fillStyle="#D3A95B";x.fillText((s.subtitle||"").toUpperCase().replace(/,\s*/g," · ").replace(/\s*&\s*/g," · "),W/2,190);if("letterSpacing" in x)x.letterSpacing="0px";
  x.fillStyle="#211C17";x.font=`${t.label.length>18?72:92}px ${serif}`;x.fillText(t.label,W/2,390);
  x.font=`500 32px ${sans}`;x.fillStyle="#665D53";x.fillText(t.sub||"",W/2,450);
  const url=base+(t.h?"#"+t.h:""),n=QR.size(url)+8,px=Math.floor(820/n),qs=n*px,qx=(W-qs)/2,qy=500;
  x.fillStyle="#FFFFFF";x.fillRect(qx,qy,qs,qs);x.strokeStyle="#A3792F";x.lineWidth=4;x.strokeRect(qx-14,qy-14,qs+28,qs+28);QR.draw(x,url,qx+4*px,qy+4*px,px);
  const ty=qy+qs+90;x.fillStyle="#211C17";x.font=`600 44px ${sans}`;x.fillText("Scan to view "+(t.h?t.label:"our catalogue"),W/2,ty);
  x.font=`500 30px ${sans}`;x.fillStyle="#665D53";x.fillText("WhatsApp "+(s.phoneDisplay||""),W/2,ty+60);x.fillText(s.address||"",W/2,ty+105);
  return c;
}

boot();
})();
