import { ApiError, type Dashboard, type ImportInput, type Meeting, type ProoflineApi, type ReviewInput, type Suggestion, type Task, type TaskStatus } from './domain';
import { createDemoApi } from './demo';

const suggestionFields = 'id kind title owner dueDate sourceLine sourceQuote reviewState taskId';
const meetingFields = `id title meetingDate notes createdAt suggestions { ${suggestionFields} }`;
const taskFields = 'id title owner dueDate status version meetingId meetingTitle suggestionId sourceLine sourceQuote updatedAt';
const dashboardFields = `meetings { ${meetingFields} } tasks { ${taskFields} } metrics { totalTasks doneTasks overdueTasks completionRate reviewRate pendingSuggestions meetingsCount asOf }`;

export function createServerApi(): ProoflineApi {
  let csrfToken: string | null = null;
  let sessionPromise: Promise<void> | null = null;
  async function initializeSession() {
    if (!sessionPromise) sessionPromise = (async () => {
      const response = await fetch('/api/session/', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new ApiError('We could not open your workspace. Please try again.');
      const session = await response.json() as { csrfToken?: string };
      if (!session.csrfToken) throw new ApiError('Your workspace session could not be verified. Reload and try again.', 'SESSION_REQUIRED');
      csrfToken = session.csrfToken;
    })().finally(() => { sessionPromise = null; });
    await sessionPromise;
  }
  async function request<T>(query: string, variables?: object): Promise<T> {
    try {
      if (!csrfToken) {
        await initializeSession();
      }
      const response = await fetch('/graphql/', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken! },
        body: JSON.stringify({ query, variables }),
      });
      if (!response.ok) {
        if (response.status === 403) csrfToken = null;
        throw new ApiError(response.status === 403 ? 'Your workspace session expired. Please try again.' : 'The workspace could not be reached. Please try again.');
      }
      const body = await response.json() as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };
      if (body.errors?.length) {
        const error = body.errors[0];
        if (error.extensions?.code === 'SESSION_REQUIRED') csrfToken = null;
        throw new ApiError(error.message, error.extensions?.code);
      }
      if (!body.data) throw new ApiError('The workspace returned an empty response. Please try again.');
      return body.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('Connection interrupted. Check your connection and try again.');
    }
  }
  return {
    async getDashboard() {
      return (await request<{ dashboard: Dashboard }>(`query Dashboard { dashboard { ${dashboardFields} } }`)).dashboard;
    },
    async importMeeting(input: ImportInput) {
      return (await request<{ importMeeting: { meeting: Meeting; duplicate: boolean } }>(`mutation ImportMeeting($title: String!, $notes: String!, $meetingDate: Date!) { importMeeting(title: $title, notes: $notes, meetingDate: $meetingDate) { meeting { ${meetingFields} } duplicate } }`, input)).importMeeting;
    },
    async reviewSuggestion(input: ReviewInput) {
      return (await request<{ reviewSuggestion: { suggestion: Suggestion; task: Task | null } }>(`mutation ReviewSuggestion($id: ID!, $decision: ReviewDecision!, $title: String, $owner: String, $dueDate: Date) { reviewSuggestion(id: $id, decision: $decision, title: $title, owner: $owner, dueDate: $dueDate) { suggestion { ${suggestionFields} } task { ${taskFields} } } }`, input)).reviewSuggestion;
    },
    async updateTask(id: string, status: TaskStatus, expectedVersion: number) {
      return (await request<{ updateTask: { task: Task } }>(`mutation UpdateTask($id: ID!, $status: TaskStatus!, $expectedVersion: Int!) { updateTask(id: $id, status: $status, expectedVersion: $expectedVersion) { task { ${taskFields} } } }`, { id, status, expectedVersion })).updateTask.task;
    },
    async seedDemo() {
      return (await request<{ seedDemo: { dashboard: Dashboard } }>(`mutation SeedDemo { seedDemo { dashboard { ${dashboardFields} } } }`)).seedDemo.dashboard;
    },
  };
}

export const isDemoMode = import.meta.env.VITE_DEMO === 'true';
export const api: ProoflineApi = isDemoMode ? createDemoApi() : createServerApi();
