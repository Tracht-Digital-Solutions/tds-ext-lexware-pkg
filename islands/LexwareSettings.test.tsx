
/**
 * Path + query of a request. The island calls an ABSOLUTE URL now (via
 * `apiFetch`); a relative one would hit the product's own static host and come
 * back as SPA-fallback HTML with a 200. Matching on the path keeps the route
 * matchers below anchored.
 */
const pathOf = (url: string) => String(url).replace(/^https?:\/\/[^/]+/i, "");
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LexwareSettings from "./LexwareSettings";
import { TOAST_EVENT } from "@tracht-digital-solutions/tds-shared/toast";

/**
 * The Lexware credentials panel, backed by the core runtime settings store
 * (`/admin/settings/lexware`, admin-only, AES-GCM at rest).
 *
 * The rule that matters is the store's secret contract: the API key comes back
 * MASKED (`configured` + `last4`, never the value), and **a blank key on save
 * means "keep the existing one"**. Sending anything else for an untouched field
 * would overwrite a working key with a mask or with an empty string, and the
 * only symptom would be every Lexware call failing afterwards.
 */

let calls: Array<{ url: string; method: string; body: unknown }> = [];
let getReply: { status: number; body: unknown } = { status: 200, body: { settings: [] } };
let putReply: { status: number; body: unknown } = { status: 200, body: {} };
let testReply: { status: number; body: unknown } = { status: 200, body: { ok: true } };

/** Outcomes are toasts now — collected off the `tds:toast` bus. */
let toasts: Array<{ variant: string; message: string }> = [];
const collectToast = (e: Event) => {
  toasts.push((e as CustomEvent<{ variant: string; message: string }>).detail);
};

beforeEach(() => {
  toasts = [];
  window.addEventListener(TOAST_EVENT, collectToast);
  calls = [];
  getReply = { status: 200, body: { settings: [] } };
  putReply = { status: 200, body: {} };
  testReply = { status: 200, body: { ok: true } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      const reply = url.includes("/lexware/admin/test") ? testReply : method === "PUT" ? putReply : getReply;
      return {
        ok: reply.status < 300,
        status: reply.status,
        json: async () => reply.body,
      } as Response;
    }),
  );
});

afterEach(() => {
  window.removeEventListener(TOAST_EVENT, collectToast);
  cleanup();
});

const user = () => userEvent.setup({ delay: null });

async function open() {
  render(<LexwareSettings />);
  const u = user();
  await waitFor(() => expect(calls.length).toBeGreaterThan(0));
  return u;
}

const keyBox = () => screen.getByPlaceholderText("Neuen Schlüssel setzen (leer = behalten)") as HTMLInputElement;
const urlBox = () => screen.getByPlaceholderText("https://api.lexware.io/v1") as HTMLInputElement;
const rateBox = () => screen.getByPlaceholderText("0") as HTMLInputElement;
const taxBox = () => screen.getByPlaceholderText("19") as HTMLInputElement;
const put = () => calls.find((c) => c.method === "PUT");
const setting = (key: string) =>
  ((put()!.body as { settings: Array<{ key: string; secret: boolean; value: string }> }).settings.find(
    (s) => s.key === key,
  ))!;

