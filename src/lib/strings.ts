// The { en, es } message tables for the team's two emails: the daily summary (render-summary.ts)
// and the error alert (error-alert.ts). English is the source; Spanish is neutral Latin American
// in a Colombian business register (usted, correct accents and ¿/¡). To add a language, see the
// README's "Team email language".
import type { ReviewReason } from './invoice.ts';

/** Each review reason in words, so the team never reads an internal code. The type forces every reason. */
export const REASON_LABELS: Record<'en' | 'es', Record<ReviewReason, string>> = {
  en: {
    unparseable_reply: 'Unreadable model reply',
    reply_truncated: 'Model reply cut off',
    model_refused: 'The model declined to read it',
    invalid_issue_date: 'Invalid issue date',
    invalid_due_date: 'Invalid due date',
    invalid_currency: 'Unsupported currency',
    missing_supplier: 'Missing supplier',
    missing_supplier_tax_id: 'Missing supplier NIT',
    missing_invoice_number: 'Missing invoice number',
    missing_issue_date: 'Missing issue date',
    missing_currency: 'Missing currency',
    missing_subtotal: 'Missing subtotal',
    missing_tax: 'Missing tax',
    missing_total: 'Missing total',
    due_before_issue: 'Due before its issue date',
    issue_date_in_future: 'Issue date in the future',
    totals_mismatch: "Subtotal plus tax doesn't match the total",
    line_items_mismatch: "Lines don't add up to the subtotal",
    line_items_incomplete: 'Line items incomplete',
    non_positive_total: 'Total is zero or negative',
    amount_out_of_range: 'Amount out of range',
    supplier_is_buyer: "Supplier NIT is Magdaport's own",
    low_confidence: 'Low reading confidence',
    too_many_pages: 'Too many pages',
    too_much_text: 'Too much text',
    ai_budget_exceeded: 'Daily AI budget reached',
    unreadable_pdf: "The PDF can't be read",
  },
  es: {
    unparseable_reply: 'Respuesta del modelo ilegible',
    reply_truncated: 'Respuesta del modelo incompleta',
    model_refused: 'El modelo se negó a leerla',
    invalid_issue_date: 'Fecha de emisión no válida',
    invalid_due_date: 'Fecha de vencimiento no válida',
    invalid_currency: 'Moneda no admitida',
    missing_supplier: 'Falta el proveedor',
    missing_supplier_tax_id: 'Falta el NIT del proveedor',
    missing_invoice_number: 'Falta el número de factura',
    missing_issue_date: 'Falta la fecha de emisión',
    missing_currency: 'Falta la moneda',
    missing_subtotal: 'Falta el subtotal',
    missing_tax: 'Falta el impuesto',
    missing_total: 'Falta el total',
    due_before_issue: 'Vence antes de su emisión',
    issue_date_in_future: 'Fecha de emisión futura',
    totals_mismatch: 'Subtotal más impuesto no coincide con el total',
    line_items_mismatch: 'Las líneas no suman el subtotal',
    line_items_incomplete: 'Líneas incompletas',
    non_positive_total: 'Total en cero o negativo',
    amount_out_of_range: 'Monto fuera de rango',
    supplier_is_buyer: 'El NIT del proveedor es el de Magdaport',
    low_confidence: 'Lectura poco confiable',
    too_many_pages: 'Demasiadas páginas',
    too_much_text: 'Demasiado texto',
    ai_budget_exceeded: 'Se alcanzó el presupuesto diario de IA',
    unreadable_pdf: 'PDF ilegible',
  },
};

/** The label for `reason`, or the raw code for one this version doesn't know (an older row). */
export function reasonLabel(reason: string, locale: 'en' | 'es'): string {
  // eslint-disable-next-line security/detect-object-injection -- locale is typed to REASON_LABELS's own two keys, not user input
  const labels: Record<string, string> = REASON_LABELS[locale];
  // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn on this module's own table
  return Object.hasOwn(labels, reason) ? (labels[reason] ?? reason) : reason;
}

