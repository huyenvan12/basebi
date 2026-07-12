// ══════════════════════════════════════════════════
// MONITOR REPORT — recurring daily comm/campaign monitoring report. v2 adds create-from-
// template, owner-only inline edit, and copy-as-table on top of the v1 read layer. Add/delete
// of lines or criteria beyond the seeded template is out of scope (deferred to v3).
// Only invoked from main.js's initApp() behind the already-resolved monitor_log feature
// flag (isFeatureVisible('monitor_log')) — this module never re-checks the flag itself.
// ══════════════════════════════════════════════════
import { state } from './state.js';
import { esc, authorName } from './ui-helpers.js';
import { sb } from './supabase-client.js';
import { fallbackCopy } from './notes.js';

// ══════════════════════════════════════════════════
// DATA LAYER
// ══════════════════════════════════════════════════
export async function loadMonitorReports(){
  const{data,error}=await sb.from('monitor_reports').select('*')
    .order('report_date',{ascending:false}).order('created_at',{ascending:false});
  if(error||!data) return [];
  return data;
}
export async function loadMonitorReportCriteria(reportId){
  const{data,error}=await sb.from('monitor_report_criteria').select('*')
    .eq('report_id',reportId).order('sort_order',{ascending:true});
  if(error||!data) return [];
  return data;
}
export async function loadMonitorReportLines(criterionIds){
  if(!criterionIds.length) return [];
  const{data,error}=await sb.from('monitor_report_lines').select('*')
    .in('criterion_id',criterionIds).order('sort_order',{ascending:true});
  if(error||!data) return [];
  return data;
}

