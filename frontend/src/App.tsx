import { useCallback, useEffect, useMemo, useState } from 'react';
import { api as defaultApi, isDemoMode } from './data/api';
import { ApiError, computeMetrics, type Dashboard, type ImportInput, type ProoflineApi, type ReviewInput, type Task, type TaskStatus } from './data/domain';
import { resetDemoStorage, splitLines } from './data/demo';
import { Icon } from './components/Icon';
import { ImportDialog } from './components/ImportDialog';
import { Modal } from './components/Modal';
import { ReviewCard } from './components/ReviewCard';

type View = 'overview' | 'meetings' | 'decisions' | 'insights';
const views = [
  { id: 'overview' as const, name: 'Overview', icon: 'board' as const },
  { id: 'meetings' as const, name: 'Meeting inbox', icon: 'meeting' as const },
  { id: 'decisions' as const, name: 'Decision log', icon: 'decision' as const },
  { id: 'insights' as const, name: 'Insights', icon: 'chart' as const },
];
const statuses: { id: TaskStatus; label: string }[] = [{ id: 'TODO', label: 'To do' }, { id: 'IN_PROGRESS', label: 'In progress' }, { id: 'DONE', label: 'Done' }];
const initialView = (): View => views.find((view) => `#${view.id}` === window.location.hash)?.id || 'overview';
const formatDate = (date: string, long = false) => new Intl.DateTimeFormat('en', { month: long ? 'long' : 'short', day: 'numeric', timeZone: 'UTC', ...(long ? { year: 'numeric' as const } : {}) }).format(new Date(`${date}T12:00:00Z`));
const initials = (name: string) => name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || '–';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something interrupted that change. Please try again.';
const ownerColor = (owner: string) => ['lavender', 'peach', 'sage'][Array.from(owner).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 3];

