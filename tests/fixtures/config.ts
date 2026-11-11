// The committed example config with every REPLACE_ME placeholder filled, the team address included,
// so a test starts from a config that checkConfig accepts. The example itself is rejected until an operator fills it in.
import { readFileSync } from 'node:fs';
import type { Config } from '../../src/lib/config.ts';

export function filledConfig(): Config {
  const config = JSON.parse(readFileSync('config/config.example.json', 'utf8')) as Config;
  config.team_email = 'team@example.com';
  config.gmail.label_ids = { processed: 'Label_processed_test', review: 'Label_review_test', duplicate: 'Label_duplicate_test' };
  config.google.drive_root_folder_id = 'drive-root-test';
  config.google.spreadsheet_id = 'spreadsheet-test';
  return config;
}
