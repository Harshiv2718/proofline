import { useState, type FormEvent } from 'react';
import { type ImportInput, today } from '../data/domain';
import { validateImport } from '../data/demo';
import { Icon } from './Icon';
import { Modal } from './Modal';

export function ImportDialog({ onClose, onImport }: { onClose: () => void; onImport: (input: ImportInput) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const input = { title, meetingDate: date, notes };
      validateImport(input);
      setBusy(true);
      await onImport(input);
    } catch (error) { setError(error instanceof Error ? error.message : 'The meeting could not be imported. Please try again.'); }
    finally { setBusy(false); }
  }
  function example() {
    setTitle('Pilot team · Weekly check-in');
    setDate(today());
    setNotes(`Synthetic sample notes — replace these with your own.\nWe reviewed feedback from our first pilot group.\nACTION [Maya Chen] Share the pilot feedback summary | due:${today()}\nACTION [Owen Park] Check the export accessibility\nDECISION: Keep the next pilot group to ten teams\nThe next check-in will focus on what we learned.`);
    setError('');
  }
  return <Modal title="Import a meeting" onClose={busy ? () => {} : onClose} wide>
    <p className="modal-description">Bring the conversation. We’ll help you find the next steps.</p>
    <div className="method-note"><Icon name="source" /><p><strong>Explicit markers, human judgment.</strong> A deterministic parser finds lines marked <code>ACTION</code> or <code>DECISION</code>. You review every suggestion before it becomes work.</p></div>
    <form onSubmit={submit} className="import-form">
      <div className="form-row"><label>Meeting title<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={160} placeholder="e.g. Product sync · November 6" /></label><label className="date-field">Meeting date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label></div>
      <div className="notes-label"><label htmlFor="meeting-notes">Meeting notes</label><button type="button" className="text-button" onClick={example} disabled={busy}>Use example notes <Icon name="arrow" size={14} /></button></div>
      <textarea id="meeting-notes" value={notes} onChange={(event) => setNotes(event.target.value)} required maxLength={20000} rows={10} placeholder={'A little context from your meeting…\n\nACTION [Maya] Share the prototype | due:2026-11-12\nACTION: Follow up with the pilot team\nDECISION: Start with a small pilot'} aria-describedby="notes-help" />
      <div className="field-help" id="notes-help"><span>Uppercase markers · optional owner · dates as YYYY-MM-DD</span><span>{notes.length.toLocaleString()} / 20,000</span></div>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="modal-footer"><span><Icon name="info" size={15} /> Suggestions stay in review until you approve.</span><button className="button primary" type="submit" disabled={busy}>{busy ? 'Finding suggestions…' : 'Find suggestions'}<Icon name="arrow" size={17} /></button></div>
    </form>
  </Modal>;
}
