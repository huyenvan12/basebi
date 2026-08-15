// ══════════════════════════════════════════════════
// ADMIN HUB — admin-only management of feature_flags (Team/Personal scope split,
// status, tester allowlist) + feature_flag_testers. Gated by role==='admin'
// directly at the main.js call site, not by get_feature_visibility() — this is
// a permanent permission, not a rollout feature.
// ══════════════════════════════════════════════════
import { state } from './state.js';
import { esc, escJs, showNotification } from './ui-helpers.js';
import { sb } from './supabase-client.js';
import { loadOrgMembers } from './checklist-share.js';

// ══════════════════════════════════════════════════
// DATA LAYER
// ══════════════════════════════════════════════════
export async function loadFeatureFlags(){
  const{data,error}=await sb.from('feature_flags').select('*').order('feature_key',{ascending:true});
  if(error||!data) return [];
  return data;
}
export async function updateFeatureFlagFieldsDB(id,fields){
  const{error}=await sb.from('feature_flags').update({...fields,updated_at:new Date().toISOString()}).eq('id',id);
  if(error) throw error;
}
export async function createFeatureFlagDB(fields){
  const{data,error}=await sb.from('feature_flags').insert({...fields,org_id:state.currentUserOrgId}).select().single();
  if(error) throw error;
  return data;
}
export async function loadFeatureFlagTestersDB(featureId){
  const{data,error}=await sb.from('feature_flag_testers').select('user_id').eq('feature_id',featureId);
  if(error||!data) return [];
  return data.map(t=>state.profilesMap[t.user_id]?{id:t.user_id,display_name:state.profilesMap[t.user_id]}:{id:t.user_id,display_name:'Unknown'});
}
export async function addFeatureFlagTesterDB(featureId,userId){
  const{error}=await sb.from('feature_flag_testers').insert({feature_id:featureId,user_id:userId,org_id:state.currentUserOrgId});
  if(error) throw error;
}
export async function removeFeatureFlagTesterDB(featureId,userId){
  const{error}=await sb.from('feature_flag_testers').delete().eq('feature_id',featureId).eq('user_id',userId);
  if(error) throw error;
}

function isUniqueViolation(err){ return !!err&&err.code==='23505'; }

function timeAgo(iso){
  if(!iso) return '';
  const diffMs=Date.now()-new Date(iso).getTime();
  const min=Math.floor(diffMs/60000);
  if(min<1) return 'just now';
  if(min<60) return min+'m ago';
  const hr=Math.floor(min/60);
  if(hr<24) return hr+'h ago';
  const day=Math.floor(hr/24);
  if(day<30) return day+'d ago';
  return new Date(iso).toLocaleDateString();
}

// ══════════════════════════════════════════════════
// DERIVED / HELPERS
// ══════════════════════════════════════════════════
const STATUS_LABEL={off:'Off',beta:'Beta',on:'On'};

function isQaSeat(userId){
  const m=state.orgMembers.find(m=>m.id===userId);
  if(m) return !!m.is_qa_seat;
  return userId===state.currentUserId && !!state.currentUserIsQaSeat;
}

function getVisibleFeatures(scope){
  const q=(state.adminHubSearch[scope]||'').toLowerCase().trim();
  let list=state.featureFlags.filter(f=>f.scope===scope);
  if(q) list=list.filter(f=>(f.label||'').toLowerCase().includes(q)||(f.feature_key||'').toLowerCase().includes(q));
  if(scope==='team' && state.adminHubStatusFilter) list=list.filter(f=>f.status===state.adminHubStatusFilter);
  const{col,dir}=state.adminHubSort[scope];
  list=[...list].sort((a,b)=>{
    let va=(a[col]||'').toString().toLowerCase(), vb=(b[col]||'').toString().toLowerCase();
    if(va<vb) return dir==='asc'?-1:1;
    if(va>vb) return dir==='asc'?1:-1;
    return 0;
  });
  return list;
}

function updateAdminHubCounts(){
  const teamN=state.featureFlags.filter(f=>f.scope==='team').length;
  const personalN=state.featureFlags.filter(f=>f.scope==='personal').length;
  const teamEl=document.getElementById('adminHubTeamCount');
  const personalEl=document.getElementById('adminHubPersonalCount');
  if(teamEl) teamEl.textContent=teamN;
  if(personalEl) personalEl.textContent=personalN;
}

// ══════════════════════════════════════════════════
// TAB SWITCHING / SORTING
// ══════════════════════════════════════════════════
export function switchAdminHubTab(tab){
  state.adminHubTab=tab;
  document.getElementById('adminHubTabTeam').classList.toggle('active',tab==='team');
  document.getElementById('adminHubTabPersonal').classList.toggle('active',tab==='personal');
  document.getElementById('adminHubTeamView').classList.toggle('active',tab==='team');
  document.getElementById('adminHubPersonalView').classList.toggle('active',tab==='personal');
  if(tab==='team') renderAdminHubTeamTable(); else renderAdminHubPersonalTable();
}

