// ══════════════════════════════════════════════════
// MAIN — bootstrap, cross-domain nav router (tab/sub-tab switching), keyboard
// shortcuts, global click-outside handling, export/import, app init + auth gate.
// ══════════════════════════════════════════════════
import { state } from './state.js';
import { loadTheme, closeGearMenu, closeShortcutsModal, initUiHelpers } from './ui-helpers.js';
import { sb, initSupabaseClient, checkAuthAndInit, loadProfilesMap, loadCurrentUserIsAdmin, renderGearUserInfo, closePasswordModal } from './supabase-client.js';
import { loadFolders, closeFolderModal, initFolders } from './folders.js';
import {
  loadNotes, myNotes, buildIndex, renderAll, selectNote, closeNoteModal,
  openSearchScreen, closeSearchScreen, closeNotePopup, closeTagModal, closeInlineLinkDd,
  openNoteModal, renderTeamList, initNotes
} from './notes.js';
import { openDailyNote, initDailyNote } from './daily-note.js';
import {
  loadCampaignsDB, renderCampTable, openAddCampModal, hideInlineCampRow, initCampaigns
} from './campaigns.js';
import { loadChecklistTemplates, renderChecklistTemplates, initChecklistTemplates } from './checklist-templates.js';
import {
  loadChecklistInstances, renderChecklistDetail, initChecklistInstances
} from './checklist-instances.js';
import {
  loadChecklistShares, loadSharedWithMeInstances, loadOrgMembers,
  updateSharedWithMeBadge, renderMyChecklists, renderSharedWithMeList, renderReviewerChecklist, initChecklistShare
} from './checklist-share.js';
import { initMonitorReport } from './monitor-report.js';
import { graphLoadLabelScale, renderGraph, initGraphView } from './graph-view.js';
import { loadFeatureVisibility, isFeatureVisible } from './feature-flags.js';
import { loadFeatureFlags, renderAdminHub, initAdminHub } from './admin-hub.js';
import {
  loadTaskTypes, loadTickets, loadEntries, switchGanttView, initGanttTracker,
  closeTicketModal, closeTaskTypeModal, closeOverlapModal, closeTypePicker, closeCalPopover
} from './gantt-tracker.js';

// ══════════════════════════════════════════════════
// TAB SWITCHING
// ══════════════════════════════════════════════════
// Maps each tab to the feature_key that must resolve 'active' before entry is allowed.
// null means the tab has no single flag (team is gated by teamshared_notes OR checklist;
// admin is gated by role, not a feature flag).
const TAB_FEATURE_KEY = { notes:'notes', campaigns:'campaign', graph:'graph_view', team:null, admin:null, deliveryTracker:'gantt_tracker' };

// Defense-in-depth: blocks entry into a hidden section even if switchTab() is invoked
// directly (console, stale onclick, etc.) rather than through a nav click.
function isTabAllowed(tab){
  if(tab==='admin') return state.currentUserRole==='admin';
  if(tab==='team') return isFeatureVisible('teamshared_notes')||isFeatureVisible('checklist');
  const key=TAB_FEATURE_KEY[tab];
  return !key || isFeatureVisible(key);
}

