// ══════════════════════════════════════════════════
// ONBOARDING HINTS — click-to-reveal contextual popovers for Notes/Checklist/Delivery.
// No auto-popup, no badge: a fixed 💡 button (top-right of the viewport) is shown whenever the
// active screen has hints. Clicking it reveals every hint for the current screen at once, each
// anchored to its target element — click again (or click outside) to dismiss them. Quick Tour
// always takes priority — see the state.tourActive check below.
// ══════════════════════════════════════════════════
import { state } from './state.js';
import { sb } from './supabase-client.js';

export async function loadOnboardingTooltips(){
  const{data,error}=await sb.from('onboarding_tooltips').select('*').eq('active',true).order('sort_order');
  return (!error&&data)?data:[];
}

let currentScreen = null;
let activePopovers = [];

function rowsForScreen(screen){
  return state.onboardingTooltips.filter(t=>t.screen===screen);
}

// Called on every screen/sub-tab switch (replaces the old auto-show-on-visit behavior).
export function setHintScreen(screen){
  if(screen !== currentScreen){
    currentScreen = screen;
    dismissAllPopovers();
  }
  updateHintButton();
}

// Called by onboarding-tour.js on tour start/finish — a tour step change doesn't always call
// setHintScreen() (e.g. simple non-navigating steps), so the button needs an explicit refresh
// hook to hide/show itself in lockstep with state.tourActive.
export function refreshHintButtonVisibility(){ updateHintButton(); }

function updateHintButton(){
  const btn = document.getElementById('onbHintBtn');
  if(!btn) return;
  const rows = currentScreen ? rowsForScreen(currentScreen) : [];
  btn.style.display = (rows.length>0 && !state.tourActive) ? '' : 'none';
}

function onHintButtonClick(){
  if(state.tourActive || !currentScreen) return;
  if(activePopovers.length){ dismissAllPopovers(); return; } // click again to close them all

  const rows = rowsForScreen(currentScreen);
  rows.forEach(row=>{
    const el = document.querySelector(row.target_selector);
    if(el && el.offsetParent!==null) renderTooltipPopover(row, el);
  });
  if(activePopovers.length) setTimeout(()=>document.addEventListener('click', onOutsideClick), 0);
}

function onOutsideClick(e){
  if(e.target.id==='onbHintBtn') return;
  if(activePopovers.some(p=>p.contains(e.target))) return;
  dismissAllPopovers();
}

function dismissAllPopovers(){
  if(!activePopovers.length) return;
  document.removeEventListener('click', onOutsideClick);
  activePopovers.forEach(pop=>{
    pop.classList.remove('in');
    setTimeout(()=>pop.remove(), 150);
  });
  activePopovers = [];
}

function escHtml(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function renderTooltipPopover(row, el){
  const pop = document.createElement('div');
  pop.className = 'onb-tooltip-popover';
  pop.innerHTML = `<span class="onb-tooltip-icon">💡</span><span>${escHtml(row.body)}</span><button class="onb-tooltip-close" title="Dismiss">×</button>`;
  document.body.appendChild(pop);
  activePopovers.push(pop);

  const rect = el.getBoundingClientRect();
  const popW = pop.offsetWidth || 220;
  let top = rect.bottom + 8;
  let left = Math.min(Math.max(rect.left, 8), window.innerWidth - popW - 8);
  top = Math.min(top, window.innerHeight - 60);
  pop.style.top = top+'px';
  pop.style.left = left+'px';

  requestAnimationFrame(()=>pop.classList.add('in'));

  pop.querySelector('.onb-tooltip-close').onclick = (e)=>{
    e.stopPropagation(); // otherwise the bubbled click hits the document-level outside-click
    // listener and gets misread as "outside" the *other* still-open popovers, closing them too
    pop.classList.remove('in');
    setTimeout(()=>pop.remove(), 150);
    activePopovers = activePopovers.filter(p=>p!==pop);
    if(!activePopovers.length) document.removeEventListener('click', onOutsideClick);
  };
}

export function initOnboardingHints(){
  const btn = document.getElementById('onbHintBtn');
  if(btn) btn.onclick = onHintButtonClick;
}
