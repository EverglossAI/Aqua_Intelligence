
const dmaData = {
  "DMA-24": {zone:"North Zone", population:"12,540", pipes:"68 km", properties:"3,275", area:"2.45 km²", nrw:24.7, pressure:42, flow:18.6, inlet:42.3, bursts:8, center:[1.3521,103.8198], zoom:14},
  "DMA-12": {zone:"Central Zone", population:"8,940", pipes:"51 km", properties:"2,410", area:"1.82 km²", nrw:31.2, pressure:47, flow:21.4, inlet:39.8, bursts:12, center:[1.3008,103.8395], zoom:14},
  "DMA-31": {zone:"East Zone", population:"15,820", pipes:"74 km", properties:"4,130", area:"3.10 km²", nrw:18.9, pressure:36, flow:12.2, inlet:46.1, bursts:4, center:[1.3496,103.9568], zoom:14}
};

const pipeTemplates = [
  {id:"P-101", material:"DI", age:32, dia:200, length:480, bursts:3, risk:78, coords:[[1.3552,103.8134],[1.3538,103.8178],[1.3520,103.8217]]},
  {id:"P-102", material:"CI", age:48, dia:150, length:365, bursts:5, risk:91, coords:[[1.3507,103.8144],[1.3520,103.8217],[1.3541,103.8266]]},
  {id:"P-103", material:"DI", age:22, dia:300, length:610, bursts:1, risk:51, coords:[[1.3574,103.8201],[1.3520,103.8217],[1.3484,103.8249]]},
  {id:"P-104", material:"PVC", age:14, dia:150, length:295, bursts:0, risk:28, coords:[[1.3541,103.8266],[1.3508,103.8287],[1.3484,103.8249]]},
  {id:"P-105", material:"AC", age:41, dia:100, length:430, bursts:4, risk:86, coords:[[1.3507,103.8144],[1.3476,103.8182],[1.3484,103.8249]]},
  {id:"P-106", material:"HDPE", age:9, dia:250, length:520, bursts:0, risk:22, coords:[[1.3552,103.8134],[1.3574,103.8201],[1.3541,103.8266]]}
];

const $ = id => document.getElementById(id);
let selectedStrategy = "Permanent";
let selectedPipe = null;
let map, dmaLayer, pipeLayers=[], sensorLayers=[], boundaryLayer, importedGeoLayer=null;

function riskColor(risk){
  if(risk>=80) return "#ef6262";
  if(risk>=60) return "#f2ae3d";
  return "#2f7cff";
}

function initMap(){
  map = L.map("map",{zoomControl:true}).setView(dmaData["DMA-24"].center,14);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
    maxZoom:19,
    attribution:'&copy; OpenStreetMap contributors'
  }).addTo(map);

  drawDMA("DMA-24");
}

function shiftedCoords(coords, center){
  const base=[1.3521,103.8198];
  const dLat=center[0]-base[0], dLng=center[1]-base[1];
  return coords.map(c=>[c[0]+dLat,c[1]+dLng]);
}

function drawDMA(dmaName){
  const d=dmaData[dmaName];
  map.setView(d.center,d.zoom);

  pipeLayers.forEach(x=>map.removeLayer(x)); pipeLayers=[];
  sensorLayers.forEach(x=>map.removeLayer(x)); sensorLayers=[];
  if(boundaryLayer) map.removeLayer(boundaryLayer);

  const c=d.center;
  const boundary=[
    [c[0]+.0065,c[1]-.0085],[c[0]+.0080,c[1]+.0010],[c[0]+.0045,c[1]+.0085],
    [c[0]-.0040,c[1]+.0090],[c[0]-.0070,c[1]+.0010],[c[0]-.0045,c[1]-.0085]
  ];
  boundaryLayer=L.polygon(boundary,{color:"#2f7cff",weight:2,fillColor:"#2f7cff",fillOpacity:.07}).addTo(map);

  pipeTemplates.forEach(pipe=>{
    const coords=shiftedCoords(pipe.coords,c);
    const line=L.polyline(coords,{color:riskColor(pipe.risk),weight:5,opacity:.92});
    line.addTo(map);
    line.bindTooltip(`${pipe.id} · ${pipe.material} · risk ${pipe.risk}/100`);
    line.on("click",()=>selectPipe(pipe,line));
    pipeLayers.push(line);
  });

  const flow=L.circleMarker([c[0]+.005,c[1]-.006],{radius:8,color:"#ef8c31",fillColor:"#ef8c31",fillOpacity:1}).addTo(map).bindTooltip("DMA Flow Meter");
  const p1=L.circleMarker([c[0]+.003,c[1]+.004],{radius:8,color:"#2f7cff",fillColor:"#2f7cff",fillOpacity:1}).addTo(map).bindTooltip("Pressure Logger");
  const p2=L.circleMarker([c[0]-.004,c[1]-.001],{radius:8,color:"#2f7cff",fillColor:"#2f7cff",fillOpacity:1}).addTo(map).bindTooltip("Pressure Logger");
  sensorLayers.push(flow,p1,p2);
}

