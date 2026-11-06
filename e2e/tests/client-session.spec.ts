import { test, expect } from '@playwright/test';

test('parallel first-use requests from the real browser adapter share a persistent workspace', async ({ page }) => {
  // A same-origin, read-only endpoint leaves this browser without an app session.
  await page.goto('/api/health/');
  const result = await page.evaluate(async () => {
    const moduleUrl = new URL('/src/data/api.ts', location.origin).href;
    const { createServerApi } = await import(moduleUrl);
    const api = createServerApi();
    const suffix = Date.now();
    const titles = [`First concurrent meeting ${suffix}`, `Second concurrent meeting ${suffix}`];
    const settled = await Promise.allSettled(titles.map((title) => api.importMeeting({ title, meetingDate: '2026-11-05', notes: 'ACTION [Maya] Verify export | due:2026-11-12' })));
    const dashboard = await api.getDashboard();
    return {
      failed: settled.filter((item) => item.status === 'rejected').map((item) => String((item as PromiseRejectedResult).reason)),
      titles,
      saved: dashboard.meetings.map((meeting: { title: string }) => meeting.title),
    };
  });
  expect(result.failed).toEqual([]);
  expect(result.saved.sort()).toEqual(result.titles.sort());
});
