import { useState, type FormEvent } from 'react';
import { type ReviewInput, type Suggestion } from '../data/domain';
import { Icon } from './Icon';

export function ReviewCard({ suggestion, onReview, onSource }: { suggestion: Suggestion; onReview: (input: ReviewInput) => Promise<void>; onSource: () => void }) {
  const [title, setTitle] = useState(suggestion.title);
  const [owner, setOwner] = useState(suggestion.owner);
  const [dueDate, setDueDate] = useState(suggestion.dueDate || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function review(decision: ReviewInput['decision']) {
    setError('');
    setBusy(true);
    try { await onReview({ id: suggestion.id, decision, title, owner, dueDate: dueDate || null }); }
    catch (error) { setError(error instanceof Error ? error.message : 'The suggestion could not be saved. Please try again.'); }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent) { event.preventDefault(); await review('ACCEPT'); }
  const isAction = suggestion.kind === 'ACTION';
  return <form aria-label={`Review ${suggestion.title}`} onSubmit={submit} className="review-card">
    <div className="review-card-top"><span className={`kind-label ${isAction ? 'action-kind' : 'decision-kind'}`}><Icon name={isAction ? 'arrow' : 'decision'} size={13} />{isAction ? 'ACTION' : 'DECISION'}</span><button type="button" className="source-link" aria-label={`View source for ${suggestion.title}`} onClick={onSource}><Icon name="source" size={14} />Line {suggestion.sourceLine}</button></div>
    <label className="sr-only" htmlFor={`title-${suggestion.id}`}>Suggestion title</label><input className="suggestion-title" id={`title-${suggestion.id}`} value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={160} disabled={busy} />
    <blockquote>{suggestion.sourceQuote}</blockquote>
    {isAction && <div className="form-row review-fields"><label>Owner<input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="Unassigned" maxLength={80} disabled={busy} /></label><label>Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} disabled={busy} /></label></div>}
    {!isAction && <p className="field-help">An approved decision joins the decision log. It won’t create a task.</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="review-actions"><button type="button" className="button subtle" onClick={() => void review('REJECT')} disabled={busy}>Reject suggestion</button><button className="button primary small" type="submit" disabled={busy}><Icon name="check" size={16} />{busy ? 'Saving…' : isAction ? 'Accept action' : 'Accept decision'}</button></div>
  </form>;
}