export function sortAdminHub(scope,col){
  const s=state.adminHubSort[scope];
  if(s.col===col) s.dir=s.dir==='asc'?'desc':'asc';
  else{ s.col=col; s.dir='asc'; }
  const wrapId=scope==='team'?'adminHubTeamView':'adminHubPersonalView';
  document.querySelectorAll('#'+wrapId+' .data-table th').forEach(th=>{
    th.classList.remove('sort-asc','sort-desc');
    if(th.dataset.col===col) th.classList.add(s.dir==='asc'?'sort-asc':'sort-desc');
  });
  if(scope==='team') renderAdminHubTeamTable(); else renderAdminHubPersonalTable();
}

export function onAdminHubSearchInput(scope,value){
  state.adminHubSearch[scope]=value;
  if(scope==='team') renderAdminHubTeamTable(); else renderAdminHubPersonalTable();
}

export function setAdminHubStatusFilter(status){
  state.adminHubStatusFilter=status;
  document.querySelectorAll('#adminHubStatusFilters .admin-hub-filter-chip').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.status===status);
  });
  renderAdminHubTeamTable();
}

// ══════════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════════
export async function renderAdminHub(){
  const el=document.getElementById('adminHubTeamTableBody');
  if(!el) return;
  const missing=state.featureFlags.filter(f=>!state.featureFlagTesters[f.id]);
  if(missing.length){
    await Promise.all(missing.map(async f=>{ state.featureFlagTesters[f.id]=await loadFeatureFlagTestersDB(f.id); }));
  }
  updateAdminHubCounts();
  renderAdminHubTeamTable();
  renderAdminHubPersonalTable();
}

function testerCellHtml(f,scope){
  if(scope==='team' && f.status==='on'){
    return `<span class="admin-hub-rollout-note">— (rolled out to everyone)</span>`;
  }
  const testers=state.featureFlagTesters[f.id]||[];
  const chips=testers.map(t=>{
    const qa=isQaSeat(t.id);
    return `<span class="admin-flag-tester-chip ${qa?'admin-hub-tester-chip-qa':''}" ${qa?'title="QA seat — auto bypass"':''}>${esc(t.display_name)}
      <button class="admin-flag-tester-remove" onclick="removeTesterChip('${escJs(f.id)}','${escJs(t.id)}')" title="Remove tester">✕</button>
    </span>`;
  }).join('');
  return `<div class="admin-hub-tester-cell">${chips}<button class="icon-btn-sm admin-hub-tester-add-btn" onclick="openTesterPopover(event,'${escJs(f.id)}')" title="Add tester">+</button></div>`;
}

export function renderAdminHubTeamTable(){
  const tbody=document.getElementById('adminHubTeamTableBody');
  if(!tbody) return;
  const rows=getVisibleFeatures('team');
  if(!rows.length){
    const hasAny=state.featureFlags.some(f=>f.scope==='team');
    tbody.innerHTML=`<tr><td colspan="4" class="empty-list">${hasAny?'No features match your search/filter':'No team features yet'}</td></tr>`;
    return;
  }
  tbody.innerHTML=rows.map(f=>`<tr>
    <td>
      <div>${esc(f.label||f.feature_key)}</div>
      <div class="admin-hub-feature-key">${esc(f.feature_key)}</div>
    </td>
    <td>
      <button class="admin-hub-status-badge-btn" onclick="openStatusPopover(event,'${escJs(f.id)}')">
        <span class="admin-flag-status admin-flag-status-${esc(f.status)}">${STATUS_LABEL[f.status]||esc(f.status)}</span>
      </button>
    </td>
    <td>${testerCellHtml(f,'team')}</td>
    <td><span class="admin-hub-updated" title="${esc(f.updated_at||'')}">${timeAgo(f.updated_at)}</span></td>
  </tr>`).join('');
}

export function renderAdminHubPersonalTable(){
  const tbody=document.getElementById('adminHubPersonalTableBody');
  if(!tbody) return;
  const rows=getVisibleFeatures('personal');
  if(!rows.length){
    const hasAny=state.featureFlags.some(f=>f.scope==='personal');
    tbody.innerHTML=`<tr><td colspan="3" class="empty-list">${hasAny?'No features match your search':'No personal features yet'}</td></tr>`;
    return;
  }
  tbody.innerHTML=rows.map(f=>`<tr>
    <td>
      <div>${esc(f.label||f.feature_key)}</div>
      <div class="admin-hub-feature-key">${esc(f.feature_key)}</div>
      <div class="admin-hub-scope-sub">scope: personal</div>
    </td>
    <td>${testerCellHtml(f,'personal')}</td>
    <td><span class="admin-hub-updated" title="${esc(f.updated_at||'')}">${timeAgo(f.updated_at)}</span></td>
  </tr>`).join('');
}