describe("loading", () => {
  it("reads the lexware namespace of the settings store", async () => {
    await open();
    await screen.findByPlaceholderText("https://api.lexware.io/v1");
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(pathOf(fetchMock.mock.calls[0]![0] as string)).toBe("/admin/settings/lexware");
    // Absolute, on the API host. Every other assertion here matches the PATH,
    // which a relative fetch satisfies too — so this is the one that fails if
    // the call ever goes back to the product's own origin (whose SPA fallback
    // answers 200 + HTML and turns into a silent empty state).
    expect(String(fetchMock.mock.calls[0]![0]).startsWith("https://api.tracht-digital.de/")).toBe(true);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: "include" });
  });

  it("shows a loading line until the settings arrive", () => {
    render(<LexwareSettings />);
    expect(screen.getByLabelText("Wird geladen")).toBeTruthy();
  });

  it("fills the fields from the stored values", async () => {
    getReply = {
      status: 200,
      body: {
        settings: [
          { key: "api_url", secret: false, value: "https://eu.lexware.io/v2" },
          { key: "default_hourly_rate", secret: false, value: "95" },
          { key: "default_tax_rate", secret: false, value: "7" },
        ],
      },
    };
    await open();
    await waitFor(() => expect(urlBox().value).toBe("https://eu.lexware.io/v2"));
    expect(rateBox().value).toBe("95");
    expect(taxBox().value).toBe("7");
  });

  it("falls back to the official API URL when none is stored", async () => {
    await open();
    await waitFor(() => expect(urlBox().value).toBe("https://api.lexware.io/v1"));
  });

  it("falls back to 19 % tax when none is stored", async () => {
    await open();
    await waitFor(() => expect(taxBox().value).toBe("19"));
  });

  it("leaves the hourly rate empty rather than inventing one", async () => {
    // A defaulted rate would silently bill at a number nobody chose.
    await open();
    await waitFor(() => expect(rateBox()).toBeTruthy());
    expect(rateBox().value).toBe("");
  });

  it("reports the key as unconfigured when it is not set", async () => {
    await open();
    expect(await screen.findByText("(nicht konfiguriert)")).toBeTruthy();
  });

  it("reports a KNOWN-BUT-EMPTY key as unconfigured", async () => {
    // The store answers with the key present and `configured:false`, so "is
    // there an api_key entry" is the wrong question — only `configured` is.
    getReply = { status: 200, body: { settings: [{ key: "api_key", secret: true, configured: false, last4: null }] } };
    await open();
    expect(await screen.findByText("(nicht konfiguriert)")).toBeTruthy();
  });

  it("shows only the last four characters of a configured key", async () => {
    // The store never returns the secret; showing more than last4 would mean
    // the island is reading something it must not have.
    getReply = { status: 200, body: { settings: [{ key: "api_key", secret: true, configured: true, last4: "9f3a" }] } };
    await open();
    expect(await screen.findByText("(konfiguriert (…9f3a))")).toBeTruthy();
  });

  it("copes with a configured key that reports no last4", async () => {
    getReply = { status: 200, body: { settings: [{ key: "api_key", secret: true, configured: true, last4: null }] } };
    await open();
    expect(await screen.findByText("(konfiguriert (…????))")).toBeTruthy();
  });

  it("never renders a secret value even if the API leaks one", async () => {
    getReply = {
      status: 200,
      body: { settings: [{ key: "api_key", secret: true, configured: true, last4: "9f3a", value: "sk-live-secret" }] },
    };
    await open();
    await screen.findByText("(konfiguriert (…9f3a))");
    expect(document.body.textContent).not.toContain("sk-live-secret");
    expect(keyBox().value).toBe("");
  });

  it("keeps the key input masked", async () => {
    await open();
    await waitFor(() => expect(keyBox().getAttribute("type")).toBe("password"));
    expect(keyBox().getAttribute("autocomplete")).toBe("off");
  });

  it("names the reason when the user is not an admin", async () => {
    getReply = { status: 403, body: {} };
    render(<LexwareSettings />);
    expect(await screen.findByText("Nur für Administratoren.")).toBeTruthy();
  });

  it("treats an expired session the same way", async () => {
    getReply = { status: 401, body: {} };
    render(<LexwareSettings />);
    expect(await screen.findByText("Nur für Administratoren.")).toBeTruthy();
  });

  it("reports any other failure with its status", async () => {
    getReply = { status: 500, body: {} };
    render(<LexwareSettings />);
    expect(await screen.findByText("Fehler (HTTP 500).")).toBeTruthy();
  });

  it("leaves the loading state even when the request fails", async () => {
    // Otherwise the settings section is a permanent "Wird geladen …".
    getReply = { status: 500, body: {} };
    render(<LexwareSettings />);
    await screen.findByText("Fehler (HTTP 500).");
    expect(screen.queryByLabelText("Wird geladen")).toBeNull();
  });

  it("does NOT apply values carried by a non-OK response", async () => {
    // A 403 body must not configure the panel.
    getReply = { status: 403, body: { settings: [{ key: "api_url", secret: false, value: "https://leak" }] } };
    render(<LexwareSettings />);
    await screen.findByText("Nur für Administratoren.");
    expect(document.body.textContent).not.toContain("https://leak");
  });

  it("tolerates a response with no settings array", async () => {
    getReply = { status: 200, body: {} };
    await open();
    expect(await screen.findByPlaceholderText("https://api.lexware.io/v1")).toBeTruthy();
  });
});

