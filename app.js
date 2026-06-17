// GreenFrame app — shared across home + all country pages.
// Reads window.COUNTRY_SPECS (from countries.js) and window.GF_START (page default).
import { FaceLandmarker, FilesetResolver }
  from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18";

const SPECS = window.COUNTRY_SPECS || {};
const $ = id => document.getElementById(id);
const el = {
  video:$("video"), feed:$("feed"), hud:$("hud"), frame:$("framewrap"),
  vfEmpty:$("vfEmpty"), badge:$("vfBadge"), gates:$("gates"), verdict:$("verdict"),
  score:$("scoreNum"), status:$("status"), country:$("country"),
  startCam:$("startCam"), capture:$("capture"), upload:$("upload"),
  result:$("result"), resultImg:$("resultImg"), rmeta:$("rmeta"),
  download:$("download"), sheet:$("sheet"), report:$("report"), retake:$("retake")
};
if(!el.gates){ /* page has no tool */ } else { boot(); }

let landmarker=null, imageLandmarker=null, modelReady=false;
let running=false, stream=null, mode="idle", stillImage=null, lastResults=null, prevStatus={}, lastChecks=[];

const FLAG_LABELS={ no_glasses:"Remove glasses (not permitted)", neutral_expression:"Neutral expression — confirm", no_head_covering:"No hat / head covering (unless religious)" };
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const setStatus=t=>{ if(el.status) el.status.textContent=t; };

function boot(){
  // dropdown
  for(const [k,s] of Object.entries(SPECS)){
    const o=document.createElement("option"); o.value=k; o.textContent=`${s.flag} ${s.label}`; el.country.appendChild(o);
  }
  el.country.value = (window.GF_START && SPECS[window.GF_START]) ? window.GF_START : Object.keys(SPECS)[0];
  el.country.addEventListener("change",()=>{ prevStatus={}; renderGates(currentGates()); if(mode==="still"&&stillImage) runStill(); });
  el.startCam.addEventListener("click",()=> running?stopCam():startCam());
  el.capture.addEventListener("click",captureLive);
  el.upload.addEventListener("change",onUpload);
  if(el.retake) el.retake.onclick=()=> el.result.classList.remove("on");
  renderGates(currentGates());
  loadModel();
}

async function loadModel(){
  try{
    const fs=await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm");
    landmarker=await FaceLandmarker.createFromOptions(fs,{
      baseOptions:{ modelAssetPath:"https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" },
      runningMode:"VIDEO", numFaces:2, outputFacialTransformationMatrixes:true });
    modelReady=true; setStatus("Ready. Start the live guide, or check a photo you already have.");
  }catch(e){
    modelReady=false;
    setStatus("The live face model couldn't load here. File, background, sharpness and lighting checks still work on an uploaded photo.");
  }
}

/* ---------- colour / pixel helpers ---------- */
function rgb2lab([r,g,b]){r/=255;g/=255;b/=255;
  r=r>.04045?((r+.055)/1.055)**2.4:r/12.92;g=g>.04045?((g+.055)/1.055)**2.4:g/12.92;b=b>.04045?((b+.055)/1.055)**2.4:b/12.92;
  let x=(r*.4124+g*.3576+b*.1805)/.95047,y=r*.2126+g*.7152+b*.0722,z=(r*.0193+g*.1192+b*.9505)/1.08883;
  const f=t=>t>.008856?Math.cbrt(t):7.787*t+16/116;x=f(x);y=f(y);z=f(z);
  return[116*y-16,500*(x-y),200*(y-z)];}
const deltaE=(a,b)=>{const A=rgb2lab(a),B=rgb2lab(b);return Math.hypot(A[0]-B[0],A[1]-B[1],A[2]-B[2]);};

