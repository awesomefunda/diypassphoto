// DIYPassPhoto app — shared across home + all country pages.
// Reads window.COUNTRY_SPECS (from countries.js) and window.GF_START (page default).
import { FaceLandmarker, FilesetResolver }
  from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18";
import { buildChecks, cropRect } from "./lib/core.mjs?v=25";

const SPECS = window.COUNTRY_SPECS || {};
const $ = id => document.getElementById(id);
const el = {
  video:$("video"), feed:$("feed"), hud:$("hud"), frame:$("framewrap"),
  vfEmpty:$("vfEmpty"), gates:$("gates"), verdict:$("verdict"),
  score:$("scoreNum"), status:$("status"), country:$("country"),
  vfStart:$("vfStart"), upload:$("upload"),
  vfMsg:$("vfMsg"), vfShutter:$("vfShutter"), vfCapture:$("vfCapture"), vfFlip:$("vfFlip"), vfClose:$("vfClose"),
  result:$("result"), resultImg:$("resultImg"), rmeta:$("rmeta"),
  download:$("download"), downloadUpload:$("downloadUpload"), sheet:$("sheet"), report:$("report"), retake:$("retake"), share:$("share")
};
let landmarker=null, imageLandmarker=null, modelReady=false;
let running=false, stream=null, mode="idle", stillImage=null, lastResults=null, prevStatus={}, lastChecks=[];
let facing="user"; // "user" = selfie (default), "environment" = rear
let autoTimer=null, autoCount=0; // hands-free auto-capture countdown

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const setStatus=t=>{ if(el.status) el.status.textContent=t; };

function boot(){
  // dropdown
  for(const [k,s] of Object.entries(SPECS)){
    const o=document.createElement("option"); o.value=k; o.textContent=s.label; el.country.appendChild(o);
  }
  el.country.value = (window.GF_START && SPECS[window.GF_START]) ? window.GF_START : Object.keys(SPECS)[0];
  el.country.addEventListener("change",()=>{ prevStatus={}; renderGates(currentGates()); if(mode==="still"&&stillImage) runStill(); });
  if(el.vfStart) el.vfStart.addEventListener("click",startCam);
  if(el.vfFlip) el.vfFlip.addEventListener("click",flipCamera);
  if(el.vfCapture) el.vfCapture.addEventListener("click",captureLive);
  if(el.vfClose) el.vfClose.addEventListener("click",stopCam);
  el.upload.addEventListener("change",onUpload);
  if(el.retake) el.retake.onclick=resetToIdle;
  renderGates(currentGates());
  loadModel();
}

