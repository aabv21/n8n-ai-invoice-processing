import { describe, expect, test } from 'vitest';
import { nodeOf, workflowFile } from '../helpers/workflow-file.ts';
import { runGeneratedItem } from '../helpers/run-generated.ts';
import { run, type AttachmentItem } from '../../src/nodes/mark-as-pdf.ts';

// Each case runs on the TypeScript source and on the jsCode generated into intake-email, so the
// per-item wrapper is covered too.
const generated = String(nodeOf(workflowFile('intake-email.json'), 'Mark as PDF').parameters.jsCode);
const variants: [string, (item: AttachmentItem) => unknown][] = [
  ['source', run],
  ['generated', (item) => runGeneratedItem(generated, item)],
];

const octetItem = (): AttachmentItem => ({
  json: { event_id: 'm1:attachment_0', binary_key: 'attachment_0', file_name: 'invoice.pdf', mime_type: 'application/octet-stream' },
  binary: {
    attachment_0: {
      id: 'filesystem-v2:workflows/1/executions/2/binary_data/abc', fileName: 'invoice.pdf', fileSize: '43 kB',
      fileExtension: 'pdf', mimeType: 'application/octet-stream',
    },
  },
});

describe.each(variants)('Mark as PDF (%s)', (_label, mark) => {
  test('relabels an octet-stream attachment as application/pdf and keeps its data reference', () => {
    const out = mark(octetItem()) as AttachmentItem;
    expect(out.json).toEqual({ ...octetItem().json, mime_type: 'application/pdf' });
    expect(out.binary.attachment_0).toEqual({ ...octetItem().binary.attachment_0, mimeType: 'application/pdf' });
  });
  test("leaves the item's other binaries untouched", () => {
    const item = octetItem();
    item.binary.attachment_1 = { id: 'other', fileName: 'notes.txt', mimeType: 'text/plain' };
    const out = mark(item) as AttachmentItem;
    expect(out.binary.attachment_1).toEqual({ id: 'other', fileName: 'notes.txt', mimeType: 'text/plain' });
  });
  test('a PDF already typed application/pdf passes through unchanged', () => {
    const item = octetItem();
    item.json.mime_type = 'application/pdf';
    item.binary.attachment_0!.mimeType = 'application/pdf';
    expect(mark(structuredClone(item))).toEqual(item);
  });
  test('a missing binary fails loudly', () => {
    const item = octetItem();
    item.json.binary_key = 'attachment_9';
    expect(() => mark(item)).toThrow('Mark as PDF: binary attachment_9 is missing');
  });
});
