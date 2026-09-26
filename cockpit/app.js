const $=id=>document.getElementById(id);
const state={projects:[],active:null,map:null,networkLayer:null,telemetryLayer:null,selected:null,mapMode:'inspect',engMode:'prv'};
const assetKinds={pipe:['pipe','eupipe','main','waterline'],meter:['meter','eumeter','flowmeter'],valve:['valve','gate','prv'],hydrant:['hydrant'],dma:['regionnet','dma','zone','district']};
const colors={pipe:'#5c8da9',meter:'#ffc65c',valve:'#aa82ff',hydrant:'#ff7f6d',dma:'#36a3ff',other:'#72879a'};
function kindFor(name=''){const n=name.toLowerCase();for(const[k,terms]of Object.entries(assetKinds))if(terms.some(t=>n.includes(t)))return k;return'other'}
function initMap(){
  state.map=L.map('map',{zoomControl:true,preferCanvas:true}).setView([23.7,120.95],8);
  window.aquaMap=state.map;
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
function updateProjectUI(){const p=state.active;if(!p)return;$('projectTitle').textContent=p.name;$('networkStatus').textContent='GIS loaded';$('projectEmpty').classList.add('hidden');$('projectTree').classList.remove('hidden');const counts={};['pipe','meter','valve','hydrant','dma'].forEach(k=>counts[k]=featureCount(p,k));$('pipeCount').textContent=counts.pipe;$('meterCount').textContent=counts.meter;$('treeMeters').textContent=counts.meter;$('valveCount').textContent=counts.valve;$('hydrantCount').textContent=counts.hydrant;$('dmaCount').textContent=counts.dma||'0';$('treeDmas').textContent=counts.dma;$('assetTotal').textContent=Object.values(counts).reduce((a,b)=>a+b,0);const km=pipeLength(p)/1000;$('pipeLength').textContent=km?km.toFixed(1)+' km':counts.pipe+' seg';$('flowCount').textContent=p.telemetry.filter(x=>x.type==='flow').length;$('pressureCount').textContent=p.telemetry.filter(x=>x.type==='pressure').length;const acousticCount=(p.acousticSensor||[]).length||p.telemetry.filter(x=>x.type==='acoustic').length;$('acousticCount').textContent=acousticCount;$('telemetryCount').textContent=p.telemetry.length;$('pressureStatus').textContent=p.telemetry.some(x=>x.type==='pressure')?'Connected':'No stream';$('acousticStatus').textContent=acousticCount?acousticCount+' operational':'No stream';$('confidence').textContent=confidenceScore(p)+'%';renderHealth();renderEvents()}
function confidenceScore(p){let s=35;if(featureCount(p,'pipe'))s+=20;if(featureCount(p,'meter'))s+=10;if(featureCount(p,'valve'))s+=8;if(featureCount(p,'dma'))s+=7;if(p.telemetry.some(x=>x.type==='flow'))s+=8;if(p.telemetry.some(x=>x.type==='pressure'))s+=7;if((p.acousticSensor||[]).length||p.telemetry.some(x=>x.type==='acoustic'))s+=5;return Math.min(100,s)}

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
async function createProject(){
  const file=$('gisInput').files[0];
  if(!file){alert('Choose a zipped shapefile or GeoJSON package.');return}
  const name=$('projectName').value.trim()||file.name.replace(/\.(zip|json|geojson)$/i,'');
  $('createProjectBtn').textContent='Reading GIS…';$('createProjectBtn').disabled=true;
  try{
    let raw;
    if(/\.zip$/i.test(file.name)){const buf=await file.arrayBuffer();raw=await shp(buf)}
    else raw=JSON.parse(await file.text());
    const rawLayers=normalizeShpResult(raw).map(x=>({...x,kind:kindFor(x.name)}));
    const projected=aquaReprojectLayers(rawLayers,$('projectCrs')?.value||'auto');
    const project={
      id:'p_'+Date.now(),name,utility:$('utilityName').value.trim(),
      source:file.name,sourceType:/\.zip$/i.test(file.name)?'shapefile-zip':'geojson',
      sourceCrs:projected.sourceCrs,normalizedCrs:'EPSG:4326',reprojected:projected.reprojected,
      rawLayers,layers:projected.layers,telemetry:[],created:new Date().toISOString(),
      status:'active',projectVersion:0,cloudRevision:0,
      projectConfig:{},dmaDisplay:{visible:true},dmaStyles:{},dmaFeatureMappings:[],
      provenance:{sourceType:/\.zip$/i.test(file.name)?'shapefile-zip':'geojson',sourceFilename:file.name,telemetrySources:[],reprojected:projected.reprojected}
    };
    project.__aquaPendingSourceFile=file;
    try{
      await V23persistProject(project,{setActive:true,sourceFile:file});
    }catch(persistenceError){
      aquaActivateProject(project);
      aquaShowPersistenceError(project,persistenceError);
      closeModal();renderProject();renderTelemetry();
      addAi('Project <b>'+escapeHtml(project.name)+'</b> is open in this session, but it was <b>not synchronized</b>. Use Retry save before reloading.');
      return;
    }
    aquaActivateProject(project);closeModal();renderProject();renderTelemetry();
    addAi('Project <b>'+escapeHtml(project.name)+'</b> was centrally saved and opened. I classified '+project.layers.length+' GIS layers and '+project.layers.reduce((s,l)=>s+l.geojson.features.length,0)+' features. Source CRS: <b>'+escapeHtml(project.sourceCrs||'unknown')+'</b>'+(project.reprojected?' → reprojected to WGS84 for display.':'.'));
  }catch(e){console.error(e);alert('GIS import failed: '+e.message)}
  finally{$('createProjectBtn').textContent='Create & analyse project';$('createProjectBtn').disabled=false}
}
function parseCSV(text){const lines=text.trim().split(/\r?\n/);if(lines.length<2)return[];const h=lines[0].split(',').map(x=>x.trim());return lines.slice(1).map(line=>{const cols=line.split(',');return Object.fromEntries(h.map((k,i)=>[k,cols[i]?.trim()]))})}
function inferTelemetry(row){const keys=Object.keys(row).map(k=>k.toLowerCase());const has=s=>keys.some(k=>k.includes(s));return has('acoustic')||has('noise')?'acoustic':has('pressure')?'pressure':has('flow')||has('mnf')?'flow':has('meter')||has('consumption')?'meter':'other'}
async function importTelemetry(file){
  if(!state.active){alert('Open a project first.');return}
  const rows=/\.json$/i.test(file.name)?JSON.parse(await file.text()):parseCSV(await file.text());
  const arr=Array.isArray(rows)?rows:(rows.records||[]);
  arr.forEach((row,index)=>state.active.telemetry.push({...row,_id:row.id||('T'+(index+1)),type:row.type||inferTelemetry(row)}));
  renderTelemetry();updateProjectUI();
  const saved=await window.AquaProjectPersistence.save(state.active,{setActive:true});
  addAi(saved?'Imported and saved <b>'+arr.length+'</b> telemetry records.':'Imported <b>'+arr.length+'</b> telemetry records into this session, but the project is <b>not saved</b>. Use Retry save before reloading.');
}
function renderTelemetry(){state.telemetryLayer.clearLayers();if(!state.active)return;state.active.telemetry.forEach(t=>{const lat=Number(t.lat||t.latitude),lng=Number(t.lng||t.lon||t.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lng))return;const c=t.type==='pressure'?colors.dma:t.type==='acoustic'?colors.hydrant:colors.meter;L.circleMarker([lat,lng],{radius:5,color:c,fillColor:c,fillOpacity:1}).bindTooltip((t._id||'Telemetry')+' · '+t.type).addTo(state.telemetryLayer)})}
function renderHealth(){const p=state.active;if(!p)return;const vals=[['GIS topology',featureCount(p,'pipe')?'Ready':'Missing'],['Flow / meter',p.telemetry.some(x=>['flow','meter'].includes(x.type))?'Ready':'Missing'],['Pressure',p.telemetry.some(x=>x.type==='pressure')?'Ready':'Missing'],['Acoustic',(p.acousticSensor||[]).length||p.telemetry.some(x=>x.type==='acoustic')?'Ready':'Missing']];$('dataHealth').innerHTML=vals.map(([a,b])=>'<div><span>'+a+'</span><b>'+b+'</b></div>').join('')}
function renderEvents(){const p=state.active;if(!p)return;const events=[];const pipes=featureCount(p,'pipe'),meters=featureCount(p,'meter'),dmas=featureCount(p,'dma');if(pipes&&!dmas)events.push({sev:'med',title:'DMA boundaries not confirmed',body:'Network contains '+pipes+' pipe features but no recognized DMA/region layer.',tag:'DMA design'});if(pipes&&!meters)events.push({sev:'med',title:'Meter coverage unavailable',body:'Aqua cannot complete a defensible water balance until inlet/customer meter data is mapped.',tag:'Data gap'});if(!p.telemetry.length)events.push({sev:'low',title:'No live operational evidence',body:'Import flow, pressure or acoustic telemetry to move from GIS planning to event detection.',tag:'Telemetry'});if(p.telemetry.some(x=>x.type==='flow')&&!p.telemetry.some(x=>x.type==='pressure'))events.push({sev:'med',title:'Flow present without pressure context',body:'Pressure logging will improve leakage interpretation and pressure-management advice.',tag:'Pressure'});if(!events.length)events.push({sev:'low',title:'Network ready for analysis',body:'GIS and operational evidence are available. Run water balance, DMA planning or acoustic deployment.',tag:'Ready'});$('eventList').innerHTML=events.map(e=>'<div class="event '+e.sev+'"><i></i><div><b>'+e.title+'</b><p>'+e.body+'</p></div><strong>'+e.tag+'</strong></div>').join('')}
function addAi(html){const d=document.createElement('div');d.className='msg ai';d.innerHTML='<b>Aqua</b><p>'+html+'</p>';$('chat').appendChild(d);$('chat').scrollTop=$('chat').scrollHeight}
function addUser(text){const d=document.createElement('div');d.className='msg user';d.innerHTML='<b>You</b><p>'+escapeHtml(text)+'</p>';$('chat').appendChild(d);$('chat').scrollTop=$('chat').scrollHeight}
function contextSnapshot(){const p=state.active;if(!p)return null;return{project:p.name,utility:p.utility,layers:p.layers.map(l=>({name:l.name,kind:l.kind,count:l.geojson.features.length})),telemetry:p.telemetry.slice(-250),selected:state.selected?{layer:state.selected.layer.name,kind:state.selected.layer.kind,properties:state.selected.feature.properties}:null,confidence:confidenceScore(p)}}
async function askCopilot(q){addUser(q);if(!state.active){addAi('Open a project first. The Copilot needs the network context before it can reason about NRW.');return}addAi(localReasoning(q))}
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