describe("saving", () => {
  it("writes back to the same namespace as JSON", async () => {
    const u = await open();
    await screen.findByPlaceholderText("https://api.lexware.io/v1");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(put()).toBeDefined());
    expect(pathOf(put()!.url)).toBe("/admin/settings/lexware");
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const call = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "PUT")!;
    expect((call[1] as RequestInit).headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("sends an EMPTY api_key when the field was not touched", async () => {
    // This is the store's "keep the existing secret" signal. Sending a mask or
    // a placeholder here would overwrite the working key.
    getReply = { status: 200, body: { settings: [{ key: "api_key", secret: true, configured: true, last4: "9f3a" }] } };
    const u = await open();
    await screen.findByText("(konfiguriert (…9f3a))");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(put()).toBeDefined());
    expect(setting("api_key").value).toBe("");
  });

  it("sends a newly typed key", async () => {
    const u = await open();
    await u.type(await screen.findByPlaceholderText("Neuen Schlüssel setzen (leer = behalten)"), "sk-new-key");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(put()).toBeDefined());
    expect(setting("api_key").value).toBe("sk-new-key");
  });

  it("marks the api key as the only secret", async () => {
    // A key stored with secret:false lands in the DB in plaintext.
    const u = await open();
    await screen.findByPlaceholderText("https://api.lexware.io/v1");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(put()).toBeDefined());
    expect(setting("api_key").secret).toBe(true);
    for (const key of ["api_url", "default_hourly_rate", "default_tax_rate"]) {
      expect(setting(key).secret, `${key} must not be stored as a secret`).toBe(false);
    }
  });

  it("sends all four keys so none is left behind", async () => {
    const u = await open();
    await screen.findByPlaceholderText("https://api.lexware.io/v1");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(put()).toBeDefined());
    const keys = (put()!.body as { settings: Array<{ key: string }> }).settings.map((s) => s.key);
    expect(keys.sort()).toEqual(["api_key", "api_url", "default_hourly_rate", "default_tax_rate"]);
  });

  it("trims whitespace off every value", async () => {
    // A trailing space in the API URL turns every request into a 404.
    const u = await open();
    const url = await screen.findByPlaceholderText("https://api.lexware.io/v1");
    await u.clear(url);
    await u.type(url, "  https://eu.lexware.io/v2  ");
    await u.type(keyBox(), "  sk-padded  ");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(put()).toBeDefined());
    expect(setting("api_url").value).toBe("https://eu.lexware.io/v2");
    expect(setting("api_key").value).toBe("sk-padded");
  });

  it("sends the edited rate and tax", async () => {
    const u = await open();
    const rate = await screen.findByPlaceholderText("0");
    await u.type(rate, "110");
    await u.clear(taxBox());
    await u.type(taxBox(), "7");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(put()).toBeDefined());
    expect(setting("default_hourly_rate").value).toBe("110");
    expect(setting("default_tax_rate").value).toBe("7");
  });

  it("confirms and re-reads the masked state after a save", async () => {
    const u = await open();
    await screen.findByPlaceholderText("https://api.lexware.io/v1");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(toasts.some((t) => t.variant === "success" && t.message.includes("Gespeichert"))).toBe(true));
    await waitFor(() => expect(calls.filter((c) => c.method === "GET" && pathOf(c.url) === "/admin/settings/lexware")).toHaveLength(2));
  });

  it("clears the typed key after a successful save", async () => {
    // Leaving it in the field would re-send it on the next unrelated save.
    const u = await open();
    await u.type(await screen.findByPlaceholderText("Neuen Schlüssel setzen (leer = behalten)"), "sk-new-key");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(toasts.some((t) => t.variant === "success" && t.message.includes("Gespeichert"))).toBe(true));
    expect(keyBox().value).toBe("");
  });

  it("KEEPS the typed key when the save fails", async () => {
    putReply = { status: 500, body: {} };
    const u = await open();
    await u.type(await screen.findByPlaceholderText("Neuen Schlüssel setzen (leer = behalten)"), "sk-new-key");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && t.message.includes("500"))).toBe(true));
    expect(keyBox().value).toBe("sk-new-key");
  });

  it("does not re-read the settings after a failed save", async () => {
    putReply = { status: 403, body: {} };
    const u = await open();
    await screen.findByPlaceholderText("https://api.lexware.io/v1");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && t.message.includes("403"))).toBe(true));
    expect(calls.filter((c) => c.method === "GET" && pathOf(c.url) === "/admin/settings/lexware")).toHaveLength(1);
  });

  it("re-enables the save button afterwards", async () => {
    const u = await open();
    await screen.findByPlaceholderText("https://api.lexware.io/v1");
    const button = screen.getByRole("button", { name: "Speichern" }) as HTMLButtonElement;
    await u.click(button);
    await waitFor(() => expect(toasts.some((t) => t.variant === "success" && t.message.includes("Gespeichert"))).toBe(true));
    expect(button.disabled).toBe(false);
  });
});

