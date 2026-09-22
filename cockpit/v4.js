const AquaV4={epanet:null,inpText:'',inpName:'',inpModel:null,baseline:null,scenario:null,acousticRows:[]};

function av4Esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function av4Num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function av4Mean(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:null}
function av4Sd(a){if(a.length<2)return 0;const m=av4Mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)*(x-m),0)/(a.length-1))}
function av4MetricColor(v,min,max){if(v==null||!Number.isFinite(v))return'#6e8798';const t=max===min?.5:Math.max(0,Math.min(1,(v-min)/(max-min)));if(t<.33)return'#4ba3ff';if(t<.66)return'#5edc9a';if(t<.85)return'#ffc65c';return'#ff6d7b'}
function av4Clear(){if(state.analysisLayer)state.analysisLayer.clearLayers()}

function av4ParseInp(text){
  const sections={};let sec='';
  text.split(/\r?\n/).forEach(line=>{
    const raw=line.trim();if(!raw||raw.startsWith(';'))return;
    const m=raw.match(/^\[([^\]]+)\]/);if(m){sec=m[1].toUpperCase();sections[sec]=sections[sec]||[];return}
    const clean=raw.split(';')[0].trim();if(clean)(sections[sec]=sections[sec]||[]).push(clean)
  });
  const rows=n=>(sections[n]||[]).map(x=>x.split(/\s+/));
  const coords={};rows('COORDINATES').forEach(r=>{if(r.length>=3)coords[r[0]]=[Number(r[2]),Number(r[1])]});
  const junctions=rows('JUNCTIONS').map(r=>({id:r[0],elevation:Number(r[1]),demand:Number(r[2]||0),coord:coords[r[0]]||null}));
  const reservoirs=rows('RESERVOIRS').map(r=>({id:r[0],head:Number(r[1]),coord:coords[r[0]]||null}));
  const tanks=rows('TANKS').map(r=>({id:r[0],elevation:Number(r[1]),coord:coords[r[0]]||null}));
  const links=[];
  rows('PIPES').forEach(r=>{if(r.length>=3)links.push({id:r[0],n1:r[1],n2:r[2],type:'pipe'})});
  rows('PUMPS').forEach(r=>{if(r.length>=3)links.push({id:r[0],n1:r[1],n2:r[2],type:'pump'})});
  rows('VALVES').forEach(r=>{if(r.length>=3)links.push({id:r[0],n1:r[1],n2:r[2],type:'valve'})});
  const nodeIds=[...junctions,...reservoirs,...tanks].map(x=>x.id);
  return{sections,coords,junctions,reservoirs,tanks,links,nodeIds};
}

async function av4LoadEpanet(){
  if(AquaV4.epanet)return AquaV4.epanet;
  $('hydraulicResults').innerHTML='<div class="result-note">Loading OWA-EPANET WebAssembly solver…</div>';
  try{
    AquaV4.epanet=await import('https://esm.sh/epanet-js@0.9.0?bundle');
    return AquaV4.epanet;
  }catch(e){
    console.error(e);
    throw new Error('Could not load the EPANET WebAssembly module. Run Aqua through a local HTTP server and ensure internet access for the solver package.');
  }
}

