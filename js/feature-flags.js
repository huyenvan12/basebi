// ══════════════════════════════════════════════════
// FEATURE FLAGS — client-side gate on top of the DB-backed get_feature_visibility() RPC.
// Resolution logic (off/beta/on, admin/qa-seat bypass, tester allowlist) lives entirely
// server-side; this module only caches the resolved 'active'/'hidden' result per session
// so nav render + switchTab() don't re-hit the RPC on every check.
// ══════════════════════════════════════════════════
import { state } from './state.js';
import { sb } from './supabase-client.js';

export const FEATURE_KEYS = ['notes','teamshared_notes','checklist','campaign','monitor_log','daily_note','graph_view'];

export async function getFeatureVisibility(featureKey){
  const{data,error}=await sb.rpc('get_feature_visibility',{p_user_id:state.currentUserId,p_feature_key:featureKey});
  if(error){console.error('get_feature_visibility failed for',featureKey,error);return 'hidden';}
  return data;
}

export async function loadFeatureVisibility(){
  const results=await Promise.all(FEATURE_KEYS.map(key=>getFeatureVisibility(key)));
  state.featureVisibility={};
  FEATURE_KEYS.forEach((key,i)=>{state.featureVisibility[key]=results[i];});
}

// fail-closed: an unknown/unfetched key is treated as hidden, never active
export function isFeatureVisible(featureKey){
  return state.featureVisibility[featureKey]==='active';
}
