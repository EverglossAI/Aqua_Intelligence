const $=id=>document.getElementById(id);
const state={projects:[],active:null,map:null,networkLayer:null,telemetryLayer:null,selected:null,mapMode:'inspect',engMode:'prv'};
const assetKinds={pipe:['pipe','eupipe','main','waterline'],meter:['meter','eumeter','flowmeter'],valve:['valve','gate','prv'],hydrant:['hydrant'],dma:['regionnet','dma','zone','district']};
const colors={pipe:'#5c8da9',meter:'#ffc65c',valve:'#aa82ff',hydrant:'#ff7f6d',dma:'#36a3ff',other:'#72879a'};
function kindFor(name=''){const n=name.toLowerCase();for(const[k,terms]of Object.entries(assetKinds))if(terms.some(t=>n.includes(t)))return k;return'other'}
function initMap(){
  state.map=L.map('map',{zoomControl:true,preferCanvas:true}).setView([23.7,120.95],8);
  const primary=L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',{
    subdomains:'abc',
    maxZoom:20,
    attribution:'&copy; OpenStreetMap contributors, Tiles style by HOT'
  });
  const fallback=L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png',{
    maxZoom:19,
    attribution:'&copy; OpenStreetMap contributors'
  });
  let switched=false;
  primary.on('tileerror',function(){
    if(switched)return;
    switched=true;
    try{state.map.removeLayer(primary)}catch(e){}
    fallback.addTo(state.map);
  });
  primary.addTo(state.map);
  state.networkLayer=L.layerGroup().addTo(state.map);
  state.telemetryLayer=L.layerGroup().addTo(state.map);
  state.analysisLayer=L.layerGroup().addTo(state.map);
}
function openModal(){ $('projectModal').classList.remove('hidden'); }
function closeModal(){ $('projectModal').classList.add('hidden'); }
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function featureCount(project,kind){return project.layers.filter(l=>l.kind===kind).reduce((s,l)=>s+(l.geojson?.features?.length||0),0)}
function pipeLength(project){let m=0;project.layers.filter(l=>l.kind==='pipe').forEach(l=>l.geojson.features.forEach(f=>{const p=f.properties||{};const v=Number(p.LENGTH||p.Length||p.length||p.PIPE_LEN||0);if(Number.isFinite(v))m+=v}));return m}
function updateProjectUI(){const p=state.active;if(!p)return;$('projectTitle').textContent=p.name;$('networkStatus').textContent='GIS loaded';$('projectEmpty').classList.add('hidden');$('projectTree').classList.remove('hidden');const counts={};['pipe','meter','valve','hydrant','dma'].forEach(k=>counts[k]=featureCount(p,k));$('pipeCount').textContent=counts.pipe;$('meterCount').textContent=counts.meter;$('treeMeters').textContent=counts.meter;$('valveCount').textContent=counts.valve;$('hydrantCount').textContent=counts.hydrant;$('dmaCount').textContent=counts.dma||'0';$('treeDmas').textContent=counts.dma;$('assetTotal').textContent=Object.values(counts).reduce((a,b)=>a+b,0);const km=pipeLength(p)/1000;$('pipeLength').textContent=km?km.toFixed(1)+' km':counts.pipe+' seg';$('flowCount').textContent=p.telemetry.filter(x=>x.type==='flow').length;$('pressureCount').textContent=p.telemetry.filter(x=>x.type==='pressure').length;$('acousticCount').textContent=p.telemetry.filter(x=>x.type==='acoustic').length;$('telemetryCount').textContent=p.telemetry.length;$('pressureStatus').textContent=p.telemetry.some(x=>x.type==='pressure')?'Connected':'No stream';$('acousticStatus').textContent=p.telemetry.some(x=>x.type==='acoustic')?'Connected':'No stream';$('confidence').textContent=confidenceScore(p)+'%';renderHealth();renderEvents()}
function confidenceScore(p){let s=35;if(featureCount(p,'pipe'))s+=20;if(featureCount(p,'meter'))s+=10;if(featureCount(p,'valve'))s+=8;if(featureCount(p,'dma'))s+=7;if(p.telemetry.some(x=>x.type==='flow'))s+=8;if(p.telemetry.some(x=>x.type==='pressure'))s+=7;if(p.telemetry.some(x=>x.type==='acoustic'))s+=5;return Math.min(100,s)}

/* Taiwan CRS handling */
function aquaDefineTaiwanCrs(){
  if(typeof proj4==='undefined')return;
  proj4.defs('EPSG:3826','+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 +units=m +no_defs +type=crs');
  proj4.defs('EPSG:3825','+proj=tmerc +lat_0=0 +lon_0=119 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 +units=m +no_defs +type=crs');
}
function aquaFirstXY(geometry){
  if(!geometry||!geometry.coordinates)return null;
  let c=geometry.coordinates;
  while(Array.isArray(c)&&Array.isArray(c[0]))c=c[0];
  return Array.isArray(c)&&c.length>=2?[Number(c[0]),Number(c[1])]:null;
}
function aquaLooksProjectedXY(xy){
  if(!xy)return false;
  const x=xy[0],y=xy[1];
  return Number.isFinite(x)&&Number.isFinite(y)&&(Math.abs(x)>180||Math.abs(y)>90);
}
function aquaDetectCrs(layers){
  for(const layer of layers){
    for(const f of (layer.geojson?.features||[])){
      const xy=aquaFirstXY(f.geometry);
      if(!xy)continue;
      if(aquaLooksProjectedXY(xy)){
        // Most Taiwan Water Corporation TM2 datasets are zone 121.
        // Zone 119 remains selectable for Penghu / western offshore data.
        return 'EPSG:3826';
      }
      if(Math.abs(xy[0])<=180&&Math.abs(xy[1])<=90)return 'EPSG:4326';
    }
  }
  return 'EPSG:4326';
}
function aquaTransformCoordinates(coords,sourceCrs){
  if(!Array.isArray(coords))return coords;
  if(typeof coords[0]==='number'&&typeof coords[1]==='number'){
    const out=proj4(sourceCrs,'EPSG:4326',[Number(coords[0]),Number(coords[1])]);
    return coords.length>2?[out[0],out[1],...coords.slice(2)]:[out[0],out[1]];
  }
  return coords.map(x=>aquaTransformCoordinates(x,sourceCrs));
}
function aquaReprojectLayers(layers,requestedCrs){
  aquaDefineTaiwanCrs();
  const detected=requestedCrs==='auto'?aquaDetectCrs(layers):requestedCrs;
  if(detected==='EPSG:4326')return{layers,sourceCrs:detected,reprojected:false};
  if(typeof proj4==='undefined')throw new Error('Projection library did not load; cannot convert '+detected+' to WGS84.');
  const out=layers.map(layer=>({
    ...layer,
    geojson:{
      ...layer.geojson,
      features:(layer.geojson?.features||[]).map(f=>({
        ...f,
        geometry:f.geometry?{...f.geometry,coordinates:aquaTransformCoordinates(f.geometry.coordinates,detected)}:f.geometry
      }))
    }
  }));
  return{layers:out,sourceCrs:detected,reprojected:true};
}

