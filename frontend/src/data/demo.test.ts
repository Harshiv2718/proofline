import { describe, expect, it } from 'vitest';
import { ApiError, computeMetrics, isDate, type Task } from './domain';
import { createDemoApi, createSeedState, DEMO_STORAGE_KEY, extractSuggestions, isSavedState, splitLines } from './demo';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, clear: () => values.clear(), getItem: (key) => values.get(key) ?? null, key: (index) => [...values.keys()][index] ?? null, removeItem: (key) => { values.delete(key); }, setItem: (key, value) => { values.set(key, value); } };
}
const input = { title: 'A useful meeting', meetingDate: '2026-11-06', notes: 'Context stays in the notes.\nACTION [Maya] Ship the export | due:2026-11-12\nDECISION: Start with CSV' };

describe('explicit marker grammar, matching the server contract', () => {
  it('extracts only uppercase explicit markers and keeps exact original source lines', () => {
    const notes = 'Unmarked prose\r\naction [Maya] ignored\r\nACTION missing marker ignored\r\n  - ACTION [ Maya ] Ship the export | due:2026-11-12  \r\n* DECISION : Start with CSV';
    const suggestions = extractSuggestions(notes);
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]).toMatchObject({ kind: 'ACTION', title: 'Ship the export', owner: 'Maya', dueDate: '2026-11-12', sourceLine: 4, sourceQuote: '  - ACTION [ Maya ] Ship the export | due:2026-11-12  ', reviewState: 'PENDING' });
    expect(suggestions[1]).toMatchObject({ kind: 'DECISION', title: 'Start with CSV', sourceLine: 5, taskId: null });
  });
  it.each(['ACTION: Ship | due:2026-02-30', 'ACTION: Ship | due: 2026-11-12', 'ACTION: Ship | later:tomorrow', 'ACTION: Ship | due:0000-01-01'])('rejects malformed explicit metadata: %s', (notes) => {
    expect(() => extractSuggestions(notes)).toThrow(ApiError);
  });
  it('supports empty owners, no due date, and bounded suggestions', () => {
    expect(extractSuggestions('ACTION [] Ship\nACTION: Follow up')[0]).toMatchObject({ owner: '', dueDate: null });
    expect(() => extractSuggestions(Array.from({ length: 101 }, (_, index) => `ACTION: ${index}`).join('\n'))).toThrow('at most 100');
    expect(() => extractSuggestions(`ACTION: ${'x'.repeat(161)}`)).toThrow('1–160');
    expect(() => extractSuggestions(`ACTION [${'x'.repeat(81)}] Ship`)).toThrow('at most 80');
  });
  it('checks real calendar dates, including leap years and year zero', () => {
    expect(isDate('2028-02-29')).toBe(true);
    expect(isDate('2026-02-29')).toBe(false);
    expect(isDate('0000-01-01')).toBe(false);
    expect(isDate('2026-1-01')).toBe(false);
  });
});