// ══════════════════════════════════════════════════
// CLONE FROM TEMPLATE
// ══════════════════════════════════════════════════
async function loadDefaultMonitorTemplate(){
  const{data,error}=await sb.from('monitor_report_templates').select('*').eq('is_default',true).single();
  if(error||!data) return null;
  return data;
}
async function loadMonitorTemplateCriteria(templateId){
  const{data,error}=await sb.from('monitor_report_template_criteria').select('*')
    .eq('template_id',templateId).order('sort_order',{ascending:true});
  if(error||!data) return [];
  return data;
}
async function loadMonitorTemplateLines(templateCriterionIds){
  if(!templateCriterionIds.length) return [];
  const{data,error}=await sb.from('monitor_report_template_lines').select('*')
    .in('template_criterion_id',templateCriterionIds).order('sort_order',{ascending:true});
  if(error||!data) return [];
  return data;
}
function todayLocalISO(){
  const d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
export async function createMonitorReportFromTemplate(){
  const template=await loadDefaultMonitorTemplate();
  if(!template) return;
  const tplCriteria=await loadMonitorTemplateCriteria(template.id);
  const tplLines=await loadMonitorTemplateLines(tplCriteria.filter(c=>c.row_type==='criterion').map(c=>c.id));

  const{data:report,error:repErr}=await sb.from('monitor_reports')
    .insert({report_date:todayLocalISO(),created_by:state.currentUserId}).select().single();
  if(repErr||!report){ console.error(repErr); return; }

  const criteriaPayload=tplCriteria.map(c=>({
    report_id:report.id, sort_order:c.sort_order, row_type:c.row_type, label:c.label
  }));
  const{data:newCriteria,error:critErr}=await sb.from('monitor_report_criteria').insert(criteriaPayload).select();
  if(critErr||!newCriteria){ console.error(critErr); return; }

  // Map template_criterion_id -> new criterion id via sort_order (NOT array index or insert-
  // response order — PostgREST's insert().select() does not guarantee returned-row order
  // matches input order). sort_order is unique within a template's criteria list.
  const newCriterionIdBySortOrder={};
  newCriteria.forEach(nc=>{ newCriterionIdBySortOrder[nc.sort_order]=nc.id; });
  const tplCriterionSortOrderById={};
  tplCriteria.forEach(c=>{ tplCriterionSortOrderById[c.id]=c.sort_order; });

  const linesPayload=tplLines.map(l=>({
    criterion_id:newCriterionIdBySortOrder[tplCriterionSortOrderById[l.template_criterion_id]],
    sort_order:l.sort_order, category:l.category, value:l.sample_value
  })).filter(l=>l.criterion_id);
  if(linesPayload.length){
    const{error:lineErr}=await sb.from('monitor_report_lines').insert(linesPayload);
    if(lineErr){ console.error(lineErr); return; }
  }

  state.monitorReports.unshift(report);
  state.activeMonitorReportId=report.id;
  showMonitorLogPage('detail');
  loadAndRenderMonitorReportDetail();
}

// ══════════════════════════════════════════════════
// DATE FORMATTING — local time, "DD-Mon, YYYY" (e.g. "05-Jul, 2026"). Deliberately not
// toLocaleDateString(), which produces "05 Jul 2026" (space-separated, wrong punctuation).
// ══════════════════════════════════════════════════
const MONITOR_MONTH_ABBR=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function fmtMonitorReportDate(iso){
  const d=new Date(iso+'T00:00:00');
  return `${String(d.getDate()).padStart(2,'0')}-${MONITOR_MONTH_ABBR[d.getMonth()]}, ${d.getFullYear()}`;
}

// ══════════════════════════════════════════════════
// LIST VIEW
// ══════════════════════════════════════════════════
export function renderMonitorLogList(){
  const tbody=document.getElementById('monitorLogListBody');
  if(!state.monitorReports.length){
    tbody.innerHTML='<tr><td colspan="3" class="note-empty">No monitor reports yet</td></tr>';
    return;
  }
  tbody.innerHTML=state.monitorReports.map(r=>`
    <tr>
      <td>${esc(fmtMonitorReportDate(r.report_date))}</td>
      <td>${esc(authorName(r.created_by))}</td>
      <td><button class="ci-view-detail-btn" onclick="openMonitorReportDetail('${r.id}')">View →</button></td>
    </tr>`).join('');
}

// ══════════════════════════════════════════════════
// DETAIL VIEW
// ══════════════════════════════════════════════════
export function getActiveMonitorReport(){
  return state.monitorReports.find(r=>r.id===state.activeMonitorReportId);
}
function isMonitorReportOwner(report){
  return !!report && report.created_by===state.currentUserId;
}
export async function loadAndRenderMonitorReportDetail(){
  const el=document.getElementById('monitorLogDetailScroll');
  el.innerHTML='<div class="empty-state"><p>Loading…</p></div>';
  state.monitorReportCriteria=await loadMonitorReportCriteria(state.activeMonitorReportId);
  state.monitorReportLines=await loadMonitorReportLines(
    state.monitorReportCriteria.filter(c=>c.row_type==='criterion').map(c=>c.id)
  );
  renderMonitorReportDetail();
}
export function renderMonitorReportDetail(){
  const el=document.getElementById('monitorLogDetailScroll');
  const report=getActiveMonitorReport();
  if(!report){el.innerHTML='<div class="empty-state"><p>Report not found</p></div>';return;}
  const owner=isMonitorReportOwner(report);

  const linesByCriterion={};
  state.monitorReportLines.forEach(l=>(linesByCriterion[l.criterion_id]=linesByCriterion[l.criterion_id]||[]).push(l));

  const sorted=[...state.monitorReportCriteria].sort((a,b)=>a.sort_order-b.sort_order);
  let rowsHtml='';
  sorted.forEach(c=>{
    if(c.row_type==='section_header'){
      rowsHtml+=`<tr><td colspan="2" class="monitor-section-header-row">${esc(c.label)}</td></tr>`;
      return;
    }
    const lines=(linesByCriterion[c.id]||[]).sort((a,b)=>a.sort_order-b.sort_order);
    if(!lines.length){
      rowsHtml+=`<tr>
        <td class="monitor-criterion-cell">${esc(c.label)}</td>
        <td class="monitor-value-cell"><span class="note-empty" style="font-size:11px">no lines</span></td>
      </tr>`;
    }else{
      lines.forEach((line,li)=>{
        rowsHtml+='<tr>';
        if(li===0){
          rowsHtml+=`<td class="monitor-criterion-cell" rowspan="${lines.length}">${esc(c.label)}</td>`;
        }
        const dis=owner?'':'disabled';
        const catHandlers=owner?`oninput="onMonitorFieldInput('${line.id}','category',this)" onblur="onMonitorFieldBlur('${line.id}','category',this)"`:'';
        const valHandlers=owner?`oninput="onMonitorFieldInput('${line.id}','value',this)" onblur="onMonitorFieldBlur('${line.id}','value',this)"`:'';
        rowsHtml+=`<td class="monitor-value-cell">
            <input class="monitor-cell-input monitor-cat-input" value="${esc(line.category||'')}" ${dis} ${catHandlers}>
            <input class="monitor-cell-input monitor-val-input" value="${esc(line.value||'')}" ${dis} ${valHandlers}>
          </td>`;
        rowsHtml+='</tr>';
      });
    }
  });

  el.innerHTML=`
    <div class="monitor-report-detail-content">
      <div class="monitor-report-header">
        <div class="monitor-report-date">${esc(fmtMonitorReportDate(report.report_date))}</div>
        ${owner?'':'<span class="monitor-readonly-badge">View only</span>'}
      </div>
      <table class="camp-table monitor-report-table">
        <thead><tr><th>Criteria</th><th>Value</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
}

// ══════════════════════════════════════════════════
// INLINE EDIT (owner-only)
// ══════════════════════════════════════════════════
export function onMonitorFieldInput(lineId,field,inputEl){
  const line=state.monitorReportLines.find(l=>l.id===lineId); if(!line) return;
  line[field]=inputEl.value;                       // mutate in-memory first, no re-render (preserves focus)
  clearTimeout(state.monitorSaveTimer);
  state.monitorSaveTimer=setTimeout(()=>{ saveMonitorReportLine(line); },800);
}
export function onMonitorFieldBlur(lineId,field,inputEl){
  const line=state.monitorReportLines.find(l=>l.id===lineId); if(!line) return;
  line[field]=inputEl.value;
  clearTimeout(state.monitorSaveTimer);
  saveMonitorReportLine(line);                      // flush immediately
}
async function saveMonitorReportLine(line){
  const{error}=await sb.from('monitor_report_lines')
    .update({category:line.category,value:line.value}).eq('id',line.id);
  if(error){ console.error(error); return; }
}

// ══════════════════════════════════════════════════
// COPY AS TABLE
// ══════════════════════════════════════════════════
export function copyMonitorReportAsTable(btn){
  const report=getActiveMonitorReport();
  if(!report) return;
  const built=buildMonitorReportCopyHtml(report);
  if(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write){
    const item=new ClipboardItem({
      'text/html':new Blob([built.html],{type:'text/html'}),
      'text/plain':new Blob([built.plain],{type:'text/plain'})
    });
    navigator.clipboard.write([item]).then(()=>doMonitorCopyFeedback(btn))
      .catch(()=>fallbackCopy(built.plain,()=>doMonitorCopyFeedback(btn)));
  }else{
    fallbackCopy(built.plain,()=>doMonitorCopyFeedback(btn));
  }
}
function doMonitorCopyFeedback(btn){
  btn.textContent='Copied'; btn.classList.add('copied');
  setTimeout(()=>{btn.textContent='Copy'; btn.classList.remove('copied');},1500);
}
const MONITOR_TD_STYLE='border:1px solid #000;padding:4px 8px';
function buildMonitorReportCopyHtml(report){
  const linesByCriterion={};
  state.monitorReportLines.forEach(l=>(linesByCriterion[l.criterion_id]=linesByCriterion[l.criterion_id]||[]).push(l));
  const sorted=[...state.monitorReportCriteria].sort((a,b)=>a.sort_order-b.sort_order);

  let bodyHtml='';
  let plainRows=[];
  sorted.forEach(c=>{
    if(c.row_type==='section_header'){
      bodyHtml+=`<tr><td colspan="3" style="${MONITOR_TD_STYLE}">${esc(c.label)}</td></tr>`;
      plainRows.push(c.label);
      return;
    }
    const lines=(linesByCriterion[c.id]||[]).sort((a,b)=>a.sort_order-b.sort_order);
    if(lines.length<=1){
      const line=lines[0];
      const category=line?(line.category||''):'';
      const value=line?(line.value||''):'';
      bodyHtml+=`<tr>
        <td style="${MONITOR_TD_STYLE}">${esc(c.label)}</td>
        <td style="${MONITOR_TD_STYLE}">${esc(category)}</td>
        <td style="${MONITOR_TD_STYLE}">${esc(value)}</td>
      </tr>`;
      plainRows.push([c.label,category,value].join('\t'));
    }else{
      lines.forEach((line,li)=>{
        bodyHtml+='<tr>';
        if(li===0){
          bodyHtml+=`<td style="${MONITOR_TD_STYLE}" rowspan="${lines.length}">${esc(c.label)}</td>`;
        }
        bodyHtml+=`<td style="${MONITOR_TD_STYLE}">${esc(line.category||'')}</td>
          <td style="${MONITOR_TD_STYLE}">${esc(line.value||'')}</td>`;
        bodyHtml+='</tr>';
        plainRows.push([li===0?c.label:'',line.category||'',line.value||''].join('\t'));
      });
    }
  });

  const dateLabel=fmtMonitorReportDate(report.report_date);
  const html=`<table style="border-collapse:collapse">
      <tr><td style="${MONITOR_TD_STYLE}">${esc(dateLabel)}</td></tr>
      <tr><td style="${MONITOR_TD_STYLE}">Criteria</td><td style="${MONITOR_TD_STYLE}">Categories</td><td style="${MONITOR_TD_STYLE}">Value</td></tr>
      ${bodyHtml}
    </table>`;
  const plain=[dateLabel,['Criteria','Categories','Value'].join('\t'),...plainRows].join('\n');
  return{html,plain};
}

// ══════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════
export function showMonitorLogPage(view){
  document.getElementById('monitorLogListView').classList.toggle('active',view==='list');
  document.getElementById('monitorLogDetailView').classList.toggle('active',view==='detail');
  if(view==='list') renderMonitorLogList();
}
export function openMonitorReportDetail(id){
  state.activeMonitorReportId=id;
  showMonitorLogPage('detail');
  loadAndRenderMonitorReportDetail();
}
export function backToMonitorLogList(){
  state.activeMonitorReportId=null;
  showMonitorLogPage('list');
}

// ══════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════
export function initMonitorReport(){
  window.openMonitorReportDetail=openMonitorReportDetail;
  window.backToMonitorLogList=backToMonitorLogList;
  window.createMonitorReportFromTemplate=createMonitorReportFromTemplate;
  window.onMonitorFieldInput=onMonitorFieldInput;
  window.onMonitorFieldBlur=onMonitorFieldBlur;
  window.copyMonitorReportAsTable=copyMonitorReportAsTable;
}