/** The invoice status in words; the same words as the Gmail labels. */
export const STATUS_LABELS: Record<'en' | 'es', Record<'ok' | 'review', string>> = {
  en: { ok: 'Processed', review: 'To review' },
  es: { ok: 'Procesada', review: 'Por revisar' },
};

interface SummaryStrings {
  title: string;
  /** "{title}, {long date}: {n} {subjectArrived}, {m} {subjectReview}": lowercase nouns, unlike the section labels. */
  subjectArrived: string;
  subjectReview: string;
  arrived: string;
  ok: string;
  review: string;
  duplicates: string;
  /** The line under the counters naming the window's estimated AI cost. */
  aiCost: string;
  unfinishedOne: string;
  unfinishedMany: string;
  /** Under the unfinished list when it's capped: "{count}" is how many stuck events it leaves out. */
  unfinishedMore: string;
  unfinishedColumns: { file: string; received: string; eventId: string };
  emptyDay: string;
  /** Over the stuck-events table. */
  unfinishedHeading: string;
  totalsHeading: string;
  reviewHeading: string;
  dueHeading: string;
  none: string;
  pdfLink: string;
  /** A PDF link in a row with an invoice number: "{number}" is the number, so each link has its own accessible name. */
  pdfLinkNumbered: string;
  stuckOne: string;
  stuckMany: string;
  reviewNone: string;
  footer: string;
  totalsColumns: { supplier: string; invoices: string; total: string };
  reviewColumns: { supplier: string; invoiceNumber: string; total: string };
  dueColumns: { supplier: string; invoiceNumber: string; due: string; total: string };
}

export const SUMMARY_STRINGS: Record<'en' | 'es', SummaryStrings> = {
  en: {
    title: 'Magdaport invoices',
    subjectArrived: 'arrived',
    subjectReview: 'to review',
    arrived: 'Arrived',
    ok: 'Processed',
    review: 'Review',
    duplicates: 'Duplicates',
    aiCost: 'Estimated AI cost',
    unfinishedOne: '1 invoice did not finish processing. Open n8n\'s failed executions, fix the cause, and retry them.',
    unfinishedMany: '{count} invoices did not finish processing. Open n8n\'s failed executions, fix the cause, and retry them.',
    unfinishedMore: '{count} more not shown.',
    unfinishedColumns: { file: 'File', received: 'Received (Bogota)', eventId: 'Event ID' },
    emptyDay: 'No invoices arrived in the last 24 hours.',
    unfinishedHeading: 'Stuck invoices',
    totalsHeading: 'Totals by supplier',
    reviewHeading: 'Invoices to review',
    dueHeading: 'Due in the next 7 days',
    none: 'None.',
    pdfLink: 'PDF',
    pdfLinkNumbered: 'PDF, No. {number}',
    stuckOne: 'stuck',
    stuckMany: 'stuck',
    reviewNone: 'Nothing needs review.',
    footer: 'This report covers the 24 hours before it was generated.',
    totalsColumns: { supplier: 'Supplier', invoices: 'Invoices', total: 'Total' },
    reviewColumns: { supplier: 'Supplier', invoiceNumber: 'Invoice number', total: 'Total' },
    dueColumns: { supplier: 'Supplier', invoiceNumber: 'Invoice number', due: 'Due', total: 'Total' },
  },
  es: {
    title: 'Facturas Magdaport',
    subjectArrived: 'recibidas',
    subjectReview: 'por revisar',
    arrived: 'Recibidas',
    ok: 'Procesadas',
    review: 'Por revisar',
    duplicates: 'Duplicadas',
    aiCost: 'Costo estimado de IA',
    unfinishedOne: 'Una factura no terminó de procesarse. Abra las ejecuciones fallidas en n8n, corrija la causa y reinténtelas.',
    unfinishedMany: '{count} facturas no terminaron de procesarse. Abra las ejecuciones fallidas en n8n, corrija la causa y reinténtelas.',
    unfinishedMore: '{count} más sin mostrar.',
    unfinishedColumns: { file: 'Archivo', received: 'Recibido (Bogotá)', eventId: 'ID del evento' },
    emptyDay: 'No llegaron facturas en las últimas 24 horas.',
    unfinishedHeading: 'Facturas atascadas',
    totalsHeading: 'Totales por proveedor',
    reviewHeading: 'Facturas por revisar',
    dueHeading: 'Vencen en los próximos 7 días',
    none: 'Ninguna.',
    pdfLink: 'PDF',
    pdfLinkNumbered: 'PDF, N.º {number}',
    stuckOne: 'atascada',
    stuckMany: 'atascadas',
    reviewNone: 'No hay facturas por revisar.',
    footer: 'Este informe cubre las 24 horas anteriores a su generación.',
    totalsColumns: { supplier: 'Proveedor', invoices: 'Facturas', total: 'Total' },
    reviewColumns: { supplier: 'Proveedor', invoiceNumber: 'N.º de factura', total: 'Total' },
    dueColumns: { supplier: 'Proveedor', invoiceNumber: 'N.º de factura', due: 'Vence', total: 'Total' },
  },
};

