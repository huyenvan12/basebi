// ══════════════════════════════════════════════════
// CHECKLIST SHARING — My Checklists hub (owner side incl. share badges/panel),
// share modal, and the read-only Shared-with-me / reviewer views.
// ══════════════════════════════════════════════════
import { state } from './state.js';
import { esc, escJs, authorName, showInlineConfirm } from './ui-helpers.js';
import { sb } from './supabase-client.js';
import { groupChecklistItems, renderChecklistSections, openChecklistDetail } from './checklist-instances.js';
// Intentional narrow circular import (same accepted pattern as folders.js<->notes.js):
// main.js imports this module's exports for wiring, and openReviewerChecklist here needs
// main.js's cross-domain nav router. Safe — only invoked inside function bodies.
import { switchChecklistSubView } from './main.js';

// ══════════════════════════════════════════════════
// DATA LAYER
// ══════════════════════════════════════════════════
export async function loadChecklistShares(){
  const{data,error}=await sb.from('checklist_shares').select('*');
  if(error||!data) return [];
  return data;
}
export async function loadSharedWithMeInstances(ids){
  if(!ids.length) return [];
  const{data,error}=await sb.from('checklist_instances').select('*').in('id',ids);
  if(error||!data) return [];
  return data.map(c=>({...c,items:c.items||[]}));
}
export async function loadOrgMembers(){
  if(!state.currentUserOrgId) return [];
  const{data,error}=await sb.from('profiles').select('id,display_name,is_qa_seat').eq('org_id',state.currentUserOrgId).neq('id',state.currentUserId);
  if(error||!data) return [];
  return data;
}

export function updateSharedWithMeBadge(){
  const badge=document.getElementById('sharedWithMeBadge');
  const n=state.checklistShares.filter(s=>s.shared_with===state.currentUserId&&!s.viewer_seen_at).length;
  badge.textContent=n;
  badge.style.display=n?'':'none';
}

// ── My Checklists (global hub) ────────────────────
export function renderMyChecklists(){
  const el=document.getElementById('checklistInstanceGroups');
  const inProgress=state.checklistInstances.filter(c=>c.status!=='done');
  const done=state.checklistInstances.filter(c=>c.status==='done');
  const cardHtml=c=>{
    const items=c.items||[];
    const total=items.length,doneCount=items.filter(i=>i.done).length;
    const pct=total?Math.round(doneCount/total*100):0;
    const flagged=items.filter(i=>i.note&&i.note.trim()&&!i.done).length;
    const tpl=state.checklistTemplates.find(t=>t.id===c.template_id);
    const shares=state.checklistShares.filter(s=>s.instance_id===c.id);
    const unackCount=shares.filter(s=>s.comment&&s.comment.trim()&&(!s.owner_ack_at||(s.comment_updated_at&&s.comment_updated_at>s.owner_ack_at))).length;
    const panelOpen=!!state.checklistSharePanelOpen[c.id];
    const shareControl=shares.length===0
      ?`<button class="btn btn-ghost ci-share-btn" data-tour-id="checklist-share" onclick="openShareModal('${escJs(c.id)}')">+ Share</button>`
      :`<button class="ci-share-badge-btn" onclick="toggleSharePanel('${escJs(c.id)}')">
          <span class="ci-share-badge-seg">🔗 ${shares.length}</span>${unackCount?`<span class="ci-share-badge-divider"></span><span class="ci-share-badge-seg ci-share-badge-comment">💬 ${unackCount}</span>`:''}
          <span class="ci-share-badge-chevron">${panelOpen?'▴':'▾'}</span>
        </button>`;
    return`<div class="card checklist-instance-card">
      <div class="ci-card-header-row">
        <div class="ci-card-title">${esc(c.title)}</div>
        <div class="ci-card-share-wrap">
          ${shareControl}
        </div>
      </div>
      <div class="ci-card-tpl">from: ${esc(tpl?tpl.title:'(template removed)')}</div>
      <div class="checklist-progress-bar-outer"><div class="checklist-progress-bar-inner" style="width:${pct}%"></div></div>
      <div class="ci-card-meta">
        <span>${doneCount}/${total} done</span>
        ${flagged?`<span class="checklist-flag-badge">🚩 ${flagged} flagged</span>`:''}
      </div>
      ${panelOpen?renderSharePanel(c,shares):''}
      <div class="ci-card-footer">
        <button class="ci-view-detail-btn" onclick="openChecklistDetail('${escJs(c.id)}')">View details →</button>
      </div>
    </div>`;
  };
  let html='';
  html+=`<div class="section-label checklist-group-label">In Progress (${inProgress.length})</div>`;
  html+=inProgress.length?`<div class="checklist-instance-grid">${inProgress.map(cardHtml).join('')}</div>`:'<div class="empty-list">No checklists in progress</div>';
  html+=`<div class="section-label checklist-group-label">Done (${done.length})</div>`;
  html+=done.length?`<div class="checklist-instance-grid">${done.map(cardHtml).join('')}</div>`:'<div class="empty-list">No completed checklists yet</div>';
  el.innerHTML=html;
}
export function renderSharePanel(inst,shares){
  const rows=shares.map(s=>{
    const hasComment=!!(s.comment&&s.comment.trim());
    const unack=!!(hasComment&&(!s.owner_ack_at||(s.comment_updated_at&&s.comment_updated_at>s.owner_ack_at)));
    const commentClass=hasComment?(unack?' share-panel-comment-unseen':''):' share-panel-comment-empty';
    return`<div class="share-panel-row">
      <div class="share-panel-name-line">${unack?'<span class="unseen-dot" title="Unacknowledged comment"></span>':''}<span class="share-panel-name">${esc(authorName(s.shared_with))}</span></div>
      <div class="share-panel-comment${commentClass}">${hasComment?esc(s.comment):'no comment yet'}</div>
      <div class="share-panel-links">
        ${unack?`<button class="share-panel-link share-panel-link-seen" onclick="ackShareComment('${escJs(s.id)}')">Mark seen</button>`:''}
        <button class="share-panel-link share-panel-link-unshare" onclick="confirmUnshare(this,'${escJs(s.id)}')">Unshare</button>
      </div>
    </div>`;
  }).join('');
  return`<div class="share-panel">${rows}
    <div class="share-panel-add" onclick="openShareModal('${escJs(inst.id)}')">+ Add another person</div>
  </div>`;
}
export function toggleSharePanel(instanceId){
  state.checklistSharePanelOpen[instanceId]=!state.checklistSharePanelOpen[instanceId];
  renderMyChecklists();
}
export async function ackShareComment(shareId){
  const share=state.checklistShares.find(s=>s.id===shareId);if(!share)return;
  share.owner_ack_at=new Date().toISOString();
  await sb.from('checklist_shares').update({owner_ack_at:share.owner_ack_at}).eq('id',shareId);
  renderMyChecklists();
}
export function confirmUnshare(btnEl,shareId){
  showInlineConfirm(btnEl,'Unshare this checklist from this person? They will lose access.',
    ()=>unshareChecklist(shareId),
    {container:'.share-panel-row',confirmLabel:'Yes, unshare'});
}
export async function unshareChecklist(shareId){
  await sb.from('checklist_shares').delete().eq('id',shareId);
  state.checklistShares=state.checklistShares.filter(s=>s.id!==shareId);
  updateSharedWithMeBadge();
  renderMyChecklists();
}

