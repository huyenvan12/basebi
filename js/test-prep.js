// ══════════════════════════════════════════════════
// TEST PREP HUB — private single-user exam study tracker (Delivery 1: foundation).
// Data layer, seeding, exam header, time-log quick-add + 7-day view, and an editable
// weekly checklist. No exam switcher / error log / heatmap / priority tags yet — those
// ride on this same schema in later deliveries.
// ══════════════════════════════════════════════════
import { state } from './state.js';
import { sb } from './supabase-client.js';
import { esc, escJs, showNotification, showConfirmModal } from './ui-helpers.js';

// Fixed palette indexed by each skill's position in the (sort_order-ordered) skills list —
// never keyed by skill name, so this keeps working if skill names/count change later.
const SKILL_PALETTE = ['var(--tp-skill-1)','var(--tp-skill-2)','var(--tp-skill-3)','var(--tp-skill-4)','var(--tp-skill-5)','var(--tp-skill-6)','var(--tp-skill-7)','var(--tp-skill-8)'];
export function skillColor(skillId){
  const idx = state.testPrepSkills.findIndex(s=>s.id===skillId);
  return SKILL_PALETTE[(idx<0?0:idx) % SKILL_PALETTE.length];
}

// Local calendar date as YYYY-MM-DD — never .toISOString() (that normalizes to UTC first,
// which misattributes entries logged in the evening for users east of UTC to the wrong day).
function localDateStr(d=new Date()){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

const DEFAULT_SKILLS = ['Listening','Writing','Speaking','Reading'];
const DEFAULT_CHECKLIST_WEEKS = 8;
const DEFAULT_TASKS_PER_WEEK = [
  'Complete a full practice test',
  'Review mistakes from this week’s practice'
];

// ══════════════════════════════════════════════════
// DATA LAYER
// ══════════════════════════════════════════════════
export async function loadTestPrepExam(){
  const{data,error}=await sb.from('test_prep_exams').select('*').order('created_at',{ascending:true}).limit(1);
  if(!error&&data&&data.length) return data[0];
  const{data:seeded,error:seedErr}=await sb.from('test_prep_exams').insert({
    owner_id:state.currentUserId, name:'IELTS', current_score:null, target_score:null, exam_date:null
  }).select().single();
  if(seedErr) throw seedErr;
  return seeded;
}

export async function loadTestPrepSkills(examId){
  const{data,error}=await sb.from('test_prep_skills').select('*').eq('exam_id',examId).order('sort_order',{ascending:true});
  if(!error&&data&&data.length) return data;
  const rows = DEFAULT_SKILLS.map((name,i)=>({exam_id:examId, owner_id:state.currentUserId, name, sort_order:i}));
  const{data:seeded,error:seedErr}=await sb.from('test_prep_skills').insert(rows).select().order('sort_order',{ascending:true});
  if(seedErr) throw seedErr;
  return seeded;
}

export async function loadTestPrepTimeLogs(examId){
  const{data,error}=await sb.from('test_prep_time_logs').select('*').eq('exam_id',examId).order('log_date',{ascending:false}).order('created_at',{ascending:false});
  if(error||!data) return [];
  return data;
}

export async function insertTimeLogDB({exam_id,skill_id,log_date,minutes}){
  const{data,error}=await sb.from('test_prep_time_logs').insert({
    exam_id, skill_id, owner_id:state.currentUserId, log_date, minutes
  }).select().single();
  if(error) throw error;
  return data;
}

export async function loadTestPrepChecklist(examId){
  const{data,error}=await sb.from('test_prep_checklist_items').select('*').eq('exam_id',examId).order('week_number',{ascending:true}).order('sort_order',{ascending:true});
  if(!error&&data&&data.length) return data;
  const rows=[];
  for(let w=1; w<=DEFAULT_CHECKLIST_WEEKS; w++){
    DEFAULT_TASKS_PER_WEEK.forEach((task_text,i)=>{
      rows.push({exam_id:examId, owner_id:state.currentUserId, week_number:w, task_text, is_done:false, sort_order:i});
    });
  }
  const{data:seeded,error:seedErr}=await sb.from('test_prep_checklist_items').insert(rows).select().order('week_number',{ascending:true}).order('sort_order',{ascending:true});
  if(seedErr) throw seedErr;
  return seeded;
}

export async function insertChecklistItemDB({exam_id,week_number,task_text,sort_order}){
  const{data,error}=await sb.from('test_prep_checklist_items').insert({
    exam_id, owner_id:state.currentUserId, week_number, task_text, is_done:false, sort_order
  }).select().single();
  if(error) throw error;
  return data;
}
export async function updateChecklistItemDB(id,patch){
  const{error}=await sb.from('test_prep_checklist_items').update(patch).eq('id',id);
  if(error) throw error;
}
export async function deleteChecklistItemDB(id){
  const{error}=await sb.from('test_prep_checklist_items').delete().eq('id',id);
  if(error) throw error;
}

export async function updateTestPrepExamDB(id,patch){
  const{data,error}=await sb.from('test_prep_exams').update(patch).eq('id',id).select().single();
  if(error) throw error;
  return data;
}

// ══════════════════════════════════════════════════
// RENDER — HEADER
// ══════════════════════════════════════════════════
function fmtScore(n){ return (n===null||n===undefined)?'—':Number(n).toFixed(1); }
function fmtDate(d){ return d||'—'; }

function renderTestPrepHeader(){
  const exam=state.testPrepExam;
  const el=document.getElementById('tpHeader');
  if(!exam){ el.innerHTML=''; return; }
  el.innerHTML=`
    <div class="tp-header-title">${esc(exam.name)}
      <button type="button" class="tp-header-edit-btn icon-btn" title="Edit exam info" onclick="openTestPrepEditModal()">✎</button>
    </div>
    <div class="tp-header-stats">
      <div class="tp-header-stat"><span class="tp-header-stat-label section-label-sub">Current</span><span class="tp-header-stat-val">${fmtScore(exam.current_score)}</span></div>
      <div class="tp-header-stat"><span class="tp-header-stat-label section-label-sub">Target</span><span class="tp-header-stat-val">${fmtScore(exam.target_score)}</span></div>
      <div class="tp-header-stat"><span class="tp-header-stat-label section-label-sub">Exam Date</span><span class="tp-header-stat-val">${esc(fmtDate(exam.exam_date))}</span></div>
    </div>`;
}

// ══════════════════════════════════════════════════
// HEADER EDIT MODAL
// ══════════════════════════════════════════════════
export function openTestPrepEditModal(){
  const exam=state.testPrepExam; if(!exam) return;
  document.getElementById('tpEditCurrentScore').value = exam.current_score ?? '';
  document.getElementById('tpEditTargetScore').value = exam.target_score ?? '';
  document.getElementById('tpEditExamDate').value = exam.exam_date ?? '';
  document.getElementById('tpEditModalOverlay').classList.add('open');
}
export function closeTestPrepEditModal(){
  document.getElementById('tpEditModalOverlay').classList.remove('open');
}
export async function saveTestPrepExam(){
  const exam=state.testPrepExam; if(!exam) return;
  const curRaw=document.getElementById('tpEditCurrentScore').value;
  const tgtRaw=document.getElementById('tpEditTargetScore').value;
  const dateRaw=document.getElementById('tpEditExamDate').value;
  const patch={
    current_score: curRaw===''?null:Number(curRaw),
    target_score: tgtRaw===''?null:Number(tgtRaw),
    exam_date: dateRaw||null
  };
  try{
    const updated=await updateTestPrepExamDB(exam.id,patch);
    state.testPrepExam=updated;
    closeTestPrepEditModal();
    renderTestPrepHeader();
  }catch(err){ showNotification('Could not save exam info: '+(err.message||err),'error'); }
}

// ══════════════════════════════════════════════════
// RENDER — TIME LOG
// ══════════════════════════════════════════════════
function renderSkillPicker(){
  const el=document.getElementById('tpSkillPicker');
  el.innerHTML=state.testPrepSkills.map(s=>`
    <button type="button" class="tag-chip tp-skill-pill ${state.testPrepActiveSkillId===s.id?'active':''}"
      style="${state.testPrepActiveSkillId===s.id?`background:color-mix(in srgb, ${skillColor(s.id)} 13%, transparent);border-color:${skillColor(s.id)};color:${skillColor(s.id)}`:''}"
      onclick="setTestPrepActiveSkill('${escJs(s.id)}')">${esc(s.name)}</button>
  `).join('');
}
export function setTestPrepActiveSkill(id){
  state.testPrepActiveSkillId=id;
  renderSkillPicker();
}

function last7Days(){
  const days=[];
  const today=new Date();
  for(let i=6;i>=0;i--){
    const d=new Date(today);
    d.setDate(d.getDate()-i);
    days.push(localDateStr(d));
  }
  return days;
}

function renderSevenDayView(){
  const el=document.getElementById('tpSevenDay');
  const days=last7Days();
  const logs=state.testPrepTimeLogs;
  const dayRows=days.map(day=>{
    const dayLogs=logs.filter(l=>l.log_date===day);
    const total=dayLogs.reduce((n,l)=>n+l.minutes,0);
    const segs=state.testPrepSkills.map(s=>{
      const mins=dayLogs.filter(l=>l.skill_id===s.id).reduce((n,l)=>n+l.minutes,0);
      if(!mins) return '';
      const pct=total?(mins/total*100):0;
      return `<span class="tp-day-seg" style="width:${pct}%;background:${skillColor(s.id)}" title="${esc(s.name)}: ${mins} min"></span>`;
    }).join('');
    const label=day.slice(5); // MM-DD
    return `<div class="tp-day-row">
      <span class="tp-day-label">${esc(label)}</span>
      <span class="tp-day-bar">${segs}</span>
      <span class="tp-day-total">${total?total+'m':''}</span>
    </div>`;
  }).join('');
  const legend=state.testPrepSkills.map(s=>`
    <span class="dt-legend-chip"><span class="dt-legend-swatch" style="background:${skillColor(s.id)}"></span><span>${esc(s.name)}</span></span>
  `).join('');
  el.innerHTML=`<div class="tp-day-list">${dayRows}</div><div class="tp-legend-row">${legend}</div>`;
}

function skillName(id){ const s=state.testPrepSkills.find(sk=>sk.id===id); return s?s.name:'(removed)'; }

function renderRecentEntries(){
  const el=document.getElementById('tpRecentEntries');
  const recent=state.testPrepTimeLogs.slice(0,10);
  if(!recent.length){ el.innerHTML='<div class="empty-list">No time logged yet</div>'; return; }
  el.innerHTML=`<table class="tp-recent-table">
    <thead><tr><th>Date</th><th>Skill</th><th>Minutes</th></tr></thead>
    <tbody>${recent.map(l=>`<tr>
      <td>${esc(l.log_date)}</td>
      <td><span class="dt-legend-swatch" style="background:${skillColor(l.skill_id)}"></span>${esc(skillName(l.skill_id))}</td>
      <td>${l.minutes}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

export async function logTestPrepTime(){
  const minutesEl=document.getElementById('tpMinutesInput');
  const minutes=parseInt(minutesEl.value,10);
  if(!state.testPrepActiveSkillId){ showNotification('Pick a skill first.','warning'); return; }
  if(!minutes||minutes<=0){ minutesEl.focus(); return; }
  const log_date=localDateStr();
  try{
    const row=await insertTimeLogDB({exam_id:state.testPrepExam.id, skill_id:state.testPrepActiveSkillId, log_date, minutes});
    state.testPrepTimeLogs.unshift(row);
    minutesEl.value='';
    renderSevenDayView();
    renderRecentEntries();
  }catch(err){ showNotification('Could not log time: '+(err.message||err),'error'); }
}

// ══════════════════════════════════════════════════
// RENDER — CHECKLIST
// ══════════════════════════════════════════════════
// Weeks aren't their own DB row — they only exist implicitly as week_number values on task
// rows — so emptying a week's last task would otherwise make its shell vanish and leave a
// gap in the sequence. testPrepKnownWeeks tracks every week shell that should keep rendering
// (even with 0 tasks) until explicitly removed via removeTestPrepWeek().
function ensureKnownWeeksInitialized(){
  if(!state.testPrepKnownWeeks||!state.testPrepKnownWeeks.length){
    state.testPrepKnownWeeks=[...new Set(state.testPrepChecklist.map(i=>i.week_number))].sort((a,b)=>a-b);
  }
}

function groupChecklistByWeek(){
  ensureKnownWeeksInitialized();
  const weeks={};
  state.testPrepChecklist.forEach(it=>{
    if(!weeks[it.week_number]) weeks[it.week_number]=[];
    weeks[it.week_number].push(it);
  });
  return state.testPrepKnownWeeks.slice().sort((a,b)=>a-b).map(w=>({week:w, items:weeks[w]||[]}));
}

function renderChecklistItemRow(item){
  return `<div class="checklist-item-row ${item.is_done?'is-done':''}" data-id="${esc(item.id)}">
    <input type="checkbox" class="checklist-item-checkbox" ${item.is_done?'checked':''} onchange="toggleTestPrepTaskDone('${escJs(item.id)}',this.checked)">
    <div class="checklist-item-body">
      <span class="checklist-item-text tp-task-text" tabindex="0" onclick="startEditTestPrepTask(this,'${escJs(item.id)}')">${esc(item.task_text)}</span>
    </div>
    <button type="button" class="tp-task-del icon-btn-sm" title="Remove task" onclick="deleteTestPrepTask('${escJs(item.id)}')">×</button>
  </div>`;
}

function renderChecklist(openWeeksOverride){
  const el=document.getElementById('tpChecklistBody');
  // preserve which week accordions are open across re-renders (delete/edit/toggle would
  // otherwise collapse everything back to closed since fresh <details> default shut)
  const openWeeks = openWeeksOverride || new Set(
    [...el.querySelectorAll('.checklist-phase[open]')].map(d=>d.dataset.week)
  );
  const weeks=groupChecklistByWeek();
  el.innerHTML=weeks.map(w=>{
    const total=w.items.length, done=w.items.filter(i=>i.is_done).length;
    const isOpen=openWeeks.has(String(w.week));
    const removeBtn=total===0?`<button type="button" class="tp-remove-week-btn" onclick="removeTestPrepWeek(${w.week})">Remove week</button>`:'';
    return `<details class="accordion-card checklist-phase" data-week="${w.week}" ${isOpen?'open':''}>
      <summary class="checklist-phase-summary">
        <span class="checklist-phase-name">Week ${w.week}</span>
        <span class="checklist-phase-progress">${done}/${total} done</span>
      </summary>
      <div class="checklist-phase-body">
        <div class="checklist-item-list">${w.items.map(renderChecklistItemRow).join('')}</div>
        <div class="tp-week-actions">
          <button type="button" class="tp-add-task-btn" onclick="addTestPrepTask(${w.week})">+ Add task</button>
          ${removeBtn}
        </div>
      </div>
    </details>`;
  }).join('') + `<button type="button" class="btn btn-ghost tp-add-week-btn" onclick="addTestPrepWeek()">+ Add week</button>`;
}

export function removeTestPrepWeek(weekNumber){
  const hasTasks=state.testPrepChecklist.some(i=>i.week_number===weekNumber);
  if(hasTasks) return; // guard: this control only ever appears on an empty shell
  showConfirmModal('Remove Week '+weekNumber+'? Other week numbers will not be renumbered.',()=>{
    state.testPrepKnownWeeks=(state.testPrepKnownWeeks||[]).filter(w=>w!==weekNumber);
    renderChecklist();
  },{confirmLabel:'Remove'});
}

export async function toggleTestPrepTaskDone(id,checked){
  const item=state.testPrepChecklist.find(i=>i.id===id); if(!item) return;
  item.is_done=checked;
  try{ await updateChecklistItemDB(id,{is_done:checked}); }catch(err){ showNotification('Could not update task: '+(err.message||err),'error'); }
  renderChecklist();
}

export function startEditTestPrepTask(spanEl,id){
  const item=state.testPrepChecklist.find(i=>i.id===id); if(!item) return;
  const input=document.createElement('input');
  input.type='text'; input.className='tp-task-edit-input'; input.value=item.task_text;
  spanEl.replaceWith(input);
  input.focus(); input.select();
  const commit=()=>saveTestPrepTaskEdit(input,id);
  input.addEventListener('blur',commit);
  input.addEventListener('keydown',e=>{ if(e.key==='Enter') input.blur(); if(e.key==='Escape'){ input.removeEventListener('blur',commit); renderChecklist(); } });
}
async function saveTestPrepTaskEdit(input,id){
  const item=state.testPrepChecklist.find(i=>i.id===id); if(!item) return;
  const text=input.value.trim();
  if(text&&text!==item.task_text){
    item.task_text=text;
    try{ await updateChecklistItemDB(id,{task_text:text}); }catch(err){ showNotification('Could not save task: '+(err.message||err),'error'); }
  }
  renderChecklist();
}

export async function deleteTestPrepTask(id){
  showConfirmModal('Remove this task?',async()=>{
    try{ await deleteChecklistItemDB(id); }catch(err){ showNotification('Could not delete task: '+(err.message||err),'error'); return; }
    state.testPrepChecklist=state.testPrepChecklist.filter(i=>i.id!==id);
    renderChecklist();
  },{confirmLabel:'Remove'});
}

// ══════════════════════════════════════════════════
// "+ ADD TASK" / "+ ADD WEEK" PROMPT MODAL
// ══════════════════════════════════════════════════
// Replaces window.prompt(), which throws (confirmed: "prompt() is not supported.") or
// silently no-ops in many mobile contexts (iOS standalone/home-screen PWA, Android
// installed PWAs/WebViews) — not a viewport-width issue, so this applies on desktop too,
// just via the same modal/.form-input pattern as openTestPrepEditModal() instead of a
// native dialog. tpPromptContext holds which flow (task vs week, and which week number)
// the currently-open modal is for; set by addTestPrepTask()/addTestPrepWeek() below.
let tpPromptContext=null;

function openTpPromptModal(mode, weekNumber, title){
  tpPromptContext={mode, weekNumber};
  document.getElementById('tpPromptModalTitle').textContent=title;
  document.getElementById('tpPromptInput').value='';
  document.getElementById('tpPromptModalOverlay').classList.add('open');
  setTimeout(()=>document.getElementById('tpPromptInput').focus(),50);
}
export function closeTpPromptModal(){
  tpPromptContext=null;
  document.getElementById('tpPromptModalOverlay').classList.remove('open');
}
export async function submitTpPromptModal(){
  const ctx=tpPromptContext;
  if(!ctx) return;
  const text=(document.getElementById('tpPromptInput').value||'').trim();
  // Empty/whitespace-only input is a no-op — same as an empty prompt() return today —
  // so nothing is created and the modal stays open for the user to try again or Cancel.
  if(!text) return;
  closeTpPromptModal();
  if(ctx.mode==='task') await commitAddTestPrepTask(ctx.weekNumber, text);
  else await commitAddTestPrepWeek(ctx.weekNumber, text);
}

export function addTestPrepTask(weekNumber){
  openTpPromptModal('task', weekNumber, 'New task for Week '+weekNumber);
}

export function addTestPrepWeek(){
  ensureKnownWeeksInitialized();
  const known=state.testPrepKnownWeeks||[];
  const nextWeek=(known.length?Math.max(...known):0)+1;
  openTpPromptModal('week', nextWeek, 'First task for Week '+nextWeek);
}

async function commitAddTestPrepTask(weekNumber, text){
  const weekItems=state.testPrepChecklist.filter(i=>i.week_number===weekNumber);
  const sort_order=weekItems.length;
  try{
    const row=await insertChecklistItemDB({exam_id:state.testPrepExam.id, week_number:weekNumber, task_text:text, sort_order});
    state.testPrepChecklist.push(row);
    renderChecklist();
    const details=document.querySelector(`.checklist-phase[data-week="${weekNumber}"]`);
    if(details) details.open=true;
  }catch(err){ showNotification('Could not add task: '+(err.message||err),'error'); }
}

async function commitAddTestPrepWeek(nextWeek, text){
  const known=state.testPrepKnownWeeks||[];
  try{
    const row=await insertChecklistItemDB({exam_id:state.testPrepExam.id, week_number:nextWeek, task_text:text, sort_order:0});
    state.testPrepChecklist.push(row);
    state.testPrepKnownWeeks=[...known, nextWeek];
    renderChecklist();
    const details=document.querySelector(`.checklist-phase[data-week="${nextWeek}"]`);
    if(details) details.open=true;
  }catch(err){ showNotification('Could not add week: '+(err.message||err),'error'); }
}

// ══════════════════════════════════════════════════
// MOBILE-WEB ACCORDION SHELL
// ══════════════════════════════════════════════════
// Data-driven so a future section (e.g. "Insights") is just another array entry, not a
// restructure. Desktop (>768px) always renders every section expanded with no accordion
// chrome — see the @media (min-width:769px) override in basebi.css — so this shell is the
// single source of markup for both widths; the inner content ids below are untouched by
// renderTestPrepHeader()/renderSkillPicker()/renderSevenDayView()/renderRecentEntries()/renderChecklist().
const TP_SECTIONS = [
  {key:'header', label:'Overview', defaultOpen:true, bodyHtml:'<div class="card tp-header" id="tpHeader"></div>'},
  {key:'timelog', label:'Time Log', defaultOpen:false, bodyHtml:`
    <div class="tp-log-form">
      <div class="tp-skill-picker" id="tpSkillPicker"></div>
      <input type="number" min="1" class="form-input tp-minutes-input" id="tpMinutesInput" placeholder="Minutes">
      <button type="button" class="btn btn-primary" id="tpLogBtn">+ Log</button>
    </div>
    <div class="tp-seven-day" id="tpSevenDay"></div>
    <div class="tp-recent" id="tpRecentEntries"></div>`},
  {key:'checklist', label:'Checklist', defaultOpen:false, bodyHtml:'<div id="tpChecklistBody"></div>'},
];
function renderTpAccordionShell(){
  const el=document.getElementById('tpScroll');
  el.innerHTML = TP_SECTIONS.map(s=>{
    const isOpen = Object.prototype.hasOwnProperty.call(state.testPrepSectionOpen,s.key) ? state.testPrepSectionOpen[s.key] : s.defaultOpen;
    return `<details class="accordion-card tp-accordion-section" data-section="${s.key}" ${isOpen?'open':''} ontoggle="onTpSectionToggle('${s.key}',this.open)">
      <summary class="tp-accordion-summary">${esc(s.label)}</summary>
      <div class="tp-accordion-body">${s.bodyHtml}</div>
    </details>`;
  }).join('');
}
export function onTpSectionToggle(key,isOpen){ state.testPrepSectionOpen[key]=isOpen; }

// ══════════════════════════════════════════════════
// TOP-LEVEL RENDER + INIT
// ══════════════════════════════════════════════════
export function renderTestPrep(){
  if(!state.testPrepExam) return;
  if(!state.testPrepActiveSkillId&&state.testPrepSkills.length) state.testPrepActiveSkillId=state.testPrepSkills[0].id;
  renderTpAccordionShell();
  renderTestPrepHeader();
  renderSkillPicker();
  renderSevenDayView();
  renderRecentEntries();
  renderChecklist();
  document.getElementById('tpLogBtn').onclick=logTestPrepTime;
}

export function initTestPrep(){
  window.setTestPrepActiveSkill=setTestPrepActiveSkill;
  window.logTestPrepTime=logTestPrepTime;
  window.toggleTestPrepTaskDone=toggleTestPrepTaskDone;
  window.startEditTestPrepTask=startEditTestPrepTask;
  window.deleteTestPrepTask=deleteTestPrepTask;
  window.addTestPrepTask=addTestPrepTask;
  window.addTestPrepWeek=addTestPrepWeek;
  window.removeTestPrepWeek=removeTestPrepWeek;
  window.openTestPrepEditModal=openTestPrepEditModal;
  window.closeTestPrepEditModal=closeTestPrepEditModal;
  window.saveTestPrepExam=saveTestPrepExam;
  window.onTpSectionToggle=onTpSectionToggle;
  window.closeTpPromptModal=closeTpPromptModal;
  window.submitTpPromptModal=submitTpPromptModal;
}
