// ══════════════════════════════════════════════════
// CHECKLIST INSTANCES — new-checklist creation flow, detail view, item ticking/notes,
// mark-done. groupChecklistItems/renderChecklistSections/renderChecklistItemRow are
// exported for reuse by checklist-share.js's read-only reviewer view.
// ══════════════════════════════════════════════════
import { state } from './state.js';
import { esc, escJs, showNotification, showInlineConfirm } from './ui-helpers.js';
import { sb } from './supabase-client.js';
// Intentional narrow circular import (same pattern as folders.js<->notes.js): main.js
// imports this module's exports for wiring, and this module needs main.js's cross-domain
// nav router to switch into the detail sub-view after creating/opening a checklist. Safe
// because switchChecklistSubView is only ever invoked inside function bodies here, never
// at module top-level.
import { switchChecklistSubView } from './main.js';

// ══════════════════════════════════════════════════
// DATA LAYER
// ══════════════════════════════════════════════════
export async function loadChecklistInstances(){
  if(!state.currentUserId) return [];
  const{data,error}=await sb.from('checklist_instances').select('*').eq('owner_id',state.currentUserId).order('created_at',{ascending:false});
  if(error||!data) return [];
  return data.map(c=>({...c,items:c.items||[]}));
}
export async function insertChecklistInstanceDB(templateId,title,items){
  const{data,error}=await sb.from('checklist_instances').insert({
    template_id:templateId, title, items, status:'in_progress'
  }).select().single();
  if(error) throw error;
  return data;
}
export async function saveChecklistInstanceItemsDB(id,items){
  await sb.from('checklist_instances').update({items}).eq('id',id);
}
export async function markChecklistInstanceDoneDB(id){
  await sb.from('checklist_instances').update({status:'done',completed_at:new Date().toISOString()}).eq('id',id);
}

// Groups a flat items[] array for rendering. If any item has a `phase` field
// (e.g. the Campaign Deployment template) we group phase -> section. Otherwise
// (e.g. the BRD template) we just group by section, no phase-level collapsing.
export function groupChecklistItems(items){
  items=items||[];
  const hasPhase=items.some(it=>it.phase);
  if(hasPhase){
    const phases=[],phaseMap={};
    items.forEach(it=>{
      const pname=it.phase||'(No phase)';
      if(!phaseMap[pname]){phaseMap[pname]={name:pname,sections:[],sectionMap:{}};phases.push(phaseMap[pname]);}
      const ph=phaseMap[pname];
      const sname=it.section||'(No section)';
      if(!ph.sectionMap[sname]){ph.sectionMap[sname]={name:sname,items:[]};ph.sections.push(ph.sectionMap[sname]);}
      ph.sectionMap[sname].items.push(it);
    });
    return{hasPhase:true,phases};
  }
  const sections=[],sectionMap={};
  items.forEach(it=>{
    const sname=it.section||'(No section)';
    if(!sectionMap[sname]){sectionMap[sname]={name:sname,items:[]};sections.push(sectionMap[sname]);}
    sectionMap[sname].items.push(it);
  });
  return{hasPhase:false,sections};
}

