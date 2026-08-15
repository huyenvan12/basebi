// ══════════════════════════════════════════════════
// CHECKLIST TEMPLATES — admin-only CRUD for the template library.
// ══════════════════════════════════════════════════
import { state } from './state.js';
import { esc, escJs, showNotification, showConfirmModal } from './ui-helpers.js';
import { sb } from './supabase-client.js';

// ══════════════════════════════════════════════════
// DATA LAYER
// ══════════════════════════════════════════════════
export async function loadChecklistTemplates(){
  const{data,error}=await sb.from('checklist_templates').select('*').order('created_at',{ascending:true});
  if(error||!data) return [];
  return data.map(t=>({...t,items:t.items||[]}));
}
export async function insertTemplateDB(title,description,items){
  const{data,error}=await sb.from('checklist_templates').insert({title,description,items}).select().single();
  if(error) throw error;
  return data;
}
export async function updateTemplateDB(id,title,description,items){
  await sb.from('checklist_templates').update({title,description,items}).eq('id',id);
}
export async function deleteTemplateDB(id){
  const{error}=await sb.from('checklist_templates').delete().eq('id',id);
  if(error) throw error;
}
export async function countInstancesUsingTemplate(id){
  const{count,error}=await sb.from('checklist_instances').select('id',{count:'exact',head:true}).eq('template_id',id);
  if(error) return 0;
  return count||0;
}