interface ErrorAlertStrings {
  subjectPrefix: string;
  /** The next step, on line 2 right under the execution link. */
  action: string;
  failedNode: string;
  error: string;
  execution: string;
  time: string;
}

export const ERROR_ALERT_STRINGS: Record<'en' | 'es', ErrorAlertStrings> = {
  en: {
    subjectPrefix: '[Magdaport] Workflow failed:',
    action: 'Open the execution, fix the cause, then retry it.',
    failedNode: 'Failed node',
    error: 'Error',
    execution: 'Execution',
    time: 'Time',
  },
  es: {
    subjectPrefix: '[Magdaport] Falló el flujo:',
    action: 'Abra la ejecución, corrija la causa y reinténtela.',
    failedNode: 'Nodo fallido',
    error: 'Error',
    execution: 'Ejecución',
    time: 'Hora',
  },
};

interface ApprovalStrings {
  /** "{reasons}" is the reasons' labels joined with "; ". */
  rejected: string;
  badId: string;
  badApprover: string;
  duplicate_key: string;
  not_in_review: string;
  not_found: string;
  row_mismatch: string;
}

/** The note written to `approval_note` when a reviewer's approval is refused. */
export const APPROVAL_STRINGS: Record<'en' | 'es', ApprovalStrings> = {
  en: {
    rejected: 'Not approved: {reasons}. Fix the cells and keep your name in approved_by.',
    badId: 'Not approved: invoice_id must be the number this pipeline wrote.',
    badApprover: 'Not approved: write your name, up to 100 characters, in approved_by.',
    duplicate_key: 'Not approved: another invoice already has this supplier NIT and invoice number.',
    not_in_review: 'Not approved: this invoice is not in review.',
    not_found: 'Not approved: no saved invoice has this invoice_id.',
    row_mismatch: "Not approved: invoice_id and email_id don't belong to the same invoice. Don't edit those two columns.",
  },
  es: {
    rejected: 'No se aprobó: {reasons}. Corrija las celdas y deje su nombre en approved_by.',
    badId: 'No se aprobó: invoice_id debe ser el número que escribió el sistema.',
    badApprover: 'No se aprobó: escriba su nombre, de hasta 100 caracteres, en approved_by.',
    duplicate_key: 'No se aprobó: otra factura ya tiene este NIT de proveedor y número de factura.',
    not_in_review: 'No se aprobó: esta factura no está en revisión.',
    not_found: 'No se aprobó: ninguna factura guardada tiene este invoice_id.',
    row_mismatch: 'No se aprobó: invoice_id y email_id no corresponden a la misma factura. No edite esas dos columnas.',
  },
};
