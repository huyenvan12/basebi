// ══════════════════════════════════════════════════
// ONBOARDING TOUR — first-login spotlight walkthrough of the core nav modules, replayable
// from the gear menu's Help item. Desktop only — the Team Shared sub-steps drive real
// navigation (switchTab/switchTeamSubTab) to reveal their targets, which only exist on the
// desktop layout. Imports switchTab/switchTeamSubTab from main.js only inside function
// bodies (never at module top-level), mirroring the safe daily-note.js<->main.js cycle —
// see beforeShowStep()/initOnboardingTour() below.
// ══════════════════════════════════════════════════
import { state } from './state.js';
import { sb, markTourSeen } from './supabase-client.js';
import { isFeatureVisible } from './feature-flags.js';
import { closeGearMenu } from './ui-helpers.js';
import { refreshHintButtonVisibility } from './onboarding-tooltips.js';

const STEP_TARGETS = {
  notes:             '#tabNotes',
  campaigns:         '#tabCampaigns',
  team_shared:       '#tabTeam',
  team_shared_notes: '#teamSubTabNotes',
  checklist:         '#teamSubTabChecklists',
  delivery:          '#tabGantt',
  delivery_timeline: '#dtSubTabTimeline',
  delivery_calendar: '#dtSubTabCalendar',
  delivery_tasks:    '#dtSubTabTasks',
};

const MODULE_VISIBLE = {
  notes:             ()=>isFeatureVisible('notes'),
  campaigns:         ()=>isFeatureVisible('campaign'),
  team_shared:       ()=>isFeatureVisible('teamshared_notes')||isFeatureVisible('checklist'),
  team_shared_notes: ()=>isFeatureVisible('teamshared_notes'),
  checklist:         ()=>isFeatureVisible('checklist'),
  delivery:          ()=>isFeatureVisible('gantt_tracker'),
  delivery_timeline: ()=>isFeatureVisible('gantt_tracker'),
  delivery_calendar: ()=>isFeatureVisible('gantt_tracker'),
  delivery_tasks:    ()=>isFeatureVisible('gantt_tracker')&&isFeatureVisible('tasks'),
};

// Steps whose target only becomes visible after navigating there — the desktop Team Shared
// sub-nav and Delivery Tracker sub-nav are page content (not a persistent menu), so they
// don't exist on-screen until the tour actually switches to them.
async function beforeShowStep(module){
  const { switchTab, switchTeamSubTab } = await import('./main.js');
  if(module==='team_shared_notes'){ switchTab('team'); switchTeamSubTab('notes'); }
  if(module==='checklist'){ switchTab('team'); switchTeamSubTab('checklists'); }
  if(module==='delivery_timeline'||module==='delivery_calendar'||module==='delivery_tasks'){
    const { switchGanttView } = await import('./gantt-tracker.js');
    switchTab('deliveryTracker');
    switchGanttView(module==='delivery_timeline'?'timeline':module==='delivery_calendar'?'calendar':'tasks');
  }
}

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
  const el=document.getElementById(sel.slice(1));
  return (el && el.style.display!=='none' && el.offsetParent!==null) ? el : null;
}

// mode: 'first-login' | 'help'
export function startTour(mode){
  if(isMobile()) return; // Quick Tour is desktop-only
  activeSteps = state.onboardingSteps.filter(s => MODULE_VISIBLE[s.module]?.());
  if(!activeSteps.length) return;
  state.tourActive = true;
  state.tourMode = mode;
  state.tourStepIndex = 0;
  refreshHintButtonVisibility(); // hide the hint bulb — Quick Tour takes priority while active
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

async function renderTourStep(){
  const step = activeSteps[state.tourStepIndex];
  await beforeShowStep(step.module);

  const overlay = document.getElementById('tourOverlay');
  const card = document.getElementById('tourCard');
  if(!overlay || !card) return;
  overlay.style.display = '';

  const isFirst = state.tourStepIndex === 0;
  const isLast = state.tourStepIndex === activeSteps.length-1;
  const dots = activeSteps.map((_,i)=>`<span class="tour-dot${i===state.tourStepIndex?' active':''}"></span>`).join('');

  card.innerHTML = `
    <div class="tour-card-title">${escHtml(step.title)}</div>
    <div class="tour-card-body">${escHtml(step.body)}</div>
    <div class="tour-dots">${dots}</div>
    <div class="tour-card-actions">
      <button class="btn btn-ghost" id="tourSkipBtn">Skip</button>
      <div class="tour-card-nav">
        ${isFirst?'':'<button class="btn btn-ghost" id="tourBackBtn">Back</button>'}
        <button class="btn btn-primary" id="tourNextBtn">${isLast?'Done':'Next'}</button>
      </div>
    </div>`;

  document.getElementById('tourSkipBtn').onclick = finishTour;
  document.getElementById('tourNextBtn').onclick = isLast ? finishTour : nextTourStep;
  const backBtn = document.getElementById('tourBackBtn');
  if(backBtn) backBtn.onclick = prevTourStep;

  positionOverlay();
}

function escHtml(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function nextTourStep(){
  state.tourStepIndex++;
  renderTourStep();
}

function prevTourStep(){
  if(state.tourStepIndex===0) return;
  state.tourStepIndex--;
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
  refreshHintButtonVisibility(); // restore the hint bulb for whichever screen the tour left us on
}

export function initOnboardingTour(){
  window.addEventListener('resize', positionOverlay);
  window.addEventListener('scroll', positionOverlay, true);
  const helpItem = document.getElementById('gearHelpItem');
  if(helpItem) helpItem.onclick = ()=>{ closeGearMenu(); startTour('help'); };
}
