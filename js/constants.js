// ══════════════════════════════════════════════════
// CONSTANTS — Supabase config, storage keys, seed data, graph physics tuning
// ══════════════════════════════════════════════════

// Legacy unused localStorage keys — kept for reference, never wired up. Do not delete, do not use.
export const LS_NOTES='basebi_notes', LS_FOLDERS='basebi_folders';
export const LS_CAMPS='basebi_campaigns';

export const LS_THEME='basebi_theme';

// ── Supabase config ──────────────────────────────
export const SUPABASE_URL  = 'https://adalbpcwdmzjtestfxuv.supabase.co';
export const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkYWxicGN3ZG16anRlc3RmeHV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5MDI3NTcsImV4cCI6MjA5ODQ3ODc1N30.s13SMg_J2X_I30AEYK2P6R0qqS2iFI9QCFxvKvpbaHo';

export const SEED_FOLDERS=['Business','Techie','Lesson'];
export const SEED_NOTES=[
  {id:1,title:"CRM – Overdue loan segmentation query",folder:"Techie",type:"code",tags:["CRM","SQL","loan","segmentation"],code:"SELECT customer_id,\n       loan_id,\n       DATEDIFF(day, due_date, GETDATE()) AS days_overdue,\n       outstanding_balance\nFROM   loan_accounts\nWHERE  status = 'OVERDUE'\n  AND  DATEDIFF(day, due_date, GETDATE()) > 30\nORDER  BY days_overdue DESC;",body:"Use this to pull customers with DPD > 30 for the monthly NPL report.",links:["MOB bucket classification"],created:"2026-06-01",modified:"2026-06-01"},
  {id:2,title:"MOB bucket classification",folder:"Techie",type:"code",tags:["SQL","MOB","bucket","CRM"],code:"SELECT customer_id,\n       CASE\n         WHEN mob BETWEEN 1  AND 3  THEN 'Early'\n         WHEN mob BETWEEN 4  AND 6  THEN 'Mid'\n         WHEN mob BETWEEN 7  AND 12 THEN 'Mature'\n         ELSE 'Aged'\n       END AS mob_bucket\nFROM   customer_mob;",body:"MOB = Month on Book. Used in Last MOB campaign targeting.",links:["CRM – Overdue loan segmentation query"],created:"2026-06-05",modified:"2026-06-05"},
  {id:3,title:"Sprint ticket escalation SOP",folder:"Business",type:"plain",tags:["SOP","sprint","escalation","process"],body:"1. Identify blocker tickets (status = Blocked > 2 days).\n2. Ping assignee on Teams with ticket link.\n3. If no response within 4h, escalate to team lead.\n4. Log escalation in TicketTracker sheet with timestamp.\n5. Follow up next standup.",links:[],created:"2026-06-10",modified:"2026-06-10"},
  {id:4,title:"DuPont decomposition – bank ROE",folder:"Lesson",type:"plain",tags:["finance","DuPont","ROE","bank"],body:"ROE = Net Profit Margin × Asset Turnover × Equity Multiplier\n\nFor Vietnamese banks:\n- NIM drives NP margin\n- Leverage (equity multiplier) is typically high (10–15x)\n- Asset quality affects the margin leg via credit loss provisions.",links:["CAMEL framework – VN banks"],created:"2026-06-15",modified:"2026-06-15"},
  {id:5,title:"CAMEL framework – VN banks",folder:"Lesson",type:"plain",tags:["CAMEL","bank","finance","analysis"],body:"C – Capital Adequacy: CAR (Basel II/III, SBV minimum 8%)\nA – Asset Quality: NPL ratio, LLR coverage\nM – Management: governance scores\nE – Earnings: ROA, ROE, NIM, CIR\nL – Liquidity: LDR, short-term funding gap",links:["DuPont decomposition – bank ROE"],created:"2026-06-18",modified:"2026-06-18"}
];