describe("the connection test", () => {
  it("calls the module's own admin test route", async () => {
    const u = await open();
    await u.click(await screen.findByRole("button", { name: "Verbindung testen" }));
    await waitFor(() => expect(calls.some((c) => pathOf(c.url) === "/lexware/admin/test")).toBe(true));
  });

  it("confirms a working connection", async () => {
    const u = await open();
    await u.click(await screen.findByRole("button", { name: "Verbindung testen" }));
    expect(await screen.findByText("Verbindung erfolgreich.")).toBeTruthy();
  });

  it("does NOT claim success on a 200 that reports ok:false", async () => {
    // The route answers 200 with `{ok:false, error}` when Lexware rejects the
    // key — trusting the HTTP status alone would green-light a dead key.
    testReply = { status: 200, body: { ok: false, error: "Ungültiger API-Key" } };
    const u = await open();
    await u.click(await screen.findByRole("button", { name: "Verbindung testen" }));
    expect(await screen.findByText("Fehlgeschlagen: Ungültiger API-Key")).toBeTruthy();
  });

  it("reports the error the route returns", async () => {
    testReply = { status: 502, body: { error: "Lexware nicht erreichbar" } };
    const u = await open();
    await u.click(await screen.findByRole("button", { name: "Verbindung testen" }));
    expect(await screen.findByText("Fehlgeschlagen: Lexware nicht erreichbar")).toBeTruthy();
  });

  it("falls back to the status code when there is no message", async () => {
    testReply = { status: 500, body: {} };
    const u = await open();
    await u.click(await screen.findByRole("button", { name: "Verbindung testen" }));
    expect(await screen.findByText("Fehlgeschlagen: HTTP 500")).toBeTruthy();
  });

  it("does not save anything while testing", async () => {
    const u = await open();
    await u.click(await screen.findByRole("button", { name: "Verbindung testen" }));
    await screen.findByText("Verbindung erfolgreich.");
    expect(put()).toBeUndefined();
  });
});
