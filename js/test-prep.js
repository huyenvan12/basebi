// ══════════════════════════════════════════════════
// TEST PREP HUB — private single-user exam study tracker (Delivery 1: foundation).
// Data layer, seeding, exam header, time-log quick-add + 7-day view, and an editable
// weekly checklist. No exam switcher / error log / heatmap / priority tags yet — those
// ride on this same schema in later deliveries.
// ══════════════════════════════════════════════════
import { state } from './state.js';
import { sb } from './supabase-client.js';
import { esc, escJs } from './ui-helpers.js';

// Fixed palette indexed by each skill's position in the (sort_order-ordered) skills list —
// never keyed by skill name, so this keeps working if skill names/count change later.
const SKILL_PALETTE = ['#5b8dee','#f59e0b','#4ade80','#c4b5fd','#f87171','#34d399','#f472b6','#60a5fa'];
export function skillColor(skillId){
  const idx = state.testPrepSkills.findIndex(s=>s.id===skillId);
  return SKILL_PALETTE[(idx<0?0:idx) % SKILL_PALETTE.length];
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
    <div class="tp-header-title">${esc(exam.name)}</div>
    <div class="tp-header-stats">
      <div class="tp-header-stat"><span class="tp-header-stat-label">Current</span><span class="tp-header-stat-val">${fmtScore(exam.current_score)}</span></div>
      <div class="tp-header-stat"><span class="tp-header-stat-label">Target</span><span class="tp-header-stat-val">${fmtScore(exam.target_score)}</span></div>
      <div class="tp-header-stat"><span class="tp-header-stat-label">Exam Date</span><span class="tp-header-stat-val">${esc(fmtDate(exam.exam_date))}</span></div>
    </div>`;
}

// ══════════════════════════════════════════════════
// RENDER — TIME LOG
// ══════════════════════════════════════════════════
function renderSkillPicker(){
  const el=document.getElementById('tpSkillPicker');
  el.innerHTML=state.testPrepSkills.map(s=>`
    <button type="button" class="tag-chip tp-skill-pill ${state.testPrepActiveSkillId===s.id?'active':''}"
      style="${state.testPrepActiveSkillId===s.id?`background:${skillColor(s.id)}22;border-color:${skillColor(s.id)};color:${skillColor(s.id)}`:''}"
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
    days.push(d.toISOString().slice(0,10));
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
  if(!recent.length){ el.innerHTML='<div class="note-empty">No time logged yet</div>'; return; }
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
  if(!state.testPrepActiveSkillId){ alert('Pick a skill first.'); return; }
  if(!minutes||minutes<=0){ minutesEl.focus(); return; }
  const log_date=new Date().toISOString().slice(0,10);
  try{
    const row=await insertTimeLogDB({exam_id:state.testPrepExam.id, skill_id:state.testPrepActiveSkillId, log_date, minutes});
    state.testPrepTimeLogs.unshift(row);
    minutesEl.value='';
    renderSevenDayView();
    renderRecentEntries();
  }catch(err){ alert('Could not log time: '+(err.message||err)); }
}

// ══════════════════════════════════════════════════
// RENDER — CHECKLIST
// ══════════════════════════════════════════════════
function groupChecklistByWeek(){
  const weeks={};
  state.testPrepChecklist.forEach(it=>{
    if(!weeks[it.week_number]) weeks[it.week_number]=[];
    weeks[it.week_number].push(it);
  });
  return Object.keys(weeks).map(Number).sort((a,b)=>a-b).map(w=>({week:w, items:weeks[w]}));
}

function renderChecklistItemRow(item){
  return `<div class="checklist-item-row ${item.is_done?'is-done':''}" data-id="${esc(item.id)}">
    <input type="checkbox" class="checklist-item-checkbox" ${item.is_done?'checked':''} onchange="toggleTestPrepTaskDone('${escJs(item.id)}',this.checked)">
    <div class="checklist-item-body">
      <span class="checklist-item-text tp-task-text" tabindex="0" onclick="startEditTestPrepTask(this,'${escJs(item.id)}')">${esc(item.task_text)}</span>
    </div>
    <button type="button" class="tp-task-del" title="Remove task" onclick="deleteTestPrepTask('${escJs(item.id)}')">×</button>
  </div>`;
}