function normalizeShpResult(raw){if(!raw)return[];if(raw.type==='FeatureCollection')return[{name:'network',geojson:raw}];if(Array.isArray(raw))return raw.map((g,i)=>({name:g.fileName||g.name||('layer_'+(i+1)),geojson:g}));return Object.entries(raw).filter(([,g])=>g&&g.type==='FeatureCollection').map(([name,geojson])=>({name,geojson}))}
function renderProject(){const p=state.active;if(!p)return;state.networkLayer.clearLayers();let bounds=[];p.layers.forEach(layer=>{const kind=layer.kind;const gj=L.geoJSON(layer.geojson,{style:()=>({color:colors[kind]||colors.other,weight:kind==='pipe'?3:2,fillColor:colors[kind]||colors.other,fillOpacity:kind==='dma'?.05:.18}),pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:kind==='meter'?4:kind==='valve'?5:4,color:colors[kind]||colors.other,fillColor:colors[kind]||colors.other,fillOpacity:.9,weight:1}),onEachFeature:(f,l)=>{l.on('click',()=>selectFeature(layer,f,l));}});gj.addTo(state.networkLayer);try{const b=gj.getBounds();if(b.isValid())bounds.push(b)}catch(e){}});if(bounds.length){let b=bounds[0];for(let i=1;i<bounds.length;i++)b=b.extend(bounds[i]);state.map.fitBounds(b.pad(.06))}updateProjectUI()}
function selectFeature(layer,f,l){state.selected={layer,feature:f,leaflet:l};const p=f.properties||{};const rows=Object.entries(p).slice(0,6).map(([k,v])=>k+': '+v).join(' · ');$('selectionCard').innerHTML='<small>SELECTION</small><b>'+escapeHtml(layer.name)+' · '+escapeHtml(layer.kind)+'</b><p>'+escapeHtml(rows||'No attributes')+'</p>'}
async function createProject(){const file=$('gisInput').files[0];if(!file){alert('Choose a zipped shapefile or GeoJSON package.');return}const name=$('projectName').value.trim()||file.name.replace(/\.(zip|json|geojson)$/i,'');$('createProjectBtn').textContent='Reading GIS…';$('createProjectBtn').disabled=true;try{let raw;if(/\.zip$/i.test(file.name)){const buf=await file.arrayBuffer();raw=await shp(buf)}else{raw=JSON.parse(await file.text())}let layers=normalizeShpResult(raw).map(x=>({...x,kind:kindFor(x.name)}));const crsChoice=$('projectCrs')?.value||'auto';const projected=aquaReprojectLayers(layers,crsChoice);layers=projected.layers;const project={id:'p_'+Date.now(),name,utility:$('utilityName').value.trim(),source:file.name,sourceCrs:projected.sourceCrs,reprojected:projected.reprojected,rawLayers:normalizeShpResult(raw).map(x=>({...x,kind:kindFor(x.name)})),layers,telemetry:[],created:new Date().toISOString()};state.projects.push(project);state.active=project;const o=document.createElement('option');o.value=project.id;o.textContent=project.name;$('projectSelect').appendChild(o);$('projectSelect').value=project.id;closeModal();renderProject();addAi('Project <b>'+escapeHtml(project.name)+'</b> opened. I classified '+layers.length+' GIS layers and '+layers.reduce((s,l)=>s+l.geojson.features.length,0)+' features. Source CRS: <b>'+escapeHtml(project.sourceCrs||'unknown')+'</b>'+(project.reprojected?' → reprojected to WGS84 for display.':'.')+' You can now import flow, pressure, meter or acoustic telemetry.')}catch(e){console.error(e);alert('GIS import failed: '+e.message)}finally{$('createProjectBtn').textContent='Create & analyse project';$('createProjectBtn').disabled=false}}
function parseCSV(text){const lines=text.trim().split(/\r?\n/);if(lines.length<2)return[];const h=lines[0].split(',').map(x=>x.trim());return lines.slice(1).map(line=>{const cols=line.split(',');return Object.fromEntries(h.map((k,i)=>[k,cols[i]?.trim()]))})}
function inferTelemetry(row){const keys=Object.keys(row).map(k=>k.toLowerCase());const has=s=>keys.some(k=>k.includes(s));return has('acoustic')||has('noise')?'acoustic':has('pressure')?'pressure':has('flow')||has('mnf')?'flow':has('meter')||has('consumption')?'meter':'other'}
async function importTelemetry(file){if(!state.active){alert('Open a project first.');return}const rows=/\.json$/i.test(file.name)?JSON.parse(await file.text()):parseCSV(await file.text());const arr=Array.isArray(rows)?rows:(rows.records||[]);arr.forEach((r,i)=>state.active.telemetry.push({...r,_id:r.id||('T'+(i+1)),type:r.type||inferTelemetry(r)}));renderTelemetry();updateProjectUI();addAi('Imported <b>'+arr.length+'</b> telemetry records. I can now combine them with the GIS when answering network questions.')}
function renderTelemetry(){state.telemetryLayer.clearLayers();if(!state.active)return;state.active.telemetry.forEach(t=>{const lat=Number(t.lat||t.latitude),lng=Number(t.lng||t.lon||t.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lng))return;const c=t.type==='pressure'?colors.dma:t.type==='acoustic'?colors.hydrant:colors.meter;L.circleMarker([lat,lng],{radius:5,color:c,fillColor:c,fillOpacity:1}).bindTooltip((t._id||'Telemetry')+' · '+t.type).addTo(state.telemetryLayer)})}
function renderHealth(){const p=state.active;if(!p)return;const vals=[['GIS topology',featureCount(p,'pipe')?'Ready':'Missing'],['Flow / meter',p.telemetry.some(x=>['flow','meter'].includes(x.type))?'Ready':'Missing'],['Pressure',p.telemetry.some(x=>x.type==='pressure')?'Ready':'Missing'],['Acoustic',p.telemetry.some(x=>x.type==='acoustic')?'Ready':'Missing']];$('dataHealth').innerHTML=vals.map(([a,b])=>'<div><span>'+a+'</span><b>'+b+'</b></div>').join('')}
function renderEvents(){const p=state.active;if(!p)return;const events=[];const pipes=featureCount(p,'pipe'),meters=featureCount(p,'meter'),dmas=featureCount(p,'dma');if(pipes&&!dmas)events.push({sev:'med',title:'DMA boundaries not confirmed',body:'Network contains '+pipes+' pipe features but no recognized DMA/region layer.',tag:'DMA design'});if(pipes&&!meters)events.push({sev:'med',title:'Meter coverage unavailable',body:'Aqua cannot complete a defensible water balance until inlet/customer meter data is mapped.',tag:'Data gap'});if(!p.telemetry.length)events.push({sev:'low',title:'No live operational evidence',body:'Import flow, pressure or acoustic telemetry to move from GIS planning to event detection.',tag:'Telemetry'});if(p.telemetry.some(x=>x.type==='flow')&&!p.telemetry.some(x=>x.type==='pressure'))events.push({sev:'med',title:'Flow present without pressure context',body:'Pressure logging will improve leakage interpretation and pressure-management advice.',tag:'Pressure'});if(!events.length)events.push({sev:'low',title:'Network ready for analysis',body:'GIS and operational evidence are available. Run water balance, DMA planning or acoustic deployment.',tag:'Ready'});$('eventList').innerHTML=events.map(e=>'<div class="event '+e.sev+'"><i></i><div><b>'+e.title+'</b><p>'+e.body+'</p></div><strong>'+e.tag+'</strong></div>').join('')}
function addAi(html){const d=document.createElement('div');d.className='msg ai';d.innerHTML='<b>Aqua</b><p>'+html+'</p>';$('chat').appendChild(d);$('chat').scrollTop=$('chat').scrollHeight}
function addUser(text){const d=document.createElement('div');d.className='msg user';d.innerHTML='<b>You</b><p>'+escapeHtml(text)+'</p>';$('chat').appendChild(d);$('chat').scrollTop=$('chat').scrollHeight}
function contextSnapshot(){const p=state.active;if(!p)return null;return{project:p.name,utility:p.utility,layers:p.layers.map(l=>({name:l.name,kind:l.kind,count:l.geojson.features.length})),telemetry:p.telemetry.slice(-250),selected:state.selected?{layer:state.selected.layer.name,kind:state.selected.layer.kind,properties:state.selected.feature.properties}:null,confidence:confidenceScore(p)}}
async function askCopilot(q){addUser(q);if(!state.active){addAi('Open a project first. The Copilot needs the network context before it can reason about NRW.');return}addAi('<span class="thinking">Analysing network context…</span>');const nodes=[...$('chat').querySelectorAll('.msg.ai')];const placeholder=nodes[nodes.length-1];try{const res=await fetch('/api/copilot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q,context:contextSnapshot()})});if(!res.ok)throw new Error('Copilot service unavailable');const data=await res.json();placeholder.innerHTML='<b>Aqua</b><p>'+escapeHtml(data.answer||'No answer returned.')+'</p>'}catch(e){placeholder.innerHTML='<b>Aqua</b><p>'+localReasoning(q)+'</p>'}}
function localReasoning(q){const p=state.active;const c={pipe:featureCount(p,'pipe'),meter:featureCount(p,'meter'),valve:featureCount(p,'valve'),dma:featureCount(p,'dma')};const flows=p.telemetry.filter(x=>x.type==='flow'),press=p.telemetry.filter(x=>x.type==='pressure'),ac=p.telemetry.filter(x=>x.type==='acoustic');return 'The LLM service is not connected in this prototype, so I will not pretend to produce a neural-language diagnosis. Current evidence: <b>'+c.pipe+'</b> pipes, <b>'+c.meter+'</b> meters, <b>'+c.valve+'</b> valves, <b>'+c.dma+'</b> DMA/region features, '+flows.length+' flow records, '+press.length+' pressure records and '+ac.length+' acoustic records. Connect the Copilot API to enable full natural-language tool-calling analysis.'}
function runWaterBalance(){if(!state.active)return;const flow=state.active.telemetry.filter(x=>x.type==='flow'),meters=state.active.telemetry.filter(x=>x.type==='meter');addAi(flow.length&&meters.length?'Water-balance inputs are present. The next engine step is to aggregate system input volume, authorized consumption and apparent/real losses by DMA and time window.':'A defensible water balance needs both system input/flow data and customer or authorized-consumption meter data. Import those streams and I will calculate it by DMA.')}
function runDmaPlanner(){if(!state.active)return;const d=featureCount(state.active,'dma'),v=featureCount(state.active,'valve'),m=featureCount(state.active,'meter');addAi(d?'I found '+d+' DMA/region features. I would validate boundary connectivity against '+v+' valves and '+m+' meter assets, then score candidate boundary changes.':'No recognized DMA/region layer was found. Use Draw DMA or import a regionnet/DMA layer; then Aqua can validate boundary valves and inlet-meter coverage.')}
function runSensorPlanner(){if(!state.active)return;const pipes=featureCount(state.active,'pipe');addAi('Acoustic deployment planner is ready to score '+pipes+' pipe features using material/diameter attributes, access points, pressure, burst history and acoustic evidence. Once sensor inventory is connected, it can produce nightly lift-and-shift routes or permanent coverage.')}
function engineeringAnalysis(){if(!state.active)return;const s=state.selected;if(!s){$('engineeringBody').innerHTML='<p>Select a pipe or candidate location first.</p><button class="secondary" id="runEngineering">Analyse selected location</button>';bindEngineering();return}const p=s.feature.properties||{};const dia=p.DIAMETER||p.DIA||p.SIZE||p.size||'unknown';if(state.engMode==='prv')$('engineeringBody').innerHTML='<p><b>Preliminary PRV review</b></p><p>Selected '+escapeHtml(s.layer.kind)+'; indicated diameter: <b>'+escapeHtml(dia)+'</b>. Aqua should evaluate upstream/downstream pressure envelopes, minimum/peak flow, elevation, fire-flow constraints and valve authority before sizing. This location is a candidate only until those inputs are available.</p><button class="secondary" id="runEngineering">Re-run analysis</button>';else $('engineeringBody').innerHTML='<p><b>Preliminary air-valve review</b></p><p>Selected '+escapeHtml(s.layer.kind)+'; indicated diameter: <b>'+escapeHtml(dia)+'</b>. Aqua should use the longitudinal profile to locate summits and slope changes, then calculate air-release and vacuum-admission requirements for filling, draining and transient conditions.</p><button class="secondary" id="runEngineering">Re-run analysis</button>';bindEngineering()}
function bindEngineering(){const b=$('runEngineering');if(b)b.onclick=engineeringAnalysis}
function bind(){['newProjectBtn','emptyNewProject'].forEach(id=>$(id).onclick=openModal);$('closeProject').onclick=closeModal;$('gisDrop').onclick=()=>$('gisInput').click();$('gisInput').onchange=e=>$('gisFileName').textContent=e.target.files[0]?.name||'No GIS file selected';$('createProjectBtn').onclick=createProject;$('projectSelect').onchange=e=>{state.active=state.projects.find(p=>p.id===e.target.value)||null;if(state.active){renderProject();renderTelemetry()}};$('importTelemetryBtn').onclick=()=>$('telemetryInput').click();$('telemetryInput').onchange=e=>e.target.files[0]&&importTelemetry(e.target.files[0]);$('askBtn').onclick=()=>{const q=$('prompt').value.trim();if(q){$('prompt').value='';askCopilot(q)}};$('prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('askBtn').click()}});document.querySelectorAll('.suggestions button').forEach(b=>b.onclick=()=>askCopilot(b.textContent));$('runWaterBalance').onclick=runWaterBalance;$('runDmaPlanner').onclick=runDmaPlanner;$('runSensorPlanner').onclick=runSensorPlanner;$('refreshEvents').onclick=renderEvents;document.querySelectorAll('.eng-tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.eng-tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.engMode=b.dataset.eng;engineeringAnalysis()});document.querySelectorAll('[data-map-mode]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-map-mode]').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.mapMode=b.dataset.mapMode});bindEngineering()}
window.addEventListener('load',()=>{initMap();bind()});
/* === V2 NETWORK INTELLIGENCE + V3 ENGINEERING INTELLIGENCE === */
const V23={
  R:6371000,
  rad:function(d){return d*Math.PI/180},
  dist:function(a,b){var dLat=this.rad(b[0]-a[0]),dLng=this.rad(b[1]-a[1]);var s=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(this.rad(a[0]))*Math.cos(this.rad(b[0]))*Math.sin(dLng/2)*Math.sin(dLng/2);return 2*this.R*Math.asin(Math.sqrt(s))},
  val:function(o,names){var keys=Object.keys(o||{});for(var i=0;i<names.length;i++){var k=keys.find(function(x){return x.toLowerCase()===names[i].toLowerCase()});if(k!==undefined&&o[k]!==''&&o[k]!=null)return o[k]}return null},
  num:function(o,names){var v=this.val(o,names),n=Number(v);return Number.isFinite(n)?n:null},
  first:function(f){var g=f&&f.geometry;if(!g)return null;if(g.type==='Point')return[g.coordinates[1],g.coordinates[0]];if(g.type==='LineString'&&g.coordinates.length)return[g.coordinates[0][1],g.coordinates[0][0]];if(g.type==='Polygon'&&g.coordinates[0]&&g.coordinates[0].length)return[g.coordinates[0][0][1],g.coordinates[0][0][0]];return null},
  ends:function(f){var g=f&&f.geometry;if(!g)return null;var c=g.type==='LineString'?g.coordinates:g.type==='MultiLineString'?g.coordinates.flat():null;if(!c||c.length<2)return null;return[[c[0][1],c[0][0]],[c[c.length-1][1],c[c.length-1][0]]]},
  mid:function(f){var g=f&&f.geometry,c=g&&g.type==='LineString'?g.coordinates:g&&g.type==='MultiLineString'?g.coordinates.flat():null;if(!c||!c.length)return this.first(f);var m=c[Math.floor(c.length/2)];return[m[1],m[0]]},
  len:function(f){var g=f&&f.geometry,lines=[];if(g&&g.type==='LineString')lines=[g.coordinates];if(g&&g.type==='MultiLineString')lines=g.coordinates;var s=0;for(var z=0;z<lines.length;z++){for(var i=1;i<lines[z].length;i++)s+=this.dist([lines[z][i-1][1],lines[z][i-1][0]],[lines[z][i][1],lines[z][i][0]])}return s},
  pipes:function(){if(!state.active)return[];return state.active.layers.filter(function(l){return l.kind==='pipe'}).flatMap(function(l){return l.geojson.features.map(function(f,i){return{feature:f,layer:l,index:i}})})},
  points:function(kind){if(!state.active)return[];return state.active.layers.filter(function(l){return l.kind===kind}).flatMap(function(l){return l.geojson.features.map(function(f,i){return{feature:f,layer:l,index:i,coord:V23.first(f)}})}).filter(function(x){return x.coord})},
  clear:function(){if(state.analysisLayer)state.analysisLayer.clearLayers()},
  props:function(f){return f&&f.properties?f.properties:{}},
  risk:function(f){var p=this.props(f),mat=String(this.val(p,['MATERIAL','MAT','PIPE_TYPE','TYPE'])||'').toUpperCase(),dia=this.num(p,['DIAMETER','DIA','SIZE','PIPE_SIZE'])||100,bursts=this.num(p,['BURSTS','BREAKS','FAILURES'])||0,r=25;if(/CI|AC|GALV/.test(mat))r+=22;else if(/DI|STEEL/.test(mat))r+=12;else if(/PVC|HDPE|PE/.test(mat))r+=4;r+=Math.min(20,bursts*4);if(dia<100)r+=5;return Math.max(0,Math.min(100,r))},
  acoustic:function(f){var mat=String(this.val(this.props(f),['MATERIAL','MAT','PIPE_TYPE','TYPE'])||'').toUpperCase(),s=65;if(/CI|DI|STEEL|MS|GI/.test(mat))s+=20;if(/PVC|HDPE|PE/.test(mat))s-=25;if(/AC/.test(mat))s-=5;return Math.max(25,Math.min(95,s))},
  topology:function(show){if(!state.active)return null;var pipes=this.pipes(),nodes=[],edges=[];function findOrAdd(c){for(var i=0;i<nodes.length;i++)if(V23.dist(nodes[i].coord,c)<=3)return i;var id=nodes.length;nodes.push({id:id,coord:c,degree:0});return id}for(var i=0;i<pipes.length;i++){var e=this.ends(pipes[i].feature);if(!e)continue;var a=findOrAdd(e[0]),b=findOrAdd(e[1]);nodes[a].degree++;nodes[b].degree++;edges.push({a:a,b:b,feature:pipes[i].feature})}var adj=Array.from({length:nodes.length},function(){return[]});edges.forEach(function(e){adj[e.a].push(e.b);adj[e.b].push(e.a)});var seen=new Set(),components=0,largest=0;for(var n=0;n<nodes.length;n++){if(seen.has(n))continue;components++;var q=[n],count=0;seen.add(n);while(q.length){var u=q.shift();count++;adj[u].forEach(function(v){if(!seen.has(v)){seen.add(v);q.push(v)}})}largest=Math.max(largest,count)}var t={nodes:nodes,edges:edges,components:components,largest:largest,endpoints:nodes.filter(function(x){return x.degree===1}).length,junctions:nodes.filter(function(x){return x.degree>=3}).length};state.active.topology={nodes:nodes.map(function(x){return{id:x.id,coord:x.coord,degree:x.degree}}),edges:edges.map(function(e){return{a:e.a,b:e.b}}),components:components,largest:largest,endpoints:t.endpoints,junctions:t.junctions};if(show!==false){this.clear();nodes.forEach(function(x){var c=x.degree>=3?'#49d6df':x.degree===1?'#ff6d7b':'#7891a3';L.circleMarker(x.coord,{radius:x.degree>=3?4:2.5,color:c,fillColor:c,fillOpacity:.9,weight:1}).addTo(state.analysisLayer)});$('analysisOutput').innerHTML='<div class="metric-cards"><div><span>Nodes</span><b>'+nodes.length+'</b></div><div><span>Pipe edges</span><b>'+edges.length+'</b></div><div><span>Components</span><b>'+components+'</b></div><div><span>Main component</span><b>'+(nodes.length?Math.round(largest/nodes.length*100):0)+'%</b></div><div><span>Endpoints</span><b>'+t.endpoints+'</b></div><div><span>Junctions</span><b>'+t.junctions+'</b></div></div><div class="result-note">'+(components>1?'Disconnected components detected. Review GIS gaps or disconnected assets before hydraulic analysis.':'Network resolves as one connected component at 3 m snap tolerance.')+'</div>'}updateProjectUI();return t},
  telemetryValue:function(r,names){for(var i=0;i<names.length;i++){var v=Number(r[names[i]]);if(Number.isFinite(v))return v}var keys=Object.keys(r||{});for(var j=0;j<keys.length;j++){if(names.some(function(n){return keys[j].toLowerCase().indexOf(n.toLowerCase())>=0})){var z=Number(r[keys[j]]);if(Number.isFinite(z))return z}}return null},
  water:function(show){if(!state.active)return null;var p=state.active,flows=p.telemetry.filter(function(x){return x.type==='flow'}),meters=p.telemetry.filter(function(x){return x.type==='meter'}),input=0,auth=0,app=0;flows.forEach(function(x){input+=V23.telemetryValue(x,['volume','system_input','daily_volume','m3'])||0});if(!input){var qs=flows.map(function(x){return V23.telemetryValue(x,['flow','avg_flow','average_flow','ls'])}).filter(function(v){return v!=null});if(qs.length)input=qs.reduce(function(a,b){return a+b},0)/qs.length*86.4}meters.forEach(function(x){auth+=V23.telemetryValue(x,['consumption','volume','daily_volume','usage'])||0;app+=V23.telemetryValue(x,['apparent_loss','meter_error','unauthorized'])||0});var nrw=input?Math.max(0,input-auth):null,real=nrw==null?null:Math.max(0,nrw-app),pct=input&&nrw!=null?nrw/input*100:null,res={systemInput:input,authorized:auth,apparent:app,nrw:nrw,real:real,pct:pct,complete:!!(input&&meters.length)};state.active.analyses=state.active.analyses||{};state.active.analyses.water=res;if(show!==false)$('analysisOutput').innerHTML=res.complete?'<div class="metric-cards"><div><span>System input</span><b>'+input.toFixed(1)+' m³/d</b></div><div><span>Authorized use</span><b>'+auth.toFixed(1)+' m³/d</b></div><div><span>NRW</span><b>'+nrw.toFixed(1)+' m³/d</b></div><div><span>NRW %</span><b>'+pct.toFixed(1)+'%</b></div><div><span>Apparent loss</span><b>'+app.toFixed(1)+' m³/d</b></div><div><span>Estimated real loss</span><b>'+real.toFixed(1)+' m³/d</b></div></div><div class="result-note">Check period alignment, units and authorized unbilled use before treating this as an auditable IWA balance.</div>':'<div class="result-note"><b>Water balance incomplete.</b> Import bulk/inlet flow plus customer or authorized-consumption meter data. Aqua will not manufacture NRW from GIS geometry.</div>';return res},
  nearestTelemetry:function(coord,type){var rows=state.active?state.active.telemetry.filter(function(x){return x.type===type}):[],best=null;rows.forEach(function(t){var lat=Number(t.lat||t.latitude),lng=Number(t.lng||t.lon||t.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lng))return;var d=V23.dist(coord,[lat,lng]);if(!best||d<best.d)best={row:t,d:d,coord:[lat,lng]}});return best},
  fusion:function(show){if(!state.active)return[];var scored=this.pipes().map(function(x,i){var mid=V23.mid(x.feature),risk=V23.risk(x.feature),ac=V23.acoustic(x.feature),fp=V23.nearestTelemetry(mid,'flow'),pp=V23.nearestTelemetry(mid,'pressure'),ap=V23.nearestTelemetry(mid,'acoustic'),score=risk*.5+ac*.15;if(fp&&fp.d<800)score+=10;if(pp&&pp.d<800){var pv=V23.telemetryValue(pp.row,['pressure','avg_pressure']);if(pv>45)score+=Math.min(12,(pv-45)*.6)}if(ap&&ap.d<600){var nv=V23.telemetryValue(ap.row,['noise','score','confidence','acoustic']);if(nv!=null)score+=Math.min(24,nv>1?nv*.24:nv*24)}var id=String(V23.val(V23.props(x.feature),['ID','PIPE_ID','OBJECTID','FID'])||('P'+(i+1)));return{id:id,score:Math.min(100,score),risk:risk,acoustic:ac,feature:x.feature,mid:mid}}).sort(function(a,b){return b.score-a.score});this.clear();scored.slice(0,30).forEach(function(x){var coords=x.feature.geometry.type==='LineString'?x.feature.geometry.coordinates:x.feature.geometry.coordinates.flat();L.polyline(coords.map(function(c){return[c[1],c[0]]}),{color:x.score>=75?'#ff6d7b':x.score>=55?'#ffc65c':'#4f8fb6',weight:5,opacity:.9}).bindTooltip(x.id+' · fusion '+Math.round(x.score)+'/100').addTo(state.analysisLayer)});state.active.analyses=state.active.analyses||{};state.active.analyses.fusion=scored.slice(0,50).map(function(x){return{id:x.id,score:x.score,risk:x.risk,acoustic:x.acoustic,mid:x.mid}});if(show!==false)$('analysisOutput').innerHTML='<div class="rank-list">'+scored.slice(0,10).map(function(x,i){return'<div><b>#'+(i+1)+' '+escapeHtml(x.id)+'</b><span>Fusion '+Math.round(x.score)+' · pipe risk '+x.risk+' · acoustic '+x.acoustic+'</span></div>'}).join('')+'</div><div class="result-note">Fusion is a survey-priority score combining pipe susceptibility and nearby imported operational evidence. It is not leak confirmation.</div>';return scored},
  sensorPlan:function(count,show){if(!state.active)return[];count=count||20;var fusion=this.fusion(false),fmap=new Map(fusion.map(function(x){return[x.id,x.score]})),access=this.points('valve').concat(this.points('hydrant')).concat(this.points('meter'));if(!access.length)access=this.pipes().map(function(x){return{coord:V23.mid(x.feature),feature:x.feature,layer:x.layer,kind:'pipe'}});var candidates=access.map(function(x,i){var best=null,bd=Infinity;V23.pipes().forEach(function(p){var d=V23.dist(x.coord,V23.mid(p.feature));if(d<bd){bd=d;best=p}});var pid=best?String(V23.val(V23.props(best.feature),['ID','PIPE_ID','OBJECTID','FID'])||''):'';var risk=best?(fmap.get(pid)||V23.risk(best.feature)):35,ac=best?V23.acoustic(best.feature):55,kind=x.kind||x.layer.kind,bonus=kind==='valve'?18:kind==='hydrant'?16:kind==='meter'?10:4;return{id:String(V23.val(V23.props(x.feature),['ID','OBJECTID','FID'])||(kind+'-'+(i+1))),coord:x.coord,kind:kind,score:risk*.55+ac*.25+bonus}}).sort(function(a,b){return b.score-a.score});var chosen=[];for(var i=0;i<candidates.length&&chosen.length<count;i++){var c=candidates[i];if(chosen.every(function(x){return V23.dist(x.coord,c.coord)>=140}))chosen.push(c)}this.clear();chosen.forEach(function(c,i){L.circleMarker(c.coord,{radius:7,color:'#5edc9a',fillColor:'#5edc9a',fillOpacity:.95,weight:2}).bindTooltip('#'+(i+1)+' '+c.id+' · '+Math.round(c.score)).addTo(state.analysisLayer)});state.active.analyses=state.active.analyses||{};state.active.analyses.sensorPlan=chosen;if(show!==false)$('analysisOutput').innerHTML='<div class="metric-cards"><div><span>Recommended points</span><b>'+chosen.length+'</b></div><div><span>Method</span><b>Risk + acoustics + access</b></div></div><div class="rank-list">'+chosen.slice(0,12).map(function(c,i){return'<div><b>#'+(i+1)+' '+escapeHtml(c.id)+'</b><span>'+c.kind+' · score '+Math.round(c.score)+'</span></div>'}).join('')+'</div><div class="result-note">Confirm actual sensor access, attachment point and field safety before deployment.</div>';return chosen},
  prv:function(show){if(!state.active)return[];var vals=this.points('valve').map(function(v,i){var pp=V23.nearestTelemetry(v.coord,'pressure'),fp=V23.nearestTelemetry(v.coord,'flow'),press=pp&&pp.d<1200?V23.telemetryValue(pp.row,['pressure','avg_pressure','upstream_pressure']):null,flow=fp&&fp.d<1500?V23.telemetryValue(fp.row,['flow','avg_flow','ls']):null,score=20;if(press!=null)score+=Math.max(0,Math.min(55,(press-35)*1.8));if(flow!=null)score+=10;return{id:String(V23.val(V23.props(v.feature),['ID','VALVE_ID','OBJECTID','FID'])||('Valve '+(i+1))),coord:v.coord,pressure:press,flow:flow,score:Math.min(100,score)}}).sort(function(a,b){return b.score-a.score});this.clear();vals.slice(0,10).forEach(function(c){L.circleMarker(c.coord,{radius:7,color:'#f0a44b',fillColor:'#f0a44b',fillOpacity:.92,weight:2}).bindTooltip(c.id+' · PRV '+Math.round(c.score)).addTo(state.analysisLayer)});if(show!==false)$('analysisOutput').innerHTML='<div class="rank-list">'+vals.slice(0,10).map(function(c,i){return'<div><b>#'+(i+1)+' '+escapeHtml(c.id)+'</b><span>Score '+Math.round(c.score)+' · pressure '+(c.pressure==null?'—':c.pressure.toFixed(1)+' m')+' · flow '+(c.flow==null?'—':c.flow.toFixed(1)+' L/s')+'</span></div>'}).join('')+'</div><div class="result-note"><b>Preliminary PRV siting only.</b> Final sizing requires upstream/downstream pressure, min/avg/peak/fire flow, cavitation check and manufacturer Cv/Kv data.</div>';return vals},
  air:function(show){if(!state.active)return[];var out=[];this.pipes().forEach(function(p,pi){var g=p.feature.geometry;if(!g||g.type!=='LineString'||g.coordinates.length<3)return;var ok=g.coordinates.every(function(c){return Number.isFinite(Number(c[2]))});if(!ok)return;for(var i=1;i<g.coordinates.length-1;i++){var z0=Number(g.coordinates[i-1][2]),z=Number(g.coordinates[i][2]),z1=Number(g.coordinates[i+1][2]);if(z>z0&&z>z1){var dia=V23.num(V23.props(p.feature),['DIAMETER','DIA','SIZE','PIPE_SIZE'])||100,prom=Math.min(z-z0,z-z1);out.push({id:'AV-'+(pi+1)+'-'+i,coord:[g.coordinates[i][1],g.coordinates[i][0]],z:z,prom:prom,dia:dia,score:Math.min(100,45+prom*8+Math.min(20,dia/25))})}}});if(!out.length)this.pipes().slice(0,12).forEach(function(p,i){out.push({id:'Profile-'+(i+1),coord:V23.mid(p.feature),z:null,prom:null,dia:V23.num(V23.props(p.feature),['DIAMETER','DIA','SIZE','PIPE_SIZE'])||100,score:30})});out.sort(function(a,b){return b.score-a.score});this.clear();out.slice(0,12).forEach(function(c){L.circleMarker(c.coord,{radius:7,color:'#b08cff',fillColor:'#b08cff',fillOpacity:.92,weight:2}).bindTooltip(c.id+' · air valve').addTo(state.analysisLayer)});if(show!==false)$('analysisOutput').innerHTML='<div class="rank-list">'+out.slice(0,12).map(function(c,i){return'<div><b>#'+(i+1)+' '+c.id+'</b><span>'+(c.z==null?'Elevation missing':'elev '+c.z.toFixed(1)+' · prominence '+c.prom.toFixed(1)+' m')+' · pipe '+c.dia+' mm</span></div>'}).join('')+'</div><div class="result-note">'+(out.some(function(c){return c.z!=null})?'<b>Local high points detected from GIS Z values.</b>':'<b>No usable pipe elevation/Z profile found.</b>')+' Final type/orifice sizing requires filling/draining rate, allowable differential pressure and transient/vacuum criteria.</div>';return out}
};

