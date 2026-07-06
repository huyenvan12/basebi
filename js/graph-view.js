// ══════════════════════════════════════════════════
// GRAPH VIEW — force-directed layout, pan/zoom, node detail panel.
// Graph physics state (positions/velocities/viewbox) is module-local — nothing outside
// this file reads it, unlike the shared edge data it borrows from notes.js.
// ══════════════════════════════════════════════════
import {
  GRAPH_REPULSION, GRAPH_MIN_DIST, GRAPH_SPRING_LENGTH, GRAPH_SPRING_STRENGTH,
  GRAPH_FOLDER_LENGTH, GRAPH_FOLDER_STRENGTH, GRAPH_CENTER_STRENGTH, GRAPH_DAMPING,
  GRAPH_MAX_VEL, GRAPH_REST_KE, GRAPH_MAX_SIM_FRAMES, GRAPH_MIN_ZOOM_SCALE,
  LS_GRAPH_LABEL_SCALE, GRAPH_LABEL_SCALE_MIN, GRAPH_LABEL_SCALE_MAX, GRAPH_LABEL_SCALE_STEP,
  GRAPH_FOLDER_PALETTE_SIZE, GRAPH_SHARED_GROUP_KEY
} from './constants.js';
import { state } from './state.js';
import { esc } from './ui-helpers.js';
import { buildLinkIndex, getLinkEdges, getTagEdges, getBacklinkIds, getBacklinks, selectNote } from './notes.js';
// Narrow, intentional circular import: main.js is the cross-domain nav router (switchTab)
// per the plan, and main.js imports this module's initGraphView()/renderGraph() for wiring.
// Safe because switchTab is only called inside graphOpenNote()'s function body, never at
// module top-level.
import { switchTab } from './main.js';

let graphNodePositions={}; // noteId -> {x,y} — persists across renders so the sim can warm-restart
let graphVelocities={};    // noteId -> {vx,vy}
let graphActiveNodeId=null;
let graphDefaultW=1400, graphDefaultH=880;
let graphViewBox={x:0,y:0,w:graphDefaultW,h:graphDefaultH};
let graphInteractionsBound=false;
let graphLabelK=1;       // viewBox-units-per-CSS-pixel; used to counter-scale labels to a constant screen size
let graphAnimFrameId=null;
let graphUserAdjustedView=false; // once the user manually zooms/pans, stop auto-fitting the view to the sim
let graphLabelScale=1;