describe('browser demo follows the same review and task rules', () => {
  it('imports, edits, accepts once, preserves evidence, and persists task status', async () => {
    const storage = memoryStorage();
    const api = createDemoApi(storage);
    const initial = await api.getDashboard();
    const { meeting } = await api.importMeeting(input);
    const suggestion = meeting.suggestions[0];
    const result = await api.reviewSuggestion({ id: suggestion.id, decision: 'ACCEPT', title: 'Ship accessible export', owner: 'Ada', dueDate: null });
    expect(result.task).toMatchObject({ title: 'Ship accessible export', owner: 'Ada', dueDate: null, status: 'TODO', version: 1, sourceQuote: suggestion.sourceQuote, sourceLine: 2 });
    const replay = await api.reviewSuggestion({ id: suggestion.id, decision: 'ACCEPT', title: 'Ignored replay edit' });
    expect(replay.task?.id).toBe(result.task?.id);
    expect(replay.task?.title).toBe('Ship accessible export');
    await expect(api.reviewSuggestion({ id: suggestion.id, decision: 'REJECT' })).rejects.toMatchObject({ code: 'CONFLICT' });
    const updated = await api.updateTask(result.task!.id, 'DONE', 1);
    expect(updated).toMatchObject({ version: 2, status: 'DONE' });
    const reloaded = await createDemoApi(storage).getDashboard();
    expect(reloaded.tasks).toHaveLength(initial.tasks.length + 1);
    expect(reloaded.tasks.find((task) => task.id === result.task!.id)?.status).toBe('DONE');
    expect(isSavedState(JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!))).toBe(true);
  });
  it('approves decisions without tasks and rejects suggestions without applying edits', async () => {
    const api = createDemoApi(memoryStorage());
    const before = await api.getDashboard();
    const { meeting } = await api.importMeeting(input);
    expect((await api.reviewSuggestion({ id: meeting.suggestions[1].id, decision: 'ACCEPT' })).task).toBeNull();
    const rejected = await api.reviewSuggestion({ id: meeting.suggestions[0].id, decision: 'REJECT', title: '' });
    expect(rejected.suggestion).toMatchObject({ title: 'Ship the export', reviewState: 'REJECTED', taskId: null });
    expect((await api.getDashboard()).tasks).toHaveLength(before.tasks.length);
  });
  it('normalizes duplicate title casing, Unicode casefold, whitespace, and note line endings', async () => {
    const api = createDemoApi(memoryStorage());
    const first = await api.importMeeting({ ...input, title: 'Straße   REVIEW', notes: 'ACTION: Ship export\nDECISION: Use CSV' });
    const duplicate = await api.importMeeting({ ...input, title: '  STRASSE review  ', notes: '\r\nACTION: Ship export  \r\nDECISION: Use CSV\r\n' });
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.meeting.id).toBe(first.meeting.id);
  });
  it('rejects a malformed import atomically without saving partial suggestions', async () => {
    const api = createDemoApi(memoryStorage());
    const initial = await api.getDashboard();
    await expect(api.importMeeting({ ...input, notes: 'ACTION: Valid\nACTION: Invalid | due:2026-99-99' })).rejects.toThrow('Line 2');
    expect(await api.getDashboard()).toEqual(initial);
  });
  it('round-trips Python splitlines separators and source references', async () => {
    const storage = memoryStorage();
    const api = createDemoApi(storage);
    const notes = 'Context\rACTION: One\u2028DECISION: Two\u0085ACTION: Three';
    const { meeting } = await api.importMeeting({ ...input, notes });
    expect(splitLines(notes)).toHaveLength(4);
    expect(meeting.suggestions.map((suggestion) => suggestion.sourceLine)).toEqual([2, 3, 4]);
    expect((await createDemoApi(storage).getDashboard()).meetings[0].notes).toBe(notes);
  });
  it('rejects a stale version across two tabs and keeps the newer status', async () => {
    const storage = memoryStorage();
    const firstTab = createDemoApi(storage);
    const secondTab = createDemoApi(storage);
    const task = (await firstTab.getDashboard()).tasks[0];
    await firstTab.updateTask(task.id, 'DONE', task.version);
    await expect(secondTab.updateTask(task.id, 'IN_PROGRESS', task.version)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await secondTab.getDashboard()).tasks.find((candidate) => candidate.id === task.id)?.status).toBe('DONE');
  });
  it('does not overwrite corrupt or unsupported saved data', async () => {
    const storage = memoryStorage();
    const raw = JSON.stringify({ schemaVersion: 99, meetings: [], tasks: [] });
    storage.setItem(DEMO_STORAGE_KEY, raw);
    await expect(createDemoApi(storage).getDashboard()).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(raw);
    const broken = createSeedState();
    broken.tasks[0].sourceQuote = 'Forged source';
    expect(isSavedState(broken)).toBe(false);
  });
  it('reports a failed save without changing the persisted task', async () => {
    const storage = memoryStorage();
    const api = createDemoApi(storage);
    const task = (await api.getDashboard()).tasks[0];
    const original = storage.getItem(DEMO_STORAGE_KEY);
    storage.setItem = () => { throw new DOMException('Quota exceeded'); };
    await expect(api.updateTask(task.id, 'DONE', task.version)).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(original);
  });
});

it('uses explicit denominators, UTC overdue dates, and half-up percentage rounding', () => {
  const tasks = Array.from({ length: 16 }, (_, index) => ({ id: String(index), status: index === 0 ? 'DONE' : 'TODO', dueDate: index < 3 ? '2026-11-05' : '2026-11-06' })) as Task[];
  const metrics = computeMetrics([], tasks, '2026-11-06');
  expect(metrics).toMatchObject({ completionRate: 6.3, overdueTasks: 2, totalTasks: 16, doneTasks: 1, reviewRate: 0 });
});