function selectPipe(pipe,layer){
  selectedPipe=pipe;
  pipeLayers.forEach(l=>l.setStyle({weight:5}));
  layer.setStyle({weight:9});
  $("pipePriority").textContent=pipe.risk>=80?"Very High":pipe.risk>=60?"High":pipe.risk>=40?"Moderate":"Low";
  $("pipePriority").className="pill "+(pipe.risk>=80?"amber":"blue");

  const action=pipe.risk>=80 ? "Immediate acoustic investigation + correlation / ground confirmation"
    : pipe.risk>=60 ? "Include in next lift & shift campaign or fixed monitoring priority"
    : pipe.risk>=40 ? "Routine survey / watchlist"
    : "No special intervention";

  $("pipeDetails").innerHTML=`
    <b>${pipe.id}</b>
    <div class="grid">
      <div><small>Material</small>${pipe.material}</div>
      <div><small>Diameter</small>${pipe.dia} mm</div>
      <div><small>Age</small>${pipe.age} years</div>
      <div><small>Length</small>${pipe.length} m</div>
      <div><small>Recent Bursts</small>${pipe.bursts}</div>
      <div><small>Pipe Risk</small>${pipe.risk}/100</div>
    </div>
    <p><small>Recommended action</small>${action}</p>
    <button class="analyze-btn" id="analyzePipeBtn">Analyse this section</button>`;
  setTimeout(()=>{
    const b=document.getElementById("analyzePipeBtn");
    if(b) b.onclick=()=>analyzeSelectedPipe();
  },0);
}

function setStrategy(name){
  selectedStrategy=name;
  document.querySelectorAll(".strategy").forEach(b=>b.classList.toggle("active",b.dataset.strategy===name));
}

document.querySelectorAll(".strategy").forEach(btn=>btn.addEventListener("click",()=>setStrategy(btn.dataset.strategy)));
$("aggressiveness").addEventListener("input",e=>$("aggrLabel").textContent=`${e.target.value} / 10`);

$("dmaSelect").addEventListener("change",e=>{
  const d=dmaData[e.target.value];
  $("headerDma").textContent=e.target.value;
  $("dmaTitle").textContent=e.target.value;
  $("dmaZone").textContent=d.zone;
  $("popVal").textContent=d.population;
  $("pipeVal").textContent=d.pipes;
  $("propVal").textContent=d.properties;
  $("areaVal").textContent=d.area;
  $("pressureInput").value=d.pressure;
  $("flowInput").value=d.flow;
  $("inletInput").value=d.inlet;
  $("burstsInput").value=d.bursts;
  $("nrwKpi").textContent=d.nrw.toFixed(1)+"%";
  drawDMA(e.target.value);
  runAnalysis();
});


function qualityScore(){
  const weights={good:1,fair:.72,poor:.42};
  const f=weights[$("flowQuality").value]||1;
  const p=weights[$("pressureQuality").value]||1;
  const g=weights[$("gisQuality").value]||1;
  return Math.round((f*.4+p*.35+g*.25)*100);
}