window.V23=V23;

function V23intent(q){
  var s=q.toLowerCase();
  if(/topolog|connect|network graph|disconnected/.test(s))return{intent:'network.topology',parameters:{}};
  if(/water balance|nrw|non.?revenue|real loss|apparent loss/.test(s))return{intent:'nrw.water_balance',parameters:{}};
  if(/hydrophone|sensor.*deploy|acoustic.*deploy/.test(s)){var m=s.match(/\b(\d{1,3})\b/);return{intent:'acoustic.sensor_plan',parameters:{count:m?Number(m[1]):20}}}
  if(/suspected leak|leak priority|fusion|fuse|where.*leak/.test(s))return{intent:'nrw.leak_fusion',parameters:{}};
  if(/prv|pressure reducing|reduce pressure/.test(s))return{intent:'pressure.prv_screen',parameters:{}};
  if(/air valve|air release|vacuum|high point/.test(s))return{intent:'air.air_valve_screen',parameters:{}};
  return null
}

function V23execute(request){
  var intent=typeof request==='string'?request:request&&request.intent,parameters=request&&request.parameters||{};
  if(intent==='network.topology'){var t=V23.topology(true);return'I rebuilt the network graph: <b>'+t.nodes.length+' nodes</b>, <b>'+t.edges.length+' pipe edges</b> and <b>'+t.components+' component(s)</b>.'}
  if(intent==='nrw.water_balance'){var w=V23.water(true);return w.complete?'Imported-data NRW is <b>'+w.nrw.toFixed(1)+' m³/day ('+w.pct.toFixed(1)+'%)</b>.':'I need both system-input flow and authorized-consumption meter evidence before calculating NRW.'}
  if(intent==='acoustic.sensor_plan'){var c=V23.sensorPlan(Number(parameters.count)||20,true);return'I planned <b>'+c.length+' hydrophone locations</b> using actual network/access assets, risk, acoustics and spacing.'}
  if(intent==='nrw.leak_fusion'){var f=V23.fusion(true);return f.length?'Highest fused priority is <b>'+escapeHtml(f[0].id)+'</b> at '+Math.round(f[0].score)+'/100.':'No pipe network is available.'}
  if(intent==='pressure.prv_screen'){var p=V23.prv(true);return'I screened <b>'+p.length+' valve locations</b> for preliminary PRV candidacy.'}
  if(intent==='air.air_valve_screen'){var a=V23.air(true);return'I screened <b>'+a.length+' air-valve candidates</b>. '+(a.some(function(x){return x.z!=null})?'GIS elevation was available.':'A longitudinal elevation profile is still required.')}
  return null
}

function V23route(q){var request=V23intent(q);return request?V23execute(request):null}
window.AquaIntentRouter={parse:V23intent,execute:V23execute};

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

