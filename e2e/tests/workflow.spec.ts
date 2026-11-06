import { test, expect, type Page } from '@playwright/test';

async function importMeeting(page: Page, title: string, notes: string) {
  await page.getByRole('button', { name: 'Import meeting', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import a meeting' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Meeting title', { exact: true }).fill(title);
  await dialog.getByLabel('Meeting date', { exact: true }).fill('2026-11-05');
  await dialog.getByLabel('Meeting notes', { exact: true }).fill(notes);
  await dialog.getByRole('button', { name: 'Find suggestions', exact: true }).click();
  return dialog;
}

test('reviewed meeting evidence becomes one persistent task and a recorded decision', async ({ page }, testInfo) => {
  const title = `Export evidence ${Date.now()}`;
  const actionTitle = `Verify export ${Date.now()}`;
  const editedTitle = `${actionTitle} with source evidence`;
  const decisionTitle = `Keep source evidence ${Date.now()}`;
  const originalLine = `ACTION [Maya] ${actionTitle} | due:2026-11-12`;
  const notes = `A synthetic meeting for an end-to-end check.\n${originalLine}\nDECISION: ${decisionTitle}`;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const dialog = await importMeeting(page, title, notes);
  await expect(dialog).toBeHidden();

  const review = page.getByRole('form', { name: `Review ${actionTitle}`, exact: true });
  await expect(review).toBeVisible();
  await review.getByLabel('Suggestion title', { exact: true }).fill(editedTitle);
  await review.getByLabel('Owner', { exact: true }).fill('Maya QA');
  await review.getByRole('button', { name: 'Accept action', exact: true }).click();
  await expect(review).toBeHidden();
  const decision = page.getByRole('form', { name: `Review ${decisionTitle}`, exact: true });
  await decision.getByRole('button', { name: 'Accept decision', exact: true }).click();
  await expect(decision).toBeHidden();

  // An exact replay must select the existing evidence rather than creating another task.
  const replay = await importMeeting(page, title, notes);
  await expect(replay).toBeHidden();
  await expect(page.getByRole('form', { name: `Review ${actionTitle}`, exact: true })).toHaveCount(0);

  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  const task = page.getByRole('article', { name: editedTitle, exact: true });
  await expect(task).toHaveCount(1);
  await expect(task).toContainText('Maya QA');
  await task.getByLabel(`Status for ${editedTitle}`, { exact: true }).selectOption('DONE');
  await expect(task.getByLabel(`Status for ${editedTitle}`, { exact: true })).toHaveValue('DONE');
  await expect(task.getByLabel(`Status for ${editedTitle}`, { exact: true })).toBeEnabled();
  await page.reload();
  const restoredTask = page.getByRole('article', { name: editedTitle, exact: true });
  await expect(restoredTask).toHaveCount(1);
  await expect(restoredTask.getByLabel(`Status for ${editedTitle}`, { exact: true })).toHaveValue('DONE');

  await restoredTask.getByRole('button', { name: `View source for ${editedTitle}`, exact: true }).click();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(originalLine, { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop-source.png') });
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('link', { name: 'Decision log', exact: true }).click();
  await expect(page.getByText(decisionTitle, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: /Full workspace · JSON/ }).click();
  const exportFile = await downloaded;
  expect(exportFile.suggestedFilename()).toMatch(/^proofline-\d{4}-\d{2}-\d{2}\.json$/);
  const exportStream = await exportFile.createReadStream();
  expect(exportStream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of exportStream!) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(exported.mode).toBe('server-workspace');
  expect(exported.meetings.filter((meeting: { title: string }) => meeting.title === title)).toHaveLength(1);
  expect(exported.meetings.find((meeting: { title: string }) => meeting.title === title).notes).toBe(notes);
  expect(exported.tasks.filter((task: { title: string }) => task.title === editedTitle)).toEqual([expect.objectContaining({ status: 'DONE', sourceLine: 2, sourceQuote: originalLine })]);
  expect(errors).toEqual([]);
});

test('invalid action metadata stays in the import dialog with a useful error', async ({ page }) => {
  await page.goto('/');
  const dialog = await importMeeting(page, `Invalid import ${Date.now()}`, 'ACTION [Maya] Verify export | due:2026-02-30');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('due date must be a real YYYY-MM-DD date');
  await expect(dialog.getByLabel('Meeting notes', { exact: true })).toHaveValue('ACTION [Maya] Verify export | due:2026-02-30');
});

test('a review made stale by another tab explains the conflict and refreshes the final state', async ({ page, context }) => {
  const title = `Two-tab review ${Date.now()}`;
  const action = `Review shared export ${Date.now()}`;
  await page.goto('/');
  const dialog = await importMeeting(page, title, `ACTION [Maya] ${action} | due:2026-11-12`);
  await expect(dialog).toBeHidden();
  const staleTab = await context.newPage();
  await staleTab.goto('/#meetings');
  const staleReview = staleTab.getByRole('form', { name: `Review ${action}`, exact: true });
  await expect(staleReview).toBeVisible();
  const freshReview = page.getByRole('form', { name: `Review ${action}`, exact: true });
  await freshReview.getByRole('button', { name: 'Accept action', exact: true }).click();
  await expect(freshReview).toBeHidden();
  await staleReview.getByRole('button', { name: 'Reject suggestion', exact: true }).click();
  await expect(staleTab.getByRole('alert')).toContainText('already been reviewed');
  await expect(staleReview).toBeHidden();
  await staleTab.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(staleTab.getByRole('article', { name: action, exact: true })).toHaveCount(1);
});

test('the mobile import and review flow fits a narrow viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Import meeting', exact: true })).toBeVisible();
  const hasOverflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(await hasOverflow()).toBe(false);
  const actionTitle = `Mobile export ${Date.now()}`;
  const dialog = await importMeeting(page, `Mobile meeting ${Date.now()}`, `ACTION [Maya] ${actionTitle} | due:2026-11-12`);
  await expect(dialog).toBeHidden();
  const review = page.getByRole('form', { name: `Review ${actionTitle}`, exact: true });
  await expect(review).toBeVisible();
  expect(await hasOverflow()).toBe(false);
  await review.getByRole('button', { name: 'Accept action', exact: true }).click();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('article', { name: actionTitle, exact: true })).toBeVisible();
  expect(await hasOverflow()).toBe(false);
  await page.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('mobile-board.png'), fullPage: true });
});