// ══════════════════════════════════════════════════
// STATUS POPOVER (non-destructive, click-to-edit)
// ══════════════════════════════════════════════════
function positionPopover(pop,event){
  pop.style.display='block';
  const rect=event.target.closest('button').getBoundingClientRect();
  const vw=window.innerWidth, vh=window.innerHeight, w=220, h=Math.min(260,pop.offsetHeight||200);
  const x=Math.max(8,Math.min(rect.left,vw-w-8));
  const y=Math.max(8,Math.min(rect.bottom+4,vh-h-8));
  pop.style.left=x+'px';
  pop.style.top=y+'px';
}

export function openStatusPopover(event,featureId){
  event.stopPropagation();
  state.adminHubStatusPopoverFeatureId=featureId;
  state.adminHubTesterPopoverFeatureId=null;
  document.getElementById('adminHubTesterPopover').style.display='none';
  const pop=document.getElementById('adminHubStatusPopover');
  renderStatusPopoverBody(featureId);
  positionPopover(pop,event);
}
export function closeStatusPopover(){
  state.adminHubStatusPopoverFeatureId=null;
  const pop=document.getElementById('adminHubStatusPopover');
  pop.style.display='none';
  pop.innerHTML='';
}
function renderStatusPopoverBody(featureId){
  const f=state.featureFlags.find(f=>f.id===featureId);
  const pop=document.getElementById('adminHubStatusPopover');
  pop.innerHTML=`<div class="admin-hub-status-popover-inner">
    <div class="admin-hub-popover-title">Set status</div>
    ${['off','beta','on'].map(s=>`<button class="admin-hub-popover-row ${f&&f.status===s?'active':''}" onclick="setFeatureStatus('${escJs(featureId)}','${s}')">${STATUS_LABEL[s]}</button>`).join('')}
  </div>`;
}
export async function setFeatureStatus(featureId,status){
  try{
    await updateFeatureFlagFieldsDB(featureId,{status});
    const f=state.featureFlags.find(f=>f.id===featureId);
    if(f){ f.status=status; f.updated_at=new Date().toISOString(); }
    closeStatusPopover();
    renderAdminHubTeamTable();
  }catch(err){showNotification('Could not update status: '+(err.message||err),'error');}
}

// ══════════════════════════════════════════════════
// TESTER POPOVER (non-destructive add; direct-action remove on chip)
// ══════════════════════════════════════════════════
export function openTesterPopover(event,featureId){
  event.stopPropagation();
  state.adminHubTesterPopoverFeatureId=featureId;
  state.adminHubStatusPopoverFeatureId=null;
  document.getElementById('adminHubStatusPopover').style.display='none';
  const pop=document.getElementById('adminHubTesterPopover');
  renderTesterPopoverBody(featureId);
  positionPopover(pop,event);
}
export function closeTesterPopover(){
  state.adminHubTesterPopoverFeatureId=null;
  const pop=document.getElementById('adminHubTesterPopover');
  pop.style.display='none';
  pop.innerHTML='';
}
function renderTesterPopoverBody(featureId){
  const testers=state.featureFlagTesters[featureId]||[];
  const testerIds=new Set(testers.map(t=>t.id));
  // state.orgMembers excludes the current user (shared with checklist-share.js's
  // "share with someone else" picker, where self-exclusion is correct) — but the
  // tester allowlist is the only way for anyone, including the logged-in admin, to
  // preview a beta/off team feature or any personal feature, so add self back in here.
  const allMembers=state.orgMembers.some(m=>m.id===state.currentUserId)
    ? state.orgMembers
    : [...state.orgMembers,{id:state.currentUserId,display_name:state.profilesMap[state.currentUserId]||'You',is_qa_seat:state.currentUserIsQaSeat}];
  const candidates=allMembers.filter(m=>!testerIds.has(m.id));
  const pop=document.getElementById('adminHubTesterPopover');
  pop.innerHTML=`<div class="admin-hub-tester-popover-inner">
    <div class="admin-hub-popover-title">Add tester</div>
    ${candidates.length?candidates.map(m=>`<button class="admin-hub-popover-row" onclick="addTesterFromPopover('${escJs(featureId)}','${escJs(m.id)}')">${esc(m.display_name)}${m.is_qa_seat?'<span class="admin-hub-popover-qa-tag">QA seat</span>':''}</button>`).join(''):'<span class="empty-list-sm">Everyone already has access</span>'}
  </div>`;
}
export async function addTesterFromPopover(featureId,userId){
  try{
    await addFeatureFlagTesterDB(featureId,userId);
    state.featureFlagTesters[featureId]=await loadFeatureFlagTestersDB(featureId);
    renderTesterPopoverBody(featureId);
    renderAdminHubTeamTable();
    renderAdminHubPersonalTable();
  }catch(err){showNotification('Could not add tester: '+(err.message||err),'error');}
}
export async function removeTesterChip(featureId,userId){
  try{
    await removeFeatureFlagTesterDB(featureId,userId);
    state.featureFlagTesters[featureId]=(state.featureFlagTesters[featureId]||[]).filter(t=>t.id!==userId);
    renderAdminHubTeamTable();
    renderAdminHubPersonalTable();
  }catch(err){showNotification('Could not remove tester: '+(err.message||err),'error');}
}

