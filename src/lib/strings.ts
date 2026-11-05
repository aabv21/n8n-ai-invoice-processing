// The { en, es } message tables for the team's two emails: the daily summary (render-summary.ts)
// and the error alert (error-alert.ts). English is the source; Spanish is neutral Latin American
// in a Colombian business register (usted, correct accents and ¿/¡). To add a language, see the
// README's "Team email language".

export interface SummaryStrings {
  title: string;
  /** "{title} {date}: {n} {subjectArrived}, {m} {subjectReview}": lowercase nouns, unlike the section labels. */
  subjectArrived: string;
  subjectReview: string;
  arrived: string;
  ok: string;
  review: string;
  duplicates: string;
  unfinishedOne: string;
  unfinishedMany: string;
  emptyDay: string;
  totalsHeading: string;
  reviewHeading: string;
  dueHeading: string;
  none: string;
  pdfLink: string;
  totalsColumns: { supplier: string; currency: string; invoices: string; total: string };
  reviewColumns: { supplier: string; invoiceNumber: string; total: string; reasons: string };
  dueColumns: { supplier: string; invoiceNumber: string; due: string; total: string; status: string };
}

export const SUMMARY_STRINGS: Record<'en' | 'es', SummaryStrings> = {
  en: {
    title: 'Magdaport invoices',
    subjectArrived: 'arrived',
    subjectReview: 'to review',
    arrived: 'Arrived',
    ok: 'OK',
    review: 'Review',
    duplicates: 'Duplicates',
    unfinishedOne: "1 invoice did not finish processing. See n8n's failed executions, or the README's recovery steps for stuck events.",
    unfinishedMany: "{count} invoices did not finish processing. See n8n's failed executions, or the README's recovery steps for stuck events.",
    emptyDay: 'No invoices arrived in the last 24 hours.',
    totalsHeading: 'Totals by supplier',
    reviewHeading: 'Review items',
    dueHeading: 'Due in the next 7 days',
    none: 'None.',
    pdfLink: 'PDF',
    totalsColumns: { supplier: 'Supplier', currency: 'Currency', invoices: 'Invoices', total: 'Total' },
    reviewColumns: { supplier: 'Supplier', invoiceNumber: 'Invoice #', total: 'Total', reasons: 'Reasons' },
    dueColumns: { supplier: 'Supplier', invoiceNumber: 'Invoice #', due: 'Due', total: 'Total', status: 'Status' },
  },
  es: {
    title: 'Facturas Magdaport',
    subjectArrived: 'recibidas',
    subjectReview: 'por revisar',
    arrived: 'Recibidas',
    ok: 'OK',
    review: 'Por revisar',
    duplicates: 'Duplicadas',
    unfinishedOne: 'Una factura no terminó de procesarse. Consulte las ejecuciones fallidas de n8n o los pasos de recuperación del README para eventos pendientes.',
    unfinishedMany: '{count} facturas no terminaron de procesarse. Consulte las ejecuciones fallidas de n8n o los pasos de recuperación del README para eventos pendientes.',
    emptyDay: 'No llegaron facturas en las últimas 24 horas.',
    totalsHeading: 'Totales por proveedor',
    reviewHeading: 'Elementos por revisar',
    dueHeading: 'Vencen en los próximos 7 días',
    none: 'Ninguna.',
    pdfLink: 'PDF',
    totalsColumns: { supplier: 'Proveedor', currency: 'Moneda', invoices: 'Facturas', total: 'Total' },
    reviewColumns: { supplier: 'Proveedor', invoiceNumber: 'N.º de factura', total: 'Total', reasons: 'Motivos' },
    dueColumns: { supplier: 'Proveedor', invoiceNumber: 'N.º de factura', due: 'Vence', total: 'Total', status: 'Estado' },
  },
};

export interface ErrorAlertStrings {
  subjectPrefix: string;
  failedNode: string;
  error: string;
  execution: string;
  time: string;
}

export const ERROR_ALERT_STRINGS: Record<'en' | 'es', ErrorAlertStrings> = {
  en: {
    subjectPrefix: '[Magdaport demo] Workflow failed:',
    failedNode: 'Failed node',
    error: 'Error',
    execution: 'Execution',
    time: 'Time',
  },
  es: {
    subjectPrefix: '[Demo Magdaport] Falló el flujo:',
    failedNode: 'Nodo fallido',
    error: 'Error',
    execution: 'Ejecución',
    time: 'Hora',
  },
};
