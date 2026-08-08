// ══════════════════════════════════════════════════
// NOTES — CRUD, search index, wiki-link graph data, tag/link chip UI,
// search screen + note popup, team-shared list. The heaviest, most
// depended-upon domain module.
// ══════════════════════════════════════════════════
import { GRAPH_TAG_HUB_CAP, SEED_NOTES } from './constants.js';
import { state } from './state.js';
import { esc, authorName } from './ui-helpers.js';
import { sb } from './supabase-client.js';
// Narrow, intentional circular import: folders.js already imports renderFolders/selectFolder
// from this file (via renderAll), and this file needs myNotes/saveNotes/renderAll from
// notes.js. Safe because every cross-call below happens inside event-handler function
// bodies, never at module top-level. Do not "fix" this by inlining logic.
import { renderFolders, selectFolder } from './folders.js';
// Second narrow, intentional circular import: daily-note.js needs saveOneNote/buildIndex/
// renderAll/selectNote/renderDetail/focusDailyCapture from this file, and saveNote() here
// needs daily-note.js's today() for created/modified timestamps. Safe under the same
// function-body-only rule as the folders.js cycle above.
import { today } from './daily-note.js';
// Third narrow, intentional circular import (same rule as above): tasks.js needs
// saveOneNote/renderDetail/selectNote from this file, and this file needs the line-anchor
// marker helpers + task lookup from tasks.js to render Daily Note lines. Function-body-only.
import { LINE_ID_RE, stripLineId, findTaskByLineId, dailyLineIconHtml, reattachLineIds } from './tasks.js';
import { isFeatureVisible } from './feature-flags.js';
import { setHintScreen } from './onboarding-tooltips.js';

// ══════════════════════════════════════════════════
// DATA LAYER
// ══════════════════════════════════════════════════
export async function loadNotes(){
  const{data,error}=await sb.from('notes').select('*').order('modified',{ascending:false});
  if(error||!data||!data.length) return JSON.parse(JSON.stringify(SEED_NOTES));
  return data.map(n=>({...n,tags:n.tags||[],links:n.links||[]}));
}
export async function saveNotes(arr){
  // only ever push the current user's own rows — arr may contain shared notes
  // owned by other users (visible via RLS), which would get rejected and fail
  // the WHOLE batch since notes_insert/notes_update require owner_id=auth.uid()
  const own = arr.filter(n=>n.owner_id===state.currentUserId);
  if(!own.length) return;
  const rows = own.map(n=>({
    id:n.id, title:n.title, folder:n.folder, folder_id:n.folder_id||null, type:n.type,
    tags:n.tags||[], links:n.links||[], body:n.body||null,
    code:n.code||null, pinned:n.pinned||false,
    created:n.created, modified:n.modified, daily_date:n.daily_date||null,
    is_shared:n.is_shared||false
  }));
  await sb.from('notes').upsert(rows,{onConflict:'id'});
}
export async function saveOneNote(n){
  const{data,error}=await sb.from('notes').upsert({
    id:n.id, title:n.title, folder:n.folder, folder_id:n.folder_id||null, type:n.type,
    tags:n.tags||[], links:n.links||[], body:n.body||null,
    code:n.code||null, pinned:n.pinned||false,
    created:n.created, modified:n.modified, daily_date:n.daily_date||null,
    is_shared:n.is_shared||false
  },{onConflict:'id'}).select().single();
  if(error) throw error;
  n.id=data.id;
  return data;
}

// ══════════════════════════════════════════════════
// INDEX
// ══════════════════════════════════════════════════
export function buildIndex(){
  state.idx={};
  state.notes.filter(n=>!n.deleted).forEach(n=>{
    const text=[n.title,n.body||'',n.code||'',(n.tags||[]).join(' ')].join(' ').toLowerCase();
    (text.match(/\w+/g)||[]).forEach(tok=>{if(!state.idx[tok])state.idx[tok]=new Set();state.idx[tok].add(n.id);});
  });
}
export function searchIds(q){
  if(!q.trim())return state.notes.filter(n=>!n.deleted).map(n=>n.id);
  const tokens=q.toLowerCase().match(/\w+/g)||[];
  let result=null;
  tokens.forEach(tok=>{
    const partial=new Set();
    Object.keys(state.idx).forEach(k=>{if(k.startsWith(tok))state.idx[k].forEach(id=>partial.add(id));});
    result=result===null?partial:new Set([...result].filter(id=>partial.has(id)));
  });
  return[...(result||[])];
}

// notes the current user is allowed to see the existence/title/content of: their own
// notes plus anything explicitly shared org-wide. `state.notes` itself may contain other
// users' private notes too (RLS only enforces org-scoping, not per-user privacy), so
// every UI surface that lists/suggests/links notes MUST filter through this — never
// iterate the raw `state.notes` array directly for anything user-facing.
export function visibleNotes(){ return state.notes.filter(n=>(n.owner_id===state.currentUserId||n.is_shared)&&!n.deleted); }

// ══════════════════════════════════════════════════
// LINK INDEX (backlinks + graph edge data)
// Built client-side from notes already in memory — no schema change, no extra fetch.
// Module-local — nothing outside notes.js/graph-view.js needs raw edge access.
// ══════════════════════════════════════════════════
let linkEdges=[];   // [{a:noteId,b:noteId}] — from [[ ]] refs (body text + note.links array)
let tagEdges=[];    // [{a:noteId,b:noteId,tag:'...'}] — from shared tags
let backlinks={};   // noteId -> Set(noteId) reverse map, union of link+tag edges (undirected, used by Graph)
let incomingLinks={}; // noteId -> Set(noteId) — notes that link TO this note (directed, used by Notes tab backlinks section)

export function getLinkEdges(){ return linkEdges; }
export function getTagEdges(){ return tagEdges; }
// Raw id Set (not note objects) — used by graph-view.js's neighbor highlighting/counting,
// which needs to compare/filter ids directly rather than resolved note objects (see getBacklinks below).
export function getBacklinkIds(noteId){ return backlinks[noteId]||new Set(); }

export function buildLinkIndex(){
  linkEdges=[]; tagEdges=[]; backlinks={}; incomingLinks={};
  // scoped to visibleNotes() — a private note owned by someone else must never surface
  // as a backlink/graph connection, even if it happens to reference or share a tag with
  // a note you can see.
  const vis=visibleNotes();
  vis.forEach(n=>{backlinks[n.id]=new Set(); incomingLinks[n.id]=new Set();});

  const titleToId={};
  vis.forEach(n=>titleToId[n.title.trim().toLowerCase()]=n.id);

  const seenLinkPairs=new Set();
  function addLinkEdge(fromId,toId){
    if(fromId==null||toId==null||fromId===toId)return;
    incomingLinks[toId].add(fromId);
    const key=fromId<toId?fromId+'_'+toId:toId+'_'+fromId;
    if(seenLinkPairs.has(key))return;
    seenLinkPairs.add(key);
    linkEdges.push({a:fromId,b:toId});
    backlinks[fromId].add(toId); backlinks[toId].add(fromId);
  }

  const wikiLinkRe=/\[\[([^\]]+)\]\]/g;
  vis.forEach(n=>{
    // explicit links array (chosen via dropdown)
    (n.links||[]).forEach(title=>{
      const tid=titleToId[String(title).trim().toLowerCase()];
      if(tid!=null)addLinkEdge(n.id,tid);
    });
    // raw [[Title]] refs inside body text
    const body=n.body||'';
    let m;
    wikiLinkRe.lastIndex=0;
    while((m=wikiLinkRe.exec(body))){
      const tid=titleToId[m[1].trim().toLowerCase()];
      if(tid!=null)addLinkEdge(n.id,tid);
    }
  });

  // shared-tag edges — skip tags that are hubs (shared by too many notes) to avoid a hairball
  const tagGroups={};
  vis.forEach(n=>(n.tags||[]).forEach(t=>{
    if(!tagGroups[t])tagGroups[t]=[];
    tagGroups[t].push(n.id);
  }));
  const seenTagPairs=new Set();
  Object.entries(tagGroups).forEach(([tag,ids])=>{
    if(ids.length<2||ids.length>GRAPH_TAG_HUB_CAP)return;
    for(let i=0;i<ids.length;i++){
      for(let j=i+1;j<ids.length;j++){
        const a=ids[i],b=ids[j];
        const key=a<b?a+'_'+b:b+'_'+a;
        if(seenTagPairs.has(key))continue; // avoid drawing the same pair twice for multiple shared tags
        seenTagPairs.add(key);
        tagEdges.push({a,b,tag});
        backlinks[a].add(b); backlinks[b].add(a);
      }
    }
  });
}