function graphApplyViewBox(){
  document.getElementById('graphSvg').setAttribute('viewBox',
    `${graphViewBox.x} ${graphViewBox.y} ${graphViewBox.w} ${graphViewBox.h}`);
  graphRecalcLabelK();
  graphUpdateLabelTransforms();
}
// Fits the viewBox to the current bounding box of all nodes (with padding), so orphans/hubs
// pushed far out by the physics are never clipped off-screen — used for reset and, while the
// sim is still settling, re-applied every frame until the user manually zooms/pans (see
// graphUserAdjustedView) so the camera follows nodes spreading out from their initial seed.
function graphFitToBounds(){
  const pts=Object.values(graphNodePositions);
  if(!pts.length){ graphViewBox={x:0,y:0,w:graphDefaultW,h:graphDefaultH}; graphApplyViewBox(); return; }
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  pts.forEach(p=>{ minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y); });
  const pad=100;
  let w=Math.max(maxX-minX+pad*2, graphDefaultW*0.25);
  let h=Math.max(maxY-minY+pad*2, graphDefaultH*0.25);
  // clamp to a minimum zoom scale — never let sparse layouts fit-to-bounds into a viewBox so
  // large that labels/nodes render illegibly small on load
  w=Math.min(w, graphDefaultW/GRAPH_MIN_ZOOM_SCALE);
  h=Math.min(h, graphDefaultH/GRAPH_MIN_ZOOM_SCALE);
  const cx=(minX+maxX)/2, cy=(minY+maxY)/2;
  graphViewBox={x:cx-w/2, y:cy-h/2, w, h};
  graphApplyViewBox();
}
export function graphResetView(){
  graphUserAdjustedView=false;
  graphFitToBounds();
}
export function graphApplyLabelScale(scale,save=true){
  graphLabelScale=Math.max(GRAPH_LABEL_SCALE_MIN,Math.min(GRAPH_LABEL_SCALE_MAX,scale));
  document.body.style.setProperty('--graph-label-scale',graphLabelScale);
  const el=document.getElementById('graphLabelScaleValue');
  if(el)el.textContent=Math.round(graphLabelScale*100)+'%';
  if(save)localStorage.setItem(LS_GRAPH_LABEL_SCALE,graphLabelScale);
}
export function graphLoadLabelScale(){
  const saved=parseFloat(localStorage.getItem(LS_GRAPH_LABEL_SCALE));
  graphApplyLabelScale(isNaN(saved)?1:saved,false);
}
export function graphAdjustLabelScale(dir){
  graphApplyLabelScale(graphLabelScale+dir*GRAPH_LABEL_SCALE_STEP);
}
// zoom keeping a given SVG-space point fixed (used by wheel, anchored at cursor)
function graphZoomAt(factor,px,py){
  graphUserAdjustedView=true;
  const minW=160,maxW=2800;
  let newW=graphViewBox.w*factor; newW=Math.max(minW,Math.min(maxW,newW));
  const actualFactor=newW/graphViewBox.w;
  const newH=graphViewBox.h*actualFactor;
  graphViewBox.x=px-(px-graphViewBox.x)*actualFactor;
  graphViewBox.y=py-(py-graphViewBox.y)*actualFactor;
  graphViewBox.w=newW; graphViewBox.h=newH;
  graphApplyViewBox();
}
// zoom around the current view center (used by the +/- buttons)
export function graphZoomCenter(factor){
  const cx=graphViewBox.x+graphViewBox.w/2, cy=graphViewBox.y+graphViewBox.h/2;
  graphZoomAt(factor,cx,cy);
}
function graphClientToSvg(clientX,clientY){
  const svg=document.getElementById('graphSvg');
  const rect=svg.getBoundingClientRect();
  return{
    x:graphViewBox.x+(clientX-rect.left)/rect.width*graphViewBox.w,
    y:graphViewBox.y+(clientY-rect.top)/rect.height*graphViewBox.h
  };
}
// Counter-scale factor so labels render at a constant CSS pixel size regardless of
// viewBox zoom or the SVG element's actual rendered size on screen.
function graphRecalcLabelK(){
  const svg=document.getElementById('graphSvg');
  const rect=svg.getBoundingClientRect();
  graphLabelK = rect.width ? graphViewBox.w/rect.width : 1;
}
// Each label is a <g transform="translate(x,y) scale(graphLabelK)"> wrapping a fixed-size
// <text>. Since 1 local unit inside that g == 1 CSS px on screen (the scale cancels the
// viewBox->viewport ratio), a constant font-size/offset in the <text> stays visually constant.
function graphUpdateLabelTransforms(){
  document.querySelectorAll('#graphSvg .graph-label-g').forEach(g=>{
    const id=+g.dataset.id, p=graphNodePositions[id];
    if(!p)return;
    g.setAttribute('transform',`translate(${p.x},${p.y}) scale(${graphLabelK})`);
    const r=+g.dataset.r||0;
    const t=g.querySelector('text');
    if(t) t.setAttribute('x',(r/graphLabelK+6).toFixed(2));
  });
}
export function graphDeselect(){
  graphActiveNodeId=null;
  graphClearHighlight();
  document.getElementById('graphNodeDetail').classList.remove('show');
  document.getElementById('graphEmptyState').style.display='';
}
function graphBindInteractions(){
  if(graphInteractionsBound)return;
  graphInteractionsBound=true;
  const svg=document.getElementById('graphSvg');
  svg.addEventListener('wheel',e=>{
    e.preventDefault();
    const p=graphClientToSvg(e.clientX,e.clientY);
    graphZoomAt(e.deltaY>0?1.1:0.9,p.x,p.y);
  },{passive:false});
  let panState=null,panMoved=false;
  svg.addEventListener('mousedown',e=>{
    panState={startX:e.clientX,startY:e.clientY,vb:{...graphViewBox}};
    panMoved=false;
    svg.classList.add('is-panning');
  });
  document.addEventListener('mousemove',e=>{
    if(!panState)return;
    if(Math.abs(e.clientX-panState.startX)>3||Math.abs(e.clientY-panState.startY)>3)panMoved=true;
    graphUserAdjustedView=true;
    const rect=svg.getBoundingClientRect();
    const dx=(e.clientX-panState.startX)/rect.width*panState.vb.w;
    const dy=(e.clientY-panState.startY)/rect.height*panState.vb.h;
    graphViewBox.x=panState.vb.x-dx; graphViewBox.y=panState.vb.y-dy;
    graphApplyViewBox();
  });
  document.addEventListener('mouseup',()=>{
    if(panState){panState=null; svg.classList.remove('is-panning');}
  });
  // click on empty canvas (not a node) clears the current selection — skip if it was actually a pan drag
  svg.addEventListener('click',e=>{
    if(e.target.id==='graphSvg'&&!panMoved)graphDeselect();
  });
  window.addEventListener('resize',()=>{ graphRecalcLabelK(); graphUpdateLabelTransforms(); });
}