async function av4RunModel(scenario){
  if(!AquaV4.inpText)throw new Error('Choose an EPANET .inp file first.');
  const E=await av4LoadEpanet();
  const ws=new E.Workspace();
  await ws.loadModule();
  const model=new E.Project(ws);
  const bytes=new TextEncoder().encode(AquaV4.inpText);
  ws.writeFile('aqua.inp',bytes);
  model.open('aqua.inp','aqua.rpt','aqua.bin');

  if(scenario&&scenario.type!=='none'){
    const id=scenario.id,value=Number(scenario.value);
    if(!id)throw new Error('Enter a target EPANET node/link ID for this scenario.');
    if(scenario.type==='close'){
      const li=model.getLinkIndex(id);
      model.setLinkValue(li,E.LinkProperty.InitStatus,E.LinkStatusType.Closed);
    }else if(scenario.type==='prv'){
      const li=model.getLinkIndex(id);
      model.setLinkValue(li,E.LinkProperty.InitSetting,value);
    }else if(scenario.type==='leak'){
      const ni=model.getNodeIndex(id);
      model.setNodeValue(ni,E.NodeProperty.Emitter,value);
    }else if(scenario.type==='demand'){
      const mult=value||1;
      const nc=model.getCount(E.CountType.NodeCount);
      for(let i=1;i<=nc;i++){
        try{
          const d=model.getNodeValue(i,E.NodeProperty.BaseDemand);
          if(Number.isFinite(d)&&d>0)model.setNodeValue(i,E.NodeProperty.BaseDemand,d*mult);
        }catch(_){}
      }
    }
  }

  model.solveH();
  const nc=model.getCount(E.CountType.NodeCount),lc=model.getCount(E.CountType.LinkCount);
  const nodes=[],links=[];
  for(let i=1;i<=nc;i++){
    nodes.push({
      id:model.getNodeId(i),
      pressure:model.getNodeValue(i,E.NodeProperty.Pressure),
      head:model.getNodeValue(i,E.NodeProperty.Head),
      demand:model.getNodeValue(i,E.NodeProperty.Demand)
    });
  }
  for(let i=1;i<=lc;i++){
    links.push({
      id:model.getLinkId(i),
      flow:model.getLinkValue(i,E.LinkProperty.Flow),
      velocity:model.getLinkValue(i,E.LinkProperty.Velocity),
      headloss:model.getLinkValue(i,E.LinkProperty.Headloss),
      status:model.getLinkValue(i,E.LinkProperty.Status)
    });
  }
  model.close();
  return{nodes,links,scenario:scenario||{type:'none'}};
}

function av4RenderHyd(result){
  const metric=$('hydraulicMetric').value;
  av4Clear();
  const parsed=AquaV4.inpModel;
  const byNode=new Map(result.nodes.map(x=>[x.id,x]));
  const byLink=new Map(result.links.map(x=>[x.id,x]));
  let vals=metric==='pressure'?result.nodes.map(x=>x.pressure):result.links.map(x=>x[metric]);
  vals=vals.filter(Number.isFinite);const min=Math.min(...vals),max=Math.max(...vals);

  let mapped=0;
  if(metric==='pressure'){
    result.nodes.forEach(n=>{
      const c=parsed.coords[n.id];
      if(c&&Math.abs(c[0])<=90&&Math.abs(c[1])<=180){
        mapped++;const col=av4MetricColor(n.pressure,min,max);
        L.circleMarker(c,{radius:5,color:col,fillColor:col,fillOpacity:.95,weight:1}).bindTooltip(n.id+' · '+n.pressure.toFixed(1)).addTo(state.analysisLayer);
      }
    });
  }else{
    parsed.links.forEach(l=>{
      const a=parsed.coords[l.n1],b=parsed.coords[l.n2],r=byLink.get(l.id);
      if(a&&b&&r&&Math.abs(a[0])<=90&&Math.abs(a[1])<=180&&Math.abs(b[0])<=90&&Math.abs(b[1])<=180){
        mapped++;const val=r[metric],col=av4MetricColor(val,min,max);
        L.polyline([a,b],{color:col,weight:5,opacity:.9}).bindTooltip(l.id+' · '+Number(val).toFixed(2)).addTo(state.analysisLayer);
      }
    });
  }

  const p=result.nodes.map(x=>x.pressure).filter(Number.isFinite),f=result.links.map(x=>x.flow).filter(Number.isFinite),v=result.links.map(x=>x.velocity).filter(Number.isFinite);
  const base=AquaV4.baseline;
  let comparison='';
  if(result.scenario&&result.scenario.type!=='none'&&base){
    const bmap=new Map(base.nodes.map(x=>[x.id,x]));
    const changes=result.nodes.map(x=>({id:x.id,d:x.pressure-(bmap.get(x.id)?.pressure??x.pressure)})).sort((a,b)=>a.d-b.d);
    comparison='<div class="result-note"><b>Scenario pressure impact:</b> worst node '+av4Esc(changes[0]?.id||'—')+' '+(changes[0]?.d??0).toFixed(2)+' pressure units; best node '+av4Esc(changes[changes.length-1]?.id||'—')+' '+(changes[changes.length-1]?.d??0).toFixed(2)+'.</div>';
  }
  $('hydraulicResults').innerHTML='<div class="metric-cards">'+
    '<div><span>Nodes</span><b>'+result.nodes.length+'</b></div>'+
    '<div><span>Links</span><b>'+result.links.length+'</b></div>'+
    '<div><span>Min pressure</span><b>'+(p.length?Math.min(...p).toFixed(1):'—')+'</b></div>'+
    '<div><span>Max pressure</span><b>'+(p.length?Math.max(...p).toFixed(1):'—')+'</b></div>'+
    '<div><span>Mean |flow|</span><b>'+(f.length?av4Mean(f.map(Math.abs)).toFixed(2):'—')+'</b></div>'+
    '<div><span>Max velocity</span><b>'+(v.length?Math.max(...v).toFixed(2):'—')+'</b></div>'+
    '</div>'+
    '<div class="result-note">Real OWA-EPANET hydraulic solution. '+(mapped?'Results mapped onto geographic coordinates.':'The INP coordinates are not geographic lat/lon, so results are shown numerically rather than overlaid on the web basemap.')+'</div>'+
    comparison;
}