export function getBacklinks(noteId){
  return [...(backlinks[noteId]||[])].map(id=>state.notes.find(n=>n.id===id)).filter(Boolean);
}
export function getIncomingLinks(noteId){
  return [...(incomingLinks[noteId]||[])].map(id=>state.notes.find(n=>n.id===id)).filter(Boolean);
}

// ══════════════════════════════════════════════════
// FILTERED VIEWS
// ══════════════════════════════════════════════════
export function myNotes(){ return state.notes.filter(n=>n.owner_id===state.currentUserId&&!n.deleted); }
export function getFiltered(){
  const own=myNotes();
  let ids=state.searchQuery?searchIds(state.searchQuery):own.map(n=>n.id);
  let f=own.filter(n=>ids.includes(n.id));
  if(state.activeFolder!=='all')f=f.filter(n=>n.folder===state.activeFolder);
  if(state.activeTag)f=f.filter(n=>(n.tags||[]).includes(state.activeTag));
  f.sort((a,b)=>{ if(a.pinned&&!b.pinned)return -1; if(!a.pinned&&b.pinned)return 1; return new Date(b.modified||b.created||0)-new Date(a.modified||a.created||0); });
  return f;
}

// ══════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════
export function hl(text,q){
  if(!q)return esc(text);
  const s=esc(text),tokens=(q.toLowerCase().match(/\w+/g)||[]);
  if(!tokens.length)return s;
  return s.replace(new RegExp('('+tokens.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')','gi'),'<mark>$1</mark>');
}
export function sqlHL(code){
  function escI(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  // tokenize: protect strings and comments first
  const tokens=[];
  const safe=/\/\*[\s\S]*?\*\/|\*[^;\n]*;|--[^\n]*|'[^']*'|"[^"]*"/g;
  let last=0, m;
  safe.lastIndex=0;
  while((m=safe.exec(code))!==null){
    if(m.index>last) tokens.push({t:'code',v:code.slice(last,m.index)});
    const v=m[0];
    if(v.startsWith('/*')||v.startsWith('*')||v.startsWith('--')) tokens.push({t:'cm',v});
    else tokens.push({t:'str',v});
    last=m.index+v.length;
  }
  if(last<code.length) tokens.push({t:'code',v:code.slice(last)});

  const sqlKw=/\b(SELECT|FROM|WHERE|AND|OR|NOT|IN|ON|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|GROUP BY|ORDER BY|HAVING|AS|DISTINCT|CASE|WHEN|THEN|ELSE|END|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|DROP|ALTER|WITH|UNION|ALL|BETWEEN|LIKE|IS|NULL|LIMIT|TOP|OFFSET|BY|ASC|DESC|CALCULATED|MISSING|NODUP|NODUPKEY)\b/gi;
  const sasKw=/\b(PROC|DATA|RUN|QUIT|OUTPUT|KEEP|DROP|RETAIN|LENGTH|FORMAT|INFORMAT|LABEL|MERGE|IF|THEN|DO|ELSE|ARRAY|CARDS|DATALINES|CLASS|VAR|TABLES|MODEL|MEANS|FREQ|SORT|PRINT|REPORT|TABULATE|SQL|APPEND|CONTENTS|DATASETS|COPY|RENAME|FIRST|LAST)\b/gi;
  const macroKw=/%(?:LET|IF|THEN|DO|END|ELSE|MACRO|MEND|PUT|INCLUDE|GLOBAL|LOCAL|EVAL|STR|NRSTR|QUOTE|SYSFUNC|LEFT|TRIM|UPCASE|LOWCASE)|&\w+\.?/g;
  const fnKw=/\b(COALESCE|INPUT|PUT|CATS|CATX|CAT|CATT|COMPRESS|STRIP|TRIM|LEFT|RIGHT|SUBSTR|INDEX|SCAN|TRANWRD|UPCASE|LOWCASE|PROPCASE|INT|ROUND|CEIL|FLOOR|ABS|MOD|MAX|MIN|SUM|MEAN|NMISS|MONOTONIC|DATEPART|TIMEPART|MDY|TODAY|DATE|TIME|YEAR|MONTH|DAY|QTR|WEEK|INTNX|INTCK|DATDIF|YRDIF|COUNT|AVG|DATEDIFF|GETDATE|ISNULL|NULLIF|CAST|CONVERT|LEN|SUBSTRING|DATEADD|NVL|TO_DATE|DECODE)\b/gi;
  const numRe=/\b\d+(\.\d+)?\b/g;

  return tokens.map(tok=>{
    if(tok.t==='cm') return '<span class="cm">'+escI(tok.v)+'</span>';
    if(tok.t==='str') return '<span class="str">'+escI(tok.v)+'</span>';
    return escI(tok.v)
      .replace(macroKw,function(m){return '<span class="mac">'+m+'</span>';})
      .replace(sasKw, function(m){return '<span class="sas">'+m+'</span>';})
      .replace(sqlKw, function(m){return '<span class="kw">'+m+'</span>';})
      .replace(fnKw,  function(m){return '<span class="fn">'+m+'</span>';})
      .replace(numRe, function(m){return '<span class="num">'+m+'</span>';});
  }).join('');
}
export function fmtDate(d){return d?d.slice(0,10):'';}
export function allTags(list){const t={};(list||state.notes.filter(n=>!n.deleted)).forEach(n=>(n.tags||[]).forEach(tag=>{t[tag]=(t[tag]||0)+1;}));return t;}

export function copyBtn(btn,text){
  // Try modern clipboard API first, fall back to execCommand for file:// protocol
  const doFeedback=()=>{
    btn.textContent='✓ Copied';btn.classList.add('copied');
    setTimeout(()=>{btn.textContent='Copy';btn.classList.remove('copied');},1500);
  };
  if(navigator.clipboard && window.isSecureContext){
    navigator.clipboard.writeText(text).then(doFeedback).catch(()=>fallbackCopy(text,doFeedback));
  } else {
    fallbackCopy(text,doFeedback);
  }
}
export function fallbackCopy(text,cb){
  const ta=document.createElement('textarea');
  ta.value=text; ta.style.position='fixed'; ta.style.opacity='0';
  document.body.appendChild(ta); ta.focus(); ta.select();
  try{ document.execCommand('copy'); if(cb)cb(); }catch(e){}
  document.body.removeChild(ta);
}
export function copyNoteCode(btn){
  const raw=btn.getAttribute('data-noteid');
  const note=state.notes.find(n=>String(n.id)===raw);
  if(note&&note.code) copyBtn(btn,note.code);
}