function scenarioApply(name){
  if(name==="custom") return;
  const presets={
    high_nrw:{pressure:58,flow:26.5,inlet:44.0,bursts:11,material:"DI",age:"25",bg:"high",response:"normal",aggr:8},
    aged:{pressure:46,flow:19.8,inlet:39.5,bursts:9,material:"CI",age:"45",bg:"medium",response:"normal",aggr:7},
    poor_acoustic:{pressure:34,flow:16.2,inlet:41.0,bursts:6,material:"HDPE",age:"10",bg:"medium",response:"fast",aggr:6},
    healthy:{pressure:38,flow:9.8,inlet:43.5,bursts:2,material:"PVC",age:"10",bg:"low",response:"fast",aggr:3}
  };
  const x=presets[name]; if(!x) return;
  $("pressureInput").value=x.pressure;$("flowInput").value=x.flow;$("inletInput").value=x.inlet;$("burstsInput").value=x.bursts;
  $("materialInput").value=x.material;$("ageInput").value=x.age;$("backgroundLeakage").value=x.bg;$("repairResponse").value=x.response;
  $("aggressiveness").value=x.aggr;$("aggrLabel").textContent=`${x.aggr} / 10`;
  runAnalysis();
}

function analyzeSelectedPipe(){
  if(!selectedPipe) return;
  const risk=selectedPipe.risk;
  const acoustic=["CI","DI"].includes(selectedPipe.material)?"Good":["AC"].includes(selectedPipe.material)?"Moderate":"Challenging";
  const msg = `
    <b>${selectedPipe.id} engineering review</b><br><br>
    Priority is <b>${risk}/100</b> because the asset is ${selectedPipe.age} years old, ${selectedPipe.material}, with ${selectedPipe.bursts} recent bursts.<br><br>
    Acoustic propagation is expected to be <b>${acoustic}</b>. ${
      risk>=80 ? "Recommended approach: investigate immediately using acoustic logging plus correlation / ground confirmation." :
      risk>=60 ? "Recommended approach: include in the next targeted survey and consider temporary or permanent monitoring." :
      "Recommended approach: routine surveillance is sufficient unless new evidence appears."
    }
  `;
  L.popup().setLatLng(map.getCenter()).setContent(msg).openOn(map);
}

function renderImportedGeoJSON(geojson){
  if(importedGeoLayer) map.removeLayer(importedGeoLayer);
  importedGeoLayer=L.geoJSON(geojson,{
    style:()=>({color:"#9a67ff",weight:3,fillColor:"#9a67ff",fillOpacity:.05}),
    pointToLayer:(feature,latlng)=>L.circleMarker(latlng,{radius:6,color:"#9a67ff",fillColor:"#9a67ff",fillOpacity:1}),
    onEachFeature:(feature,layer)=>{
      const props=feature.properties||{};
      const rows=Object.entries(props).slice(0,8).map(([k,v])=>`<b>${k}</b>: ${v}`).join("<br>");
      if(rows) layer.bindPopup(rows);
    }
  }).addTo(map);
  try{map.fitBounds(importedGeoLayer.getBounds(),{padding:[20,20]});}catch(e){}
}

function scoreModel(){
  const aggr=Number($("aggressiveness").value);
  const pressure=Number($("pressureInput").value)||0;
  const flow=Number($("flowInput").value)||0;
  const inlet=Math.max(Number($("inletInput").value)||1,1);
  const bursts=Number($("burstsInput").value)||0;
  const material=$("materialInput").value;
  const age=Number($("ageInput").value);
  const bg=$("backgroundLeakage").value;
  const response=$("repairResponse").value;
  const costPosture=$("costPosture").value;
  const dataQuality=qualityScore();

  const nightRatio=Math.min(flow/inlet,1);
  let risk=10;
  risk += Math.min(30, nightRatio*45);
  risk += Math.min(18, Math.max(0,(pressure-30)*.65));
  risk += Math.min(20,bursts*1.6);
  risk += age>=45?10:age>=25?6:2;
  risk += ["CI","AC"].includes(material)?8:material==="DI"?5:2;
  risk += bg==="high"?8:bg==="medium"?4:1;
  risk += response==="slow"?6:response==="normal"?3:1;
  risk=Math.min(100,Math.round(risk));

  let acoustic=70;
  if(["HDPE","PVC"].includes(material)) acoustic-=18;
  if(pressure<30) acoustic-=12;
  if(["CI","DI"].includes(material)) acoustic+=8;
  acoustic=Math.max(35,Math.min(95,acoustic));

  let permSuit=Math.round(.45*risk+.35*acoustic+aggr*2.0);
  let lsSuit=Math.round(55+(10-aggr)*1.5 + (risk<65?10:0) + (acoustic<60?5:0));
  let hybSuit=Math.round((permSuit+lsSuit)/2+12);
  permSuit=Math.min(96,permSuit);lsSuit=Math.min(94,lsSuit);hybSuit=Math.min(98,hybSuit);

  let auto;
  if(risk>=72 && acoustic>=60) auto="Hybrid";
  else if(risk>=75 && acoustic<60) auto="LiftShift";
  else if(risk>=60 && response==="slow") auto="Permanent";
  else if(risk<50) auto="LiftShift";
  else auto="Hybrid";

  let postureFactor=costPosture==="capex"?.82:costPosture==="max"?1.2:1;
  const sensors=Math.max(3,Math.round((2+risk/14+aggr/3)*postureFactor));
  const campaigns=Math.max(1,Math.round((1+aggr/3+(risk>=75?1:0))*postureFactor));
  const hybridSensors=Math.max(2,Math.round(sensors*.55));
  const hybridCampaigns=Math.max(1,campaigns-1);

  const confidence=Math.min(94,Math.round((58 + Math.min(18,Math.abs(inlet-flow)/inlet*15) + (pressure>0?7:0) + (bursts>=0?5:0) + (selectedPipe?4:0))*(dataQuality/100)));

  return {aggr,pressure,flow,inlet,bursts,material,age,bg,response,costPosture,dataQuality,nightRatio,risk,acoustic,permSuit,lsSuit,hybSuit,auto,sensors,campaigns,hybridSensors,hybridCampaigns,confidence};
}

