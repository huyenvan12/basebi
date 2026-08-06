// ══════════════════════════════════════════════════
// TASKS — log-to-task conversion (stable per-line anchors on Daily Note log lines)
// and the Tasks Kanban sub-tab (under Delivery Tracker). CRUD against the existing
// public.tasks table (owner_id-scoped RLS, schema already applied).
// ══════════════════════════════════════════════════
import { state } from './state.js';
import { esc } from './ui-helpers.js';
import { sb } from './supabase-client.js';
// Narrow, intentional circular imports (same pattern already used by notes.js<->daily-note.js
// and daily-note.js<->main.js): notes.js needs findTaskByLineId/stripLineId/LINE_ID_RE/
// reattachLineIds from this file for daily-note line rendering + edit-mode marker round-trip,
// and daily-note.js needs genLineId() for the capture-bar append. This file, in turn, needs
// saveOneNote/renderDetail/selectNote from notes.js, today() from daily-note.js, switchTab
// from main.js, and switchGanttView from gantt-tracker.js (which imports renderTasksView from
// here). Safe because every cross-call below happens inside function bodies, never at module
// top-level.
import { saveOneNote, renderDetail, selectNote } from './notes.js';
import { today } from './daily-note.js';
import { switchTab } from './main.js';
import { switchGanttView } from './gantt-tracker.js';

// ══════════════════════════════════════════════════
// LINE-ANCHOR MARKERS
// ══════════════════════════════════════════════════
export const LINE_ID_RE = /\^ln-([a-z0-9]{8})$/;
export const LINE_ID_STRIP_RE = /\s*\^ln-[a-z0-9]{8}\s*$/;

export function genLineId(){
  return 'ln-' + Math.random().toString(36).slice(2,10).padEnd(8,'0');
}
export function stripLineId(line){
  return (line||'').replace(LINE_ID_STRIP_RE,'');
}

// Lazy backfill for legacy lines (predate this feature) — mutates note.body in place by
// line index (not raw text, to avoid ambiguity when two lines have identical text) and saves.
export async function ensureLineId(note, lineIndex){
  const lines = (note.body||'').split('\n');
  const existing = (lines[lineIndex]||'').match(LINE_ID_RE);
  if(existing) return existing[1];
  const newId = genLineId();
  lines[lineIndex] = lines[lineIndex] + ` ^${newId}`;
  note.body = lines.join('\n');
  note.modified = today();
  await saveOneNote(note);
  return newId.replace(/^ln-/,'');
}

// Edit-mode round-trip: re-attach markers to the new body by content match first, index
// only as a tiebreaker, so inserting/deleting a line doesn't shift and drop every later
// marker. Each old marker is consumed at most once.
export function reattachLineIds(oldBody, newBody){
  const oldLines = (oldBody||'').split('\n');
  const newLines = (newBody||'').split('\n');
  const consumed = new Set();
  oldLines.forEach((oldLine, oldIdx)=>{
    const m = oldLine.match(LINE_ID_RE); if(!m) return;
    const text = stripLineId(oldLine).trim();
    let best=-1, bestDist=Infinity;
    newLines.forEach((newLine, newIdx)=>{
      if(consumed.has(newIdx)) return;
      if(stripLineId(newLine).trim()!==text) return;
      const dist=Math.abs(newIdx-oldIdx);
      if(dist<bestDist){ best=newIdx; bestDist=dist; }
    });
    if(best!==-1){ newLines[best]=newLines[best]+` ^ln-${m[1]}`; consumed.add(best); }
  });
  return newLines.join('\n');
}

export function findTaskByLineId(lineId){
  return state.tasks.find(t=>t.source_line_id===lineId);
}

// ══════════════════════════════════════════════════
// DATA LAYER
// ══════════════════════════════════════════════════
export async function loadTasks(){
  if(!state.currentUserId) return [];
  const{data,error}=await sb.from('tasks').select('*').eq('owner_id',state.currentUserId).order('created_at',{ascending:false});
  if(error||!data) return [];
  return data;
}
export async function insertTaskDB(fields){
  const{data,error}=await sb.from('tasks').insert(fields).select().single();
  if(error) throw error;
  return data;
}
export async function updateTaskDB(id,fields){
  const{data,error}=await sb.from('tasks').update(fields).eq('id',id).select().single();
  if(error) throw error;
  return data;
}
export async function deleteTaskDB(id){
  const{error}=await sb.from('tasks').delete().eq('id',id);
  if(error) throw error;
}

