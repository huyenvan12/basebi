// ══════════════════════════════════════════════════
// DELIVERY TRACKER — private, self-tracked day-by-day ticket scheduler.
// Two views over the same data: Timeline (sticky-column day grid, drag-to-fill scheduling)
// and Calendar (month grid, lane-stacked ticket bars). Replaces the old Excel Gantt sheet.
// Ticket color is a deterministic client-side hash of the ticket id — never stored in DB.
// ══════════════════════════════════════════════════
import { state } from './state.js';
import { esc, escJs } from './ui-helpers.js';
import { sb } from './supabase-client.js';
import { today } from './daily-note.js';
// Narrow, intentional circular import (same pattern as daily-note.js -> main.js): switchTab
// is only invoked inside jumpToTimeline()'s function body, never at module top-level.
import { switchTab } from './main.js';

const INACTIVE_STATUSES = ['Done','Cancelled'];

// ══════════════════════════════════════════════════
// DATA LAYER — no id/owner_id/created_by/org_id ever set from client; DB defaults + RLS handle it.
// ══════════════════════════════════════════════════
export async function loadTaskTypes(){
  const{data,error}=await sb.from('gantt_task_types').select('*').order('sort_order',{ascending:true});
  if(error){console.error('loadTaskTypes failed',error);return [];}
  return data||[];
}
export async function loadTickets(){
  const{data,error}=await sb.from('gantt_tickets').select('*').order('sort_order',{ascending:true});
  if(error){console.error('loadTickets failed',error);return [];}
  return data||[];
}
export async function loadEntries(){
  const{data,error}=await sb.from('gantt_entries').select('*');
  if(error){console.error('loadEntries failed',error);return [];}
  return data||[];
}
export async function insertTicketDB(fields){
  const{data,error}=await sb.from('gantt_tickets').insert(fields).select().single();
  if(error) throw error;
  return data;
}
export async function updateTicketDB(id,fields){
  const{error}=await sb.from('gantt_tickets').update(fields).eq('id',id);
  if(error) throw error;
}
export async function deleteTicketDB(id){
  const{error}=await sb.from('gantt_tickets').delete().eq('id',id);
  if(error) throw error;
}
export async function insertEntryDB(ticketId,taskTypeId,startDate,endDate){
  const{data,error}=await sb.from('gantt_entries').insert({ticket_id:ticketId,task_type_id:taskTypeId,start_date:startDate,end_date:endDate}).select().single();
  if(error) throw error;
  return data;
}
export async function deleteEntriesDB(ids){
  if(!ids.length) return;
  const{error}=await sb.from('gantt_entries').delete().in('id',ids);
  if(error) throw error;
}
// orchestrator: delete overlapping rows (if any) -> insert the new range -> mirror the change
// into state.ganttEntries in place (no full refetch — entries are bulk-loaded once)
export async function replaceEntryRange(ticketId,taskTypeId,startDate,endDate,overlappingIds){
  if(overlappingIds&&overlappingIds.length){
    await deleteEntriesDB(overlappingIds);
    state.ganttEntries=state.ganttEntries.filter(e=>!overlappingIds.includes(e.id));
  }
  const row=await insertEntryDB(ticketId,taskTypeId,startDate,endDate);
  state.ganttEntries.push(row);
}
export async function insertTaskTypeDB(fields){
  const{data,error}=await sb.from('gantt_task_types').insert(fields).select().single();
  if(error) throw error;
  return data;
}
export async function updateTaskTypeDB(id,fields){
  const{error}=await sb.from('gantt_task_types').update(fields).eq('id',id);
  if(error) throw error;
}
export async function deleteTaskTypeDB(id){
  const{error}=await sb.from('gantt_task_types').delete().eq('id',id);
  if(error) throw error;
}

