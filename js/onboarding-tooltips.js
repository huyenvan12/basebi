// ══════════════════════════════════════════════════
// ONBOARDING TOOLTIPS — one-time contextual popovers for Notes/Checklist/Delivery, shown per
// screen on first visit. Dismissal state is localStorage-only (no DB round trip). Quick Tour
// always takes priority — see the state.tourActive check in maybeShowTooltipsFor().
// ══════════════════════════════════════════════════
import { state } from './state.js';
import { sb } from './supabase-client.js';

const LS_PREFIX = 'basebi_tooltip_seen_';

export async function loadOnboardingTooltips(){
  const{data,error}=await sb.from('onboarding_tooltips').select('*').eq('active',true).order('sort_order');
  return (!error&&data)?data:[];
}

function seen(id){ return localStorage.getItem(LS_PREFIX+id)==='1'; }
function markSeen(id){ localStorage.setItem(LS_PREFIX+id,'1'); }

export function maybeShowTooltipsFor(screen){
  if(state.tourActive) return; // Quick Tour always takes priority
  state.onboardingTooltips
    .filter(t=>t.screen===screen && !seen(t.id))
    .forEach(row=>{
      const el=document.querySelector(row.target_selector);
      if(el && el.offsetParent!==null) renderTooltipPopover(row, el);
    });
}

function escHtml(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function renderTooltipPopover(row, el){
  const pop = document.createElement('div');
  pop.className = 'onb-tooltip-popover';
  pop.innerHTML = `<span>${escHtml(row.body)}</span><button class="onb-tooltip-close" title="Dismiss">×</button>`;
  document.body.appendChild(pop);

  const rect = el.getBoundingClientRect();
  const popW = pop.offsetWidth || 220;
  let top = rect.bottom + 8;
  let left = Math.min(Math.max(rect.left, 8), window.innerWidth - popW - 8);
  top = Math.min(top, window.innerHeight - 60);
  pop.style.top = top+'px';
  pop.style.left = left+'px';

  const dismiss = ()=>{
    markSeen(row.id);
    pop.remove();
    document.removeEventListener('click', onOutsideClick);
  };
  const onOutsideClick = (e)=>{ if(!pop.contains(e.target)) dismiss(); };

  pop.querySelector('.onb-tooltip-close').onclick = dismiss;
  setTimeout(()=>document.addEventListener('click', onOutsideClick), 0);
}