// ══════════════════════════════════════════════════
// STATE-ARRAY CRUD
// ══════════════════════════════════════════════════
export async function createTask({title,priority,dueDate,status,sourceNoteId,sourceLineId,sourceLineSnapshot}){
  const row=await insertTaskDB({
    owner_id: state.currentUserId,
    title,
    status: status||'todo',
    priority: priority||'medium',
    due_date: dueDate||null,
    source_note_id: sourceNoteId||null,
    source_line_id: sourceLineId||null,
    source_line_snapshot: sourceLineSnapshot||null
  });
  state.tasks.unshift(row);
  return row;
}
export async function updateTask(id,fields){
  const row=await updateTaskDB(id,fields);
  const idx=state.tasks.findIndex(t=>t.id===id);
  if(idx!==-1) state.tasks[idx]=row;
  return row;
}
export async function deleteTask(id){
  await deleteTaskDB(id);
  state.tasks=state.tasks.filter(t=>t.id!==id);
  if(state.ganttActiveView==='tasks') renderTasksView();
}
export async function setTaskStatus(id,status){
  await updateTask(id,{status,completed_at: status==='done' ? new Date().toISOString() : null});
  if(state.ganttActiveView==='tasks') renderTasksView();
}
export function onTaskStatusDropdownChange(taskId,newStatus){
  setTaskStatus(taskId,newStatus).catch(err=>alert('Could not update task: '+(err.message||err)));
}

// ══════════════════════════════════════════════════
// GROUPING / BUCKETING
// ══════════════════════════════════════════════════
function sortTasksByDue(list){
  return list.slice().sort((a,b)=>{
    if(!a.due_date && !b.due_date) return 0;
    if(!a.due_date) return 1;
    if(!b.due_date) return -1;
    return a.due_date<b.due_date?-1:a.due_date>b.due_date?1:0;
  });
}
export function dueDateBucket(dueDate){
  if(!dueDate) return 'none';
  const t=today();
  if(dueDate<t) return 'overdue';
  if(dueDate===t) return 'today';
  return 'upcoming';
}
export function dueDateDot(dueDate){
  const b=dueDateBucket(dueDate);
  if(b==='overdue') return {emoji:'🔴',cls:'due-overdue'};
  if(b==='today') return {emoji:'🟠',cls:'due-today'};
  return {emoji:'⚪',cls: b==='none'?'due-none':'due-upcoming'};
}
export function getTasksGroupedByStatus(){
  return {
    todo: sortTasksByDue(state.tasks.filter(t=>t.status==='todo')),
    doing: sortTasksByDue(state.tasks.filter(t=>t.status==='doing')),
    done: sortTasksByDue(state.tasks.filter(t=>t.status==='done'))
  };
}
export function getTasksGroupedByDueDate(){
  const groups={overdue:[],today:[],upcoming:[],noDueDate:[]};
  state.tasks.forEach(t=>{
    const b=dueDateBucket(t.due_date);
    if(b==='overdue') groups.overdue.push(t);
    else if(b==='today') groups.today.push(t);
    else if(b==='upcoming') groups.upcoming.push(t);
    else groups.noDueDate.push(t);
  });
  Object.keys(groups).forEach(k=>{groups[k]=sortTasksByDue(groups[k]);});
  return groups;
}
export function getTasksGroupedByPriority(){
  return {
    important: sortTasksByDue(state.tasks.filter(t=>t.priority==='important')),
    medium: sortTasksByDue(state.tasks.filter(t=>t.priority==='medium')),
    low: sortTasksByDue(state.tasks.filter(t=>t.priority==='low'))
  };
}

// ══════════════════════════════════════════════════
// POPOVER (create + edit, shared by Daily Note line icons and the Tasks board)
// ══════════════════════════════════════════════════
const CHEVRONS_RIGHT_SVG='<svg class="chevrons-right-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/></svg>';
// Lucide "link" glyph, hand-pasted per this codebase's no-library-import icon convention
// (see CHEVRONS_RIGHT_SVG above, MONITOR_TRASH_SVG in monitor-report.js). Used instead of
// the 🔗 emoji so has-task/no-task icon states are true SVG-to-SVG size matches — the emoji
// renders via system font and its size/baseline varies across OS/mobile browsers, breaking
// pixel alignment with .daily-line-icon's fixed box even after fixing the box itself.
// Scaled ~0.78x around the 12,12 center: the link glyph fills far more of its 24x24
// viewBox than the chevrons' two narrow arrow shapes, so at equal SVG dimensions the
// link icon reads visually larger/bolder despite both elements measuring 16x16.
const LINK_SVG='<svg class="link-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><g transform="translate(2.64,2.64) scale(0.78)"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></g></svg>';
export function dailyLineIconHtml(noteId, idx, hasTask){
  return hasTask
    ? `<span class="daily-line-icon has-task" title="View task" onclick="openTaskPopoverForLine(${noteId},${idx},event)">${LINK_SVG}</span>`
    : `<span class="daily-line-icon no-task" title="Create task" onclick="openTaskPopoverForLine(${noteId},${idx},event)">${CHEVRONS_RIGHT_SVG}</span>`;
}

