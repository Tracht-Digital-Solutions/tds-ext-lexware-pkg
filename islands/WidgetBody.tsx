import { SummaryMetric } from "@tracht-digital-solutions/tds-shared/components";

interface Summary {
  configured: boolean;
  invoiceCount: number;
}

/**
 * Lexware widget body — the number of invoices exported to Lexware, and
 * whether the integration is configured at all.
 */
export default function WidgetBody() {
  return (
    <SummaryMetric<Summary>
      endpoint="/lexware/summary"
      value={(d) => d.invoiceCount}
      caption={(d) => (d.configured ? "Rechnungen an Lexware" : "Lexware nicht konfiguriert")}
    />
  );
}