// ══════════════════════════════════════════════════
// RENDER — TAG CLOUD
// ══════════════════════════════════════════════════
export function renderTagCloud(){
  const tags=allTags(myNotes());
  document.getElementById('tagCloud').innerHTML=Object.entries(tags).sort((a,b)=>b[1]-a[1])
    .map(([t,c])=>`<div class="tag-row">
      <span class="tag-chip ${state.activeTag===t?'active':''}" onclick="selectTag('${esc(t)}')">
        <span class="tag-name">#${esc(t)}</span><span class="tag-count">${c}</span></span>
      <button class="tag-act-btn" onclick="openTagModal('${esc(t)}')" title="Rename">✎</button>
      <button class="tag-act-btn del" onclick="deleteTag('${esc(t)}')" title="Delete">×</button>
    </div>`).join('');
}

// ══════════════════════════════════════════════════
// RENDER — NOTE LIST
// ══════════════════════════════════════════════════
export function renderNoteList(){
  const filtered=getFiltered();
  document.getElementById('listTitle').textContent=state.activeFolder==='all'?'All Notes':state.activeFolder;
  document.getElementById('noteCount').textContent=filtered.length+' note'+(filtered.length!==1?'s':'');
  document.getElementById('noteItems').innerHTML=filtered.length===0
    ?'<div class="note-empty">No notes found</div>'
    :filtered.map(n=>{
      const excerpt=(n.body||n.code||'').slice(0,55).replace(/\n/g,' ');
      return`<div class="note-item ${n.id===state.activeNoteId?'active':''}" onclick="selectNote('${n.id}')">
        <div class="note-item-title">${n.pinned?'<span class="note-item-pin">📌</span> ':''} ${hl(n.title,state.searchQuery)}</div>
        <div class="note-item-meta">
          <span class="note-type-badge ${n.type==='code'?'type-code':'type-plain'}">${n.type==='code'?'Code':'Plain'}</span>
          <span class="note-item-folder">${esc(n.folder)}</span>
          <span class="note-item-modified">${fmtDate(n.modified||n.created)}</span>
        </div>
        <div class="note-item-excerpt">${hl(excerpt,state.searchQuery)}</div>
      </div>`;
    }).join('');

  // mobile-web card view (<=768px, see basebi.css @media block) — mirrors noteItems above
  const cardsWrap=document.getElementById('noteCardsWrap');
  if(cardsWrap){
    cardsWrap.innerHTML=filtered.length===0
      ?'<div class="note-empty">No notes found</div>'
      :filtered.map(n=>{
        const excerpt=(n.body||n.code||'').slice(0,55).replace(/\n/g,' ');
        return`<div class="mob-team-card ${n.id===state.activeNoteId?'active':''}" onclick="selectNote('${n.id}')">
          <div class="mob-team-card-title">${n.pinned?'📌 ':''}${hl(n.title,state.searchQuery)}</div>
          <div class="mob-team-card-meta">
            <span class="note-type-badge ${n.type==='code'?'type-code':'type-plain'}">${n.type==='code'?'Code':'Plain'}</span>
            <span class="note-item-folder">${esc(n.folder)}</span>
            <span class="note-item-modified">${fmtDate(n.modified||n.created)}</span>
          </div>
          <div class="mob-team-card-excerpt">${hl(excerpt,state.searchQuery)}</div>
        </div>`;
      }).join('');
  }
}

// ══════════════════════════════════════════════════
// RENDER — NOTE DETAIL
// ══════════════════════════════════════════════════
export function renderDetail(note){
  const el=document.getElementById('noteDetail');
  el.classList.toggle('mob-overlay-open', !!note);
  if(!note){el.innerHTML=`<div class="empty-state"><div class="icon">📋</div><p>Select a note to view it</p><p style="font-size:11px">or press + New Note</p></div>`;return;}
  const tags=(note.tags||[]).map(t=>`<span class="detail-tag">#${esc(t)}</span>`).join('');
  const links=(note.links||[]).filter(Boolean);
  let body='';
  if(note.type==='code'||note.type==='sql'){
    body=`<div class="code-block">
      <div class="code-header"><span class="code-lang">Code</span>
        <button class="code-copy" data-noteid="${note.id}" onclick="copyNoteCode(this)">Copy</button>
      </div>
      <pre class="code-body">${sqlHL(note.code||'')}</pre></div>`;
    if(note.body)body+=`<div class="note-desc">${hl(note.body,state.searchQuery)}</div>`;
  }else if(note.daily_date){body=`<div class="note-body daily-log-body">${renderDailyBodyLines(note,state.searchQuery)}</div>`;}
  else{body=`<div class="note-body">${renderBodyWithLinks(note.body||'',state.searchQuery)}</div>`;}
  const linkedSection=links.length?`<div class="linked-section">
    <div class="linked-label">Linked Notes</div>
    <div class="linked-chips">${links.map(l=>`<span class="linked-chip" onclick="jumpToLink('${esc(l)}')">↗ ${esc(l)}</span>`).join('')}</div>
  </div>`:'';
  buildLinkIndex();
  const outgoingTitles=new Set(links.map(l=>l.trim().toLowerCase()));
  const incoming=getIncomingLinks(note.id).filter(bn=>!outgoingTitles.has(bn.title.trim().toLowerCase()));
  const backlinksSection=incoming.length?`<div class="linked-section">
    <div class="linked-label">Backlinks</div>
    <div class="linked-chips">${incoming.map(bn=>`<span class="linked-chip" onclick="jumpToLink('${esc(bn.title)}')">↙ ${esc(bn.title)}</span>`).join('')}</div>
  </div>`:'';
  const modLine=note.modified&&note.modified!==note.created?`<span>modified ${fmtDate(note.modified)}</span>`:'';
  const captureBar=note.daily_date?`<div class="capture-bar">
      <input type="text" id="dailyCaptureInput" placeholder="Log a timestamped entry…" autocomplete="off" onkeydown="if(event.key==='Enter')appendDailyEntry('${note.id}')">
      <span class="capture-hint">Enter to append</span>
    </div>`:'';
  const isOwner=note.owner_id===state.currentUserId;
  const ownerActions=isOwner?`<button class="btn btn-ghost" style="font-size:11px" onclick="openNoteModal('${note.id}')">✎ Edit</button>
      <button class="btn btn-danger" style="font-size:11px" onclick="confirmDeleteNote('${note.id}')">✕ Delete</button>`:'';
  el.innerHTML=`
    <div class="note-detail-header">
      <button class="note-detail-back-btn" onclick="closeNoteDetail()">← Back</button>
      <div class="note-detail-title">${hl(note.title,state.searchQuery)}</div>
      <div class="note-detail-meta">
        <span class="detail-folder-badge">${esc(note.folder)}</span>
        <span class="privacy-badge ${note.is_shared?'is-shared':'is-private'}">${note.is_shared?'🌐 Shared':'🔒 Private'}</span>${tags}
        <div class="detail-dates"><span>created ${fmtDate(note.created)}</span>${modLine}</div>
      </div>
    </div>
    <div class="detail-actions">
      ${ownerActions}
      <button class="pin-btn ${note.pinned?'pinned':''}" onclick="togglePin('${note.id}')" title="${note.pinned?'Unpin note':'Pin note'}">${note.pinned?'📌':'📍'}</button>
    </div>
    <div class="note-detail-content" id="noteDetailContent">${body}</div>
    ${linkedSection}
    ${backlinksSection}
    ${captureBar}`;
  if(note.daily_date){
    const contentEl=document.getElementById('noteDetailContent');
    contentEl.scrollTop=contentEl.scrollHeight;
  }
}
// Focuses the daily capture input. Deliberately NOT called from inside renderDetail()
// itself — renderDetail() re-runs for lots of unrelated reasons (e.g. typing in the
// main search bar re-renders whatever note is active), and unconditionally stealing
// focus back into this field on every one of those re-renders was breaking the search
// bar (each keystroke there would immediately bounce focus back to this input). Only
// call this from the specific actions that should actually land the user in the field.
export function focusDailyCapture(){
  const input=document.getElementById('dailyCaptureInput');
  if(input)input.focus();
}