function analyzeBackground(ctx,w,h,target){
  const b=Math.max(4,Math.round(Math.min(w,h)*.06)), step=Math.max(2,Math.round(w/120)), pts=[];
  for(let x=0;x<w;x+=step){pts.push([x,b>>1]);pts.push([x,h-1-(b>>1)]);}
  for(let y=0;y<h;y+=step){pts.push([b>>1,y]);pts.push([w-1-(b>>1),y]);}
  let r=0,g=0,bl=0,n=0,lum=[];
  for(const[x,y]of pts){const d=ctx.getImageData(x,y,1,1).data;r+=d[0];g+=d[1];bl+=d[2];lum.push(.299*d[0]+.587*d[1]+.114*d[2]);n++;}
  const mean=[r/n,g/n,bl/n],mL=lum.reduce((a,c)=>a+c,0)/n;
  const variance=Math.sqrt(lum.reduce((a,c)=>a+(c-mL)**2,0)/n);
  return{mean,dE:deltaE(mean,target),variance};
}
function analyzeSharpness(ctx,w,h){
  const s=Math.min(256,w),sc=s/w,hh=Math.round(h*sc);
  const t=document.createElement("canvas");t.width=s;t.height=hh;
  const tc=t.getContext("2d");tc.drawImage(ctx.canvas,0,0,s,hh);
  const d=tc.getImageData(0,0,s,hh).data,g=new Float32Array(s*hh);
  for(let i=0;i<s*hh;i++)g[i]=.299*d[i*4]+.587*d[i*4+1]+.114*d[i*4+2];
  let m=0,c=0,v=[];
  for(let y=1;y<hh-1;y++)for(let x=1;x<s-1;x++){const i=y*s+x;const l=4*g[i]-g[i-1]-g[i+1]-g[i-s]-g[i+s];v.push(l);m+=l;c++;}
  m/=c;let va=0;for(const x of v)va+=(x-m)**2;return va/c;
}
function analyzeLighting(ctx,box){
  if(!box)return null;const{x,y,w,h}=box;
  const s=(sx,sy,sw,sh)=>{const d=ctx.getImageData(clamp(sx,0,ctx.canvas.width-1),clamp(sy,0,ctx.canvas.height-1),Math.max(1,sw),Math.max(1,sh)).data;let l=0;for(let i=0;i<d.length;i+=4)l+=.299*d[i]+.587*d[i+1]+.114*d[i+2];return l/(d.length/4);};
  const L=s(x,y,w/2,h),R=s(x+w/2,y,w/2,h);
  return{sideDiff:Math.abs(L-R)/((L+R)/2||1),overall:(L+R)/2};
}

/* ---------- geometry ---------- */
function geometry(lm,w,h){
  const p=i=>({x:lm[i].x*w,y:lm[i].y*h});
  const chin=p(152),brow=p(10),b2c=Math.hypot(chin.x-brow.x,chin.y-brow.y);
  const dir={x:(brow.x-chin.x)/b2c,y:(brow.y-chin.y)/b2c};
  const crown={x:brow.x+dir.x*b2c*.36,y:brow.y+dir.y*b2c*.36};
  const headH=Math.hypot(chin.x-crown.x,chin.y-crown.y);
  const le={x:(lm[159].x+lm[145].x)/2*w,y:(lm[159].y+lm[145].y)/2*h};
  const re={x:(lm[386].x+lm[374].x)/2*w,y:(lm[386].y+lm[374].y)/2*h};
  const eyeY=(le.y+re.y)/2,eyeX=(le.x+re.x)/2;
  const ear=(a,b,c,d)=>Math.abs(lm[a].y-lm[b].y)/(Math.abs(lm[c].x-lm[d].x)||1e-6);
  return{
    headRatio:headH/h, eyeFromBottom:(h-eyeY)/h, centerX:eyeX/w,
    roll:Math.atan2(re.y-le.y,re.x-le.x)*180/Math.PI,
    eyesOpen:(ear(159,145,33,133)+ear(386,374,263,362))/2,
    mouthOpen:Math.abs(lm[13].y-lm[14].y)/(Math.abs(lm[61].x-lm[291].x)||1e-6),
    faceBox:{x:Math.min(crown.x,chin.x)-headH*.4,y:crown.y,w:headH*.8,h:headH}
  };
}