export function switchTab(tab){
  if(!isTabAllowed(tab)) return;
  state.currentTab = tab;
  document.getElementById('tabNotes').classList.toggle('active', tab==='notes');
  document.getElementById('tabCampaigns').classList.toggle('active', tab==='campaigns');
  document.getElementById('tabGraph').classList.toggle('active', tab==='graph');
  document.getElementById('tabTeam').classList.toggle('active', tab==='team');
  document.getElementById('tabAdmin').classList.toggle('active', tab==='admin');
  document.getElementById('tabGantt').classList.toggle('active', tab==='deliveryTracker');
  document.getElementById('notesView').classList.toggle('hidden', tab!=='notes');
  document.getElementById('campView').classList.toggle('active', tab==='campaigns');
  document.getElementById('graphView').classList.toggle('active', tab==='graph');
  document.getElementById('teamView').classList.toggle('active', tab==='team');
  document.getElementById('adminView').classList.toggle('active', tab==='admin');
  document.getElementById('ganttView').classList.toggle('active', tab==='deliveryTracker');
  if(tab!=='team') document.body.classList.remove('reviewer-lock-active');
  document.getElementById('notesSearchWrap').style.display = tab==='notes'?'':'none';
  document.getElementById('dailyNoteBtn').style.display = (tab==='notes'&&isFeatureVisible('daily_note'))?'':'none';
  const actionBtn = document.getElementById('topbarActionBtn');
  // Regression fix (not a mechanical port): the original used actionBtn.setAttribute('onclick', ...),
  // which relies on the referenced function being a global. Under ES modules that silently no-ops
  // (button does nothing). Assign the handler directly instead.
  if(tab==='notes'){ actionBtn.style.display=''; actionBtn.textContent='+ New Note'; actionBtn.onclick=()=>openNoteModal(); }
  else if(tab==='campaigns'){ actionBtn.style.display=''; actionBtn.textContent='+ Add Campaign'; actionBtn.onclick=openAddCampModal; }
  else{ actionBtn.style.display='none'; }
  if(tab==='campaigns') renderCampTable();
  if(tab==='graph') renderGraph();
  if(tab==='team'){
    // land on whichever Team Shared sub-tab is actually visible — e.g. if teamshared_notes
    // is off but checklist is on, don't default into a hidden "Shared Notes" sub-view
    if(!isFeatureVisible('teamshared_notes')&&state.currentTeamSubTab==='notes') state.currentTeamSubTab='checklists';
    if(!isFeatureVisible('checklist')&&state.currentTeamSubTab==='checklists') state.currentTeamSubTab='notes';
    document.getElementById('teamSubTabNotes').classList.toggle('active',state.currentTeamSubTab==='notes');
    document.getElementById('teamSubTabChecklists').classList.toggle('active',state.currentTeamSubTab==='checklists');
    document.getElementById('teamNotesSubview').classList.toggle('active',state.currentTeamSubTab==='notes');
    document.getElementById('teamChecklistsSubview').classList.toggle('active',state.currentTeamSubTab==='checklists');
    renderTeamList(); renderTeamSubnav();
  }
  if(tab==='admin') renderAdminHub();
  if(tab==='deliveryTracker'){
    document.getElementById('dtManageTypesBtn').style.display=state.currentUserRole==='admin'?'':'none';
    switchGanttView(state.ganttActiveView);
  }
}

// ══════════════════════════════════════════════════
// TEAM SHARED — SUB-NAV (Shared Notes vs Checklists)
// ══════════════════════════════════════════════════
export function switchTeamSubTab(sub){
  if(sub==='checklists'&&!isFeatureVisible('checklist')) return;
  state.currentTeamSubTab=sub;
  document.getElementById('teamSubTabNotes').classList.toggle('active',sub==='notes');
  document.getElementById('teamSubTabChecklists').classList.toggle('active',sub==='checklists');
  document.getElementById('teamNotesSubview').classList.toggle('active',sub==='notes');
  document.getElementById('teamChecklistsSubview').classList.toggle('active',sub==='checklists');
  if(sub==='checklists') renderTeamSubnav();
}
// Renders the admin-only inner pill toggle (Templates | My Checklists) and
// makes sure non-admins land directly on My Checklists with no toggle shown.
// The nav itself is now shown for everyone (Shared with me is not admin-only) —
// only the Templates pill inside it stays admin-gated.
function renderTeamSubnav(){
  document.getElementById('checklistInnerNav').style.display='';
  document.getElementById('checklistTabTemplates').style.display=state.currentUserIsAdmin?'':'none';
  if(!state.currentUserIsAdmin&&state.currentChecklistView==='templates') state.currentChecklistView='mine';
  updateSharedWithMeBadge();
  showChecklistPage(state.currentChecklistView);
}
export function switchChecklistSubView(view){
  if(!isFeatureVisible('checklist')) return;
  if(view==='templates'&&!state.currentUserIsAdmin) view='mine';
  state.currentChecklistView=view;
  document.getElementById('checklistTabTemplates').classList.toggle('active',view==='templates');
  document.getElementById('checklistTabMine').classList.toggle('active',view==='mine');
  document.getElementById('checklistTabShared').classList.toggle('active',view==='shared');
  showChecklistPage(view);
}
function showChecklistPage(view){
  document.body.classList.toggle('reviewer-lock-active',view==='reviewer');
  document.getElementById('checklistTemplatesView').classList.toggle('active',view==='templates');
  document.getElementById('checklistMineView').classList.toggle('active',view==='mine');
  document.getElementById('checklistDetailView').classList.toggle('active',view==='detail');
  document.getElementById('checklistSharedView').classList.toggle('active',view==='shared');
  document.getElementById('checklistReviewerView').classList.toggle('active',view==='reviewer');
  if(view==='templates') renderChecklistTemplates();
  if(view==='mine') renderMyChecklists();
  if(view==='detail') renderChecklistDetail();
  if(view==='shared') renderSharedWithMeList();
  if(view==='reviewer') renderReviewerChecklist();
}
export function backToMyChecklists(){
  state.activeChecklistInstanceId=null;
  switchChecklistSubView('mine');
}
export function backToSharedWithMe(){
  state.activeReviewShareId=null;
  switchChecklistSubView('shared');
}