export function renderAll(){renderFolders();renderTagCloud();renderNoteList();}

export function togglePin(id){
  const note=state.notes.find(n=>n.id===id); if(!note)return;
  note.pinned=!note.pinned;
  saveOneNote(note); renderAll(); renderDetail(note);
}

// ══════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════
export function selectNote(id){
  state.activeNoteId=id;renderNoteList();
  const note=state.notes.find(n=>n.id===id&&!n.deleted);
  renderDetail(note);
  if(note&&note.daily_date)focusDailyCapture();
}
export function selectTag(t){state.activeTag=state.activeTag===t?null:t;renderAll();}
export function handleSearch(){state.searchQuery=document.getElementById('searchInput').value;renderNoteList();if(state.activeNoteId)renderDetail(state.notes.find(n=>n.id===state.activeNoteId));}
export function jumpToLink(title){const n=visibleNotes().find(n=>n.title.toLowerCase()===title.toLowerCase());if(n)selectNote(n.id);}
// mobile-web full-screen detail overlay close — mirrors closeTeamDetail()
export function closeNoteDetail(){
  state.activeNoteId=null;
  renderNoteList();
  renderDetail(null);
}

// ══════════════════════════════════════════════════
// TEAM SHARED
// ══════════════════════════════════════════════════
export function getTeamSharedNotes(){
  return state.notes.filter(n=>n.is_shared&&n.owner_id!==state.currentUserId&&!n.deleted)
    .sort((a,b)=>new Date(b.modified||b.created||0)-new Date(a.modified||a.created||0));
}
export function renderTeamList(){
  const list=getTeamSharedNotes();
  document.getElementById('teamCount').textContent=list.length+' note'+(list.length!==1?'s':'');
  document.getElementById('teamItems').innerHTML=list.length===0
    ?'<div class="note-empty">No team-shared notes yet</div>'
    :list.map(n=>{
      const excerpt=(n.body||n.code||'').slice(0,55).replace(/\n/g,' ');
      return`<div class="note-item ${n.id===state.activeTeamNoteId?'active':''}" onclick="selectTeamNote('${n.id}')">
        <div class="note-item-title">${hl(n.title,'')}</div>
        <div class="note-item-meta">
          <span class="note-type-badge ${n.type==='code'?'type-code':'type-plain'}">${n.type==='code'?'Code':'Plain'}</span>
          <span class="note-item-folder">${esc(n.folder)}</span>
          <span class="author-badge">${esc(authorName(n.owner_id))}</span>
        </div>
        <div class="note-item-excerpt">${esc(excerpt)}</div>
      </div>`;
    }).join('');

  // mobile-web card view (<=768px, see basebi.css @media block) — mirrors teamItems above
  const cardsWrap=document.getElementById('teamCardsWrap');
  if(cardsWrap){
    cardsWrap.innerHTML=list.length===0
      ?'<div class="note-empty">No team-shared notes yet</div>'
      :list.map(n=>{
        const excerpt=(n.body||n.code||'').slice(0,55).replace(/\n/g,' ');
        return`<div class="mob-team-card ${n.id===state.activeTeamNoteId?'active':''}" onclick="selectTeamNote('${n.id}')">
          <div class="mob-team-card-title">${hl(n.title,'')}</div>
          <div class="mob-team-card-meta">
            <span class="note-type-badge ${n.type==='code'?'type-code':'type-plain'}">${n.type==='code'?'Code':'Plain'}</span>
            <span class="note-item-folder">${esc(n.folder)}</span>
            <span class="author-badge">${esc(authorName(n.owner_id))}</span>
          </div>
          <div class="mob-team-card-excerpt">${esc(excerpt)}</div>
        </div>`;
      }).join('');
  }
}
export function selectTeamNote(id){state.activeTeamNoteId=id;renderTeamList();renderTeamDetail(state.notes.find(n=>n.id===id));}
export function closeTeamDetail(){
  state.activeTeamNoteId=null;
  renderTeamList();
  renderTeamDetail(null);
}
export function renderTeamDetail(note){
  const el=document.getElementById('teamDetail');
  el.classList.toggle('mob-overlay-open', !!note);
  if(!note){el.innerHTML=`<div class="empty-state"><div class="icon">🌐</div><p>Select a shared note to view it</p></div>`;return;}
  const tags=(note.tags||[]).map(t=>`<span class="detail-tag">#${esc(t)}</span>`).join('');
  let body='';
  if(note.type==='code'||note.type==='sql'){
    body=`<div class="code-block">
      <div class="code-header"><span class="code-lang">Code</span>
        <button class="code-copy" data-noteid="${note.id}" onclick="copyNoteCode(this)">Copy</button>
      </div>
      <pre class="code-body">${sqlHL(note.code||'')}</pre></div>`;
    if(note.body)body+=`<div class="note-desc">${esc(note.body)}</div>`;
  }else{body=`<div class="note-body">${renderBodyWithLinks(note.body||'','')}</div>`;}
  const isOwner=note.owner_id===state.currentUserId;
  const actions=isOwner?`<div class="detail-actions">
      <button class="btn btn-ghost" style="font-size:11px" onclick="openNoteModal('${note.id}')">✎ Edit</button>
      <button class="btn btn-danger" style="font-size:11px" onclick="confirmDeleteNote('${note.id}','teamDetail')">✕ Delete</button>
    </div>`:`<div class="detail-actions"></div>`;
  el.innerHTML=`
    <div class="note-detail-header">
      <button class="note-detail-back-btn" onclick="closeTeamDetail()">← Back</button>
      <div class="note-detail-title">${esc(note.title)}</div>
      <div class="note-detail-meta">
        <span class="detail-folder-badge">${esc(note.folder)}</span>${tags}
        <span class="author-badge">by ${esc(authorName(note.owner_id))}</span>
      </div>
    </div>
    ${actions}
    <div class="note-detail-content">${body}</div>`;
}

// ══════════════════════════════════════════════════
// SEARCH SCREEN
// ══════════════════════════════════════════════════
export function openSearchScreen(){
  state.searchScreenOpen=true;
  state.ssCursor=-1; state.ssResults=[];
  document.getElementById('searchScreenInput').value='';
  document.getElementById('searchScreenResults').innerHTML='';
  document.getElementById('searchScreen').classList.add('open');
  setTimeout(()=>document.getElementById('searchScreenInput').focus(),50);
}
export function closeSearchScreen(){
  state.searchScreenOpen=false;
  document.getElementById('searchScreen').classList.remove('open');
  closeNotePopup();
}

export function handleSearchScreen(){
  const q=document.getElementById('searchScreenInput').value.trim();
  state.ssCursor=-1;
  if(!q){document.getElementById('searchScreenResults').innerHTML='';state.ssResults=[];return;}
  const ids=searchIds(q);
  state.ssResults=visibleNotes().filter(n=>ids.includes(n.id)).slice(0,12);
  renderSearchResults(q);
}

