// ══════════════════════════════════════════════════
// DAILY NOTE — get-or-create today's journal note, timestamped capture entries.
// today() is the previously-fixed ICT/UTC+7 bug: MUST stay local-date-based
// (getFullYear/getMonth/getDate), never toISOString()/UTC. Do not regress this.
// ══════════════════════════════════════════════════
import { state } from './state.js';
import { saveOneNote, buildIndex, renderAll, selectNote, renderDetail, focusDailyCapture } from './notes.js';
import { ensureFolder } from './folders.js';
// Narrow, intentional circular import: main.js is the cross-domain nav router (switchTab)
// per the plan, and main.js imports this module's initDailyNote() for wiring. Safe because
// switchTab is only called inside openDailyNote()'s function body, never at module top-level.
import { switchTab } from './main.js';
import { isFeatureVisible } from './feature-flags.js';
import { genLineId } from './tasks.js';

export function today(){
  const d=new Date();
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

export function getTodayNote(){
  const t=today();
  // daily notes are personal — must be scoped to the current user, otherwise this could
  // match a teammate's daily note for the same date (if it happens to sort first) and
  // open their private journal entry instead of creating/opening your own.
  return state.notes.find(n=>n.daily_date===t&&n.owner_id===state.currentUserId&&!n.deleted)||null;
}
export function fmtDailyTitle(iso){
  const d=new Date(iso+'T00:00:00');
  return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
}
export async function openDailyNote(){
  if(!isFeatureVisible('daily_note')) return;
  if(state.currentTab!=='notes')switchTab('notes');
  const existing=getTodayNote();
  if(existing){selectNote(existing.id);return;}
  const dailyFolderId=await ensureFolder('Daily');
  const t=today();
  const note={id:Date.now(),title:fmtDailyTitle(t),folder:'Daily',folder_id:dailyFolderId,type:'plain',
    tags:[],links:[],body:'',code:null,daily_date:t,owner_id:state.currentUserId,
    created:t,modified:t};
  state.notes.unshift(note);
  saveOneNote(note);buildIndex();renderAll();selectNote(note.id);
}
export function appendDailyEntry(id){
  const note=state.notes.find(n=>n.id===id); if(!note)return;
  const input=document.getElementById('dailyCaptureInput');
  const val=input.value.trim(); if(!val)return;
  const now=new Date();
  const hh=String(now.getHours()).padStart(2,'0'), mm=String(now.getMinutes()).padStart(2,'0');
  note.body=(note.body?note.body+'\n':'')+`[${hh}:${mm}] ${val} ^${genLineId()}`;
  note.modified=today();
  saveOneNote(note);buildIndex();renderDetail(note);focusDailyCapture();renderAll();
}

export function initDailyNote(){
  window.openDailyNote=openDailyNote;
  window.appendDailyEntry=appendDailyEntry;

  document.getElementById('dailyNoteBtn').onclick=openDailyNote;
}