function V23route(q){
  var s=q.toLowerCase();
  if(/topolog|connect|network graph|disconnected/.test(s)){var t=V23.topology(true);return'I rebuilt the network graph: <b>'+t.nodes.length+' nodes</b>, <b>'+t.edges.length+' pipe edges</b> and <b>'+t.components+' component(s)</b>.'}
  if(/water balance|nrw|non.?revenue|real loss|apparent loss/.test(s)){var w=V23.water(true);return w.complete?'Imported-data NRW is <b>'+w.nrw.toFixed(1)+' m³/day ('+w.pct.toFixed(1)+'%)</b>.':'I need both system-input flow and authorized-consumption meter evidence before calculating NRW.'}
  if(/hydrophone|sensor.*deploy|acoustic.*deploy/.test(s)){var m=s.match(/\b(\d{1,3})\b/),n=m?Number(m[1]):20,c=V23.sensorPlan(n,true);return'I planned <b>'+c.length+' hydrophone locations</b> using actual network/access assets, risk, acoustics and spacing.'}
  if(/suspected leak|leak priority|fusion|fuse|where.*leak/.test(s)){var f=V23.fusion(true);return f.length?'Highest fused priority is <b>'+escapeHtml(f[0].id)+'</b> at '+Math.round(f[0].score)+'/100.':'No pipe network is available.'}
  if(/prv|pressure reducing|reduce pressure/.test(s)){var p=V23.prv(true);return'I screened <b>'+p.length+' valve locations</b> for preliminary PRV candidacy.'}
  if(/air valve|air release|vacuum|high point/.test(s)){var a=V23.air(true);return'I screened <b>'+a.length+' air-valve candidates</b>. '+(a.some(function(x){return x.z!=null})?'GIS elevation was available.':'A longitudinal elevation profile is still required.')}
  return null
}