// ── Share modal (flat org member list, toggle share on/off) ──
export function openShareModal(instanceId){
  state.shareModalInstanceId=instanceId;
  renderShareModalMemberList();
  document.getElementById('shareModalOverlay').classList.add('open');
}
export function closeShareModal(){
  document.getElementById('shareModalOverlay').classList.remove('open');
  state.shareModalInstanceId=null;
  renderMyChecklists();
}
export function renderShareModalMemberList(){
  const el=document.getElementById('shareModalMemberList');
  if(!state.orgMembers.length){el.innerHTML='<div class="empty-list">No other org members found</div>';return;}
  const shares=state.checklistShares.filter(s=>s.instance_id===state.shareModalInstanceId);
  el.innerHTML=state.orgMembers.map(m=>{
    const existing=shares.find(s=>s.shared_with===m.id);
    return`<div class="share-modal-row">
      <span class="share-modal-name">${esc(m.display_name||'Unknown')}</span>
      <button class="btn ${existing?'btn-ghost':'btn-primary'}" onclick="toggleShareMember('${escJs(m.id)}',${existing?`'${escJs(existing.id)}'`:'null'})">${existing?'✓ Shared':'Share'}</button>
    </div>`;
  }).join('');
}
export async function toggleShareMember(memberId,existingShareId){
  if(existingShareId){
    await sb.from('checklist_shares').delete().eq('id',existingShareId);
    state.checklistShares=state.checklistShares.filter(s=>s.id!==existingShareId);
  }else{
    const{data,error}=await sb.from('checklist_shares').insert({instance_id:state.shareModalInstanceId,shared_by:state.currentUserId,shared_with:memberId}).select().single();
    if(!error&&data)state.checklistShares.push(data);
  }
  renderShareModalMemberList();
}