export function renderSearchResults(q){
  const el=document.getElementById('searchScreenResults');
  if(!state.ssResults.length){el.innerHTML=`<div class="search-screen-empty">No notes found for "${esc(q)}"</div>`;return;}
  el.innerHTML=state.ssResults.map((n,i)=>{
    const excerpt=(n.body||n.code||'').slice(0,100).replace(/\n/g,' ');
    const ownerBadge=n.owner_id!==state.currentUserId?`<span class="author-badge">${esc(authorName(n.owner_id))}</span>`:'';
    return`<div class="search-result-card ${i===state.ssCursor?'focused':''}" onclick="openNotePopup('${n.id}')" data-idx="${i}">
      <div class="search-result-title">
        <span class="search-result-type ${n.type==='code'?'srt-code':'srt-plain'}">${n.type==='code'?'Code':'Plain'}</span>
        ${hl(n.title,q)}${ownerBadge}
      </div>
      <div class="search-result-excerpt">${hl(excerpt,q)}</div>
    </div>`;
  }).join('');
}

export function searchScreenKey(e){
  if(e.key==='ArrowDown'){e.preventDefault();moveCursor(1);}
  else if(e.key==='ArrowUp'){e.preventDefault();moveCursor(-1);}
  else if(e.key==='Enter'){e.preventDefault();if(state.ssCursor>=0&&state.ssResults[state.ssCursor])openNotePopup(state.ssResults[state.ssCursor].id);}
}
export function moveCursor(dir){
  if(!state.ssResults.length)return;
  state.ssCursor=Math.max(-1,Math.min(state.ssResults.length-1,state.ssCursor+dir));
  const q=document.getElementById('searchScreenInput').value.trim();
  renderSearchResults(q);
  if(state.ssCursor>=0){
    const cards=document.querySelectorAll('.search-result-card');
    if(cards[state.ssCursor])cards[state.ssCursor].scrollIntoView({block:'nearest'});
  }
}

// ══════════════════════════════════════════════════
// NOTE POPUP
// ══════════════════════════════════════════════════
export function openNotePopup(id){
  const note=state.notes.find(n=>n.id===id);
  if(!note)return;
  state.popupMetaVisible=false;
  const q=document.getElementById('searchScreenInput').value;
  renderPopupContent(note,q);
  document.getElementById('notePopupOverlay').classList.add('open');
}
export function closeNotePopup(){
  document.getElementById('notePopupOverlay').classList.remove('open');
}
export function handlePopupOverlayClick(e){
  if(e.target===document.getElementById('notePopupOverlay'))closeNotePopup();
}
export function togglePopupMeta(){
  state.popupMetaVisible=!state.popupMetaVisible;
  document.getElementById('popupMeta').classList.toggle('hidden',!state.popupMetaVisible);
  document.getElementById('popupLinked').classList.toggle('hidden',!state.popupMetaVisible);
  const tog=document.getElementById('infoToggle');
  tog.classList.toggle('on',state.popupMetaVisible);
  tog.querySelector('.toggle-label').textContent=state.popupMetaVisible?'Hide info':'Show info';
}

export function renderPopupContent(note,q){
  const isCode=note.type==='code'||note.type==='sql';
  const tags=(note.tags||[]).map(t=>`<span class="pm-tag">#${esc(t)}</span>`).join('');
  const links=(note.links||[]).filter(Boolean);
  let bodyHtml='';
  if(isCode){
    bodyHtml=`<div class="popup-code-block">
      <div class="popup-code-header">
        <span class="popup-code-lang">Code</span>
        <button class="popup-code-copy" data-noteid="${note.id}" onclick="copyNoteCode(this)">Copy</button>
      </div>
      <pre class="popup-code-body">${sqlHL(note.code||'')}</pre>
    </div>`;
    if(note.body)bodyHtml+=`<div class="popup-desc-text">${hl(note.body,q)}</div>`;
  }else{
    bodyHtml=`<div class="popup-plain-body">${hl(note.body||'',q)}</div>`;
  }
  const linkedHtml=links.length
    ?links.map(l=>`<span class="popup-linked-chip" onclick="closeNotePopup();jumpToPopupLink('${esc(l)}')">↗ ${esc(l)}</span>`).join('')
    :'<span style="font-size:10px;color:var(--text-dim)">None</span>';

  const ownerBadge=note.owner_id!==state.currentUserId?`<span class="author-badge">${esc(authorName(note.owner_id))}</span>`:'';
  document.getElementById('popupContent').innerHTML=`
    <div class="popup-title-row">
      <div class="popup-title">${hl(note.title,q)}${ownerBadge}</div>
      <div class="popup-right-col">
        <span class="popup-type-badge ${isCode?'ptb-code':'ptb-plain'}">${isCode?'Code':'Plain'}</span>
        <div class="info-toggle" id="infoToggle" onclick="togglePopupMeta()">
          <div class="toggle-dot"></div>
          <span class="toggle-label">Show info</span>
        </div>
      </div>
    </div>
    <div class="popup-meta hidden" id="popupMeta">
      <span class="pm-folder">${esc(note.folder)}</span>
      <span class="privacy-badge ${note.is_shared?'is-shared':'is-private'}">${note.is_shared?'🌐 Shared':'🔒 Private'}</span>${tags}
    </div>
    <div class="popup-divider"></div>
    ${bodyHtml}
    <div class="popup-linked hidden" id="popupLinked">
      <div class="popup-linked-label">Linked Notes</div>
      ${linkedHtml}
    </div>`;
}

export function jumpToPopupLink(title){
  const n=visibleNotes().find(n=>n.title.toLowerCase()===title.toLowerCase());
  if(n)openNotePopup(n.id);
}

// ══════════════════════════════════════════════════
// TAG CRUD
// ══════════════════════════════════════════════════
export function openTagModal(tag){state.renamingTag=tag;document.getElementById('f-tag-rename').value=tag;document.getElementById('tagModalOverlay').classList.add('open');setTimeout(()=>document.getElementById('f-tag-rename').focus(),50);}
export function closeTagModal(){document.getElementById('tagModalOverlay').classList.remove('open');state.renamingTag=null;}
export function saveTagRename(){
  const newName=document.getElementById('f-tag-rename').value.trim();if(!newName||!state.renamingTag)return;
  const changed=myNotes().filter(n=>(n.tags||[]).includes(state.renamingTag));
  changed.forEach(n=>{n.tags=(n.tags||[]).map(t=>t===state.renamingTag?newName:t);});
  if(state.activeTag===state.renamingTag)state.activeTag=newName;
  if(changed.length)saveNotes(changed).then(()=>renderAll());closeTagModal();renderAll();if(state.activeNoteId)renderDetail(state.notes.find(n=>n.id===state.activeNoteId));
}
export function deleteTag(tag){
  if(!confirm(`Remove tag "#${tag}" from your notes?`))return;
  const changed=myNotes().filter(n=>(n.tags||[]).includes(tag));
  changed.forEach(n=>{n.tags=(n.tags||[]).filter(t=>t!==tag);});
  if(state.activeTag===tag)state.activeTag=null;
  if(changed.length)saveNotes(changed).then(()=>buildIndex());renderAll();if(state.activeNoteId)renderDetail(state.notes.find(n=>n.id===state.activeNoteId));
}

