// Relabels one attachment as application/pdf before process-invoice files it. Gmail can deliver a
// PDF as application/octet-stream, which Keep PDFs lets through by its .pdf name, and Drive would
// then store it with that generic type. Only an attachment Gmail typed application/octet-stream is
// relabeled; any other type passes through, so a non-PDF named .pdf keeps its type and fails
// Extract text as unreadable_pdf. Only the MIME type changes: the binary's data reference, name,
// and size, and every other binary on the item, pass through as they are. Pure: no I/O, no clock.
// Runs once for each item.

const PDF = 'application/pdf';
const GENERIC = 'application/octet-stream';

export interface BinaryEntry {
  mimeType: string;
  fileName?: string;
  [key: string]: unknown;
}

export interface AttachmentItem {
  json: { binary_key: string; mime_type: string; [key: string]: unknown };
  binary: Record<string, BinaryEntry>;
}

export function run(item: AttachmentItem): AttachmentItem {
  const key = item.json.binary_key;
  const entry = Object.hasOwn(item.binary, key)
    // eslint-disable-next-line security/detect-object-injection -- key is the item's own binary key, set by Describe attachment and checked with hasOwn
    ? item.binary[key]
    : undefined;
  if (!entry) throw new Error(`Mark as PDF: binary ${key} is missing`);
  if (entry.mimeType !== GENERIC) return item;
  return {
    json: { ...item.json, mime_type: PDF },
    binary: { ...item.binary, [key]: { ...entry, mimeType: PDF } },
  };
}
