// ══════════════════════════════════════════════════
// MOBILE SHELL — is-native-app (Capacitor Android) only. Bottom-nav shell +
// Notes List / Note Detail / Daily Note screens (Group 1). Note create/edit
// and search reuse the existing note modal (openNoteModal/saveNote) and the
// full-screen search overlay (openSearchScreen) as-is — both are viewport-
// level overlays independent of the desktop .topbar/.main layout, so no
// mobile-specific reimplementation was needed for those two flows.
// ══════════════════════════════════════════════════
import { state } from './state.js';
import {
  getFiltered, myNotes, visibleNotes, fmtDate, renderBodyWithLinks, sqlHL,
  buildLinkIndex, getIncomingLinks, saveOneNote, buildIndex,
  openNoteModal, deleteNote, openSearchScreen
} from './notes.js';
import { today, getTodayNote, openDailyNote } from './daily-note.js';
import { esc } from './ui-helpers.js';
import { isFeatureVisible } from './feature-flags.js';

let mobScreen = 'list';   // 'list' | 'detail' | 'daily'
let mobActiveNoteId = null;

function showMobScreen(name){
  mobScreen = name;
  document.getElementById('mobNotesListScreen').classList.toggle('active', name==='list');
  document.getElementById('mobNoteDetailScreen').classList.toggle('active', name==='detail');
  document.getElementById('mobDailyScreen').classList.toggle('active', name==='daily');
  document.getElementById('mobFabBtn').style.display = name==='list' ? '' : 'none';
  document.getElementById('mobHeader').style.display = name==='list' ? '' : 'none';
}

// ══════════════════════════════════════════════════
// NOTES LIST
// ══════════════════════════════════════════════════
function renderMobFolderChips(){
  const own = myNotes();
  const all = `<button class="mob-folder-chip ${state.activeFolder==='all'?'active':''}" data-folder="all">All <span>${own.length}</span></button>`;
  const chips = state.folders.map(f=>{
    const cnt = own.filter(n=>n.folder===f).length;
    return `<button class="mob-folder-chip ${state.activeFolder===f?'active':''}" data-folder="${esc(f)}">${esc(f)} <span>${cnt}</span></button>`;
  }).join('');
  const el = document.getElementById('mobFolderChips');
  el.innerHTML = all + chips;
  el.querySelectorAll('.mob-folder-chip').forEach(btn=>{
    btn.onclick = () => { state.activeFolder = btn.dataset.folder; renderMobNotesList(); };
  });
}

function renderMobNotesList(){
  renderMobFolderChips();
  const filtered = getFiltered();
  const el = document.getElementById('mobNoteCards');
  if(!filtered.length){ el.innerHTML = '<div class="mob-empty">No notes found</div>'; return; }
  el.innerHTML = filtered.map(n=>{
    const excerpt = (n.body||n.code||'').slice(0,90).replace(/\n/g,' ');
    return `<div class="mob-note-card" data-id="${n.id}">
      <div class="mob-note-card-title">${n.pinned?'📌 ':''}${esc(n.title)}</div>
      <div class="mob-note-card-meta">
        <span class="note-type-badge ${n.type==='code'?'type-code':'type-plain'}">${n.type==='code'?'Code':'Plain'}</span>
        <span class="note-item-folder">${esc(n.folder)}</span>
        <span class="note-item-modified">${fmtDate(n.modified||n.created)}</span>
      </div>
      <div class="mob-note-card-excerpt">${esc(excerpt)}</div>
    </div>`;
  }).join('');
  el.querySelectorAll('.mob-note-card').forEach(card=>{
    card.onclick = () => mobOpenNote(Number(card.dataset.id));
  });
}

// ══════════════════════════════════════════════════
// NOTE DETAIL
// ══════════════════════════════════════════════════
function mobOpenNote(id){
  const note = state.notes.find(n=>n.id===id && !n.deleted);
  if(!note) return;
  mobActiveNoteId = id;
  renderMobNoteDetail(note);
  showMobScreen('detail');
}
function mobJumpToLink(title){
  const n = visibleNotes().find(n=>n.title.toLowerCase()===title.toLowerCase());
  if(n) mobOpenNote(n.id);
}
function renderMobNoteDetail(note){
  const tags = (note.tags||[]).map(t=>`<span class="detail-tag">#${esc(t)}</span>`).join('');
  let body = '';
  if(note.type==='code'||note.type==='sql'){
    body = `<div class="code-block"><div class="code-header"><span class="code-lang">Code</span></div><pre class="code-body">${sqlHL(note.code||'')}</pre></div>`;
    if(note.body) body += `<div class="note-desc">${esc(note.body)}</div>`;
  } else {
    body = `<div class="note-body">${renderBodyWithLinks(note.body||'','')}</div>`;
  }
  buildLinkIndex();
  const links = (note.links||[]).filter(Boolean);
  const outgoingTitles = new Set(links.map(l=>l.trim().toLowerCase()));
  const incoming = getIncomingLinks(note.id).filter(bn=>!outgoingTitles.has(bn.title.trim().toLowerCase()));
  const linkedSection = links.length ? `<div class="linked-section"><div class="linked-label">Linked Notes</div>
    <div class="linked-chips">${links.map(l=>`<span class="linked-chip" data-title="${esc(l)}">↗ ${esc(l)}</span>`).join('')}</div></div>` : '';
  const backSection = incoming.length ? `<div class="linked-section"><div class="linked-label">Backlinks</div>
    <div class="linked-chips">${incoming.map(bn=>`<span class="linked-chip" data-title="${esc(bn.title)}">↙ ${esc(bn.title)}</span>`).join('')}</div></div>` : '';

  const isOwner = note.owner_id === state.currentUserId;
  document.getElementById('mobDetailActions').innerHTML = isOwner
    ? `<button class="mob-icon-btn" id="mobEditNoteBtn" title="Edit">✎</button><button class="mob-icon-btn" id="mobDeleteNoteBtn" title="Delete">✕</button>`
    : '';

  document.getElementById('mobDetailBody').innerHTML = `
    <div class="mob-detail-title">${esc(note.title)}</div>
    <div class="mob-detail-meta">
      <span class="detail-folder-badge">${esc(note.folder)}</span>
      <span class="privacy-badge ${note.is_shared?'is-shared':'is-private'}">${note.is_shared?'🌐 Shared':'🔒 Private'}</span>${tags}
    </div>
    <div class="mob-detail-dates">created ${fmtDate(note.created)}${note.modified&&note.modified!==note.created?' · modified '+fmtDate(note.modified):''}</div>
    ${body}
    ${linkedSection}
    ${backSection}`;

  document.getElementById('mobDetailBody').querySelectorAll('.inline-link, .linked-chip').forEach(el=>{
    el.onclick = () => mobJumpToLink(el.dataset.title);
  });
  if(isOwner){
    document.getElementById('mobEditNoteBtn').onclick = () => openNoteModal(note.id);
    document.getElementById('mobDeleteNoteBtn').onclick = () => {
      if(!confirm(`Delete "${note.title}"? This cannot be undone.`)) return;
      deleteNote(note.id, 'mobNoteDetailScreen');
      showMobScreen('list'); renderMobNotesList();
    };
  }
}