// ══════════════════════════════════════════════════
// NOTE MODAL — TAG SELECTOR
// ══════════════════════════════════════════════════
export function openTagDropdown(){filterTagDropdown();document.getElementById('tagDropdown').classList.add('open');}
export function filterTagDropdown(){
  const q=(document.getElementById('f-tag-input').value||'').toLowerCase().trim();
  const existing=Object.keys(allTags()).filter(t=>!state.selectedTags.includes(t));
  const filtered=q?existing.filter(t=>t.toLowerCase().includes(q)):existing;
  const dd=document.getElementById('tagDropdown');
  let html=filtered.map(t=>`<div class="dropdown-item" onclick="addTag('${esc(t)}')">#${esc(t)}</div>`).join('');
  if(q&&!existing.map(t=>t.toLowerCase()).includes(q))html+=`<div class="dropdown-item new-item" onclick="addTag('${esc(q)}')">+ Create "#${esc(q)}"</div>`;
  if(!html)html='<div class="dropdown-empty">No tags yet</div>';
  dd.innerHTML=html;dd.classList.add('open');
}
export function addTag(t){if(!state.selectedTags.includes(t))state.selectedTags.push(t);document.getElementById('f-tag-input').value='';document.getElementById('tagDropdown').classList.remove('open');renderTagChips();}
export function removeTag(t){state.selectedTags=state.selectedTags.filter(x=>x!==t);renderTagChips();}
export function renderTagChips(){document.getElementById('tagChips').innerHTML=state.selectedTags.map(t=>`<span class="chip-sel">#${esc(t)}<button onclick="removeTag('${esc(t)}')">×</button></span>`).join('');}
export function tagInputKey(e){if(e.key==='Enter'){e.preventDefault();const q=document.getElementById('f-tag-input').value.trim();if(q)addTag(q);}if(e.key==='Escape')document.getElementById('tagDropdown').classList.remove('open');}

// ══════════════════════════════════════════════════
// NOTE MODAL — LINK SELECTOR
// ══════════════════════════════════════════════════
export function openLinkDropdown(){filterLinkDropdown();document.getElementById('linkDropdown').classList.add('open');}
export function filterLinkDropdown(){
  const q=(document.getElementById('f-link-input').value||'').toLowerCase().trim();
  const available=visibleNotes().filter(n=>n.id!==state.editingNoteId&&!state.selectedLinks.includes(n.title));
  const filtered=q?available.filter(n=>n.title.toLowerCase().includes(q)):available;
  const dd=document.getElementById('linkDropdown');
  dd.innerHTML=filtered.length
    ?filtered.map(n=>`<div class="dropdown-item" onclick="addLink('${esc(n.title)}')">${esc(n.title)}<span style="float:right;font-size:9px;color:var(--text-dim)">${esc(n.folder)}</span></div>`).join('')
    :'<div class="dropdown-empty">No notes found</div>';
  dd.classList.add('open');
}
export function addLink(title){if(!state.selectedLinks.includes(title))state.selectedLinks.push(title);document.getElementById('f-link-input').value='';document.getElementById('linkDropdown').classList.remove('open');renderLinkChips();}
export function removeLink(t){state.selectedLinks=state.selectedLinks.filter(x=>x!==t);renderLinkChips();}
export function renderLinkChips(){document.getElementById('linkChips').innerHTML=state.selectedLinks.map(t=>`<span class="chip-sel">↗ ${esc(t)}<button onclick="removeLink('${esc(t)}')">×</button></span>`).join('');}
export function linkInputKey(e){if(e.key==='Escape')document.getElementById('linkDropdown').classList.remove('open');}

// ══════════════════════════════════════════════════
// NOTE MODAL — OPEN / CLOSE / SAVE
// ══════════════════════════════════════════════════
export function populateFolderSelect(){
  document.getElementById('f-folder').innerHTML=state.folders.map(f=>`<option value="${esc(f)}">${esc(f)}</option>`).join('');
}
export function showTitleError(msg){
  const el=document.getElementById('f-title-error');
  el.textContent=msg;el.style.display='';
}
export function hideTitleError(){
  const el=document.getElementById('f-title-error');
  el.textContent='';el.style.display='none';
}
function isUniqueViolation(err){return !!err&&err.code==='23505';}
export function openNoteModal(id){
  state.editingNoteId=id||null;state.selectedTags=[];state.selectedLinks=[];
  state.noteEditOriginTab=state.currentTab;
  populateFolderSelect();
  document.getElementById('noteModalTitle').textContent=id?'Edit Note':'New Note';
  document.getElementById('noteSaveBtn').textContent=id?'Save Changes':'Save Note';
  ['f-title','f-body','f-code','f-desc','f-tag-input','f-link-input'].forEach(x=>document.getElementById(x).value='');
  state.currentNoteType='plain';toggleCodeField();
  renderTagChips();renderLinkChips();
  document.getElementById('tagDropdown').classList.remove('open');
  document.getElementById('linkDropdown').classList.remove('open');
  state.noteIsShared=false;
  hideTitleError();
  if(id){
    const note=state.notes.find(n=>n.id===id);if(!note)return;
    document.getElementById('f-title').value=note.title;
    document.getElementById('f-folder').value=note.folder;
    state.currentNoteType=(note.type==='sql'?'code':note.type);
    state.selectedTags=[...(note.tags||[])];state.selectedLinks=[...(note.links||[])];
    state.noteIsShared=!!note.is_shared;
    toggleCodeField();
    if(note.type==='code'||note.type==='sql'){document.getElementById('f-code').value=note.code||'';document.getElementById('f-desc').value=note.body||'';}
    else if(note.daily_date){document.getElementById('f-body').value=(note.body||'').split('\n').map(stripLineId).join('\n');}
    else{document.getElementById('f-body').value=note.body||'';}
    renderTagChips();renderLinkChips();
  }
  renderShareToggle();
  document.getElementById('noteModalOverlay').classList.add('open');
  toggleCodeField(); // apply type colors after modal is visible
  setHintScreen('notes');
  setTimeout(()=>document.getElementById('f-title').focus(),50);
}
export function closeNoteModal(){document.getElementById('noteModalOverlay').classList.remove('open');state.editingNoteId=null;state.selectedTags=[];state.selectedLinks=[];closeInlineLinkDd();}
export function setNoteType(t){
  state.currentNoteType=t;
  toggleCodeField();
}
export function toggleShareState(){
  state.noteIsShared=!state.noteIsShared;
  renderShareToggle();
}
export function renderShareToggle(){
  const btn=document.getElementById('shareToggleBtn');
  if(state.noteIsShared){
    btn.textContent='🌐 Shared with Team';
    btn.classList.add('is-shared');
  }else{
    btn.textContent='🔒 Private (only you)';
    btn.classList.remove('is-shared');
  }
}

export function toggleCodeField(){
  const t=state.currentNoteType;
  document.getElementById('bodyRow').style.display=t==='code'?'none':'';
  document.getElementById('codeRow').style.display=t==='code'?'':'none';

  // visual: color the modal, the toggle buttons, and the save button based on type
  const modal=document.querySelector('#noteModalOverlay .modal');
  const btnPlain=document.getElementById('typeBtnPlain');
  const btnCode=document.getElementById('typeBtnCode');
  const saveBtn=document.getElementById('noteSaveBtn');
  modal.classList.remove('plain-mode','code-mode');
  modal.classList.add(t==='code'?'code-mode':'plain-mode');
  btnPlain.classList.toggle('active-plain', t==='plain');
  btnCode.classList.toggle('active-code', t==='code');
  saveBtn.classList.toggle('code-save', t==='code');

  // auto-fill: when switching to Code on a NEW note (not editing), default folder + tags
  if(t==='code' && !state.editingNoteId){
    applyCodeDefaultsToForm();
  }
}