async function loadModel(){
  try{
    const fs=await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm");
    landmarker=await FaceLandmarker.createFromOptions(fs,{
      baseOptions:{ modelAssetPath:"https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" },
      runningMode:"VIDEO", numFaces:2, outputFacialTransformationMatrixes:true });
    modelReady=true; setStatus("Ready. Tap the camera button to start, or check a photo you already have.");
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
  const b=Math.max(4,Math.round(Math.min(w,h)*.06)), step=Math.max(3,Math.round(w/110));
  const edges=[[],[],[],[]]; // ordered luminance along top, bottom, left, right
  let r=0,g=0,bl=0,n=0;
  // sample a denoised 3x3 average per point so fine wall texture doesn't read as clutter
  const samp=(px,py,e)=>{
    const x=clamp(px-1,0,w-3), y=clamp(py-1,0,h-3);
    const d=ctx.getImageData(x,y,3,3).data; let R=0,G=0,B=0;
    for(let i=0;i<d.length;i+=4){R+=d[i];G+=d[i+1];B+=d[i+2];}
    R/=9;G/=9;B/=9; r+=R;g+=G;bl+=B;n++;
    edges[e].push(.299*R+.587*G+.114*B);
  };
  for(let x=0;x<w;x+=step){ samp(x,b>>1,0); samp(x,h-1-(b>>1),1); }
  for(let y=0;y<h;y+=step){ samp(b>>1,y,2); samp(w-1-(b>>1),y,3); }
  const mean=[r/n,g/n,bl/n];
  const lab=rgb2lab(mean), L=lab[0], chroma=Math.hypot(lab[1],lab[2]);
  // texture/pattern = local (adjacent) contrast along each edge; a smooth gradient stays low
  let diff=0,dc=0;
  for(const e of edges) for(let i=1;i<e.length;i++){ diff+=Math.abs(e[i]-e[i-1]); dc++; }
  const rough=dc?diff/dc:0;
  return{mean,dE:deltaE(mean,target),L,chroma,rough};
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

/* ---------- check engine + crop live in lib/core.mjs (imported above) ---------- */
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
  // The shutter unlocks as soon as a face is found — head size & eye height are
  // auto-corrected when we crop to spec, so we never hard-block on them. The green
  // ring still signals full compliance, but you can always capture and review.
  const faceCheck=checks.find(c=>c.id==="face");
  const faceOk=faceCheck?faceCheck.status==="pass":false;
  const canCap=mode==="live"&&(faceOk||!modelReady);
  el.frame&&el.frame.classList.toggle("go",go&&mode!=="idle");
  el.verdict.className="verdict "+(go?"go":"hold");
  el.verdict.textContent=req===0?"Waiting for a photo…":go?"All required checks pass":"Not ready yet";
  el.score.textContent=req?`${pass}/${req}`:"";
  if(el.vfCapture) el.vfCapture.disabled=!canCap;
  // hands-free auto-capture: when everything passes, count down and snap automatically
  if(mode==="live" && go && canCap && faceOk && modelReady) startAutoCapture(); else cancelAutoCapture();
  // in-frame issue list — every gate that needs attention, each with how to fix it
  if(el.vfMsg){
    el.vfMsg.innerHTML="";
    if(mode!=="live"){ el.vfMsg.className="vf-msg"; }
    else if(!faceOk&&modelReady){
      el.vfMsg.className="vf-msg show";
      el.vfMsg.appendChild(chip("warn","Position your face inside the oval."));
    } else if(go){
      el.vfMsg.className="vf-msg show";
      el.vfMsg.appendChild(chip("go", autoTimer!==null ? `Hold still — capturing in ${autoCount}…` : "✓ Looks good — tap the shutter"));
    } else {
      el.vfMsg.className="vf-msg show";
      const issues=checks.filter(c=>(c.status==="fail"||c.status==="warn")&&c.coach&&c.id!=="face")
        .sort((a,b)=>(a.status==="fail"?0:1)-(b.status==="fail"?0:1)); // fails first
      const MAX=3;
      issues.slice(0,MAX).forEach(c=>el.vfMsg.appendChild(chip(c.status,c.coach)));
      if(issues.length>MAX) el.vfMsg.appendChild(chip("more",`+${issues.length-MAX} more to fix`));
    }
  }
}
function chip(status,text){
  const d=document.createElement("div"); d.className="vf-chip "+status;
  if(status!=="go"&&status!=="more"){ const dot=document.createElement("span"); dot.className="cdot"; d.appendChild(dot); }
  const s=document.createElement("span"); s.textContent=text; d.appendChild(s);
  return d;
}
function startAutoCapture(){
  if(autoTimer!==null) return;           // already counting
  autoCount=3;
  autoTimer=setInterval(()=>{
    if(!running){ cancelAutoCapture(); return; }
    autoCount--;
    if(autoCount<=0){ cancelAutoCapture(); captureLive(); }
  },1000);
}
function cancelAutoCapture(){ if(autoTimer!==null){ clearInterval(autoTimer); autoTimer=null; } }

/* ---------- live ---------- */
async function startCam(){
  if(running)return;
  document.body.classList.remove("has-shot"); el.result.classList.remove("on"); // fresh session — hide prior result + checklist
  try{ stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facing},width:{ideal:1920},height:{ideal:1080}},audio:false}); }
  catch(e){ setStatus("Camera not available ("+e.name+"). Use 'Check a photo' below to upload one instead."); return; }
  try{ el.video.srcObject=stream; await el.video.play(); }
  catch(e){ setStatus("Camera started but couldn't play ("+e.name+"). Try 'Check a photo' instead."); stopCam(); return; }
  // Mirror the selfie view so it reads naturally; rear camera shows un-mirrored.
  el.video.style.transform = facing==="user" ? "scaleX(-1)" : "none";
  el.video.style.display="block"; el.feed.style.display="none"; el.vfEmpty.style.display="none";
  mode="live"; running=true;
  document.body.classList.add("cam-live");
  setStatus("Line up inside the oval — fixes show on screen. Tap the shutter when you're ready; the full check appears after.");
  sizeHud(); requestAnimationFrame(loop);
}
function stopCam(){
  running=false; mode="idle"; cancelAutoCapture();
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
  el.video.style.display="none"; el.vfEmpty.style.display="block";
  document.body.classList.remove("cam-live");
  if(el.vfMsg){ el.vfMsg.className="vf-msg"; el.vfMsg.innerHTML=""; }
  el.hud.getContext("2d").clearRect(0,0,el.hud.width,el.hud.height);
  prevStatus={};
  // keep the captured photo's checklist on screen; only reset gates if nothing was shot
  if(!document.body.classList.contains("has-shot")) renderGates(currentGates());
}
async function flipCamera(){
  facing = facing==="user" ? "environment" : "user";
  if(running){ stream&&stream.getTracks().forEach(t=>t.stop()); running=false; await startCam(); }
}
function sizeHud(){ const r=el.video.parentElement.getBoundingClientRect(); el.hud.width=r.width; el.hud.height=r.height; }
window.addEventListener("resize",()=>{ if(mode==="live")sizeHud(); });
window.addEventListener("orientationchange",()=>{ if(mode==="live")setTimeout(sizeHud,250); });

