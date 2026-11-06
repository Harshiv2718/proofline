import { test, expect, type APIRequestContext } from '@playwright/test';

const importMutation = `mutation Import($title: String!, $notes: String!, $meetingDate: Date!) {
  importMeeting(title: $title, notes: $notes, meetingDate: $meetingDate) {
    duplicate meeting { id title suggestions { id kind title sourceLine sourceQuote reviewState } }
  }
}`;
const reviewMutation = `mutation Review($id: ID!, $decision: ReviewDecision!, $title: String) {
  reviewSuggestion(id: $id, decision: $decision, title: $title) {
    suggestion { id title reviewState taskId }
    task { id title status version meetingId sourceLine sourceQuote }
  }
}`;
const updateMutation = `mutation Update($id: ID!, $status: TaskStatus!, $expectedVersion: Int!) {
  updateTask(id: $id, status: $status, expectedVersion: $expectedVersion) { task { id status version } }
}`;
const dashboardQuery = `query { dashboard { meetings { id title } tasks { id title status version } metrics { meetingsCount totalTasks } } }`;

async function session(client: APIRequestContext) {
  const response = await client.get('/api/session/');
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['cache-control']).toBe('no-store');
  return await response.json() as { csrfToken: string; workspaceId: string };
}

async function graphql(client: APIRequestContext, token: string, query: string, variables: object = {}, expectedStatus = 200) {
  const response = await client.post('/graphql/', {
    headers: { 'X-CSRFToken': token, Origin: 'http://127.0.0.1:5173' },
    data: { query, variables },
  });
  expect(response.status()).toBe(expectedStatus);
  return await response.json();
}

test('real HTTP rejects missing CSRF, foreign origins and mutation over GET', async ({ request }) => {
  const { csrfToken } = await session(request);
  const before = await graphql(request, csrfToken, dashboardQuery);
  expect(before.errors).toBeUndefined();

  const withoutToken = await request.post('/graphql/', {
    data: { query: 'mutation { seedDemo { dashboard { metrics { totalTasks } } } }' },
  });
  expect(withoutToken.status()).toBe(403);

  const foreignOrigin = await request.post('/graphql/', {
    headers: { 'X-CSRFToken': csrfToken, Origin: 'https://unrelated.example' },
    data: { query: 'mutation { seedDemo { dashboard { metrics { totalTasks } } } }' },
  });
  expect(foreignOrigin.status()).toBe(403);

  const unsafeGet = await request.get('/graphql/', {
    params: { query: 'mutation { seedDemo { dashboard { metrics { totalTasks } } } }' },
  });
  expect(unsafeGet.status()).toBe(405);
  const after = await graphql(request, csrfToken, dashboardQuery);
  expect(after.data.dashboard).toEqual(before.data.dashboard);
});

test('separate browser sessions cannot read or mutate each other’s source-linked work', async ({ browser, baseURL }) => {
  const owner = await browser.newContext({ baseURL });
  const stranger = await browser.newContext({ baseURL });
  try {
    const a = await session(owner.request);
    const b = await session(stranger.request);
    expect(a.workspaceId).not.toBe(b.workspaceId);
    const imported = await graphql(owner.request, a.csrfToken, importMutation, {
      title: `Private export ${Date.now()}`,
      meetingDate: '2026-11-05',
      notes: 'ACTION [Maya] Verify export | due:2026-11-12\nDECISION: Keep source evidence',
    });
    expect(imported.errors).toBeUndefined();
    const meeting = imported.data.importMeeting.meeting;
    const suggestion = meeting.suggestions[0];
    const accepted = await graphql(owner.request, a.csrfToken, reviewMutation, {
      id: suggestion.id, decision: 'ACCEPT', title: 'Verify private export',
    });
    expect(accepted.errors).toBeUndefined();
    const task = accepted.data.reviewSuggestion.task;
    expect(task).toMatchObject({ meetingId: meeting.id, sourceLine: 1, sourceQuote: 'ACTION [Maya] Verify export | due:2026-11-12' });

    const privateDashboard = await graphql(stranger.request, b.csrfToken, dashboardQuery);
    expect(privateDashboard.data.dashboard.meetings).toEqual([]);
    expect(privateDashboard.data.dashboard.tasks).toEqual([]);
    const forbiddenReview = await graphql(stranger.request, b.csrfToken, reviewMutation, { id: suggestion.id, decision: 'REJECT' });
    expect(forbiddenReview.errors[0].extensions.code).toBe('NOT_FOUND');
    const forbiddenUpdate = await graphql(stranger.request, b.csrfToken, updateMutation, { id: task.id, status: 'DONE', expectedVersion: 1 });
    expect(forbiddenUpdate.errors[0].extensions.code).toBe('NOT_FOUND');

    const unchanged = await graphql(owner.request, a.csrfToken, dashboardQuery);
    expect(unchanged.data.dashboard.tasks).toEqual([expect.objectContaining({ id: task.id, status: 'TODO', version: 1 })]);
  } finally {
    await owner.close();
    await stranger.close();
  }
});