// ── New Checklist modal (Step 1: pick+preview template, Step 2: title) ──
export function openNewChecklistModal(){
  state.newChecklistSelectedTemplateId=null;
  state.templatePickerExpandedId=null;
  document.getElementById('newChecklistModalTitle').textContent='New Checklist — Step 1: Pick a template';
  document.getElementById('newChecklistStep1').style.display='';
  document.getElementById('newChecklistStep2').style.display='none';
  renderTemplatePickerList();
  document.getElementById('newChecklistModalOverlay').classList.add('open');
}
export function closeNewChecklistModal(){
  document.getElementById('newChecklistModalOverlay').classList.remove('open');
}
export function renderTemplatePickerList(){
  const el=document.getElementById('templatePickerList');
  if(!state.checklistTemplates.length){el.innerHTML='<div class="empty-list">No checklist templates available yet</div>';return;}
  el.innerHTML=state.checklistTemplates.map(t=>{
    const expanded=state.templatePickerExpandedId===t.id;
    let previewHtml='';
    if(expanded){
      const grouped=groupChecklistItems(t.items||[]);
      if(grouped.hasPhase){
        previewHtml=grouped.phases.map(ph=>`
          <div class="tpl-preview-phase">${esc(ph.name)}</div>
          ${ph.sections.map(s=>`
            <div class="tpl-preview-section">${esc(s.name)}</div>
            <ul class="tpl-preview-items">${s.items.map(i=>`<li>${esc(i.text)}</li>`).join('')}</ul>
          `).join('')}`).join('');
      }else{
        previewHtml=grouped.sections.map(s=>`
          <div class="tpl-preview-section">${esc(s.name)}</div>
          <ul class="tpl-preview-items">${s.items.map(i=>`<li>${esc(i.text)}</li>`).join('')}</ul>
        `).join('');
      }
    }
    return`<div class="card template-picker-row">
      <div class="template-picker-row-header" onclick="toggleTemplatePickerPreview('${escJs(t.id)}')">
        <span class="tpr-chevron">${expanded?'▾':'▸'}</span>
        <span class="tpr-title">${esc(t.title)}</span>
        <span class="tpr-count">${(t.items||[]).length} items</span>
      </div>
      ${t.description?`<div class="tpr-desc">${esc(t.description)}</div>`:''}
      ${expanded?`<div class="tpl-preview-box">${previewHtml}</div>`:''}
      <button type="button" class="btn btn-primary tpr-use-btn" onclick="chooseTemplateForNewChecklist('${escJs(t.id)}')">Use this template</button>
    </div>`;
  }).join('');
}
export function toggleTemplatePickerPreview(id){
  state.templatePickerExpandedId=state.templatePickerExpandedId===id?null:id;
  renderTemplatePickerList();
}
export function chooseTemplateForNewChecklist(id){
  state.newChecklistSelectedTemplateId=id;
  const tpl=state.checklistTemplates.find(t=>t.id===id);
  document.getElementById('newChecklistModalTitle').textContent='New Checklist — Step 2: Name it';
  document.getElementById('newChecklistTplName').textContent=tpl?tpl.title:'';
  document.getElementById('newChecklistTitle').value='';
  document.getElementById('newChecklistStep1').style.display='none';
  document.getElementById('newChecklistStep2').style.display='';
  setTimeout(()=>document.getElementById('newChecklistTitle').focus(),50);
}
export function newChecklistBackToStep1(){
  document.getElementById('newChecklistModalTitle').textContent='New Checklist — Step 1: Pick a template';
  document.getElementById('newChecklistStep1').style.display='';
  document.getElementById('newChecklistStep2').style.display='none';
}
export async function createChecklistInstance(){
  const title=document.getElementById('newChecklistTitle').value.trim();
  if(!title){showNotification('Please enter a title for this checklist.');return;}
  const tpl=state.checklistTemplates.find(t=>t.id===state.newChecklistSelectedTemplateId);
  if(!tpl){showNotification('Please pick a template.');return;}
  const items=JSON.parse(JSON.stringify(tpl.items||[])).map(it=>({...it,done:false,note:''}));
  try{
    const row=await insertChecklistInstanceDB(tpl.id,title,items);
    row.owner_id=state.currentUserId;
    row.items=row.items||items;
    state.checklistInstances.unshift(row);
    closeNewChecklistModal();
    openChecklistDetail(row.id);
  }catch(err){showNotification('Could not create checklist: '+(err.message||err));}
}