var oldAskCopilot=askCopilot;
askCopilot=async function(q){var local=state.active?V23route(q):null;if(local){addUser(q);addAi(local);return}return oldAskCopilot(q)};

window.addEventListener('load',function(){
  if($('runTopology'))$('runTopology').onclick=function(){var t=V23.topology(true);addAi('Topology graph: '+t.nodes.length+' nodes, '+t.edges.length+' edges, '+t.components+' component(s).')};
  if($('runWaterBalance'))$('runWaterBalance').onclick=function(){var w=V23.water(true);addAi(w.complete?'Water balance complete: NRW '+w.pct.toFixed(1)+'%.':'Water balance needs input-flow and consumption data.')};
  if($('runFusion'))$('runFusion').onclick=function(){var r=V23.fusion(true);addAi(r.length?'Highest fused priority: '+escapeHtml(r[0].id)+' at '+Math.round(r[0].score)+'/100.':'No pipes available.')};
  if($('runSensorPlanner'))$('runSensorPlanner').onclick=function(){var r=V23.sensorPlan(20,true);addAi('Planned '+r.length+' hydrophone locations.')};
  if($('runPrvAdvisor'))$('runPrvAdvisor').onclick=function(){var r=V23.prv(true);addAi('Screened '+r.length+' PRV candidates.')};
  if($('runAirAdvisor'))$('runAirAdvisor').onclick=function(){var r=V23.air(true);addAi('Screened '+r.length+' air-valve candidates.')};
  if($('clearAnalysis'))$('clearAnalysis').onclick=function(){V23.clear();$('analysisOutput').innerHTML='<div class="empty-row">Analysis overlay cleared.</div>'};
});