export async function openTaskPopoverForLine(noteId, lineIndex, event){
  if(event) event.stopPropagation();
  if(state.taskLineBusy[noteId]) return;
  const note = state.notes.find(n=>n.id===noteId); if(!note) return;
  const lines = (note.body||'').split('\n');
  const rawLine = lines[lineIndex];
  if(rawLine===undefined) return;
  const iconEl = event && event.target ? event.target.closest('.daily-line-icon') : null;
  const rect = iconEl ? iconEl.getBoundingClientRect() : {left:80, bottom:120};
  let lineId = (rawLine.match(LINE_ID_RE)||[])[1];
  if(!lineId){
    state.taskLineBusy[noteId]=true;
    try{ lineId = await ensureLineId(note, lineIndex); }
    finally{ state.taskLineBusy[noteId]=false; }
    renderDetail(note);
  }
  const existingTask = findTaskByLineId(lineId);
  if(existingTask){
    openTaskPopover('edit', {x:rect.left, y:rect.bottom+4, taskId:existingTask.id});
  }else{
    const lineText = stripLineId(rawLine).trim();
    const titlePrefill = lineText.replace(/^\[\d{2}:\d{2}\]\s*/, '');
    openTaskPopover('create', {x:rect.left, y:rect.bottom+4, noteId, lineIndex, lineId, lineText, titlePrefill});
  }
}

export function openTaskPopover(mode, opts){
  state.taskPopoverOpen=true;
  state.taskPopoverMode=mode;
  state.taskPopoverCtx=opts;
  renderTaskPopover(mode, opts);
  const pop=document.getElementById('taskPopover');
  pop.style.display='block';
  const vw=window.innerWidth, vh=window.innerHeight, w=300, h=280;
  const x=Math.max(8, Math.min(opts.x||20, vw-w-8));
  const y=Math.max(8, Math.min(opts.y||20, vh-h-8));
  pop.style.left=x+'px';
  pop.style.top=y+'px';
}
export function closeTaskPopover(){
  state.taskPopoverOpen=false;
  const pop=document.getElementById('taskPopover');
  pop.style.display='none';
  pop.innerHTML='';
}
export function renderTaskPopover(mode, opts){
  const pop=document.getElementById('taskPopover');
  let title='', due='', priority='medium', taskId=null;
  if(mode==='edit'){
    const task=state.tasks.find(t=>t.id===opts.taskId);
    if(!task){ closeTaskPopover(); return; }
    title=task.title; due=task.due_date||''; priority=task.priority; taskId=task.id;
  }else{
    title=opts.titlePrefill||opts.lineText||'';
    priority=opts.presetPriority||'medium';
  }
  pop.innerHTML=`<div class="task-popover-inner">
    <div class="task-popover-title-row">
      <strong>${mode==='edit'?'Task':'Create task'}</strong>
      <button type="button" class="modal-close" onclick="closeTaskPopover()">×</button>
    </div>
    <label class="task-popover-label">Title</label>
    <input type="text" id="taskPopoverTitle" class="task-popover-input" value="${esc(title)}">
    <label class="task-popover-label">Due date <span class="task-popover-label-optional">(optional)</span></label>
    <input type="date" id="taskPopoverDue" class="task-popover-input" value="${esc(due)}">
    <label class="task-popover-label">Priority</label>
    <div class="task-priority-selector">
      <button type="button" class="task-priority-opt tpo-important ${priority==='important'?'active':''}" data-priority="important" onclick="selectTaskPopoverPriority(this)">Important</button>
      <button type="button" class="task-priority-opt tpo-medium ${priority==='medium'?'active':''}" data-priority="medium" onclick="selectTaskPopoverPriority(this)">Medium</button>
      <button type="button" class="task-priority-opt tpo-low ${priority==='low'?'active':''}" data-priority="low" onclick="selectTaskPopoverPriority(this)">Low</button>
    </div>
    ${mode==='edit'?`<button type="button" class="btn btn-ghost task-popover-jump-btn" onclick="jumpToTaskCard('${taskId}')">View in Tasks tab →</button>`:''}
    <div class="task-popover-actions">
      <button type="button" class="btn btn-ghost" onclick="closeTaskPopover()">Cancel</button>
      <button type="button" class="btn btn-primary" onclick="submitTaskPopover()">${mode==='edit'?'Save':'Create task'}</button>
    </div>
  </div>`;
  setTimeout(()=>{ const el=document.getElementById('taskPopoverTitle'); if(el) el.focus(); },30);
}
export function selectTaskPopoverPriority(btn){
  btn.parentElement.querySelectorAll('.task-priority-opt').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
}
export async function submitTaskPopover(){
  const titleEl=document.getElementById('taskPopoverTitle');
  const dueEl=document.getElementById('taskPopoverDue');
  const activeBtn=document.querySelector('#taskPopover .task-priority-opt.active');
  const title=titleEl.value.trim();
  const dueDate=dueEl.value||null;
  const priority=activeBtn?activeBtn.dataset.priority:'medium';
  if(!title){titleEl.focus();return;}
  const ctx=state.taskPopoverCtx||{};
  try{
    if(state.taskPopoverMode==='edit'){
      await updateTask(ctx.taskId,{title,due_date:dueDate,priority});
    }else{
      await createTask({
        title, priority, dueDate,
        status: ctx.presetStatus||'todo',
        sourceNoteId: ctx.noteId||null,
        sourceLineId: ctx.lineId||null,
        sourceLineSnapshot: ctx.lineText||null
      });
    }
  }catch(err){ alert('Could not save task: '+(err.message||err)); return; }
  closeTaskPopover();
  const note = ctx.noteId ? state.notes.find(n=>n.id===ctx.noteId) : null;
  if(note) renderDetail(note);
  if(state.ganttActiveView==='tasks') renderTasksView();
}