// ══════════════════════════════════════════════════
// DATE-MATH UTILITIES — pure, local Y/M/D arithmetic (new Date(y,m,d)/getFullYear/getMonth/
// getDate). Never toISOString()/UTC — matches the timezone-safe pattern in daily-note.js's today().
// ══════════════════════════════════════════════════
function parseISO(dateStr){
  const[y,m,d]=dateStr.split('-').map(Number);
  return new Date(y,m-1,d);
}
function toISO(d){
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
export function isWeekday(dateStr){
  const dow=parseISO(dateStr).getDay();
  return dow!==0&&dow!==6;
}
export function addDays(dateStr,n){
  const d=parseISO(dateStr);
  d.setDate(d.getDate()+n);
  return toISO(d);
}
export function mondayOf(dateStr){
  const d=parseISO(dateStr);
  const dow=d.getDay();
  const diff=dow===0?-6:1-dow;
  d.setDate(d.getDate()+diff);
  return toISO(d);
}
export function walkWeekdayColumns(startDateStr,weeksCount){
  const cols=[];
  let cur=mondayOf(startDateStr);
  for(let w=0;w<weeksCount;w++){
    for(let i=0;i<5;i++){
      cols.push({date:cur,weekday:parseISO(cur).getDay(),weekIndex:w});
      cur=addDays(cur,1);
    }
    cur=addDays(cur,2); // skip weekend to next Monday
  }
  return cols;
}
export function groupColumnsByWeek(columns){
  const groups=[];
  columns.forEach(col=>{
    let g=groups.find(g=>g.weekIndex===col.weekIndex);
    if(!g){g={weekIndex:col.weekIndex,cols:[]};groups.push(g);}
    g.cols.push(col);
  });
  groups.forEach(g=>{
    const first=g.cols[0].date,last=g.cols[g.cols.length-1].date;
    g.label=`${fmtDM(first)} – ${fmtDM(last)}`;
  });
  return groups;
}
function fmtDM(dateStr){
  const d=parseISO(dateStr);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
}
export function groupWeeksByMonth(weekGroups){
  const months=[];
  weekGroups.forEach(wg=>{
    const d=parseISO(wg.cols[0].date);
    const monthLabel=d.toLocaleDateString('en-GB',{month:'short',year:'numeric'});
    let m=months.find(m=>m.monthLabel===monthLabel);
    if(!m){m={monthLabel,weekGroups:[]};months.push(m);}
    m.weekGroups.push(wg);
  });
  return months;
}
export function buildCalendarWeeks(year,month){
  const first=new Date(year,month,1);
  const start=mondayOf(toISO(first));
  const last=new Date(year,month+1,0);
  const weeks=[];
  let cur=start;
  while(true){
    const days=[];
    for(let i=0;i<5;i++){days.push(cur);cur=addDays(cur,1);}
    weeks.push({weekStart:days[0],days});
    cur=addDays(cur,2);
    if(parseISO(days[4])>=last&&parseISO(cur)>last) break;
    if(weeks.length>7) break; // safety guard
  }
  return weeks;
}
export function weekdayIndexInRow(dateStr,weekRow){
  return weekRow.days.indexOf(dateStr);
}
// next business day after dateStr — Friday rolls to the following Monday, matching the
// weekend-skip already used by walkWeekdayColumns (cur=addDays(cur,2) after 5 weekdays)
export function nextBusinessDay(dateStr){
  const dow=parseISO(dateStr).getDay();
  return addDays(dateStr,dow===5?3:1);
}
export function countWeekdaysInclusive(startDateStr,endDateStr){
  let count=0,cur=startDateStr;
  while(cur<=endDateStr){
    if(isWeekday(cur))count++;
    cur=addDays(cur,1);
  }
  return count;
}

// ══════════════════════════════════════════════════
// COLOR — deterministic hash of ticket id into a fixed palette. Never persisted.
// ══════════════════════════════════════════════════
const TICKET_PALETTE=['#4f6fd9','#df8a4e','#5aa06c','#b0698f','#c9a24a','#d9695f','#7d838c','#91008D','#3fa7a0','#8a8f98'];
export function hashToIndex(id,len){
  let hash=0;
  const str=String(id);
  for(let i=0;i<str.length;i++){hash=(hash*31+str.charCodeAt(i))>>>0;}
  return hash%len;
}
export function ticketColor(ticket){
  return TICKET_PALETTE[hashToIndex(ticket.id,TICKET_PALETTE.length)];
}

// ══════════════════════════════════════════════════
// TIMELINE — user-resizable sticky columns. ganttColumnWidths is the single source of truth
// for widths (persisted to localStorage); left offsets are always DERIVED from it as a live
// cumulative sum (never stored/hardcoded) so header and body cells can never drift out of sync.
// ══════════════════════════════════════════════════
const TIMELINE_COL_ORDER=['project','jira','scope','status','note'];
const TIMELINE_COL_DEFAULTS={project:170,jira:110,scope:90,status:118,note:160};
const TIMELINE_COL_MIN={project:100,jira:60,scope:60,status:60,note:100};
const TIMELINE_COL_MAX=400;
const TIMELINE_COL_STORAGE_KEY='gantt-timeline-column-widths';
const TIMELINE_DAY_COL_WIDTH=36;

function loadColumnWidths(){
  try{
    const raw=localStorage.getItem(TIMELINE_COL_STORAGE_KEY);
    if(raw){
      const parsed=JSON.parse(raw);
      const out={...TIMELINE_COL_DEFAULTS};
      TIMELINE_COL_ORDER.forEach(k=>{ if(typeof parsed[k]==='number') out[k]=parsed[k]; });
      return out;
    }
  }catch(e){/* ignore malformed/unavailable localStorage, fall back to defaults */}
  return {...TIMELINE_COL_DEFAULTS};
}
let ganttColumnWidths=loadColumnWidths();
function saveColumnWidths(){
  try{ localStorage.setItem(TIMELINE_COL_STORAGE_KEY,JSON.stringify(ganttColumnWidths)); }catch(e){/* ignore */}
}
// left offset of a sticky column = live cumulative sum of all preceding columns' CURRENT widths
function timelineColLeft(key){
  let left=0;
  for(const k of TIMELINE_COL_ORDER){
    if(k===key) return left;
    left+=ganttColumnWidths[k];
  }
  return left;
}
// Re-applies widths/offsets to already-rendered header+body cells without a full re-render,
// so drag-move stays smooth. Header and body read the exact same ganttColumnWidths/timelineColLeft,
// so they can never show a stale/mismatched state mid-drag.
function applyColumnLayout(){
  let cum=0;
  TIMELINE_COL_ORDER.forEach(k=>{
    const w=ganttColumnWidths[k];
    document.querySelectorAll(`.dt-sticky-col[data-col="${k}"]`).forEach(el=>{
      el.style.width=w+'px';
      el.style.left=cum+'px';
    });
    cum+=w;
  });
  const table=document.getElementById('dtTimelineTable');
  if(!table) return;
  const colgroup=table.querySelector('colgroup');
  if(colgroup){
    TIMELINE_COL_ORDER.forEach((k,i)=>{
      const col=colgroup.children[i];
      if(col) col.style.width=ganttColumnWidths[k]+'px';
    });
    let total=0;
    Array.from(colgroup.children).forEach(col=>{ total+=parseFloat(col.style.width)||0; });
    table.style.width=total+'px';
  }
}
function startColumnResize(e,key){
  e.preventDefault();
  e.stopPropagation();
  const startX=e.clientX;
  const startWidth=ganttColumnWidths[key];
  const min=TIMELINE_COL_MIN[key]||60;
  function onMove(ev){
    const dx=ev.clientX-startX;
    let w=startWidth+dx;
    w=Math.max(min,Math.min(TIMELINE_COL_MAX,w));
    ganttColumnWidths[key]=w;
    applyColumnLayout();
  }
  function onUp(){
    document.removeEventListener('mousemove',onMove);
    document.removeEventListener('mouseup',onUp);
    saveColumnWidths();
  }
  document.addEventListener('mousemove',onMove);
  document.addEventListener('mouseup',onUp);
}

export function isTicketActive(t){ return !INACTIVE_STATUSES.includes(t.status); }

export function renderTimelineLegend(){
  const el=document.getElementById('dtLegendRow');
  if(!el) return;
  el.innerHTML=state.ganttTaskTypes.map(tt=>
    `<span class="dt-legend-chip"><span class="dt-legend-swatch" style="background:${esc(tt.color)}"></span><span><b>${esc(tt.code)}</b> — ${esc(tt.label)}</span></span>`
  ).join('');
}

// table-layout:fixed (basebi.css) makes the browser honor these exactly, taken only from
// this <colgroup> — inline width/left styles on <th>/<td> alone are just hints under the
// default table-layout:auto and get overridden by cell content, which broke sticky alignment.
function renderTimelineColgroup(dayCount){
  const table=document.getElementById('dtTimelineTable');
  if(!table) return;
  let colgroup=table.querySelector('colgroup');
  if(!colgroup){colgroup=document.createElement('colgroup');table.insertBefore(colgroup,table.firstChild);}
  const stickyCols=TIMELINE_COL_ORDER.map(k=>`<col style="width:${ganttColumnWidths[k]}px">`).join('');
  const dayCols=Array.from({length:dayCount},()=>`<col style="width:${TIMELINE_DAY_COL_WIDTH}px">`).join('');
  colgroup.innerHTML=stickyCols+dayCols;
  // table-layout:fixed with width:auto still shrinks the table to fit its scrollable
  // container instead of honoring the colgroup — pin the table's own width to the sum of
  // declared column widths so .dt-timeline-wrap's overflow:auto scrolls instead of squeezing.
  const stickyTotal=TIMELINE_COL_ORDER.reduce((a,k)=>a+ganttColumnWidths[k],0);
  table.style.width=(stickyTotal+dayCount*TIMELINE_DAY_COL_WIDTH)+'px';
}

export function renderTimelineHeader(){
  const head=document.getElementById('dtTimelineHead');
  if(!head) return;
  const cols=walkWeekdayColumns(state.ganttTimelineStartDate,state.ganttTimelineWeeks);
  const weekGroups=groupColumnsByWeek(cols);
  const monthGroups=groupWeeksByMonth(weekGroups);
  const todayStr=today();

  renderTimelineColgroup(cols.length);

  const stickyTh=(key,label)=>`<th class="dt-sticky-col" data-col="${key}" style="left:${timelineColLeft(key)}px;width:${ganttColumnWidths[key]}px" rowspan="3">${esc(label)}<span class="dt-col-resize-handle" data-col="${key}" title="Drag to resize"></span></th>`;

  const monthRow=`<tr>${stickyTh('project','Project')}${stickyTh('jira','Jira')}${stickyTh('scope','Mon. Scope')}${stickyTh('status','Status')}${stickyTh('note','Note')}${
    monthGroups.map(mg=>`<th colspan="${mg.weekGroups.reduce((n,wg)=>n+wg.cols.length,0)}" class="dt-month-th">${esc(mg.monthLabel)}</th>`).join('')
  }</tr>`;

  // "current week" highlight — only when today's date actually falls within one of the
  // currently visible week groups; never forces navigation to jump there
  const weekRow=`<tr>${weekGroups.map(wg=>{
    const isCurrentWeek=wg.cols.some(c=>c.date===todayStr);
    return `<th colspan="${wg.cols.length}" class="dt-week-th${isCurrentWeek?' dt-week-th-today':''}">${esc(wg.label)}</th>`;
  }).join('')}</tr>`;

  const dayRow=`<tr>${cols.map(c=>{
    const d=parseISO(c.date);
    const dow=['Su','Mo','Tu','We','Th','Fr','Sa'][c.weekday];
    const isToday=c.date===todayStr;
    return `<th class="dt-day-th${isToday?' dt-day-th-today':''}" data-date="${c.date}">${dow}<br>${String(d.getDate()).padStart(2,'0')}</th>`;
  }).join('')}</tr>`;

  head.innerHTML=monthRow+weekRow+dayRow;
}

function renderTicketRow(ticket,cols){
  const color=ticketColor(ticket);
  const entries=state.ganttEntries.filter(e=>e.ticket_id===ticket.id);
  const todayStr=today();
  const dayCells=cols.map(c=>{
    const entry=entries.find(e=>c.date>=e.start_date&&c.date<=e.end_date);
    let inner='',style='';
    if(entry){
      const tt=state.ganttTaskTypes.find(t=>t.id===entry.task_type_id);
      if(tt){style=`background:${esc(tt.color)}`;inner=`<span class="dt-day-code">${esc(tt.code)}</span>`;}
    }
    // today-column tint is a distinct CSS class (not the drag-fill dt-day-selecting state) so
    // it never visually collides with hover/selecting during drag-to-fill
    const todayClass=c.date===todayStr?' dt-day-cell-today':'';
    return `<td class="dt-day-cell${todayClass}" data-ticket-id="${esc(ticket.id)}" data-date="${c.date}" style="${style}">${inner}</td>`;
  }).join('');

  const jiraCell=ticket.jira_url
    ? `<a href="${esc(ticket.jira_url)}" target="_blank" rel="noopener">${esc(ticket.jira_key||'link')}</a>`
    : esc(ticket.jira_key||'');

  return `<tr class="dt-ticket-row" data-ticket-id="${esc(ticket.id)}">
    <td class="dt-sticky-col" data-col="project" style="width:${ganttColumnWidths.project}px;left:${timelineColLeft('project')}px" title="${esc(ticket.project_name)}">
      <span class="dt-ticket-swatch" style="background:${color}"></span>${esc(ticket.project_name)}
      <button class="dt-ticket-edit-btn" onclick="openTicketModal('${escJs(ticket.id)}')" title="Edit ticket">✎</button>
    </td>
    <td class="dt-sticky-col" data-col="jira" style="width:${ganttColumnWidths.jira}px;left:${timelineColLeft('jira')}px" title="${esc(ticket.jira_key||'')}">${jiraCell}</td>
    <td class="dt-sticky-col" data-col="scope" style="width:${ganttColumnWidths.scope}px;left:${timelineColLeft('scope')}px" title="${esc(ticket.mon_scope||'')}">${esc(ticket.mon_scope||'')}</td>
    <td class="dt-sticky-col dt-status-cell" data-col="status" style="width:${ganttColumnWidths.status}px;left:${timelineColLeft('status')}px"><span class="dt-status-badge dt-status-${esc(ticket.status.replace(/\s+/g,''))}">${esc(ticket.status)}</span></td>
    <td class="dt-sticky-col dt-note-cell" data-col="note" style="width:${ganttColumnWidths.note}px;left:${timelineColLeft('note')}px" title="${esc(ticket.note||'')}">${esc(ticket.note||'')}</td>
    ${dayCells}
  </tr>`;
}

export function renderTimelineBody(){
  const body=document.getElementById('dtTimelineBody');
  if(!body) return;
  const cols=walkWeekdayColumns(state.ganttTimelineStartDate,state.ganttTimelineWeeks);
  const active=state.ganttTickets.filter(isTicketActive);
  const inactive=state.ganttTickets.filter(t=>!isTicketActive(t));

  let html=active.map(t=>renderTicketRow(t,cols)).join('');
  if(inactive.length){
    const colCount=5+cols.length;
    html+=`<tr class="dt-inactive-divider" onclick="toggleGanttInactive()"><td colspan="${colCount}">${state.ganttInactiveExpanded?'▾':'▸'} Inactive (${inactive.length})</td></tr>`;
    if(state.ganttInactiveExpanded){
      html+=inactive.map(t=>renderTicketRow(t,cols)).join('');
    }
  }
  body.innerHTML=html||`<tr><td colspan="${5+cols.length}" class="note-empty">No tickets yet</td></tr>`;
  renderAgenda();
}

export function renderTimelineControls(){
  const startEl=document.getElementById('dtStartDate');
  const weeksEl=document.getElementById('dtWeeksInput');
  if(startEl) startEl.value=state.ganttTimelineStartDate;
  if(weeksEl) weeksEl.value=state.ganttTimelineWeeks;
}

export function renderTimeline(){
  if(!state.ganttTimelineStartDate) state.ganttTimelineStartDate=mondayOf(today());
  renderTimelineControls();
  renderTimelineLegend();
  renderTimelineHeader();
  renderTimelineBody();
}

export function toggleGanttInactive(){
  state.ganttInactiveExpanded=!state.ganttInactiveExpanded;
  renderTimelineBody();
}
export function shiftTimelineWeek(delta){
  state.ganttTimelineStartDate=addDays(state.ganttTimelineStartDate,delta*7);
  renderTimeline();
}
export function setTimelineStartDate(dateStr){
  if(!dateStr) return;
  state.ganttTimelineStartDate=mondayOf(dateStr);
  renderTimeline();
}
export function setTimelineWeeks(n){
  const num=Math.max(1,Math.min(12,parseInt(n,10)||6));
  state.ganttTimelineWeeks=num;
  renderTimeline();
}

// ══════════════════════════════════════════════════
// DRAG-TO-FILL STATE MACHINE
// ══════════════════════════════════════════════════
export function computeOverlaps(ticketId,startDate,endDate){
  return state.ganttEntries.filter(e=>e.ticket_id===ticketId&&e.start_date<=endDate&&e.end_date>=startDate);
}
function clearDayHighlight(){
  document.querySelectorAll('.dt-day-cell.dt-day-selecting').forEach(el=>el.classList.remove('dt-day-selecting'));
}
function highlightRange(ticketId,start,end){
  clearDayHighlight();
  const lo=start<end?start:end, hi=start<end?end:start;
  document.querySelectorAll(`.dt-day-cell[data-ticket-id="${CSS.escape(String(ticketId))}"]`).forEach(el=>{
    const d=el.getAttribute('data-date');
    if(d>=lo&&d<=hi) el.classList.add('dt-day-selecting');
  });
}
// Drag-to-fill uses Pointer Events (not mouse events) deliberately. mouseover-based delegation
// is unreliable mid-drag in real browsers: once a mousedown starts inside a <td>, the browser's
// native cell/text-selection machinery can take over hit-testing for the remainder of the
// gesture, so 'mouseover' silently stops firing on cells the pointer passes over until
// mouseup — even with preventDefault() on mousedown, this is inconsistent across
// browsers/input devices (trackpads especially). Pointer Events + explicit
// document.elementFromPoint() on every 'pointermove' sidesteps that entirely — we're directly
// querying what's under the pointer instead of relying on the browser to tell us via bubbling.
export function handleDayPointerDown(e){
  const cell=e.target.closest('.dt-day-cell');
  if(!cell) return;
  e.preventDefault();
  state.ganttDragState={ticketId:cell.getAttribute('data-ticket-id'),anchorDate:cell.getAttribute('data-date'),currentDate:cell.getAttribute('data-date')};
  highlightRange(state.ganttDragState.ticketId,state.ganttDragState.anchorDate,state.ganttDragState.currentDate);
}
export function handleDayPointerMove(e){
  if(!state.ganttDragState) return;
  const el=document.elementFromPoint(e.clientX,e.clientY);
  const cell=el&&el.closest('.dt-day-cell');
  if(!cell) return;
  if(cell.getAttribute('data-ticket-id')!==state.ganttDragState.ticketId) return;
  state.ganttDragState.currentDate=cell.getAttribute('data-date');
  highlightRange(state.ganttDragState.ticketId,state.ganttDragState.anchorDate,state.ganttDragState.currentDate);
}
function findEntryAtCell(ticketId,dateStr){
  return state.ganttEntries.find(e=>e.ticket_id===ticketId&&dateStr>=e.start_date&&dateStr<=e.end_date);
}
// Guards the type-picker/manage-popover against a same-gesture close: when a drag's
// pointerdown and pointerup land on different cells, the browser still synthesizes a
// trailing native 'click' event, targeted at the nearest common ancestor of the two cells
// (e.g. the <tr>) rather than either .dt-day-cell — so the outside-click-to-dismiss listener
// (which only allow-lists clicks inside '.dt-day-cell'/'#dtTypePickerPopover') doesn't
// recognize it as "inside" and immediately closes the popover we just opened, in the same
// event-loop tick. We set this flag right before opening the popover and consume it (skip
// exactly one close) in the document click listener; a queued microtask/timeout clears it
// afterward as a safety net in case the trailing click never arrives.
let suppressNextOutsideClick=false;
export function armPopoverOpenGuard(){
  suppressNextOutsideClick=true;
  setTimeout(()=>{suppressNextOutsideClick=false;},0);
}
export function consumeOutsideClickSuppression(){
  if(!suppressNextOutsideClick) return false;
  suppressNextOutsideClick=false;
  return true;
}
export function handleDayPointerUp(e){
  const drag=state.ganttDragState;
  state.ganttDragState=null;
  clearDayHighlight();
  if(!drag) return;
  const el=document.elementFromPoint(e.clientX,e.clientY);
  const cell=(el&&el.closest('.dt-day-cell'))||e.target.closest('.dt-day-cell');
  if(!cell){ return; } // released outside a day cell — cancel with no popover
  armPopoverOpenGuard();
  // plain click (no drag movement) on an already-assigned cell — open the lighter-weight
  // "Change type / Remove" popover scoped to that entry's own range, instead of the
  // assign-a-new-range flow. Dragging (even a 1-day drag onto empty space) keeps old behavior.
  if(drag.anchorDate===drag.currentDate){
    const existingEntry=findEntryAtCell(drag.ticketId,drag.anchorDate);
    if(existingEntry){
      openEntryManagePopover(existingEntry,e.clientX,e.clientY);
      return;
    }
  }
  const startDate=drag.anchorDate<drag.currentDate?drag.anchorDate:drag.currentDate;
  const endDate=drag.anchorDate<drag.currentDate?drag.currentDate:drag.anchorDate;
  const overlaps=computeOverlaps(drag.ticketId,startDate,endDate);
  state.ganttPendingEntryWrite={ticketId:drag.ticketId,startDate,endDate,overlaps};
  openTypePicker(e.clientX,e.clientY);
}

export function openTypePicker(x,y){
  const pop=document.getElementById('dtTypePickerPopover');
  if(!pop) return;
  const pending=state.ganttPendingEntryWrite;
  const hasExisting=!!(pending&&pending.overlaps&&pending.overlaps.length);
  const typeRows=state.ganttTaskTypes.map(tt=>
    `<div class="dt-type-picker-row" onclick="selectTaskType('${escJs(tt.id)}')"><span class="dt-legend-swatch" style="background:${esc(tt.color)}"></span>${esc(tt.code)} — ${esc(tt.label)}</div>`
  ).join('');
  // "Clear" only shown when the range being acted on actually contains existing entries —
  // there's nothing to clear on an empty range
  const clearRow=hasExisting?`<div class="dt-type-picker-sep"></div><div class="dt-type-picker-row dt-type-picker-clear" onclick="clearAssignment()"><span class="dt-type-picker-clear-icon">✕</span>Clear assignment</div>`:'';
  pop.innerHTML=typeRows+clearRow;
  pop.style.display='block';
  const vw=window.innerWidth,vh=window.innerHeight;
  const rowCount=state.ganttTaskTypes.length+(hasExisting?1:0);
  const w=220,h=Math.min(340,rowCount*32+16);
  pop.style.left=Math.min(x,vw-w-8)+'px';
  pop.style.top=Math.min(y,vh-h-8)+'px';
}
export function closeTypePicker(){
  const pop=document.getElementById('dtTypePickerPopover');
  if(pop){pop.style.display='none';pop.innerHTML='';}
}
export async function selectTaskType(taskTypeId){
  const pending=state.ganttPendingEntryWrite;
  closeTypePicker();
  if(!pending) return;
  if(pending.overlaps&&pending.overlaps.length){
    openOverlapConfirm(pending.overlaps,async()=>{
      await commitEntryWrite(pending,taskTypeId);
    });
  }else{
    await commitEntryWrite(pending,taskTypeId);
  }
}
async function commitEntryWrite(pending,taskTypeId){
  try{
    await replaceEntryRange(pending.ticketId,taskTypeId,pending.startDate,pending.endDate,(pending.overlaps||[]).map(o=>o.id));
  }catch(err){alert('Could not save schedule: '+(err.message||err));}
  state.ganttPendingEntryWrite=null;
  renderTimelineBody();
}
// "Clear assignment" — drag-to-fill flow, range may cover multiple existing entries.
// No new type being written, so this skips the overlap-confirm-and-replace flow entirely
// and goes straight to a delete-focused confirm.
export async function clearAssignment(){
  const pending=state.ganttPendingEntryWrite;
  closeTypePicker();
  if(!pending||!pending.overlaps||!pending.overlaps.length) return;
  const n=pending.overlaps.length;
  if(!confirm(`Remove ${n} ${n===1?'entry':'entries'} in this range?`)) return;
  const ids=pending.overlaps.map(o=>o.id);
  try{
    await deleteEntriesDB(ids);
    state.ganttEntries=state.ganttEntries.filter(e=>!ids.includes(e.id));
  }catch(err){alert('Could not clear entries: '+(err.message||err));}
  state.ganttPendingEntryWrite=null;
  renderTimelineBody();
}

// ══════════════════════════════════════════════════
// SINGLE-ENTRY MANAGE POPOVER — plain (no-drag) click on an already-assigned cell.
// Reuses the same #dtTypePickerPopover element/outside-click-to-close wiring as the
// drag-to-fill type picker; "Change type" re-enters that same picker scoped to this
// entry's own date range, "Remove" deletes just this one row.
// ══════════════════════════════════════════════════
export function openEntryManagePopover(entry,x,y){
  state.ganttPendingEntryManage={entry,x,y};
  const pop=document.getElementById('dtTypePickerPopover');
  if(!pop) return;
  const tt=state.ganttTaskTypes.find(t=>t.id===entry.task_type_id);
  pop.innerHTML=`
    <div class="dt-type-picker-row" onclick="event.stopPropagation();changeEntryType()"><span class="dt-legend-swatch" style="background:${tt?esc(tt.color):'#888'}"></span>Change type →</div>
    <div class="dt-type-picker-sep"></div>
    <div class="dt-type-picker-row dt-type-picker-clear" onclick="event.stopPropagation();removeSingleEntry()"><span class="dt-type-picker-clear-icon">✕</span>Remove</div>
  `;
  pop.style.display='block';
  const vw=window.innerWidth,vh=window.innerHeight;
  const w=220,h=90;
  pop.style.left=Math.min(x,vw-w-8)+'px';
  pop.style.top=Math.min(y,vh-h-8)+'px';
}
export function changeEntryType(){
  const pending=state.ganttPendingEntryManage;
  state.ganttPendingEntryManage=null;
  closeTypePicker();
  if(!pending) return;
  const{entry,x,y}=pending;
  state.ganttPendingEntryWrite={ticketId:entry.ticket_id,startDate:entry.start_date,endDate:entry.end_date,overlaps:[entry]};
  openTypePicker(x,y);
}
export async function removeSingleEntry(){
  const pending=state.ganttPendingEntryManage;
  state.ganttPendingEntryManage=null;
  closeTypePicker();
  if(!pending) return;
  const{entry}=pending;
  const tt=state.ganttTaskTypes.find(t=>t.id===entry.task_type_id);
  const rangeLabel=entry.start_date===entry.end_date?fmtDM(entry.start_date):`${fmtDM(entry.start_date)}–${fmtDM(entry.end_date)}`;
  if(!confirm(`Remove ${tt?tt.code:'this entry'} from ${rangeLabel}?`)) return;
  try{
    await deleteEntriesDB([entry.id]);
    state.ganttEntries=state.ganttEntries.filter(e=>e.id!==entry.id);
  }catch(err){alert('Could not remove entry: '+(err.message||err));return;}
  renderTimelineBody();
}

export function openOverlapConfirm(overlaps,onConfirm){
  const listEl=document.getElementById('dtOverlapList');
  const overlay=document.getElementById('dtOverlapModalOverlay');
  if(!listEl||!overlay) return;
  listEl.innerHTML=overlaps.map(o=>{
    const tt=state.ganttTaskTypes.find(t=>t.id===o.task_type_id);
    return `<div class="dt-overlap-item">${esc(tt?tt.code:'?')}: ${esc(o.start_date)} – ${esc(o.end_date)}</div>`;
  }).join('');
  overlay.classList.add('open');
  const confirmBtn=document.getElementById('dtOverlapConfirmBtn');
  confirmBtn.onclick=async()=>{closeOverlapModal();await onConfirm();};
}
export function closeOverlapModal(){
  const overlay=document.getElementById('dtOverlapModalOverlay');
  if(overlay) overlay.classList.remove('open');
  state.ganttPendingEntryWrite=null;
}

// ══════════════════════════════════════════════════
// TICKET MODAL — dual mode (add/edit), modeled on checklist-templates.js's template modal.
// ══════════════════════════════════════════════════
export function openTicketModal(id){
  state.ganttEditingTicketId=id||null;
  const t=id?state.ganttTickets.find(t=>t.id===id):null;
  document.getElementById('dtTicketModalTitle').textContent=t?'Edit Ticket':'New Ticket';
  document.getElementById('dt-project').value=t?t.project_name:'';
  document.getElementById('dt-jira-key').value=t?(t.jira_key||''):'';
  document.getElementById('dt-jira-url').value=t?(t.jira_url||''):'';
  document.getElementById('dt-scope').value=t?(t.mon_scope||''):'';
  document.getElementById('dt-status').value=t?t.status:'Not Started';
  document.getElementById('dt-note').value=t?(t.note||''):'';
  document.getElementById('dtTicketDeleteBtn').style.display=t?'':'none';
  document.getElementById('dtTicketModalOverlay').classList.add('open');
}
export function closeTicketModal(){
  document.getElementById('dtTicketModalOverlay').classList.remove('open');
  state.ganttEditingTicketId=null;
}
export async function saveTicket(){
  const project_name=document.getElementById('dt-project').value.trim();
  if(!project_name){alert('Project name is required.');return;}
  const fields={
    project_name,
    jira_key:document.getElementById('dt-jira-key').value.trim()||null,
    jira_url:document.getElementById('dt-jira-url').value.trim()||null,
    mon_scope:document.getElementById('dt-scope').value.trim()||null,
    status:document.getElementById('dt-status').value,
    note:document.getElementById('dt-note').value.trim()||null,
  };
  try{
    if(state.ganttEditingTicketId){
      await updateTicketDB(state.ganttEditingTicketId,fields);
      const t=state.ganttTickets.find(t=>t.id===state.ganttEditingTicketId);
      if(t) Object.assign(t,fields);
    }else{
      const row=await insertTicketDB(fields);
      state.ganttTickets.push(row);
    }
    closeTicketModal();
    renderTimelineBody();
  }catch(err){alert('Could not save ticket: '+(err.message||err));}
}
export async function deleteTicket(){
  const id=state.ganttEditingTicketId;
  if(!id) return;
  if(!confirm('Delete this ticket and all its scheduled entries? This cannot be undone.')) return;
  try{
    await deleteTicketDB(id);
    state.ganttTickets=state.ganttTickets.filter(t=>t.id!==id);
    state.ganttEntries=state.ganttEntries.filter(e=>e.ticket_id!==id);
    closeTicketModal();
    renderTimelineBody();
  }catch(err){alert('Could not delete ticket: '+(err.message||err));}
}

// ══════════════════════════════════════════════════
// ADMIN — MANAGE TASK TYPES (modeled on checklist-templates.js's templateEditItems editor-array pattern)
// ══════════════════════════════════════════════════
export function openTaskTypeModal(){
  if(state.currentUserRole!=='admin') return;
  state.ganttTaskTypeEditItems=JSON.parse(JSON.stringify(state.ganttTaskTypes));
  renderTaskTypeEditor();
  document.getElementById('dtTaskTypeModalOverlay').classList.add('open');
}
export function closeTaskTypeModal(){
  document.getElementById('dtTaskTypeModalOverlay').classList.remove('open');
  state.ganttTaskTypeEditItems=[];
}
export function addTaskTypeRow(){
  state.ganttTaskTypeEditItems.push({code:'',label:'',color:'#4f6fd9',sort_order:state.ganttTaskTypeEditItems.length+1});
  renderTaskTypeEditor();
}
export function removeTaskTypeRow(idx){
  state.ganttTaskTypeEditItems.splice(idx,1);
  renderTaskTypeEditor();
}
export function updateTaskTypeField(idx,field,value){
  if(state.ganttTaskTypeEditItems[idx]) state.ganttTaskTypeEditItems[idx][field]=value;
}
export function renderTaskTypeEditor(){
  const el=document.getElementById('dtTaskTypeEditor');
  if(!el) return;
  el.innerHTML=state.ganttTaskTypeEditItems.map((tt,idx)=>`
    <div class="dt-tasktype-row">
      <input class="form-input" style="width:70px" placeholder="Code *" value="${esc(tt.code||'')}" onchange="updateTaskTypeField(${idx},'code',this.value)">
      <input class="form-input" placeholder="Label *" value="${esc(tt.label||'')}" onchange="updateTaskTypeField(${idx},'label',this.value)">
      <input type="color" class="dt-color-input" value="${esc(tt.color||'#4f6fd9')}" onchange="updateTaskTypeField(${idx},'color',this.value)">
      <button type="button" class="btn btn-danger tpl-item-remove" onclick="removeTaskTypeRow(${idx})" title="Remove type">✕</button>
    </div>`).join('');
}
export async function saveTaskTypes(){
  const items=state.ganttTaskTypeEditItems;
  if(items.some(tt=>!tt.code||!tt.code.trim()||!tt.label||!tt.label.trim())){
    alert('Every task type needs a code and a label.');return;
  }
  try{
    const existingIds=state.ganttTaskTypes.map(t=>t.id);
    const keptIds=items.filter(t=>t.id).map(t=>t.id);
    const removedIds=existingIds.filter(id=>!keptIds.includes(id));
    for(const id of removedIds) await deleteTaskTypeDB(id);
    for(const item of items){
      const fields={code:item.code.trim(),label:item.label.trim(),color:item.color,sort_order:item.sort_order||0};
      if(item.id) await updateTaskTypeDB(item.id,fields);
      else await insertTaskTypeDB(fields);
    }
    state.ganttTaskTypes=await loadTaskTypes();
    closeTaskTypeModal();
    renderTimelineLegend();
    renderTimelineHeader();
    renderTimelineBody();
  }catch(err){alert('Could not save task types: '+(err.message||err));}
}

// ══════════════════════════════════════════════════
// CALENDAR
// ══════════════════════════════════════════════════
const CALENDAR_COL_WIDTH=140;
const CAL_MAX_LANES=3;

// overall ticket span (earliest start / latest end across ALL entries) — used only for the
// popover's summary fields, which stay ticket-level even though the visual bars are now
// segmented (see computeTicketClusters below)
function computeTicketSpans(tickets,entries){
  const spans=new Map();
  entries.forEach(e=>{
    const cur=spans.get(e.ticket_id);
    if(!cur){spans.set(e.ticket_id,{minDate:e.start_date,maxDate:e.end_date});}
    else{
      if(e.start_date<cur.minDate)cur.minDate=e.start_date;
      if(e.end_date>cur.maxDate)cur.maxDate=e.end_date;
    }
  });
  return spans;
}
// per-ticket activity CLUSTERS — walks each ticket's entries (sorted by start_date) and
// groups adjacent/overlapping ones into segments; a real gap (next entry starts later than
// the immediate next business day after the current segment's end) closes the segment and
// starts a new one. A ticket can therefore produce multiple disjoint bars instead of one
// span that visually papers over gaps with no activity.
function computeTicketClusters(tickets,entries){
  const clusters=new Map();
  tickets.forEach(t=>{
    const es=entries.filter(e=>e.ticket_id===t.id).sort((a,b)=>a.start_date<b.start_date?-1:a.start_date>b.start_date?1:0);
    const segs=[];
    es.forEach(e=>{
      const last=segs[segs.length-1];
      if(last&&e.start_date<=nextBusinessDay(last.maxDate)){
        if(e.end_date>last.maxDate) last.maxDate=e.end_date;
      }else{
        segs.push({minDate:e.start_date,maxDate:e.end_date});
      }
    });
    if(segs.length) clusters.set(t.id,segs);
  });
  return clusters;
}
function computeWeekSegments(weekRow,clusters,tickets){
  const segments=[];
  const weekStart=weekRow.days[0],weekEnd=weekRow.days[weekRow.days.length-1];
  tickets.forEach(t=>{
    const segs=clusters.get(t.id);
    if(!segs) return;
    segs.forEach(seg=>{
      if(seg.maxDate<weekStart||seg.minDate>weekEnd) return;
      const clipStart=seg.minDate>weekStart?seg.minDate:weekStart;
      const clipEnd=seg.maxDate<weekEnd?seg.maxDate:weekEnd;
      const startIdx=weekdayIndexInRow(clipStart,weekRow);
      const endIdx=weekdayIndexInRow(clipEnd,weekRow);
      if(startIdx<0||endIdx<0) return;
      // segStart is the UNCLIPPED segment start — used for "Open in Timeline" so clicking a
      // segment that spans multiple weeks always jumps to its true start, not this week's clip
      segments.push({ticket:t,startIdx,endIdx,segStart:seg.minDate});
    });
  });
  return segments;
}
function assignLanes(segments){
  const sorted=[...segments].sort((a,b)=>a.startIdx-b.startIdx);
  const lanes=[]; // lanes[i] = last occupied endIdx
  const placed=[];
  sorted.forEach(seg=>{
    let laneIdx=lanes.findIndex(endIdx=>endIdx<seg.startIdx);
    if(laneIdx===-1){laneIdx=lanes.length;}
    lanes[laneIdx]=seg.endIdx;
    placed.push({...seg,lane:laneIdx});
  });
  const visible=placed.filter(s=>s.lane<CAL_MAX_LANES);
  const overflow=placed.filter(s=>s.lane>=CAL_MAX_LANES);
  return {visible,overflow};
}

export function renderCalendarControls(){
  if(!state.ganttMonthCursor){
    const d=new Date();
    state.ganttMonthCursor={year:d.getFullYear(),month:d.getMonth()};
  }
  const label=document.getElementById('dtCalMonthLabel');
  if(label){
    const d=new Date(state.ganttMonthCursor.year,state.ganttMonthCursor.month,1);
    label.textContent=d.toLocaleDateString('en-GB',{month:'long',year:'numeric'});
  }
  const chk=document.getElementById('dtCalShowInactive');
  if(chk) chk.checked=state.ganttCalendarShowInactive;
}

export function renderCalendarGrid(){
  const grid=document.getElementById('dtCalendarGrid');
  if(!grid) return;
  const {year,month}=state.ganttMonthCursor;
  const weeks=buildCalendarWeeks(year,month);
  const tickets=state.ganttTickets.filter(t=>state.ganttCalendarShowInactive||isTicketActive(t));
  const clusters=computeTicketClusters(tickets,state.ganttEntries);
  // "today" badge only renders when the displayed month/year actually matches today's —
  // never forces navigation to jump there
  const now=new Date();
  const todayStr=(now.getFullYear()===year&&now.getMonth()===month)?today():null;

  grid.innerHTML=weeks.map(weekRow=>{
    const segments=computeWeekSegments(weekRow,clusters,tickets);
    const {visible,overflow}=assignLanes(segments);
    const overflowByDay={};
    overflow.forEach(seg=>{
      for(let i=seg.startIdx;i<=seg.endIdx;i++){
        overflowByDay[i]=overflowByDay[i]||[];
        overflowByDay[i].push(seg.ticket);
      }
    });
    const dayLabels=weekRow.days.map(dateStr=>{
      const d=parseISO(dateStr);
      const inMonth=d.getMonth()===month;
      const isToday=dateStr===todayStr;
      return `<div class="dt-cal-day-label ${inMonth?'':'dt-cal-day-muted'}" style="width:${CALENDAR_COL_WIDTH}px">${isToday?`<span class="dt-cal-today-badge">${d.getDate()}</span>`:d.getDate()}</div>`;
    }).join('');
    const bars=visible.map(seg=>{
      const t=seg.ticket;
      const left=seg.startIdx*CALENDAR_COL_WIDTH;
      const width=(seg.endIdx-seg.startIdx+1)*CALENDAR_COL_WIDTH-6;
      const top=seg.lane*22;
      const label=t.project_name||t.jira_key;
      return `<div class="dt-cal-bar" style="left:${left}px;width:${width}px;top:${top}px;background:${ticketColor(t)}" onclick="openTicketPopover('${escJs(t.id)}',this,'${escJs(seg.segStart)}')">${esc(label)}</div>`;
    }).join('');
    const overflowChips=Object.keys(overflowByDay).map(idxStr=>{
      const idx=Number(idxStr);
      const tickets=overflowByDay[idx];
      return `<div class="dt-cal-overflow-chip" style="left:${idx*CALENDAR_COL_WIDTH}px;top:${CAL_MAX_LANES*22}px" onclick="openOverflowPopover('${esc(weekRow.days[idx])}',this)">+${tickets.length} more</div>`;
    }).join('');
    return `<div class="dt-cal-week-row">
      <div class="dt-cal-day-labels">${dayLabels}</div>
      <div class="dt-cal-bars-layer">${bars}${overflowChips}</div>
    </div>`;
  }).join('');
}

export function renderCalendar(){
  renderCalendarControls();
  renderCalendarGrid();
}

export function shiftCalendarMonth(delta){
  let{year,month}=state.ganttMonthCursor;
  month+=delta;
  if(month<0){month=11;year--;}
  if(month>11){month=0;year++;}
  state.ganttMonthCursor={year,month};
  renderCalendar();
}
export function toggleCalendarShowInactive(){
  state.ganttCalendarShowInactive=!state.ganttCalendarShowInactive;
  renderCalendar();
}

// ══════════════════════════════════════════════════
// CALENDAR POPOVERS
// ══════════════════════════════════════════════════
function positionPopover(pop,anchorEl){
  const rect=anchorEl.getBoundingClientRect();
  const vw=window.innerWidth,vh=window.innerHeight;
  const w=260,h=180;
  pop.style.left=Math.min(rect.left,vw-w-8)+'px';
  pop.style.top=Math.min(rect.bottom+4,vh-h-8)+'px';
}
export function openTicketPopover(ticketId,anchorEl,segStartDate){
  const t=state.ganttTickets.find(t=>t.id===ticketId);
  if(!t) return;
  // popover summary is always the ticket's OVERALL span, regardless of which segment/bar was
  // clicked — only the visual bars are segmented, per the fix's scope
  const span=computeTicketSpans([t],state.ganttEntries.filter(e=>e.ticket_id===ticketId)).get(ticketId);
  const pop=document.getElementById('dtCalPopover');
  if(!pop) return;
  const duration=span?countWeekdaysInclusive(span.minDate,span.maxDate):0;
  const jumpDate=segStartDate||(span?span.minDate:'');
  pop.innerHTML=`
    <div class="dt-popover-title">${esc(t.project_name)}</div>
    ${t.jira_url?`<div><a href="${esc(t.jira_url)}" target="_blank" rel="noopener">${esc(t.jira_key||'Jira link')}</a></div>`:(t.jira_key?`<div>${esc(t.jira_key)}</div>`:'')}
    ${span?`<div>${esc(span.minDate)} → ${esc(span.maxDate)} (${duration} weekday${duration!==1?'s':''})</div>`:''}
    <div><span class="dt-status-badge dt-status-${esc(t.status.replace(/\s+/g,''))}">${esc(t.status)}</span></div>
    ${t.mon_scope?`<div>Mon. scope: ${esc(t.mon_scope)}</div>`:''}
    <button class="btn btn-ghost" style="margin-top:8px" onclick="jumpToTimeline('${escJs(t.id)}','${escJs(jumpDate)}')">Open in Timeline →</button>
  `;
  pop.style.display='block';
  positionPopover(pop,anchorEl);
}
export function openOverflowPopover(dateStr,anchorEl){
  const tickets=state.ganttTickets.filter(t=>{
    const entries=state.ganttEntries.filter(e=>e.ticket_id===t.id);
    return entries.some(e=>dateStr>=e.start_date&&dateStr<=e.end_date);
  });
  const pop=document.getElementById('dtCalPopover');
  if(!pop) return;
  pop.innerHTML=`<div class="dt-popover-title">${esc(dateStr)}</div>`+
    tickets.map(t=>`<div class="dt-popover-ticket-row" onclick="openTicketPopover('${escJs(t.id)}',this)"><span class="dt-legend-swatch" style="background:${ticketColor(t)}"></span>${esc(t.project_name)}</div>`).join('');
  pop.style.display='block';
  positionPopover(pop,anchorEl);
}
export function closeCalPopover(){
  const pop=document.getElementById('dtCalPopover');
  if(pop){pop.style.display='none';pop.innerHTML='';}
}
export function jumpToTimeline(ticketId,segStartDate){
  closeCalPopover();
  const t=state.ganttTickets.find(t=>t.id===ticketId);
  if(!t) return;
  let startDate=segStartDate;
  if(!startDate){
    const entries=state.ganttEntries.filter(e=>e.ticket_id===ticketId);
    startDate=entries.length?entries.reduce((min,e)=>e.start_date<min?e.start_date:min,entries[0].start_date):today();
  }
  switchTab('deliveryTracker');
  state.ganttActiveView='timeline';
  state.ganttTimelineStartDate=mondayOf(startDate);
  switchGanttView('timeline');
  setTimeout(()=>{
    const row=document.querySelector(`.dt-ticket-row[data-ticket-id="${CSS.escape(String(ticketId))}"]`);
    if(row){
      row.scrollIntoView({behavior:'smooth',block:'center'});
      row.classList.add('dt-flash');
      setTimeout(()=>row.classList.remove('dt-flash'),1500);
    }
  },50);
}

// ══════════════════════════════════════════════════
// AGENDA VIEW (mobile-web only, <=768px) — day-by-day list over the same
// state.ganttTickets/state.ganttEntries as Timeline/Calendar. Reuses
// isTicketActive()/ticketColor() for filtering/coloring, and add/edit reuses
// the exact drag-to-fill write pipeline (computeOverlaps -> pending write ->
// openTypePicker -> selectTaskType -> replaceEntryRange) instead of a
// parallel Supabase call — see commitEntryWrite() above.
// ══════════════════════════════════════════════════
function collectAgendaDays(){
  const todayStr=today();
  const activeTickets=new Map(state.ganttTickets.filter(isTicketActive).map(t=>[t.id,t]));
  const dayMap={};
  state.ganttEntries.forEach(e=>{
    const ticket=activeTickets.get(e.ticket_id);
    if(!ticket||e.end_date<todayStr) return;
    let d=e.start_date<todayStr?todayStr:e.start_date;
    while(d<=e.end_date){
      (dayMap[d]=dayMap[d]||[]).push({entry:e,ticket});
      d=addDays(d,1);
    }
  });
  return Object.keys(dayMap).sort().map(date=>({date,items:dayMap[date]}));
}
// Groups collectAgendaDays()'s output (day sections that actually have entries) under
// week headers, reusing buildCalendarWeeks() — the same primitive desktop Calendar's
// month grid uses — so "week" means exactly the same thing here as it does there.
// buildCalendarWeeks() only enumerates Mon-Fri (that's all its month grid needs); we
// derive weekEnd=addDays(weekStart,6) (Sunday) ourselves purely so a weekend-spanning
// agenda entry (collectAgendaDays()'s while-loop walks every calendar day, weekends
// included) still buckets into the right week instead of being silently dropped.
function collectAgendaWeeks(){
  const dayEntries=collectAgendaDays();
  if(!dayEntries.length) return [];
  const monthKeys=new Set(dayEntries.map(d=>{
    const dt=parseISO(d.date);
    return `${dt.getFullYear()}-${dt.getMonth()}`;
  }));
  const weekStarts=new Set();
  monthKeys.forEach(key=>{
    const[y,m]=key.split('-').map(Number);
    buildCalendarWeeks(y,m).forEach(w=>weekStarts.add(w.weekStart));
  });
  const weekMap=new Map([...weekStarts].sort().map(ws=>[ws,{weekStart:ws,weekEnd:addDays(ws,6),days:[]}]));
  dayEntries.forEach(d=>{
    const ws=mondayOf(d.date);
    if(!weekMap.has(ws)) weekMap.set(ws,{weekStart:ws,weekEnd:addDays(ws,6),days:[]});
    weekMap.get(ws).days.push(d);
  });
  return [...weekMap.values()].filter(w=>w.days.length>0).sort((a,b)=>a.weekStart<b.weekStart?-1:1);
}
export function renderAgenda(){
  const wrap=document.getElementById('dtAgendaWrap');
  if(!wrap) return;
  const todayStr=today();
  const weeks=collectAgendaWeeks();
  wrap.innerHTML=weeks.length===0
    ?'<div class="note-empty">No upcoming scheduled work</div>'
    :weeks.map(week=>{
      const dayGroups=week.days.map(day=>{
        const cards=day.items.map(({entry,ticket})=>{
          const tt=state.ganttTaskTypes.find(x=>x.id===entry.task_type_id);
          return `<div class="dt-agenda-ticket-card" style="border-left-color:${esc(ticketColor(ticket))}" onclick="openAgendaEntryForm('${escJs(entry.id)}')">
            <span class="dt-agenda-ticket-cd">${esc(ticket.jira_key||ticket.project_name)}</span>
            ${tt?`<span class="dt-agenda-ticket-type" style="color:${esc(tt.color)}">${esc(tt.code)}</span>`:''}
          </div>`;
        }).join('');
        return `<div class="dt-agenda-day-group">
          <div class="dt-agenda-day-label">${fmtDM(day.date)}${day.date===todayStr?' · Today':''}</div>
          <div class="dt-agenda-day-tickets">${cards}</div>
        </div>`;
      }).join('');
      return `<div class="dt-agenda-week-group">
        <div class="dt-agenda-week-label">${fmtDM(week.weekStart)} – ${fmtDM(week.weekEnd)}</div>
        ${dayGroups}
      </div>`;
    }).join('');
}

export function openAgendaEntryForm(entryId){
  // editing an existing entry pre-fills the form with its current range; submitting simply
  // re-runs the same range through computeOverlaps()/openTypePicker(), which will find the
  // entry being edited as its own overlap and replace it via the existing confirm-and-replace
  // flow — no separate "edit" code path needed.
  const editing=entryId!=null?state.ganttEntries.find(e=>String(e.id)===String(entryId)):null;
  const activeTickets=state.ganttTickets.filter(isTicketActive);
  const ticketSel=document.getElementById('dtAgendaTicketSelect');
  ticketSel.innerHTML=activeTickets.map(t=>
    `<option value="${escJs(t.id)}">${esc(t.jira_key||t.project_name)}</option>`
  ).join('');
  ticketSel.value=editing?editing.ticket_id:(activeTickets[0]||{}).id||'';
  document.getElementById('dtAgendaStartDate').value=editing?editing.start_date:today();
  document.getElementById('dtAgendaEndDate').value=editing?editing.end_date:today();
  document.getElementById('dtAgendaEntryModalOverlay').classList.add('open');
}
export function closeAgendaEntryForm(){
  document.getElementById('dtAgendaEntryModalOverlay').classList.remove('open');
  // hygiene: don't leave a stale pending write around if the modal is dismissed without
  // a type being chosen (e.g. Cancel, or Escape) — openTypePicker()'s own flows clear this
  // on completion, but the modal-close path didn't.
  state.ganttPendingEntryWrite=null;
}
export function submitAgendaEntryForm(){
  const ticketId=document.getElementById('dtAgendaTicketSelect').value;
  const startDate=document.getElementById('dtAgendaStartDate').value;
  const endDate=document.getElementById('dtAgendaEndDate').value;
  if(!ticketId||!startDate||!endDate){alert('Ticket, start date, and end date are required.');return;}
  if(endDate<startDate){alert('End date must be on or after start date.');return;}
  const overlaps=computeOverlaps(ticketId,startDate,endDate);
  // anchor near the button the user actually tapped ("Next: choose type"), not the
  // list's "+ Add" trigger — grab the rect before closeAgendaEntryForm() closes the modal.
  const anchor=document.getElementById('dtAgendaNextBtn').getBoundingClientRect();
  const x=anchor.left,y=anchor.bottom+6;
  closeAgendaEntryForm(); // also clears any stale state.ganttPendingEntryWrite (hygiene)
  state.ganttPendingEntryWrite={ticketId,startDate,endDate,overlaps};
  // arm the same one-shot outside-click suppression desktop drag-to-fill uses
  // (handleDayPointerUp()) — without it, the trailing click of this same tap/gesture
  // bubbles to document's outside-click listener and immediately closes the popover
  // we're about to open, since e.target (the now-closed modal's button) isn't inside
  // #dtTypePickerPopover/.dt-day-cell.
  armPopoverOpenGuard();
  openTypePicker(x,y);
}

// ══════════════════════════════════════════════════
// VIEW SWITCHER
// ══════════════════════════════════════════════════
export function switchGanttView(view){
  state.ganttActiveView=view;
  document.getElementById('dtSubTabTimeline').classList.toggle('active',view==='timeline');
  document.getElementById('dtSubTabCalendar').classList.toggle('active',view==='calendar');
  document.getElementById('dtTimelineSubview').classList.toggle('active',view==='timeline');
  document.getElementById('dtCalendarSubview').classList.toggle('active',view==='calendar');
  if(view==='timeline') renderTimeline();
  else renderCalendar();
}

// ══════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════
export function initGanttTracker(){
  window.switchGanttView=switchGanttView;
  window.toggleGanttInactive=toggleGanttInactive;
  window.openTicketModal=openTicketModal;
  window.closeTicketModal=closeTicketModal;
  window.saveTicket=saveTicket;
  window.deleteTicket=deleteTicket;
  window.openTaskTypeModal=openTaskTypeModal;
  window.closeTaskTypeModal=closeTaskTypeModal;
  window.addTaskTypeRow=addTaskTypeRow;
  window.removeTaskTypeRow=removeTaskTypeRow;
  window.updateTaskTypeField=updateTaskTypeField;
  window.saveTaskTypes=saveTaskTypes;
  window.selectTaskType=selectTaskType;
  window.clearAssignment=clearAssignment;
  window.changeEntryType=changeEntryType;
  window.removeSingleEntry=removeSingleEntry;
  window.closeOverlapModal=closeOverlapModal;
  window.openTicketPopover=openTicketPopover;
  window.openOverflowPopover=openOverflowPopover;
  window.jumpToTimeline=jumpToTimeline;
  window.openAgendaEntryForm=openAgendaEntryForm;
  window.closeAgendaEntryForm=closeAgendaEntryForm;
  window.submitAgendaEntryForm=submitAgendaEntryForm;

  document.getElementById('dtStartDate').onchange=e=>setTimelineStartDate(e.target.value);
  document.getElementById('dtWeeksInput').onchange=e=>setTimelineWeeks(e.target.value);
  document.getElementById('dtPrevWeekBtn').onclick=()=>shiftTimelineWeek(-1);
  document.getElementById('dtNextWeekBtn').onclick=()=>shiftTimelineWeek(1);
  document.getElementById('dtAddTicketBtn').onclick=()=>openTicketModal();
  document.getElementById('dtManageTypesBtn').onclick=openTaskTypeModal;

  // ticket modal, task-type modal, and overlap-confirm modal's Cancel/Save/Delete/close
  // buttons are wired via inline onclick="" in index.html (matching this codebase's
  // dominant modal-wiring convention), not re-wired here. dtOverlapConfirmBtn's handler
  // is assigned per-call inside openOverlapConfirm() since it needs the pending callback.

  document.getElementById('dtCalPrevBtn').onclick=()=>shiftCalendarMonth(-1);
  document.getElementById('dtCalNextBtn').onclick=()=>shiftCalendarMonth(1);
  document.getElementById('dtCalShowInactive').onchange=toggleCalendarShowInactive;
  document.getElementById('dtAgendaAddBtn').onclick=()=>openAgendaEntryForm();

  // drag-to-fill: mousedown/mouseup delegated on the table, mouseover delegated (native
  // mouseenter doesn't bubble) for live range highlighting during drag
  const wrap=document.getElementById('dtTimelineWrap');
  wrap.addEventListener('pointerdown',handleDayPointerDown);
  document.addEventListener('pointermove',handleDayPointerMove);
  document.addEventListener('pointerup',handleDayPointerUp);

  // sticky-column resize handles — delegated on the header since header rows are re-rendered
  // on every renderTimelineHeader() call, so per-element listeners would be lost each time
  document.getElementById('dtTimelineHead').addEventListener('mousedown',e=>{
    const handle=e.target.closest('.dt-col-resize-handle');
    if(!handle) return;
    startColumnResize(e,handle.getAttribute('data-col'));
  });

  document.addEventListener('click',e=>{
    // A drag whose pointerdown/pointerup land on different .dt-day-cells still produces a
    // trailing native 'click', targeted at their common ancestor (e.g. the <tr>) rather than
    // either cell — which would otherwise look like an "outside" click on the very same
    // gesture that just opened the popover and close it before it's ever seen. See
    // armPopoverOpenGuard()/consumeOutsideClickSuppression() above.
    if(consumeOutsideClickSuppression()) return;
    if(!e.target.closest('#dtTypePickerPopover')&&!e.target.closest('.dt-day-cell')) closeTypePicker();
    if(!e.target.closest('#dtCalPopover')&&!e.target.closest('.dt-cal-bar')&&!e.target.closest('.dt-cal-overflow-chip')) closeCalPopover();
  });
}
