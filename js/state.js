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
  checklistSharePanelOpen: {},                // { [instanceId]: bool } — mirrors checklistPhaseOpen pattern
  shareModalInstanceId: null,
  activeReviewShareId: null,
  reviewerCommentEditing: false,              // false=locked display (if a comment exists), true=textarea open
  reviewerCommentError: null,

  // campaigns state
  campSortCol: 'date', campSortDir: 'desc',
  activeCampId: null, editingCampId: null,
  campAddRowVisible: false,

  // tab/nav state
  currentTab: 'notes',
};
