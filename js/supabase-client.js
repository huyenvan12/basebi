// ══════════════════════════════════════════════════
// SUPABASE CLIENT + AUTH — client init, login/logout, password change, admin-role check
// ══════════════════════════════════════════════════
import { SUPABASE_URL, SUPABASE_KEY } from './constants.js';
import { state } from './state.js';
import { closeGearMenu } from './ui-helpers.js';

export const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Reusable role check — fetches the current user's role from profiles once.
// Also reused by future features (Campaign Log, Admin Hub) that need the same admin gate.
export async function loadCurrentUserIsAdmin(){
  if(!state.currentUserId) return false;
  const{data,error}=await sb.from('profiles').select('role,org_id,is_qa_seat,has_seen_tour').eq('id',state.currentUserId).single();
  if(!error&&data){
    state.currentUserOrgId=data.org_id;
    state.currentUserRole=data.role;
    state.currentUserIsQaSeat=!!data.is_qa_seat;
    state.currentUserHasSeenTour=!!data.has_seen_tour;
  }
  return !error && data && data.role==='admin';
}

// Marks the tour as seen for the current user — only called from a first-login auto-tour
// finish (Skip or Done), never from a Help-menu replay (see onboarding-tour.js startTour()).
export async function markTourSeen(){
  if(!state.currentUserId) return;
  state.currentUserHasSeenTour = true; // optimistic — avoids a re-trigger race on next render
  await sb.from('profiles').update({has_seen_tour:true}).eq('id', state.currentUserId);
}

export async function loadProfilesMap(){
  const{data,error}=await sb.from('profiles').select('id,display_name');
  const map={};
  if(!error&&data)data.forEach(p=>{map[p.id]=p.display_name||'Unknown';});
  return map;
}

export function renderGearUserInfo(){
  const nameEl=document.getElementById('gearUserName');
  const emailEl=document.getElementById('gearUserEmail');
  if(nameEl) nameEl.textContent=state.profilesMap[state.currentUserId]||'Unknown';
  if(emailEl) emailEl.textContent=state.currentUserEmail||'';
}

// ══════════════════════════════════════════════════
// PASSWORD CHANGE
// ══════════════════════════════════════════════════
export function openPasswordModal(){
  document.getElementById('pw-new').value='';
  document.getElementById('pw-confirm').value='';
  document.getElementById('pw-error').style.display='none';
  document.getElementById('passwordModalOverlay').classList.add('open');
  setTimeout(()=>document.getElementById('pw-new').focus(),50);
}
export function closePasswordModal(){document.getElementById('passwordModalOverlay').classList.remove('open');}
export async function submitPasswordChange(){
  const pw=document.getElementById('pw-new').value;
  const confirmPw=document.getElementById('pw-confirm').value;
  const errEl=document.getElementById('pw-error');
  errEl.style.display='none';
  if(pw.length<6){errEl.textContent='Password must be at least 6 characters.';errEl.style.display='';return;}
  if(pw!==confirmPw){errEl.textContent='Passwords do not match.';errEl.style.display='';return;}
  const{error}=await sb.auth.updateUser({password:pw});
  if(error){errEl.textContent=error.message||'Failed to update password.';errEl.style.display='';return;}
  closePasswordModal();
}

// ══════════════════════════════════════════════════
// AUTH GATE
// ══════════════════════════════════════════════════
function appendLoginLog(panel,lines,cb){
  lines.forEach(l=>{
    setTimeout(()=>{
      const div=document.createElement('div');
      div.className='login-log-line '+l.cls;
      div.textContent=l.text;
      panel.appendChild(div);
      panel.scrollTop=panel.scrollHeight;
    },l.delay);
  });
  if(cb)setTimeout(cb,lines[lines.length-1].delay+250);
}

let onAuthenticated=null;
let onFreshLogin=null;   // fired only on a fresh password login, never on a silently-restored session — see setOnFreshLogin

async function submitLoginJob(){
  const btn=document.getElementById('loginRunBtn');
  const panel=document.getElementById('loginLogPanel');
  const email=document.getElementById('loginEmail').value.trim();
  const pass=document.getElementById('loginPass').value;
  if(!email||!pass)return;
  btn.disabled=true; panel.innerHTML='';

  appendLoginLog(panel,[
    {text:'NOTE: PROCEDURE LOGIN starting execution.',cls:'login-log-note',delay:150},
    {text:'NOTE: Session established for &user.',cls:'login-log-note',delay:450},
  ]);

  const {data,error}=await sb.auth.signInWithPassword({email,password:pass});
  if(data&&data.user){ state.currentUserId = data.user.id; state.currentUserEmail = data.user.email; }

  if(error){
    appendLoginLog(panel,[
      {text:'WARNING: Credential hash mismatch, retrying…',cls:'login-log-warn',delay:850},
      {text:`ERROR: Authentication failed. ${error.message}. ROLLBACK.`,cls:'login-log-err',delay:1300},
      {text:'NOTE: PROCEDURE LOGIN used (Total process time): 0.63 seconds',cls:'login-log-plain',delay:1650},
    ],()=>{ btn.disabled=false; });
  }else{
    appendLoginLog(panel,[
      {text:'NOTE: Credentials verified. 1 row returned.',cls:'login-log-note',delay:850},
      {text:'NOTE: PROCEDURE LOGIN used (Total process time): 0.41 seconds',cls:'login-log-plain',delay:1150},
      {text:`NOTE: Welcome back, ${email.split('@')[0]}. Loading workspace…`,cls:'login-log-note',delay:1500},
    ],()=>{
      if(onAuthenticated)onAuthenticated();
      if(onFreshLogin&&data.session)onFreshLogin(data.session,email);
    });
  }
}

export async function checkAuthAndInit(){
  const {data:{session}} = await sb.auth.getSession();
  if(session){
    state.currentUserId = session.user.id;
    state.currentUserEmail = session.user.email;
    if(onAuthenticated)onAuthenticated();
  } else {
    history.replaceState(null,'','/');
    document.getElementById('connectGate').style.display='none';
    document.getElementById('loginGate').style.display='block';
  }
}
export async function doLogout(){
  await sb.auth.signOut();
  location.reload();
}

// initSupabaseClient(cb) — cb is called once the user is authenticated (either an existing
// session found by checkAuthAndInit, or a fresh sign-in via submitLoginJob). This indirection
// avoids supabase-client.js importing main.js's initApp directly (would be a real import cycle,
// unlike the safe function-body-only folders.js<->notes.js cycle).
export function setOnFreshLogin(cb){
  onFreshLogin=cb;
}

export function initSupabaseClient(cb){
  onAuthenticated=cb;

  document.getElementById('loginRunBtn').onclick=submitLoginJob;
  document.getElementById('loginPass').addEventListener('keydown',e=>{if(e.key==='Enter')submitLoginJob();});

  document.getElementById('pw-new').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('pw-confirm').focus();});
  document.getElementById('pw-confirm').addEventListener('keydown',e=>{if(e.key==='Enter')submitPasswordChange();});
  document.querySelector('#passwordModalOverlay .modal-close').onclick=closePasswordModal;
  const pwActions=document.querySelectorAll('#passwordModalOverlay .modal-actions .btn');
  pwActions[0].onclick=closePasswordModal;
  pwActions[1].onclick=submitPasswordChange;

  document.getElementById('gearPasswordItem').onclick=()=>{openPasswordModal();closeGearMenu();};
  document.getElementById('gearLogoutItem').onclick=doLogout;
}
