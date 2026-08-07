// ══════════════════════════════════════════════════
// ONBOARDING TOUR — first-login spotlight walkthrough of the 4 core nav modules, replayable
// from the gear menu's Help item. Imports switchTab-adjacent helpers from main.js only inside
// function bodies (never at module top-level), mirroring the safe daily-note.js<->main.js
// cycle — see initOnboardingTour() below.
// ══════════════════════════════════════════════════
import { state } from './state.js';
import { sb, markTourSeen } from './supabase-client.js';
import { isFeatureVisible } from './feature-flags.js';
import { openMobDrawer, closeGearMenu } from './ui-helpers.js';

const STEP_TARGETS = {
  notes:     { desktop:'#tabNotes',     mobile:'#mobTabNotes' },
  campaigns: { desktop:'#tabCampaigns', mobile:'#mobTabCampaigns' },
  checklist: { desktop:'#tabTeam',      mobile:'#mobTabTeam' },
  delivery:  { desktop:'#tabGantt',     mobile:'#mobTabGantt' },
};
const MODULE_TO_FEATURE_KEY = {notes:'notes', campaigns:'campaign', checklist:'checklist', delivery:'gantt_tracker'};

let activeSteps = [];

export async function loadOnboardingSteps(){
  const{data,error}=await sb.from('onboarding_steps').select('*').eq('active',true).order('step_order');
  return (!error&&data)?data:[];
}

export function shouldAutoStartTour(){
  return !state.currentUserHasSeenTour && state.onboardingSteps.length>0;
}

function isMobile(){
  return window.matchMedia('(max-width:768px)').matches;
}

function targetEl(module){
  const sel=STEP_TARGETS[module];
  if(!sel) return null;
  const el=document.getElementById((isMobile()?sel.mobile:sel.desktop).slice(1));
  return (el && el.style.display!=='none') ? el : null;
}

// mode: 'first-login' | 'help'
export function startTour(mode){
  activeSteps = state.onboardingSteps.filter(s =>
    isFeatureVisible(MODULE_TO_FEATURE_KEY[s.module]) && targetEl(s.module)
  );
  if(!activeSteps.length) return;
  state.tourActive = true;
  state.tourMode = mode;
  state.tourStepIndex = 0;
  if(isMobile()) openMobDrawer();
  renderTourStep();
}

function positionOverlay(){
  if(!state.tourActive || !activeSteps.length) return;
  const step = activeSteps[state.tourStepIndex];
  const target = targetEl(step.module);
  const ring = document.getElementById('tourRing');
  const card = document.getElementById('tourCard');
  if(!target || !ring || !card) return;

  const rect = target.getBoundingClientRect();
  ring.style.top = (rect.top-4)+'px';
  ring.style.left = (rect.left-4)+'px';
  ring.style.width = (rect.width+8)+'px';
  ring.style.height = (rect.height+8)+'px';

  const cardW = card.offsetWidth || 260;
  let cardTop = rect.bottom + 10;
  let cardLeft = rect.left;
  cardLeft = Math.min(cardLeft, window.innerWidth - cardW - 16);
  cardLeft = Math.max(cardLeft, 16);
  cardTop = Math.min(cardTop, window.innerHeight - 160);
  card.style.top = cardTop+'px';
  card.style.left = cardLeft+'px';
}

function renderTourStep(){
  const step = activeSteps[state.tourStepIndex];
  const overlay = document.getElementById('tourOverlay');
  const card = document.getElementById('tourCard');
  if(!overlay || !card) return;
  overlay.style.display = '';

  const isLast = state.tourStepIndex === activeSteps.length-1;
  const dots = activeSteps.map((_,i)=>`<span class="tour-dot${i===state.tourStepIndex?' active':''}"></span>`).join('');
  const caption = step.module==='checklist' ? `<div class="tour-card-caption">📍 Found under Team Shared</div>` : '';

  card.innerHTML = `
    <div class="tour-card-title">${escHtml(step.title)}</div>
    ${caption}
    <div class="tour-card-body">${escHtml(step.body)}</div>
    <div class="tour-dots">${dots}</div>
    <div class="tour-card-actions">
      <button class="btn btn-ghost" id="tourSkipBtn">Skip</button>
      <button class="btn btn-primary" id="tourNextBtn">${isLast?'Done':'Next'}</button>
    </div>`;

  document.getElementById('tourSkipBtn').onclick = finishTour;
  document.getElementById('tourNextBtn').onclick = isLast ? finishTour : nextTourStep;

  positionOverlay();
}

function escHtml(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function nextTourStep(){
  state.tourStepIndex++;
  if(isMobile()) openMobDrawer();
  renderTourStep();
}

function finishTour(){
  const overlay = document.getElementById('tourOverlay');
  if(overlay) overlay.style.display = 'none';
  const wasFirstLogin = state.tourMode==='first-login';
  state.tourActive = false;
  state.tourMode = null;
  activeSteps = [];
  if(wasFirstLogin) markTourSeen();
}

export function initOnboardingTour(){
  window.addEventListener('resize', positionOverlay);
  window.addEventListener('scroll', positionOverlay, true);
  const helpItem = document.getElementById('gearHelpItem');
  if(helpItem) helpItem.onclick = ()=>{ closeGearMenu(); startTour('help'); };
}