/* ---------- check engine ---------- */
function buildChecks({geo,bg,sharp,light,faceCount,out,spec}){
  const C=[],push=(id,label,status,measured,coach)=>C.push({id,label,status,measured,coach});
  if(geo!==undefined) push("face","One face detected",faceCount===1?"pass":"fail",faceCount===1?"1 face":`${faceCount||0} faces`,faceCount===0?"No face found — move closer and face the camera.":"Only one person may be in frame.");
  if(geo){
    const[hmin,hmax]=spec.headRatio,hr=geo.headRatio;
    push("head","Head size",hr>=hmin&&hr<=hmax?"pass":"fail",`${(hr*100).toFixed(0)}% · ${Math.round(hmin*100)}–${Math.round(hmax*100)}%`,hr<hmin?"Move closer — your head is too small in the frame.":hr>hmax?"Move back — your head fills too much of the frame.":"");
    push("center","Centering",Math.abs(geo.centerX-.5)<.06?"pass":"warn",`${(geo.centerX*100).toFixed(0)}% across`,"Centre your face left-to-right.");
    if(spec.eyeFromBottom){const[a,b]=spec.eyeFromBottom;push("eyes_pos","Eye height",geo.eyeFromBottom>=a&&geo.eyeFromBottom<=b?"pass":"warn",`${(geo.eyeFromBottom*100).toFixed(0)}% up`,"Raise or lower the camera so your eyes sit in the required band.");}
    push("tilt","Head level",Math.abs(geo.roll)<5?"pass":"fail",`${geo.roll.toFixed(1)}°`,"Straighten your head — don't tilt.");
    push("open","Eyes open",geo.eyesOpen>.18?"pass":"warn",geo.eyesOpen>.18?"open":"narrow","Open your eyes fully and look at the lens.");
    push("mouth","Neutral mouth",geo.mouthOpen<.08?"pass":"warn",geo.mouthOpen<.08?"closed":"smiling","Close your mouth — neutral expression.");
  }
  if(bg){
    push("bg_color","Background colour",bg.dE<=spec.background.maxDeltaE?"pass":"fail",`ΔE ${bg.dE.toFixed(0)} · ≤${spec.background.maxDeltaE}`,bg.dE>spec.background.maxDeltaE?"Background reads off-target — usually underexposure. Brighten the scene (face a window) rather than editing.":"");
    push("bg_even","Background even",bg.variance<14?"pass":"warn",`var ${bg.variance.toFixed(0)}`,"Smooth the background — shadows or texture cause rejections.");
  }
  if(light) push("shadow","Even lighting",light.sideDiff<.14?"pass":"warn",`${(light.sideDiff*100).toFixed(0)}% L/R`,"Lighting is uneven — turn toward soft, frontal light.");
  if(sharp!=null) push("sharp","Sharpness",sharp>120?"pass":sharp>60?"warn":"fail",`${sharp.toFixed(0)}`,sharp<=120?"Looks soft — hold steady, use the rear camera, lock focus on your face.":"");
  if(out){
    push("dims","Pixel size",out.okDims?"pass":out.dims?"warn":"idle",out.dims||"—","Auto-sized to spec on export.");
    if(spec.out.maxKB) push("filesize","File size",out.kb==null?"idle":(out.kb<=spec.out.maxKB?"pass":"fail"),out.kb==null?`≤ ${spec.out.maxKB} KB`:`${out.kb} KB · ≤${spec.out.maxKB}`,"Compressed to fit on export.");
  }
  for(const f of(spec.flags||[])) push("flag_"+f,FLAG_LABELS[f]||f,"manual","confirm","GreenFrame can't reliably judge this — check it yourself.");
  return C;
}
const currentGates=()=>buildChecks({geo:null,bg:null,sharp:null,light:null,faceCount:undefined,out:null,spec:SPECS[el.country.value]});