const AQUA_DB_VERSION=2;
const aquaProjectCache=new Map();
const aquaSaveQueues=new Map();
let aquaSession={authenticated:false,email:null,role:'Viewer',permissions:{read:true,edit:false,import:false,administer:false}};
function aquaSetSyncStatus(stateName,text){
  const status=$('projectSyncStatus');if(!status)return;
  status.dataset.state=stateName;status.textContent=text;
}
function aquaCanEdit(){return Boolean(aquaSession.permissions?.edit)}
function aquaCanImport(){return Boolean(aquaSession.permissions?.import)}
function aquaApplyPermissions(){
  document.body.dataset.projectRole=aquaSession.role.toLowerCase();
  document.querySelectorAll('[data-requires-role]').forEach(function(control){
    var required=control.dataset.requiresRole,allowed=required==='admin'?aquaCanImport():aquaCanEdit();
    control.disabled=!allowed;
    control.setAttribute('aria-disabled',String(!allowed));
    if(!allowed)control.title=required==='admin'?'Admin access is required':'Editor access is required';
  });
  var status=$('projectSyncStatus');if(status)status.title=aquaSession.authenticated?(aquaSession.role+(aquaSession.email?' · '+aquaSession.email:'')):'Viewer · not authenticated';
  if(aquaCanEdit())aquaHidePersistenceError();
  window.AquaDmaStyles?.render?.();
}
async function aquaRefreshSession(){
  try{aquaSession=await window.AquaCloudProjects.session()}
  catch(error){aquaSession={authenticated:false,email:null,role:'Viewer',permissions:{read:true,edit:false,import:false,administer:false}}}
  aquaApplyPermissions();return aquaSession;
}
window.AquaAuthorization={get session(){return aquaSession},canEdit:aquaCanEdit,canImport:aquaCanImport,refresh:aquaRefreshSession};
async function V23db(){
  return new Promise(function(resolve,reject){
    var req=indexedDB.open('AquaIntelligenceDB',AQUA_DB_VERSION);
    req.onupgradeneeded=function(){
      var d=req.result;
      if(!d.objectStoreNames.contains('projects'))d.createObjectStore('projects',{keyPath:'id'});
      if(!d.objectStoreNames.contains('metadata'))d.createObjectStore('metadata',{keyPath:'key'});
    };
    req.onsuccess=function(){resolve(req.result)};req.onerror=function(){reject(req.error)}
  })
}
function aquaProjectCounts(project){
  var counts={};['pipe','meter','valve','hydrant','dma'].forEach(function(kind){counts[kind]=featureCount(project,kind)});return counts;
}
function aquaSerializableProject(project){
  var updated=new Date().toISOString();
  var record={
    schemaVersion:AQUA_DB_VERSION,id:project.id,name:project.name,utility:project.utility||'',
    customerMetadata:project.customerMetadata||{},source:project.source||'',sourceType:project.sourceType||'unknown',
    sourceCrs:project.sourceCrs||'EPSG:4326',normalizedCrs:project.normalizedCrs||'EPSG:4326',reprojected:Boolean(project.reprojected),
    status:project.status||'active',projectVersion:Number(project.projectVersion||project.cloudRevision||0),cloudRevision:Number(project.cloudRevision||project.projectVersion||0),
    syncState:project.syncState||'synced',syncError:project.syncError||'',
    r2Objects:project.r2Objects||{},localOnly:Boolean(project.localOnly),rawLayers:project.rawLayers||null,layers:project.layers||[],
    layerClassification:(project.layers||[]).map(function(layer){return{name:layer.name,kind:layer.kind,count:layer.geojson?.features?.length||0}}),
    projectModelCounts:aquaProjectCounts(project),telemetry:project.telemetry||[],
    telemetryProvenance:Array.from(new Set((project.telemetry||[]).map(function(item){return item.source}).filter(Boolean))),
    acousticSensor:project.acousticSensor||[],acousticCouple:project.acousticCouple||[],acousticAlert:project.acousticAlert||[],
    acousticSummary:project.acousticSummary||null,acousticProvenance:project.acousticProvenance||null,
    lambayDemo:project.lambayDemo||null,logicalDmas:project.logicalDmas||project.lambayDemo?.logicalDmas||[],
    dmaFeatureMappings:project.dmaFeatureMappings||[],dmaStyles:project.dmaStyles||{},dmaStateVersion:project.dmaStateVersion||0,
    dmaDisplay:project.dmaDisplay||{visible:true},projectConfig:project.projectConfig||{},
    analyses:project.analyses||{},topology:project.topology||null,provenance:project.provenance||{},
    created:project.created||updated,updated,lastOpenedAt:project.lastOpenedAt||updated
  };
  return JSON.parse(JSON.stringify(record));
}
function aquaHydrateProject(record){
  var project={...record};
  project.layers=Array.isArray(project.layers)?project.layers:[];
  project.telemetry=Array.isArray(project.telemetry)?project.telemetry:[];
  project.acousticSensor=Array.isArray(project.acousticSensor)?project.acousticSensor:[];
  project.acousticCouple=Array.isArray(project.acousticCouple)?project.acousticCouple:[];
  project.acousticAlert=Array.isArray(project.acousticAlert)?project.acousticAlert:[];
  project.dmaStyles=project.dmaStyles||{};project.dmaFeatureMappings=project.dmaFeatureMappings||[];
  project.dmaDisplay=project.dmaDisplay||{visible:true};project.projectConfig=project.projectConfig||{};
  project.normalizedCrs=project.normalizedCrs||'EPSG:4326';project.status=project.status||'active';
  project.cloudRevision=Number(project.cloudRevision||project.projectVersion||0);project.projectVersion=project.cloudRevision;
  project.syncState=project.syncState||'synced';project.syncError=project.syncError||'';
  return project;
}
function aquaActivateProject(project){
  var index=state.projects.findIndex(function(item){return item.id===project.id});
  if(index>=0)state.projects[index]=project;else state.projects.push(project);
  state.active=project;project.lastOpenedAt=new Date().toISOString();
  if(!Array.from($('projectSelect').options).some(function(option){return option.value===project.id})){
    var option=document.createElement('option');option.value=project.id;option.textContent=project.name;$('projectSelect').appendChild(option);
  }
  $('projectSelect').value=project.id;
}
function aquaHidePersistenceError(){var notice=$('persistenceNotice');if(notice)notice.remove()}
function aquaShowPersistenceError(project,error){
  aquaHidePersistenceError();
  var conflict=error?.status===409;
  var readOnly=error?.status===401||error?.status===403;
  var notice=document.createElement('div');notice.id='persistenceNotice';notice.className='persistence-notice';
  notice.innerHTML='<div><b>'+escapeHtml(conflict?'Conflict':readOnly?'Read only':'Save failed')+'</b><span>'+escapeHtml(conflict?'A newer cloud revision exists. Reload it before making this change again.':readOnly?'Your current Aqua role cannot save project changes.':(error?.message||'Cloud write failed')+'. Pending changes remain cached locally.')+'</span></div>'+(readOnly?'':'<button type="button">'+(conflict?'Reload cloud version':'Retry save')+'</button>');
  if(readOnly){document.body.appendChild(notice);return}
  notice.querySelector('button').onclick=async function(){
    this.disabled=true;this.textContent=conflict?'Loading…':'Saving…';
    try{
      if(conflict){await aquaReloadCloudProject(project.id);aquaHidePersistenceError();addAi('Loaded the latest cloud revision of <b>'+escapeHtml(project.name)+'</b>. Reapply the local change if it is still required.');return}
      await aquaRetryPendingProject(project);aquaHidePersistenceError();addAi('Project <b>'+escapeHtml(project.name)+'</b> was synchronized successfully.');
    }catch(retryError){
      if(retryError?.status===401||retryError?.status===403){aquaSetSyncStatus('readonly','Read only');aquaHidePersistenceError();return}
      this.disabled=false;this.textContent=conflict?'Reload cloud version':'Retry save';notice.querySelector('span').textContent=(retryError?.message||'Cloud request failed')+'. Pending changes remain cached locally.'
    }
  };
  document.body.appendChild(notice);
}
async function aquaReadCache(){
  var d=await V23db();
  return new Promise(function(resolve,reject){
    var tx=d.transaction(['projects','metadata'],'readonly'),projectReq=tx.objectStore('projects').getAll(),activeReq=tx.objectStore('metadata').get('activeProjectId'),projects=[],activeId=null;
    projectReq.onsuccess=function(){projects=projectReq.result||[]};activeReq.onsuccess=function(){activeId=activeReq.result?.value||null};
    tx.oncomplete=function(){resolve({projects:projects.map(aquaHydrateProject),activeId:activeId})};tx.onerror=function(){reject(tx.error)};
  });
}
async function aquaCacheActiveId(projectId){
  var d=await V23db();
  await new Promise(function(resolve,reject){
    var tx=d.transaction('metadata','readwrite');tx.objectStore('metadata').put({key:'activeProjectId',value:projectId,updated:new Date().toISOString()});
    tx.oncomplete=resolve;tx.onerror=function(){reject(tx.error||new Error('IndexedDB transaction failed'))};tx.onabort=function(){reject(tx.error||new Error('IndexedDB transaction was aborted'))};
  });
}
async function aquaCacheProject(project,setActive){
  var record=aquaSerializableProject(project),d=await V23db();
  await new Promise(function(resolve,reject){
    var tx=d.transaction(['projects','metadata'],'readwrite');tx.objectStore('projects').put(record);
    if(setActive!==false)tx.objectStore('metadata').put({key:'activeProjectId',value:record.id,updated:record.updated});
    tx.oncomplete=resolve;tx.onerror=function(){reject(tx.error||new Error('IndexedDB cache transaction failed'))};tx.onabort=function(){reject(tx.error||new Error('IndexedDB cache transaction was aborted'))};
  });
  aquaProjectCache.set(record.id,aquaHydrateProject(record));
  return record;
}
async function aquaCachePendingProject(project,error){
  project.syncState='pending';project.syncError=error?.message||'Cloud write failed';
  if(project.cloudRevision){
    try{await aquaCacheProject(project,true)}catch(cacheError){console.warn('Could not cache pending project changes',cacheError)}
  }
}
async function aquaRetryPendingProject(project){
  var session=await aquaRefreshSession();
  if(!session.permissions?.edit){var denied=new Error('Your current Aqua role is read only');denied.status=403;throw denied}
  if(!navigator.onLine)throw new window.AquaCloudProjects.AquaCloudError('Connection is offline',0);
  var cloud=await window.AquaCloudProjects.detail(project.id),cloudRevision=Number(cloud.version||0),baseRevision=Number(project.cloudRevision||0);
  if(cloudRevision!==baseRevision){var conflict=new Error('Project revision conflict');conflict.status=409;conflict.details={cloudVersion:cloudRevision};throw conflict}
  return V23persistProject(project,{setActive:true});
}
async function aquaPersistProjectNow(project,options){
  var config=options||{},sourceFile=config.sourceFile||project.__aquaPendingSourceFile;
  if(project.localOnly||config.cloud===false){
    var localRecord=await aquaCacheProject(project,config.setActive);aquaHidePersistenceError();return localRecord;
  }
  if(!window.AquaCloudProjects)throw new Error('Central project service is unavailable');
  if(!aquaCanEdit()){var denied=new Error('Your current Aqua role is read only');denied.status=403;throw denied}
  aquaSetSyncStatus('saving','Saving…');
  var record=aquaSerializableProject(project),metadata;record.syncState='synced';record.syncError='';
  if(project.cloudRevision){
    metadata=await window.AquaCloudProjects.update(record,project.cloudRevision);
  }else{
    if(!sourceFile)throw new Error('The original source file is required for the first central save');
    metadata=await window.AquaCloudProjects.create(record,sourceFile,config.telemetryFiles||[]);
  }
  var revision=Number(metadata.version||0);
  if(!revision)throw new Error('Central project service returned no revision');
  Object.assign(project,{cloudRevision:revision,projectVersion:revision,updated:metadata.updated||record.updated,r2Objects:metadata.r2Objects||project.r2Objects||{},syncState:'synced',syncError:''});
  delete project.__aquaPendingSourceFile;
  try{await aquaCacheProject(project,config.setActive)}catch(cacheError){console.warn('Project is centrally saved but local cache failed',cacheError)}
  aquaSetSyncStatus('saved','Saved · r'+revision);aquaHidePersistenceError();return aquaSerializableProject(project);
}
function V23persistProject(project,options){
  if(!project)return Promise.reject(new Error('No project is available to save'));
  var previous=aquaSaveQueues.get(project.id)||Promise.resolve();
  var pending=previous.catch(function(){}).then(function(){return aquaPersistProjectNow(project,options)});
  aquaSaveQueues.set(project.id,pending);
  return pending.finally(function(){if(aquaSaveQueues.get(project.id)===pending)aquaSaveQueues.delete(project.id)});
}
async function V23persist(){
  if(!state.active)return false;
  if(!aquaCanEdit()){aquaSetSyncStatus('readonly','Read only');return false}
  try{await V23persistProject(state.active,{setActive:true});return true}catch(e){console.warn('Aqua cloud persistence unavailable',e);if(e?.status===401||e?.status===403){aquaSetSyncStatus('readonly','Read only');aquaShowPersistenceError(state.active,e);return false}await aquaCachePendingProject(state.active,e);aquaSetSyncStatus(e?.status===409?'conflict':e?.status===0?'pending':'failed',e?.status===409?'Conflict':e?.status===0?'Pending sync':'Save failed');aquaShowPersistenceError(state.active,e);return false}
}
function aquaRenderProjectIndex(projects){
  var select=$('projectSelect');select.innerHTML='<option value="">Select project…</option>';
  projects.forEach(function(project){var option=document.createElement('option');option.value=project.id;option.textContent=project.name;select.appendChild(option)});
}
async function aquaOpenProjectById(projectId){
  if(!projectId){state.active=null;return}
  var project=state.projects.find(function(item){return item.id===projectId}),openedOffline=false;
  if(!project)return;
  if(project.__cloudStub){
    aquaSetSyncStatus('saving','Loading cloud…');
    try{
      var loaded=await window.AquaCloudProjects.data(project.id);
      project=aquaHydrateProject(loaded.project);project.cloudRevision=loaded.version;project.projectVersion=loaded.version;
      await aquaCacheProject(project,true).catch(function(error){console.warn('Could not cache cloud project',error)});
    }catch(error){
      if(!project.__cachedFallback)throw error;
      project=project.__cachedFallback;openedOffline=true;aquaSetSyncStatus('offline','Offline / cached');
    }
  }else{
    await aquaCacheActiveId(project.id).catch(function(error){console.warn('Could not update active cache project',error)});
  }
  aquaActivateProject(project);renderProject();renderTelemetry();
  if(project.syncState==='pending'&&!openedOffline){
    if(aquaCanEdit()){aquaSetSyncStatus('pending','Pending sync');await window.AquaProjectPersistence.retry()}
    else aquaSetSyncStatus('readonly','Read only');
  }else if(project.cloudRevision&&!openedOffline)aquaSetSyncStatus(aquaCanEdit()?'saved':'readonly',aquaCanEdit()?'Saved · r'+project.cloudRevision:'Read only');
  return project;
}
async function aquaReloadCloudProject(projectId){
  aquaSetSyncStatus('saving','Loading cloud…');
  var loaded=await window.AquaCloudProjects.data(projectId),project=aquaHydrateProject(loaded.project);
  project.cloudRevision=loaded.version;project.projectVersion=loaded.version;project.syncState='synced';project.syncError='';
  await aquaCacheProject(project,true);aquaActivateProject(project);renderProject();renderTelemetry();
  aquaSetSyncStatus(aquaCanEdit()?'saved':'readonly',aquaCanEdit()?'Saved · r'+loaded.version:'Read only');return project;
}
async function aquaStartupProjects(){
  var cache={projects:[],activeId:null};
  try{cache=await aquaReadCache()}catch(error){console.warn('Could not read Aqua project cache',error)}
  cache.projects.forEach(function(project){aquaProjectCache.set(project.id,project)});
  try{
    await aquaRefreshSession();
    var cloudProjects=await window.AquaCloudProjects.list(),cloudIds=new Set(cloudProjects.map(function(project){return project.id}));
    var projects=cloudProjects.map(function(metadata){
      var cached=aquaProjectCache.get(metadata.id),revision=Number(metadata.version||0);
      if(cached&&Number(cached.cloudRevision||cached.projectVersion||0)===revision)return Object.assign(cached,metadata,{cloudRevision:revision,projectVersion:revision});
      return Object.assign({},metadata,{cloudRevision:revision,projectVersion:revision,layers:[],telemetry:[],__cloudStub:true,__cachedFallback:cached||null});
    });
    projects.push(...cache.projects.filter(function(project){return project.localOnly&&!cloudIds.has(project.id)}));
    state.projects=projects;aquaRenderProjectIndex(projects);aquaSetSyncStatus(aquaCanEdit()?'saved':'readonly',aquaCanEdit()?'Saved':'Read only');
    if(cache.activeId&&projects.some(function(project){return project.id===cache.activeId}))await aquaOpenProjectById(cache.activeId);
  }catch(error){
    console.warn('Central project index unavailable; using IndexedDB cache',error);
    state.projects=cache.projects;aquaRenderProjectIndex(state.projects);aquaSetSyncStatus('offline','Offline / cached');
    var fallback=state.projects.find(function(project){return project.id===cache.activeId})||state.projects.slice().sort(function(a,b){return String(b.lastOpenedAt||b.updated||'').localeCompare(String(a.lastOpenedAt||a.updated||''))})[0];
    if(fallback){aquaActivateProject(fallback);renderProject();renderTelemetry();$('projectSelect').value=fallback.id;addAi('Opened <b>'+escapeHtml(fallback.name)+'</b> from the local cache. Cloud changes are not synchronized while offline.')}
  }
  $('projectSelect').onchange=async function(event){
    try{await aquaOpenProjectById(event.target.value)}catch(error){console.error(error);aquaSetSyncStatus('error','Load failed');alert('Could not open project: '+error.message)}
  };
}
window.AquaProjectPersistence={
  version:AQUA_DB_VERSION,persist:V23persistProject,retry:async function(){if(!state.active)return false;try{await aquaRetryPendingProject(state.active);return true}catch(error){if(error?.status!==401&&error?.status!==403)await aquaCachePendingProject(state.active,error);aquaSetSyncStatus(error?.status===409?'conflict':error?.status===401||error?.status===403?'readonly':error?.status===0?'pending':'failed',error?.status===409?'Conflict':error?.status===401||error?.status===403?'Read only':error?.status===0?'Pending sync':'Save failed');aquaShowPersistenceError(state.active,error);return false}},serialize:aquaSerializableProject,exportActive:function(){if(!state.active)throw new Error('No active project');return aquaSerializableProject(state.active)},startup:aquaStartupProjects,open:aquaOpenProjectById,cache:aquaCacheProject,
  save:async function(project,options){if(!aquaCanEdit()){aquaSetSyncStatus('readonly','Read only');return false}try{await V23persistProject(project,options);return true}catch(error){if(error?.status!==401&&error?.status!==403)await aquaCachePendingProject(project,error);aquaSetSyncStatus(error?.status===409?'conflict':error?.status===401||error?.status===403?'readonly':error?.status===0?'pending':'failed',error?.status===409?'Conflict':error?.status===401||error?.status===403?'Read only':error?.status===0?'Pending sync':'Save failed');aquaShowPersistenceError(project,error);return false}}
};

