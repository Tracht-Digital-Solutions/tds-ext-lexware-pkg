
/**
 * Path + query of a request. The island calls an ABSOLUTE URL now (via
 * `apiFetch`); a relative one would hit the product's own static host and come
 * back as SPA-fallback HTML with a 200. Matching on the path keeps the route
 * matchers below anchored.
 */
const pathOf = (url: string) => String(url).replace(/^https?:\/\/[^/]+/i, "");
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import WidgetBody from "./WidgetBody";

/**
 * The dashboard widget. Three states — loading, failed, loaded — and the
 * failed/loaded distinction is the point: rendering `0` on a failed request
 * claims nothing was ever exported to Lexware, which is a different (and
 * wrong) statement from "we do not know".
 */

let reply: { status: number; body: unknown } | "reject" = {
  status: 200,
  body: { configured: true, invoiceCount: 0, recent: [] },
};

beforeEach(() => {
  reply = { status: 200, body: { configured: true, invoiceCount: 0, recent: [] } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (reply === "reject") throw new TypeError("offline");
      return {
        ok: reply.status < 300,
        status: reply.status,
        json: async () => (reply === "reject" ? {} : reply.body),
      } as Response;
    }),
  );
});

afterEach(() => cleanup());

describe("the widget", () => {
  it("fetches its summary endpoint with credentials", async () => {
    render(<WidgetBody />);
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(pathOf(fetchMock.mock.calls[0]![0] as string)).toBe("/lexware/summary");
    // Absolute, on the API host. Every other assertion here matches the PATH,
    // which a relative fetch satisfies too — so this is the one that fails if
    // the call ever goes back to the product's own origin (whose SPA fallback
    // answers 200 + HTML and turns into a silent empty state).
    expect(String(fetchMock.mock.calls[0]![0]).startsWith("https://api.tracht-digital.de/")).toBe(true);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: "include" });
  });

  it("shows a placeholder before the request resolves", () => {
    render(<WidgetBody />);
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it("renders the exported invoice count", async () => {
    reply = { status: 200, body: { configured: true, invoiceCount: 12, recent: [] } };
    render(<WidgetBody />);
    expect(await screen.findByText("12")).toBeTruthy();
    expect(screen.getByText("Rechnungen an Lexware")).toBeTruthy();
  });

  it("renders a real zero when nothing has been exported", async () => {
    render(<WidgetBody />);
    expect(await screen.findByText("0")).toBeTruthy();
  });

  it("says the integration is unconfigured instead of implying it works", async () => {
    reply = { status: 200, body: { configured: false, invoiceCount: 0, recent: [] } };
    render(<WidgetBody />);
    expect(await screen.findByText("Lexware nicht konfiguriert")).toBeTruthy();
    expect(screen.queryByText("Rechnungen an Lexware")).toBeNull();
  });

  it("shows a dash on an error rather than claiming zero", async () => {
    reply = { status: 500, body: {} };
    render(<WidgetBody />);
    expect(await screen.findByText("—")).toBeTruthy();
  });

  it("shows a dash when the request rejects", async () => {
    reply = "reject";
    render(<WidgetBody />);
    expect(await screen.findByText("—")).toBeTruthy();
  });

  it("does not render a count carried by a NON-OK response", async () => {
    reply = { status: 403, body: { configured: true, invoiceCount: 99, recent: [] } };
    render(<WidgetBody />);
    expect(await screen.findByText("—")).toBeTruthy();
    expect(screen.queryByText("99")).toBeNull();
  });
});