function runAnalysis(){
  const m=scoreModel();
  $("pressureKpi").textContent=`${m.pressure.toFixed(0)} m`;
  $("flowKpi").textContent=`${m.flow.toFixed(1)} L/s`;
  $("nightRatioText").textContent=`${Math.round(m.nightRatio*100)}% of inlet flow`;
  $("riskKpi").textContent=`${m.risk} / 100`;
  $("riskBand").textContent=m.risk>=75?"Very high priority":m.risk>=60?"High priority":m.risk>=45?"Moderate priority":"Routine";
  $("confidenceBadge").textContent=`Confidence ${m.confidence}%`;

  $("permDeploy").textContent=`${m.sensors} sensors`;
  $("lsDeploy").textContent=`${m.campaigns} campaigns`;
  $("hybDeploy").textContent=`${m.hybridSensors} fixed + ${m.hybridCampaigns} campaigns`;
  $("permCost").textContent=Math.round(45+m.sensors*6+m.aggr*1.5);
  $("lsCost").textContent=Math.round(28+m.campaigns*8+m.aggr*.9);
  $("hybCost").textContent=Math.round(38+m.hybridSensors*6+m.hybridCampaigns*7+m.aggr);
  $("permSuit").textContent=`${m.permSuit}%`;
  $("lsSuit").textContent=`${m.lsSuit}%`;
  $("hybSuit").textContent=`${m.hybSuit}%`;

  const freq=m.aggr>=8?"Monthly":m.aggr>=5?"Quarterly":"Half-yearly";
  $("lsFreq").textContent=freq;
  $("permSpeed").textContent=m.response==="slow"?"Fast detection / slower repair":"Fast";
  $("lsSpeed").textContent=m.aggr>=8?"Fast during campaign":"Medium";

  let effective=selectedStrategy==="Auto"?m.auto:(selectedStrategy==="LiftShift"?"Lift & Shift":selectedStrategy);
  const strategyKey=effective==="Lift & Shift"?"LiftShift":effective;

  document.querySelectorAll(".compare-card").forEach(c=>c.classList.remove("recommended"));
  if(strategyKey==="Permanent") $("permCard").classList.add("recommended");
  if(strategyKey==="LiftShift") $("lsCard").classList.add("recommended");
  if(strategyKey==="Hybrid") $("hybCard").classList.add("recommended");

  $("recBadge").textContent=`${effective} Strategy`;
  $("priorityText").textContent=m.risk>=75?"Very High":m.risk>=60?"High":m.risk>=45?"Moderate":"Routine";

  let rs=0, rc=0, review="180 days";
  if(strategyKey==="Permanent"){rs=m.sensors;rc=0;review=m.aggr>=8?"30 days":"90 days";}
  else if(strategyKey==="LiftShift"){rs=0;rc=m.campaigns;review=m.aggr>=8?"30 days":"Quarterly";}
  else {rs=m.hybridSensors;rc=m.hybridCampaigns;review=m.aggr>=8?"30–60 days":"90 days";}

  $("recSensors").textContent=rs;
  $("recCampaigns").textContent=rc;
  $("reviewCycle").textContent=review;

  let manpower = strategyKey==="Permanent" ? Math.max(2,Math.ceil(rs/6))
                : strategyKey==="LiftShift" ? Math.max(2,Math.ceil(rc/2)+1)
                : Math.max(2,Math.ceil((rs+rc)/5)+1);
  let duration = m.aggr>=8 ? "5–10 days" : m.aggr>=5 ? "3–5 days" : "1–3 days";
  $("manpowerText").textContent=`${manpower} technician${manpower>1?"s":""}`;
  $("durationText").textContent=duration;

  const why=[];
  if(m.nightRatio>.42) why.push(`High minimum-night-flow ratio (${Math.round(m.nightRatio*100)}% of inlet flow)`);
  if(m.pressure>50) why.push(`High average pressure (${m.pressure} m) increases leakage sensitivity`);
  if(["CI","AC"].includes(m.material)||m.age>=45) why.push(`Older / higher-risk asset profile (${m.material}, ${m.age} years)`);
  if(m.bursts>=8) why.push(`Repeated burst history (${m.bursts} in 12 months)`);
  if(m.acoustic<60) why.push(`Lower acoustic suitability (${m.acoustic}%) favours targeted campaign methods`);
  if(m.response==="slow") why.push("Slow repair response reduces value of ultra-fast detection");
  if(m.dataQuality<75) why.push(`Data quality is only ${m.dataQuality}%, so recommendation confidence is reduced`);
  if(!why.length) why.push("No single dominant risk driver; use proportionate monitoring");
  $("whyList").innerHTML=why.slice(0,5).map(x=>`<li>${x}</li>`).join("");

  const techScores=[
    ["Acoustic loggers",m.acoustic,"Best for repeated screening where pipe acoustics are favourable."],
    ["Correlator",Math.max(40,Math.min(96,m.acoustic+8)),"High value after a suspected leak is narrowed to a section."],
    ["Hydrophone",["HDPE","PVC"].includes(m.material)?78:64,"Useful where water-borne signal transmission is stronger than pipe-borne vibration."],
    ["Pressure logging",Math.min(95,55+Math.max(0,m.pressure-35)),"Supports pressure-leakage interpretation and transient / zone behaviour."],
    ["Step testing",Math.min(94,52+(m.nightRatio*55)),"Strong option when night flow is elevated and subzone isolation is practical."],
    ["Transient monitoring",Math.min(90,45+m.bursts*3),"Useful where recurring bursts or abnormal valve/pump events are suspected."],
    ["Satellite screening",m.risk>=70?62:45,"Supplementary prioritisation tool; field confirmation remains necessary."],
    ["Ground microphone",Math.max(45,m.acoustic-5),"Final localisation aid after screening / correlation."]
  ];
  $("techGrid").innerHTML=techScores.map(([name,score,desc])=>`
    <div class="tech-card">
      <b>${name}</b>
      <div class="score">${Math.round(score)}%</div>
      <small>${desc}</small>
      <div class="tech-meter"><i style="width:${Math.round(score)}%"></i></div>
    </div>`).join("");

  const decision = [
    ["NRW / Night Flow", `${Math.round(m.nightRatio*100)}% MNF ratio`, m.nightRatio>.42?"high":m.nightRatio>.30?"warn":"good"],
    ["Pressure", `${m.pressure} m avg`, m.pressure>50?"high":m.pressure>40?"warn":"good"],
    ["Pipe Condition", `${m.material}, ${m.age}y`, ["CI","AC"].includes(m.material)||m.age>=45?"high":m.age>=25?"warn":"good"],
    ["Burst History", `${m.bursts} / 12m`, m.bursts>=10?"high":m.bursts>=5?"warn":"good"],
    ["Acoustic Suitability", `${m.acoustic}%`, m.acoustic<55?"warn":"good"],
    ["Strategy", effective, "good"]
  ];
  $("decisionPath").innerHTML=decision.map(([a,b,c])=>`<div class="decision-node ${c}"><span>${a}</span><b>${b}</b></div>`).join("");

  let list=[];
  if(m.risk>=75){
    list.push("Start with a rapid verification campaign in the highest-risk subzones before widening deployment.");
    if(m.acoustic>=60) list.push("Use permanent acoustic monitoring on trunk / historically active branches where signal transmission is favourable.");
    else list.push("Because acoustic suitability is weaker, rely more heavily on short-interval lift & shift, pressure logging and step testing.");
    list.push("Treat high-pressure areas as separate intervention zones; evaluate pressure management alongside active leakage control.");
    list.push("Require correlation / ground confirmation before excavation and record repair outcome to retrain the priority model.");
  }else if(m.risk>=55){
    list.push("Use a hybrid programme with focused permanent coverage and scheduled lift & shift on remaining subzones.");
    list.push("Prioritise sections with burst history, older metallic pipes and elevated minimum night flow.");
    list.push("Review hit-rate, confirmed leaks and repaired volume every quarter before adding sensors.");
  }else{
    list.push("Avoid dense permanent monitoring at this stage; begin with periodic lift & shift surveys.");
    list.push("Validate minimum night flow and pressure data before committing to fixed infrastructure.");
    list.push("Escalate the DMA only if confirmed leakage, recurring bursts or repair delays increase.");
  }
  $("recommendationList").innerHTML=list.map(x=>`<li>${x}</li>`).join("");

  const insights=[
    ["Night-flow signal", `${Math.round(m.nightRatio*100)}% of DMA inlet flow remains during minimum-night conditions. This increases the priority for leakage investigation.`],
    ["Pressure influence", m.pressure>50?"Pressure is high enough that pressure-dependent leakage and burst risk should be explicitly tested.":"Pressure is not currently the dominant risk driver."],
    ["Acoustic suitability", `${m.material} gives an indicative acoustic suitability score of ${m.acoustic}%. Sensor spacing should still be field validated.`],
    ["Operational readiness", m.response==="slow"?"Slow repair response reduces the value of faster detection unless repair workflow is improved at the same time.":"Repair response is fast enough to benefit from more aggressive detection."]
  ];
  $("insightGrid").innerHTML=insights.map(([h,p])=>`<div class="insight-card"><b>${h}</b><p>${p}</p></div>`).join("");

  window.latestModel={...m,effective,rs,rc,review};
}