window.addEventListener('load',function(){
  if($('runDmaPlanner'))$('runDmaPlanner').onclick=function(){var r=V23.dma(true);addAi(r.length?'Validated '+r.length+' DMA/region feature(s) against pipes, valves and meters.':'No DMA polygon layer is available for validation.')};
  setTimeout(aquaStartupProjects,150);
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
    localOnly:true,
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
      localOnly:true,
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

/* === GIS layer controls, selection and initial risk === */
state.layerVisibility=state.layerVisibility||{pipe:true,meter:false,valve:false,hydrant:false,dma:true,telemetry:true,analysis:true};
state.kindLayers=state.kindLayers||{};
state.focusDma=null;
state.selectionMode='any';

function aquaPointFromFeature(f){
  const g=f&&f.geometry;if(!g)return null;
  if(g.type==='Point')return[g.coordinates[1],g.coordinates[0]];
  if(g.type==='LineString'&&g.coordinates.length){const m=g.coordinates[Math.floor(g.coordinates.length/2)];return[m[1],m[0]]}
  if(g.type==='MultiLineString'&&g.coordinates[0]?.length){const arr=g.coordinates.flat();const m=arr[Math.floor(arr.length/2)];return[m[1],m[0]]}
  if(g.type==='Polygon'&&g.coordinates[0]?.length){const r=g.coordinates[0],m=r[Math.floor(r.length/2)];return[m[1],m[0]]}
  return null;
}
function aquaPointInPolygon(point,feature){
  const g=feature&&feature.geometry;if(!g||!['Polygon','MultiPolygon'].includes(g.type))return false;
  const polys=g.type==='Polygon'?[g.coordinates]:g.coordinates,x=point[1],y=point[0];
  function ringInside(ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];const hit=((yi>y)!=(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi+1e-12)+xi);if(hit)inside=!inside}return inside}
  return polys.some(poly=>poly[0]&&ringInside(poly[0]));
}
function aquaFeatureInFocus(f,kind){
  if(!state.focusDma)return true;
  if(kind==='dma')return f===state.focusDma;
  const p=aquaPointFromFeature(f);return p?aquaPointInPolygon(p,state.focusDma):false;
}
function aquaSelectionAllows(kind){
  const m=state.selectionMode||'any';
  if(kind==='dma')return true;
  if(m==='any')return true;
  if(m==='point')return['meter','valve','hydrant'].includes(kind);
  if(m==='pipe')return kind==='pipe';
  if(m==='dma')return kind==='dma';
  return true;
}
function aquaApplyLayerVisibility(){
  ['pipe','meter','valve','hydrant','dma'].forEach(kind=>{
    const grp=state.kindLayers[kind];if(!grp||!state.map)return;
    const visible=state.layerVisibility[kind]!==false;
    if(visible&&!state.map.hasLayer(grp))grp.addTo(state.map);
    if(!visible&&state.map.hasLayer(grp))state.map.removeLayer(grp);
  });
  if(state.telemetryLayer&&state.map){
    if(state.layerVisibility.telemetry&&!state.map.hasLayer(state.telemetryLayer))state.telemetryLayer.addTo(state.map);
    if(!state.layerVisibility.telemetry&&state.map.hasLayer(state.telemetryLayer))state.map.removeLayer(state.telemetryLayer);
  }
  if(state.analysisLayer&&state.map){
    if(state.layerVisibility.analysis&&!state.map.hasLayer(state.analysisLayer))state.analysisLayer.addTo(state.map);
    if(!state.layerVisibility.analysis&&state.map.hasLayer(state.analysisLayer))state.map.removeLayer(state.analysisLayer);
  }
  aquaSyncLayerControls();
}
function aquaSyncLayerControls(){
  ['pipe','meter','valve','hydrant','dma'].forEach(kind=>{
    const visible=state.layerVisibility[kind]!==false;
    const checkbox=document.querySelector('[data-layer-toggle="'+kind+'"]');
    if(checkbox)checkbox.checked=visible;
    const row=document.querySelector('.tree-item[data-filter="'+kind+'"]');
    if(!row)return;
    row.classList.toggle('is-active',visible);
    row.classList.toggle('is-inactive',!visible);
    row.setAttribute('aria-pressed',String(visible));
  });
}
function aquaProjectLayerBounds(kind){
  const group=state.kindLayers[kind];
  if(!group)return null;
  const bounds=L.latLngBounds([]);
  group.eachLayer(layer=>{
    try{
      if(layer.getBounds){const layerBounds=layer.getBounds();if(layerBounds.isValid())bounds.extend(layerBounds)}
      else if(layer.getLatLng)bounds.extend(layer.getLatLng());
    }catch(e){}
  });
  return bounds.isValid()?bounds:null;
}
function aquaBringLayerToFront(kind){
  const group=state.kindLayers[kind];
  if(!group)return;
  group.eachLayer(layer=>{
    try{if(layer.bringToFront)layer.bringToFront();else if(layer.eachLayer)layer.eachLayer(child=>child.bringToFront?.())}catch(e){}
  });
}
function aquaSetProjectLayer(kind,visible,options={}){
  if(!['pipe','meter','valve','hydrant','dma'].includes(kind))return false;
  state.layerVisibility[kind]=Boolean(visible);
  if(kind==='dma'&&visible&&options.showAllDmas&&state.focusDma){
    state.focusDma=null;
    renderProject();
    renderTelemetry();
  }else{
    aquaApplyLayerVisibility();
  }
  if(visible){
    aquaBringLayerToFront(kind);
    if(options.fit!==false){
      const bounds=aquaProjectLayerBounds(kind);
      if(bounds)state.map.fitBounds(bounds.pad(kind==='dma'?.08:.12),{maxZoom:kind==='pipe'?18:17});
    }
  }
  aquaSyncLayerControls();
  return true;
}
function aquaToggleProjectLayer(kind){
  return aquaSetProjectLayer(kind,state.layerVisibility[kind]===false,{showAllDmas:kind==='dma'});
}
function aquaBaseStyle(kind){
  return{color:colors[kind]||colors.other,weight:kind==='pipe'?2.3:kind==='dma'?2.5:1.5,fillColor:colors[kind]||colors.other,fillOpacity:kind==='dma'?.12:.2,opacity:kind==='pipe'?.72:.9};
}
function aquaFeatureStyle(kind,feature){
  if(kind==='dma'&&window.AquaDmaStyles?.forFeature){
    const style=window.AquaDmaStyles.forFeature(feature);
    if(style)return style;
  }
  return aquaBaseStyle(kind);
}
function aquaSelectionLabel(key){
  return String(key).replace(/_/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
}
function aquaSelectionValue(properties,names){
  const keys=Object.keys(properties);
  for(const name of names){
    const key=keys.find(item=>item.toLowerCase()===name.toLowerCase());
    if(key&&properties[key]!==''&&properties[key]!=null)return{key,value:properties[key]};
  }
  return null;
}
function aquaEmptySelectionMarkup(){
  return '<div class="selection-kicker"><small>SELECTION</small><span>MAP</span></div><b class="selection-title">No asset selected</b><p class="selection-empty">Choose a visible network asset to inspect its engineering context.</p>';
}
function aquaSelectionMarkup(layer,feature){
  const properties=feature.properties||{};
  const risk=properties.__aquaRisk;
  const identity=aquaSelectionValue(properties,['ID','PIPE_ID','VALVE_ID','METER_ID','ASSET_ID','OBJECTID','NAME','DMA','ZONE']);
  const priorities={
    pipe:['MATERIAL','PIPE_MTR','DIAMETER','DIA','PIPE_SIZE','LENGTH','PIPE_LENGTH','BURSTS','AGE','INSTALL_YEAR'],
    dma:['NAME','DMA','ZONE','REGION','POPULATION','PROPERTIES','AREA'],
    valve:['TYPE','STATUS','DIAMETER','DIA','SIZE','ELEVATION'],
    meter:['TYPE','STATUS','FLOW','VOLUME','DIAMETER','SIZE'],
    hydrant:['STATUS','TYPE','ELEVATION','PRESSURE']
  };
  const fields=[],used=new Set(identity?[identity.key]:[]);
  for(const name of priorities[layer.kind]||[]){
    const match=aquaSelectionValue(properties,[name]);
    if(match&&!used.has(match.key)){fields.push(match);used.add(match.key)}
    if(fields.length===6)break;
  }
  if(fields.length<6){
    Object.entries(properties).filter(([key,value])=>!key.startsWith('__')&&!used.has(key)&&value!==''&&value!=null).forEach(([key,value])=>{
      if(fields.length<6){fields.push({key,value});used.add(key)}
    });
  }
  const title=identity?identity.value:layer.name;
  const metrics=fields.length?'<dl class="selection-grid">'+fields.map(({key,value})=>'<div><dt>'+escapeHtml(aquaSelectionLabel(key))+'</dt><dd>'+escapeHtml(value)+'</dd></div>').join('')+'</dl>':'<p class="selection-empty">No mapped attributes are available for this asset.</p>';
  const riskClass=risk?(risk.score>=75?'high':risk.score>=50?'medium':'low'):'';
  const riskMarkup=risk?'<div class="selection-risk '+riskClass+'"><span><small>PRIORITY SCORE</small><b>'+Math.round(risk.score)+'/100</b></span><p>'+escapeHtml(risk.reasons.slice(0,3).join(' · ')||'No dominant risk driver recorded.')+'</p></div>':'';
  return '<div class="selection-kicker"><small>SELECTED ASSET</small><span>'+escapeHtml(layer.kind.toUpperCase())+'</span></div><b class="selection-title">'+escapeHtml(title)+'</b><p class="selection-source">'+escapeHtml(layer.name)+' layer</p>'+metrics+riskMarkup;
}
function aquaEnhancedSelect(layer,f,l){
  if(!aquaSelectionAllows(layer.kind))return;
  if(state.selected&&state.selected.leaflet&&state.selected.leaflet.setStyle){
    try{state.selected.leaflet.setStyle(aquaFeatureStyle(state.selected.layer.kind,state.selected.feature))}catch(e){}
  }
  state.selected={layer,feature:f,leaflet:l};
  if(l&&l.setStyle)try{l.setStyle({color:'#ffffff',weight:5,fillOpacity:.35,opacity:1})}catch(e){}
  $('selectionCard').innerHTML=aquaSelectionMarkup(layer,f);
}
selectFeature=aquaEnhancedSelect;

renderProject=function(){
  const p=state.active;if(!p)return;
  try{state.networkLayer.clearLayers()}catch(e){}
  Object.values(state.kindLayers||{}).forEach(grp=>{try{if(state.map.hasLayer(grp))state.map.removeLayer(grp)}catch(e){}});
  state.kindLayers={pipe:L.layerGroup(),meter:L.layerGroup(),valve:L.layerGroup(),hydrant:L.layerGroup(),dma:L.layerGroup()};
  let bounds=[];
  p.layers.forEach(layer=>{
    const kind=layer.kind;if(!state.kindLayers[kind])return;
    (layer.geojson?.features||[]).forEach(f=>{
      if(!aquaFeatureInFocus(f,kind))return;
      const gj=L.geoJSON(f,{
        style:()=>aquaFeatureStyle(kind,f),
        pointToLayer:(feature,ll)=>L.circleMarker(ll,{radius:kind==='meter'?4.5:kind==='valve'?4.5:4,color:colors[kind]||colors.other,fillColor:colors[kind]||colors.other,fillOpacity:.85,weight:1}),
        onEachFeature:(feature,ll)=>ll.on('click',()=>aquaEnhancedSelect(layer,feature,ll))
      });
      gj.eachLayer(ll=>{ll.__aquaFeature=f;ll.__aquaKind=kind;ll.__aquaLayer=layer});
      gj.addTo(state.kindLayers[kind]);
      try{const b=gj.getBounds();if(b.isValid())bounds.push(b)}catch(e){}
    });
  });
  Object.values(state.kindLayers).forEach(grp=>grp.addTo(state.map));
  aquaApplyLayerVisibility();
  if(bounds.length){let b=bounds[0];for(let i=1;i<bounds.length;i++)b=b.extend(bounds[i]);state.map.fitBounds(b.pad(.04))}
  updateProjectUI();
  if(p&&featureCount(p,'pipe')&&!p.analyses?.initialRisk)setTimeout(()=>aquaInitialRisk(false),80);
};

function aquaFocusSelectedDma(){
  if(!state.selected||state.selected.layer.kind!=='dma'){alert('Select a DMA polygon first.');return}
  state.focusDma=state.selected.feature;
  renderProject();renderTelemetry();
  addAi('Focused on the selected DMA. Assets outside the DMA are hidden.');
}
function aquaShowAllAssets(){
  state.focusDma=null;state.selected=null;
  renderProject();renderTelemetry();
  $('selectionCard').innerHTML=aquaEmptySelectionMarkup();
}
function aquaTelemetryInFocus(t){
  if(!state.focusDma)return true;
  const lat=Number(t.lat||t.latitude),lng=Number(t.lng||t.lon||t.longitude);
  return Number.isFinite(lat)&&Number.isFinite(lng)&&aquaPointInPolygon([lat,lng],state.focusDma);
}
const aquaOldRenderTelemetry=renderTelemetry;
renderTelemetry=function(){
  state.telemetryLayer.clearLayers();if(!state.active)return;
  state.active.telemetry.forEach(t=>{
    if(!aquaTelemetryInFocus(t))return;
    const lat=Number(t.lat||t.latitude),lng=Number(t.lng||t.lon||t.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lng))return;
    const col=t.type==='pressure'?colors.dma:t.type==='acoustic'?'#5edc9a':colors.meter;
    L.circleMarker([lat,lng],{radius:5,color:col,fillColor:col,fillOpacity:1}).bindTooltip((t._id||'Telemetry')+' · '+t.type).addTo(state.telemetryLayer);
  });
  aquaApplyLayerVisibility();
};

