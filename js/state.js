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
  currentTeamSubTab: 'notes',                 // 'notes' | 'checklists'
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

  // delivery tracker (gantt) state
  ganttTaskTypes: [], ganttTickets: [], ganttEntries: [],
  ganttActiveView: 'timeline',                // 'timeline' | 'calendar'
  ganttTimelineStartDate: null,               // ISO date, defaulted to Monday-of-this-week at first render
  ganttTimelineWeeks: 6,
  ganttInactiveExpanded: false,
  ganttEditingTicketId: null,
  ganttTaskTypeEditItems: [],                 // working array while Manage Task Types modal is open
  ganttMonthCursor: null,                     // {year, month}, defaulted to current month at first render
  ganttCalendarShowInactive: false,
  ganttDragState: null,                       // {ticketId, anchorDate, currentDate} while a drag-to-fill is in progress
  ganttPendingEntryWrite: null,               // {ticketId, startDate, endDate, overlaps} staged between type-pick and overlap-confirm

  // tab/nav state
  currentTab: 'notes',
};