async function av4RunBaseline(){
  try{
    if(!$('epanetInp').files[0])throw new Error('Choose an EPANET .inp file first.');
    const file=$('epanetInp').files[0];
    AquaV4.inpText=await file.text();AquaV4.inpName=file.name;AquaV4.inpModel=av4ParseInp(AquaV4.inpText);
    const r=await av4RunModel({type:'none'});AquaV4.baseline=r;AquaV4.scenario=null;av4RenderHyd(r);
    addAi('Hydraulic baseline solved with OWA-EPANET: '+r.nodes.length+' nodes and '+r.links.length+' links.');
  }catch(e){$('hydraulicResults').innerHTML='<div class="result-note"><b>Hydraulic run failed:</b> '+av4Esc(e.message)+'</div>'}
}
async function av4RunScenario(){
  try{
    if(!AquaV4.baseline)await av4RunBaseline();
    if(!AquaV4.baseline)return;
    const scenario={type:$('hydScenarioType').value,id:$('hydTargetId').value.trim(),value:$('hydScenarioValue').value};
    const r=await av4RunModel(scenario);AquaV4.scenario=r;av4RenderHyd(r);
    addAi('EPANET what-if scenario complete: '+scenario.type+(scenario.id?' on '+av4Esc(scenario.id):'')+'.');
  }catch(e){$('hydraulicResults').innerHTML='<div class="result-note"><b>Scenario failed:</b> '+av4Esc(e.message)+'</div>'}
}

