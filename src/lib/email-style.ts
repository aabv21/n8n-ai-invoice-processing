// The daily summary's inline CSS, one string per element. Mail clients drop <style> blocks, so
// every rule is inlined; the palette is neutral greys with amber for "needs attention" and red
// for "stuck", and no rule depends on color alone (every highlighted cell also carries a label).
const TH = 'text-align:left;padding:8px;border-bottom:2px solid #d9e2ec;font-weight:600;';
const TD = 'padding:8px;border-bottom:1px solid #e4e7eb;vertical-align:top;';

export const STYLE = {
  wrapper: "max-width:640px;margin:0 auto;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2933;",
  h1: 'font-size:20px;margin:0 0 4px;',
  dateLine: 'margin:0 0 16px;color:#52606d;',
  h2: 'font-size:16px;margin:24px 0 8px;',
  table: 'width:100%;border-collapse:collapse;margin:0 0 8px;',
  th: TH,
  thNumber: `${TH}text-align:right;`,
  td: TD,
  tdNumber: `${TD}text-align:right;white-space:nowrap;`,
  counter: 'padding:12px 6px;border:1px solid #d9e2ec;text-align:center;width:25%;',
  counterAlert: 'padding:12px 6px;border:1px solid #f0b429;background:#fff8e1;text-align:center;width:25%;',
  counterValue: 'font-size:22px;font-weight:600;',
  counterLabel: 'color:#52606d;',
  alertBox: 'margin:16px 0;padding:12px;border:1px solid #d64545;background:#fdecea;',
  footer: 'margin-top:24px;color:#52606d;font-size:12px;',
  // The review and due lists are two-column records: the first cell takes the width, the second hugs its amount.
  tdMain: `${TD}width:100%;`,
  muted: 'color:#52606d;',
} as const;