/* V2 project persistence + DMA validation */
function V23pointInPolygon(point,feature){
  var g=feature&&feature.geometry;if(!g||['Polygon','MultiPolygon'].indexOf(g.type)<0)return false;
  var polys=g.type==='Polygon'?[g.coordinates]:g.coordinates,x=point[1],y=point[0];
  function insideRing(ring){var inside=false;for(var i=0,j=ring.length-1;i<ring.length;j=i++){var xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];var hit=((yi>y)!=(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi+1e-12)+xi);if(hit)inside=!inside}return inside}
  return polys.some(function(poly){return poly[0]&&insideRing(poly[0])})
}
V23.dma=function(show){
  if(!state.active)return[];
  var dmas=state.active.layers.filter(function(l){return l.kind==='dma'}).flatMap(function(l){return l.geojson.features.map(function(f,i){return{feature:f,layer:l,index:i}})}),
      valves=this.points('valve'),meters=this.points('meter'),pipes=this.pipes();
  if(!dmas.length){
    var t=state.active.topology||this.topology(false);
    if(show!==false)$('analysisOutput').innerHTML='<div class="result-note"><b>No recognized DMA polygon/region layer.</b> Network graph has '+t.components+' component(s), '+valves.length+' valves and '+meters.length+' mapped meters. Aqua will not invent DMA boundaries without boundary geometry or isolation/meter rules.</div>';
    return[];
  }
  var out=dmas.map(function(d,i){
    var pk=0,km=0,vk=0,mk=0;
    pipes.forEach(function(p){var m=V23.mid(p.feature);if(m&&V23pointInPolygon(m,d.feature)){pk++;km+=V23.len(p.feature)/1000}});
    valves.forEach(function(v){if(V23pointInPolygon(v.coord,d.feature))vk++});
    meters.forEach(function(m){if(V23pointInPolygon(m.coord,d.feature))mk++});
    var id=String(V23.val(V23.props(d.feature),['DMA','NAME','ID','REGION','ZONE','OBJECTID'])||('DMA '+(i+1)));
    return{id:id,pipes:pk,km:km,valves:vk,meters:mk,score:Math.min(100,30+(mk?25:0)+(vk?20:0)+(pk>10?15:0)+(km>1?10:0))}
  }).sort(function(a,b){return b.score-a.score});
  state.active.analyses=state.active.analyses||{};state.active.analyses.dma=out;
  if(show!==false)$('analysisOutput').innerHTML='<div class="rank-list">'+out.map(function(r){return'<div><b>'+escapeHtml(r.id)+'</b><span>'+r.km.toFixed(1)+' km · '+r.pipes+' pipes · '+r.valves+' valves · '+r.meters+' meters · readiness '+Math.round(r.score)+'</span></div>'}).join('')+'</div><div class="result-note">DMA readiness is a GIS screening result. Boundary closure, valve status, flow direction and meter role still require validation before the zone is treated as hydraulically closed.</div>';
  return out
};