export function jumpToTaskCard(taskId){
  closeTaskPopover();
  switchTab('deliveryTracker');
  switchGanttView('tasks');
  setTimeout(()=>{
    const card=document.querySelector(`.task-card[data-task-id="${taskId}"]`);
    if(card){
      card.scrollIntoView({behavior:'smooth',block:'center'});
      card.classList.add('task-card-highlight');
      setTimeout(()=>card.classList.remove('task-card-highlight'),1600);
    }
  },80);
}
export function jumpToSourceNote(noteId, lineId){
  closeTaskPopover();
  switchTab('notes');
  const note=state.notes.find(n=>n.id===noteId);
  if(note) selectNote(note.id);
  if(lineId){
    setTimeout(()=>{
      const lineEl=document.querySelector(`.daily-log-line[data-line-id="${lineId}"]`);
      if(lineEl){
        lineEl.scrollIntoView({behavior:'smooth',block:'center'});
        lineEl.classList.add('daily-log-line-highlight');
        setTimeout(()=>lineEl.classList.remove('daily-log-line-highlight'),1600);
      }
    },150);
  }
}

// ══════════════════════════════════════════════════
// TASKS TAB UI (Kanban board)
// ══════════════════════════════════════════════════
export function setTasksGroupBy(mode){
  state.tasksGroupBy=mode;
  document.getElementById('taskGbStatus').classList.toggle('active',mode==='status');
  document.getElementById('taskGbDue').classList.toggle('active',mode==='due');
  document.getElementById('taskGbPriority').classList.toggle('active',mode==='priority');
  renderTasksView();
}
export function renderTasksView(){
  const wrap=document.getElementById('taskKanbanWrap');
  if(!wrap) return;
  let columns;
  if(state.tasksGroupBy==='due'){
    const g=getTasksGroupedByDueDate();
    columns=[
      {key:'noDueDate',cls:'tc-nodue',label:'No due date',tasks:g.noDueDate},
      {key:'upcoming',cls:'tc-upcoming',label:'Upcoming',tasks:g.upcoming},
      {key:'today',cls:'tc-today',label:'Today',tasks:g.today},
      {key:'overdue',cls:'tc-overdue',label:'Overdue',tasks:g.overdue}
    ];
  }else if(state.tasksGroupBy==='priority'){
    const g=getTasksGroupedByPriority();
    columns=[
      {key:'low',cls:'tc-low',label:'Low',tasks:g.low},
      {key:'medium',cls:'tc-medium',label:'Medium',tasks:g.medium},
      {key:'important',cls:'tc-important',label:'Important',tasks:g.important}
    ];
  }else{
    const g=getTasksGroupedByStatus();
    columns=[
      {key:'todo',cls:'tc-todo',label:'To do',tasks:g.todo},
      {key:'doing',cls:'tc-doing',label:'Doing',tasks:g.doing},
      {key:'done',cls:'tc-done',label:'Done',tasks:g.done}
    ];
  }
  wrap.innerHTML=columns.map(col=>`<div class="task-column ${col.cls}">
    <div class="task-column-header">
      <span class="task-column-label">${esc(col.label)}</span>
      <span class="task-column-count">${col.tasks.length}</span>
      <button type="button" class="task-add-btn" onclick="openAddTaskInline('${col.key}')" title="Add task">+ Add task</button>
    </div>
    <div class="task-column-body">
      ${col.tasks.length ? col.tasks.map(renderTaskCard).join('') : '<div class="task-column-empty">No tasks</div>'}
    </div>
  </div>`).join('');
}
export function renderTaskCard(task){
  const dot=dueDateDot(task.due_date);
  const dueLabel=task.due_date||'No due date';
  const prioClass = task.priority==='important'?'tpb-important':task.priority==='low'?'tpb-low':'tpb-medium';
  const prioLabel = task.priority.charAt(0).toUpperCase()+task.priority.slice(1);
  const linkIcon = task.source_note_id
    ? `<span class="task-card-link" title="Go to source Daily Note" onclick="event.stopPropagation();jumpToSourceNote(${task.source_note_id},'${task.source_line_id||''}')">${LINK_SVG}</span>`
    : '';
  return `<div class="task-card" data-task-id="${task.id}" onclick="openTaskPopoverForCard('${task.id}',event)">
    <div class="task-card-title">${esc(task.title)}</div>
    <div class="task-card-meta">
      <span class="task-due-dot ${dot.cls}" title="${dueDateBucket(task.due_date)}">${dot.emoji}</span>
      <span class="task-due-label">${esc(dueLabel)}</span>
      <span class="task-priority-badge ${prioClass}">${prioLabel}</span>
      ${linkIcon}
    </div>
    <select class="task-status-select" onclick="event.stopPropagation()" onchange="onTaskStatusDropdownChange('${task.id}',this.value)">
      <option value="todo" ${task.status==='todo'?'selected':''}>To do</option>
      <option value="doing" ${task.status==='doing'?'selected':''}>Doing</option>
      <option value="done" ${task.status==='done'?'selected':''}>Done</option>
    </select>
  </div>`;
}
export function openTaskPopoverForCard(taskId, event){
  if(event) event.stopPropagation();
  const rect = event && event.currentTarget ? event.currentTarget.getBoundingClientRect() : {left:80,bottom:120};
  openTaskPopover('edit', {x:rect.left, y:rect.bottom+4, taskId});
}
export function openAddTaskInline(column){
  const ctx={x:window.innerWidth/2-150, y:140};
  if(state.tasksGroupBy==='status') ctx.presetStatus=column;
  else if(state.tasksGroupBy==='priority') ctx.presetPriority=column;
  openTaskPopover('create', ctx);
}

