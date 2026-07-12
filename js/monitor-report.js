// ══════════════════════════════════════════════════
// MONITOR REPORT — recurring daily comm/campaign monitoring report. Read-only v1: list +
// detail views only. Clone-from-template, inline edit, and copy-as-table are out of scope
// for this pass (see feature/monitor-log-v2 PR description) — left as follow-ups.
// Only invoked from main.js's initApp() behind the already-resolved monitor_log feature
// flag (isFeatureVisible('monitor_log')) — this module never re-checks the flag itself.
// ══════════════════════════════════════════════════
import { state } from './state.js';
import { esc, authorName } from './ui-helpers.js';
import { sb } from './supabase-client.js';

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
        rowsHtml+=`<td class="monitor-value-cell">
            <input class="monitor-cell-input monitor-cat-input" value="${esc(line.category||'')}" disabled>
            <input class="monitor-cell-input monitor-val-input" value="${esc(line.value||'')}" disabled>
          </td>`;
        rowsHtml+='</tr>';
      });
    }
  });

  el.innerHTML=`
    <div class="monitor-report-header">
      <div class="monitor-report-date">${esc(fmtMonitorReportDate(report.report_date))}</div>
      <span class="monitor-readonly-badge">View only</span>
    </div>
    <table class="camp-table monitor-report-table">
      <thead><tr><th>Categories</th><th>Value</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
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
}