function renderGates(checks){
  lastChecks=checks;
  el.gates.innerHTML="";let pass=0,req=0,fail=0;
  for(const c of checks){
    const justPassed = c.status==="pass" && prevStatus[c.id] && prevStatus[c.id]!=="pass";
    const row=document.createElement("div");
    row.className="gate"+(((c.status==="fail"||c.status==="warn")&&c.coach)?" show-coach":"")+(justPassed?" just-passed":"");
    const sym=c.status==="pass"?"✓":c.status==="fail"?"✕":c.status==="warn"?"!":c.status==="manual"?"?":"·";
    row.innerHTML=`<div class="dot ${c.status}">${sym}</div><div class="body">
      <div class="glabel"><span>${c.label}</span><span class="measured">${c.measured||""}</span></div>
      ${(c.coach&&(c.status==="fail"||c.status==="warn"))?`<div class="coach">${c.coach}</div>`:""}</div>`;
    el.gates.appendChild(row);
    if(justPassed) setTimeout(()=>row.classList.remove("just-passed"),700);
    prevStatus[c.id]=c.status;
    if(c.status!=="manual"&&c.status!=="idle"){req++;if(c.status==="pass")pass++;if(c.status==="fail")fail++;}
  }
  const go=req>0&&fail===0;
  el.frame&&el.frame.classList.toggle("go",go&&mode!=="idle");
  el.badge.className="vf-badge "+(go&&mode!=="idle"?"go":"");
  el.badge.innerHTML=`<span class="blink"></span>${mode==="idle"?"CAMERA OFF":go?"GREEN — CAPTURE":"HOLD"}`;
  el.verdict.className="verdict "+(go?"go":"hold");
  el.verdict.textContent=req===0?"Waiting for a photo…":go?"All required checks pass":"Not ready yet";
  el.score.textContent=req?`${pass}/${req}`:"";
  el.capture.disabled=!(mode==="live"&&go&&modelReady);
}

/* ---------- live ---------- */
async function startCam(){
  if(running)return;
  try{ stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:1280},height:{ideal:1280}},audio:false}); }
  catch(e){ setStatus("Camera permission denied. You can still check an existing photo."); return; }
  el.video.srcObject=stream; await el.video.play();
  el.video.style.display="block"; el.feed.style.display="none"; el.vfEmpty.style.display="none";
  mode="live"; running=true; el.startCam.textContent="Stop camera";
  setStatus("Line up with the guide. The frame turns green and Capture unlocks when every check passes.");
  sizeHud(); requestAnimationFrame(loop);
}
function stopCam(){
  running=false; mode="idle";
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
  el.video.style.display="none"; el.vfEmpty.style.display="block";
  el.startCam.textContent="Start live guide";
  el.hud.getContext("2d").clearRect(0,0,el.hud.width,el.hud.height);
  prevStatus={}; renderGates(currentGates());
}
function sizeHud(){ const r=el.video.parentElement.getBoundingClientRect(); el.hud.width=r.width; el.hud.height=r.height; }
window.addEventListener("resize",()=>{ if(mode==="live")sizeHud(); });

let lastTs=-1;
function loop(){
  if(!running)return;
  const spec=SPECS[el.country.value], vw=el.video.videoWidth, vh=el.video.videoHeight;
  if(vw&&modelReady){
    const now=performance.now(); let res=null;
    if(now!==lastTs){ res=landmarker.detectForVideo(el.video,now); lastTs=now; lastResults=res; }
    drawHud(spec,res||lastResults);
    if(res){
      const mc=document.createElement("canvas");mc.width=vw;mc.height=vh;
      const mx=mc.getContext("2d");mx.drawImage(el.video,0,0,vw,vh);
      const geo=res.faceLandmarks&&res.faceLandmarks[0]?geometry(res.faceLandmarks[0],vw,vh):null;
      const bg=analyzeBackground(mx,vw,vh,spec.background.target), sharp=analyzeSharpness(mx,vw,vh);
      const light=geo?analyzeLighting(mx,geo.faceBox):null;
      renderGates(buildChecks({geo,bg,sharp,light,faceCount:res.faceLandmarks?res.faceLandmarks.length:0,
        out:{okDims:true,dims:`${spec.out.wPx}×${spec.out.hPx}`,kb:null},spec}));
    }
  }
  requestAnimationFrame(loop);
}
function drawHud(spec,res){
  const ctx=el.hud.getContext("2d"),W=el.hud.width,H=el.hud.height; ctx.clearRect(0,0,W,H);
  const midH=(spec.headRatio[0]+spec.headRatio[1])/2*H, cx=W/2, cy=H*.46;
  ctx.save();
  ctx.strokeStyle="rgba(255,255,255,.5)";ctx.lineWidth=2;ctx.setLineDash([7,8]);
  ctx.beginPath();ctx.ellipse(cx,cy,midH*.36,midH*.5,0,0,7);ctx.stroke();
  ctx.setLineDash([2,7]);ctx.strokeStyle="rgba(255,255,255,.16)";
  ctx.beginPath();ctx.moveTo(W/2,0);ctx.lineTo(W/2,H);ctx.stroke();
  ctx.restore();
  if(res&&res.faceLandmarks&&res.faceLandmarks[0]){
    const lm=res.faceLandmarks[0];
    const le={x:(lm[159].x+lm[145].x)/2,y:(lm[159].y+lm[145].y)/2},re={x:(lm[386].x+lm[374].x)/2,y:(lm[386].y+lm[374].y)/2};
    ctx.strokeStyle="rgba(17,168,97,.95)";ctx.lineWidth=2;ctx.setLineDash([]);
    ctx.beginPath();ctx.moveTo(le.x*W,le.y*H);ctx.lineTo(re.x*W,re.y*H);ctx.stroke();
  }
}

