(() => {
"use strict";
const STORAGE="aqua-window-layout-v1";
const state={windows:{},z:1400,basemap:null};

function q(s,r=document){return r.querySelector(s)}
function qa(s,r=document){return [...r.querySelectorAll(s)]}
function clamp(v,a,b){return Math.max(a,Math.min(v,b))}

class WindowManager{
  constructor(){this.saved=this.load()}
  load(){try{return JSON.parse(localStorage.getItem(STORAGE)||"{}")}catch{return{}}}
  save(){
    const out={};
    Object.entries(state.windows).forEach(([id,w])=>{
      if(!w.el.classList.contains("is-hidden")){
        out[id]={left:w.el.style.left,top:w.el.style.top,width:w.el.style.width,height:w.el.style.height,minimized:w.minimized||false};
      } else if(this.saved[id]) out[id]=this.saved[id];
    });
    localStorage.setItem(STORAGE,JSON.stringify(out));this.saved=out;
  }
  register(id,title,body,opt={}){
    const el=document.createElement("section");
    el.className="aqua-window";el.dataset.window=id;
    el.innerHTML='<div class="aqua-window-header"><div class="aqua-window-title"><i></i><span></span></div><div class="aqua-window-actions"><button data-act="min" title="Minimize">—</button><button data-act="close" title="Close">×</button></div></div><div class="aqua-window-body"></div>';
    q(".aqua-window-title span",el).textContent=title;
    q(".aqua-window-body",el).append(body);
    document.body.append(el);
    const saved=this.saved[id]||{};
    el.style.left=saved.left||((opt.left??24)+"px");
    el.style.top=saved.top||((opt.top??86)+"px");
    el.style.width=saved.width||((opt.width??360)+"px");
    el.style.height=saved.height||((opt.height??520)+"px");
    const w={id,title,el,minimized:false};state.windows[id]=w;
    this.bind(w);this.addDock(w);
    if(saved.minimized)this.minimize(id);
    return w;
  }
  bind(w){
    const h=q(".aqua-window-header",w.el);
    h.addEventListener("pointerdown",e=>{
      if(e.target.closest("button"))return;
      this.focus(w.id);h.setPointerCapture?.(e.pointerId);
      const r=w.el.getBoundingClientRect(),sx=e.clientX,sy=e.clientY;
      const move=ev=>{
        const maxX=Math.max(0,innerWidth-r.width),maxY=Math.max(64,innerHeight-r.height-64);
        w.el.style.left=clamp(r.left+ev.clientX-sx,0,maxX)+"px";
        w.el.style.top=clamp(r.top+ev.clientY-sy,66,maxY)+"px";
      };
      const up=()=>{removeEventListener("pointermove",move);removeEventListener("pointerup",up);this.save()};
      addEventListener("pointermove",move);addEventListener("pointerup",up);
    });
    w.el.addEventListener("pointerdown",()=>this.focus(w.id));
    new ResizeObserver(()=>this.save()).observe(w.el);
    q('[data-act="min"]',w.el).onclick=()=>this.minimize(w.id);
    q('[data-act="close"]',w.el).onclick=()=>this.close(w.id);
  }
  addDock(w){
    const b=document.createElement("button");b.dataset.window=w.id;b.textContent=w.title;
    b.onclick=()=>w.minimized||w.el.classList.contains("is-hidden")?this.restore(w.id):this.focus(w.id);
    q("#aquaDock").append(b);
  }
  focus(id){
    const w=state.windows[id];if(!w)return;
    w.el.style.zIndex=++state.z;
    qa("#aquaDock button").forEach(b=>b.classList.toggle("active",b.dataset.window===id));
  }
  minimize(id){
    const w=state.windows[id];if(!w)return;w.minimized=true;w.el.classList.add("is-hidden");
    q('#aquaDock button[data-window="'+id+'"]')?.classList.add("minimized");this.save()
  }
  restore(id){
    const w=state.windows[id];if(!w)return;w.minimized=false;w.el.classList.remove("is-hidden");
    q('#aquaDock button[data-window="'+id+'"]')?.classList.remove("minimized");this.focus(id);this.save()
  }
  close(id){const w=state.windows[id];if(!w)return;w.minimized=false;w.el.classList.add("is-hidden");this.save()}
}
const wm=new WindowManager();

function makeChrome(){
 const chrome=document.createElement("div");chrome.id="aquaChrome";
 chrome.innerHTML='<div class="aqua-topbar"><div class="aqua-brand"><b>AQUA</b><span>INTELLIGENCE</span></div><div class="aqua-project" id="aquaProject"></div><div class="aqua-command"><input id="aquaCommand" placeholder="Ask Aqua or run a command…"><button id="aquaRun">Run</button></div><div class="aqua-mapmodes"><button data-map="street" class="active">Street</button><button data-map="satellite">Satellite</button><button data-map="terrain">Terrain</button></div><button class="aqua-iconbtn" id="aquaOpenTools" title="Open tools">⊞</button></div>';
 document.body.append(chrome);
 const dock=document.createElement("div");dock.id="aquaDock";document.body.append(dock);
 const project=q("#aquaProject"),region=q("#region"),area=q("#area");
 if(region&&area){project.append(region,area)}
 q("#aquaRun").onclick=()=>runCommand(q("#aquaCommand").value);
 q("#aquaCommand").addEventListener("keydown",e=>{if(e.key==="Enter")runCommand(e.target.value)});
 q("#aquaOpenTools").onclick=()=>Object.keys(state.windows).forEach(id=>wm.restore(id));
 qa("[data-map]").forEach(b=>b.onclick=()=>switchBasemap(b.dataset.map,b));
}

function wrapExistingWindows(){
 const left=q(".content>.left"),right=q(".content>.right");
 if(left){left.classList.remove("panel","left");wm.register("planner","Network & Deployment",left,{left:18,top:82,width:355,height:650})}
 if(right){
   const inspector=q(".assetinfo",right);if(inspector) inspector.remove();
   right.classList.remove("panel","right");wm.register("analysis","Analysis & Recommendation",right,{left:innerWidth-390,top:82,width:370,height:650});
   if(inspector){inspector.classList.remove("section","assetinfo");wm.register("inspector","Asset Inspector",inspector,{left:innerWidth-370,top:180,width:340,height:260});wm.minimize("inspector")}
 }
 const oldLayers=q(".layers");
 if(oldLayers){
   const body=document.createElement("div");body.className="aqua-layers-body";
   qa("label",oldLayers).forEach(l=>body.append(l));
   oldLayers.remove();wm.register("layers","Map Layers",body,{left:18,top:180,width:300,height:430});wm.minimize("layers")
 }
 makeAIWindow();
 makeDataWindow();
}

function makeAIWindow(){
 const body=document.createElement("div");body.className="aqua-ai-panel";
 body.innerHTML='<div class="aqua-ai-log" id="aquaAiLog"><div class="aqua-ai-msg ai">Aqua is ready. I route commands to the engineering tools rather than inventing hydraulic results.</div></div><div class="aqua-ai-quick"><button>Analyse leak-prone zones</button><button>Optimise deployment</button><button>Show layers</button><button>Inspect assets</button></div>';
 wm.register("aqua-ai","Aqua AI / Command",body,{left:Math.max(370,innerWidth/2-250),top:95,width:500,height:360});wm.minimize("aqua-ai");
 qa(".aqua-ai-quick button",body).forEach(b=>b.onclick=()=>runCommand(b.textContent))
}
function makeDataWindow(){
 const body=document.createElement("div");body.className="aqua-ai-panel";
 body.innerHTML='<div class="summarybox"><b>Data workspace</b><br>GIS and operational-data import remain available in Network & Deployment. This window is the future home for layer provenance, QA and schema mapping.</div><div style="height:8px"></div><button class="secondary" id="openPlannerFromData">Open import controls</button>';
 wm.register("data","Data & QA",body,{left:80,top:130,width:330,height:240});wm.minimize("data");
 q("#openPlannerFromData").onclick=()=>wm.restore("planner")
}

function aiMessage(text,who="ai"){
 const log=q("#aquaAiLog");if(!log)return;
 const d=document.createElement("div");d.className="aqua-ai-msg "+who;d.textContent=text;log.append(d);log.scrollTop=log.scrollHeight
}
function runCommand(raw){
 const cmd=(raw||"").trim();if(!cmd)return;
 wm.restore("aqua-ai");aiMessage(cmd,"user");
 const x=cmd.toLowerCase();
 if(x.includes("leak")&&x.includes("zone")){q("#analyseZones")?.click();aiMessage("Running the deterministic GIS leak-susceptibility analysis and displaying the ranked zones.");return}
 if(x.includes("optim")||x.includes("deploy")){q("#optimise")?.click();aiMessage("Running the current deployment optimiser using the selected area, strategy and engineer overrides.");return}
 if(x.includes("layer")){wm.restore("layers");aiMessage("Opening map layers.");return}
 if(x.includes("inspect")||x.includes("asset")){wm.restore("inspector");aiMessage("Opening the asset inspector. Click a pipe, valve, hydrant or recommended sensor on the map.");return}
 if(x.includes("permanent")){qa(".strategy button").find(b=>b.dataset.s==="Permanent")?.click();wm.restore("planner");aiMessage("Strategy set to Permanent monitoring.");return}
 if(x.includes("lift")||x.includes("shift")){qa(".strategy button").find(b=>b.dataset.s==="Lift & Shift")?.click();wm.restore("planner");aiMessage("Strategy set to Lift & Shift.");return}
 if(x.includes("hybrid")){qa(".strategy button").find(b=>b.dataset.s==="Hybrid")?.click();wm.restore("planner");aiMessage("Strategy set to Hybrid.");return}
 aiMessage("I can currently route commands for leak-zone analysis, deployment optimisation, strategy selection, layers and asset inspection. Hydraulic/EPANET commands will connect to deterministic engineering services in the next milestone.")
}

function switchBasemap(type,button){
 const map=window.aquaMap;if(!map||!window.L)return;
 if(state.basemap){map.removeLayer(state.basemap)}
 qa("[data-map]").forEach(b=>b.classList.remove("active"));button?.classList.add("active");
 const defs={
   street:["https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",'© OpenStreetMap contributors',19],
   satellite:["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",'Tiles © Esri',19],
   terrain:["https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",'Map data © OpenStreetMap contributors, SRTM | Map style © OpenTopoMap',17]
 };
 const d=defs[type]||defs.street;state.basemap=L.tileLayer(d[0],{maxZoom:d[2],attribution:d[1]});
 state.basemap.addTo(map);state.basemap.bringToBack()
}

function initShell(){
 makeChrome();wrapExistingWindows();
 if(window.aquaMap){
   // remove original basemap and replace with managed street layer
   window.aquaMap.eachLayer(l=>{if(l instanceof L.TileLayer)window.aquaMap.removeLayer(l)});
   switchBasemap("street",q('[data-map="street"]'));
   setTimeout(()=>window.aquaMap.invalidateSize(),50)
 }
 addEventListener("resize",()=>Object.values(state.windows).forEach(w=>{
   if(w.el.classList.contains("is-hidden"))return;
   const r=w.el.getBoundingClientRect();
   if(r.right>innerWidth)w.el.style.left=Math.max(0,innerWidth-r.width-8)+"px";
   if(r.bottom>innerHeight-58)w.el.style.top=Math.max(66,innerHeight-r.height-66)+"px";
 }));
}
window.addEventListener("load",()=>setTimeout(initShell,220));
})();