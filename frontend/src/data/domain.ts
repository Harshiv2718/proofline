export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
export type SuggestionKind = 'ACTION' | 'DECISION';
export type ReviewState = 'PENDING' | 'ACCEPTED' | 'REJECTED';
export type ReviewDecision = 'ACCEPT' | 'REJECT';

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  title: string;
  owner: string;
  dueDate: string | null;
  sourceLine: number;
  sourceQuote: string;
  reviewState: ReviewState;
  taskId: string | null;
}

export interface Meeting {
  id: string;
  title: string;
  meetingDate: string;
  notes: string;
  createdAt: string;
  suggestions: Suggestion[];
}

export interface Task {
  id: string;
  title: string;
  owner: string;
  dueDate: string | null;
  status: TaskStatus;
  version: number;
  meetingId: string;
  meetingTitle: string;
  suggestionId: string;
  sourceLine: number;
  sourceQuote: string;
  updatedAt: string;
}

export interface Metrics {
  totalTasks: number;
  doneTasks: number;
  overdueTasks: number;
  completionRate: number;
  reviewRate: number;
  pendingSuggestions: number;
  meetingsCount: number;
  asOf: string;
}

export interface Dashboard {
  meetings: Meeting[];
  tasks: Task[];
  metrics: Metrics;
}

export interface ImportInput { title: string; notes: string; meetingDate: string }
export interface ReviewInput { id: string; decision: ReviewDecision; title?: string; owner?: string; dueDate?: string | null }

export interface ProoflineApi {
  getDashboard(): Promise<Dashboard>;
  importMeeting(input: ImportInput): Promise<{ meeting: Meeting; duplicate: boolean }>;
  reviewSuggestion(input: ReviewInput): Promise<{ suggestion: Suggestion; task: Task | null }>;
  updateTask(id: string, status: TaskStatus, expectedVersion: number): Promise<Task>;
  seedDemo(): Promise<Dashboard>;
}

export class ApiError extends Error {
  code: string;
  constructor(message: string, code = 'REQUEST_FAILED') {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

export function today(): string { return new Date().toISOString().slice(0, 10); }
export function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith('0000-') && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function computeMetrics(meetings: Meeting[], tasks: Task[], asOf = today()): Metrics {
  const suggestions = meetings.flatMap((meeting) => meeting.suggestions);
  const doneTasks = tasks.filter((task) => task.status === 'DONE').length;
  const pendingSuggestions = suggestions.filter((suggestion) => suggestion.reviewState === 'PENDING').length;
  return {
    totalTasks: tasks.length,
    doneTasks,
    overdueTasks: tasks.filter((task) => task.status !== 'DONE' && task.dueDate && task.dueDate < asOf).length,
    completionRate: tasks.length ? Math.round(doneTasks / tasks.length * 1000) / 10 : 0,
    reviewRate: suggestions.length ? Math.round((suggestions.length - pendingSuggestions) / suggestions.length * 1000) / 10 : 0,
    pendingSuggestions,
    meetingsCount: meetings.length,
    asOf,
  };
}