export const SEED_CAMPS = [
  {id:2001,campaign_cd:'CAMP12140',campaign_nm:'RTDM_P_Z_HPL_CLIP_COMM_V1',event_name:'PROC_HPL_CLIP_COMM',date:'2026-07-01',type:'BAU',trigger_type:'Batch',status:'Active',note:'New design for 2 channel campaign',extra:{},created:'2026-07-01',modified:'2026-07-01'},
  {id:2002,campaign_cd:'CAMP11628',campaign_nm:'RTDM_P_Z_S_C_SCORING_COMM_v2.4',event_name:'PROC_SCORING_OFFER_COMM',date:'2026-06-25',type:'BAU',trigger_type:'Batch',status:'Active',note:'Design sub-camp to detach OPO CG comm',extra:{},created:'2026-06-25',modified:'2026-06-25'},
  {id:2003,campaign_cd:'CAMP11183',campaign_nm:'RTDM_Z_CSAT_SURVEY_NEW_OB_V3',event_name:'PROC_SURVEY_SIGNED_CONTRACT',date:'2026-05-29',type:'Adhoc',trigger_type:'Batch',status:'Active',note:'Will end at the end of 2026',extra:{},created:'2026-05-29',modified:'2026-05-29'},
  {id:2004,campaign_cd:'CAMP10911',campaign_nm:'RTDM_P_Z_EPP_BY_BALANCE_AMT_V5',event_name:'PROC_EPP_BY_BALANCE_AMT',date:'2026-04-02',type:'BAU',trigger_type:'Batch',status:'Active',note:'1st batch of RTDM campaign',extra:{},created:'2026-04-02',modified:'2026-04-02'},
  {id:2005,campaign_cd:'CAMP2815',campaign_nm:'Master_GMA_Diagram_v27.4',event_name:'IF100_EV_GMA_BANNER_v3',date:'2025-10-30',type:'BAU',trigger_type:'Event',status:'Active',note:'',extra:{},created:'2025-10-30',modified:'2025-10-30'}
];

// ── Graph view tuning ─────────────────────────────
export const GRAPH_TAG_HUB_CAP=10; // skip tag-edge generation for tags shared by more than this many notes, to avoid hairballs

// Force constants — tuned numerically (repulsion/spring/centering integrated with damping)
// for: no NaN/blowup, hub nodes visibly pulled toward center, settle within ~2-3s at 60fps.
export const GRAPH_REPULSION=4200;       // node-node push apart, force = REPULSION/distance
export const GRAPH_MIN_DIST=24;          // clamp distance to avoid a divide-by-near-zero singularity
export const GRAPH_SPRING_LENGTH=110;    // ideal length for link/tag edges
export const GRAPH_SPRING_STRENGTH=0.14; // link/tag edge stiffness (Hooke's law)
export const GRAPH_FOLDER_LENGTH=150;    // ideal "distance" for same-folder note pairs
export const GRAPH_FOLDER_STRENGTH=0.02; // folder clustering pull — weaker than GRAPH_SPRING_STRENGTH, independently tunable
export const GRAPH_CENTER_STRENGTH=0.1;  // weak pull toward canvas centroid, keeps the whole graph on-screen
export const GRAPH_DAMPING=0.78;         // velocity retained per frame (friction)
export const GRAPH_MAX_VEL=36;           // per-frame velocity clamp, prevents jitter/overshoot from initial overlap
export const GRAPH_REST_KE=0.05;         // avg per-node kinetic energy below which the sim is considered settled
export const GRAPH_MAX_SIM_FRAMES=900;   // safety cap (~15s at 60fps) so a non-converging graph can't spin forever
export const GRAPH_MIN_ZOOM_SCALE=0.8;   // fit-to-bounds never zooms out past this scale (viewBox can't exceed default/scale), so labels stay legible on load even when nodes are spread far apart

// Label size — persisted like the theme, independent of pan/zoom (drives the
// --graph-label-scale CSS var consumed by the .graph-node-label tier rules).
export const LS_GRAPH_LABEL_SCALE='basebi_graph_label_scale';
export const GRAPH_LABEL_SCALE_MIN=0.7, GRAPH_LABEL_SCALE_MAX=1.6, GRAPH_LABEL_SCALE_STEP=0.1;

export const GRAPH_FOLDER_PALETTE_SIZE=10;
export const GRAPH_SHARED_GROUP_KEY='__shared__';