/* ---------- upload ---------- */
function onUpload(e){
  const f=e.target.files[0]; if(!f)return;
  if(running) stopCam();
  const img=new Image(); img.onload=()=>{ stillImage=img; mode="still"; runStill(); }; img.src=URL.createObjectURL(f);
  el.vfEmpty.style.display="none";
}
function runStill(){
  const spec=SPECS[el.country.value], img=stillImage, w=img.naturalWidth, h=img.naturalHeight;
  const mc=document.createElement("canvas");mc.width=w;mc.height=h;const mx=mc.getContext("2d");mx.drawImage(img,0,0);
  el.feed.style.display="block";el.video.style.display="none";el.feed.width=w;el.feed.height=h;el.feed.getContext("2d").drawImage(img,0,0,w,h);
  const bg=analyzeBackground(mx,w,h,spec.background.target), sharp=analyzeSharpness(mx,w,h);
  detectStill(img,w,h).then(det=>{
    const geo=det.geo, light=geo?analyzeLighting(mx,geo.faceBox):null;
    lastResults=det.raw||null;
    renderGates(buildChecks({geo,bg,sharp,light,faceCount:det.count,
      out:{okDims:false,dims:`${w}×${h} → ${spec.out.wPx}×${spec.out.hPx}`,kb:null},spec}));
    setStatus("Checked. Fix any red items, or capture fresh with the live guide for real-time help.");
  });
}
async function detectStill(img,w,h){
  if(!modelReady)return{geo:null,count:undefined};
  try{
    if(!imageLandmarker){
      const fs=await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm");
      imageLandmarker=await FaceLandmarker.createFromOptions(fs,{baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"},runningMode:"IMAGE",numFaces:2,outputFacialTransformationMatrixes:true});
    }
    const r=imageLandmarker.detect(img), count=r.faceLandmarks?r.faceLandmarks.length:0;
    return{geo:count?geometry(r.faceLandmarks[0],w,h):null,count,raw:r};
  }catch(e){ return{geo:null,count:undefined}; }
}

/* ---------- export + print sheet ---------- */
function makePhoto(src,sw,sh){
  const spec=SPECS[el.country.value], aspect=spec.out.wPx/spec.out.hPx;
  const g=lastResults&&lastResults.faceLandmarks&&lastResults.faceLandmarks[0]?geometry(lastResults.faceLandmarks[0],sw,sh):null;
  const mid=(spec.headRatio[0]+spec.headRatio[1])/2;
  let cropH,cropW,cx,cy;
  if(g){ cropH=(g.headRatio*sh)/mid; cropW=cropH*aspect; cx=g.centerX*sw; cy=g.faceBox.y+g.faceBox.h*.5-cropH*.04; }
  else { cropH=Math.min(sh,sw/aspect); cropW=cropH*aspect; cx=sw/2; cy=sh/2; }
  const sx=clamp(cx-cropW/2,0,sw-cropW), sy=clamp(cy-cropH/2,0,sh-cropH);
  const out=document.createElement("canvas");out.width=spec.out.wPx;out.height=spec.out.hPx;
  out.getContext("2d").drawImage(src,sx,sy,cropW,cropH,0,0,spec.out.wPx,spec.out.hPx);
  let q=.92,url=out.toDataURL("image/jpeg",q);
  if(spec.out.maxKB){let lo=.4,hi=.95;for(let i=0;i<7;i++){q=(lo+hi)/2;url=out.toDataURL("image/jpeg",q);(Math.round(url.length*.75/1024)>spec.out.maxKB)?hi=q:lo=q;}}
  return{url,kb:Math.round(url.length*.75/1024),spec,canvas:out};
}
function captureLive(){
  const vw=el.video.videoWidth,vh=el.video.videoHeight;
  const c=document.createElement("canvas");c.width=vw;c.height=vh;c.getContext("2d").drawImage(el.video,0,0,vw,vh);
  showResult(makePhoto(c,vw,vh));
}
let lastResult=null;
function showResult(r){
  lastResult=r; el.result.classList.add("on"); el.resultImg.src=r.url;
  const km=r.spec.out.maxKB?` · ${r.kb} KB (≤${r.spec.out.maxKB})`:"";
  el.rmeta.innerHTML=`<b>${r.spec.flag} ${r.spec.label}</b><br>${r.spec.out.wPx}×${r.spec.out.hPx} px · JPEG${km}<br>print ${r.spec.out.printMM[0]}×${r.spec.out.printMM[1]} mm @ ${r.spec.out.dpi} dpi`;
  el.download.onclick=()=>{const a=document.createElement("a");a.href=r.url;a.download=`greenframe-${el.country.value}.jpg`;a.click();};
  if(el.sheet) el.sheet.onclick=()=>printSheet(r);
  if(el.report) el.report.onclick=()=>downloadReport(r);
  el.result.scrollIntoView({behavior:"smooth",block:"nearest"});
}

// Downloadable compliance report card (PNG) — the "proof" artifact.
function downloadReport(r){
  const checks=lastChecks.filter(c=>c.status!=="idle");
  const W=1000, pad=48, rowH=54, headH=210, footH=170;
  const H=headH + checks.length*rowH + footH;
  const c=document.createElement("canvas"); c.width=W; c.height=H;
  const x=c.getContext("2d");
  const COL={pass:"#11A861",fail:"#CC5544",warn:"#C2871F",manual:"#8A988F",ink:"#0E1A14",mist:"#5A6B61",line:"#D6DDD3"};
  x.fillStyle="#FBFCFA"; x.fillRect(0,0,W,H);
  // mark
  x.strokeStyle=COL.pass; x.lineWidth=4; roundRect(x,pad,pad,40,40,9); x.stroke();
  x.fillStyle=COL.ink; x.font="800 30px Inter,Arial,sans-serif"; x.fillText("GreenFrame", pad+56, pad+30);
  x.fillStyle=COL.mist; x.font="600 16px Inter,Arial,sans-serif"; x.fillText("Compliance report", pad+56, pad+52);
  // country + date
  x.fillStyle=COL.ink; x.font="700 22px Inter,Arial,sans-serif";
  x.fillText(`${r.spec.flag}  ${r.spec.label}`, pad, pad+108);
  x.fillStyle=COL.mist; x.font="400 15px Inter,Arial,sans-serif";
  x.fillText(new Date().toLocaleString(), pad, pad+134);
  // photo thumb
  const tw=150, th=Math.round(tw*(r.spec.out.hPx/r.spec.out.wPx));
  x.drawImage(r.canvas, W-pad-tw, pad, tw, th);
  x.strokeStyle=COL.line; x.lineWidth=1; x.strokeRect(W-pad-tw, pad, tw, th);
  // divider
  x.strokeStyle=COL.line; x.beginPath(); x.moveTo(pad,headH-16); x.lineTo(W-pad,headH-16); x.stroke();
  // rows
  let y=headH+8, passN=0, reqN=0;
  for(const ch of checks){
    if(ch.status!=="manual"){reqN++; if(ch.status==="pass")passN++;}
    const cy=y+rowH/2;
    x.fillStyle=COL[ch.status]||COL.mist;
    x.beginPath(); x.arc(pad+14, cy, 12, 0, 7); x.fill();
    x.fillStyle="#fff"; x.font="700 14px Inter,Arial,sans-serif"; x.textAlign="center";
    x.fillText(ch.status==="pass"?"✓":ch.status==="fail"?"✕":ch.status==="warn"?"!":"?", pad+14, cy+5);
    x.textAlign="left";
    x.fillStyle=COL.ink; x.font="600 17px Inter,Arial,sans-serif"; x.fillText(ch.label, pad+40, cy+6);
    x.fillStyle=COL.mist; x.font="400 15px Inter,Arial,sans-serif"; x.textAlign="right";
    x.fillText(ch.measured||"", W-pad, cy+6); x.textAlign="left";
    x.strokeStyle="#EEF2EC"; x.beginPath(); x.moveTo(pad,y+rowH); x.lineTo(W-pad,y+rowH); x.stroke();
    y+=rowH;
  }
  // verdict
  const go=reqN>0 && passN===reqN;
  y+=24;
  x.fillStyle=go?"#E1F2E8":"#F6ECD7"; roundRect(x,pad,y,W-pad*2,52,12); x.fill();
  x.fillStyle=go?COL.pass:COL.warn; x.font="800 19px Inter,Arial,sans-serif";
  x.fillText(go?`✓  All ${reqN} required checks pass`:`${passN}/${reqN} required checks pass — review the items above`, pad+18, y+33);
  // footer
  y+=80;
  x.fillStyle=COL.mist; x.font="400 13px Inter,Arial,sans-serif";
  wrapText(x,"GreenFrame measures the published specification and cannot guarantee acceptance — the issuing authority makes the final call. No AI edits were applied to the photo.",pad,y,W-pad*2,18);
  x.fillStyle=COL.pass; x.font="600 14px Inter,Arial,sans-serif";
  x.fillText(`Official requirements: ${r.spec.officialUrl||""}`, pad, y+54);
  const a=document.createElement("a"); a.href=c.toDataURL("image/png"); a.download=`greenframe-${el.country.value}-report.png`; a.click();
}
function roundRect(x,X,Y,w,h,r){x.beginPath();x.moveTo(X+r,Y);x.arcTo(X+w,Y,X+w,Y+h,r);x.arcTo(X+w,Y+h,X,Y+h,r);x.arcTo(X,Y+h,X,Y,r);x.arcTo(X,Y,X+w,Y,r);x.closePath();}
function wrapText(x,t,X,Y,maxW,lh){const words=t.split(" ");let line="",yy=Y;for(const w of words){const test=line+w+" ";if(x.measureText(test).width>maxW&&line){x.fillText(line,X,yy);line=w+" ";yy+=lh;}else line=test;}x.fillText(line,X,yy);}
// 4x6in @300dpi print sheet, tiled with the photo at its physical mm size
function printSheet(r){
  const DPI=300, sheetW=Math.round(6*DPI), sheetH=Math.round(4*DPI);
  const pw=Math.round(r.spec.out.printMM[0]/25.4*DPI), ph=Math.round(r.spec.out.printMM[1]/25.4*DPI);
  const gap=Math.round(.08*DPI), cols=Math.floor((sheetW+gap)/(pw+gap)), rows=Math.floor((sheetH+gap)/(ph+gap));
  const c=document.createElement("canvas");c.width=sheetW;c.height=sheetH;const x=c.getContext("2d");
  x.fillStyle="#fff";x.fillRect(0,0,sheetW,sheetH);
  const totW=cols*pw+(cols-1)*gap, totH=rows*ph+(rows-1)*gap, ox=(sheetW-totW)/2, oy=(sheetH-totH)/2;
  for(let rI=0;rI<rows;rI++)for(let cI=0;cI<cols;cI++){
    const px=ox+cI*(pw+gap), py=oy+rI*(ph+gap);
    x.drawImage(r.canvas,px,py,pw,ph);
    x.strokeStyle="#D6DDD3";x.lineWidth=1;x.strokeRect(px,py,pw,ph);
  }
  const a=document.createElement("a");a.href=c.toDataURL("image/jpeg",.92);a.download=`greenframe-${el.country.value}-4x6sheet.jpg`;a.click();
}