// ══════════════════════════════════════════════════
// EXPORT / IMPORT
// ══════════════════════════════════════════════════
export function openExportModal(){
  document.getElementById('export-notes-check').checked=true;
  document.getElementById('export-campaigns-check').checked=true;
  document.getElementById('export-checklists-check').checked=true;
  updateExportButtonState();
  document.getElementById('exportOverlay').classList.add('open');
}
export function closeExportModal(){document.getElementById('exportOverlay').classList.remove('open');}
export function updateExportButtonState(){
  const anyChecked=document.getElementById('export-notes-check').checked
    ||document.getElementById('export-campaigns-check').checked
    ||document.getElementById('export-checklists-check').checked;
  document.getElementById('exportConfirmBtn').disabled=!anyChecked;
}
export function doExport(){
  const includeNotes=document.getElementById('export-notes-check').checked;
  const includeCampaigns=document.getElementById('export-campaigns-check').checked;
  const includeChecklists=document.getElementById('export-checklists-check').checked;
  if(!includeNotes&&!includeCampaigns&&!includeChecklists) return;

  const exportedNotes=includeNotes?myNotes():[];
  // deliberately excludes checklist templates — admin-managed org-wide config, not personal export data
  const payload={
    version:2,
    exported:new Date().toISOString(),
    folders:includeNotes?[...new Set(exportedNotes.map(n=>n.folder))]:[],
    notes:exportedNotes,
    campaigns:includeCampaigns?state.campaigns:[]
  };
  if(includeChecklists) payload.checklistInstances=state.checklistInstances;

  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`basebi-export-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  closeExportModal();
}
export function openImportModal(){document.getElementById('importOverlay').classList.add('open');}
export function closeImportModal(){document.getElementById('importOverlay').classList.remove('open');}
export function openImportPicker(){closeImportModal();document.getElementById('importFilePicker').click();}

const REQUIRED_NOTE_FIELDS=['title','folder','type','tags','links','body','code','created','modified'];
function validateImportData(data){
  if(!data||typeof data!=='object') throw new Error('Invalid file: not a valid JSON object.');
  if(typeof data.version!=='number') throw new Error("Missing or invalid 'version' field.");
  if(!Array.isArray(data.folders)) throw new Error("Missing or invalid 'folders' array.");
  if(!Array.isArray(data.notes)) throw new Error("Missing or invalid 'notes' array.");
  if(data.campaigns!==undefined&&!Array.isArray(data.campaigns)) throw new Error("'campaigns' must be an array.");
  data.notes.forEach((n,i)=>{
    REQUIRED_NOTE_FIELDS.forEach(f=>{
      if(n[f]===undefined) throw new Error(`Missing '${f}' field on note at index ${i}.`);
    });
    if(!Array.isArray(n.tags)) throw new Error(`'tags' must be an array on note at index ${i}.`);
    if(!Array.isArray(n.links)) throw new Error(`'links' must be an array on note at index ${i}.`);
    // data-migration shim, preserved: legacy 'sql' note type renamed to 'code'
    if(n.type==='sql') n.type='code';
  });
}

export async function handleImport(e){
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=async ev=>{
    try{
      const data=JSON.parse(ev.target.result);
      validateImportData(data);

      const newFolderNames=data.folders.filter(name=>!state.folders.includes(name));
      const importCampaigns=data.campaigns||[];
      if(!confirm(`Import ${data.notes.length} note(s), ${newFolderNames.length} new folder(s), and ${importCampaigns.length} campaign(s)?\n\nExisting data will not be deleted or overwritten.`))return;

      // show loading screen
      const ls=document.getElementById('loadingScreen');
      const lm=document.getElementById('loadingMsg');
      const lb=document.getElementById('loadingBar');
      if(ls) ls.style.display='flex';
      if(lm) lm.textContent='Importing notes to Supabase…';
      if(lb) lb.style.width='20%';

      // insert notes with freshly generated ids — never reuse ids from the file,
      // so an id that collides with an existing note can't silently overwrite it
      let noteIdSeq=Date.now();
      const newNotes=data.notes.map(n=>({
        id:noteIdSeq++,title:n.title,folder:n.folder,type:n.type,
        tags:n.tags,links:n.links,body:n.body,
        code:n.code,pinned:false,
        created:n.created,modified:n.modified,owner_id:state.currentUserId
      }));
      const NOTE_BATCH=50;
      for(let i=0;i<newNotes.length;i+=NOTE_BATCH){
        const batch=newNotes.slice(i,i+NOTE_BATCH);
        const{error}=await sb.from('notes').insert(batch);
        if(error) throw new Error('Notes import failed: '+error.message);
        if(lb) lb.style.width=Math.round(20+(i/Math.max(newNotes.length,1))*40)+'%';
      }

      if(lm) lm.textContent='Importing folders…';
      if(lb) lb.style.width='65%';

      // insert only genuinely new folder names — never touch existing folder rows
      if(newFolderNames.length){
        const fRows=newFolderNames.map((name,i)=>({name,sort_order:state.folders.length+i}));
        const{error:fErr}=await sb.from('folders').insert(fRows);
        if(fErr) throw new Error('Folders import failed: '+fErr.message);
      }
      if(lb) lb.style.width='75%';

      // insert campaigns with freshly generated ids
      if(lm) lm.textContent='Importing campaigns…';
      let campIdSeq=Date.now();
      const newCampaigns=importCampaigns.map(cc=>({
        id:campIdSeq++,campaign_cd:cc.campaign_cd,campaign_nm:cc.campaign_nm,
        event_name:cc.event_name||null,type:cc.type,trigger_type:cc.trigger_type,
        status:cc.status,date:cc.date||null,note:cc.note||null,
        extra:cc.extra||{},created:cc.created,modified:cc.modified
      }));
      const CAMP_BATCH=50;
      for(let i=0;i<newCampaigns.length;i+=CAMP_BATCH){
        const batch=newCampaigns.slice(i,i+CAMP_BATCH);
        const{error}=await sb.from('campaigns').insert(batch);
        if(error) throw new Error('Campaigns import failed: '+error.message);
        if(lb) lb.style.width=Math.round(75+(i/Math.max(newCampaigns.length,1))*20)+'%';
      }

      if(lm) lm.textContent='Refreshing workspace…';
      if(lb) lb.style.width='95%';
      state.notes=await loadNotes();
      state.folders=await loadFolders();
      state.campaigns=await loadCampaignsDB();

      if(lm) lm.textContent='Done! ✓';
      if(lb) lb.style.width='100%';
      await new Promise(r=>setTimeout(r,500));
      if(ls) ls.style.display='none';

      buildIndex();
      state.activeFolder='all';state.activeTag=null;state.activeNoteId=null;state.activeCampId=null;renderAll();
      if(state.notes.length)selectNote(state.notes[0].id);
      if(state.currentTab==='campaigns')renderCampTable();
    }catch(err){
      console.error('Import error:', err);
      const ls2=document.getElementById('loadingScreen');
      const lm2=document.getElementById('loadingMsg');
      if(ls2&&ls2.style.display==='flex'&&lm2){ lm2.textContent='Import failed: '+err.message; lm2.style.color='#f87171'; }
      else { alert('Import failed: '+err.message); }
    }
  };
  reader.readAsText(file);e.target.value='';
}

// ══════════════════════════════════════════════════
// KEYBOARD + GLOBAL CLICK
// ══════════════════════════════════════════════════
function bindGlobalListeners(){
  document.addEventListener('keydown',e=>{
    // Ctrl+Shift+F — toggle search screen
    // Ctrl+Alt+C — campaigns tab (was Ctrl+Shift+C, reserved by browser DevTools inspect)
    if((e.ctrlKey||e.metaKey)&&e.altKey&&e.key.toLowerCase()==='c'){e.preventDefault();switchTab('campaigns');return;}
    // Ctrl+Alt+N — notes tab (was Ctrl+Shift+N, reserved by browser Incognito window)
    if((e.ctrlKey||e.metaKey)&&e.altKey&&e.key.toLowerCase()==='n'){e.preventDefault();switchTab('notes');return;}
    // Ctrl+Alt+D — today's daily note
    if((e.ctrlKey||e.metaKey)&&e.altKey&&e.key.toLowerCase()==='d'){e.preventDefault();openDailyNote();return;}
    // Ctrl+Alt+G — graph tab
    if((e.ctrlKey||e.metaKey)&&e.altKey&&e.key.toLowerCase()==='g'){e.preventDefault();switchTab('graph');return;}
    // Ctrl+Alt+T — team shared tab
    if((e.ctrlKey||e.metaKey)&&e.altKey&&e.key.toLowerCase()==='t'){e.preventDefault();switchTab('team');return;}
    if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key==='F'){
      e.preventDefault();
      if(state.searchScreenOpen)closeSearchScreen();else openSearchScreen();
      return;
    }
    // Ctrl+K — focus main search bar (only when not in search screen)
    if((e.ctrlKey||e.metaKey)&&e.key==='k'&&!state.searchScreenOpen){
      e.preventDefault();document.getElementById('searchInput').focus();document.getElementById('searchInput').select();return;
    }
    // Escape
    if(e.key==='Escape'){
      if(document.getElementById('notePopupOverlay').classList.contains('open')){closeNotePopup();return;}
      if(state.searchScreenOpen){closeSearchScreen();return;}
      closeNoteModal();closeFolderModal();closeTagModal();closeExportModal();closePasswordModal();hideInlineCampRow();closeShortcutsModal();closeGearMenu();closeInlineLinkDd();
      closeTicketModal();closeTaskTypeModal();closeOverlapModal();closeTypePicker();closeCalPopover();
      document.getElementById('tagDropdown').classList.remove('open');
      document.getElementById('linkDropdown').classList.remove('open');
    }
  });
  document.addEventListener('click',e=>{
    if(!e.target.closest('.gear-wrap')) closeGearMenu();
    if(!document.getElementById('tagSelectorWrap').contains(e.target))document.getElementById('tagDropdown').classList.remove('open');
    if(!document.getElementById('linkSelectorWrap').contains(e.target))document.getElementById('linkDropdown').classList.remove('open');
  });
}

// ══════════════════════════════════════════════════
// INIT — async, loads from Supabase
// ══════════════════════════════════════════════════
async function initApp(){
  document.getElementById('loginGate').style.display='none';
  document.getElementById('connectGate').style.display='flex';
  const bar = document.getElementById('loadingBar');
  const msg = document.getElementById('loadingMsg');
  try{
    loadTheme();
    graphLoadLabelScale();
    msg.textContent='Loading notes…'; bar.style.width='25%';
    state.notes = await loadNotes();
    // data-migration shim, preserved: legacy 'sql' note type renamed to 'code'
    state.notes.forEach(n=>{if(n.type==='sql')n.type='code';});

    msg.textContent='Loading folders…'; bar.style.width='50%';
    state.folders = await loadFolders();

    msg.textContent='Loading team…'; bar.style.width='70%';
    state.profilesMap = await loadProfilesMap();
    // loadCurrentUserIsAdmin() sets state.currentUserOrgId/currentUserRole/currentUserIsQaSeat
    // as side effects, which loadFeatureVisibility() and loadOrgMembers() below depend on —
    // this sequencing must stay non-parallel.
    state.currentUserIsAdmin = await loadCurrentUserIsAdmin();
    renderGearUserInfo();

    msg.textContent='Resolving feature access…'; bar.style.width='80%';
    await loadFeatureVisibility();

    msg.textContent='Loading campaigns…'; bar.style.width='90%';
    if(isFeatureVisible('campaign')){ state.campaigns = await loadCampaignsDB(); initCampaigns(); }

    msg.textContent='Loading checklists…'; bar.style.width='95%';
    if(isFeatureVisible('checklist')){
      state.checklistTemplates = await loadChecklistTemplates();
      state.checklistInstances = await loadChecklistInstances();
      state.checklistShares = await loadChecklistShares();
      state.sharedWithMeInstances = await loadSharedWithMeInstances(
        state.checklistShares.filter(s=>s.shared_with===state.currentUserId).map(s=>s.instance_id)
      );
      initChecklistTemplates(); initChecklistInstances(); initChecklistShare();
    }
    state.orgMembers = await loadOrgMembers();

    if(isFeatureVisible('notes')) initNotes();
    if(isFeatureVisible('graph_view')) initGraphView();
    if(isFeatureVisible('monitor_log')) initMonitorReport();
    if(state.currentUserRole==='admin') state.featureFlags = await loadFeatureFlags();

    if(isFeatureVisible('gantt_tracker')){
      state.ganttTaskTypes = await loadTaskTypes();
      state.ganttTickets = await loadTickets();
      state.ganttEntries = await loadEntries();
      initGanttTracker();
    }

    applyNavGating();
    startFeatureVisibilityPolling();

    msg.textContent='Ready!'; bar.style.width='100%';
    await new Promise(r=>setTimeout(r,300));
    document.getElementById('loadingScreen').style.display='none';

    buildIndex(); renderAll();
  } catch(err){
    msg.textContent='Connection failed — check your Supabase URL and key.';
    msg.style.color='#f87171';
    console.error('base·bi init error:', err);
  }
}

// ══════════════════════════════════════════════════
// NAV GATING — hides topbar/nav elements the current user has no visibility into, and
// lands on the first tab that's actually allowed (in case 'notes' itself is hidden).
// Runs once feature visibility + role are known (end of initApp()).
// ══════════════════════════════════════════════════
function applyNavGating(){
  document.getElementById('tabNotes').style.display = isFeatureVisible('notes')?'':'none';
  document.getElementById('tabCampaigns').style.display = isFeatureVisible('campaign')?'':'none';
  document.getElementById('tabGraph').style.display = isFeatureVisible('graph_view')?'':'none';
  document.getElementById('tabTeam').style.display = (isFeatureVisible('teamshared_notes')||isFeatureVisible('checklist'))?'':'none';
  document.getElementById('teamSubTabNotes').style.display = isFeatureVisible('teamshared_notes')?'':'none';
  document.getElementById('teamSubTabChecklists').style.display = isFeatureVisible('checklist')?'':'none';
  document.getElementById('tabAdmin').style.display = state.currentUserRole==='admin'?'':'none';
  document.getElementById('tabGantt').style.display = isFeatureVisible('gantt_tracker')?'':'none';
  document.getElementById('dtManageTypesBtn').style.display = state.currentUserRole==='admin'?'':'none';
  // dailyNoteBtn is otherwise only gated inside switchTab(), which never runs at bootstrap
  // unless the current tab is disallowed (see fallback below) — without this line the button
  // is left in its raw, visible-by-default HTML state until the user's first tab switch.
  document.getElementById('dailyNoteBtn').style.display = (state.currentTab==='notes' && isFeatureVisible('daily_note')) ? '' : 'none';

  if(!isTabAllowed(state.currentTab)){
    const fallback=['notes','campaigns','graph','team','admin','deliveryTracker'].find(isTabAllowed);
    if(fallback) switchTab(fallback);
  }
}

// ══════════════════════════════════════════════════
// FEATURE VISIBILITY POLLING — get_feature_visibility() is resolved once at bootstrap and
// cached in state.featureVisibility (see feature-flags.js) so nav render / switchTab() don't
// hit the RPC on every check. But that means an admin's live change (flip a flag, remove a
// tester) never reaches an already-open session — the tester keeps "active" until they log
// out and back in. Re-fetching on every render would reintroduce a query-per-click; instead
// we poll on a bounded interval so a revoked tester loses access within a short, predictable
// window without needing to log out. 30s is a deliberate tradeoff: frequent enough that "the
// admin just removed me" resolves quickly, infrequent enough it's not a query storm.
let featureVisibilityPollTimer=null;
function startFeatureVisibilityPolling(){
  if(featureVisibilityPollTimer) return; // idempotent guard — initApp() must not stack intervals
  featureVisibilityPollTimer=setInterval(async()=>{
    await loadFeatureVisibility();
    applyNavGating();
  },30000);
}

function initMain(){
  window.switchTab=switchTab;
  window.switchTeamSubTab=switchTeamSubTab;
  window.switchChecklistSubView=switchChecklistSubView;
  window.backToMyChecklists=backToMyChecklists;
  window.backToSharedWithMe=backToSharedWithMe;
  window.openExportModal=openExportModal;
  window.closeExportModal=closeExportModal;
  window.updateExportButtonState=updateExportButtonState;
  window.doExport=doExport;
  window.openImportModal=openImportModal;
  window.closeImportModal=closeImportModal;
  window.openImportPicker=openImportPicker;
  window.handleImport=handleImport;

  document.getElementById('tabNotes').onclick=()=>switchTab('notes');
  document.getElementById('tabCampaigns').onclick=()=>switchTab('campaigns');
  document.getElementById('tabGraph').onclick=()=>switchTab('graph');
  document.getElementById('tabTeam').onclick=()=>switchTab('team');
  document.getElementById('tabAdmin').onclick=()=>switchTab('admin');
  document.getElementById('tabGantt').onclick=()=>switchTab('deliveryTracker');
  // Wired here unconditionally (not just inside switchTab()) so #topbarActionBtn's initial-state
  // handler doesn't depend on window.openNoteModal (exposed elsewhere only for notes.js's
  // dynamically-rendered Edit-button template strings, not for this element).
  document.getElementById('topbarActionBtn').onclick=()=>openNoteModal();
  document.getElementById('teamSubTabNotes').onclick=()=>switchTeamSubTab('notes');
  document.getElementById('teamSubTabChecklists').onclick=()=>switchTeamSubTab('checklists');
  document.getElementById('checklistTabTemplates').onclick=()=>switchChecklistSubView('templates');
  document.getElementById('checklistTabMine').onclick=()=>switchChecklistSubView('mine');
  document.getElementById('checklistTabShared').onclick=()=>switchChecklistSubView('shared');
  document.querySelector('#checklistDetailView .btn-ghost').onclick=backToMyChecklists;
  document.querySelector('#checklistReviewerView .btn-ghost').onclick=backToSharedWithMe;

  document.getElementById('gearImportItem').onclick=()=>{openImportModal();closeGearMenu();};
  document.getElementById('gearExportItem').onclick=()=>{openExportModal();closeGearMenu();};
  document.getElementById('importFilePicker').onchange=handleImport;

  document.querySelector('#importOverlay .modal-close').onclick=closeImportModal;
  const importActions=document.querySelectorAll('#importOverlay .modal-actions .btn');
  importActions[0].onclick=closeImportModal;
  importActions[1].onclick=openImportPicker;

  document.querySelector('#exportOverlay .modal-close').onclick=closeExportModal;
  ['export-notes-check','export-campaigns-check','export-checklists-check'].forEach(id=>{
    document.getElementById(id).onchange=updateExportButtonState;
  });
  const exportActions=document.querySelectorAll('#exportOverlay .modal-actions .btn');
  exportActions[0].onclick=closeExportModal;
  exportActions[1].onclick=doExport;

  bindGlobalListeners();
}

// Feature-gated init*() calls (initNotes, initCampaigns, initChecklistTemplates,
// initChecklistInstances, initChecklistShare, initMonitorReport, initGraphView) moved into
// initApp() — they must run only after loadFeatureVisibility() resolves, which itself
// depends on state.currentUserId being set by auth. Wiring calls with no feature gate
// (folders, daily note, nav shell, admin hub globals) still run unconditionally at bootstrap.
initUiHelpers();
initSupabaseClient(initApp);
initFolders();
initDailyNote();
initAdminHub();
initMain();
checkAuthAndInit();
