/* Minimal QR Code encoder (byte mode, versions 1-10, ECC M). Based on the public QR spec / Nayuki's reference design. */
const QR=(()=>{
  const ECC={L:[1,[-1,7,10,15,20,26,18,20,24,30,18],[-1,1,1,1,1,1,2,2,2,2,4]],
             M:[0,[-1,10,16,26,18,24,16,18,22,22,26],[-1,1,1,1,2,2,4,4,4,5,5]]};
  const mul=(x,y)=>{let z=0;for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11D);z^=((y>>>i)&1)*x}return z&255};
  const rsDiv=d=>{const r=new Array(d).fill(0);r[d-1]=1;let root=1;for(let i=0;i<d;i++){for(let j=0;j<d;j++){r[j]=mul(r[j],root);if(j+1<d)r[j]^=r[j+1]}root=mul(root,2)}return r};
  const rsRem=(data,div)=>{const r=div.map(()=>0);for(const b of data){const f=b^r.shift();r.push(0);div.forEach((c,i)=>r[i]^=mul(c,f))}return r};
  const rawMods=v=>{let r=(16*v+128)*v+64;if(v>=2){const n=Math.floor(v/7)+2;r-=(25*n-10)*n-55;if(v>=7)r-=36}return r};
  const bit=(x,i)=>((x>>>i)&1)!==0;
  function encode(text,level="M"){
    const bytes=Array.from(new TextEncoder().encode(text));
    const [fmt,EPB,NB]=ECC[level];
    let ver,cap;
    for(ver=1;ver<=10;ver++){cap=Math.floor(rawMods(ver)/8)-EPB[ver]*NB[ver];const need=4+(ver<=9?8:16)+bytes.length*8;if(need<=cap*8)break}
    if(ver>10) throw new Error("Text too long for QR");
    const bb=[];const app=(v,n)=>{for(let i=n-1;i>=0;i--)bb.push((v>>>i)&1)};
    app(4,4);app(bytes.length,ver<=9?8:16);bytes.forEach(b=>app(b,8));
    app(0,Math.min(4,cap*8-bb.length));app(0,(8-bb.length%8)%8);
    for(let p=0xEC;bb.length<cap*8;p^=0xEC^0x11)app(p,8);
    const data=[];for(let i=0;i<bb.length;i+=8){let v=0;for(let j=0;j<8;j++)v=(v<<1)|bb[i+j];data.push(v)}
    // ECC + interleave
    const nb=NB[ver],el=EPB[ver],raw=Math.floor(rawMods(ver)/8),nShort=nb-raw%nb,shortLen=Math.floor(raw/nb),div=rsDiv(el);
    const blocks=[];for(let i=0,k=0;i<nb;i++){const dat=data.slice(k,k+shortLen-el+(i<nShort?0:1));k+=dat.length;const ecc=rsRem(dat,div);if(i<nShort)dat.push(0);blocks.push(dat.concat(ecc))}
    const all=[];for(let i=0;i<blocks[0].length;i++)blocks.forEach((b,j)=>{if(i!==shortLen-el||j>=nShort)all.push(b[i])});
    // matrix
    const size=ver*4+17,M=[...Array(size)].map(()=>Array(size).fill(false)),F=[...Array(size)].map(()=>Array(size).fill(false));
    const set=(x,y,d)=>{M[y][x]=d;F[y][x]=true};
    for(let i=0;i<size;i++){set(6,i,i%2===0);set(i,6,i%2===0)}
    const finder=(x,y)=>{for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const d=Math.max(Math.abs(dx),Math.abs(dy)),xx=x+dx,yy=y+dy;if(xx>=0&&xx<size&&yy>=0&&yy<size)set(xx,yy,d!==2&&d!==4)}};
    finder(3,3);finder(size-4,3);finder(3,size-4);
    const al=[];if(ver>1){const n=Math.floor(ver/7)+2,step=Math.ceil((ver*4+4)/(n*2-2))*2;al.push(6);for(let p=size-7;al.length<n;p-=step)al.splice(1,0,p)}
    al.forEach((a,i)=>al.forEach((b,j)=>{if((i===0&&j===0)||(i===0&&j===al.length-1)||(i===al.length-1&&j===0))return;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(a+dx,b+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1)}));
    const drawFormat=mask=>{const d=fmt<<3|mask;let r=d;for(let i=0;i<10;i++)r=(r<<1)^((r>>>9)*0x537);const bits=(d<<10|r)^0x5412;
      for(let i=0;i<=5;i++)set(8,i,bit(bits,i));set(8,7,bit(bits,6));set(8,8,bit(bits,7));set(7,8,bit(bits,8));for(let i=9;i<15;i++)set(14-i,8,bit(bits,i));
      for(let i=0;i<8;i++)set(size-1-i,8,bit(bits,i));for(let i=8;i<15;i++)set(8,size-15+i,bit(bits,i));set(8,size-8,true)};
    drawFormat(0);
    if(ver>=7){let r=ver;for(let i=0;i<12;i++)r=(r<<1)^((r>>>11)*0x1F25);const bits=ver<<12|r;for(let i=0;i<18;i++){const b=bit(bits,i),a=size-11+i%3,c=Math.floor(i/3);set(a,c,b);set(c,a,b)}}
    let i=0;for(let right=size-1;right>=1;right-=2){if(right===6)right=5;for(let v=0;v<size;v++)for(let j=0;j<2;j++){const x=right-j,up=((right+1)&2)===0,y=up?size-1-v:v;if(!F[y][x]&&i<all.length*8){M[y][x]=bit(all[i>>>3],7-(i&7));i++}}}
    const maskFn=[(x,y)=>(x+y)%2===0,(x,y)=>y%2===0,(x,y)=>x%3===0,(x,y)=>(x+y)%3===0,(x,y)=>(Math.floor(x/3)+Math.floor(y/2))%2===0,(x,y)=>x*y%2+x*y%3===0,(x,y)=>(x*y%2+x*y%3)%2===0,(x,y)=>((x+y)%2+x*y%3)%2===0];
    const applyMask=m=>{for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(!F[y][x]&&maskFn[m](x,y))M[y][x]=!M[y][x]};
    const penalty=()=>{let p=0,dark=0;for(let y=0;y<size;y++){for(let k=0;k<2;k++){let run=1;for(let x=1;x<size;x++){const a=k?M[x][y]:M[y][x],b=k?M[x-1][y]:M[y][x-1];if(a===b){run++;if(run===5)p+=3;else if(run>5)p++}else run=1}}}
      for(let y=0;y<size-1;y++)for(let x=0;x<size-1;x++){const c=M[y][x];if(c===M[y][x+1]&&c===M[y+1][x]&&c===M[y+1][x+1])p+=3}
      M.forEach(r=>r.forEach(c=>{if(c)dark++}));p+=Math.floor(Math.abs(dark*20-size*size*10)/(size*size))*10;return p};
    let best=0,bestP=Infinity;for(let m=0;m<8;m++){applyMask(m);drawFormat(m);const p=penalty();if(p<bestP){bestP=p;best=m}applyMask(m)}
    applyMask(best);drawFormat(best);
    return {size,get:(x,y)=>M[y][x]};
  }
  function svg(text,{quiet=4,dark="#000",light="#fff"}={}){
    const q=encode(text),n=q.size+quiet*2;let d="";
    for(let y=0;y<q.size;y++)for(let x=0;x<q.size;x++)if(q.get(x,y))d+=`M${x+quiet},${y+quiet}h1v1h-1z`;
    return `<svg viewBox="0 0 ${n} ${n}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" role="img"><rect width="${n}" height="${n}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
  }
  function draw(ctx,text,x0,y0,px){const q=encode(text);ctx.fillStyle="#000";for(let y=0;y<q.size;y++)for(let x=0;x<q.size;x++)if(q.get(x,y))ctx.fillRect(x0+x*px,y0+y*px,px,px);return q.size*px}
  return {encode,svg,draw,size:t=>encode(t).size};
})();