// ── Checklist detail view ─────────────────────────
export function getActiveChecklistInstance(){
  return state.checklistInstances.find(c=>c.id===state.activeChecklistInstanceId);
}
export function openChecklistDetail(id){
  state.activeChecklistInstanceId=id;
  switchChecklistSubView('detail');
}
export function renderChecklistItemRow(item,inst,readOnly){
  const idx=inst.items.indexOf(item);
  const hasNote=!!(item.note&&item.note.trim());
  const checkboxAttrs=readOnly?'disabled':`onchange="toggleChecklistItemDone(${idx})"`;
  const noteHtml=readOnly
    ?(hasNote?`<div class="checklist-item-note is-readonly-note">${esc(item.note)}</div>`:'')
    :`<textarea class="checklist-item-note" placeholder="Add a note…" oninput="onChecklistNoteInput(${idx},this)" onblur="onChecklistNoteBlur(${idx},this)">${esc(item.note||'')}</textarea>`;
  return`<div class="checklist-item-row ${item.done?'is-done':''}">
    <input type="checkbox" class="checklist-item-checkbox" ${item.done?'checked':''} ${checkboxAttrs}>
    <div class="checklist-item-body">
      <div class="checklist-item-text">${esc(item.text)}${item.hint?`<span class="checklist-item-hint-toggle" onclick="toggleChecklistHint(this)" title="Show hint">ℹ</span>`:''}</div>
      ${item.hint?`<div class="checklist-item-hint" style="display:none">${esc(item.hint).replace(/\n/g,'<br>')}</div>`:''}
      ${noteHtml}
    </div>
    <span class="checklist-item-flag ${hasNote?'has-note':''}" title="Flagged note">🚩</span>
  </div>`;
}
export function toggleChecklistHint(el){
  const hintDiv=el.parentElement.nextElementSibling;
  if(hintDiv&&hintDiv.classList.contains('checklist-item-hint')){
    hintDiv.style.display=hintDiv.style.display==='none'?'':'none';
  }
}
// Shared by the normal (editable) detail view and the read-only reviewer view —
// only the checkbox/textarea interactivity differs (see renderChecklistItemRow).
export function renderChecklistSections(inst,grouped,readOnly){
  if(grouped.hasPhase){
    return grouped.phases.map((ph,phIdx)=>{
      const phTotal=ph.sections.reduce((n,s)=>n+s.items.length,0);
      const phDone=ph.sections.reduce((n,s)=>n+s.items.filter(i=>i.done).length,0);
      const allDone=phTotal>0&&phDone===phTotal;
      const phKey=inst.id+'::'+ph.name;
      let isOpen=Object.prototype.hasOwnProperty.call(state.checklistPhaseOpen,phKey)?state.checklistPhaseOpen[phKey]:(phIdx===0&&!allDone);
      if(allDone)isOpen=false;
      const sectionsInner=ph.sections.map(s=>`
        <div class="section-label checklist-section-title">${esc(s.name)}</div>
        <div class="checklist-item-list">${s.items.map(it=>renderChecklistItemRow(it,inst,readOnly)).join('')}</div>
      `).join('');
      return`<details class="checklist-phase" ${isOpen?'open':''} ontoggle="onChecklistPhaseToggle('${escJs(phKey)}',this.open)">
        <summary class="checklist-phase-summary">
          <span class="checklist-phase-name">${esc(ph.name)}</span>
          <span class="checklist-phase-progress">${phDone}/${phTotal} done</span>
        </summary>
        <div class="checklist-phase-body">${sectionsInner}</div>
      </details>`;
    }).join('');
  }
  return grouped.sections.map(s=>`
    <div class="section-label checklist-section-title">${esc(s.name)}</div>
    <div class="checklist-item-list">${s.items.map(it=>renderChecklistItemRow(it,inst,readOnly)).join('')}</div>
  `).join('');
}
export function renderChecklistDetail(){
  const el=document.getElementById('checklistDetailScroll');
  const inst=getActiveChecklistInstance();
  if(!inst){el.innerHTML='<div class="empty-state"><div class="icon">✅</div><p>Select a checklist to view it</p></div>';return;}
  const items=inst.items||[];
  const total=items.length,doneCount=items.filter(i=>i.done).length;
  const pct=total?Math.round(doneCount/total*100):0;
  const flagged=items.filter(i=>i.note&&i.note.trim()&&!i.done).length;
  const tpl=state.checklistTemplates.find(t=>t.id===inst.template_id);
  const grouped=groupChecklistItems(items);
  const isDone=inst.status==='done';
  const sectionsHtml=renderChecklistSections(inst,grouped,false);

  el.innerHTML=`
    <div class="checklist-detail-header">
      <div class="checklist-detail-title-row">
        <div class="checklist-detail-title">${esc(inst.title)}</div>
        <span class="checklist-status-badge ${isDone?'is-done':'is-progress'}">${isDone?'✓ Done':'In Progress'}</span>
      </div>
      <div class="checklist-detail-tpl">from: ${esc(tpl?tpl.title:'(template removed)')}</div>
      <div class="checklist-progress-bar-outer big"><div class="checklist-progress-bar-inner" style="width:${pct}%"></div></div>
      <div class="checklist-detail-meta-row">
        <span>${doneCount}/${total} items done (${pct}%)</span>
        <span class="checklist-flag-badge" id="checklistDetailFlagBadge">${flagged?`🚩 ${flagged} flagged`:''}</span>
        ${!isDone?`<button class="btn btn-primary" style="margin-left:auto" onclick="markChecklistDone(this)">Mark Checklist Done</button>`:''}
      </div>
    </div>
    <div class="checklist-detail-body">${sectionsHtml}</div>`;
}
export function onChecklistPhaseToggle(phKey,isOpen){
  state.checklistPhaseOpen[phKey]=isOpen;
}
export function toggleChecklistItemDone(idx){
  const inst=getActiveChecklistInstance();if(!inst)return;
  const item=inst.items[idx];if(!item)return;
  item.done=!item.done;
  saveChecklistInstanceItemsDB(inst.id,inst.items);
  renderChecklistDetail();
}
// Note-field typing must NOT trigger a full re-render (would steal focus mid-keystroke,
// same class of bug fixed earlier for the daily-note capture input). Only mutate the
// in-memory value, patch the flag icon/badge directly in the DOM, and debounce the save.
export function onChecklistNoteInput(idx,textareaEl){
  const inst=getActiveChecklistInstance();if(!inst)return;
  const item=inst.items[idx];if(!item)return;
  item.note=textareaEl.value;
  const row=textareaEl.closest('.checklist-item-row');
  if(row){
    const flagEl=row.querySelector('.checklist-item-flag');
    if(flagEl)flagEl.classList.toggle('has-note',!!(item.note&&item.note.trim()));
  }
  const badge=document.getElementById('checklistDetailFlagBadge');
  if(badge){
    const flagged=(inst.items||[]).filter(i=>i.note&&i.note.trim()&&!i.done).length;
    badge.textContent=flagged?`🚩 ${flagged} flagged`:'';
  }
  clearTimeout(state.checklistNoteSaveTimer);
  state.checklistNoteSaveTimer=setTimeout(()=>{saveChecklistInstanceItemsDB(inst.id,inst.items);},800);
}
export function onChecklistNoteBlur(idx,textareaEl){
  const inst=getActiveChecklistInstance();if(!inst)return;
  clearTimeout(state.checklistNoteSaveTimer);
  saveChecklistInstanceItemsDB(inst.id,inst.items);
}
export function markChecklistDone(btnEl){
  const inst=getActiveChecklistInstance();if(!inst)return;
  showInlineConfirm(btnEl,`Mark "${esc(inst.title)}" as done?`,async()=>{
    await markChecklistInstanceDoneDB(inst.id);
    inst.status='done';inst.completed_at=new Date().toISOString();
    renderChecklistDetail();
  },{container:'.checklist-detail-header',confirmLabel:'Yes, mark done'});
}

