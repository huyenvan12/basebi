// ══════════════════════════════════════════════════
// UI HELPERS — generic escaping, author lookup, resizable/collapsible panes,
// gear menu, theme toggle, keyboard-shortcuts modal. No domain data.
// ══════════════════════════════════════════════════
import { LS_THEME } from './constants.js';
import { state } from './state.js';

export function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
export function escJs(s){ return String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
export function authorName(ownerId){ return state.profilesMap[ownerId]||'Unknown'; }

// ══════════════════════════════════════════════════
// TOAST NOTIFICATION — #notificationBanner (basebi.css .notification-banner).
// One visible at a time: a new call replaces whatever's showing and resets the timer.
// ══════════════════════════════════════════════════
let notificationTimer=null;
export function showNotification(msg,type='error'){
  const el=document.getElementById('notificationBanner');
  if(!el) return;
  clearTimeout(notificationTimer);
  el.textContent=msg;
  el.className='notification-banner open is-'+type;
  notificationTimer=setTimeout(()=>{ el.classList.remove('open'); },4000);
}

// ══════════════════════════════════════════════════
// GEAR MENU
// ══════════════════════════════════════════════════
export function toggleGearMenu(){
  document.getElementById('gearMenu').classList.toggle('open');
}
export function closeGearMenu(){
  document.getElementById('gearMenu').classList.remove('open');
}
export function toggleAdminGearMenu(){
  document.getElementById('adminGearMenu').classList.toggle('open');
}
export function closeAdminGearMenu(){
  document.getElementById('adminGearMenu').classList.remove('open');
}

// ══════════════════════════════════════════════════
// MOBILE-WEB NAV DRAWER (<=768px browser viewports — see basebi.css @media block)
// ══════════════════════════════════════════════════
export function openMobDrawer(){
  document.getElementById('mobDrawer').classList.add('open');
  document.getElementById('mobDrawerScrim').classList.add('open');
}
export function closeMobDrawer(){
  document.getElementById('mobDrawer').classList.remove('open');
  document.getElementById('mobDrawerScrim').classList.remove('open');
}

// ══════════════════════════════════════════════════
// SHARED APP-WIDE CONFIRM MODAL — #confirmModalOverlay (index.html). Single overlay reused by
// every caller; each call rewires the Confirm button's onclick, so callers don't collide.
// Intended pattern for future modules — Delivery Tracker's #dtConfirmModalOverlay predates this
// and is intentionally left as its own separate instance (js/gantt-tracker.js).
// ══════════════════════════════════════════════════
let confirmModalOnCancel=null;
export function showConfirmModal(message,onConfirm,opts={}){
  const overlay=document.getElementById('confirmModalOverlay');
  if(!overlay) return;
  document.getElementById('confirmModalTitle').textContent=opts.title||'Confirm';
  document.getElementById('confirmModalMessage').textContent=message;
  const btn=document.getElementById('confirmModalConfirmBtn');
  btn.textContent=opts.confirmLabel||'Confirm';
  btn.className='btn '+(opts.danger===false?'btn-primary':'btn-danger');
  confirmModalOnCancel=opts.onCancel||null;
  overlay.classList.add('open');
  btn.onclick=async(event)=>{
    if(event) event.stopPropagation();
    overlay.classList.remove('open');
    confirmModalOnCancel=null;
    await onConfirm();
  };
}
export function hideConfirmModal(){
  const overlay=document.getElementById('confirmModalOverlay');
  if(overlay) overlay.classList.remove('open');
  const onCancel=confirmModalOnCancel;
  confirmModalOnCancel=null;
  if(onCancel) onCancel();
}

// ══════════════════════════════════════════════════
// SHARED INLINE CONFIRM — .confirm-box (basebi.css), non-destructive/lightweight tier.
// Builds a toggleable confirm box anchored near the triggering element (opts.container
// is a closest()-selector for where it should append; defaults to the anchor's parent).
// For destructive confirms use showConfirmModal above instead.
// ══════════════════════════════════════════════════
export function showInlineConfirm(anchorEl,message,onConfirm,opts={}){
  const container=opts.container?anchorEl.closest(opts.container):anchorEl.parentElement;
  if(!container) return;
  const existing=container.querySelector('.confirm-box');
  if(existing){existing.remove();return;}
  const box=document.createElement('div');box.className='confirm-box';
  box.innerHTML=`<p>${message}</p>
    <div class="confirm-actions">
      <button class="btn btn-ghost" style="font-size:11px">${opts.cancelLabel||'Cancel'}</button>
      <button class="btn btn-danger" style="font-size:11px">${opts.confirmLabel||'Yes'}</button>
    </div>`;
  box.querySelector('.btn-ghost').onclick=()=>box.remove();
  box.querySelector('.btn-danger').onclick=async()=>{ box.remove(); await onConfirm(); };
  container.appendChild(box);
}

// ══════════════════════════════════════════════════
// SHORTCUTS MODAL
// ══════════════════════════════════════════════════
export function openShortcutsModal(){ document.getElementById('shortcutsOverlay').classList.add('open'); }
export function closeShortcutsModal(){ document.getElementById('shortcutsOverlay').classList.remove('open'); }

// ══════════════════════════════════════════════════
// THEME TOGGLE
// ══════════════════════════════════════════════════
export function loadTheme(){
  const saved = localStorage.getItem(LS_THEME) || 'dark';
  applyTheme(saved, false);
}
export function applyTheme(theme, save=true){
  document.body.setAttribute('data-theme', theme);
  if(save) localStorage.setItem(LS_THEME, theme);
  const item = document.getElementById('themeToggleItem');
  if(item){
    item.textContent = theme==='dark' ? '☀  Switch to Light' : '🌙  Switch to Dark';
  }
}
export function toggleTheme(){
  const current = document.body.getAttribute('data-theme') || 'dark';
  applyTheme(current==='dark' ? 'light' : 'dark');
}

// ══════════════════════════════════════════════════
// RESIZABLE PANES (sidebar / note list)
// ══════════════════════════════════════════════════
let resizing=null,resizeStartX=0,resizeStartW=0;
let sidebarCollapsed=false, noteListCollapsed=false;
let sidebarSavedW=215, noteListSavedW=260;

function startResize(e,which){
  if((which==='A'&&sidebarCollapsed)||(which==='B'&&noteListCollapsed)){
    e.preventDefault();
    togglePane(which);
    return;
  }
  resizing=which; resizeStartX=e.clientX;
  // A resizes sidebar, B resizes noteListPane
  const pane=which==='A'?document.getElementById('sidebar'):document.getElementById('noteListPane');
  resizeStartW=pane.offsetWidth;
  document.getElementById('resizer'+which).classList.add('dragging');
  document.body.style.cursor='col-resize';
  document.body.style.userSelect='none';
  e.preventDefault();
}

export function togglePane(which){
  if(which==='A'){
    const pane=document.getElementById('sidebar');
    const resizer=document.getElementById('resizerA');
    const btn=document.getElementById('collapseA');
    sidebarCollapsed=!sidebarCollapsed;
    if(sidebarCollapsed){
      sidebarSavedW=pane.offsetWidth||215;
      pane.classList.add('collapsed');
      resizer.classList.add('pane-collapsed');
      btn.textContent='›'; btn.classList.add('collapsed');
      btn.title='Expand sidebar';
    }else{
      pane.classList.remove('collapsed');
      pane.style.width=sidebarSavedW+'px';
      resizer.classList.remove('pane-collapsed');
      btn.textContent='‹'; btn.classList.remove('collapsed');
      btn.title='Collapse sidebar';
    }
  } else {
    const pane=document.getElementById('noteListPane');
    const resizer=document.getElementById('resizerB');
    const btn=document.getElementById('collapseB');
    noteListCollapsed=!noteListCollapsed;
    if(noteListCollapsed){
      noteListSavedW=pane.offsetWidth||260;
      pane.classList.add('collapsed');
      resizer.classList.add('pane-collapsed');
      btn.textContent='›'; btn.classList.add('collapsed');
      btn.title='Expand note list';
    }else{
      pane.classList.remove('collapsed');
      pane.style.width=noteListSavedW+'px';
      resizer.classList.remove('pane-collapsed');
      btn.textContent='‹'; btn.classList.remove('collapsed');
      btn.title='Collapse note list';
    }
  }
}

export function initUiHelpers(){
  document.getElementById('collapseA').onclick=()=>togglePane('A');
  document.getElementById('collapseB').onclick=()=>togglePane('B');
  document.getElementById('resizerA').addEventListener('mousedown',e=>startResize(e,'A'));
  document.getElementById('resizerB').addEventListener('mousedown',e=>startResize(e,'B'));
  document.addEventListener('mousemove',e=>{
    if(!resizing)return;
    const delta=e.clientX-resizeStartX;
    const pane=resizing==='A'?document.getElementById('sidebar'):document.getElementById('noteListPane');
    const mn=resizing==='A'?140:160, mx=resizing==='A'?340:420;
    const newW=Math.min(mx,Math.max(mn,resizeStartW+delta));
    pane.style.width=newW+'px';
    pane.style.flex='none'; // prevent flex from overriding
  });
  document.addEventListener('mouseup',()=>{
    if(!resizing)return;
    document.getElementById('resizer'+resizing).classList.remove('dragging');
    document.body.style.cursor=''; document.body.style.userSelect=''; resizing=null;
  });

  document.getElementById('confirmModalCloseBtn').onclick=hideConfirmModal;
  document.getElementById('confirmModalCancelBtn').onclick=hideConfirmModal;

  document.querySelector('.gear-btn[title="Options"]').onclick=toggleGearMenu;
  document.getElementById('themeToggleItem').onclick=()=>{toggleTheme();closeGearMenu();};
  document.getElementById('gearShortcutsItem').onclick=()=>{openShortcutsModal();closeGearMenu();};
  document.querySelector('#shortcutsOverlay .modal-close').onclick=closeShortcutsModal;
}
