// ══════════════════════════════════════════════════
// CAMPAIGNS — data layer, filter/sort, table + side-panel render, CRUD, panel resize.
// ══════════════════════════════════════════════════
import { SEED_CAMPS } from './constants.js';
import { state } from './state.js';
import { esc } from './ui-helpers.js';
import { sb } from './supabase-client.js';
import { today } from './daily-note.js';

// ══════════════════════════════════════════════════
// DATA LAYER
// ══════════════════════════════════════════════════
export async function loadCampaignsDB(){
  const{data,error}=await sb.from('campaigns').select('*').order('date',{ascending:false});
  if(error||!data||!data.length) return JSON.parse(JSON.stringify(SEED_CAMPS));
  return data.map(c=>({...c,extra:c.extra||{}}));
}
export async function saveCamps(arr){
  if(!arr.length) return;
  const rows = arr.map(c=>({
    id:c.id, campaign_cd:c.campaign_cd, campaign_nm:c.campaign_nm,
    event_name:c.event_name||null, type:c.type, trigger_type:c.trigger_type,
    status:c.status, date:c.date||null, note:c.note||null,
    extra:c.extra||{}, created:c.created, modified:c.modified
  }));
  await sb.from('campaigns').upsert(rows,{onConflict:'id'});
}
export async function saveOneCamp(camp){
  await sb.from('campaigns').upsert({
    id:camp.id, campaign_cd:camp.campaign_cd, campaign_nm:camp.campaign_nm,
    event_name:camp.event_name||null, type:camp.type, trigger_type:camp.trigger_type,
    status:camp.status, date:camp.date||null, note:camp.note||null,
    extra:camp.extra||{}, created:camp.created, modified:camp.modified
  },{onConflict:'id'});
}
export async function deleteCampDB(id){ await sb.from('campaigns').delete().eq('id',id); }

// ══════════════════════════════════════════════════
// CAMPAIGN RENDER
// ══════════════════════════════════════════════════
export function getCampFiltered(){
  const cd  = document.getElementById('cf-cd').value.toLowerCase().trim();
  const nm  = document.getElementById('cf-nm').value.toLowerCase().trim();
  const ev  = document.getElementById('cf-event').value.toLowerCase().trim();
  const tp  = document.getElementById('cf-type').value;
  const tr  = document.getElementById('cf-trigger').value;
  const st  = document.getElementById('cf-status').value;
  const mo  = document.getElementById('cf-month').value;
  const yr  = document.getElementById('cf-year').value;

  return state.campaigns.filter(camp=>{
    if(cd && !camp.campaign_cd.toLowerCase().includes(cd)) return false;
    if(nm && !camp.campaign_nm.toLowerCase().includes(nm)) return false;
    if(ev && !(camp.event_name||'').toLowerCase().includes(ev)) return false;
    if(tp && camp.type!==tp) return false;
    if(tr && camp.trigger_type!==tr) return false;
    if(st && camp.status!==st) return false;
    if(mo && (camp.date||'').slice(5,7)!==mo) return false;
    if(yr && (camp.date||'').slice(0,4)!==yr) return false;
    return true;
  });
}

export function sortCampData(data){
  const col=state.campSortCol, dir=state.campSortDir;
  return [...data].sort((a,b)=>{
    let va=(a[col]||'').toLowerCase(), vb=(b[col]||'').toLowerCase();
    if(va<vb) return dir==='asc'?-1:1;
    if(va>vb) return dir==='asc'?1:-1;
    return 0;
  });
}

export function sortCamp(col){
  if(state.campSortCol===col) state.campSortDir=state.campSortDir==='asc'?'desc':'asc';
  else{ state.campSortCol=col; state.campSortDir='desc'; }
  // update header classes
  document.querySelectorAll('table.camp-table th').forEach(th=>{
    th.classList.remove('sort-asc','sort-desc');
    if(th.dataset.col===state.campSortCol) th.classList.add(state.campSortDir==='asc'?'sort-asc':'sort-desc');
  });
  renderCampTable();
}

export function campTypeBadge(t){ return `<span class="cb ${t==='BAU'?'cb-bau':'cb-adhoc'}">${esc(t)}</span>`; }
export function campTrigBadge(t){ return `<span class="cb ${t==='Batch'?'cb-batch':'cb-event'}">${esc(t)}</span>`; }
export function campStatBadge(s){ return `<span class="cb ${s==='Active'?'cb-active':'cb-stop'}">${esc(s)}</span>`; }