function aquaAttr(f,names){
  const p=f?.properties||{},keys=Object.keys(p);
  for(const n of names){const k=keys.find(x=>x.toLowerCase()===n.toLowerCase());if(k!==undefined&&p[k]!==''&&p[k]!=null)return p[k]}
  return null;
}
function aquaDateYear(v){
  if(v==null)return null;const s=String(v).trim();
  const m=s.match(/(19|20)\d{2}/);if(m)return Number(m[0]);
  const n=Number(v);return Number.isFinite(n)&&n>1900&&n<2100?n:null;
}
function aquaNearestTelemetry(coord,type,maxD=1200){
  let best=null;
  (state.active?.telemetry||[]).filter(x=>x.type===type).forEach(t=>{
    const lat=Number(t.lat||t.latitude),lng=Number(t.lng||t.lon||t.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lng))return;
    const d=V23&&V23.dist?V23.dist(coord,[lat,lng]):Infinity;
    if(d<=maxD&&(!best||d<best.d))best={row:t,d};
  });
  return best;
}
function aquaTelemetryNumber(row,names){
  if(!row)return null;
  for(const [k,v] of Object.entries(row)){if(names.some(n=>k.toLowerCase()===n||k.toLowerCase().includes(n))){const x=Number(v);if(Number.isFinite(x))return x}}
  return null;
}
function aquaRiskForPipe(f){
  const p=f.properties||{},coord=aquaPointFromFeature(f),reasons=[];let score=0,available=0,total=4;
  const material=String(aquaAttr(f,['pipe_mtr','material','mat','pipe_kind','pipe_type','type'])||'').toUpperCase();
  if(material){
    available++;
    let m=6;
    if(/CI|CAST|AC|ASBESTOS|GALV|GI/.test(material)){m=25;reasons.push('higher-risk '+material)}
    else if(/DIP|DI|STEEL|MS/.test(material)){m=14;reasons.push(material+' material')}
    else if(/PVC|HDPE|PE/.test(material)){m=7;reasons.push(material+' lower failure susceptibility')}
    else{m=10;reasons.push(material)}
    score+=m;
  }
  const year=aquaDateYear(aquaAttr(f,['install_year','bury_year','year','bury_date','install_date']));
  if(year){
    available++;const age=Math.max(0,new Date().getFullYear()-year);
    let a=age>=50?25:age>=30?19:age>=15?11:5;score+=a;
    reasons.push(age+' yr pipe');
  }
  let pressure=Number(aquaAttr(f,['pressure','press','avg_pressure']));if(!Number.isFinite(pressure))pressure=null;
  const pt=coord?aquaNearestTelemetry(coord,'pressure',1000):null;
  const tp=aquaTelemetryNumber(pt?.row,['pressure','avg_pressure','min_pressure','max_pressure']);
  if(tp!=null)pressure=tp;
  if(pressure!=null){
    available++;let ps=pressure>=60?25:pressure>=50?21:pressure>=40?15:pressure>=30?9:5;score+=ps;
    reasons.push('pressure '+pressure.toFixed(1));
  }
  let flow=Number(aquaAttr(f,['flowage','flow','avg_flow']));if(!Number.isFinite(flow))flow=null;
  const ft=coord?aquaNearestTelemetry(coord,'flow',1400):null;
  const mnf=aquaTelemetryNumber(ft?.row,['mnf','minimum_night_flow','night_flow']);
  const tf=aquaTelemetryNumber(ft?.row,['flow','avg_flow','average_flow']);
  let flowScore=null;
  if(mnf!=null&&tf!=null&&tf>0){
    const r=mnf/tf;flowScore=r>=.5?25:r>=.35?20:r>=.2?12:6;reasons.push('MNF '+Math.round(r*100)+'% of flow');
  }else if(mnf!=null){flowScore=mnf>=10?25:mnf>=5?18:mnf>=2?10:5;reasons.push('MNF '+mnf.toFixed(1))}
  else if(flow!=null){flowScore=flow>=20?20:flow>=10?14:8;reasons.push('flow '+flow.toFixed(1))}
  if(flowScore!=null){available++;score+=flowScore}
  const bursts=Number(aquaAttr(f,['bursts','breaks','failures','repair_count']));
  if(Number.isFinite(bursts)&&bursts>0){score=Math.min(100,score+Math.min(15,bursts*3));reasons.push(bursts+' prior failures')}
  const normalized=available?score/(available*25)*100:0;
  const confidence=Math.round(available/total*100);
  return{score:Math.max(0,Math.min(100,normalized)),confidence,material:material||'Unknown',year,pressure,flow,mnf,reasons,available};
}
function aquaRiskColor(score){return score>=70?'#ff4d5f':score>=50?'#ff9f43':score>=35?'#ffd166':'#45c98a'}

