// Renders the note for an approval the database refused, in the team_locale language. Pure: no I/O,
// no clock.
import { APPROVAL_STRINGS } from '../lib/strings.ts';

export interface ApprovalNoteInput {
  /** Missing means 'en', as in checkConfig. */
  team_locale?: 'en' | 'es';
  invoice_id: string;
  email_id: string;
  result: 'duplicate_key' | 'not_in_review' | 'not_found' | 'row_mismatch';
}

export function run(input: ApprovalNoteInput): { invoice_id: string; email_id: string; note: string } {
  const t = APPROVAL_STRINGS[input.team_locale ?? 'en'];
  return { invoice_id: input.invoice_id, email_id: input.email_id, note: t[input.result] };
}