function renderChecklist(){
  const el=document.getElementById('tpChecklistBody');
  const weeks=groupChecklistByWeek();
  el.innerHTML=weeks.map(w=>{
    const total=w.items.length, done=w.items.filter(i=>i.is_done).length;
    return `<details class="checklist-phase" data-week="${w.week}">
      <summary class="checklist-phase-summary">
        <span class="checklist-phase-name">Week ${w.week}</span>
        <span class="checklist-phase-progress">${done}/${total} done</span>
      </summary>
      <div class="checklist-phase-body">
        <div class="checklist-item-list">${w.items.map(renderChecklistItemRow).join('')}</div>
        <button type="button" class="tp-add-task-btn" onclick="addTestPrepTask(${w.week})">+ Add task</button>
      </div>
    </details>`;
  }).join('') + `<button type="button" class="btn btn-ghost tp-add-week-btn" onclick="addTestPrepWeek()">+ Add week</button>`;
}

export async function toggleTestPrepTaskDone(id,checked){
  const item=state.testPrepChecklist.find(i=>i.id===id); if(!item) return;
  item.is_done=checked;
  try{ await updateChecklistItemDB(id,{is_done:checked}); }catch(err){ alert('Could not update task: '+(err.message||err)); }
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
    try{ await updateChecklistItemDB(id,{task_text:text}); }catch(err){ alert('Could not save task: '+(err.message||err)); }
  }
  renderChecklist();
}

export async function deleteTestPrepTask(id){
  if(!confirm('Remove this task?')) return;
  try{ await deleteChecklistItemDB(id); }catch(err){ alert('Could not delete task: '+(err.message||err)); return; }
  state.testPrepChecklist=state.testPrepChecklist.filter(i=>i.id!==id);
  renderChecklist();
}

export async function addTestPrepTask(weekNumber){
  const text=prompt('New task for Week '+weekNumber+':');
  if(!text||!text.trim()) return;
  const weekItems=state.testPrepChecklist.filter(i=>i.week_number===weekNumber);
  const sort_order=weekItems.length;
  try{
    const row=await insertChecklistItemDB({exam_id:state.testPrepExam.id, week_number:weekNumber, task_text:text.trim(), sort_order});
    state.testPrepChecklist.push(row);
    renderChecklist();
    const details=document.querySelector(`.checklist-phase[data-week="${weekNumber}"]`);
    if(details) details.open=true;
  }catch(err){ alert('Could not add task: '+(err.message||err)); }
}

export async function addTestPrepWeek(){
  const weeks=state.testPrepChecklist.map(i=>i.week_number);
  const nextWeek=(weeks.length?Math.max(...weeks):0)+1;
  const text=prompt('First task for Week '+nextWeek+':');
  if(!text||!text.trim()) return;
  try{
    const row=await insertChecklistItemDB({exam_id:state.testPrepExam.id, week_number:nextWeek, task_text:text.trim(), sort_order:0});
    state.testPrepChecklist.push(row);
    renderChecklist();
    const details=document.querySelector(`.checklist-phase[data-week="${nextWeek}"]`);
    if(details) details.open=true;
  }catch(err){ alert('Could not add week: '+(err.message||err)); }
}

// ══════════════════════════════════════════════════
// TOP-LEVEL RENDER + INIT
// ══════════════════════════════════════════════════
export function renderTestPrep(){
  if(!state.testPrepExam) return;
  if(!state.testPrepActiveSkillId&&state.testPrepSkills.length) state.testPrepActiveSkillId=state.testPrepSkills[0].id;
  renderTestPrepHeader();
  renderSkillPicker();
  renderSevenDayView();
  renderRecentEntries();
  renderChecklist();
}

export function initTestPrep(){
  window.setTestPrepActiveSkill=setTestPrepActiveSkill;
  window.logTestPrepTime=logTestPrepTime;
  window.toggleTestPrepTaskDone=toggleTestPrepTaskDone;
  window.startEditTestPrepTask=startEditTestPrepTask;
  window.deleteTestPrepTask=deleteTestPrepTask;
  window.addTestPrepTask=addTestPrepTask;
  window.addTestPrepWeek=addTestPrepWeek;

  document.getElementById('tpLogBtn').onclick=logTestPrepTime;
}