let lastTs=-1;
function loop(){
  if(!running)return;
  const spec=SPECS[el.country.value], vw=el.video.videoWidth, vh=el.video.videoHeight;
  if(vw){
    const mc=document.createElement("canvas");mc.width=vw;mc.height=vh;
    const mx=mc.getContext("2d");mx.drawImage(el.video,0,0,vw,vh);
    let geo=null, faceCount=0, res=null;
    if(modelReady){
      const now=performance.now();
      if(now!==lastTs){ res=landmarker.detectForVideo(el.video,now); lastTs=now; lastResults=res; }
      else { res=lastResults; }
      if(res&&res.faceLandmarks&&res.faceLandmarks[0]){
        geo=geometry(res.faceLandmarks[0],vw,vh);
        faceCount=res.faceLandmarks.length;
      }
    }
    drawHud(spec,res||lastResults);
    const bg=analyzeBackground(mx,vw,vh,spec.background.target);
    const sharp=analyzeSharpness(mx,vw,vh);
    const light=geo?analyzeLighting(mx,geo.faceBox):null;
    renderGates(buildChecks({geo,bg,sharp,light,faceCount,
      out:{okDims:true,dims:`${spec.out.wPx}×${spec.out.hPx}`,kb:null},spec}));
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
  e.target.value=""; // allow re-selecting the same file later
}
// Return to the clean start screen (used by Retake) so the camera AND the
// "check a photo" upload are both available again.
function resetToIdle(){
  if(running) stopCam();
  mode="idle"; stillImage=null;
  el.result.classList.remove("on"); document.body.classList.remove("has-shot");
  el.feed.style.display="none"; el.video.style.display="none"; el.vfEmpty.style.display="block";
  if(el.upload) el.upload.value="";
  prevStatus={}; renderGates(currentGates());
  el.frame && el.frame.scrollIntoView({behavior:"smooth",block:"center"});
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
    showResult(makePhoto(img,w,h));
    setStatus("Checked. Review the items below, or start the camera for real-time help.");
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
  const spec=SPECS[el.country.value];
  const g=lastResults&&lastResults.faceLandmarks&&lastResults.faceLandmarks[0]?geometry(lastResults.faceLandmarks[0],sw,sh):null;
  const {sx,sy,cropW,cropH}=cropRect(g,spec,sw,sh);
  const out=document.createElement("canvas");out.width=spec.out.wPx;out.height=spec.out.hPx;
  const octx=out.getContext("2d"); octx.fillStyle="#fff"; octx.fillRect(0,0,spec.out.wPx,spec.out.hPx); // white safety fill — no black edges
  octx.drawImage(src,sx,sy,cropW,cropH,0,0,spec.out.wPx,spec.out.hPx);
  const {url,kb}=encodeJPEG(out,spec.out.maxKB);
  return{url,kb,spec,canvas:out};
}
// Encode a canvas to JPEG, binary-searching quality to land under maxKB (if given).
function encodeJPEG(canvas,maxKB){
  let q=.92,url=canvas.toDataURL("image/jpeg",q);
  if(maxKB){let lo=.35,hi=.95;for(let i=0;i<8;i++){q=(lo+hi)/2;url=canvas.toDataURL("image/jpeg",q);(Math.round(url.length*.75/1024)>maxKB)?hi=q:lo=q;}}
  return{url,kb:Math.round(url.length*.75/1024)};
}
function captureLive(){
  cancelAutoCapture();
  const vw=el.video.videoWidth,vh=el.video.videoHeight;
  if(!vw||!vh) return;
  const c=document.createElement("canvas");c.width=vw;c.height=vh;const cx=c.getContext("2d");cx.drawImage(el.video,0,0,vw,vh);
  // freeze the compliance check against the exact frame we captured
  const spec=SPECS[el.country.value];
  const bg=analyzeBackground(cx,vw,vh,spec.background.target), sharp=analyzeSharpness(cx,vw,vh);
  const g=lastResults&&lastResults.faceLandmarks&&lastResults.faceLandmarks[0]?geometry(lastResults.faceLandmarks[0],vw,vh):null;
  const light=g?analyzeLighting(cx,g.faceBox):null;
  const faceCount=lastResults&&lastResults.faceLandmarks?lastResults.faceLandmarks.length:0;
  showResult(makePhoto(c,vw,vh));
  renderGates(buildChecks({geo:g,bg,sharp,light,faceCount,out:{okDims:true,dims:`${spec.out.wPx}×${spec.out.hPx}`,kb:null},spec}));
  stopCam(); // stop the live feed; the captured photo + its checklist stay on screen
}
let lastResult=null;
function showResult(r){
  lastResult=r; el.result.classList.add("on"); document.body.classList.add("has-shot"); el.resultImg.src=r.url;
  const km=r.spec.out.maxKB?` · ${r.kb} KB (≤${r.spec.out.maxKB})`:"";
  el.rmeta.innerHTML=`<b>${r.spec.label}</b><br>${r.spec.out.wPx}×${r.spec.out.hPx} px · JPEG${km}<br>print ${r.spec.out.printMM[0]}×${r.spec.out.printMM[1]} mm @ ${r.spec.out.dpi} dpi`;
  el.download.onclick=()=>{const a=document.createElement("a");a.href=r.url;a.download=`diypassphoto-${el.country.value}.jpg`;a.click();};
  // Separate upload-sized file where the spec has a digital KB cap (e.g. India e-Visa ≤300 KB)
  if(el.downloadUpload){
    const uk=r.spec.out.uploadKB;
    if(uk){
      el.downloadUpload.style.display="";
      el.downloadUpload.textContent=`Download for upload (≤${uk} KB)`;
      el.download.textContent="Download for print";
      el.downloadUpload.onclick=()=>{const {url}=encodeJPEG(r.canvas,uk);const a=document.createElement("a");a.href=url;a.download=`diypassphoto-${el.country.value}-upload.jpg`;a.click();};
    } else {
      el.downloadUpload.style.display="none";
      el.download.textContent="Download";
    }
  }
  if(el.sheet) el.sheet.onclick=()=>printSheet(r);
  if(el.report) el.report.onclick=()=>downloadReport(r);
  // One-tap Save/Share — native share sheet on mobile (Save to Photos, message, email, print).
  if(el.share){
    const supported = !!(navigator.canShare && navigator.share);
    el.share.style.display = supported ? "" : "none";
    el.download.classList.toggle("go", !supported); // download is primary only when share is unavailable
    el.share.onclick=()=>sharePhoto(r);
  }
  el.result.scrollIntoView({behavior:"smooth",block:"nearest"});
}
function dataURLtoBlob(u){
  const b64=u.split(",")[1], bin=atob(b64), arr=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  return new Blob([arr],{type:"image/jpeg"});
}
function sharePhoto(r){
  const name=`diypassphoto-${el.country.value}.jpg`;
  const file=new File([dataURLtoBlob(r.url)],name,{type:"image/jpeg"});
  if(navigator.canShare && navigator.canShare({files:[file]})){
    navigator.share({files:[file],title:"Passport photo",text:`${r.spec.label} — made with DIYPassPhoto`}).catch(()=>{});
  } else {
    const a=document.createElement("a");a.href=r.url;a.download=name;a.click();
  }
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
  x.fillStyle=COL.ink; x.font="800 30px Inter,Arial,sans-serif"; x.fillText("DIYPassPhoto", pad+56, pad+30);
  x.fillStyle=COL.mist; x.font="600 16px Inter,Arial,sans-serif"; x.fillText("Compliance report", pad+56, pad+52);
  // country + date
  x.fillStyle=COL.ink; x.font="700 22px Inter,Arial,sans-serif";
  x.fillText(`${r.spec.label}`, pad, pad+108);
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
  wrapText(x,"DIYPassPhoto measures the published specification and cannot guarantee acceptance — the issuing authority makes the final call. No AI edits were applied to the photo.",pad,y,W-pad*2,18);
  x.fillStyle=COL.pass; x.font="600 14px Inter,Arial,sans-serif";
  x.fillText(`Official requirements: ${r.spec.officialUrl||""}`, pad, y+54);
  const a=document.createElement("a"); a.href=c.toDataURL("image/png"); a.download=`diypassphoto-${el.country.value}-report.png`; a.click();
}
function roundRect(x,X,Y,w,h,r){x.beginPath();x.moveTo(X+r,Y);x.arcTo(X+w,Y,X+w,Y+h,r);x.arcTo(X+w,Y+h,X,Y+h,r);x.arcTo(X,Y+h,X,Y,r);x.arcTo(X,Y,X+w,Y,r);x.closePath();}
function wrapText(x,t,X,Y,maxW,lh){const words=t.split(" ");let line="",yy=Y;for(const w of words){const test=line+w+" ";if(x.measureText(test).width>maxW&&line){x.fillText(line,X,yy);line=w+" ";yy+=lh;}else line=test;}x.fillText(line,X,yy);}
// 4×6in @300dpi print sheet, tiled with the photo at its physical mm size
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
  const a=document.createElement("a");a.href=c.toDataURL("image/jpeg",.92);a.download=`diypassphoto-${el.country.value}-4x6sheet.jpg`;a.click();
}

if(!el.gates){ /* page has no tool */ } else { boot(); }