// ── Shared with me (read-only recipient views) ────
export function renderSharedWithMeList(){
  const el=document.getElementById('checklistSharedGroups');
  const mine=state.checklistShares.filter(s=>s.shared_with===state.currentUserId);
  if(!mine.length){el.innerHTML='<div class="empty-list">Nothing has been shared with you yet</div>';return;}
  el.innerHTML=`<div class="checklist-instance-grid">${mine.map(s=>{
    const inst=state.sharedWithMeInstances.find(i=>i.id===s.instance_id);
    if(!inst) return '';
    const items=inst.items||[];
    const total=items.length,doneCount=items.filter(i=>i.done).length;
    const pct=total?Math.round(doneCount/total*100):0;
    return`<div class="card checklist-instance-card">
      <div class="ci-card-header-row">
        <div class="ci-card-title">${esc(inst.title)}</div>
        ${!s.viewer_seen_at?'<span class="ci-new-tag">new</span>':''}
      </div>
      <div class="ci-card-tpl">shared by ${esc(authorName(s.shared_by))} · view only</div>
      <div class="checklist-progress-bar-outer"><div class="checklist-progress-bar-inner" style="width:${pct}%"></div></div>
      <div class="ci-card-meta"><span>${doneCount}/${total} done</span></div>
      <div class="ci-card-footer">
        <button class="ci-view-detail-btn" onclick="openReviewerChecklist('${escJs(s.id)}')">View details →</button>
      </div>
    </div>`;
  }).join('')}</div>`;
}
export function getReviewShare(){ return state.checklistShares.find(s=>s.id===state.activeReviewShareId); }
export function openReviewerChecklist(shareId){
  state.activeReviewShareId=shareId;
  state.reviewerCommentEditing=false;
  state.reviewerCommentError=null;
  markShareSeen(shareId);
  switchChecklistSubView('reviewer');
}
export async function markShareSeen(shareId){
  const share=state.checklistShares.find(s=>s.id===shareId);
  if(!share||share.viewer_seen_at)return;
  const now=new Date().toISOString();
  share.viewer_seen_at=now;
  updateSharedWithMeBadge();
  await sb.from('checklist_shares').update({viewer_seen_at:now}).eq('id',shareId);
}
export function renderReviewerChecklist(){
  const el=document.getElementById('checklistReviewerScroll');
  const share=getReviewShare();
  const inst=share&&state.sharedWithMeInstances.find(i=>i.id===share.instance_id);
  if(!share||!inst){el.innerHTML='<div class="empty-state"><p>Checklist not found</p></div>';return;}
  const grouped=groupChecklistItems(inst.items||[]);
  const sectionsHtml=renderChecklistSections(inst,grouped,true);
  const hasComment=!!(share.comment&&share.comment.trim());
  const editing=state.reviewerCommentEditing||!hasComment;
  const commentBoxHtml=editing
    ?`<div class="reviewer-comment-box">
        <label class="form-label">Leave a comment for ${esc(authorName(share.shared_by))}</label>
        <textarea class="form-input" id="reviewerCommentInput" rows="3">${esc(share.comment||'')}</textarea>
        <div class="reviewer-comment-error" id="reviewerCommentError" style="display:${state.reviewerCommentError?'':'none'}">${esc(state.reviewerCommentError||'')}</div>
        <button class="btn btn-primary" id="reviewerCommentSaveBtn" onclick="saveShareComment('${escJs(share.id)}')">Save comment</button>
      </div>`
    :`<div class="reviewer-comment-box">
        <label class="form-label">Your comment for ${esc(authorName(share.shared_by))}</label>
        <div class="reviewer-comment-locked-text">${esc(share.comment)}</div>
        <button type="button" class="reviewer-comment-edit-link" onclick="editShareComment()">✏️ Edit</button>
      </div>`;
  el.innerHTML=`
    <div class="reviewer-banner">Reviewing "<strong>${esc(inst.title)}</strong>" — shared by ${esc(authorName(share.shared_by))}</div>
    ${commentBoxHtml}
    <div class="checklist-detail-body">${sectionsHtml}</div>
    <div class="checklist-readonly-bar">🔒 Items are locked — this is a read-only view</div>`;
}
export function editShareComment(){
  state.reviewerCommentEditing=true;
  state.reviewerCommentError=null;
  renderReviewerChecklist();
}
export async function saveShareComment(shareId){
  const share=state.checklistShares.find(s=>s.id===shareId);if(!share)return;
  const textarea=document.getElementById('reviewerCommentInput');
  const text=textarea.value;
  const now=new Date().toISOString();
  const btn=document.getElementById('reviewerCommentSaveBtn');
  const errEl=document.getElementById('reviewerCommentError');
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  const{error}=await sb.from('checklist_shares').update({comment:text,comment_updated_at:now}).eq('id',shareId);
  if(error){
    // Keep the textarea open with the user's unsaved text intact — a full re-render
    // here would revert to the last-saved share.comment and silently discard their edit.
    state.reviewerCommentError='Could not save your comment. Please try again.';
    if(errEl){errEl.textContent=state.reviewerCommentError;errEl.style.display='';}
    if(btn){btn.disabled=false;btn.textContent='Save comment';}
    return;
  }
  share.comment=text;share.comment_updated_at=now;
  state.reviewerCommentEditing=false;
  state.reviewerCommentError=null;
  renderReviewerChecklist();
}

export function initChecklistShare(){
  window.openShareModal=openShareModal;
  window.toggleSharePanel=toggleSharePanel;
  window.ackShareComment=ackShareComment;
  window.confirmUnshare=confirmUnshare;
  window.unshareChecklist=unshareChecklist;
  window.toggleShareMember=toggleShareMember;
  window.openReviewerChecklist=openReviewerChecklist;
  window.editShareComment=editShareComment;
  window.saveShareComment=saveShareComment;

  document.querySelector('#shareModalOverlay .modal-close').onclick=closeShareModal;
  document.querySelector('#shareModalOverlay .modal-actions .btn').onclick=closeShareModal;
}