export function renderCampTable(){
  const filtered = getCampFiltered();
  const sorted = sortCampData(filtered);
  document.getElementById('campCount').textContent = filtered.length+' of '+state.campaigns.length+' campaign'+(state.campaigns.length!==1?'s':'');

  const tbody = document.getElementById('campTableBody');
  // Add row always at top
  const addRow = `<tr class="camp-add-row" id="campAddRow">
    <td><input class="camp-add-input" id="ca-date" type="date" value="${today()}" style="width:110px"></td>
    <td><input class="camp-add-input mono" id="ca-cd" placeholder="CAMPAIGN_CD" style="width:110px"></td>
    <td><input class="camp-add-input" id="ca-nm" placeholder="Campaign name…" style="width:150px"></td>
    <td><input class="camp-add-input" id="ca-event" placeholder="Event name…" style="width:100px"></td>
    <td><select class="camp-add-select" id="ca-type" style="width:75px"><option>BAU</option><option>Adhoc</option></select></td>
    <td><select class="camp-add-select" id="ca-trigger" style="width:75px"><option>Batch</option><option>Event</option></select></td>
    <td><select class="camp-add-select" id="ca-status" style="width:75px"><option>Active</option><option>Stop</option></select></td>
    <td style="white-space:nowrap">
      <input class="camp-add-input" id="ca-note" placeholder="Note…" style="width:90px">
      &nbsp;<button class="camp-add-save" onclick="saveCampRow()">Save</button>
      <button class="camp-add-cancel" onclick="hideInlineCampRow()">×</button>
    </td>
  </tr>`;

  const dataRows = sorted.map(camp=>{
    const note = camp.note ? camp.note.slice(0,50).replace(/\n/g,' ') : '';
    return `<tr class="${camp.id===state.activeCampId?'camp-row-active':''}" data-id="${camp.id}" onclick="selectCamp(${camp.id})">
      <td class="cc-date">${esc(camp.date||'')}</td>
      <td class="cc-cd">${esc(camp.campaign_cd||'')}</td>
      <td class="cc-nm">${esc(camp.campaign_nm||'')}</td>
      <td class="cc-event">${esc(camp.event_name||'')}</td>
      <td>${campTypeBadge(camp.type||'BAU')}</td>
      <td>${campTrigBadge(camp.trigger_type||'Batch')}</td>
      <td>${campStatBadge(camp.status||'Active')}</td>
      <td class="cc-note ${note?'':'empty'}">${note?esc(note):'No note'}</td>
    </tr>`;
  }).join('');

  tbody.innerHTML = addRow + dataRows;
  // restore add row visibility state
  if(state.campAddRowVisible){ const r=document.getElementById('campAddRow'); if(r) r.classList.add('visible'); }
}

export function saveInlinecamp(){
  const cd = document.getElementById('ca-cd').value.trim();
  const nm = document.getElementById('ca-nm').value.trim();
  if(!cd||!nm){ document.getElementById('ca-cd').focus(); return; }
  const camp = {
    id: Date.now(),
    campaign_cd: cd,
    campaign_nm: nm,
    event_name: document.getElementById('ca-event').value.trim(),
    type: document.getElementById('ca-type').value,
    trigger_type: document.getElementById('ca-trigger').value,
    status: document.getElementById('ca-status').value,
    date: document.getElementById('ca-date').value,
    note: document.getElementById('ca-note').value.trim(),
    extra: {},
    created: today(), modified: today()
  };
  state.campaigns.unshift(camp);
  saveOneCamp(camp); hideInlineCampRow(); renderCampTable(); selectCamp(camp.id);
}

