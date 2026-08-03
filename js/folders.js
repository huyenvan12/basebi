// ══════════════════════════════════════════════════
// FOLDERS — CRUD, sidebar render, folder selection nav.
// ══════════════════════════════════════════════════
import { SEED_FOLDERS } from './constants.js';
import { state } from './state.js';
import { esc } from './ui-helpers.js';
import { sb } from './supabase-client.js';
// Narrow, intentional circular import: notes.js already imports renderFolders/selectFolder
// from this file (via renderAll), and this file needs myNotes/saveNotes/renderAll from
// notes.js. Safe because every cross-call below happens inside event-handler function
// bodies, never at module top-level. Do not "fix" this by inlining logic.
import { myNotes, saveNotes, renderAll } from './notes.js';

// ══════════════════════════════════════════════════
// DATA LAYER
// ══════════════════════════════════════════════════
export async function loadFolders(){
  const{data,error}=await sb.from('folders').select('id,name').order('sort_order');
  if(error||!data||!data.length){ state.folderIds={}; return [...SEED_FOLDERS]; }
  state.folderIds=Object.fromEntries(data.map(r=>[r.name,r.id]));
  return data.map(r=>r.name);
}
export async function createFolderDB(name){
  const{data,error}=await sb.from('folders').insert({name,sort_order:state.folders.length}).select('id,name').single();
  if(error) throw error;
  return data;
}
export async function renameFolderDB(id,name){
  const{error}=await sb.from('folders').update({name}).eq('id',id);
  if(error) throw error;
}
// get-or-create a folder by name, keeping state.folders/state.folderIds in sync — used
// by daily-note.js so it doesn't need to know about the id-based folder-save internals
export async function ensureFolder(name){
  if(state.folders.includes(name)) return state.folderIds[name];
  const row=await createFolderDB(name);
  state.folders.push(name);
  state.folderIds[name]=row.id;
  return row.id;
}

// ══════════════════════════════════════════════════
// RENDER — SIDEBAR
// ══════════════════════════════════════════════════
export function renderFolders(){
  const el=document.getElementById('folderList');
  const own=myNotes();
  const allItem=`<div class="folder-item ${state.activeFolder==='all'?'active':''}" onclick="selectFolder('all',this)">
    <span>◈</span> All Notes <span class="count">${own.length}</span></div>`;
  const folderItems=state.folders.map(f=>{
    const cnt=own.filter(n=>n.folder===f).length;
    return`<div class="folder-item ${state.activeFolder===f?'active':''}" onclick="selectFolder('${esc(f)}',this)">
      <span>◆</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f)}</span>
      <span class="count">${cnt}</span>
      <span class="folder-actions">
        <button class="folder-act-btn" onclick="event.stopPropagation();openFolderModal('${esc(f)}')" title="Rename">✎</button>
        <button class="folder-act-btn del" onclick="event.stopPropagation();deleteFolder('${esc(f)}')" title="Delete">×</button>
      </span></div>`;
  }).join('');
  el.innerHTML=allItem+folderItems;

  // mobile-web folder-filter dropdown (<=768px) — mirrors the sidebar list above, single-select
  const filterEl=document.getElementById('noteFolderFilter');
  if(filterEl){
    filterEl.innerHTML=`<option value="all">All Notes (${own.length})</option>`+state.folders.map(f=>{
      const cnt=own.filter(n=>n.folder===f).length;
      return`<option value="${esc(f)}">${esc(f)} (${cnt})</option>`;
    }).join('');
    filterEl.value=state.activeFolder;
  }
}

// ══════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════
export function selectFolder(f,el){
  state.activeFolder=f;state.activeTag=null;
  document.querySelectorAll('.folder-item').forEach(e=>e.classList.remove('active'));
  if(el)el.classList.add('active');
  renderAll();
}