export function applyCodeDefaultsToForm(){
  // only auto-fill if folder/tags are still at their blank starting state
  const folderSel=document.getElementById('f-folder');
  if(state.folders.includes('Techie')) folderSel.value='Techie';
  if(state.selectedTags.length===0){
    state.selectedTags=['SASEG'];
    renderTagChips();
  }
}
export async function saveNote(){
  const title=document.getElementById('f-title').value.trim();if(!title){document.getElementById('f-title').focus();return;}
  const type=state.currentNoteType;const now=today();
  const folderName=document.getElementById('f-folder').value;
  const folderId=state.folderIds[folderName]||null;
  hideTitleError();
  if(state.editingNoteId){
    const note=state.notes.find(n=>n.id===state.editingNoteId);if(!note)return;
    const savedId=state.editingNoteId;
    const prev={title:note.title,folder:note.folder,folder_id:note.folder_id,type:note.type,tags:note.tags,links:note.links,
      body:note.body,code:note.code,modified:note.modified,is_shared:note.is_shared};
    note.title=title;note.folder=folderName;note.folder_id=folderId;
    note.type=type;note.tags=[...state.selectedTags];note.links=[...state.selectedLinks];
    const newBodyRaw=type==='code'?document.getElementById('f-desc').value.trim():document.getElementById('f-body').value.trim();
    // Daily notes: markers were stripped for display in the edit textarea (openNoteModal),
    // so re-attach them here by content match against the pre-edit body — see tasks.js's
    // reattachLineIds() for the matching rule (content first, index as tiebreaker).
    note.body=(note.daily_date&&type!=='code')?reattachLineIds(note.body,newBodyRaw):newBodyRaw;
    note.code=type==='code'?document.getElementById('f-code').value.trim():null;
    note.modified=now;note.is_shared=state.noteIsShared;
    try{
      await saveOneNote(note);
    }catch(err){
      Object.assign(note,prev);
      buildIndex();renderAll();selectNote(savedId);
      if(isUniqueViolation(err)) showTitleError('You already have a note with this title.');
      else alert('Could not save note: '+(err.message||err));
      return;
    }
    buildIndex();closeNoteModal();
    if(state.noteEditOriginTab==='team'){renderTeamList();renderTeamDetail(note);}
    else{renderAll();selectNote(savedId);}
  }else{
    const note={title,folder:folderName,folder_id:folderId,type,
      tags:[...state.selectedTags],links:[...state.selectedLinks],
      body:type==='code'?document.getElementById('f-desc').value.trim():document.getElementById('f-body').value.trim(),
      code:type==='code'?document.getElementById('f-code').value.trim():null,
      is_shared:state.noteIsShared,owner_id:state.currentUserId,
      created:now,modified:now};
    state.notes.unshift(note);
    try{
      await saveOneNote(note);
    }catch(err){
      state.notes=state.notes.filter(n=>n.id!==note.id);
      buildIndex();renderAll();
      if(isUniqueViolation(err)) showTitleError('You already have a note with this title.');
      else alert('Could not save note: '+(err.message||err));
      return;
    }
    buildIndex();closeNoteModal();renderAll();selectNote(note.id);
  }
}

// ══════════════════════════════════════════════════
// DELETE NOTE
// ══════════════════════════════════════════════════
export function confirmDeleteNote(id,targetId){
  targetId=targetId||'noteDetail';
  const note=state.notes.find(n=>n.id===id);if(!note)return;
  const el=document.getElementById(targetId);
  const existing=el.querySelector('.confirm-box');if(existing){existing.remove();return;}
  const box=document.createElement('div');box.className='confirm-box';
  box.innerHTML=`<p>Delete "<strong>${esc(note.title)}</strong>"? This cannot be undone.</p>
    <div class="confirm-actions">
      <button class="btn btn-ghost" style="font-size:11px" onclick="this.closest('.confirm-box').remove()">Cancel</button>
      <button class="btn btn-danger" style="font-size:11px" onclick="deleteNote('${id}','${targetId}')">Yes, delete</button>
    </div>`;
  el.querySelector('.detail-actions').insertAdjacentElement('afterend',box);
}
export async function deleteNote(id,targetId){
  const{data,error}=await sb.from('notes').update({deleted:true,deleted_at:new Date().toISOString()}).eq('id',id).select('id');
  if(error||!data||!data.length){
    alert("You don't have permission to delete this note.");
    return;
  }
  state.notes=state.notes.filter(n=>n.id!==id);
  if(state.activeNoteId===id)state.activeNoteId=null;
  if(state.activeTeamNoteId===id)state.activeTeamNoteId=null;
  buildIndex();
  if(targetId==='teamDetail'){renderTeamList();renderTeamDetail(state.notes.find(n=>n.id===state.activeTeamNoteId)||null);}
  else{renderAll();renderDetail(state.notes.find(n=>n.id===state.activeNoteId)||null);}
}

// ══════════════════════════════════════════════════
// INLINE [[ LINK SYNTAX
// ══════════════════════════════════════════════════
let inlineLinkQuery='',inlineLinkCursor=-1,inlineLinkResults=[],inlineLinkStart=-1;

export function bodyInput(e){
  const ta=document.getElementById('f-body');
  const val=ta.value, pos=ta.selectionStart;
  const before=val.slice(0,pos);
  const ddOpen=before.lastIndexOf('[[');
  if(ddOpen===-1||before.slice(ddOpen).includes(']]')){closeInlineLinkDd();return;}
  const query=before.slice(ddOpen+2);
  inlineLinkQuery=query; inlineLinkStart=ddOpen; inlineLinkCursor=-1;
  const q=query.toLowerCase();
  inlineLinkResults=visibleNotes().filter(n=>n.id!==state.editingNoteId&&(!q||n.title.toLowerCase().includes(q))).slice(0,8);
  renderInlineLinkDd(ta);
}

export function renderInlineLinkDd(ta){
  const dd=document.getElementById('inlineLinkDd');
  dd.innerHTML=inlineLinkResults.length
    ?inlineLinkResults.map((n,i)=>`<div class="inline-link-dd-item ${i===inlineLinkCursor?'focused':''}" onclick="insertInlineLink('${esc(n.title)}')">${esc(n.title)}<span class="dd-folder">${esc(n.folder)}</span></div>`).join('')
    :'<div class="inline-link-dd-empty">No notes found</div>';
  const rect=ta.getBoundingClientRect();
  const wrapRect=document.getElementById('bodyRow').getBoundingClientRect();
  dd.style.top=(rect.bottom-wrapRect.top+4)+'px';
  dd.style.left='0px';
  dd.classList.add('open');
}

export function bodyKeydown(e){
  const dd=document.getElementById('inlineLinkDd');
  if(!dd.classList.contains('open'))return;
  if(e.key==='ArrowDown'){e.preventDefault();inlineLinkCursor=Math.min(inlineLinkResults.length-1,inlineLinkCursor+1);renderInlineLinkDd(document.getElementById('f-body'));}
  else if(e.key==='ArrowUp'){e.preventDefault();inlineLinkCursor=Math.max(-1,inlineLinkCursor-1);renderInlineLinkDd(document.getElementById('f-body'));}
  else if(e.key==='Enter'&&inlineLinkCursor>=0){e.preventDefault();insertInlineLink(inlineLinkResults[inlineLinkCursor].title);}
  else if(e.key==='Escape'){e.stopPropagation();closeInlineLinkDd();}
}

