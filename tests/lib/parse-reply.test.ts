import { expect, test } from 'vitest';
import { parseReply } from '../../src/lib/parse-reply.ts';

const text = (t: string, stop_reason = 'end_turn') => ({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: t }], stop_reason });

test('accepts the Information Extractor object', () =>
  expect(parseReply({ reply: { supplier: 'A' } })).toEqual({ ok: true, value: { supplier: 'A' } }));
test('reads JSON from the text blocks of a Messages API reply', () =>
  expect(parseReply(text('{"supplier":"A"}'))).toEqual({ ok: true, value: { supplier: 'A' } }));
test('strips code fences', () =>
  expect(parseReply(text('```json\n{"supplier":"A"}\n```'))).toEqual({ ok: true, value: { supplier: 'A' } }));
test('ignores prose around the object', () =>
  expect(parseReply(text('Here it is:\n{"supplier":"A"}\nThanks'))).toEqual({ ok: true, value: { supplier: 'A' } }));
test.each([['not json'], [''], ['[1,2]'], ['{"supplier":']])('rejects %j', (t) =>
  expect(parseReply(text(t))).toEqual({ ok: false, reason: 'unparseable_reply' }));
test('reports truncation before parsing', () =>
  expect(parseReply(text('{"supplier":"A"}', 'max_tokens'))).toEqual({ ok: false, reason: 'reply_truncated' }));
// A context-window overflow is truncation too, not an unparseable reply.
test('reports truncation for a context-window overflow too', () =>
  expect(parseReply(text('{"supplier":"A"}', 'model_context_window_exceeded'))).toEqual({ ok: false, reason: 'reply_truncated' }));
test('reports a refusal', () =>
  expect(parseReply(text('', 'refusal'))).toEqual({ ok: false, reason: 'model_refused' }));
test('rejects a reply that is neither object nor content', () =>
  expect(parseReply({ reply: 'text' })).toEqual({ ok: false, reason: 'unparseable_reply' }));