function showDeployment(){
  const m=window.latestModel||scoreModel();
  sensorLayers.forEach(x=>{
    if(x.options && x.options._candidate) map.removeLayer(x);
  });
  sensorLayers=sensorLayers.filter(x=>!x.options?._candidate);

  const d=dmaData[$("dmaSelect").value], c=d.center;
  const count=Math.max(3,m.rs||Math.min(6,m.campaigns+2));
  const pts=[
    [c[0]+.0048,c[1]-.0038],[c[0]+.0020,c[1]+.0015],[c[0]-.0015,c[1]+.0050],
    [c[0]-.0040,c[1]-.0022],[c[0]+.0052,c[1]+.0053],[c[0]-.0022,c[1]-.0055],
    [c[0]+.0005,c[1]-.0010],[c[0]+.0035,c[1]+.0063]
  ];
  pts.slice(0,count).forEach((p,i)=>{
    const mk=L.circleMarker(p,{radius:7,color:"#9a67ff",fillColor:"#9a67ff",fillOpacity:.95,_candidate:true})
      .addTo(map).bindTooltip(`Recommended ${m.effective} deployment point ${i+1}`);
    sensorLayers.push(mk);
  });
}

$("runBtn").addEventListener("click",runAnalysis);
$("applyBtn").addEventListener("click",showDeployment);
["pressureInput","flowInput","inletInput","burstsInput","materialInput","ageInput","backgroundLeakage","repairResponse"]
  .forEach(id=>$(id).addEventListener("change",runAnalysis));

