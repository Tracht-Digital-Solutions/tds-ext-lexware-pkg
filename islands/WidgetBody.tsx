import { useEffect, useState } from "react";
import { Skeleton } from "@tracht-digital-solutions/tds-shared/components";
import { apiFetch } from "@tracht-digital-solutions/tds-shared/api";

interface Summary {
  configured: boolean;
  invoiceCount: number;
  recent: Array<{ id: number; customer_name: string | null; created_at: string }>;
}

/**
 * Lexware widget body — shows the total invoice count exported to Lexware and
 * whether the API is configured. Same-origin fetch with credentials (the deploy
 * wires the gateway).
 */
export default function WidgetBody() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    apiFetch("/lexware/summary")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: Summary) => setData(d))
      .catch(() => setError(true));
  }, []);

  if (error) return <p className="tds-widget__metric">—</p>;
  if (!data) return <p className="tds-widget__metric" aria-busy="true"><Skeleton width="3ch" height="1.75rem" /></p>;

  return (
    <div className="tds-stack">
      <p className="tds-widget__metric">{data.invoiceCount}</p>
      <p className="marginalia">
        {data.configured ? "Rechnungen an Lexware" : "Lexware nicht konfiguriert"}
      </p>
    </div>
  );
}
