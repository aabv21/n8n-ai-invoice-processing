// Renders the error handler's team alert subject and plain-text body in the language team_locale
// names. This email is plain text (platform.test.ts pins emailType: 'text'), so none of
// these values need HTML-escaping in either language - the Gmail node sends the string as-is.
// Pure: no I/O, no clock - `time` is formatted upstream (America/Bogota, via an n8n expression)
// and passed in verbatim, the same way every other value here comes from the Error Trigger.
import { ERROR_ALERT_STRINGS } from '../lib/strings.ts';

export interface ErrorAlertInput {
  /** The team's own email language; missing means 'en', the same default checkConfig applies. */
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