// ══════════════════════════════════════════════════
// TEMPLATES ADMIN VIEW
// ══════════════════════════════════════════════════
export function renderChecklistTemplates(){
  const grid=document.getElementById('checklistTemplateGrid');
  if(!state.currentUserIsAdmin){grid.innerHTML='';return;}
  if(!state.checklistTemplates.length){grid.innerHTML='<div class="empty-list">No checklist templates yet</div>';return;}
  grid.innerHTML=state.checklistTemplates.map(t=>{
    const count=(t.items||[]).length;
    return`<div class="card checklist-template-card">
      <div class="tpl-card-header">
        <span class="tpl-card-title">${esc(t.title)}</span>
        <span class="template-badge-admin">🔒 Admin-managed</span>
      </div>
      <div class="tpl-card-desc">${esc(t.description||'')}</div>
      <div class="tpl-card-meta">${count} item${count!==1?'s':''}</div>
      <div class="tpl-card-actions">
        <button class="btn btn-ghost" style="font-size:11px" onclick="openTemplateModal('${escJs(t.id)}')">✎ Edit</button>
        <button class="btn btn-danger" style="font-size:11px" onclick="confirmDeleteTemplate('${escJs(t.id)}')">✕ Delete</button>
      </div>
    </div>`;
  }).join('');
}
export function openTemplateModal(id){
  state.editingTemplateId=id||null;
  const tpl=id?state.checklistTemplates.find(t=>t.id===id):null;
  document.getElementById('templateModalTitle').textContent=tpl?'Edit Checklist Template':'New Checklist Template';
  document.getElementById('tpl-title').value=tpl?tpl.title:'';
  document.getElementById('tpl-desc').value=tpl?(tpl.description||''):'';
  state.templateEditItems=tpl?JSON.parse(JSON.stringify(tpl.items||[])):[{phase:'',section:'',text:'',hint:''}];
  renderTemplateItemsEditor();
  document.getElementById('templateModalOverlay').classList.add('open');
}
export function closeTemplateModal(){
  document.getElementById('templateModalOverlay').classList.remove('open');
  state.editingTemplateId=null;state.templateEditItems=[];
}
export function addTemplateItemRow(){
  state.templateEditItems.push({phase:'',section:'',text:'',hint:''});
  renderTemplateItemsEditor();
}
export function removeTemplateItemRow(idx){
  state.templateEditItems.splice(idx,1);
  renderTemplateItemsEditor();
}
export function updateTplItemField(idx,field,value){
  if(state.templateEditItems[idx])state.templateEditItems[idx][field]=value;
}
export function renderTemplateItemsEditor(){
  const el=document.getElementById('tplItemsEditor');
  el.innerHTML=state.templateEditItems.map((it,idx)=>`
    <div class="tpl-item-row">
      <input class="form-input-compact" placeholder="Phase (optional)" value="${esc(it.phase||'')}" onchange="updateTplItemField(${idx},'phase',this.value)">
      <input class="form-input-compact" placeholder="Section *" value="${esc(it.section||'')}" onchange="updateTplItemField(${idx},'section',this.value)">
      <input class="form-input-compact" placeholder="Item text *" value="${esc(it.text||'')}" onchange="updateTplItemField(${idx},'text',this.value)">
      <input class="form-input-compact" placeholder="Hint (optional)" value="${esc(it.hint||'')}" onchange="updateTplItemField(${idx},'hint',this.value)">
      <button type="button" class="btn btn-danger tpl-item-remove" onclick="removeTemplateItemRow(${idx})" title="Remove item">✕</button>
    </div>`).join('');
}
export async function saveTemplate(){
  const title=document.getElementById('tpl-title').value.trim();
  const description=document.getElementById('tpl-desc').value.trim();
  if(!title){showNotification('Title is required.');return;}
  const items=state.templateEditItems.filter(it=>it.text&&it.text.trim()).map(it=>{
    const clean={section:(it.section||'').trim()||'General',text:it.text.trim()};
    if(it.phase&&it.phase.trim())clean.phase=it.phase.trim();
    if(it.hint&&it.hint.trim())clean.hint=it.hint.trim();
    return clean;
  });
  if(!items.length){showNotification('Add at least one item with text.');return;}
  try{
    if(state.editingTemplateId){
      await updateTemplateDB(state.editingTemplateId,title,description,items);
      const t=state.checklistTemplates.find(t=>t.id===state.editingTemplateId);
      if(t){t.title=title;t.description=description;t.items=items;}
    }else{
      const row=await insertTemplateDB(title,description,items);
      state.checklistTemplates.push({...row,items:row.items||items});
    }
    closeTemplateModal();
    renderChecklistTemplates();
  }catch(err){showNotification('Could not save template: '+(err.message||err));}
}
export async function confirmDeleteTemplate(id){
  const t=state.checklistTemplates.find(t=>t.id===id);if(!t)return;
  const inUseCount=await countInstancesUsingTemplate(id);
  if(inUseCount>0){showNotification(`Can't delete — ${inUseCount} checklist${inUseCount>1?'s are':' is'} using this template.`);return;}
  showConfirmModal(`Delete template "${esc(t.title)}"? This cannot be undone.`,()=>deleteTemplateAction(id),{confirmLabel:'Yes, delete'});
}
export async function deleteTemplateAction(id){
  try{
    await deleteTemplateDB(id);
    state.checklistTemplates=state.checklistTemplates.filter(t=>t.id!==id);
    renderChecklistTemplates();
  }catch(err){showNotification('Could not delete template: '+(err.message||err));}
}

export function initChecklistTemplates(){
  window.openTemplateModal=openTemplateModal;
  window.closeTemplateModal=closeTemplateModal;
  window.addTemplateItemRow=addTemplateItemRow;
  window.removeTemplateItemRow=removeTemplateItemRow;
  window.updateTplItemField=updateTplItemField;
  window.saveTemplate=saveTemplate;
  window.confirmDeleteTemplate=confirmDeleteTemplate;

  document.querySelector('#checklistTemplatesView .btn-primary').onclick=()=>openTemplateModal();
  document.querySelector('#templateModalOverlay .modal-close').onclick=closeTemplateModal;
  const tplActions=document.querySelectorAll('#templateModalOverlay .modal-actions .btn');
  tplActions[0].onclick=closeTemplateModal;
  tplActions[1].onclick=saveTemplate;
  document.querySelector('#templateModalOverlay .tpl-items-editor').nextElementSibling.onclick=addTemplateItemRow;
}
