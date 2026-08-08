// ══════════════════════════════════════════════════
// ADMIN HUB — admin-only management of feature_flags (status) + feature_flag_testers
// (beta allowlist). Gated by role==='admin' directly at the main.js call site, not by
// get_feature_visibility() — this is a permanent permission, not a rollout feature.
// ══════════════════════════════════════════════════
import { state } from './state.js';
import { esc, escJs } from './ui-helpers.js';
import { sb } from './supabase-client.js';

// ══════════════════════════════════════════════════
// DATA LAYER
// ══════════════════════════════════════════════════
export async function loadFeatureFlags(){
  const{data,error}=await sb.from('feature_flags').select('*').order('feature_key',{ascending:true});
  if(error||!data) return [];
  return data;
}
export async function updateFeatureFlagStatusDB(id,status){
  const{error}=await sb.from('feature_flags').update({status}).eq('id',id);
  if(error) throw error;
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

// ══════════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════════
const STATUS_LABEL={off:'Off',beta:'Beta',on:'On'};

export function renderAdminHub(){
  const el=document.getElementById('adminFlagGrid');
  if(!el) return;
  if(!state.featureFlags.length){el.innerHTML='<div class="note-empty">No feature flags found</div>';return;}
  el.innerHTML=state.featureFlags.map(f=>{
    const expanded=state.expandedFlagId===f.id;
    return`<div class="checklist-template-card admin-flag-card">
      <div class="tpl-card-header">
        <span class="tpl-card-title">${esc(f.label||f.feature_key)}</span>
        <span class="admin-flag-status admin-flag-status-${esc(f.status)}">${STATUS_LABEL[f.status]||esc(f.status)}</span>
      </div>
      <div class="tpl-card-desc">${esc(f.description||'')}</div>
      <div class="tpl-card-meta">key: ${esc(f.feature_key)}</div>
      <div class="tpl-card-actions">
        <select class="form-input admin-flag-status-select" onchange="updateFlagStatus('${escJs(f.id)}',this.value)">
          <option value="off" ${f.status==='off'?'selected':''}>Off</option>
          <option value="beta" ${f.status==='beta'?'selected':''}>Beta</option>
          <option value="on" ${f.status==='on'?'selected':''}>On</option>
        </select>
        <button class="btn btn-ghost" style="font-size:11px" onclick="toggleFlagTesterPanel('${escJs(f.id)}')">${expanded?'▲ Hide early access':'▼ Early access'}</button>
      </div>
      ${expanded?renderTesterPanel(f):''}
    </div>`;
  }).join('');
}

function renderTesterPanel(f){
  const testers=state.featureFlagTesters[f.id]||[];
  const testerIds=new Set(testers.map(t=>t.id));
  // state.orgMembers excludes the current user (it's shared with checklist-share.js's
  // "share with someone else" picker, where self-exclusion is correct) — but the tester
  // allowlist is the only way for anyone, including the logged-in admin, to preview a
  // beta/off feature now that admin_bypass is gone, so add self back in here.
  const allMembers=state.orgMembers.some(m=>m.id===state.currentUserId)
    ? state.orgMembers
    : [...state.orgMembers,{id:state.currentUserId,display_name:state.profilesMap[state.currentUserId]||'You'}];
  const candidates=allMembers.filter(m=>!testerIds.has(m.id));
  return`<div class="admin-flag-testers">
    <div class="admin-flag-testers-list">
      ${testers.length?testers.map(t=>`
        <span class="admin-flag-tester-chip">${esc(t.display_name)}
          <button class="admin-flag-tester-remove" onclick="removeFlagTester('${escJs(f.id)}','${escJs(t.id)}')" title="Remove tester">✕</button>
        </span>`).join(''):'<span class="note-empty" style="padding:0">No one has early access yet</span>'}
    </div>
    ${candidates.length?`<select class="form-input" onchange="if(this.value){addFlagTester('${escJs(f.id)}',this.value);this.value='';}">
      <option value="">+ Grant access…</option>
      ${candidates.map(m=>`<option value="${escJs(m.id)}">${esc(m.display_name)}</option>`).join('')}
    </select>`:''}
  </div>`;
}

// ══════════════════════════════════════════════════
// ACTIONS
// ══════════════════════════════════════════════════
export async function updateFlagStatus(id,status){
  try{
    await updateFeatureFlagStatusDB(id,status);
    const f=state.featureFlags.find(f=>f.id===id);
    if(f) f.status=status;
    renderAdminHub();
  }catch(err){alert('Could not update flag status: '+(err.message||err));}
}
export async function toggleFlagTesterPanel(id){
  if(state.expandedFlagId===id){state.expandedFlagId=null;renderAdminHub();return;}
  state.expandedFlagId=id;
  if(!state.featureFlagTesters[id]) state.featureFlagTesters[id]=await loadFeatureFlagTestersDB(id);
  renderAdminHub();
}
export async function addFlagTester(featureId,userId){
  try{
    await addFeatureFlagTesterDB(featureId,userId);
    state.featureFlagTesters[featureId]=await loadFeatureFlagTestersDB(featureId);
    renderAdminHub();
  }catch(err){alert('Could not add tester: '+(err.message||err));}
}
export async function removeFlagTester(featureId,userId){
  try{
    await removeFeatureFlagTesterDB(featureId,userId);
    state.featureFlagTesters[featureId]=(state.featureFlagTesters[featureId]||[]).filter(t=>t.id!==userId);
    renderAdminHub();
  }catch(err){alert('Could not remove tester: '+(err.message||err));}
}

export function initAdminHub(){
  window.updateFlagStatus=updateFlagStatus;
  window.toggleFlagTesterPanel=toggleFlagTesterPanel;
  window.addFlagTester=addFlagTester;
  window.removeFlagTester=removeFlagTester;
}