function aquaInitialRisk(showResults=true){
  if(!state.active||!window.V23)return[];
  const pipes=V23.pipes(),ranked=[];
  pipes.forEach((x,i)=>{
    const r=aquaRiskForPipe(x.feature);
    x.feature.properties=x.feature.properties||{};
    x.feature.properties.__aquaRisk=r;
    ranked.push({id:String(aquaAttr(x.feature,['id','pipe_id','unific_id','gid','objectid'])||('Pipe '+(i+1))),feature:x.feature,layer:x.layer,...r});
  });
  ranked.sort((a,b)=>b.score-a.score);
  state.active.analyses=state.active.analyses||{};
  state.active.analyses.initialRisk=ranked.slice(0,100).map(x=>({id:x.id,score:x.score,confidence:x.confidence,reasons:x.reasons}));
  if(window.V23persist)V23persist();
  if(state.analysisLayer){
    state.analysisLayer.clearLayers();
    ranked.slice(0,Math.min(300,ranked.length)).forEach(x=>{
      const g=x.feature.geometry;if(!g)return;
      const lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[];
      lines.forEach(line=>L.polyline(line.map(c=>[c[1],c[0]]),{color:aquaRiskColor(x.score),weight:x.score>=70?6:x.score>=50?5:4,opacity:.9}).bindTooltip(x.id+' · risk '+Math.round(x.score)+' · confidence '+x.confidence+'%').addTo(state.analysisLayer));
    });
    aquaApplyLayerVisibility();
  }
  if(showResults&&$('analysisOutput')){
    const avgConf=ranked.length?Math.round(ranked.slice(0,Math.min(50,ranked.length)).reduce((s,x)=>s+x.confidence,0)/Math.min(50,ranked.length)):0;
    $('analysisOutput').innerHTML='<div class="metric-cards"><div><span>Pipes assessed</span><b>'+ranked.length+'</b></div><div><span>High risk ≥70</span><b>'+ranked.filter(x=>x.score>=70).length+'</b></div><div><span>Evidence confidence</span><b>'+avgConf+'%</b></div></div>'+
      '<div class="rank-list">'+ranked.slice(0,12).map((x,i)=>'<div><b>#'+(i+1)+' '+escapeHtml(x.id)+'</b><span>Risk '+Math.round(x.score)+' · Conf '+x.confidence+'% · '+escapeHtml(x.reasons.slice(0,3).join(' · '))+'</span></div>').join('')+'</div>'+
      '<div class="result-note">Initial risk combines pressure, flow/MNF, pipe material and pipe age when available. Missing evidence lowers confidence rather than being assumed normal. Red indicates investigation priority, not confirmed leakage.</div>';
  }
  return ranked;
}

