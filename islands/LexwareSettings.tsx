import { useEffect, useState } from "react";
import { Alert, Spinner } from "@tracht-digital-solutions/tds-shared/components";
import { apiFetch } from "@tracht-digital-solutions/tds-shared/api";
import { SecretField, useRuntimeSettings } from "@tracht-digital-solutions/tds-shared/admin";

const DEFAULT_URL = "https://api.lexware.io/v1";

/**
 * Lexware settings — API key + URL + default net hourly rate + tax rate,
 * persisted in the core runtime settings store (`/admin/settings/lexware`,
 * admin-only) through tds-shared `useRuntimeSettings`. The secret key comes
 * back masked (configured + last4); a blank key on save keeps the existing
 * value. The backend reads these DB-first with an env fallback. A connection
 * test hits GET /lexware/admin/test.
 */
export default function LexwareSettings() {
  const settings = useRuntimeSettings("lexware");
  const [keyInput, setKeyInput] = useState("");
  const [url, setUrl] = useState(DEFAULT_URL);
  const [rate, setRate] = useState("");
  const [tax, setTax] = useState("19");
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    setUrl(settings.value("api_url", DEFAULT_URL));
    setRate(settings.get("default_hourly_rate")?.value ?? "");
    setTax(settings.value("default_tax_rate", "19"));
  }, [settings.settings]);

  const save = async () => {
    const saved = await settings.save([
      { key: "api_key", secret: true, value: keyInput.trim() },
      { key: "api_url", value: url.trim() },
      { key: "default_hourly_rate", value: rate.trim() },
      { key: "default_tax_rate", value: tax.trim() },
    ]);
    if (saved) setKeyInput("");
  };

  const test = async () => {
    setTestResult("Teste …");
    const res = await apiFetch("/lexware/admin/test").catch(() => null);
    if (res === null) {
      // Not a verdict on Lexware: the request never got as far as our API.
      setTestResult("Fehlgeschlagen: die API ist nicht erreichbar.");
      return;
    }
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.ok) {
      setTestResult("Verbindung erfolgreich.");
    } else {
      setTestResult(`Fehlgeschlagen: ${d.error ?? `HTTP ${res.status}`}`);
    }
  };

  if (!settings.loaded) return <p><Spinner /></p>;

  return (
    <div className="lexware-settings space-y-4">
      <SecretField label="API-Key" setting={settings.get("api_key")} value={keyInput} onChange={setKeyInput} placeholder="Neuen Schlüssel setzen (leer = behalten)" />

      <label className="block">
        <span className="text-sm">API-URL</span>
        <input className="field-boxed" type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.lexware.io/v1" />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm">Standard-Stundensatz (netto)</span>
          <input className="field-boxed" type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" />
        </label>
        <label className="block">
          <span className="text-sm">Steuersatz (%)</span>
          <input className="field-boxed" type="number" min="0" step="0.1" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="19" />
        </label>
      </div>

      {/* The load failure stays in-flow (persistent state); the save outcome
          is a toast. Failures only, hence the danger hue. */}
      <Alert>{settings.error}</Alert>
      <div className="tds-toolbar">
        <button className="btn btn-primary" type="button" onClick={() => void save()} disabled={settings.busy}>Speichern</button>
        <button type="button" className="btn btn-ghost" onClick={test}>Verbindung testen</button>
      </div>
      {testResult ? <p className="text-sm opacity-80">{testResult}</p> : null}
    </div>
  );
}