function EmptyState({ title, children, icon = 'meeting', action }: { title: string; children: React.ReactNode; icon?: 'meeting' | 'board' | 'decision' | 'search'; action?: React.ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={28} /></span><h3>{title}</h3><p>{children}</p>{action}</div>;
}

function TaskCard({ task, asOf, saving, onStatus, onSource }: { task: Task; asOf: string; saving: boolean; onStatus: (task: Task, status: TaskStatus) => void; onSource: () => void }) {
  const overdue = !!task.dueDate && task.dueDate < asOf && task.status !== 'DONE';
  return <article className={`task-card ${task.status === 'DONE' ? 'task-complete' : ''}`} aria-label={task.title}>
    <div className="task-card-top"><span className="task-category">{task.meetingTitle.split(' · ')[0]}</span><button className="source-link" onClick={onSource} aria-label={`View source for ${task.title}`} title="See the original meeting note"><Icon name="source" size={15} /><span>L{task.sourceLine}</span></button></div>
    <h3>{task.title}</h3>
    <div className="task-meta"><span className={`avatar ${ownerColor(task.owner)}`} aria-hidden="true">{initials(task.owner)}</span><span>{task.owner || 'Unassigned'}</span></div>
    <div className="task-card-bottom"><span className={`due-date ${overdue ? 'overdue' : ''}`}><Icon name={task.status === 'DONE' ? 'check' : 'calendar'} size={13} />{task.dueDate ? `${overdue ? 'Overdue · ' : ''}${task.dueDate === asOf ? 'Today' : formatDate(task.dueDate)}` : 'No due date'}</span><select className="task-status-select" aria-label={`Status for ${task.title}`} value={task.status} onChange={(event) => onStatus(task, event.target.value as TaskStatus)} disabled={saving}>{statuses.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}</select></div>
    {saving && <span className="saving-label" role="status">Saving change…</span>}
  </article>;
}

export function App({ api = defaultApi, demo = isDemoMode }: { api?: ProoflineApi; demo?: boolean }) {
  const [view, setView] = useState<View>(initialView);
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState<'pending' | 'all'>('pending');
  const [source, setSource] = useState<{ meetingId: string; line: number } | null>(null);
  const [busyTasks, setBusyTasks] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [owner, setOwner] = useState('all');
  const [due, setDue] = useState('all');
  const [status, setStatus] = useState('all');
  const [seedBusy, setSeedBusy] = useState(false);
  const [decisionSearch, setDecisionSearch] = useState('');

  const refresh = useCallback(async (full = false) => {
    if (full) setLoading(true);
    try { setData(await api.getDashboard()); setError(''); }
    catch (error) { setError(errorMessage(error)); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void refresh(true); }, [refresh]);
  useEffect(() => {
    const change = () => { const next = views.find((item) => `#${item.id}` === window.location.hash); if (next) setView(next.id); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => { document.title = `${views.find((item) => item.id === view)?.name} · Proofline`; }, [view]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 6500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const navigate = (next: View) => { window.location.hash = next; setView(next); setExportOpen(false); };
  const metrics = data?.metrics;
  const selectedMeeting = data?.meetings.find((meeting) => meeting.id === selectedMeetingId) || data?.meetings[0];
  const sourceMeeting = data?.meetings.find((meeting) => meeting.id === source?.meetingId);
  const owners = useMemo(() => Array.from(new Set(data?.tasks.map((task) => task.owner) || [])).sort(), [data]);
  const filteredTasks = useMemo(() => data?.tasks.filter((task) => {
    const matchesSearch = `${task.title} ${task.owner} ${task.meetingTitle}`.toLowerCase().includes(search.toLowerCase());
    const matchesOwner = owner === 'all' || task.owner === owner;
    const matchesStatus = status === 'all' || task.status === status;
    const matchesDue = due === 'all' || (due === 'overdue' && task.status !== 'DONE' && !!task.dueDate && task.dueDate < data.metrics.asOf) || (due === 'today' && task.dueDate === data.metrics.asOf) || (due === 'none' && !task.dueDate);
    return matchesSearch && matchesOwner && matchesStatus && matchesDue;
  }) || [], [data, search, owner, status, due]);
  const decisionEntries = data?.meetings.flatMap((meeting) => meeting.suggestions.filter((suggestion) => suggestion.kind === 'DECISION' && suggestion.reviewState === 'ACCEPTED').map((suggestion) => ({ meeting, suggestion }))) || [];
  const visibleDecisions = decisionEntries.filter(({ suggestion, meeting }) => `${suggestion.title} ${meeting.title}`.toLowerCase().includes(decisionSearch.toLowerCase()));
  const showSource = (meetingId: string, line: number) => setSource({ meetingId, line });
  const clearFilters = () => { setSearch(''); setOwner('all'); setDue('all'); setStatus('all'); };
  const activeFilters = search || owner !== 'all' || due !== 'all' || status !== 'all';

  async function importMeeting(input: ImportInput) {
    const result = await api.importMeeting(input);
    const next = await api.getDashboard();
    setData(next);
    setSelectedMeetingId(result.meeting.id);
    setReviewFilter('pending');
    setImportOpen(false);
    navigate('meetings');
    setNotice(result.duplicate ? 'This meeting is already here. No duplicates were created.' : result.meeting.suggestions.length ? `${result.meeting.suggestions.length} suggestions found. They’re ready for your review.` : 'Notes saved. No uppercase ACTION or DECISION markers were found.');
  }
  async function reviewSuggestion(input: ReviewInput) {
    try {
      const result = await api.reviewSuggestion(input);
      setData((current) => {
        if (!current) return current;
        const meetings = current.meetings.map((meeting) => ({ ...meeting, suggestions: meeting.suggestions.map((suggestion) => suggestion.id === result.suggestion.id ? result.suggestion : suggestion) }));
        const tasks = result.task && !current.tasks.some((task) => task.id === result.task!.id) ? [result.task, ...current.tasks] : current.tasks;
        return { meetings, tasks, metrics: computeMetrics(meetings, tasks, current.metrics.asOf) };
      });
      setNotice(input.decision === 'REJECT' ? 'Suggestion rejected. The original note stays intact.' : result.task ? 'Action accepted. It’s on your board, with its source attached.' : 'Decision approved and added to the decision log.');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONFLICT') { await refresh(); setError(error.message); }
      throw error;
    }
  }
  async function updateTask(task: Task, nextStatus: TaskStatus) {
    if (busyTasks.has(task.id) || nextStatus === task.status) return;
    setBusyTasks((current) => new Set(current).add(task.id));
    setError('');
    setData((current) => {
      if (!current) return current;
      const tasks = current.tasks.map((item) => item.id === task.id ? { ...item, status: nextStatus } : item);
      return { ...current, tasks, metrics: computeMetrics(current.meetings, tasks, current.metrics.asOf) };
    });
    try {
      const result = await api.updateTask(task.id, nextStatus, task.version);
      setData((current) => {
        if (!current) return current;
        const tasks = current.tasks.map((item) => item.id === result.id ? result : item);
        return { ...current, tasks, metrics: computeMetrics(current.meetings, tasks, current.metrics.asOf) };
      });
      setNotice(`“${task.title}” moved to ${statuses.find((status) => status.id === nextStatus)?.label.toLowerCase()}.`);
    } catch (error) {
      setData((current) => {
        if (!current) return current;
        const tasks = current.tasks.map((item) => item.id === task.id ? task : item);
        return { ...current, tasks, metrics: computeMetrics(current.meetings, tasks, current.metrics.asOf) };
      });
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        try { setData(await api.getDashboard()); } catch { /* Original conflict remains visible below. */ }
      }
      setError(errorMessage(error));
    } finally { setBusyTasks((current) => { const next = new Set(current); next.delete(task.id); return next; }); }
  }
  async function seed() {
    setSeedBusy(true);
    try { setData(await api.seedDemo()); setError(''); setNotice('Sample workspace loaded. Every person and meeting is fictional.'); }
    catch (error) { setError(errorMessage(error)); }
    finally { setSeedBusy(false); }
  }
  function exportData(type: 'json' | 'csv') {
    if (!data) return;
    const csvCell = (value: unknown) => { let text = String(value ?? ''); if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g, '""')}"`; };
    const contents = type === 'json' ? JSON.stringify({ exportedAt: new Date().toISOString(), mode: demo ? 'browser-demo' : 'server-workspace', ...data }, null, 2) : [['Title', 'Owner', 'Due date', 'Status', 'Meeting', 'Source line', 'Source quote'], ...data.tasks.map((task) => [task.title, task.owner, task.dueDate || '', task.status, task.meetingTitle, task.sourceLine, task.sourceQuote])].map((row) => row.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([contents], { type: type === 'json' ? 'application/json' : 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `proofline-${metrics?.asOf}.${type}`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportOpen(false);
    setNotice(type === 'json' ? 'Workspace exported with meetings, suggestions, tasks, and source notes.' : 'Task CSV exported with owners, status, due dates, and source notes.');
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar" aria-label="Main navigation">
      <a href="#overview" className="brand" aria-label="Proofline home" onClick={() => navigate('overview')}><span className="brand-mark" aria-hidden="true"><span /><span /></span><span>proofline<span className="brand-period">.</span></span></a>
      <div className="workspace-switch"><span className="workspace-avatar">P</span><div><strong>Product workspace</strong><span>Make good things happen</span></div><span className="workspace-dot" /></div>
      <span className="nav-caption">WORKSPACE</span>
      <nav>{views.map((item) => <a href={`#${item.id}`} className={`nav-item ${view === item.id ? 'active' : ''}`} aria-current={view === item.id ? 'page' : undefined} key={item.id} onClick={() => navigate(item.id)}><Icon name={item.icon} size={19} /><span>{item.name}</span>{item.id === 'meetings' && !!metrics?.pendingSuggestions && <span className="nav-count" aria-label={`${metrics.pendingSuggestions} pending suggestions`}>{metrics.pendingSuggestions}</span>}</a>)}</nav>
      <div className="sidebar-note"><span className="note-flower" aria-hidden="true">✳</span><h3>A little more<br />follow-through.</h3><p>Good work starts with a conversation. Great work keeps it going.</p><div className="note-line" /></div>
      <div className="sidebar-bottom"><span className="small-logo" aria-hidden="true">p.</span><div><strong>Built with intention</strong><span>Source first. Human always.</span></div></div>
    </aside>
    <div className="workspace-main">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><Icon name="chevron" size={12} /><strong>{views.find((item) => item.id === view)?.name}</strong></div><div className="topbar-right"><span className={`mode-label ${demo ? 'demo-label' : ''}`}><span />{demo ? 'Interactive demo · saved in this browser' : 'Private workspace · saved on server'}</span><span className="profile-avatar" title="This workspace has no account sign-in">P</span></div></header>
      <main id="main-content" tabIndex={-1}>
        <div className="page-heading"><div><div className="eyebrow"><span />{view === 'overview' ? 'LESS RECAP. MORE MOMENTUM.' : view === 'meetings' ? 'THE CONVERSATION CONTINUES' : view === 'decisions' ? 'A SHARED SENSE OF DIRECTION' : 'THE WORK BEHIND THE NUMBERS'}</div><h1>{view === 'overview' ? 'Make the next step clear.' : view === 'meetings' ? 'From said to set in motion.' : view === 'decisions' ? 'Remember the why.' : 'See the follow-through.'}</h1><p>{view === 'overview' ? 'A calmer place for the work that comes after the meeting.' : view === 'meetings' ? 'Your meeting notes, with a little structure and a human in the loop.' : view === 'decisions' ? 'The choices your team made, grounded in the original conversation.' : 'Track reviewed suggestions, completed actions, and overdue work.'}</p></div><div className="heading-actions"><div className="export-control"><button className="button secondary export-button" onClick={() => setExportOpen(!exportOpen)} disabled={!data} aria-expanded={exportOpen}><Icon name="download" size={17} /><span>Export</span></button>{exportOpen && <div className="export-popover" role="group" aria-label="Export workspace"><button onClick={() => exportData('json')}>Full workspace · JSON<small>Meetings, reviews & tasks</small></button><button onClick={() => exportData('csv')}>Tasks · CSV<small>Ready for your spreadsheet</small></button></div>}</div><button className="button primary" onClick={() => setImportOpen(true)}><Icon name="plus" size={18} />Import meeting</button></div></div>

        {error && <div className="error-banner" role="alert"><Icon name="info" /><div><strong>That didn’t go through.</strong><p>{error}</p></div><button className="text-button" onClick={() => void refresh()}>Try again</button><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><Icon name="close" size={16} /></button></div>}
        {loading ? <div className="loading-workspace" role="status"><span className="loading-orbit" />Opening your workspace<span>Getting the next steps together.</span></div> : !data ? <EmptyState title="Let’s reconnect" icon="board" action={<div className="empty-actions"><button className="button primary" onClick={() => void refresh(true)}>Retry connection</button>{demo && <button className="button secondary" onClick={() => setResetOpen(true)}>Reset browser demo</button>}</div>}>Your workspace couldn’t be opened. The error above has more detail.</EmptyState> : <>
          {view === 'overview' && <>
            <div className="metric-grid"><div className="metric-card"><div className="metric-label">Open actions<Icon name="arrow" size={16} /></div><div className="metric-number">{metrics!.totalTasks - metrics!.doneTasks}<span>worth moving forward</span></div><span className="metric-foot"><span className="tiny-dot teal" />Across {metrics!.meetingsCount} meetings</span></div><div className="metric-card"><div className="metric-label">Completed<Icon name="check" size={17} /></div><div className="metric-number">{metrics!.doneTasks}<span>small wins, real progress</span></div><div className="completion-track"><span style={{ width: `${metrics!.completionRate}%` }} /></div><span className="metric-foot">{metrics!.completionRate}% of all actions</span></div><button className="metric-card metric-review" onClick={() => { navigate('meetings'); setReviewFilter('pending'); const meeting = data.meetings.find((meeting) => meeting.suggestions.some((suggestion) => suggestion.reviewState === 'PENDING')); if (meeting) setSelectedMeetingId(meeting.id); }}><div className="metric-label">Awaiting your review<Icon name="spark" size={17} /></div><div className="metric-number">{metrics!.pendingSuggestions}<span>a little human judgment</span></div><span className="metric-foot">Review suggestions<Icon name="arrow" size={15} /></span></button></div>
            <div className="section-heading"><div><h2>Your follow-through board<span className="subtle-count">{data.tasks.length}</span></h2><p>Move things forward. Keep the context close.</p></div><div className="board-legend"><span className="tiny-dot teal" />Every action is source-linked</div></div>
            <div className="board-toolbar"><div className="search-field"><Icon name="search" size={17} /><input type="search" aria-label="Search tasks" placeholder="Find an action…" value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="board-filters"><Icon name="filter" size={16} /><select aria-label="Owner filter" value={owner} onChange={(event) => setOwner(event.target.value)}><option value="all">All owners</option>{owners.map((owner) => <option key={owner} value={owner}>{owner || 'Unassigned'}</option>)}</select><select aria-label="Due date filter" value={due} onChange={(event) => setDue(event.target.value)}><option value="all">Any due date</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="none">No due date</option></select><select aria-label="Status filter" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option>{statuses.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}</select>{activeFilters && <button className="text-button clear-filters" onClick={clearFilters}>Clear</button>}</div></div>
            {data.tasks.length === 0 ? <EmptyState title="A clean slate. A clear next step." icon="board" action={<div className="empty-actions"><button className="button primary" onClick={() => setImportOpen(true)}>Import your first meeting</button>{!data.meetings.length && <button className="button secondary" onClick={() => void seed()} disabled={seedBusy}>{seedBusy ? 'Loading samples…' : 'Load sample workspace'}</button>}{!!data.meetings.length && <button className="button secondary" onClick={() => navigate('meetings')}>Review meeting suggestions</button>}</div>}>Import marked meeting notes, review the suggestions, and your accepted actions will land here.</EmptyState> : filteredTasks.length === 0 ? <EmptyState title="No actions match those filters." icon="search" action={<button className="button secondary" onClick={clearFilters}>Clear filters</button>}>Try another owner, date, status, or search term.</EmptyState> : <div className="kanban-board">{statuses.filter((column) => status === 'all' || status === column.id).map((column) => <section className={`kanban-column column-${column.id.toLowerCase()}`} key={column.id} aria-label={column.label}><div className="column-heading"><h3><span className="status-dot">{column.id === 'DONE' && <Icon name="check" size={10} />}</span>{column.label}<span>{filteredTasks.filter((task) => task.status === column.id).length}</span></h3><Icon name={column.id === 'DONE' ? 'check' : column.id === 'IN_PROGRESS' ? 'clock' : 'board'} size={15} /></div><div className="column-cards">{filteredTasks.filter((task) => task.status === column.id).map((task) => <TaskCard key={task.id} task={task} asOf={metrics!.asOf} saving={busyTasks.has(task.id)} onStatus={(task, status) => void updateTask(task, status)} onSource={() => showSource(task.meetingId, task.sourceLine)} />)}{!filteredTasks.some((task) => task.status === column.id) && <p className="empty-column">{column.id === 'DONE' ? 'Your next small win goes here.' : 'A little room to breathe.'}</p>}</div></section>)}</div>}
            <div className="board-footer"><span><Icon name="source" size={14} />Context is a click away. Open any source link to see the original note.</span><button className="text-button" onClick={() => navigate('insights')}>See the bigger picture<Icon name="arrow" size={14} /></button></div>
          </>}
          {view === 'meetings' && <>
            <div className="inbox-intro"><div><Icon name="source" size={19} /><p><strong>Marked by you. Reviewed by you.</strong> We extract explicit <code>ACTION</code> and <code>DECISION</code> lines with a deterministic parser. No AI inference, no silent task creation.</p></div><span>{metrics!.pendingSuggestions} pending</span></div>
            {!data.meetings.length ? <EmptyState title="The next good conversation starts here." action={<div className="empty-actions"><button className="button primary" onClick={() => setImportOpen(true)}>Import your first meeting</button><button className="button secondary" onClick={() => void seed()} disabled={seedBusy}>{seedBusy ? 'Loading samples…' : 'Load sample workspace'}</button></div>}>Save your notes, then choose which suggested actions and decisions deserve a next step.</EmptyState> : <div className="meeting-workspace"><section className="meeting-list" aria-label="Meetings"><div className="meeting-list-heading"><h2>Your meetings</h2><span>{data.meetings.length}</span></div>{data.meetings.map((meeting) => { const pending = meeting.suggestions.filter((suggestion) => suggestion.reviewState === 'PENDING').length; return <button key={meeting.id} className={`meeting-item ${selectedMeeting?.id === meeting.id ? 'selected' : ''}`} onClick={() => { setSelectedMeetingId(meeting.id); setReviewFilter('pending'); }}><span className="meeting-item-icon"><Icon name="meeting" size={18} /></span><div><h3>{meeting.title}</h3><span>{formatDate(meeting.meetingDate)}<i />{meeting.suggestions.length} suggestions</span>{pending ? <em>{pending} need review</em> : <em className="all-reviewed"><Icon name="check" size={11} />All reviewed</em>}</div><Icon name="chevron" size={14} /></button>; })}</section>{selectedMeeting && <section className="meeting-detail" aria-label="Selected meeting"><div className="meeting-detail-heading"><span className="eyebrow">MEETING NOTES · {formatDate(selectedMeeting.meetingDate)}</span><h2>{selectedMeeting.title}</h2><button className="text-button" onClick={() => showSource(selectedMeeting.id, 1)}><Icon name="source" size={15} />View original notes</button></div><div className="review-tabs" role="group" aria-label="Suggestion filter"><button aria-pressed={reviewFilter === 'pending'} onClick={() => setReviewFilter('pending')}>Needs review<span>{selectedMeeting.suggestions.filter((suggestion) => suggestion.reviewState === 'PENDING').length}</span></button><button aria-pressed={reviewFilter === 'all'} onClick={() => setReviewFilter('all')}>All suggestions<span>{selectedMeeting.suggestions.length}</span></button></div><div className="review-list">{selectedMeeting.suggestions.filter((suggestion) => reviewFilter === 'all' || suggestion.reviewState === 'PENDING').map((suggestion) => suggestion.reviewState === 'PENDING' ? <ReviewCard key={suggestion.id} suggestion={suggestion} onReview={reviewSuggestion} onSource={() => showSource(selectedMeeting.id, suggestion.sourceLine)} /> : <article className="reviewed-card" key={suggestion.id}><div><span className={`review-state ${suggestion.reviewState.toLowerCase()}`}><Icon name={suggestion.reviewState === 'ACCEPTED' ? 'check' : 'close'} size={13} />{suggestion.reviewState.toLowerCase()}</span><span className="reviewed-kind">{suggestion.kind.toLowerCase()}</span></div><h3>{suggestion.title}</h3><button className="source-link" onClick={() => showSource(selectedMeeting.id, suggestion.sourceLine)} aria-label={`View source for ${suggestion.title}`}><Icon name="source" size={14} />Line {suggestion.sourceLine} · original note</button></article>)}{!selectedMeeting.suggestions.length ? <EmptyState title="The notes are here. The next step is yours." icon="board">No uppercase ACTION or DECISION lines were found. Import a new meeting with explicit markers to create reviewable suggestions.</EmptyState> : reviewFilter === 'pending' && !selectedMeeting.suggestions.some((suggestion) => suggestion.reviewState === 'PENDING') && <EmptyState title="A little clarity. All caught up." icon="decision" action={<button className="button secondary" onClick={() => navigate('overview')}>Back to the board<Icon name="arrow" size={15} /></button>}>Every suggestion from this meeting has been reviewed. Your accepted actions are on the board.</EmptyState>}</div></section>}</div>}
          </>}
          {view === 'decisions' && <>
            <div className="decisions-heading"><div><span className="eyebrow">THE DECISION LOG</span><h2>{decisionEntries.length} agreed direction{decisionEntries.length === 1 ? '' : 's'}. All with context.</h2></div><div className="search-field"><Icon name="search" size={17} /><input type="search" aria-label="Search decisions" placeholder="Find a decision…" value={decisionSearch} onChange={(event) => setDecisionSearch(event.target.value)} /></div></div>
            {!visibleDecisions.length ? <EmptyState title={decisionEntries.length ? 'No decisions match that search.' : 'The why belongs here.'} icon={decisionEntries.length ? 'search' : 'decision'} action={decisionEntries.length ? <button className="button secondary" onClick={() => setDecisionSearch('')}>Clear search</button> : <button className="button primary" onClick={() => navigate('meetings')}>Review meeting suggestions<Icon name="arrow" size={15} /></button>}>{decisionEntries.length ? 'Try a word from the decision or its meeting title.' : 'Approve a decision from your meeting inbox to keep a clear record of what your team agreed.'}</EmptyState> : <div className="decision-list">{visibleDecisions.map(({ meeting, suggestion }, index) => <article className="decision-card" key={suggestion.id}><div className="decision-number">{String(index + 1).padStart(2, '0')}</div><div className="decision-body"><span className="kind-label decision-kind"><Icon name="decision" size={13} />APPROVED DECISION</span><h3>{suggestion.title}</h3><p>{meeting.title}<span>·</span>{formatDate(meeting.meetingDate, true)}</p></div><button className="button secondary small" onClick={() => showSource(meeting.id, suggestion.sourceLine)} aria-label={`View source for ${suggestion.title}`}><Icon name="source" size={15} />View source</button></article>)}</div>}
            <div className="quiet-note"><Icon name="info" size={17} /><p>Decisions appear here only after a person approves them. Original notes are preserved, even when a suggestion is edited.</p></div>
          </>}
          {view === 'insights' && <>
            <div className="insights-date"><span className="tiny-dot teal" />Workspace snapshot · {formatDate(metrics!.asOf, true)} · UTC</div>
            <div className="insights-grid"><section className="insight-card progress-insight"><span className="eyebrow">ACTIONS COMPLETED</span><div className="big-percentage">{metrics!.completionRate}<span>%</span></div><div className="insight-track"><span style={{ width: `${metrics!.completionRate}%` }} /></div><h2>{metrics!.doneTasks} of {metrics!.totalTasks} actions, followed through.</h2><p>Completed actions ÷ all accepted actions. Every accepted action counts once, including those without a due date.</p></section><section className="insight-card review-insight"><span className="eyebrow">SUGGESTIONS REVIEWED</span><div className="big-percentage">{metrics!.reviewRate}<span>%</span></div><div className="insight-track"><span style={{ width: `${metrics!.reviewRate}%` }} /></div><h2>{metrics!.pendingSuggestions} still need a person.</h2><p>Accepted and rejected suggestions ÷ all extracted suggestions. A review means a choice, whichever way it goes.</p></section></div>
            <div className="insights-bottom"><section className="status-breakdown"><div className="section-heading"><h2>Where the work stands</h2><span className="subtle-count">{metrics!.totalTasks} actions</span></div>{statuses.map((status) => { const count = data.tasks.filter((task) => task.status === status.id).length; return <div className="breakdown-row" key={status.id}><span><span className={`tiny-dot ${status.id === 'DONE' ? 'teal' : status.id === 'IN_PROGRESS' ? 'amber' : 'gray'}`} />{status.label}</span><div className="breakdown-track"><span style={{ width: `${metrics!.totalTasks ? count / metrics!.totalTasks * 100 : 0}%` }} /></div><strong>{count}</strong></div>; })}<div className="overdue-summary"><Icon name="clock" size={17} /><p><strong>{metrics!.overdueTasks} overdue action{metrics!.overdueTasks === 1 ? '' : 's'}</strong><span>Due before today and still open. Due today is not overdue.</span></p><button className="text-button" onClick={() => { setDue('overdue'); setOwner('all'); setStatus('all'); setSearch(''); navigate('overview'); }}>View<Icon name="arrow" size={14} /></button></div></section><section className="measurement-note"><Icon name="source" size={25} /><h2>Honest by design.</h2><p>These numbers describe this workspace, not your team’s worth. They come straight from accepted actions and reviewed suggestions.</p><dl><div><dt>Meetings captured</dt><dd>{metrics!.meetingsCount}</dd></div><div><dt>Approved decisions</dt><dd>{decisionEntries.length}</dd></div><div><dt>Source-linked actions</dt><dd>{metrics!.totalTasks}</dd></div></dl></section></div>
          </>}
          <footer className="workspace-footer"><span>Conversations become commitments. People make the call.</span><div>{demo ? <><span>Synthetic sample data</span><button onClick={() => setResetOpen(true)} className="text-button">Reset demo</button></> : <><span>Anonymous, session-based workspace</span><button onClick={() => void refresh()} className="text-button"><Icon name="refresh" size={12} />Refresh</button></>}</div></footer>
        </>}
      </main>
    </div>
    {notice && <div className="toast" role="status"><span className="toast-check"><Icon name="check" size={15} /></span><p>{notice}</p><button onClick={() => setNotice('')} className="icon-button" aria-label="Dismiss notification"><Icon name="close" size={15} /></button></div>}
    {importOpen && <ImportDialog onClose={() => setImportOpen(false)} onImport={importMeeting} />}
    {source && sourceMeeting && <Modal title="Back to the source" onClose={() => setSource(null)} drawer><div className="source-meeting"><span className="eyebrow">ORIGINAL MEETING NOTES</span><h3>{sourceMeeting.title}</h3><p>{formatDate(sourceMeeting.meetingDate, true)}<span>·</span>Line {source.line}</p></div><p className="source-explanation">The original note stays exactly as it was written. The highlighted line is where this item began.</p><div className="source-lines" aria-label="Original meeting notes">{splitLines(sourceMeeting.notes).map((line, index) => <div key={index} className={`source-line ${index + 1 === source.line ? 'highlighted' : ''}`} ref={(node) => { if (node && index + 1 === source.line) node.scrollIntoView?.({ block: 'center' }); }}><span className="line-number" aria-hidden="true">{index + 1}</span><span>{line || '\u00a0'}</span></div>)}</div><div className="source-footer"><Icon name="source" size={15} />Source is preserved through review and status changes.</div></Modal>}
    {resetOpen && <Modal title="A fresh start?" onClose={() => setResetOpen(false)}><p className="modal-description">This removes the meetings, reviews, and tasks saved by this demo in your browser and loads fresh synthetic samples. Export anything you want to keep first.</p><div className="reset-actions"><button className="button secondary" onClick={() => setResetOpen(false)}>Keep my work</button><button className="button primary" onClick={() => { try { resetDemoStorage(); window.location.reload(); } catch (error) { setError(errorMessage(error)); setResetOpen(false); } }}>Reset browser demo</button></div></Modal>}
  </div>;
}