async function V23db(){
  return new Promise(function(resolve,reject){
    var req=indexedDB.open('AquaIntelligenceDB',1);
    req.onupgradeneeded=function(){var d=req.result;if(!d.objectStoreNames.contains('projects'))d.createObjectStore('projects',{keyPath:'id'})};
    req.onsuccess=function(){resolve(req.result)};req.onerror=function(){reject(req.error)}
  })
}
async function V23persist(){
  if(!state.active)return;
  try{var d=await V23db();await new Promise(function(resolve,reject){var tx=d.transaction('projects','readwrite');tx.objectStore('projects').put(state.active);tx.oncomplete=resolve;tx.onerror=function(){reject(tx.error)}})}catch(e){console.warn('Aqua project persistence unavailable',e)}
}
async function V23restore(){
  try{
    var d=await V23db(),projects=await new Promise(function(resolve,reject){var req=d.transaction('projects','readonly').objectStore('projects').getAll();req.onsuccess=function(){resolve(req.result||[])};req.onerror=function(){reject(req.error)}});
    if(!projects.length)return;
    state.projects=projects;
    projects.forEach(function(p){if(!Array.from($('projectSelect').options).some(function(o){return o.value===p.id})){var o=document.createElement('option');o.value=p.id;o.textContent=p.name;$('projectSelect').appendChild(o)}});
    if(!state.active){state.active=projects[0];$('projectSelect').value=state.active.id;renderProject();renderTelemetry();addAi('Restored <b>'+escapeHtml(state.active.name)+'</b> from the local project database.')}
  }catch(e){console.warn('Could not restore Aqua projects',e)}
}
var V23oldCreate=createProject;
createProject=async function(){await V23oldCreate();if(state.active){if(!state.active.topology)state.active.topology=V23.topology(false);await V23persist()}};
var V23oldImport=importTelemetry;
importTelemetry=async function(file){await V23oldImport(file);await V23persist()};

