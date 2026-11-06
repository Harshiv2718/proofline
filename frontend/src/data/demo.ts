import { ApiError, computeMetrics, isDate, today, type Dashboard, type ImportInput, type Meeting, type ProoflineApi, type ReviewInput, type Suggestion, type Task } from './domain';
import { casefold } from './casefold';

export const DEMO_STORAGE_KEY = 'proofline.demo.v1';
interface SavedState { schemaVersion: 1; meetings: Meeting[]; tasks: Task[] }
const copy = <T,>(value: T): T => structuredClone(value);
const uid = () => crypto.randomUUID();
const fail = (message: string): never => { throw new ApiError(message, 'VALIDATION_ERROR'); };
export const splitLines = (notes: string): string[] => notes.split(/\r\n|[\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]/);
const duplicateKey = (input: ImportInput): string => JSON.stringify([
  casefold(input.title.trim().split(/[\s\u001c-\u001f]+/).join(' ')),
  input.meetingDate,
  splitLines(input.notes).map((line) => line.trimEnd()).join('\n').trim(),
]);

export function validateImport(input: ImportInput): void {
  if (!input.title.trim()) fail('Give this meeting a title.');
  if (input.title.trim().length > 160) fail('Keep the meeting title under 160 characters.');
  if (!isDate(input.meetingDate)) fail('Choose a valid meeting date.');
  if (!input.notes.trim()) fail('Add the meeting notes you want to review.');
  if (input.notes.length > 20000) fail('Keep the notes under 20,000 characters.');
}

/** Explicit markers only. These are deterministic suggestions, never AI inferences. */
export function extractSuggestions(notes: string): Suggestion[] {
  const result: Suggestion[] = [];
  splitLines(notes).forEach((quote, index) => {
    const decision = /^\s*(?:[-*]\s*)?DECISION\s*:\s*(.+?)\s*$/.exec(quote);
    const action = /^\s*(?:[-*]\s*)?ACTION(?:\s*\[([^\]\r\n]*)\]|\s*:)(?:\s*)(.+?)\s*$/.exec(quote);
    if (!decision && !action) return;
    let title = decision ? decision[1].trim() : action![2].trim();
    let dueDate: string | null = null;
    if (!decision) {
      const due = /^(.+?)\s*\|\s*due:(\S+)\s*$/.exec(title);
      if (due) {
        if (!isDate(due[2])) fail(`Line ${index + 1}: due date must be a real YYYY-MM-DD date.`);
        dueDate = due[2];
        title = due[1].trim();
      } else if (title.includes('|')) {
        fail(`Line ${index + 1}: action metadata must use | due:YYYY-MM-DD.`);
      }
    }
    if (!title || title.length > 160) fail(`Line ${index + 1}: suggestion title must contain 1–160 characters.`);
    const owner = action?.[1]?.trim() || '';
    if (owner.length > 80) fail(`Line ${index + 1}: owner must contain at most 80 characters.`);
    result.push({ id: uid(), kind: decision ? 'DECISION' : 'ACTION', title, owner, dueDate, sourceLine: index + 1, sourceQuote: quote, reviewState: 'PENDING', taskId: null });
  });
  if (result.length > 100) fail('A meeting can contain at most 100 marked suggestions.');
  return result;
}

