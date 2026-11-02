export interface WorkflowEntry {
  id: string;
  name: string;
  file: string;
  /** This workflow's live webhook path, when its trigger is a plain webhook — used to confirm a publish actually took effect. */
  webhookPath?: string;
}

export interface CredentialEntry {
  id: string;
  name: string;
  type: string;
  env: readonly string[];
  data: (env: Readonly<Record<string, string>>) => Record<string, unknown>;
}

export interface CodeNodeEntry {
  file: string;
  node: string;
  source: string;
  why: string;
}

export interface TextParamEntry {
  file: string;
  node: string;
  parameter: string;
  source: string;
}

export type BuildEntry = CodeNodeEntry | TextParamEntry;

export const ERROR_WORKFLOW_ID = 'mgpErrorHandler1';
export const CONFIG_LOADER_ID = 'mgpLoadConfig001';

/** `env[key]` widened past `noUncheckedIndexedAccess`; callers only reach here once the key is known to be set. */
// eslint-disable-next-line security/detect-object-injection -- key is always one of this entry's own fixed `env` names
const readEnv = (env: Readonly<Record<string, string>>, key: string): string => env[key] ?? '';

export const WORKFLOWS: readonly WorkflowEntry[] = [
  { id: CONFIG_LOADER_ID, name: 'Load config', file: 'load-config.json' },
  { id: ERROR_WORKFLOW_ID, name: 'Error handler', file: 'error-handler.json' },
  { id: 'mgpEnsureFolder1', name: 'Ensure folder', file: 'ensure-folder.json' },
  { id: 'mgpDevHarness001', name: 'Dev harness', file: 'dev-harness.json', webhookPath: 'dev' },
  { id: 'mgpExtractInv001', name: 'Extract invoice', file: 'extract-invoice.json' },
  { id: 'mgpProcessInv001', name: 'Process invoice', file: 'process-invoice.json' },
  { id: 'mgpGmailEntry001', name: 'Gmail entry', file: 'gmail-entry.json' },
  { id: 'mgpIntakeEmail01', name: 'Intake email', file: 'intake-email.json' },
  { id: 'mgpDailySummary1', name: 'Daily summary', file: 'daily-summary.json' },
];

export const CREDENTIALS: readonly CredentialEntry[] = [
  {
    // Every Postgres node connects as app_runtime, which has DML only on the tables it actually
    // touches, no DDL, and no access to the n8n database (docs/database.md). No node here issues
    // DDL on its own, so there's no second, owner-credentialed node to carve out.
    id: 'mgpCredAppDb0001',
    name: 'App DB',
    type: 'postgres',
    env: ['APP_RUNTIME_DB_USER', 'APP_RUNTIME_DB_PASSWORD'],
    data: (env) => ({
      host: 'postgres',
      port: 5432,
      database: 'app',
      user: readEnv(env, 'APP_RUNTIME_DB_USER'),
      password: readEnv(env, 'APP_RUNTIME_DB_PASSWORD'),
      ssl: 'disable',
    }),
  },
  {
    id: 'mgpCredAnthropic',
    name: 'Anthropic',
    type: 'anthropicApi',
    env: ['ANTHROPIC_API_KEY'],
    data: (env) => ({ apiKey: readEnv(env, 'ANTHROPIC_API_KEY'), url: 'https://api.anthropic.com', header: false }),
  },
  {
    id: 'mgpCredGmail0001',
    name: 'Gmail',
    type: 'gmailOAuth2',
    env: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    data: (env) => ({ clientId: readEnv(env, 'GOOGLE_OAUTH_CLIENT_ID'), clientSecret: readEnv(env, 'GOOGLE_OAUTH_CLIENT_SECRET') }),
  },
  {
    id: 'mgpCredGDrive001',
    name: 'Google Drive',
    type: 'googleDriveOAuth2Api',
    env: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    data: (env) => ({ clientId: readEnv(env, 'GOOGLE_OAUTH_CLIENT_ID'), clientSecret: readEnv(env, 'GOOGLE_OAUTH_CLIENT_SECRET') }),
  },
  {
    id: 'mgpCredGSheets01',
    name: 'Google Sheets',
    type: 'googleSheetsOAuth2Api',
    env: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    data: (env) => ({ clientId: readEnv(env, 'GOOGLE_OAUTH_CLIENT_ID'), clientSecret: readEnv(env, 'GOOGLE_OAUTH_CLIENT_SECRET') }),
  },
  {
    // The dev harness is localhost-only (no tunnel in this demo), and its workflow must be
    // unpublished before production. See AGENTS.md.
    id: 'mgpCredDevToken1',
    name: 'Dev harness token',
    type: 'httpHeaderAuth',
    env: ['DEV_HARNESS_TOKEN'],
    data: (env) => ({ name: 'X-Dev-Token', value: readEnv(env, 'DEV_HARNESS_TOKEN') }),
  },
];

export const CODE_NODES: readonly CodeNodeEntry[] = [
  {
    file: 'extract-invoice.json',
    node: 'Build PDF request',
    source: 'src/nodes/build-pdf-request.ts',
    why: 'builds a Messages API body with a PDF document block and structured output, which no native node sends',
  },
  {
    file: 'extract-invoice.json',
    node: 'Check invoice',
    source: 'src/nodes/check-invoice.ts',
    why: 'parses the model reply and applies ordered invoice rules that must yield one verdict',
  },
  {
    file: 'process-invoice.json',
    node: 'Prepare record',
    source: 'src/nodes/prepare-record.ts',
    why: 'turns every extraction outcome into one record and builds the Drive file name',
  },
  {
    file: 'intake-email.json',
    node: 'Check config',
    source: 'src/nodes/check-config.ts',
    why: 'validates the loaded config so a bad value fails loudly instead of silently disabling a check',
  },
  {
    file: 'daily-summary.json',
    node: 'Render summary',
    source: 'src/nodes/render-summary.ts',
    why: 'renders escaped HTML tables and per-currency money formats from the summary row',
  },
];

export const TEXT_PARAMS: readonly TextParamEntry[] = [
  { file: 'extract-invoice.json', node: 'Extract from text', parameter: 'inputSchema', source: 'schemas/invoice.schema.json' },
  { file: 'extract-invoice.json', node: 'Extract from text', parameter: 'options.systemPromptTemplate', source: 'prompts/extract-invoice.md' },
  { file: 'extract-invoice.json', node: 'Request settings', parameter: 'assignments:system', source: 'prompts/extract-invoice.md' },
  { file: 'extract-invoice.json', node: 'Request settings', parameter: 'assignments:schema_json', source: 'schemas/invoice.schema.json' },
  { file: 'process-invoice.json', node: 'Save invoice', parameter: 'query', source: 'db/queries/save-invoice.sql' },
  { file: 'process-invoice.json', node: 'Record duplicate', parameter: 'query', source: 'db/queries/record-outcome.sql' },
  { file: 'process-invoice.json', node: 'Save Drive link', parameter: 'query', source: 'db/queries/save-drive-link.sql' },
  { file: 'process-invoice.json', node: 'Record outcome', parameter: 'query', source: 'db/queries/record-outcome.sql' },
  { file: 'intake-email.json', node: 'Record event', parameter: 'query', source: 'db/queries/record-event.sql' },
  { file: 'daily-summary.json', node: 'Query summary', parameter: 'query', source: 'db/queries/daily-summary.sql' },
];

export const BUILD_ENTRIES: readonly BuildEntry[] = [...CODE_NODES, ...TEXT_PARAMS];
