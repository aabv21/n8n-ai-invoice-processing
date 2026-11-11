// Validates the config just loaded from /files/config/config.json: a bad value fails loudly here,
// before any node downstream reads it or an AI call runs. Pure: no I/O, no clock.
import { isPlainObject } from './util.ts';

export interface Config {
  team_email: string;
  /** The language the team's own emails (the daily summary and the error alert) render in. Missing means 'en'. */
  team_locale: 'en' | 'es';
  gmail: {
    label_ids: {
      processed: string;
      review: string;
      duplicate: string;
    };
  };
  google: {
    drive_root_folder_id: string;
    spreadsheet_id: string;
    invoices_tab: string;
    items_tab: string;
  };
  ai: {
    default_model: string;
    retry_model?: string;
    effort: 'low' | 'medium' | 'high';
  };
  extraction: {
    min_text_chars_per_page: number;
    max_pages: number;
    max_text_chars: number;
  };
  validation: {
    totals_tolerance: number;
    min_confidence: number;
  };
}

/** The value `config/config.example.json` ships in every key an operator must fill in. */
export const CONFIG_PLACEHOLDER = 'REPLACE_ME';

/** Throws on the first string, depth-first in key order, that is still the example's placeholder. */
function rejectPlaceholders(value: unknown, path: string): void {
  if (typeof value === 'string') {
    if (value.trim() === CONFIG_PLACEHOLDER) {
      throw new Error(`${path} is still the ${CONFIG_PLACEHOLDER} placeholder; fill it in config/config.json`);
    }
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      rejectPlaceholders(entry, `${path}[${String(index)}]`);
    });
  } else if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) rejectPlaceholders(entry, `${path}.${key}`);
  }
}

const LABEL_ID_KEYS = ['processed', 'review', 'duplicate'] as const;
const GOOGLE_KEYS = ['drive_root_folder_id', 'spreadsheet_id', 'invoices_tab', 'items_tab'] as const;
const EXTRACTION_KEYS = ['min_text_chars_per_page', 'max_pages', 'max_text_chars'] as const;
const EFFORT_VALUES = ['low', 'medium', 'high'] as const;
const TEAM_LOCALE_VALUES = ['en', 'es'] as const;

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object`);
  return value;
}

function requireFiniteAtLeast(path: string, value: unknown, min: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new Error(`${path} must be a finite number >= ${String(min)}`);
  }
}

function requireNumberInRange(path: string, value: unknown, min: number, max: number): void {
  if (typeof value !== 'number' || !(value >= min && value <= max)) {
    throw new Error(`${path} must be a number between ${String(min)} and ${String(max)}`);
  }
}

function requireIntegerAtLeast(path: string, value: unknown, min: number): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new Error(`${path} must be an integer >= ${String(min)}`);
  }
}

function requireNonEmptyString(path: string, value: unknown): void {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${path} must be a non-empty string`);
  }
}

/**
 * Validates every config value a downstream node or AI call depends on, and throws a clear `Error`
 * naming the first bad key it finds. A value still set to the example's `REPLACE_ME` placeholder
 * fails first, wherever it sits, so a half-filled config never reaches Gmail, Drive, or an AI call.
 */
export function checkConfig(config: unknown): Config {
  const root = asObject(config, 'config');
  rejectPlaceholders(root, 'config');

  const validation = asObject(root.validation, 'config.validation');
  requireFiniteAtLeast('config.validation.totals_tolerance', validation.totals_tolerance, 0);
  requireNumberInRange('config.validation.min_confidence', validation.min_confidence, 0, 1);

  const extraction = asObject(root.extraction, 'config.extraction');
  for (const key of EXTRACTION_KEYS) {
    // eslint-disable-next-line security/detect-object-injection -- key is one of this module's own fixed keys, not user input
    requireIntegerAtLeast(`config.extraction.${key}`, extraction[key], 1);
  }

  const ai = asObject(root.ai, 'config.ai');
  requireNonEmptyString('config.ai.default_model', ai.default_model);
  if (typeof ai.effort !== 'string' || !EFFORT_VALUES.includes(ai.effort as (typeof EFFORT_VALUES)[number])) {
    throw new Error(`config.ai.effort must be one of ${EFFORT_VALUES.join(', ')}`);
  }
  if (ai.retry_model !== undefined && typeof ai.retry_model !== 'string') {
    throw new Error("config.ai.retry_model must be a string ('' turns the retry off)");
  }

  const gmail = asObject(root.gmail, 'config.gmail');
  const labelIds = asObject(gmail.label_ids, 'config.gmail.label_ids');
  for (const key of LABEL_ID_KEYS) {
    // eslint-disable-next-line security/detect-object-injection -- key is one of this module's own fixed keys, not user input
    requireNonEmptyString(`config.gmail.label_ids.${key}`, labelIds[key]);
  }

  const google = asObject(root.google, 'config.google');
  for (const key of GOOGLE_KEYS) {
    // eslint-disable-next-line security/detect-object-injection -- key is one of this module's own fixed keys, not user input
    requireNonEmptyString(`config.google.${key}`, google[key]);
  }

  requireNonEmptyString('config.team_email', root.team_email);

  // Missing means 'en'. team_locale is operator-set config, not inbound traffic, so there's no
  // other spelling to normalize.
  if (root.team_locale === undefined) {
    root.team_locale = 'en';
  } else if (typeof root.team_locale !== 'string' || !TEAM_LOCALE_VALUES.includes(root.team_locale as (typeof TEAM_LOCALE_VALUES)[number])) {
    throw new Error(`config.team_locale must be one of ${TEAM_LOCALE_VALUES.join(', ')}`);
  }

  return config as Config;
}