function av4Material(f){
  const p=f?.properties||{},keys=Object.keys(p),names=['MATERIAL','MAT','PIPE_MTR','PIPE_TYPE','TYPE'];
  for(const n of names){const k=keys.find(x=>x.toUpperCase()===n);if(k&&p[k]!=null)return String(p[k]).toUpperCase()}
  return'UNKNOWN';
}
function av4PipeLength(f){
  const p=f?.properties||{},keys=Object.keys(p),names=['PIPE_LONG','PIPE_LENGT','PIPE_LENGTH','LENGTH','LEN'];
  for(const n of names){const k=keys.find(x=>x.toUpperCase()===n);const v=k?Number(p[k]):NaN;if(Number.isFinite(v)&&v>0)return v}
  return V23&&V23.len?V23.len(f):0;
}
function av4SensorRule(material,type){
  const plastic=/PVC|PVCP|HDPE|PE|PLASTIC/.test(material),metal=/DI|DIP|CI|STEEL|MS|GI|METAL/.test(material);
  if(type==='hydrophone')return{spacing:plastic?300:metal?625:450,suitable:true,reason:plastic?'Hydrophone suitable; shorter spacing on plastic.':'Hydrophone long-range coverage.'};
  if(type==='accelerometer')return{spacing:plastic?80:metal?175:125,suitable:!plastic,reason:plastic?'Accelerometer not recommended on plastic due to attenuation.':'Accelerometer suitable on rigid pipe/appurtenance.'};
  return plastic?{spacing:300,suitable:true,chosen:'hydrophone',reason:'Auto selects hydrophone on plastic.'}:{spacing:450,suitable:true,chosen:'hydrophone',reason:'Auto favours hydrophone for coverage; accelerometer can be used at accessible metal appurtenances.'};
}
function av4PlanAcoustics(){
  if(!state.active){$('acousticPlanResults').innerHTML='<div class="result-note">Open a GIS project first.</div>';return}
  const type=$('sensorType').value,qty=Math.max(1,Number($('sensorQty').value)||20),pipes=V23.pipes();
  let total=0,required=0,plasticLen=0,metalLen=0,warnings=[];
  const scored=pipes.map((x,i)=>{
    const len=av4PipeLength(x.feature),mat=av4Material(x.feature),rule=av4SensorRule(mat,type),need=Math.max(1,Math.ceil(len/rule.spacing));
    total+=len;required+=need;if(/PVC|PVCP|HDPE|PE|PLASTIC/.test(mat))plasticLen+=len;else metalLen+=len;
    if(!rule.suitable)warnings.push('Pipe '+(i+1)+' '+mat+': '+rule.reason);
    const risk=V23.risk(x.feature),ac=V23.acoustic(x.feature);
    return{...x,len,mat,rule,need,priority:risk*.6+ac*.4,mid:V23.mid(x.feature)}
  }).sort((a,b)=>b.priority-a.priority);
  const candidates=[];
  scored.forEach((p,pi)=>{
    const count=Math.max(1,p.need);
    for(let i=0;i<count;i++)candidates.push({pipe:p,rankWeight:p.priority,coord:p.mid,slot:i});
  });
  candidates.sort((a,b)=>b.rankWeight-a.rankWeight);
  const chosen=candidates.slice(0,qty);
  av4Clear();
  chosen.forEach((c,i)=>{if(c.coord)L.circleMarker(c.coord,{radius:7,color:'#5edc9a',fillColor:'#5edc9a',fillOpacity:.95,weight:2}).bindTooltip('#'+(i+1)+' '+(c.pipe.rule.chosen||type)+' · '+c.pipe.mat+' · '+Math.round(c.pipe.len)+' m').addTo(state.analysisLayer)});
  const coverage=Math.min(100,required?qty/required*100:0);
  $('acousticPlanResults').innerHTML='<div class="metric-cards">'+
    '<div><span>Network length</span><b>'+(total/1000).toFixed(2)+' km</b></div>'+
    '<div><span>Available sensors</span><b>'+qty+'</b></div>'+
    '<div><span>Estimated sensors required</span><b>'+required+'</b></div>'+
    '<div><span>Coverage vs spacing rule</span><b>'+coverage.toFixed(0)+'%</b></div>'+
    '<div><span>Plastic pipe</span><b>'+(plasticLen/1000).toFixed(2)+' km</b></div>'+
    '<div><span>Metal/other pipe</span><b>'+(metalLen/1000).toFixed(2)+' km</b></div>'+
    '</div>'+
    '<div class="rank-list">'+chosen.slice(0,20).map((c,i)=>'<div><b>#'+(i+1)+' '+av4Esc(c.pipe.rule.chosen||type)+'</b><span>'+av4Esc(c.pipe.mat)+' · '+Math.round(c.pipe.len)+' m · target spacing '+c.pipe.rule.spacing+' m</span></div>').join('')+'</div>'+
    '<div class="result-note">'+(warnings.length?'<b>Warning:</b> '+av4Esc(warnings.slice(0,3).join(' | ')):'Sensor type is compatible with the currently classified pipe materials.')+' Minimum operating pressure, access to water column for hydrophones, and suitable valve/appurtenance mounting for accelerometers still need field verification.</div>';
  state.active.analyses=state.active.analyses||{};state.active.analyses.acousticPlan={type,qty,totalLength:total,required,coverage,chosen:chosen.map((c,i)=>({rank:i+1,material:c.pipe.mat,length:c.pipe.len,sensor:c.pipe.rule.chosen||type,spacing:c.pipe.rule.spacing,coord:c.coord}))};
  V23persist&&V23persist();
  addAi('Acoustic deployment planned for '+(total/1000).toFixed(2)+' km using '+qty+' '+type+' sensor(s). Estimated coverage against the material-specific spacing rules is '+coverage.toFixed(0)+'%.');
}