// ══════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════
export function initTasks(){
  window.openTaskPopoverForLine=openTaskPopoverForLine;
  window.openTaskPopoverForCard=openTaskPopoverForCard;
  window.openTaskPopover=openTaskPopover;
  window.closeTaskPopover=closeTaskPopover;
  window.selectTaskPopoverPriority=selectTaskPopoverPriority;
  window.submitTaskPopover=submitTaskPopover;
  window.setTasksGroupBy=setTasksGroupBy;
  window.onTaskStatusDropdownChange=onTaskStatusDropdownChange;
  window.openAddTaskInline=openAddTaskInline;
  window.jumpToTaskCard=jumpToTaskCard;
  window.jumpToSourceNote=jumpToSourceNote;

  // Outside-click-to-close, same pattern as #dtTypePickerPopover/#dtCalPopover in
  // gantt-tracker.js. Trigger elements that open the popover without stopPropagation()
  // (openAddTaskInline's "+ Add task" button) must be excluded here, or the same click
  // that opens the popover would immediately close it again on bubble.
  document.addEventListener('click',e=>{
    if(!state.taskPopoverOpen) return;
    if(e.target.closest('#taskPopover')) return;
    if(e.target.closest('.daily-line-icon')) return;
    if(e.target.closest('.task-card')) return;
    if(e.target.closest('.task-add-btn')) return;
    closeTaskPopover();
  });
}