export function toggleGraphShared(checked){
  state.graphIncludeShared=checked;
  renderGraph();
}
function graphNotes(){
  return state.notes.filter(n=>(n.owner_id===state.currentUserId||(state.graphIncludeShared&&n.is_shared))&&!n.deleted);
}
// Reconciles graphNodePositions/graphVelocities with the current notes list: drops entries for
// deleted notes and seeds new notes near the existing graph's centroid (not folder-anchored, not
// from scratch) so a warm-started simulation settles smoothly instead of jumping (Task 4).
function graphSyncNodePositions(){
  const gNotes=graphNotes();
  const currentIds=new Set(gNotes.map(n=>n.id));
  Object.keys(graphNodePositions).forEach(k=>{
    const id=+k;
    if(!currentIds.has(id)){ delete graphNodePositions[id]; delete graphVelocities[id]; }
  });
  const existing=Object.values(graphNodePositions);
  const cx=existing.length?existing.reduce((s,p)=>s+p.x,0)/existing.length:graphDefaultW/2;
  const cy=existing.length?existing.reduce((s,p)=>s+p.y,0)/existing.length:graphDefaultH/2;
  gNotes.forEach(n=>{
    if(!graphNodePositions[n.id]){
      graphNodePositions[n.id]={x:cx+(Math.random()-0.5)*120, y:cy+(Math.random()-0.5)*120};
      graphVelocities[n.id]={vx:0,vy:0};
    }
  });
}

// One physics tick: repulsion (all pairs) + spring attraction (link/tag edges) + weak folder
// clustering + weak centering. Mutates graphNodePositions/graphVelocities in place and returns
// the average per-node kinetic energy, used as the convergence signal.
function graphSimulationStep(){
  const ids=state.notes.map(n=>n.id);
  const n=ids.length;
  if(!n)return 0;
  const fx={},fy={};
  ids.forEach(id=>{fx[id]=0;fy[id]=0;});

  for(let i=0;i<n;i++){
    for(let j=i+1;j<n;j++){
      const idA=ids[i],idB=ids[j];
      const A=graphNodePositions[idA],B=graphNodePositions[idB];
      if(!A||!B)continue;
      const dx=A.x-B.x,dy=A.y-B.y;
      let d=Math.sqrt(dx*dx+dy*dy)||0.0001;
      if(d<GRAPH_MIN_DIST)d=GRAPH_MIN_DIST;
      const f=GRAPH_REPULSION/d, ux=dx/d, uy=dy/d;
      fx[idA]+=ux*f; fy[idA]+=uy*f;
      fx[idB]-=ux*f; fy[idB]-=uy*f;
    }
  }

  getLinkEdges().concat(getTagEdges()).forEach(({a,b})=>{
    const A=graphNodePositions[a],B=graphNodePositions[b];
    if(!A||!B)return;
    const dx=A.x-B.x,dy=A.y-B.y;
    const d=Math.sqrt(dx*dx+dy*dy)||0.0001;
    const f=GRAPH_SPRING_STRENGTH*(d-GRAPH_SPRING_LENGTH), ux=dx/d, uy=dy/d;
    fx[a]-=ux*f; fy[a]-=uy*f;
    fx[b]+=ux*f; fy[b]+=uy*f;
  });

  const byFolder={};
  state.notes.forEach(nn=>{const f=graphGroupKey(nn);(byFolder[f]=byFolder[f]||[]).push(nn.id);});
  Object.values(byFolder).forEach(group=>{
    if(group.length<2)return;
    for(let i=0;i<group.length;i++){
      for(let j=i+1;j<group.length;j++){
        const idA=group[i],idB=group[j];
        const A=graphNodePositions[idA],B=graphNodePositions[idB];
        if(!A||!B)continue;
        const dx=A.x-B.x,dy=A.y-B.y;
        const d=Math.sqrt(dx*dx+dy*dy)||0.0001;
        const f=GRAPH_FOLDER_STRENGTH*(d-GRAPH_FOLDER_LENGTH), ux=dx/d, uy=dy/d;
        fx[idA]-=ux*f; fy[idA]-=uy*f;
        fx[idB]+=ux*f; fy[idB]+=uy*f;
      }
    }
  });

  const ccx=graphDefaultW/2, ccy=graphDefaultH/2;
  ids.forEach(id=>{
    const p=graphNodePositions[id]; if(!p)return;
    fx[id]+=(ccx-p.x)*GRAPH_CENTER_STRENGTH;
    fy[id]+=(ccy-p.y)*GRAPH_CENTER_STRENGTH;
  });

  let totalKE=0;
  ids.forEach(id=>{
    const p=graphNodePositions[id]; if(!p)return;
    const v=graphVelocities[id]||(graphVelocities[id]={vx:0,vy:0});
    v.vx=(v.vx+fx[id])*GRAPH_DAMPING;
    v.vy=(v.vy+fy[id])*GRAPH_DAMPING;
    const speed=Math.sqrt(v.vx*v.vx+v.vy*v.vy);
    if(speed>GRAPH_MAX_VEL){ v.vx=v.vx/speed*GRAPH_MAX_VEL; v.vy=v.vy/speed*GRAPH_MAX_VEL; }
    p.x+=v.vx; p.y+=v.vy;
    totalKE+=v.vx*v.vx+v.vy*v.vy;
  });
  return totalKE/n;
}

