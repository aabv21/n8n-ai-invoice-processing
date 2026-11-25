import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** The text layer of a PDF: each page's items joined with a space, pages joined with a newline. */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await getDocument({ data: bytes }).promise;
  const pages = await Promise.all(
    Array.from({ length: doc.numPages }, async (_, index) => {
      const content = await (await doc.getPage(index + 1)).getTextContent();
      return content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    }),
  );
  return pages.join('\n');
}