// ══════════════════════════════════════════════════
// NEW FEATURE MODAL (shared, scope param)
// ══════════════════════════════════════════════════
const SCOPE_NOTE={
  team:'Team feature — visibility controlled by status + testers below.',
  personal:'Personal feature — hidden from everyone until you add testers, no status.',
};
function showNewFeatureKeyError(msg){
  const el=document.getElementById('nf-key-error');
  el.textContent=msg; el.style.display='';
}
function hideNewFeatureKeyError(){
  const el=document.getElementById('nf-key-error');
  el.textContent=''; el.style.display='none';
}
export function openNewFeatureModal(scope){
  state.adminHubNewFeatureScope=scope;
  document.getElementById('newFeatureModalTitle').textContent=scope==='team'?'New Team Feature':'New Personal Feature';
  document.getElementById('newFeatureScopeNote').textContent=SCOPE_NOTE[scope];
  document.getElementById('nf-key').value='';
  document.getElementById('nf-label').value='';
  document.getElementById('nf-description').value='';
  document.getElementById('nf-status').value='off';
  document.getElementById('nf-status-row').style.display=scope==='team'?'':'none';
  hideNewFeatureKeyError();
  document.getElementById('newFeatureModalOverlay').classList.add('open');
  setTimeout(()=>{ const el=document.getElementById('nf-key'); if(el) el.focus(); },30);
}
export function closeNewFeatureModal(){
  document.getElementById('newFeatureModalOverlay').classList.remove('open');
  state.adminHubNewFeatureScope=null;
}
export async function saveNewFeatureModal(){
  const scope=state.adminHubNewFeatureScope;
  const feature_key=document.getElementById('nf-key').value.trim().toLowerCase();
  const label=document.getElementById('nf-label').value.trim();
  const description=document.getElementById('nf-description').value.trim();
  if(!feature_key||!label){
    showNewFeatureKeyError('Feature key and label are required.');
    return;
  }
  hideNewFeatureKeyError();
  const fields={feature_key,label,description:description||null,scope};
  if(scope==='team') fields.status=document.getElementById('nf-status').value;
  try{
    const row=await createFeatureFlagDB(fields);
    state.featureFlags.push(row);
    state.featureFlagTesters[row.id]=[];
    closeNewFeatureModal();
    updateAdminHubCounts();
    if(scope==='team') renderAdminHubTeamTable(); else renderAdminHubPersonalTable();
  }catch(err){
    if(isUniqueViolation(err)) showNotification('A feature with this key already exists.','error');
    else showNotification('Could not create feature: '+(err.message||err),'error');
  }
}

// ══════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════
export function initAdminHub(){
  window.switchAdminHubTab=switchAdminHubTab;
  window.sortAdminHub=sortAdminHub;
  window.onAdminHubSearchInput=onAdminHubSearchInput;
  window.setAdminHubStatusFilter=setAdminHubStatusFilter;
  window.openStatusPopover=openStatusPopover;
  window.setFeatureStatus=setFeatureStatus;
  window.openTesterPopover=openTesterPopover;
  window.addTesterFromPopover=addTesterFromPopover;
  window.removeTesterChip=removeTesterChip;
  window.openNewFeatureModal=openNewFeatureModal;
  window.closeNewFeatureModal=closeNewFeatureModal;
  window.saveNewFeatureModal=saveNewFeatureModal;

  document.addEventListener('click',e=>{
    if(state.adminHubTesterPopoverFeatureId && !e.target.closest('#adminHubTesterPopover') && !e.target.closest('.admin-hub-tester-add-btn')){
      closeTesterPopover();
    }
    if(state.adminHubStatusPopoverFeatureId && !e.target.closest('#adminHubStatusPopover') && !e.target.closest('.admin-hub-status-badge-btn')){
      closeStatusPopover();
    }
  });
}
