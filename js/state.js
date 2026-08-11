// ══════════════════════════════════════════════════
// STATE — single shared mutable namespace.
// Every module imports { state } and reads/writes state.xyz directly.
// Kept flat (not nested by domain) to mirror the original flat `let` globals 1:1.
// ══════════════════════════════════════════════════
import { SEED_FOLDERS } from './constants.js';

export const state = {
  // data layer
  notes: [],
  folders: [...SEED_FOLDERS],
  folderIds: {},
  campaigns: [],

  // notes/nav state
  activeFolder: 'all', activeTag: null, activeNoteId: null, searchQuery: '',
  editingNoteId: null, editingFolderName: null, renamingTag: null,
  currentNoteType: 'plain',
  selectedTags: [], selectedLinks: [],
  idx: {},
  searchScreenOpen: false,
  popupMetaVisible: false,
  ssResults: [], ssCursor: -1,
  currentUserId: null, currentUserEmail: null, profilesMap: {},
  currentUserIsAdmin: false,
  currentUserRole: null, currentUserIsQaSeat: false,
  featureVisibility: {},
  noteIsShared: false,
  activeTeamNoteId: null,
  graphIncludeShared: false,
  noteEditOriginTab: 'notes',

  // checklist state
  checklistTemplates: [], checklistInstances: [],
  currentTeamSubTab: 'notes',                 // 'notes' | 'checklists' | 'monitorlog'
  currentChecklistView: 'mine',               // 'templates' | 'mine' | 'detail'
  activeChecklistInstanceId: null,
  checklistPhaseOpen: {},                     // { [phaseName]: bool } — persists manual expand/collapse across re-renders
  checklistNoteSaveTimer: null,
  editingTemplateId: null,
  templateEditItems: [],                      // working array while template modal is open
  newChecklistSelectedTemplateId: null,
  templatePickerExpandedId: null,
  checklistShares: [],
  sharedWithMeInstances: [],
  currentUserOrgId: null,
  orgMembers: [],

  // admin hub state
  featureFlags: [],
  expandedFlagId: null,
  featureFlagTesters: {},                     // { [featureId]: [{id,display_name}] } — lazy-loaded per expanded flag
  checklistSharePanelOpen: {},                // { [instanceId]: bool } — mirrors checklistPhaseOpen pattern
  shareModalInstanceId: null,
  activeReviewShareId: null,
  reviewerCommentEditing: false,              // false=locked display (if a comment exists), true=textarea open
  reviewerCommentError: null,

  // campaigns state
  campSortCol: 'date', campSortDir: 'desc',
  activeCampId: null, editingCampId: null,
  campAddRowVisible: false,

  // test prep hub state
  testPrepExam: null, testPrepSkills: [], testPrepTimeLogs: [], testPrepChecklist: [],
  testPrepActiveSkillId: null,
  testPrepKnownWeeks: [],       // week_number "shells" that still render even once emptied of tasks —
                                 // only an explicit "Remove week" click removes an entry from this list
  testPrepSectionOpen: {},      // { [sectionKey]: bool } — mobile-web accordion expand/collapse,
                                 // persists across re-renders like checklistPhaseOpen



  // delivery tracker (gantt) state
  ganttTaskTypes: [], ganttTickets: [], ganttEntries: [],
  ganttActiveView: 'timeline',                // 'timeline' | 'calendar' | 'tasks'
  ganttTimelineStartDate: null,               // ISO date, defaulted to Monday-of-this-week at first render
  ganttTimelineWeeks: 6,
  ganttInactiveExpanded: false,
  ganttEditingTicketId: null,
  ganttTaskTypeEditItems: [],                 // working array while Manage Task Types modal is open
  ganttMonthCursor: null,                     // {year, month}, defaulted to current month at first render
  ganttCalendarShowInactive: false,
  ganttDragState: null,                       // {ticketId, anchorDate, currentDate} while a drag-to-fill is in progress
  ganttPendingEntryWrite: null,               // {ticketId, startDate, endDate, overlaps} staged between type-pick and overlap-confirm
  ganttLeaveDays: [],                         // this user's delivery_leave_days rows, bulk-loaded once
  ganttAlMarkingMode: false,                  // true while "Mark AL" toggle is active
  ganttAlEditingContext: null,                // {date, existingId} while the AL reason modal is open

  // tasks state (log-to-task conversion + Tasks kanban)
  tasks: [],
  tasksGroupBy: 'status',                     // 'status' | 'due' | 'priority'
  taskPopoverOpen: false,
  taskPopoverMode: null,                      // 'create' | 'edit'
  taskPopoverCtx: null,                       // {noteId, lineIndex, lineText, taskId}
  taskLineBusy: {},                           // { [noteId]: bool } — guards against overlapping ensureLineId backfill saves
  taskModalOpen: false, taskModalTaskId: null, taskModalCtx: null,   // ctx: {openedFrom} e.g. 'dailyNote'
  taskModalDirty: false, taskModalOpenedWith: null,   // {title, comment} snapshot taken on open, for the dirty check
  taskLinkPickerOpen: false,
  taskLinkPickerField: null,                  // 'follow_up_of_task_id' | 'depends_on_task_id' — which relation the open picker targets
  taskFollowUpModalCtx: null,                 // {followUpOfTaskId, titlePrefill} while the follow-up create modal is open

  // monitor report state
  monitorReports: [], activeMonitorReportId: null,
  monitorReportCriteria: [], monitorReportLines: [],
  monitorSaveTimer: null,      // single shared debounce timer for owner inline-edit — only one
                                // input can hold focus at a time, so one timer is sufficient
                                // (mirrors checklistNoteSaveTimer)

  // tab/nav state
  currentTab: 'notes',

  // onboarding state
  currentUserHasSeenTour: false,
  onboardingSteps: [],
  onboardingTooltips: [],
  tourActive: false,           // read by onboarding-tooltips.js to enforce "tour takes priority"
  tourMode: null,               // 'first-login' | 'help'
  tourStepIndex: 0,
};