// ══════════════════════════════════════════════════
// FOLDER CRUD
// ══════════════════════════════════════════════════
export function openFolderModal(existing){
  state.editingFolderName=existing||null;
  document.getElementById('folderModalTitle').textContent=existing?'Rename Folder':'New Folder';
  document.getElementById('f-folder-name').value=existing||'';
  hideFolderNameError();
  document.getElementById('folderModalOverlay').classList.add('open');
  setTimeout(()=>document.getElementById('f-folder-name').focus(),50);
}
export function closeFolderModal(){document.getElementById('folderModalOverlay').classList.remove('open');state.editingFolderName=null;}
function isUniqueViolation(err){return !!err&&err.code==='23505';}
function showFolderNameError(msg){
  const el=document.getElementById('f-folder-name-error');
  el.textContent=msg;el.style.display='';
}
function hideFolderNameError(){
  const el=document.getElementById('f-folder-name-error');
  el.textContent='';el.style.display='none';
}
export async function saveFolder(){
  const name=document.getElementById('f-folder-name').value.trim();if(!name)return;
  hideFolderNameError();
  if(state.editingFolderName){
    const oldName=state.editingFolderName;
    if(state.folders.includes(name)&&name!==oldName){showFolderNameError('You already have a folder with this name.');return;}
    if(name===oldName){closeFolderModal();return;}
    const id=state.folderIds[oldName];
    try{
      await renameFolderDB(id,name);
    }catch(err){
      if(isUniqueViolation(err)) showFolderNameError('You already have a folder with this name.');
      else alert('Could not rename folder: '+(err.message||err));
      return;
    }
    const i=state.folders.indexOf(oldName);if(i>-1)state.folders[i]=name;
    delete state.folderIds[oldName];state.folderIds[name]=id;
    if(state.activeFolder===oldName)state.activeFolder=name;
    // keyed by folder_id, not the old name text — avoids the soft-match fragility
    // of comparing note.folder strings against the just-renamed old name
    const changed=[];
    myNotes().forEach(n=>{if(n.folder_id===id){n.folder=name;changed.push(n);}});
    if(changed.length){
      try{ await saveNotes(changed); }
      catch(err){ alert('Folder renamed, but failed to update some notes: '+(err.message||err)); }
    }
    closeFolderModal();renderAll();
  }else{
    if(state.folders.includes(name)){showFolderNameError('You already have a folder with this name.');return;}
    try{
      const row=await createFolderDB(name);
      state.folders.push(name);
      state.folderIds[name]=row.id;
    }catch(err){
      if(isUniqueViolation(err)) showFolderNameError('You already have a folder with this name.');
      else alert('Could not create folder: '+(err.message||err));
      return;
    }
    closeFolderModal();renderAll();
  }
}
export async function deleteFolder(name){
  const cnt=state.notes.filter(n=>n.folder===name&&!n.deleted).length;
  if(cnt>0){alert(`Cannot delete "${name}" — it has ${cnt} note${cnt>1?'s':''}. Move or delete those notes first.`);return;}
  if(!confirm(`Delete folder "${name}"?`))return;
  const id=state.folderIds[name];
  if(id){
    const{error}=await sb.from('folders').delete().eq('id',id);
    if(error){alert('Could not delete folder: '+(error.message||error));return;}
  }
  state.folders=state.folders.filter(f=>f!==name);
  delete state.folderIds[name];
  if(state.activeFolder===name)state.activeFolder='all';renderAll();
}

export function initFolders(){
  window.selectFolder=selectFolder;
  window.openFolderModal=openFolderModal;
  window.closeFolderModal=closeFolderModal;
  window.saveFolder=saveFolder;
  window.deleteFolder=deleteFolder;

  document.getElementById('addFolderBtn').onclick=()=>openFolderModal();
  document.querySelector('#folderModalOverlay .modal-close').onclick=closeFolderModal;
  const folderActions=document.querySelectorAll('#folderModalOverlay .modal-actions .btn');
  folderActions[0].onclick=closeFolderModal;
  folderActions[1].onclick=saveFolder;
  document.getElementById('f-folder-name').addEventListener('keydown',e=>{if(e.key==='Enter')saveFolder();});
}
