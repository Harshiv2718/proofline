import { test, expect } from '@playwright/test';

test('browser demo preserves source evidence and completed work across reload and normalized reimports', async ({ page }) => {
  await page.goto('/api/health/');
  const created = await page.evaluate(async () => {
    const { createDemoApi } = await import(new URL('/src/data/demo.ts', location.origin).href);
    const api = createDemoApi();
    const suffix = Date.now();
    const title = `Straße export ${suffix}`;
    const sourceQuote = 'ACTION [Maya] Verify Unicode export | due:2026-11-12';
    const notes = `Original introduction\r${sourceQuote}\u2028DECISION: Keep source evidence`;
    const original = await api.importMeeting({ title, meetingDate: '2026-11-05', notes });
    const replay = await api.importMeeting({ title: `  STRASSE   EXPORT ${suffix}  `, meetingDate: '2026-11-05', notes: `Original introduction\n${sourceQuote}  \nDECISION: Keep source evidence\n` });
    const reviewed = await api.reviewSuggestion({ id: original.meeting.suggestions[0].id, decision: 'ACCEPT', title: `Reviewed export ${suffix}`, owner: 'Maya QA' });
    await api.updateTask(reviewed.task.id, 'DONE', reviewed.task.version);
    return { meetingId: original.meeting.id, taskId: reviewed.task.id, notes, sourceQuote, duplicate: replay.duplicate, replayId: replay.meeting.id };
  });
  expect(created.duplicate).toBe(true);
  expect(created.replayId).toBe(created.meetingId);
  await page.reload();
  const restored = await page.evaluate(async ({ meetingId, taskId }) => {
    const { createDemoApi } = await import(new URL('/src/data/demo.ts', location.origin).href);
    const dashboard = await createDemoApi().getDashboard();
    return { meetings: dashboard.meetings.filter((meeting: { id: string }) => meeting.id === meetingId), tasks: dashboard.tasks.filter((task: { id: string }) => task.id === taskId) };
  }, created);
  expect(restored.meetings).toHaveLength(1);
  expect(restored.meetings[0]).toMatchObject({ notes: created.notes, suggestions: [expect.objectContaining({ sourceLine: 2, sourceQuote: created.sourceQuote, reviewState: 'ACCEPTED' }), expect.objectContaining({ kind: 'DECISION', sourceLine: 3, reviewState: 'PENDING' })] });
  expect(restored.tasks).toEqual([expect.objectContaining({ status: 'DONE', version: 2, sourceLine: 2, sourceQuote: created.sourceQuote, owner: 'Maya QA' })]);
});

test('invalid saved demo relationships produce an explicit error without silently erasing work', async ({ page }) => {
  await page.goto('/api/health/');
  const result = await page.evaluate(async () => {
    const { createDemoApi, DEMO_STORAGE_KEY } = await import(new URL('/src/data/demo.ts', location.origin).href);
    await createDemoApi().getDashboard();
    const saved = JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY)!);
    saved.tasks[0].meetingId = 'missing-meeting';
    const invalid = JSON.stringify(saved);
    localStorage.setItem(DEMO_STORAGE_KEY, invalid);
    let message = '';
    let code = '';
    try { await createDemoApi().getDashboard(); }
    catch (error) { message = (error as Error).message; code = (error as { code: string }).code; }
    return { message, code, preserved: localStorage.getItem(DEMO_STORAGE_KEY) === invalid };
  });
  expect(result.code).toBe('STORAGE_ERROR');
  expect(result.message).toContain('saved demo data could not be read');
  expect(result.preserved).toBe(true);
});