function aquaProjectQueryKind(value){
  const query=String(value||'').toLowerCase();
  if(/\b(dma|dmas|regions?)\b/.test(query))return'dma';
  if(/\bhydrants?\b/.test(query))return'hydrant';
  if(/\bvalves?\b/.test(query))return'valve';
  if(/\bmeters?\b/.test(query))return'meter';
  if(/\bpipes?\b/.test(query))return'pipe';
  return null;
}
function aquaRunProjectQuery(value){
  if(!state.active)return null;
  const query=String(value||'').trim().toLowerCase(),kind=aquaProjectQueryKind(query);
  if(!kind)return null;
  const labels={pipe:'pipes',meter:'meters',valve:'valves',hydrant:'hydrants',dma:'DMA/regions'};
  if(/\bhow many\b|\bcount\b|\bnumber of\b/.test(query)){
    return'<b>'+featureCount(state.active,kind).toLocaleString()+'</b> '+labels[kind]+' are loaded in '+escapeHtml(state.active.name)+'.';
  }
  const action=query.match(/\b(show|hide)\b/);
  if(!action)return null;
  const visible=action[1]==='show';
  aquaSetProjectLayer(kind,visible,{fit:visible,showAllDmas:kind==='dma'});
  return(visible?'Showing ':'Hiding ')+featureCount(state.active,kind).toLocaleString()+' '+labels[kind]+'.';
}