window.addEventListener('load',function(){
  if($('runDmaPlanner'))$('runDmaPlanner').onclick=function(){var r=V23.dma(true);addAi(r.length?'Validated '+r.length+' DMA/region feature(s) against pipes, valves and meters.':'No DMA polygon layer is available for validation.')};
  setTimeout(V23restore,150);
});

function createDemoProject(){
  const baseLat=1.3425,baseLng=103.7050;
  const mkLine=(id,coords,material,size,length)=>({type:'Feature',properties:{ID:id,MATERIAL:material,PIPE_SIZE:size,LENGTH:length},geometry:{type:'LineString',coordinates:coords.map(c=>[c[1],c[0]])}});
  const pipes=[
    mkLine('P-101',[[baseLat,baseLng],[baseLat+.002,baseLng+.003]],'DIP',150,420),
    mkLine('P-102',[[baseLat+.002,baseLng+.003],[baseLat+.004,baseLng+.006]],'PVC',100,390),
    mkLine('P-103',[[baseLat+.002,baseLng+.003],[baseLat+.003,baseLng-.001]],'DIP',200,360),
    mkLine('P-104',[[baseLat+.004,baseLng+.006],[baseLat+.006,baseLng+.008]],'HDPE',100,310),
    mkLine('P-105',[[baseLat+.003,baseLng-.001],[baseLat+.006,baseLng-.002]],'CI',100,350)
  ];
  const valves=[
    {type:'Feature',properties:{ID:'V-01'},geometry:{type:'Point',coordinates:[baseLng+.003,baseLat+.002]}},
    {type:'Feature',properties:{ID:'V-02'},geometry:{type:'Point',coordinates:[baseLng+.006,baseLat+.004]}},
    {type:'Feature',properties:{ID:'V-03'},geometry:{type:'Point',coordinates:[baseLng-.001,baseLat+.003]}}
  ];
  const meters=[
    {type:'Feature',properties:{ID:'FM-01',TYPE:'flowmeter'},geometry:{type:'Point',coordinates:[baseLng,baseLat]}},
    {type:'Feature',properties:{ID:'M-01'},geometry:{type:'Point',coordinates:[baseLng+.008,baseLat+.006]}}
  ];
  const dmaPoly={type:'Feature',properties:{ID:'DMA-DEMO',NAME:'Demo DMA'},geometry:{type:'Polygon',coordinates:[[
    [baseLng-.003,baseLat-.001],[baseLng+.010,baseLat-.001],[baseLng+.010,baseLat+.008],[baseLng-.003,baseLat+.008],[baseLng-.003,baseLat-.001]
  ]]}};
  const p={
    id:'demo_nrw_project',
    name:'Demo NRW Network',
    utility:'Aqua Intelligence Demo',
    source:'Built-in demo',
    layers:[
      {name:'pipe',kind:'pipe',geojson:{type:'FeatureCollection',features:pipes}},
      {name:'valve',kind:'valve',geojson:{type:'FeatureCollection',features:valves}},
      {name:'meter',kind:'meter',geojson:{type:'FeatureCollection',features:meters}},
      {name:'regionnet',kind:'dma',geojson:{type:'FeatureCollection',features:[dmaPoly]}}
    ],
    telemetry:[
      {_id:'F-01',type:'flow',lat:baseLat,lng:baseLng,flow:12.8,mnf:4.2,volume:1106},
      {_id:'P-01',type:'pressure',lat:baseLat+.004,lng:baseLng+.006,pressure:51.2},
      {_id:'A-01',type:'acoustic',lat:baseLat+.003,lng:baseLng-.001,noise:0.78},
      {_id:'MTR-01',type:'meter',consumption:790}
    ],
    created:new Date().toISOString(),
    analyses:{}
  };
  if(!state.projects.some(x=>x.id===p.id))state.projects.push(p);
  if(!Array.from($('projectSelect').options).some(o=>o.value===p.id)){
    const o=document.createElement('option');o.value=p.id;o.textContent=p.name;$('projectSelect').appendChild(o);
  }
  state.active=p;$('projectSelect').value=p.id;
  if(window.V23&&V23.topology)p.topology=V23.topology(false);
  renderProject();renderTelemetry();
  if(window.V23persist)V23persist();
  addAi('Loaded the built-in <b>Demo NRW Network</b>. You can test topology, DMA, water balance, leak fusion, hydrophone planning, PRV and air-valve workflows immediately.');
}

window.addEventListener('load',function(){
  if($('demoProjectBtn'))$('demoProjectBtn').onclick=createDemoProject;
  if($('emptyDemoProject'))$('emptyDemoProject').onclick=createDemoProject;
});

/* Left workspace navigation */
function aquaSetRailActive(view){
  document.querySelectorAll('.nav[data-view]').forEach(function(b){
    b.classList.toggle('active',b.dataset.view===view);
  });
}
function aquaFocus(el){
  if(!el)return;
  el.classList.remove('workspace-focus');
  void el.offsetWidth;
  el.classList.add('workspace-focus');
  el.scrollIntoView({behavior:'smooth',block:'start'});
  setTimeout(function(){if(state.map)state.map.invalidateSize()},350);
}
function aquaSetMapMode(mode){
  var btn=document.querySelector('[data-map-mode="'+mode+'"]');
  if(btn){
    document.querySelectorAll('[data-map-mode]').forEach(function(x){x.classList.remove('active')});
    btn.classList.add('active');
    state.mapMode=mode;
  }
}
function aquaNavigate(view){
  aquaSetRailActive(view);
  history.replaceState(null,'','#'+view);

  if(view==='operations'){
    aquaSetMapMode('inspect');
    aquaFocus(document.querySelector('.cockpit'));
    return;
  }

  if(view==='nrw'){
    aquaFocus(document.querySelector('.analysis-grid'));
    if(state.active&&window.V23){
      try{
        var w=V23.water(true);
        if(!w.complete){
          $('analysisOutput').innerHTML='<div class="result-note"><b>NRW workspace</b><br>Import bulk/inlet flow and authorized-consumption data to calculate a defensible water balance. You can still run leak-evidence fusion from the Network Intelligence panel.</div>';
        }
      }catch(e){}
    }else if($('analysisOutput')){
      $('analysisOutput').innerHTML='<div class="result-note"><b>NRW workspace</b><br>Open a project to calculate water balance, real/apparent losses and fused leak priority.</div>';
    }
    return;
  }

  if(view==='dma'){
    aquaSetMapMode('dma');
    aquaFocus(document.querySelector('.cockpit'));
    if(state.active&&window.V23&&V23.dma){
      try{V23.dma(true)}catch(e){}
    }
    return;
  }

  if(view==='pressure'){
    aquaSetMapMode('prv');
    if($('hydraulicMetric'))$('hydraulicMetric').value='pressure';
    aquaFocus($('hydraulicsWorkbench'));
    return;
  }

  if(view==='acoustic'){
    aquaSetMapMode('sensor');
    aquaFocus($('acousticWorkbench'));
    return;
  }

  if(view==='hydraulics'){
    aquaFocus($('hydraulicsWorkbench'));
    return;
  }

  if(view==='assets'){
    aquaSetMapMode('inspect');
    aquaFocus(document.querySelector('.cockpit'));
    return;
  }

  if(view==='planning'){
    aquaSetMapMode('sensor');
    aquaFocus($('acousticWorkbench'));
    return;
  }
}
window.addEventListener('load',function(){
  document.querySelectorAll('.nav[data-view]').forEach(function(b){
    b.onclick=function(){aquaNavigate(b.dataset.view)};
  });
  var initial=(location.hash||'#operations').replace('#','');
  if(document.querySelector('.nav[data-view="'+initial+'"]'))aquaSetRailActive(initial);
});

