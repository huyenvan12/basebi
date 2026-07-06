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
  const{data,error}=await sb.from('folders').select('name').order('sort_order');
  if(error||!data||!data.length) return [...SEED_FOLDERS];
  return data.map(r=>r.name);
}
export async function saveFolders(arr){
  const rows = arr.map((name,i)=>({name,sort_order:i}));
  await sb.from('folders').upsert(rows,{onConflict:'name'});
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
  document.getElementById('folderModalOverlay').classList.add('open');
  setTimeout(()=>document.getElementById('f-folder-name').focus(),50);
}
export function closeFolderModal(){document.getElementById('folderModalOverlay').classList.remove('open');state.editingFolderName=null;}
export function saveFolder(){
  const name=document.getElementById('f-folder-name').value.trim();if(!name)return;
  let changed=[];
  if(state.editingFolderName){
    if(state.folders.includes(name)&&name!==state.editingFolderName){alert('A folder with that name already exists.');return;}
    const i=state.folders.indexOf(state.editingFolderName);if(i>-1)state.folders[i]=name;
    myNotes().forEach(n=>{if(n.folder===state.editingFolderName){n.folder=name;changed.push(n);}});
    if(state.activeFolder===state.editingFolderName)state.activeFolder=name;
  }else{
    if(state.folders.includes(name)){alert('A folder with that name already exists.');return;}
    state.folders.push(name);
  }
  saveFolders(state.folders);if(changed.length)saveNotes(changed);closeFolderModal();renderAll();
}
export function deleteFolder(name){
  const cnt=state.notes.filter(n=>n.folder===name&&!n.deleted).length;
  if(cnt>0){alert(`Cannot delete "${name}" — it has ${cnt} note${cnt>1?'s':''}. Move or delete those notes first.`);return;}
  if(!confirm(`Delete folder "${name}"?`))return;
  state.folders=state.folders.filter(f=>f!==name);saveFolders(state.folders);
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