window.AquaProjectQueries={
  matches(value){return Boolean(aquaProjectQueryKind(value)&&(/\bhow many\b|\bcount\b|\bnumber of\b|\bshow\b|\bhide\b/.test(String(value||'').toLowerCase())))},
  run:aquaRunProjectQuery,
  handle(value){
    const answer=aquaRunProjectQuery(value);
    if(!answer)return false;
    addUser(value);addAi(answer);return true;
  }
};

window.addEventListener('load',function(){
  document.querySelectorAll('[data-layer-toggle]').forEach(cb=>{
    const kind=cb.dataset.layerToggle;
    cb.checked=state.layerVisibility[kind]!==false;
    cb.onchange=function(){
      if(['pipe','meter','valve','hydrant','dma'].includes(kind))aquaSetProjectLayer(kind,cb.checked,{fit:false,showAllDmas:kind==='dma'});
      else{state.layerVisibility[kind]=cb.checked;aquaApplyLayerVisibility()}
    };
  });
  document.querySelectorAll('.tree-item[data-filter]').forEach(row=>{
    const kind=row.dataset.filter;
    if(!['pipe','meter','valve','hydrant','dma'].includes(kind))return;
    row.setAttribute('role','button');row.setAttribute('tabindex','0');
    row.onclick=function(){aquaToggleProjectLayer(kind)};
    row.onkeydown=function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();row.click()}};
  });
  aquaSyncLayerControls();
  if($('selectionMode'))$('selectionMode').onchange=function(){state.selectionMode=this.value};
  if($('focusSelection'))$('focusSelection').onclick=aquaFocusSelectedDma;
  if($('showAllAssets'))$('showAllAssets').onclick=aquaShowAllAssets;
  if($('toggleGisControl'))$('toggleGisControl').onclick=function(){const body=$('gisControlBody'),hidden=body.classList.toggle('hidden');this.textContent=hidden?'+':'−'};
  if($('runInitialRisk'))$('runInitialRisk').onclick=function(){const r=aquaInitialRisk(true);addAi(r.length?'Initial network risk complete. Highest pipe score: <b>'+Math.round(r[0].score)+'/100</b> at '+r[0].confidence+'% evidence confidence.':'No pipe data available.')};
});

/* === Same-origin AI service contract === */
const AQUA_AI_ENDPOINT='/api/ai';
const AQUA_AI_ENABLED=false;

function aquaSetAiStatus(message){if($('llmStatus'))$('llmStatus').textContent=message}

function aquaOpenLlmModal(){
  $('llmBaseUrl').value=AQUA_AI_ENDPOINT;
  aquaSetAiStatus('Deterministic commands are available without the AI service.');
  $('llmModal').classList.remove('hidden');
}
function aquaCloseLlmModal(){$('llmModal').classList.add('hidden')}
async function aquaTestLlm(){
  if(!AQUA_AI_ENABLED){
    aquaSetAiStatus('AI service not deployed · deterministic commands remain active.');
    return;
  }
  aquaSetAiStatus('Checking service…');
  try{
    const res=await fetch(AQUA_AI_ENDPOINT,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contractVersion:1,type:'status'})
    });
    if(!res.ok)throw new Error('Service unavailable');
    aquaSetAiStatus('AI service connected.');
  }catch(e){
    aquaSetAiStatus('AI service unavailable · deterministic commands remain active.');
  }
}
async function aquaAskAi(q,suggestedIntent){
  const res=await fetch(AQUA_AI_ENDPOINT,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      contractVersion:1,
      question:q,
      context:contextSnapshot(),
      suggestedIntent:suggestedIntent
    })
  });
  if(!res.ok)throw new Error('AI service unavailable');
  return res.json();
}

function aquaApiIntent(data){
  if(typeof data?.intent==='string')return{intent:data.intent,parameters:data.parameters||{}};
  if(data?.intent&&typeof data.intent.intent==='string')return data.intent;
  return null;
}

/* Use the same-origin AI service, then fall back to deterministic tools. */
askCopilot=async function(q){
  addUser(q);
  if(!state.active){addAi('Open a project first.');return}
  const projectAnswer=aquaRunProjectQuery(q);
  if(projectAnswer){addAi(projectAnswer);return}
  const suggestedIntent=V23intent(q);
  if(suggestedIntent){
    const local=V23execute(suggestedIntent);
    aquaSetAiStatus('AI service not deployed · deterministic commands remain active.');
    addAi(local+'<br><span class="thinking">Deterministic engineering command executed locally.</span>');
    return;
  }
  if(!AQUA_AI_ENABLED){
    aquaSetAiStatus('AI service not deployed · deterministic commands remain active.');
    addAi('AI service is not deployed yet. Deterministic engineering commands remain available.');
    return;
  }
  const placeholder=document.createElement('div');
  placeholder.className='msg ai';
  placeholder.innerHTML='<b>Aqua</b><p>Thinking…</p>';
  $('chat').appendChild(placeholder);
  $('chat').scrollTop=$('chat').scrollHeight;
  try{
    const data=await aquaAskAi(q,suggestedIntent);
    const apiIntent=aquaApiIntent(data);
    const intentResult=apiIntent?V23execute(apiIntent):null;
    if(intentResult){placeholder.innerHTML='<b>Aqua</b><p>'+intentResult+'</p>';return}
    if(data.answer){placeholder.innerHTML='<b>Aqua</b><p>'+escapeHtml(data.answer).replace(/\n/g,'<br>')+'</p>';return}
    throw new Error('AI response did not contain an answer or supported intent');
  }catch(e){
    const local=suggestedIntent?V23execute(suggestedIntent):null;
    aquaSetAiStatus('AI service unavailable · deterministic commands remain active.');
    placeholder.innerHTML=local
      ?'<b>Aqua</b><p>'+local+'</p><p class="thinking">AI service unavailable · deterministic result shown.</p>'
      :'<b>Aqua</b><p>AI service unavailable. Deterministic engineering commands remain available.</p>';
  }
};

window.addEventListener('load',function(){
  try{localStorage.removeItem('aqua.llm')}catch(e){}
  if($('llmSettingsBtn'))$('llmSettingsBtn').onclick=aquaOpenLlmModal;
  if($('closeLlmModal'))$('closeLlmModal').onclick=aquaCloseLlmModal;
  if($('testLlmBtn'))$('testLlmBtn').onclick=aquaTestLlm;
});

/* Floating panel collapse controls */
function aquaAddFloatControls(){
  const panels=[
    document.querySelector('.left-panel'),
    document.querySelector('.right-panel'),
    ...document.querySelectorAll('.analysis-grid .panel'),
    ...document.querySelectorAll('.advanced-grid .panel')
  ].filter(Boolean);
  panels.forEach(panel=>{
    if(panel.dataset.floatReady)return;
    panel.dataset.floatReady='1';
    const head=panel.querySelector('.panel-head,.copilot-head');
    if(!head)return;
    const b=document.createElement('button');
    b.className='float-collapse';
    b.type='button';
    b.title='Collapse panel';
    b.textContent='−';
    b.onclick=function(e){
      e.stopPropagation();
      const collapsed=panel.classList.toggle('float-collapsed');
      b.textContent=collapsed?'+':'−';
      b.title=collapsed?'Expand panel':'Collapse panel';
      setTimeout(()=>{if(state.map)state.map.invalidateSize()},50);
    };
    head.appendChild(b);
  });
}
window.addEventListener('load',function(){
  setTimeout(aquaAddFloatControls,100);
  setTimeout(function(){if(state.map)state.map.invalidateSize()},250);
});