function dayOffset(offset: number): string {
  const date = new Date(`${today()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function createSeedState(): SavedState {
  const now = new Date().toISOString();
  const specs = [
    {
      id: 'demo-meeting-1', title: 'Product sync · The next chapter', offset: -2,
      notes: [
        'Synthetic meeting notes · Product team',
        'We walked through the onboarding flow and agreed to make the first step feel simpler.',
        `ACTION [Maya Chen] Simplify the first-run checklist | due:${dayOffset(2)}`,
        `ACTION [Owen Park] Build the CSV export flow | due:${dayOffset(4)}`,
        `ACTION [Ada Lin] Share the onboarding research | due:${dayOffset(-1)}`,
        'DECISION: Keep the first release focused on small teams',
        `ACTION [Maya Chen] Test the revised welcome screen | due:${dayOffset(5)}`,
      ].join('\n'),
      states: ['TODO', 'IN_PROGRESS', 'DONE', 'ACCEPTED', 'PENDING'],
    },
    {
      id: 'demo-meeting-2', title: 'Design review · Small details, big impact', offset: -4,
      notes: [
        'Synthetic meeting notes · Design and engineering',
        'A focused review of the little things that make work feel easier.',
        `ACTION [Ada Lin] Refine the empty states | due:${dayOffset(-1)}`,
        `ACTION [Owen Park] Add keyboard navigation | due:${dayOffset(1)}`,
        `ACTION [Maya Chen] Document the component patterns | due:${dayOffset(-2)}`,
        'DECISION: Use accessible text labels alongside status colors',
        'DECISION: Ship a single consistent card layout',
      ].join('\n'),
      states: ['TODO', 'IN_PROGRESS', 'DONE', 'ACCEPTED', 'PENDING'],
    },
    {
      id: 'demo-meeting-3', title: 'Launch planning · Ready when we are', offset: -1,
      notes: [
        'Synthetic meeting notes · Launch crew',
        'We are making room for a calm, considered launch.',
        `ACTION [Owen Park] Publish the release checklist | due:${dayOffset(-2)}`,
        `ACTION [Ada Lin] Draft the customer announcement | due:${dayOffset(3)}`,
        `ACTION [Maya Chen] Schedule the launch walkthrough | due:${dayOffset(6)}`,
        'DECISION: Invite the pilot group before opening public access',
      ].join('\n'),
      states: ['DONE', 'TODO', 'PENDING', 'PENDING'],
    },
  ];
  const tasks: Task[] = [];
  const meetings: Meeting[] = specs.map((spec) => {
    const suggestions = extractSuggestions(spec.notes).map((suggestion, index) => {
      const state = spec.states[index];
      suggestion.id = `${spec.id}-suggestion-${index + 1}`;
      if (state === 'PENDING') return suggestion;
      suggestion.reviewState = 'ACCEPTED';
      if (suggestion.kind === 'ACTION') {
        suggestion.taskId = `${spec.id}-task-${index + 1}`;
        tasks.push({ id: suggestion.taskId, title: suggestion.title, owner: suggestion.owner, dueDate: suggestion.dueDate, status: state as Task['status'], version: 1, meetingId: spec.id, meetingTitle: spec.title, suggestionId: suggestion.id, sourceLine: suggestion.sourceLine, sourceQuote: suggestion.sourceQuote, updatedAt: now });
      }
      return suggestion;
    });
    return { id: spec.id, title: spec.title, meetingDate: dayOffset(spec.offset), notes: spec.notes, createdAt: now, suggestions };
  });
  return { schemaVersion: 1, meetings, tasks };
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown, max = 20000): value is string => typeof value === 'string' && value.length <= max;
const dateOrNull = (value: unknown) => value === null || isDate(value);
const timestamp = (value: unknown) => string(value, 40) && !Number.isNaN(Date.parse(value));
const enumValue = (value: unknown, values: string[]) => typeof value === 'string' && values.includes(value);

/** Never trust localStorage: bound collections, check fields and verify source relationships. */
export function isSavedState(value: unknown): value is SavedState {
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.meetings) || !Array.isArray(value.tasks) || value.meetings.length > 100 || value.tasks.length > 500) return false;
  const ids = new Set<string>();
  for (const meeting of value.meetings) {
    if (!object(meeting) || !string(meeting.id, 100) || !meeting.id || ids.has(meeting.id) || !string(meeting.title, 160) || !meeting.title.trim() || !isDate(meeting.meetingDate) || !string(meeting.notes) || !timestamp(meeting.createdAt) || !Array.isArray(meeting.suggestions) || meeting.suggestions.length > 100) return false;
    ids.add(meeting.id);
    const lines = splitLines(meeting.notes);
    for (const suggestion of meeting.suggestions) {
      if (!object(suggestion) || !string(suggestion.id, 100) || !suggestion.id || ids.has(suggestion.id) || !enumValue(suggestion.kind, ['ACTION', 'DECISION']) || !string(suggestion.title, 160) || !suggestion.title.trim() || !string(suggestion.owner, 80) || !dateOrNull(suggestion.dueDate) || !Number.isInteger(suggestion.sourceLine) || Number(suggestion.sourceLine) < 1 || lines[Number(suggestion.sourceLine) - 1] !== suggestion.sourceQuote || !enumValue(suggestion.reviewState, ['PENDING', 'ACCEPTED', 'REJECTED']) || !(suggestion.taskId === null || string(suggestion.taskId, 100))) return false;
      if (suggestion.kind === 'DECISION' && suggestion.taskId !== null) return false;
      if (suggestion.reviewState !== 'ACCEPTED' && suggestion.taskId !== null) return false;
      ids.add(suggestion.id);
    }
  }
  for (const task of value.tasks) {
    if (!object(task) || !string(task.id, 100) || !task.id || ids.has(task.id) || !string(task.title, 160) || !task.title.trim() || !string(task.owner, 80) || !dateOrNull(task.dueDate) || !enumValue(task.status, ['TODO', 'IN_PROGRESS', 'DONE']) || !Number.isInteger(task.version) || Number(task.version) < 1 || !timestamp(task.updatedAt)) return false;
    const meeting = value.meetings.find((candidate) => candidate.id === task.meetingId) as Meeting | undefined;
    const suggestion = meeting?.suggestions.find((candidate) => candidate.id === task.suggestionId);
    if (!meeting || !suggestion || suggestion.kind !== 'ACTION' || suggestion.reviewState !== 'ACCEPTED' || suggestion.taskId !== task.id || task.meetingTitle !== meeting.title || task.sourceLine !== suggestion.sourceLine || task.sourceQuote !== suggestion.sourceQuote) return false;
    ids.add(task.id);
  }
  const taskIds = new Set(value.tasks.map((task) => task.id));
  return value.meetings.every((meeting) => meeting.suggestions.every((suggestion: Suggestion) => suggestion.kind !== 'ACTION' || suggestion.reviewState !== 'ACCEPTED' || (suggestion.taskId !== null && taskIds.has(suggestion.taskId))));
}

export function resetDemoStorage(storage: Storage = localStorage): void {
  try { storage.removeItem(DEMO_STORAGE_KEY); } catch { throw new ApiError('Browser storage is unavailable. Allow local storage to use the interactive demo.'); }
}

export function createDemoApi(storage?: Storage): ProoflineApi {
  function getStorage(): Storage { return storage || localStorage; }
  function save(state: SavedState): void {
    try { getStorage().setItem(DEMO_STORAGE_KEY, JSON.stringify(state)); }
    catch { throw new ApiError('Your changes could not be saved in this browser. Check available storage and try again.', 'STORAGE_ERROR'); }
  }
  function load(): SavedState {
    let raw: string | null;
    try { raw = getStorage().getItem(DEMO_STORAGE_KEY); }
    catch { throw new ApiError('Browser storage is unavailable. Allow local storage to use the interactive demo.', 'STORAGE_ERROR'); }
    if (raw === null) { const state = createSeedState(); save(state); return state; }
    try {
      if (raw.length > 5000000) throw new Error('Too large');
      const state: unknown = JSON.parse(raw);
      if (!isSavedState(state)) throw new Error('Invalid schema');
      return state;
    } catch { throw new ApiError('The saved demo data could not be read. Reset the browser demo to start with fresh sample data.', 'STORAGE_ERROR'); }
  }
  const dashboard = (state: SavedState): Dashboard => copy({ meetings: state.meetings, tasks: state.tasks, metrics: computeMetrics(state.meetings, state.tasks) });
  return {
    async getDashboard() { return dashboard(load()); },
    async seedDemo() { return dashboard(load()); },
    async importMeeting(input: ImportInput) {
      validateImport(input);
      const state = load();
      const title = input.title.trim();
      const notes = input.notes;
      const suggestions = extractSuggestions(notes);
      const key = duplicateKey(input);
      const duplicate = state.meetings.find((meeting) => duplicateKey(meeting) === key);
      if (duplicate) return copy({ meeting: duplicate, duplicate: true });
      if (state.meetings.length >= 100) throw new ApiError('This workspace has reached the 100-meeting limit.', 'LIMIT_EXCEEDED');
      const meeting: Meeting = { id: uid(), title, meetingDate: input.meetingDate, notes, createdAt: new Date().toISOString(), suggestions };
      state.meetings.unshift(meeting);
      save(state);
      return copy({ meeting, duplicate: false });
    },
    async reviewSuggestion(input: ReviewInput) {
      const state = load();
      const meeting = state.meetings.find((meeting) => meeting.suggestions.some((suggestion) => suggestion.id === input.id));
      const suggestion = meeting?.suggestions.find((suggestion) => suggestion.id === input.id);
      if (!meeting || !suggestion) throw new ApiError('This suggestion was not found.', 'NOT_FOUND');
      const desiredState = input.decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';
      if (suggestion.reviewState !== 'PENDING') {
        if (suggestion.reviewState !== desiredState) throw new ApiError('This suggestion has already been reviewed. Refresh to see its latest state.', 'CONFLICT');
        return copy({ suggestion, task: state.tasks.find((task) => task.id === suggestion.taskId) || null });
      }
      if (input.decision === 'ACCEPT') {
        if (input.title !== undefined) {
          if (!input.title.trim() || input.title.trim().length > 160) fail('Use a suggestion title between 1 and 160 characters.');
          suggestion.title = input.title.trim();
        }
        if (input.owner !== undefined) {
          if (input.owner.trim().length > 80) fail('Keep the owner name under 80 characters.');
          suggestion.owner = input.owner.trim();
        }
        if (input.dueDate !== undefined) {
          if (!dateOrNull(input.dueDate)) fail('Choose a valid due date.');
          suggestion.dueDate = input.dueDate;
        }
      }
      suggestion.reviewState = desiredState;
      let task: Task | null = null;
      if (desiredState === 'ACCEPTED' && suggestion.kind === 'ACTION') {
        if (state.tasks.length >= 500) throw new ApiError('This workspace has reached the 500-task limit.', 'LIMIT_EXCEEDED');
        task = { id: uid(), title: suggestion.title, owner: suggestion.owner, dueDate: suggestion.dueDate, status: 'TODO', version: 1, meetingId: meeting.id, meetingTitle: meeting.title, suggestionId: suggestion.id, sourceLine: suggestion.sourceLine, sourceQuote: suggestion.sourceQuote, updatedAt: new Date().toISOString() };
        suggestion.taskId = task.id;
        state.tasks.unshift(task);
      }
      save(state);
      return copy({ suggestion, task });
    },
    async updateTask(id, status, expectedVersion) {
      const state = load();
      const task = state.tasks.find((task) => task.id === id);
      if (!task) throw new ApiError('This task was not found.', 'NOT_FOUND');
      if (task.version !== expectedVersion) throw new ApiError('This task changed in another tab. The board has been refreshed; try your update again.', 'CONFLICT');
      if (!['TODO', 'IN_PROGRESS', 'DONE'].includes(status)) fail('Choose a valid task status.');
      task.status = status;
      task.version += 1;
      task.updatedAt = new Date().toISOString();
      save(state);
      return copy(task);
    },
  };
}