function graphUpdatePositions(){
  document.querySelectorAll('#graphSvg .graph-node').forEach(c=>{
    const p=graphNodePositions[+c.dataset.id]; if(!p)return;
    c.setAttribute('cx',p.x); c.setAttribute('cy',p.y);
  });
  document.querySelectorAll('#graphSvg .graph-edge').forEach(e=>{
    const A=graphNodePositions[+e.dataset.a],B=graphNodePositions[+e.dataset.b];
    if(!A||!B)return;
    e.setAttribute('x1',A.x);e.setAttribute('y1',A.y);e.setAttribute('x2',B.x);e.setAttribute('y2',B.y);
  });
  graphUpdateLabelTransforms();
}
function graphStopSimulation(){
  if(graphAnimFrameId!=null){ cancelAnimationFrame(graphAnimFrameId); graphAnimFrameId=null; }
}
// Runs the physics loop from the CURRENT graphNodePositions/graphVelocities (a warm start, not
// a reset) each animation frame until settled, then stops — no indefinite ticking on a rested graph.
function graphRunSimulation(){
  graphStopSimulation();
  let frame=0;
  function tick(){
    const avgKE=graphSimulationStep();
    graphUpdatePositions();
    if(!graphUserAdjustedView)graphFitToBounds();
    frame++;
    if(avgKE>GRAPH_REST_KE && frame<GRAPH_MAX_SIM_FRAMES){
      graphAnimFrameId=requestAnimationFrame(tick);
    } else {
      graphAnimFrameId=null;
    }
  }
  graphAnimFrameId=requestAnimationFrame(tick);
}

function graphNeighbors(id){
  return getBacklinkIds(id);
}
function graphTruncateTitle(title){
  return title.length>26?title.slice(0,24)+'…':title;
}

