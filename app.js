
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
let map, dmaLayer, pipeLayers=[], sensorLayers=[], boundaryLayer;

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
    <p><small>Recommended action</small>${action}</p>`;
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

  const sensors=Math.max(3,Math.round(2+risk/14+aggr/3));
  const campaigns=Math.max(1,Math.round(1+aggr/3+(risk>=75?1:0)));
  const hybridSensors=Math.max(2,Math.round(sensors*.55));
  const hybridCampaigns=Math.max(1,campaigns-1);

  const confidence=Math.min(94,Math.round(58 + Math.min(18,Math.abs(inlet-flow)/inlet*15) + (pressure>0?7:0) + (bursts>=0?5:0) + (selectedPipe?4:0)));

  return {aggr,pressure,flow,inlet,bursts,material,age,bg,response,nightRatio,risk,acoustic,permSuit,lsSuit,hybSuit,auto,sensors,campaigns,hybridSensors,hybridCampaigns,confidence};
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
