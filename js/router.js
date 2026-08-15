// ══════════════════════════════════════════════════
// ROUTER — thin URL⇄state sync layer on top of the existing tab/sub-tab switch functions.
// Does not own any DOM rendering itself; switchTab()/switchTeamSubTab()/switchGanttView()
// remain the single source of truth for what's on screen. This module only decides what the
// address bar should say, and re-validates gating for route-driven navigation (direct URL
// entry, bookmark, popstate) since that's the one path that bypasses the nav bar entirely.
// ══════════════════════════════════════════════════
import { state } from './state.js';
import { switchTab, switchTeamSubTab } from './main.js';
import { switchGanttView } from './gantt-tracker.js';

const ROUTES = [
  { path:'/notes', tab:'notes' },
  { path:'/campaigns', tab:'campaigns' },
  { path:'/graph', tab:'graph' },
  { path:'/team', tab:'team', sub:'notes' },
  { path:'/checklist', tab:'team', sub:'checklists' },
  { path:'/monitor', tab:'team', sub:'monitorlog' },
  { path:'/admin', tab:'admin' },
  { path:'/delivery-tracker', tab:'deliveryTracker' },
  { path:'/tasks', tab:'deliveryTracker', sub:'tasks' },
  { path:'/test-prep', tab:'testprep' },
];

function subStateFor(tab){
  if(tab==='team') return state.currentTeamSubTab;
  if(tab==='deliveryTracker') return state.ganttActiveView;
  return undefined;
}

function resolvePathForState(tab, sub){
  const exact = ROUTES.find(r=>r.tab===tab && r.sub===sub);
  if(exact) return exact.path;
  const tabOnly = ROUTES.find(r=>r.tab===tab && !r.sub);
  if(tabOnly) return tabOnly.path;
  return null;
}

function writeUrl(path, mode){
  if(!path) return;
  if(mode==='push'){
    if(path!==location.pathname) history.pushState(null,'',path);
  } else {
    history.replaceState(null,'',path);
  }
}

export function syncUrlForCurrentState(mode){
  const tab = state.currentTab;
  const sub = subStateFor(tab);
  const path = resolvePathForState(tab, sub);
  writeUrl(path, mode);
}

export function showAccessDenied(){
  const topbarH = document.querySelector('.topbar').getBoundingClientRect().height;
  const subnav = document.querySelector('.team-view.active > .team-subnav');
  const top = topbarH + (subnav ? subnav.getBoundingClientRect().height : 0);
  const el = document.getElementById('routeAccessDeniedScreen');
  el.style.top = top + 'px';
  el.style.display = 'block';
}

export function hideAccessDenied(){
  const el = document.getElementById('routeAccessDeniedScreen');
  el.style.display = 'none';
}

export function applyRoute(pathname){
  if(pathname==='/'){
    switchTab('notes', {syncUrl:'skip'});
    hideAccessDenied();
    return;
  }
  const route = ROUTES.find(r=>r.path===pathname);
  if(!route) return;
  const tabOk = switchTab(route.tab, {syncUrl:'skip'});
  let subOk = true;
  if(tabOk && route.sub){
    if(route.tab==='team') subOk = switchTeamSubTab(route.sub, {syncUrl:'skip'});
    else if(route.tab==='deliveryTracker') subOk = switchGanttView(route.sub, {syncUrl:'skip'});
  }
  if(tabOk && subOk){
    hideAccessDenied();
    writeUrl(pathname, 'replace');
  } else {
    showAccessDenied();
  }
}

export function navigate(path){
  history.pushState(null,'',path);
  applyRoute(path);
}

export function initRouter(){
  applyRoute(location.pathname);
  window.addEventListener('popstate', ()=>applyRoute(location.pathname));
}