// Folders are owner-only (RLS, never shared) and notes.folder is a soft text match, not an FK —
// so a shared note's folder value is meaningless to the viewer. Bucket every note the viewer
// doesn't own into one synthetic "Shared" group instead, for both color assignment and the
// physics clustering pull below, so shared notes never inherit or clash with the viewer's own
// folder groups.
function graphGroupKey(n){
  return n.owner_id!==state.currentUserId ? GRAPH_SHARED_GROUP_KEY : (n.folder||'Unfiled');
}
// Assigns each distinct folder present in gNotes a fill color from the fixed
// --graph-folder-palette-N tokens, keyed off the alphabetical sort position of the folder
// name (not first-seen order) so the same folder always lands on the same color across
// reloads/sessions without persisting any mapping. Read once per render, not per node.
// The synthetic "Shared" group is excluded from the palette rotation and always gets the
// fixed --graph-shared-color token instead, so it can never collide with an owned folder's
// color and stays stable no matter how many folders exist.
function graphBuildFolderColorMap(gNotes){
  const folders=[...new Set(gNotes.map(graphGroupKey))].filter(f=>f!==GRAPH_SHARED_GROUP_KEY).sort();
  const style=getComputedStyle(document.body);
  const map={};
  folders.forEach((f,i)=>{
    const slot=(i%GRAPH_FOLDER_PALETTE_SIZE)+1;
    map[f]=style.getPropertyValue(`--graph-folder-palette-${slot}`).trim();
  });
  map[GRAPH_SHARED_GROUP_KEY]=style.getPropertyValue('--graph-shared-color').trim();
  return map;
}
// Degree tiers for label font-size/weight/color — thresholds tuned against node radius,
// which caps out around connCount>=5 (see r=5+min(6,connCount*1.3) below).
function graphDegreeTier(connCount){
  if(connCount>=6)return'hub';
  if(connCount>=3)return'large';
  if(connCount>=1)return'medium';
  return'small';
}

export function renderGraph(){
  buildLinkIndex();
  graphSyncNodePositions();
  graphActiveNodeId=null;
  document.getElementById('graphEmptyState').style.display='';
  document.getElementById('graphNodeDetail').classList.remove('show');

  const svg=document.getElementById('graphSvg');
  svg.innerHTML='';
  graphResetView();
  graphBindInteractions();
  const gNotes=graphNotes();
  const gNoteIds=new Set(gNotes.map(n=>n.id));
  // linkEdges/tagEdges are scoped to visibleNotes() (all org-shared notes), which is broader
  // than gNotes (org-shared notes AND the graph's own "include team-shared" toggle) — filter
  // again here so an edge is never drawn to a note whose circle isn't actually rendered below.
  const visibleLinkEdges=getLinkEdges().filter(({a,b})=>gNoteIds.has(a)&&gNoteIds.has(b));
  const visibleTagEdges=getTagEdges().filter(({a,b})=>gNoteIds.has(a)&&gNoteIds.has(b));
  document.getElementById('graphCount').textContent=`${gNotes.length} notes · ${visibleLinkEdges.length} links`;

  const ns='http://www.w3.org/2000/svg';
  function mk(tag,attrs){const e=document.createElementNS(ns,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);return e;}

  visibleLinkEdges.forEach(({a,b})=>{
    if(!graphNodePositions[a]||!graphNodePositions[b])return;
    svg.appendChild(mk('line',{class:'graph-edge graph-edge-link','data-a':a,'data-b':b}));
  });
  visibleTagEdges.forEach(({a,b})=>{
    if(!graphNodePositions[a]||!graphNodePositions[b])return;
    svg.appendChild(mk('line',{class:'graph-edge graph-edge-tag','data-a':a,'data-b':b}));
  });

  // Degree for node sizing must come from the same visibility-filtered edges as what's actually
  // drawn above — graphNeighbors()/backlinks is scoped to visibleNotes(), so a node's radius must
  // not count connections to notes hidden by the graph's own include-shared toggle.
  const visibleNeighbors={};
  gNotes.forEach(n=>{visibleNeighbors[n.id]=new Set();});
  visibleLinkEdges.concat(visibleTagEdges).forEach(({a,b})=>{
    visibleNeighbors[a].add(b); visibleNeighbors[b].add(a);
  });

  const folderColorMap=graphBuildFolderColorMap(gNotes);
  gNotes.forEach(n=>{
    const p=graphNodePositions[n.id];
    if(!p)return;
    const connCount=visibleNeighbors[n.id].size;
    const r=5+Math.min(6,connCount*1.3);
    const c=mk('circle',{r:r,class:'graph-node','data-id':n.id,
      style:`--graph-node-fill:${folderColorMap[graphGroupKey(n)]}`});
    const g=mk('g',{class:'graph-label-g','data-id':n.id,'data-r':r});
    const t=mk('text',{x:r+6,y:4,class:`graph-node-label tier-${graphDegreeTier(connCount)}`});
    t.textContent=graphTruncateTitle(n.title);
    g.appendChild(t);
    svg.appendChild(c); svg.appendChild(g);
    c.addEventListener('mouseenter',()=>graphHighlight(n.id));
    c.addEventListener('mouseleave',()=>{ if(graphActiveNodeId==null) graphClearHighlight(); else graphHighlight(graphActiveNodeId); });
    c.addEventListener('click',e=>{e.stopPropagation();graphShowDetail(n.id);});
  });

  graphRecalcLabelK();
  graphUpdatePositions();
  graphRunSimulation();
}