function aquaTransformLayersBetween(layers,fromCrs,toCrs){
  aquaDefineTaiwanCrs();
  if(fromCrs===toCrs)return JSON.parse(JSON.stringify(layers));
  if(typeof proj4==='undefined')throw new Error('Projection library not loaded.');
  function tx(coords){
    if(!Array.isArray(coords))return coords;
    if(typeof coords[0]==='number'&&typeof coords[1]==='number'){
      const out=proj4(fromCrs,toCrs,[Number(coords[0]),Number(coords[1])]);
      return coords.length>2?[out[0],out[1],...coords.slice(2)]:[out[0],out[1]];
    }
    return coords.map(tx);
  }
  return layers.map(layer=>({
    ...layer,
    geojson:{...layer.geojson,features:(layer.geojson?.features||[]).map(f=>({
      ...f,geometry:f.geometry?{...f.geometry,coordinates:tx(f.geometry.coordinates)}:f.geometry
    }))}
  }));
}
function aquaSyncCrsUi(){
  if(!$('activeCrs'))return;
  const p=state.active;
  $('activeCrs').value=(p&&p.sourceCrs)||'EPSG:3826';
}
function aquaApplyProjectCrs(){
  if(!state.active){alert('Open a project first.');return}
  const target=$('activeCrs').value;
  const p=state.active;
  try{
    let raw=p.rawLayers;
    if(!raw){
      if(p.reprojected&&p.sourceCrs&&p.sourceCrs!=='EPSG:4326'){
        raw=aquaTransformLayersBetween(p.layers,'EPSG:4326',p.sourceCrs);
      }else{
        raw=JSON.parse(JSON.stringify(p.layers));
      }
    }
    p.rawLayers=raw;
    p.sourceCrs=target;
    p.reprojected=target!=='EPSG:4326';
    p.layers=target==='EPSG:4326'?JSON.parse(JSON.stringify(raw)):aquaTransformLayersBetween(raw,target,'EPSG:4326');
    p.topology=null;
    p.analyses={};
    renderProject();renderTelemetry();aquaSyncCrsUi();
    if(window.V23persist)V23persist();
    addAi('Project CRS changed to <b>'+escapeHtml(target)+'</b> and the GIS was reprojected to WGS84 for display.');
  }catch(e){
    alert('Could not change projection: '+e.message);
  }
}

const aquaOldUpdateProjectUI=updateProjectUI;
updateProjectUI=function(){aquaOldUpdateProjectUI();aquaSyncCrsUi()};

const aquaOldNavigate=aquaNavigate;
aquaNavigate=function(view){
  document.body.dataset.workspace=view;
  aquaSetRailActive(view);
  history.replaceState(null,'','#'+view);

  if(view==='operations'){
    aquaSetMapMode('inspect');
    if(state.map)setTimeout(()=>state.map.invalidateSize(),50);
    return;
  }
  if(view==='nrw'){
    if(state.active&&window.V23){try{V23.water(true)}catch(e){}}
    return;
  }
  if(view==='dma'){
    aquaSetMapMode('dma');
    if(state.active&&window.V23&&V23.dma){try{V23.dma(true)}catch(e){}}
    return;
  }
  if(view==='pressure'){
    aquaSetMapMode('prv');
    if($('hydraulicMetric'))$('hydraulicMetric').value='pressure';
    return;
  }
  if(view==='acoustic'){
    aquaSetMapMode('sensor');
    return;
  }
  if(view==='hydraulics')return;
  if(view==='assets'){
    aquaSetMapMode('inspect');
    if(state.map)setTimeout(()=>state.map.invalidateSize(),50);
    return;
  }
  if(view==='planning'){
    aquaSetMapMode('sensor');
    return;
  }
};

window.addEventListener('load',function(){
  if($('applyCrsBtn'))$('applyCrsBtn').onclick=aquaApplyProjectCrs;
  if($('projectSelect'))$('projectSelect').addEventListener('change',function(){setTimeout(aquaSyncCrsUi,50)});
  document.body.dataset.workspace=(location.hash||'#operations').replace('#','');
});

async function aquaLoadDemoBundle(file){
  try{
    const data=JSON.parse(await file.text());
    if(!data||!Array.isArray(data.layers))throw new Error('Invalid Aqua demo data bundle.');
    const project={
      id:'demo_data',
      name:'demo data',
      utility:'Taiwan Demo Networks',
      source:file.name,
      sourceCrs:'MIXED',
      reprojected:true,
      layers:data.layers,
      telemetry:[],
      created:new Date().toISOString(),
      analyses:{},
      datasets:data.datasets||[]
    };
    const existing=state.projects.findIndex(p=>p.id===project.id);
    if(existing>=0)state.projects[existing]=project;else state.projects.push(project);

    let opt=Array.from($('projectSelect').options).find(o=>o.value===project.id);
    if(!opt){opt=document.createElement('option');opt.value=project.id;$('projectSelect').appendChild(opt)}
    opt.textContent='demo data';

    state.active=project;
    $('projectSelect').value=project.id;
    renderProject();
    renderTelemetry();
    if(window.V23&&V23.topology){
      try{project.topology=V23.topology(false)}catch(e){console.warn(e)}
    }
    if(window.V23persist)await V23persist();

    if($('activeCrs')){
      const mixedOpt=Array.from($('activeCrs').options).find(o=>o.value==='MIXED');
      if(!mixedOpt){
        const o=document.createElement('option');o.value='MIXED';o.textContent='Mixed source CRS · normalized to WGS84';$('activeCrs').prepend(o);
      }
      $('activeCrs').value='MIXED';
    }

    const ds=(data.datasets||[]).map(d=>d.name).join(', ');
    addAi('Loaded <b>demo data</b> with '+data.layers.length+' GIS layers across <b>'+escapeHtml(ds||'the supplied Taiwan datasets')+'</b>. All display geometry is normalized to WGS84; original source CRS metadata is retained per dataset.');
  }catch(e){
    console.error(e);
    alert('Could not load demo data bundle: '+e.message);
  }
}

window.addEventListener('load',function(){
  if($('demoProjectBtn'))$('demoProjectBtn').onclick=function(){$('demoBundleInput').click()};
  if($('emptyDemoProject'))$('emptyDemoProject').onclick=function(){$('demoBundleInput').click()};
  if($('demoBundleInput'))$('demoBundleInput').onchange=function(e){if(e.target.files[0])aquaLoadDemoBundle(e.target.files[0])};
});