// ══════════════════════════════════════════════════
// DAILY NOTE
// ══════════════════════════════════════════════════
async function mobOpenDailyNote(){
  await openDailyNote();   // get-or-create logic; desktop-DOM side effects are harmless no-ops (hidden)
  const note = getTodayNote();
  if(!note) return;
  renderMobDailyNote(note);
  showMobScreen('daily');
}
function renderMobDailyNote(note){
  document.getElementById('mobDailyBody').innerHTML = `
    <div class="mob-detail-title">${esc(note.title)}</div>
    <div class="note-body">${renderBodyWithLinks(note.body||'','')}</div>`;
  document.getElementById('mobDailyBody').querySelectorAll('.inline-link').forEach(el=>{
    el.onclick = () => mobJumpToLink(el.dataset.title);
  });
}
function mobAppendDailyEntry(){
  const note = getTodayNote(); if(!note) return;
  const input = document.getElementById('mobDailyCaptureInput');
  const val = input.value.trim(); if(!val) return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2,'0'), mm = String(now.getMinutes()).padStart(2,'0');
  note.body = (note.body?note.body+'\n':'') + `[${hh}:${mm}] ${val}`;
  note.modified = today();
  saveOneNote(note); buildIndex();
  input.value = '';
  renderMobDailyNote(note);
}

// ══════════════════════════════════════════════════
// PUBLIC — called from main.js after auth/data load completes, and again
// whenever the shared note-modal overlay closes (see the MutationObserver below).
// ══════════════════════════════════════════════════
export function renderMobileShell(){
  if(!isFeatureVisible('notes')){
    document.getElementById('mobFolderChips').innerHTML = '';
    document.getElementById('mobNoteCards').innerHTML = '<div class="mob-empty">Notes is not enabled for your account.</div>';
    document.getElementById('mobFabBtn').style.display = 'none';
    return;
  }
  renderMobNotesList();
  if(mobScreen==='detail' && mobActiveNoteId!=null){
    const n = state.notes.find(n=>n.id===mobActiveNoteId && !n.deleted);
    if(n) renderMobNoteDetail(n); else showMobScreen('list');
  }
}

// ══════════════════════════════════════════════════
// INIT — DOM wiring, runs once at bootstrap (native-only, see main.js)
// ══════════════════════════════════════════════════
export function initMobileShell(){
  document.getElementById('mobSearchBtn').onclick = () => openSearchScreen();
  document.getElementById('mobDailyBtn').onclick = () => mobOpenDailyNote();
  document.getElementById('mobFabBtn').onclick = () => openNoteModal();
  document.getElementById('mobDetailBackBtn').onclick = () => { showMobScreen('list'); renderMobNotesList(); };
  document.getElementById('mobDailyBackBtn').onclick = () => { showMobScreen('list'); renderMobNotesList(); };
  document.getElementById('mobDailyCaptureInput').addEventListener('keydown', e=>{ if(e.key==='Enter') mobAppendDailyEntry(); });
  document.getElementById('mobDailyCaptureBtn').onclick = () => mobAppendDailyEntry();

  document.querySelectorAll('.mob-nav-item').forEach(btn=>{
    btn.onclick = () => {
      if(btn.classList.contains('disabled')) return;
      // only 'notes' is functional this batch — tapping it just returns to the notes list
      showMobScreen('list'); renderMobNotesList();
    };
  });

  // the shared note modal (openNoteModal/saveNote) writes to state.notes but only re-renders
  // the desktop (hidden) DOM — refresh the mobile list/detail whenever it closes (save or cancel)
  new MutationObserver(()=>{
    if(!document.getElementById('noteModalOverlay').classList.contains('open')) renderMobileShell();
  }).observe(document.getElementById('noteModalOverlay'), {attributes:true, attributeFilter:['class']});
}