export function initChecklistInstances(){
  window.openNewChecklistModal=openNewChecklistModal;
  window.closeNewChecklistModal=closeNewChecklistModal;
  window.toggleTemplatePickerPreview=toggleTemplatePickerPreview;
  window.chooseTemplateForNewChecklist=chooseTemplateForNewChecklist;
  window.newChecklistBackToStep1=newChecklistBackToStep1;
  window.createChecklistInstance=createChecklistInstance;
  window.openChecklistDetail=openChecklistDetail;
  window.toggleChecklistHint=toggleChecklistHint;
  window.onChecklistPhaseToggle=onChecklistPhaseToggle;
  window.toggleChecklistItemDone=toggleChecklistItemDone;
  window.onChecklistNoteInput=onChecklistNoteInput;
  window.onChecklistNoteBlur=onChecklistNoteBlur;
  window.markChecklistDone=markChecklistDone;

  document.querySelector('#checklistMineView .btn-primary').onclick=openNewChecklistModal;
  document.querySelector('#newChecklistModalOverlay .modal-close').onclick=closeNewChecklistModal;
  const ncActions=document.querySelectorAll('#newChecklistStep2 .modal-actions .btn');
  ncActions[0].onclick=newChecklistBackToStep1;
  ncActions[1].onclick=createChecklistInstance;
}
