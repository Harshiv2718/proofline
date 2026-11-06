import { test, expect } from '@playwright/test';

test('simultaneous identical imports and reviews resolve to one meeting and one task', async ({ request }) => {
  const apiOrigin = 'http://127.0.0.1:8000';
  const session = await request.get(`${apiOrigin}/api/session/`);
  expect(session.status()).toBe(200);
  const { csrfToken } = await session.json();
  const input = {
    headers: { 'X-CSRFToken': csrfToken, Origin: apiOrigin },
    data: {
      query: `mutation Import($title: String!, $notes: String!, $meetingDate: Date!) {
        importMeeting(title: $title, notes: $notes, meetingDate: $meetingDate) { duplicate meeting { id suggestions { id } } }
      }`,
      variables: { title: `Concurrent export ${Date.now()}`, notes: 'ACTION [Maya] Verify export | due:2026-11-12', meetingDate: '2026-11-05' },
    },
  };
  const responses = await Promise.all([
    request.post(`${apiOrigin}/graphql/`, input),
    request.post(`${apiOrigin}/graphql/`, input),
  ]);
  const bodies = await Promise.all(responses.map(async (response) => {
    expect(response.status()).toBe(200);
    return await response.json();
  }));
  for (const body of bodies) expect(body.errors).toBeUndefined();
  expect(bodies[0].data.importMeeting.meeting.id).toBe(bodies[1].data.importMeeting.meeting.id);
  expect(bodies.map((body) => body.data.importMeeting.duplicate).sort()).toEqual([false, true]);

  const reviewInput = {
    headers: input.headers,
    data: {
      query: `mutation Review($id: ID!) {
        reviewSuggestion(id: $id, decision: ACCEPT) { suggestion { reviewState taskId } task { id } }
      }`,
      variables: { id: bodies[0].data.importMeeting.meeting.suggestions[0].id },
    },
  };
  const reviews = await Promise.all([
    request.post(`${apiOrigin}/graphql/`, reviewInput),
    request.post(`${apiOrigin}/graphql/`, reviewInput),
  ]);
  const reviewed = await Promise.all(reviews.map(async (response) => {
    expect(response.status()).toBe(200);
    return await response.json();
  }));
  for (const body of reviewed) expect(body.errors).toBeUndefined();
  expect(reviewed[0].data.reviewSuggestion).toEqual(reviewed[1].data.reviewSuggestion);
  expect(reviewed[0].data.reviewSuggestion.suggestion).toEqual({ reviewState: 'ACCEPTED', taskId: reviewed[0].data.reviewSuggestion.task.id });
  const final = await request.post(`${apiOrigin}/graphql/`, {
    headers: input.headers,
    data: { query: 'query { dashboard { metrics { meetingsCount totalTasks } } }' },
  });
  expect(await final.json()).toEqual({ data: { dashboard: { metrics: { meetingsCount: 1, totalTasks: 1 } } } });
});
