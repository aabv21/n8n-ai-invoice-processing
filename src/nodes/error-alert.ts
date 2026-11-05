// Renders the error handler's alert subject and body in the team_locale language. The email is
// plain text (platform.test.ts pins emailType: 'text'), so nothing needs HTML-escaping. Pure: no
// I/O, no clock; `time` arrives already formatted in America/Bogota.
import { ERROR_ALERT_STRINGS } from '../lib/strings.ts';

export interface ErrorAlertInput {
  /** Missing means 'en', as in checkConfig. */
  team_locale?: 'en' | 'es';
  workflow_name: string;
  failed_node: string;
  error_message: string;
  execution_url: string;
  time: string;
}

export interface ErrorAlertOutput {
  subject: string;
  message: string;
}

export function run(input: ErrorAlertInput): ErrorAlertOutput {
  const locale = input.team_locale ?? 'en';
  // eslint-disable-next-line security/detect-object-injection -- locale is typed to ERROR_ALERT_STRINGS's own two keys, not user input
  const t = ERROR_ALERT_STRINGS[locale];

  const subject = `${t.subjectPrefix} ${input.workflow_name}`;
  const message = [
    `${t.failedNode}: ${input.failed_node}`,
    `${t.error}: ${input.error_message}`,
    `${t.execution}: ${input.execution_url}`,
    `${t.time}: ${input.time}`,
  ].join('\n');

  return { subject, message };
}