function av4ParseAcoustic(text,isJson){
  if(isJson){const j=JSON.parse(text);return Array.isArray(j)?j:(j.records||j.data||[])}
  return parseCSV(text);
}
function av4Value(row){
  const names=['rms','noise','level','amplitude','score','db','value','leak_score'];
  for(const[k,v]of Object.entries(row)){if(names.some(n=>k.toLowerCase()===n||k.toLowerCase().includes(n))){const x=Number(v);if(Number.isFinite(x))return x}}
  return null;
}
async function av4AnalyseAcoustics(){
  try{
    const file=$('acousticDataInput').files[0];if(!file)throw new Error('Choose an acoustic CSV or JSON file first.');
    const rows=av4ParseAcoustic(await file.text(),/\.json$/i.test(file.name));AquaV4.acousticRows=rows;
    const groups=new Map();
    rows.forEach((r,i)=>{const id=String(r.sensor_id||r.sensor||r.id||r.logger||('S'+(i+1))),v=av4Value(r);if(v==null)return;if(!groups.has(id))groups.set(id,[]);groups.get(id).push({...r,_v:v})});
    const results=[];
    groups.forEach((arr,id)=>{
      const vals=arr.map(x=>x._v),mean=av4Mean(vals),sd=av4Sd(vals),recent=av4Mean(vals.slice(-Math.max(1,Math.ceil(vals.length*.2)))),baseline=av4Mean(vals.slice(0,Math.max(1,Math.floor(vals.length*.5)))),z=sd?((recent-baseline)/sd):0;
      const high=vals.filter(v=>v>mean+sd).length,persistence=vals.length?high/vals.length:0;
      results.push({id,count:vals.length,mean,sd,recent,baseline,z,persistence,score:Math.max(0,Math.min(100,50+z*15+persistence*30))});
    });
    results.sort((a,b)=>b.score-a.score);
    $('acousticAnalysisResults').innerHTML='<div class="metric-cards"><div><span>Sensors</span><b>'+results.length+'</b></div><div><span>Readings</span><b>'+rows.length+'</b></div><div><span>Top anomaly</span><b>'+(results[0]?results[0].score.toFixed(0)+'/100':'—')+'</b></div></div>'+
      '<div class="rank-list">'+results.slice(0,20).map((r,i)=>'<div><b>#'+(i+1)+' '+av4Esc(r.id)+'</b><span>score '+r.score.toFixed(0)+' · trend z '+r.z.toFixed(2)+' · persistence '+(r.persistence*100).toFixed(0)+'% · n='+r.count+'</span></div>').join('')+'</div>'+
      '<div class="result-note">This first-pass acoustic engine analyses level persistence and change from baseline across each sensor. It can ingest richer features later — frequency bands, correlation/coherence, transient signatures and raw waveform/audio — without changing the project model.</div>';
    if(state.active){state.active.analyses=state.active.analyses||{};state.active.analyses.acousticData=results;V23persist&&V23persist()}
    if(results[0])addAi('Acoustic data analysed. Highest current anomaly is '+av4Esc(results[0].id)+' at '+results[0].score.toFixed(0)+'/100; treat this as a survey priority until cross-sensor and field confirmation.');
  }catch(e){$('acousticAnalysisResults').innerHTML='<div class="result-note"><b>Acoustic analysis failed:</b> '+av4Esc(e.message)+'</div>'}
}

function av4Bind(){
  if($('runHydraulics'))$('runHydraulics').onclick=av4RunBaseline;
  if($('runScenario'))$('runScenario').onclick=av4RunScenario;
  if($('hydraulicMetric'))$('hydraulicMetric').onchange=()=>{if(AquaV4.scenario)av4RenderHyd(AquaV4.scenario);else if(AquaV4.baseline)av4RenderHyd(AquaV4.baseline)};
  if($('planAcoustics'))$('planAcoustics').onclick=av4PlanAcoustics;
  if($('analyseAcoustics'))$('analyseAcoustics').onclick=av4AnalyseAcoustics;
}
window.addEventListener('load',av4Bind);