export function wrapSelection(marker){
  const ta=document.getElementById('f-body');
  const val=ta.value;
  let start=ta.selectionStart, end=ta.selectionEnd;
  const mLen=marker.length;
  const before=val.slice(0,start), selected=val.slice(start,end), after=val.slice(end);

  const alreadyWrappedOutside = before.slice(-mLen)===marker && after.slice(0,mLen)===marker;
  const alreadyWrappedInside = selected.slice(0,mLen)===marker && selected.slice(-mLen)===marker && selected.length>=mLen*2;

  let newVal, newStart, newEnd;
  if(alreadyWrappedOutside){
    // unwrap: strip markers immediately outside the selection
    newVal = before.slice(0,-mLen) + selected + after.slice(mLen);
    newStart = start-mLen; newEnd = end-mLen;
  } else if(alreadyWrappedInside){
    // unwrap: strip markers from inside the selection
    const inner = selected.slice(mLen,-mLen);
    newVal = before + inner + after;
    newStart = start; newEnd = start+inner.length;
  } else {
    // wrap
    newVal = before + marker + selected + marker + after;
    if(selected.length){ newStart=start+mLen; newEnd=end+mLen; }
    else { newStart=newEnd=start+mLen; }
  }
  ta.value=newVal;
  ta.selectionStart=newStart; ta.selectionEnd=newEnd;
  ta.focus();
}
export function insertInlineLink(title){
  const ta=document.getElementById('f-body');
  const val=ta.value, pos=ta.selectionStart;
  const before=val.slice(0,inlineLinkStart), after=val.slice(pos);
  const inserted='[['+title+']]';
  ta.value=before+inserted+after;
  const newPos=before.length+inserted.length;
  ta.selectionStart=ta.selectionEnd=newPos;
  ta.focus(); closeInlineLinkDd();
  if(!state.selectedLinks.includes(title)){state.selectedLinks.push(title);renderLinkChips();}
}

export function closeInlineLinkDd(){
  const dd=document.getElementById('inlineLinkDd');
  if(dd)dd.classList.remove('open');
  inlineLinkResults=[]; inlineLinkCursor=-1;
}

export function renderBodyWithLinks(text,q){
  let out = hl(text,q);
  out = out.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  out = out.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g,'<em>$1</em>');
  out = out.replace(/==(.+?)==/g,'<span class="md-highlight">$1</span>');
  return out.replace(/\[\[([^\]]+)\]\]/g,(match,title)=>{
    const safeTitle=esc(title);
    return `<span class="inline-link" onclick="jumpToLink(this.dataset.title)" data-title="${safeTitle}">&#8599; ${safeTitle}</span>`;
  });
}

// Per-line render for Daily Note bodies — strips each line's invisible ^ln-xxxxxxxx anchor
// marker before display and renders the log-to-task icon slot (chevron/🔗) immediately
// before the line's [HH:MM] prefix. See tasks.js for the marker mechanism.
export function renderDailyBodyLines(note,q){
  const tasksOn=isFeatureVisible('tasks');
  const lines=(note.body||'').split('\n');
  return lines.map((rawLine,idx)=>{
    if(!rawLine.trim())return '';
    const m=rawLine.match(LINE_ID_RE);
    const lineId=m?m[1]:null;
    const displayLine=stripLineId(rawLine);
    const lineHtml=renderBodyWithLinks(displayLine,q);
    if(!tasksOn) return `<div class="daily-log-line" data-line-idx="${idx}">${lineHtml}</div>`;
    const task=lineId?findTaskByLineId(lineId):null;
    const icon=dailyLineIconHtml(note.id,idx,!!task);
    const lineIdAttr=task?` data-line-id="${lineId}"`:'';
    return `<div class="daily-log-line" data-line-idx="${idx}"${lineIdAttr}>${icon}${lineHtml}</div>`;
  }).join('');
}

export function initNotes(){
  window.selectNote=selectNote;
  window.selectTag=selectTag;
  window.handleSearch=handleSearch;
  window.jumpToLink=jumpToLink;
  window.selectTeamNote=selectTeamNote;
  window.closeTeamDetail=closeTeamDetail;
  window.closeNoteDetail=closeNoteDetail;
  window.openSearchScreen=openSearchScreen;
  window.closeSearchScreen=closeSearchScreen;
  window.handleSearchScreen=handleSearchScreen;
  window.searchScreenKey=searchScreenKey;
  window.openNotePopup=openNotePopup;
  window.closeNotePopup=closeNotePopup;
  window.handlePopupOverlayClick=handlePopupOverlayClick;
  window.togglePopupMeta=togglePopupMeta;
  window.jumpToPopupLink=jumpToPopupLink;
  window.copyNoteCode=copyNoteCode;
  window.openTagModal=openTagModal;
  window.closeTagModal=closeTagModal;
  window.saveTagRename=saveTagRename;
  window.deleteTag=deleteTag;
  window.openTagDropdown=openTagDropdown;
  window.filterTagDropdown=filterTagDropdown;
  window.addTag=addTag;
  window.removeTag=removeTag;
  window.tagInputKey=tagInputKey;
  window.openLinkDropdown=openLinkDropdown;
  window.filterLinkDropdown=filterLinkDropdown;
  window.addLink=addLink;
  window.removeLink=removeLink;
  window.linkInputKey=linkInputKey;
  window.openNoteModal=openNoteModal;
  window.closeNoteModal=closeNoteModal;
  window.setNoteType=setNoteType;
  window.toggleShareState=toggleShareState;
  window.saveNote=saveNote;
  window.confirmDeleteNote=confirmDeleteNote;
  window.deleteNote=deleteNote;
  window.togglePin=togglePin;
  window.bodyInput=bodyInput;
  window.bodyKeydown=bodyKeydown;
  window.wrapSelection=wrapSelection;
  window.insertInlineLink=insertInlineLink;

  document.getElementById('searchInput').addEventListener('input',handleSearch);
  document.querySelector('.fab[title^="Search mode"]').onclick=openSearchScreen;
  document.getElementById('noteFolderFilter').onchange=e=>selectFolder(e.target.value);
  document.getElementById('searchScreenInput').addEventListener('input',handleSearchScreen);
  document.getElementById('searchScreenInput').addEventListener('keydown',searchScreenKey);
  document.getElementById('notePopupOverlay').onclick=handlePopupOverlayClick;

  document.querySelector('#noteModalOverlay .modal-close').onclick=closeNoteModal;
  document.getElementById('shareToggleBtn').onclick=toggleShareState;
  document.getElementById('typeBtnPlain').onclick=()=>setNoteType('plain');
  document.getElementById('typeBtnCode').onclick=()=>setNoteType('code');
  document.querySelectorAll('#noteModalOverlay .fmt-btn').forEach(btn=>{
    const marker=btn.title==='Bold'?'**':btn.title==='Italic'?'*':'==';
    btn.onclick=()=>wrapSelection(marker);
  });
  document.getElementById('f-tag-input').addEventListener('input',filterTagDropdown);
  document.getElementById('f-tag-input').addEventListener('focus',openTagDropdown);
  document.getElementById('f-tag-input').addEventListener('keydown',tagInputKey);
  document.getElementById('f-body').addEventListener('input',bodyInput);
  document.getElementById('f-body').addEventListener('keydown',bodyKeydown);
  document.getElementById('f-link-input').addEventListener('input',filterLinkDropdown);
  document.getElementById('f-link-input').addEventListener('focus',openLinkDropdown);
  document.getElementById('f-link-input').addEventListener('keydown',linkInputKey);
  const noteActions=document.querySelectorAll('#noteModalOverlay .modal-actions .btn');
  noteActions[0].onclick=closeNoteModal;
  document.getElementById('noteSaveBtn').onclick=saveNote;

  document.querySelector('#tagModalOverlay .modal-close').onclick=closeTagModal;
  const tagActions=document.querySelectorAll('#tagModalOverlay .modal-actions .btn');
  tagActions[0].onclick=closeTagModal;
  tagActions[1].onclick=saveTagRename;
}