test('import and review replays keep one task, and stale status updates cannot overwrite newer work', async ({ request }) => {
  const { csrfToken } = await session(request);
  const title = `Replay export ${Date.now()}`;
  const originalInput = { title, meetingDate: '2026-11-05', notes: 'Intro\r\nACTION [Maya] Verify export | due:2026-11-12  \r\n' };
  const original = await graphql(request, csrfToken, importMutation, originalInput);
  expect(original.errors).toBeUndefined();
  expect(original.data.importMeeting.duplicate).toBe(false);
  const meeting = original.data.importMeeting.meeting;
  const replay = await graphql(request, csrfToken, importMutation, { ...originalInput, title: `  ${title.toUpperCase()}  `, notes: 'Intro\nACTION [Maya] Verify export | due:2026-11-12\n' });
  expect(replay.data.importMeeting).toMatchObject({ duplicate: true, meeting: { id: meeting.id } });

  const id = meeting.suggestions[0].id;
  const accepted = await graphql(request, csrfToken, reviewMutation, { id, decision: 'ACCEPT', title: 'Review the export evidence' });
  expect(accepted.errors).toBeUndefined();
  const task = accepted.data.reviewSuggestion.task;
  const reviewedAgain = await graphql(request, csrfToken, reviewMutation, { id, decision: 'ACCEPT', title: 'A replay must not overwrite this' });
  expect(reviewedAgain.data.reviewSuggestion.task).toEqual(task);
  const oppositeReview = await graphql(request, csrfToken, reviewMutation, { id, decision: 'REJECT' });
  expect(oppositeReview.errors[0].extensions.code).toBe('CONFLICT');

  const changed = await graphql(request, csrfToken, updateMutation, { id: task.id, status: 'DONE', expectedVersion: 1 });
  expect(changed.data.updateTask.task).toEqual({ id: task.id, status: 'DONE', version: 2 });
  const stale = await graphql(request, csrfToken, updateMutation, { id: task.id, status: 'TODO', expectedVersion: 1 });
  expect(stale.errors[0].extensions.code).toBe('CONFLICT');
  const final = await graphql(request, csrfToken, dashboardQuery);
  expect(final.data.dashboard.metrics).toEqual({ meetingsCount: 1, totalTasks: 1 });
  expect(final.data.dashboard.tasks).toEqual([expect.objectContaining({ id: task.id, title: 'Review the export evidence', status: 'DONE', version: 2 })]);
});

test('invalid marked notes and dates return visible API validation errors without storing a meeting', async ({ request }) => {
  const { csrfToken } = await session(request);
  const invalid = await graphql(request, csrfToken, importMutation, {
    title: 'Invalid due date', meetingDate: '2026-11-05', notes: 'ACTION [Maya] Verify export | due:2026-02-30',
  });
  expect(invalid.errors[0]).toMatchObject({ message: 'Line 1: due date must be a real YYYY-MM-DD date.', extensions: { code: 'VALIDATION_ERROR' } });
  const badDate = await graphql(request, csrfToken, importMutation, { title: 'Invalid meeting date', meetingDate: '2026-02-30', notes: 'ACTION: Verify export' }, 400);
  expect(badDate.errors).toHaveLength(1);
  const final = await graphql(request, csrfToken, dashboardQuery);
  expect(final.data.dashboard.meetings).toEqual([]);
});