function graphHighlight(id){
  const nb=graphNeighbors(id); const keep=new Set(nb); keep.add(id);
  document.querySelectorAll('#graphSvg .graph-node').forEach(c=>{
    const cid=+c.dataset.id;
    c.classList.toggle('is-active', cid===id);
    c.classList.toggle('is-dim', !keep.has(cid));
  });
  document.querySelectorAll('#graphSvg .graph-edge').forEach(e=>{
    const a=+e.dataset.a,b=+e.dataset.b;
    e.classList.toggle('is-dim', !(a===id||b===id));
  });
  document.querySelectorAll('#graphSvg .graph-label-g').forEach(g=>{
    g.classList.toggle('is-dim', !keep.has(+g.dataset.id));
  });
}
function graphClearHighlight(){
  document.querySelectorAll('#graphSvg .graph-node,#graphSvg .graph-edge,#graphSvg .graph-label-g')
    .forEach(e=>e.classList.remove('is-dim','is-active'));
}

function graphShowDetail(id){
  graphActiveNodeId=id;
  const n=state.notes.find(n=>n.id===id&&!n.deleted);
  if(!n)return;
  graphHighlight(id);
  document.getElementById('graphEmptyState').style.display='none';
  const detail=document.getElementById('graphNodeDetail');
  detail.classList.add('show');
  document.getElementById('gnTitle').textContent=n.title;
  // Scope neighbor count + linked-note list to the graph's own currently-visible note set
  // (graphNotes()), not the broader visibleNotes()-scoped global backlinks map — a note hidden
  // by the include-shared toggle must never surface here, even as just a title or a count.
  const gNoteIds=new Set(graphNotes().map(gn=>gn.id));
  const conns=[...graphNeighbors(id)].filter(nid=>gNoteIds.has(nid)).length;
  const gnFolderLabel=n.owner_id!==state.currentUserId?'Shared':(n.folder||'Unfiled');
  document.getElementById('gnMeta').textContent=`${gnFolderLabel} · ${conns} connection${conns===1?'':'s'}`;
  document.getElementById('gnTags').innerHTML=(n.tags||[]).map(t=>`<span class="graph-chip">#${esc(t)}</span>`).join('')||'';
  const linked=getBacklinks(id).filter(ln=>gNoteIds.has(ln.id));
  document.getElementById('gnLinks').innerHTML=linked.length
    ? linked.map(ln=>`<div class="graph-link-item" onclick="graphShowDetail(${ln.id})">${esc(ln.title)}</div>`).join('')
    : '<div class="graph-node-meta">No connections yet</div>';
  // Regression fix (not a mechanical port): the original used
  // gnOpenBtn.setAttribute('onclick', `graphOpenNote(${id})`), which relies on graphOpenNote
  // being a global. Under ES modules that silently no-ops (button does nothing). Assign the
  // handler directly instead.
  document.getElementById('gnOpenBtn').onclick=()=>graphOpenNote(id);
}

function graphOpenNote(id){
  switchTab('notes');
  selectNote(id);
}

export function initGraphView(){
  window.toggleGraphShared=toggleGraphShared;
  window.graphZoomCenter=graphZoomCenter;
  window.graphResetView=graphResetView;
  window.graphAdjustLabelScale=graphAdjustLabelScale;
  window.graphShowDetail=graphShowDetail;

  document.getElementById('graphSharedCheckbox').addEventListener('change',e=>toggleGraphShared(e.target.checked));
  document.querySelector('.graph-ctrl-btn[title="Zoom in"]').onclick=()=>graphZoomCenter(0.8);
  document.querySelector('.graph-ctrl-btn[title="Zoom out"]').onclick=()=>graphZoomCenter(1.25);
  document.querySelector('.graph-ctrl-btn[title="Reset view"]').onclick=graphResetView;
  document.querySelector('.graph-ctrl-btn[title="Smaller labels"]').onclick=()=>graphAdjustLabelScale(-1);
  document.querySelector('.graph-ctrl-btn[title="Larger labels"]').onclick=()=>graphAdjustLabelScale(1);
}