export function showInlineCampRow(){
  state.campAddRowVisible = true;
  renderCampTable(); // ensure row exists in DOM
  const row = document.getElementById('campAddRow');
  if(row){
    row.classList.add('visible');
    // reset fields
    ['ca-cd','ca-nm','ca-event','ca-note'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    const dateEl=document.getElementById('ca-date'); if(dateEl) dateEl.value=today();
    const typeEl=document.getElementById('ca-type'); if(typeEl) typeEl.value='BAU';
    const trigEl=document.getElementById('ca-trigger'); if(trigEl) trigEl.value='Batch';
    const statEl=document.getElementById('ca-status'); if(statEl) statEl.value='Active';
    setTimeout(()=>{const el=document.getElementById('ca-cd');if(el)el.focus();},50);
  }
}
export function hideInlineCampRow(){
  state.campAddRowVisible = false;
  state.editingCampId = null;
  const row = document.getElementById('campAddRow');
  if(row) row.classList.remove('visible');
}

export function clearCampFilters(){
  ['cf-cd','cf-nm','cf-event'].forEach(id=>document.getElementById(id).value='');
  ['cf-type','cf-trigger','cf-status','cf-month'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('cf-year').value='';
  state.activeCampId=null;
  document.getElementById('campSidePanel').classList.remove('open');
  renderCampTable();
}

// ══════════════════════════════════════════════════
// CAMPAIGN SIDE PANEL
// ══════════════════════════════════════════════════
export function closeCampPanel(){
  state.activeCampId=null;
  document.getElementById('campSidePanel').classList.remove('open');
  document.getElementById('campResizer').classList.remove('visible');
  renderCampTable();
}

export function selectCamp(id){
  // ensure numeric comparison
  id = Number(id);
  // click same row = toggle close
  if(state.activeCampId===id){
    closeCampPanel();
    return;
  }
  state.activeCampId = id;
  // update row highlight without full re-render
  document.querySelectorAll('table.camp-table tbody tr').forEach(tr=>{
    tr.classList.remove('camp-row-active');
  });
  const activeRow = document.querySelector(`table.camp-table tbody tr[data-id="${id}"]`);
  if(activeRow) activeRow.classList.add('camp-row-active');
  const camp = state.campaigns.find(cc=>cc.id===id);
  if(!camp) return;
  const isOwner = camp.owner_id===state.currentUserId;
  document.getElementById('cspCd').textContent = camp.campaign_cd;
  document.getElementById('cspNm').textContent = camp.campaign_nm;
  document.getElementById('cspBadges').innerHTML =
    campTypeBadge(camp.type||'BAU')+' '+
    campTrigBadge(camp.trigger_type||'Batch')+' '+
    campStatBadge(camp.status||'Active')+
    `<span class="csp-date">${esc(camp.date||'')}</span>`;

  const extra = camp.extra||{};
  const extraRows = Object.entries(extra).map(([k,v])=>`
    <div class="csp-extra-row">
      <span class="csp-extra-key">${esc(k)}</span>
      <span class="csp-extra-val">${esc(v)}</span>
      ${isOwner?`<button class="csp-extra-del" onclick="deleteCampExtra(${id},'${esc(k)}')">×</button>`:''}
    </div>`).join('');

  document.getElementById('cspBody').innerHTML = `
    ${camp.event_name?`<div class="csp-field"><div class="csp-field-label">Event Name</div><div class="csp-field-val">${esc(camp.event_name)}</div></div>`:''}
    <div class="csp-field">
      <div class="csp-field-label">Technical Note</div>
      ${camp.note
        ? `<div class="csp-note-text">${esc(camp.note)}</div>`
        : `<div class="csp-empty">No note added</div>`}
    </div>
    <div class="csp-extra-section">
      <div class="csp-field-label" style="margin-bottom:8px">Extra Fields</div>
      ${extraRows}
      ${isOwner?`<div class="csp-add-extra">
        <input class="csp-add-extra-input" id="extra-key-${id}" placeholder="Field name…" style="max-width:90px">
        <input class="csp-add-extra-input" id="extra-val-${id}" placeholder="Value…">
        <button class="csp-add-extra-btn" onclick="addCampExtra(${id})">+ Add</button>
      </div>`:''}
    </div>`;

  document.querySelector('.csp-edit-btn').style.display = isOwner?'':'none';
  document.querySelector('.csp-del-btn').style.display = isOwner?'':'none';

  document.getElementById('campSidePanel').classList.add('open');
  document.getElementById('campResizer').classList.add('visible');
}

export function addCampExtra(id){
  const keyEl = document.getElementById('extra-key-'+id);
  const valEl = document.getElementById('extra-val-'+id);
  const k = keyEl.value.trim(), v = valEl.value.trim();
  if(!k) return;
  const camp = state.campaigns.find(c=>c.id===id);
  if(!camp) return;
  if(!camp.extra) camp.extra={};
  camp.extra[k]=v; camp.modified=today();
  saveOneCamp(camp); selectCamp(id);
}

export function deleteCampExtra(id, key){
  const camp = state.campaigns.find(c=>c.id===id);
  if(!camp||!camp.extra) return;
  delete camp.extra[key]; camp.modified=today();
  saveOneCamp(camp); selectCamp(id);
}

// ══════════════════════════════════════════════════
// CAMPAIGN MODAL (add / edit)
// ══════════════════════════════════════════════════
export function openAddCampModal(){ showInlineCampRow(); }

export function openCampEditModal(){
  const camp=state.campaigns.find(cc=>cc.id===state.activeCampId); if(!camp) return;
  state.editingCampId=state.activeCampId;
  renderCampTable();
  const row=document.getElementById('campAddRow');
  if(row){
    row.classList.add('visible');
    const dateEl=document.getElementById('ca-date'); if(dateEl) dateEl.value=camp.date||today();
    const cdEl=document.getElementById('ca-cd'); if(cdEl) cdEl.value=camp.campaign_cd||'';
    const nmEl=document.getElementById('ca-nm'); if(nmEl) nmEl.value=camp.campaign_nm||'';
    const evEl=document.getElementById('ca-event'); if(evEl) evEl.value=camp.event_name||'';
    const typeEl=document.getElementById('ca-type'); if(typeEl) typeEl.value=camp.type||'BAU';
    const trigEl=document.getElementById('ca-trigger'); if(trigEl) trigEl.value=camp.trigger_type||'Batch';
    const statEl=document.getElementById('ca-status'); if(statEl) statEl.value=camp.status||'Active';
    const noteEl=document.getElementById('ca-note'); if(noteEl) noteEl.value=camp.note||'';
    setTimeout(()=>{if(cdEl)cdEl.focus();},50);
  }
}

export function closeCampModal(){ hideInlineCampRow(); state.editingCampId=null; }

// Dispatcher for the inline add/edit row's Save button — the row is shared between
// "add new" and "edit existing" modes, distinguished by state.editingCampId.
export function saveCampRow(){ state.editingCampId?saveCampaign():saveInlinecamp(); }

export function saveCampaign(){
  // called when editing via inline row in edit mode
  if(!state.editingCampId) return;
  const cd=document.getElementById('ca-cd').value.trim();
  const nm=document.getElementById('ca-nm').value.trim();
  if(!cd||!nm){ document.getElementById('ca-cd').focus(); return; }
  const camp=state.campaigns.find(cc=>cc.id===state.editingCampId); if(!camp) return;
  camp.campaign_cd=cd; camp.campaign_nm=nm;
  camp.event_name=document.getElementById('ca-event').value.trim();
  camp.type=document.getElementById('ca-type').value;
  camp.trigger_type=document.getElementById('ca-trigger').value;
  camp.status=document.getElementById('ca-status').value;
  camp.date=document.getElementById('ca-date').value;
  camp.note=document.getElementById('ca-note').value.trim();
  camp.modified=today();
  saveOneCamp(camp); hideInlineCampRow(); state.editingCampId=null; renderCampTable(); selectCamp(camp.id);
}

export function confirmDeleteCamp(){
  if(!state.activeCampId) return;
  const camp=state.campaigns.find(c=>c.id===state.activeCampId); if(!camp) return;
  if(!confirm('Delete campaign "'+camp.campaign_cd+' — '+camp.campaign_nm+'"? This cannot be undone.')) return;
  deleteCampDB(state.activeCampId); state.campaigns=state.campaigns.filter(c=>c.id!==state.activeCampId);
  state.activeCampId=null;
  document.getElementById('campSidePanel').classList.remove('open');
  renderCampTable();
}

// ══════════════════════════════════════════════════
// CAMPAIGN SIDE PANEL RESIZE
// ══════════════════════════════════════════════════
let campResizing=false,campResizeStartX=0,campResizeStartW=0;
export function startCampResize(e){
  campResizing=true; campResizeStartX=e.clientX;
  campResizeStartW=document.getElementById('campSidePanel').offsetWidth;
  document.getElementById('campResizer').classList.add('dragging');
  document.body.style.cursor='col-resize';
  document.body.style.userSelect='none';
  e.preventDefault();
}

export function initCampaigns(){
  window.sortCamp=sortCamp;
  window.selectCamp=selectCamp;
  window.addCampExtra=addCampExtra;
  window.deleteCampExtra=deleteCampExtra;
  window.openCampEditModal=openCampEditModal;
  window.confirmDeleteCamp=confirmDeleteCamp;
  window.closeCampPanel=closeCampPanel;
  window.clearCampFilters=clearCampFilters;
  window.saveCampRow=saveCampRow;
  window.hideInlineCampRow=hideInlineCampRow;
  window.startCampResize=startCampResize;

  ['cf-cd','cf-nm','cf-event'].forEach(id=>document.getElementById(id).addEventListener('input',renderCampTable));
  ['cf-type','cf-trigger','cf-status','cf-month','cf-year'].forEach(id=>document.getElementById(id).addEventListener('change',renderCampTable));
  document.querySelectorAll('table.camp-table th[data-col]').forEach(th=>{
    th.addEventListener('click',()=>sortCamp(th.dataset.col));
  });
  document.querySelector('.camp-clear-btn').onclick=clearCampFilters;
  document.getElementById('campResizer').addEventListener('mousedown',startCampResize);
  document.querySelector('.csp-close-btn').onclick=closeCampPanel;
  document.querySelector('.csp-edit-btn').onclick=openCampEditModal;
  document.querySelector('.csp-del-btn').onclick=confirmDeleteCamp;

  document.addEventListener('mousemove',e=>{
    if(!campResizing)return;
    const delta=campResizeStartX-e.clientX;
    const newW=Math.min(560,Math.max(200,campResizeStartW+delta));
    document.getElementById('campSidePanel').style.width=newW+'px';
  });
  document.addEventListener('mouseup',()=>{
    if(!campResizing)return;
    document.getElementById('campResizer').classList.remove('dragging');
    document.body.style.cursor=''; document.body.style.userSelect=''; campResizing=false;
  });
}
