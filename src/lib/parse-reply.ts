// Reads a model reply from either path: the Information Extractor's already-parsed `reply`
// object (text path), or a Messages API `content`/`stop_reason` pair (vision path).
import { isPlainObject } from './util.ts';

export type ParseResult = { ok: true; value: Record<string, unknown> } | { ok: false; reason: 'unparseable_reply' | 'reply_truncated' | 'model_refused' };

function joinTextBlocks(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const blocks: unknown[] = content;
  return blocks
    .filter(isPlainObject)
    .filter((block) => block.type === 'text')
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .join('');
}

/** Strips one surrounding ``` code fence (with an optional language tag), if present. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return match ? (match[1] ?? '') : trimmed;
}

/** The first `{` to the last `}`, parsed as JSON; `null` when no such slice parses to a plain object. */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const open = text.indexOf('{');
  const close = text.lastIndexOf('}');
  if (open === -1 || close === -1 || close <= open) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(open, close + 1));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseReply(input: { reply?: unknown; content?: unknown; stop_reason?: string | null }): ParseResult {
  if (input.stop_reason === 'refusal') return { ok: false, reason: 'model_refused' };
  if (input.stop_reason === 'max_tokens' || input.stop_reason === 'model_context_window_exceeded') {
    return { ok: false, reason: 'reply_truncated' };
  }

  if (isPlainObject(input.reply)) return { ok: true, value: input.reply };

  const joined = stripCodeFence(joinTextBlocks(input.content));
  const value = extractJsonObject(joined);
  return value ? { ok: true, value } : { ok: false, reason: 'unparseable_reply' };
}
