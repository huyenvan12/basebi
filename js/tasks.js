// ══════════════════════════════════════════════════
// TASKS — log-to-task conversion (stable per-line anchors on Daily Note log lines)
// and the Tasks Kanban sub-tab (under Delivery Tracker). CRUD against the existing
// public.tasks table (owner_id-scoped RLS, schema already applied).
// ══════════════════════════════════════════════════
import { state } from './state.js';
import { esc, escJs, showNotification } from './ui-helpers.js';
import { sb } from './supabase-client.js';
// Narrow, intentional circular imports (same pattern already used by notes.js<->daily-note.js
// and daily-note.js<->main.js): notes.js needs findTaskByLineId/stripLineId/LINE_ID_RE/
// reattachLineIds from this file for daily-note line rendering + edit-mode marker round-trip,
// and daily-note.js needs genLineId() for the capture-bar append. This file, in turn, needs
// saveOneNote/renderDetail/selectNote from notes.js, today() from daily-note.js, switchTab
// from main.js, and switchGanttView/openConfirmModal from gantt-tracker.js (which imports
// renderTasksView from here). Safe because every cross-call below happens inside function
// bodies, never at module top-level.
import { saveOneNote, renderDetail, selectNote } from './notes.js';
import { today } from './daily-note.js';
import { switchTab } from './main.js';
import { switchGanttView, openConfirmModal } from './gantt-tracker.js';

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
export async function createTask({title,priority,dueDate,status,sourceNoteId,sourceLineId,sourceLineSnapshot,followUpOfTaskId}){
  const row=await insertTaskDB({
    owner_id: state.currentUserId,
    title,
    status: status||'todo',
    priority: priority||'medium',
    due_date: dueDate||null,
    source_note_id: sourceNoteId||null,
    source_line_id: sourceLineId||null,
    source_line_snapshot: sourceLineSnapshot||null,
    follow_up_of_task_id: followUpOfTaskId||null
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
  setTaskStatus(taskId,newStatus).catch(err=>showNotification('Could not update task: '+(err.message||err),'error'));
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
    done: sortTasksByDue(state.tasks.filter(t=>t.status==='done')),
    archived: sortTasksByDue(state.tasks.filter(t=>t.status==='archived'))
  };
}
export function getTasksGroupedByDueDate(){
  const groups={overdue:[],today:[],upcoming:[],noDueDate:[]};
  state.tasks.filter(t=>t.status!=='archived').forEach(t=>{
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
  const active=state.tasks.filter(t=>t.status!=='archived');
  return {
    important: sortTasksByDue(active.filter(t=>t.priority==='important')),
    medium: sortTasksByDue(active.filter(t=>t.priority==='medium')),
    low: sortTasksByDue(active.filter(t=>t.priority==='low'))
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
    ? `<span class="daily-line-icon has-task" title="View task" onclick="openTaskPopoverForLine('${noteId}',${idx},event)">${LINK_SVG}</span>`
    : `<span class="daily-line-icon no-task" title="Create task" onclick="openTaskPopoverForLine('${noteId}',${idx},event)">${CHEVRONS_RIGHT_SVG}</span>`;
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
    openTaskModal(existingTask.id, {openedFrom:'dailyNote'});
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
// mode/opts kept for call-site compatibility (openAddTaskInline, openTaskPopoverForLine's
// no-task branch, createFollowUpTask) but this popover is create-mode only now — task editing
// (title/comment/links) lives in the bigger #taskModalOverlay via openTaskModal().
export function renderTaskPopover(mode, opts){
  const pop=document.getElementById('taskPopover');
  const title=opts.titlePrefill||opts.lineText||'';
  const priority=opts.presetPriority||'medium';
  const due=today(); // convenience default only — field stays fully editable/clearable
  pop.innerHTML=`<div class="task-popover-inner">
    <div class="task-popover-title-row">
      <strong>Create task</strong>
      <button type="button" class="modal-close" onclick="closeTaskPopover()">×</button>
    </div>
    <label class="task-popover-label">Title</label>
    <input type="text" id="taskPopoverTitle" class="form-input-compact task-popover-input" value="${esc(title)}">
    <label class="task-popover-label">Due date <span class="task-popover-label-optional">(optional)</span></label>
    <input type="date" id="taskPopoverDue" class="form-input-compact task-popover-input" value="${esc(due)}">
    <label class="task-popover-label">Priority</label>
    <div class="task-priority-selector">
      <button type="button" class="task-priority-opt tpo-important ${priority==='important'?'active':''}" data-priority="important" onclick="selectTaskPopoverPriority(this)">Important</button>
      <button type="button" class="task-priority-opt tpo-medium ${priority==='medium'?'active':''}" data-priority="medium" onclick="selectTaskPopoverPriority(this)">Medium</button>
      <button type="button" class="task-priority-opt tpo-low ${priority==='low'?'active':''}" data-priority="low" onclick="selectTaskPopoverPriority(this)">Low</button>
    </div>
    <div class="task-popover-actions">
      <button type="button" class="btn btn-ghost" onclick="closeTaskPopover()">Cancel</button>
      <button type="button" class="btn btn-primary" onclick="submitTaskPopover()">Create task</button>
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
    await createTask({
      title, priority, dueDate,
      status: ctx.presetStatus||'todo',
      sourceNoteId: ctx.noteId||null,
      sourceLineId: ctx.lineId||null,
      sourceLineSnapshot: ctx.lineText||null,
      followUpOfTaskId: ctx.followUpOfTaskId||null
    });
  }catch(err){ showNotification('Could not save task: '+(err.message||err),'error'); return; }
  closeTaskPopover();
  const note = ctx.noteId ? state.notes.find(n=>n.id===ctx.noteId) : null;
  if(note) renderDetail(note);
  if(state.ganttActiveView==='tasks') renderTasksView();
}

export function jumpToTaskCard(taskId){
  closeTaskPopover();
  closeTaskModalForced();
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
  closeTaskModalForced();
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
// TASK DETAIL MODAL — edit mode only (title, comment, forward links as chips, reverse
// "referenced by" list). Centered .modal.modal-sm dialog, distinct from the small anchored
// #taskPopover above (which stays create-only: due date/priority quick-add doesn't need
// room for comment/links). Title+Comment are a single Save/Cancel unit (not autosaved);
// link/unlink is instant-apply since it's a discrete selection action, not in-progress text.
// Reverse relations are pure state.tasks filters — no extra query, always fresh because
// updateTask() keeps state.tasks in sync in place.
// ══════════════════════════════════════════════════
function currentTaskModalTask(){
  return state.tasks.find(t=>t.id===state.taskModalTaskId);
}
export function openTaskModal(taskId, ctx={}){
  const task=state.tasks.find(t=>t.id===taskId);
  if(!task) return;
  state.taskModalOpen=true;
  state.taskModalTaskId=taskId;
  state.taskModalCtx=ctx;
  state.taskModalOpenedWith={title:task.title, comment:task.comment||''};
  state.taskModalDirty=false;
  state.taskLinkPickerOpen=false;
  state.taskLinkPickerField=null;
  renderTaskModal();
  document.getElementById('taskModalOverlay').classList.add('open');
}
// Shared gate for every path that wants to close/leave the task modal (× / Cancel / click-outside /
// "+ Create follow-up task") — keeps the unsaved-changes confirm in exactly one place so new close
// paths can't accidentally bypass it (see createFollowUpTask()).
function confirmDiscardIfDirty(onProceed){
  if(state.taskModalDirty){
    openConfirmModal('You have unsaved changes. Are you sure you want to close?', async()=>{ onProceed(); }, {confirmLabel:'Close', danger:true});
    return;
  }
  onProceed();
}
export function closeTaskModal(){
  confirmDiscardIfDirty(closeTaskModalForced);
}
function closeTaskModalForced(){
  state.taskModalOpen=false;
  state.taskModalTaskId=null;
  state.taskModalCtx=null;
  state.taskModalOpenedWith=null;
  state.taskModalDirty=false;
  state.taskLinkPickerOpen=false;
  state.taskLinkPickerField=null;
  const overlay=document.getElementById('taskModalOverlay');
  if(overlay) overlay.classList.remove('open');
  const inner=document.getElementById('taskModalInner');
  if(inner) inner.innerHTML='';
}
export function onTaskModalFieldInput(){
  const titleEl=document.getElementById('taskModalTitle');
  const commentEl=document.getElementById('taskModalComment');
  const opened=state.taskModalOpenedWith||{title:'',comment:''};
  state.taskModalDirty = (titleEl&&titleEl.value!==opened.title) || (commentEl&&commentEl.value!==opened.comment);
}
export async function saveTaskModal(){
  const task=currentTaskModalTask();
  if(!task) return;
  const titleEl=document.getElementById('taskModalTitle');
  const commentEl=document.getElementById('taskModalComment');
  const title=titleEl.value.trim();
  if(!title){ titleEl.focus(); return; }
  const comment=commentEl.value;
  try{ await updateTask(task.id,{title,comment}); }
  catch(err){ showNotification('Could not save task: '+(err.message||err),'error'); return; }
  state.taskModalDirty=false;
  closeTaskModalForced();
  if(state.ganttActiveView==='tasks') renderTasksView();
}

const TASK_LINK_ARROW_SVG='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>';
const TASK_LOCK_SVG='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
const TASK_LOCK_OPEN_SVG='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.5-2.5"/></svg>';

function renderTaskLinkChip(linkedTask, field){
  if(field==='follow_up_of_task_id'){
    return `<span class="task-link-chip follow-up">${TASK_LINK_ARROW_SVG}<span>${esc(linkedTask.title)}</span><button type="button" onclick="unlinkTaskField('follow_up_of_task_id')" title="Unlink">×</button></span>`;
  }
  const resolved=linkedTask.status==='done';
  return `<span class="task-link-chip ${resolved?'depends-resolved':'depends-blocked'}">${resolved?TASK_LOCK_OPEN_SVG:TASK_LOCK_SVG}<span>${esc(linkedTask.title)}</span><button type="button" onclick="unlinkTaskField('depends_on_task_id')" title="Unlink">×</button></span>`;
}

export function renderTaskModal(){
  const task=currentTaskModalTask();
  if(!task){ closeTaskModalForced(); return; }
  const followUp=task.follow_up_of_task_id ? state.tasks.find(t=>t.id===task.follow_up_of_task_id) : null;
  const dependsOn=task.depends_on_task_id ? state.tasks.find(t=>t.id===task.depends_on_task_id) : null;
  const bothSet=!!(task.follow_up_of_task_id && task.depends_on_task_id);
  const referencedBy=state.tasks.filter(t=>t.follow_up_of_task_id===task.id);
  const blocks=state.tasks.filter(t=>t.depends_on_task_id===task.id);
  const hasReferences=referencedBy.length>0 || blocks.length>0;
  const ctx=state.taskModalCtx||{};

  const inner=document.getElementById('taskModalInner');
  inner.innerHTML=`
    <div class="modal-title">
      <span>Task</span>
      <button type="button" class="modal-close" onclick="closeTaskModal()">×</button>
    </div>
    ${task.source_note_id?`<button type="button" class="task-modal-source-link" onclick="jumpToSourceNote('${escJs(task.source_note_id)}','${escJs(task.source_line_id||'')}')">↳ View source Daily Note line</button>`:''}
    ${ctx.openedFrom==='dailyNote'?`<button type="button" class="task-modal-source-link" onclick="jumpToTaskCard('${escJs(task.id)}')">View in Tasks tab →</button>`:''}
    <div class="form-row">
      <label class="form-label">Title</label>
      <input type="text" class="form-input" id="taskModalTitle" value="${esc(task.title)}" oninput="onTaskModalFieldInput()">
    </div>
    <div class="form-row">
      <label class="form-label">Comment</label>
      <textarea class="form-input" id="taskModalComment" rows="2" placeholder="Note anything worth remembering..." oninput="onTaskModalFieldInput()">${esc(task.comment||'')}</textarea>
    </div>
    <div class="task-modal-divider"></div>
    <div class="task-modal-links-header">
      <span class="task-modal-links-title">${TASK_LINK_ARROW_SVG} Links</span>
      <button type="button" class="task-modal-quick-action" onclick="event.stopPropagation();createFollowUpTask()">+ Create follow-up task</button>
    </div>
    <div class="form-row" style="gap:8px">
      <div class="task-link-row">
        <span class="task-link-row-label">Follows up on</span>
        ${followUp?renderTaskLinkChip(followUp,'follow_up_of_task_id'):'<span class="task-referenced-label">—</span>'}
      </div>
      <div class="task-link-row">
        <span class="task-link-row-label">Depends on</span>
        ${dependsOn?renderTaskLinkChip(dependsOn,'depends_on_task_id'):'<span class="task-referenced-label">—</span>'}
      </div>
      <div class="task-link-add-row${bothSet?' is-disabled':''}" ${bothSet?'':'onclick="openTaskLinkPicker()"'}>
        <span>+</span><span>Link an existing task</span>
      </div>
      <div class="selector-wrap" id="taskLinkPickerWrap" style="display:none">
        <div class="task-link-field-toggle">
          <button type="button" class="task-link-field-btn" id="taskLinkFieldBtnFollowUp" onclick="selectTaskLinkField('follow_up_of_task_id')">Follows up on</button>
          <button type="button" class="task-link-field-btn" id="taskLinkFieldBtnDependsOn" onclick="selectTaskLinkField('depends_on_task_id')">Depends on</button>
        </div>
        <div class="selector-input-row">
          <input type="text" class="form-input" id="taskLinkPickerInput" placeholder="Search your tasks…" autocomplete="off" oninput="filterTaskLinkPicker()">
        </div>
        <div class="dropdown-list open" id="taskLinkPickerDropdown"></div>
      </div>
    </div>
    ${hasReferences?`
    <div class="task-modal-divider"></div>
    <div class="task-referenced-label">Referenced by other tasks · click to open</div>
    <div style="display:flex;flex-direction:column;gap:4px">
      ${referencedBy.map(t=>`<div class="task-referenced-row" onclick="jumpToReferencedTask('${escJs(t.id)}')"><span class="task-referenced-kind">${TASK_LINK_ARROW_SVG} Followed up by</span><span class="task-referenced-title">${esc(t.title)}</span></div>`).join('')}
      ${blocks.map(t=>`<div class="task-referenced-row" onclick="jumpToReferencedTask('${escJs(t.id)}')"><span class="task-referenced-kind">${TASK_LOCK_OPEN_SVG} Blocks</span><span class="task-referenced-title">${esc(t.title)}</span></div>`).join('')}
    </div>`:''}
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" onclick="closeTaskModal()">Cancel</button>
      <button type="button" class="btn btn-primary" onclick="saveTaskModal()">Save</button>
    </div>
  `;
}

function updateTaskLinkFieldButtons(){
  const task=currentTaskModalTask();
  if(!task) return;
  const followBtn=document.getElementById('taskLinkFieldBtnFollowUp');
  const dependsBtn=document.getElementById('taskLinkFieldBtnDependsOn');
  if(followBtn){
    followBtn.disabled=!!task.follow_up_of_task_id;
    followBtn.classList.toggle('is-disabled',!!task.follow_up_of_task_id);
    followBtn.classList.toggle('active',state.taskLinkPickerField==='follow_up_of_task_id');
  }
  if(dependsBtn){
    dependsBtn.disabled=!!task.depends_on_task_id;
    dependsBtn.classList.toggle('is-disabled',!!task.depends_on_task_id);
    dependsBtn.classList.toggle('active',state.taskLinkPickerField==='depends_on_task_id');
  }
}
export function selectTaskLinkField(field){
  const task=currentTaskModalTask();
  if(!task) return;
  if(task[field]) return; // that slot is already taken — button is disabled, this is a no-op safety net
  state.taskLinkPickerField=field;
  updateTaskLinkFieldButtons();
  const input=document.getElementById('taskLinkPickerInput');
  if(input) input.focus();
}
export function openTaskLinkPicker(){
  const task=currentTaskModalTask();
  if(!task || (task.follow_up_of_task_id && task.depends_on_task_id)) return;
  state.taskLinkPickerOpen=true;
  // default to whichever slot is free; if both are free, default to "Follows up on" —
  // the user can still toggle to "Depends on" before searching.
  state.taskLinkPickerField=task.follow_up_of_task_id ? 'depends_on_task_id' : 'follow_up_of_task_id';
  const wrap=document.getElementById('taskLinkPickerWrap');
  if(wrap) wrap.style.display='block';
  updateTaskLinkFieldButtons();
  const input=document.getElementById('taskLinkPickerInput');
  if(input) input.value='';
  filterTaskLinkPicker();
  if(input) input.focus();
}
export function closeTaskLinkPicker(){
  state.taskLinkPickerOpen=false;
  state.taskLinkPickerField=null;
  const wrap=document.getElementById('taskLinkPickerWrap');
  if(wrap) wrap.style.display='none';
}
export function filterTaskLinkPicker(){
  const task=currentTaskModalTask();
  if(!task) return;
  const input=document.getElementById('taskLinkPickerInput');
  const q=(input&&input.value||'').toLowerCase().trim();
  const candidates=state.tasks.filter(t=>t.id!==task.id && t.status!=='archived');
  const filtered=q?candidates.filter(t=>t.title.toLowerCase().includes(q)):candidates;
  const dd=document.getElementById('taskLinkPickerDropdown');
  if(!dd) return;
  dd.innerHTML=filtered.length
    ?filtered.map(t=>`<div class="dropdown-item" onclick="assignTaskLink('${escJs(t.id)}')">${esc(t.title)}</div>`).join('')
    :'<div class="dropdown-empty">No tasks found</div>';
}
export async function assignTaskLink(linkedTaskId){
  const task=currentTaskModalTask();
  if(!task) return;
  const field=state.taskLinkPickerField || (!task.follow_up_of_task_id ? 'follow_up_of_task_id' : 'depends_on_task_id');
  try{ await updateTask(task.id,{[field]:linkedTaskId}); }
  catch(err){ showNotification('Could not link task: '+(err.message||err),'error'); return; }
  closeTaskLinkPicker();
  renderTaskModal();
  if(state.ganttActiveView==='tasks') renderTasksView();
}
export async function unlinkTaskField(field){
  const task=currentTaskModalTask();
  if(!task) return;
  try{ await updateTask(task.id,{[field]:null}); }
  catch(err){ showNotification('Could not unlink task: '+(err.message||err),'error'); return; }
  renderTaskModal();
  if(state.ganttActiveView==='tasks') renderTasksView();
}
export function createFollowUpTask(){
  const task=currentTaskModalTask();
  if(!task) return;
  const followUpOfTaskId=task.id;
  const title=task.title;
  // Still gated by the Task Detail Modal's own dirty-check (confirmDiscardIfDirty) — that part is
  // unrelated to the follow-up modal below and must stay, since it's protecting *leaving the modal
  // we're currently in*, not the new one we're about to open.
  confirmDiscardIfDirty(()=>{
    closeTaskModalForced();
    openTaskFollowUpModal(followUpOfTaskId, title);
  });
}
export function jumpToReferencedTask(taskId){
  openTaskModal(taskId);
}

// ══════════════════════════════════════════════════
// FOLLOW-UP TASK CREATE MODAL — centered .modal-overlay/.modal-sm dialog, same content as the
// create-mode #taskPopover (title/due/priority) but reachable only from createFollowUpTask().
// Deliberately has NO unsaved-changes confirm on close (unlike #taskModalOverlay) — this is a
// short quick-create form, so × / Cancel always discard immediately regardless of what was typed.
// Kanban "+ Add task" and the Daily Note create-task icon are unaffected: they keep using the
// lightweight anchored #taskPopover, unchanged.
// ══════════════════════════════════════════════════
export function openTaskFollowUpModal(followUpOfTaskId, parentTitle){
  state.taskFollowUpModalCtx={followUpOfTaskId, titlePrefill:'Follow-up: '+parentTitle};
  renderTaskFollowUpModal();
  document.getElementById('taskFollowUpModalOverlay').classList.add('open');
  setTimeout(()=>{ const el=document.getElementById('taskFollowUpModalTitle'); if(el){ el.focus(); el.select(); } },30);
}
export function closeTaskFollowUpModal(){
  state.taskFollowUpModalCtx=null;
  const overlay=document.getElementById('taskFollowUpModalOverlay');
  if(overlay) overlay.classList.remove('open');
  const inner=document.getElementById('taskFollowUpModalInner');
  if(inner) inner.innerHTML='';
}
function renderTaskFollowUpModal(){
  const ctx=state.taskFollowUpModalCtx||{};
  const title=ctx.titlePrefill||'';
  const due=today(); // convenience default only — field stays fully editable/clearable
  const inner=document.getElementById('taskFollowUpModalInner');
  inner.innerHTML=`
    <div class="modal-title">
      <span>Create follow-up task</span>
      <button type="button" class="modal-close" onclick="closeTaskFollowUpModal()">×</button>
    </div>
    <div class="form-row">
      <label class="form-label">Title</label>
      <input type="text" class="form-input" id="taskFollowUpModalTitle" value="${esc(title)}">
    </div>
    <div class="form-row">
      <label class="form-label">Due date <span class="task-popover-label-optional">(optional)</span></label>
      <input type="date" class="form-input" id="taskFollowUpModalDue" value="${esc(due)}">
    </div>
    <div class="form-row">
      <label class="form-label">Priority</label>
      <div class="task-priority-selector">
        <button type="button" class="task-priority-opt tpo-important" data-priority="important" onclick="selectTaskFollowUpModalPriority(this)">Important</button>
        <button type="button" class="task-priority-opt tpo-medium active" data-priority="medium" onclick="selectTaskFollowUpModalPriority(this)">Medium</button>
        <button type="button" class="task-priority-opt tpo-low" data-priority="low" onclick="selectTaskFollowUpModalPriority(this)">Low</button>
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" onclick="closeTaskFollowUpModal()">Cancel</button>
      <button type="button" class="btn btn-primary" onclick="submitTaskFollowUpModal()">Create task</button>
    </div>
  `;
}
export function selectTaskFollowUpModalPriority(btn){
  btn.parentElement.querySelectorAll('.task-priority-opt').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
}
export async function submitTaskFollowUpModal(){
  const titleEl=document.getElementById('taskFollowUpModalTitle');
  const dueEl=document.getElementById('taskFollowUpModalDue');
  const activeBtn=document.querySelector('#taskFollowUpModalInner .task-priority-opt.active');
  const title=titleEl.value.trim();
  const dueDate=dueEl.value||null;
  const priority=activeBtn?activeBtn.dataset.priority:'medium';
  if(!title){ titleEl.focus(); return; }
  const ctx=state.taskFollowUpModalCtx||{};
  try{
    await createTask({
      title, priority, dueDate,
      status:'todo',
      followUpOfTaskId: ctx.followUpOfTaskId||null
    });
  }catch(err){ showNotification('Could not save task: '+(err.message||err),'error'); return; }
  closeTaskFollowUpModal();
  if(state.ganttActiveView==='tasks') renderTasksView();
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
      {key:'today',cls:'tc-today',label:'Today',tasks:g.today},
      {key:'upcoming',cls:'tc-upcoming',label:'Upcoming',tasks:g.upcoming},
      {key:'overdue',cls:'tc-overdue',label:'Overdue',tasks:g.overdue},
      {key:'noDueDate',cls:'tc-nodue',label:'No due date',tasks:g.noDueDate}
    ];
  }else if(state.tasksGroupBy==='priority'){
    const g=getTasksGroupedByPriority();
    columns=[
      {key:'important',cls:'tc-important',label:'Important',tasks:g.important},
      {key:'medium',cls:'tc-medium',label:'Medium',tasks:g.medium},
      {key:'low',cls:'tc-low',label:'Low',tasks:g.low}
    ];
  }else{
    const g=getTasksGroupedByStatus();
    columns=[
      {key:'todo',cls:'tc-todo',label:'To do',tasks:g.todo},
      {key:'doing',cls:'tc-doing',label:'Doing',tasks:g.doing},
      {key:'done',cls:'tc-done',label:'Done',tasks:g.done},
      {key:'archived',cls:'tc-archived',label:'Archived',tasks:g.archived}
    ];
  }
  wrap.innerHTML=columns.map(col=>`<div class="task-column ${col.cls}">
    <div class="task-column-header">
      <span class="task-column-label">${esc(col.label)}</span>
      <span class="task-column-count">${col.tasks.length}</span>
      <button type="button" class="task-add-btn" onclick="openAddTaskInline('${col.key}',event)" title="Add task">+ Add task</button>
    </div>
    <div class="task-column-body">
      ${col.tasks.length ? col.tasks.map(renderTaskCard).join('') : '<div class="empty-list-sm">No tasks</div>'}
    </div>
  </div>`).join('');
}
export function renderTaskCard(task){
  const dot=dueDateDot(task.due_date);
  const dueLabel=task.due_date||'No due date';
  const prioClass = task.priority==='important'?'tpb-important':task.priority==='low'?'tpb-low':'tpb-medium';
  const prioLabel = task.priority.charAt(0).toUpperCase()+task.priority.slice(1);
  const linkIcon = task.source_note_id
    ? `<span class="task-card-link" title="Go to source Daily Note" onclick="event.stopPropagation();jumpToSourceNote('${task.source_note_id}','${task.source_line_id||''}')">${LINK_SVG}</span>`
    : '';
  return `<div class="task-card${task.status==='archived'?' task-card-archived':''}" data-task-id="${task.id}" onclick="openTaskPopoverForCard('${task.id}',event)">
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
      <option value="archived" ${task.status==='archived'?'selected':''}>Archived</option>
    </select>
  </div>`;
}
export function openTaskPopoverForCard(taskId, event){
  if(event) event.stopPropagation();
  openTaskModal(taskId);
}
export function openAddTaskInline(column, event){
  if(event) event.stopPropagation();
  const btnEl = event && event.target ? event.target.closest('.task-add-btn') : null;
  const rect = btnEl ? btnEl.getBoundingClientRect() : {left:window.innerWidth/2-150, bottom:140};
  const ctx={x:rect.left, y:rect.bottom+4};
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
  window.openTaskModal=openTaskModal;
  window.closeTaskModal=closeTaskModal;
  window.saveTaskModal=saveTaskModal;
  window.onTaskModalFieldInput=onTaskModalFieldInput;
  window.openTaskLinkPicker=openTaskLinkPicker;
  window.selectTaskLinkField=selectTaskLinkField;
  window.filterTaskLinkPicker=filterTaskLinkPicker;
  window.assignTaskLink=assignTaskLink;
  window.unlinkTaskField=unlinkTaskField;
  window.createFollowUpTask=createFollowUpTask;
  window.jumpToReferencedTask=jumpToReferencedTask;
  window.openTaskFollowUpModal=openTaskFollowUpModal;
  window.closeTaskFollowUpModal=closeTaskFollowUpModal;
  window.selectTaskFollowUpModalPriority=selectTaskFollowUpModalPriority;
  window.submitTaskFollowUpModal=submitTaskFollowUpModal;

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

  // Outside-click-to-close for the link picker dropdown only — the task modal itself closes
  // via explicit ×/Cancel/Save (matching every other .modal-overlay in this app), not
  // click-outside, so the guard here is scoped to #taskLinkPickerWrap and its trigger row.
  document.addEventListener('click',e=>{
    if(!state.taskLinkPickerOpen) return;
    if(e.target.closest('#taskLinkPickerWrap')) return;
    if(e.target.closest('.task-link-add-row')) return;
    closeTaskLinkPicker();
  });
}