$("resetBtn").addEventListener("click",()=>{
  setStrategy("Permanent");
  $("aggressiveness").value=7;$("aggrLabel").textContent="7 / 10";
  $("dmaSelect").value="DMA-24";
  $("materialInput").value="DI";$("ageInput").value="25";
  $("backgroundLeakage").value="medium";$("repairResponse").value="normal";
  $("dmaSelect").dispatchEvent(new Event("change"));
});

$("exportBtn").addEventListener("click",()=>{
  const m=window.latestModel||scoreModel();
  const plan={
    dma:$("dmaSelect").value,
    selectedStrategy,
    recommendedStrategy:m.effective,
    aggressiveness:m.aggr,
    data:{averagePressure_m:m.pressure,nightMinimumFlow_Ls:m.flow,inletFlow_Ls:m.inlet,recentBursts:m.bursts,material:m.material,averagePipeAge_years:m.age},
    scores:{risk:m.risk,acousticSuitability:m.acoustic,confidence:m.confidence,permanentSuitability:m.permSuit,liftShiftSuitability:m.lsSuit,hybridSuitability:m.hybSuit},
    programme:{permanentSensors:m.rs,liftShiftCampaigns:m.rc,reviewCycle:m.review},
    selectedPipe:selectedPipe
  };
  const blob=new Blob([JSON.stringify(plan,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=`${plan.dma.toLowerCase()}-nrw-strategy.json`;a.click();URL.revokeObjectURL(url);
});

initMap();
runAnalysis();


$("scenarioSelect").addEventListener("change",e=>scenarioApply(e.target.value));
$("costPosture").addEventListener("change",runAnalysis);
["flowQuality","pressureQuality","gisQuality"].forEach(id=>$(id).addEventListener("change",runAnalysis));

$("geojsonInput").addEventListener("change",async e=>{
  const file=e.target.files?.[0]; if(!file) return;
  try{
    const data=JSON.parse(await file.text());
    renderImportedGeoJSON(data);
    $("gisQuality").value="good";
    runAnalysis();
  }catch(err){
    alert("Unable to read GeoJSON. Please check that the file contains valid GeoJSON.");
  }
});

$("clearGeoBtn").addEventListener("click",()=>{
  if(importedGeoLayer){map.removeLayer(importedGeoLayer);importedGeoLayer=null;}
  $("geojsonInput").value="";
});

$("saveBtn").addEventListener("click",()=>{
  const state={
    dma:$("dmaSelect").value,strategy:selectedStrategy,aggr:$("aggressiveness").value,
    pressure:$("pressureInput").value,flow:$("flowInput").value,inlet:$("inletInput").value,bursts:$("burstsInput").value,
    material:$("materialInput").value,age:$("ageInput").value,bg:$("backgroundLeakage").value,response:$("repairResponse").value,
    costPosture:$("costPosture").value,flowQuality:$("flowQuality").value,pressureQuality:$("pressureQuality").value,gisQuality:$("gisQuality").value
  };
  localStorage.setItem("aqua-intelligence-scenario",JSON.stringify(state));
  alert("Scenario saved in this browser.");
});

$("loadBtn").addEventListener("click",()=>{
  const raw=localStorage.getItem("aqua-intelligence-scenario");
  if(!raw){alert("No saved scenario found in this browser.");return;}
  const s=JSON.parse(raw);
  $("dmaSelect").value=s.dma||"DMA-24";$("dmaSelect").dispatchEvent(new Event("change"));
  setStrategy(s.strategy||"Permanent");
  $("aggressiveness").value=s.aggr||7;$("aggrLabel").textContent=`${$("aggressiveness").value} / 10`;
  ["pressure","flow","inlet","bursts"].forEach(k=>{
    const id={pressure:"pressureInput",flow:"flowInput",inlet:"inletInput",bursts:"burstsInput"}[k];
    if(s[k]!=null) $(id).value=s[k];
  });
  if(s.material)$("materialInput").value=s.material;if(s.age)$("ageInput").value=s.age;
  if(s.bg)$("backgroundLeakage").value=s.bg;if(s.response)$("repairResponse").value=s.response;
  if(s.costPosture)$("costPosture").value=s.costPosture;
  if(s.flowQuality)$("flowQuality").value=s.flowQuality;if(s.pressureQuality)$("pressureQuality").value=s.pressureQuality;if(s.gisQuality)$("gisQuality").value=s.gisQuality;
  runAnalysis();
});

$("methodologyBtn").addEventListener("click",()=>$("methodologyModal").classList.remove("hidden"));
$("closeMethodology").addEventListener("click",()=>$("methodologyModal").classList.add("hidden"));
$("methodologyModal").addEventListener("click",e=>{if(e.target===$("methodologyModal"))$("methodologyModal").classList.add("hidden");});
