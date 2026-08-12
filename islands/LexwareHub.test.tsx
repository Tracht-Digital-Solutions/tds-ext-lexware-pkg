// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LexwareHub from "./LexwareHub";
import { TOAST_EVENT } from "@tracht-digital-solutions/tds-shared/toast";

/**
 * The billing hub. Four tabs over the Lexware-Office integration.
 *
 * Two things here reach out of the browser and cannot be undone from this UI,
 * so they get the sharpest assertions:
 *
 *  1. **`finalize`** turns a draft into a REAL invoice at Lexware. It defaults
 *     to off and must travel exactly as checked — a body that silently carries
 *     `true` bills a customer.
 *  2. **push-contact** creates a contact at Lexware. The button is disabled
 *     once `lexware_contact_id` is set, which is what stops a duplicate.
 *
 * Error paths deliberately answer with a POPULATED body and a non-OK status:
 * against an empty error body `res.ok ? await res.json() : []` and a bare
 * `await res.json()` are indistinguishable, so the ok-check could be deleted
 * without a single test noticing.
 */

interface Reply {
  status: number;
  body: unknown;
}
type Handler = (url: string, init?: RequestInit) => Reply | undefined;

let calls: Array<{ url: string; method: string; body: unknown }> = [];
let handlers: Handler[] = [];
let gate: { match: RegExp; promise: Promise<void> } | null = null;

/**
 * Path + query of a request. The island calls an ABSOLUTE URL now (via
 * `apiFetch`); a relative one would hit the product's own static host and come
 * back as SPA-fallback HTML with a 200. Matching on the path keeps the route
 * matchers below anchored.
 */
const pathOf = (url: string) => String(url).replace(/^https?:\/\/[^/]+/i, "");

/** Register a reply, newest first (later `respond` calls win). */
function respond(match: RegExp, body: unknown, status = 200, method?: string) {
  handlers.unshift((url, init) => {
    if (!match.test(pathOf(url))) return undefined;
    if (method && (init?.method ?? "GET") !== method) return undefined;
    return { status, body };
  });
}

/** Keep matching requests in flight until the returned function is called. */
function holdRequests(match: RegExp) {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  gate = { match, promise };
  return () => {
    gate = null;
    release();
  };
}

const CUSTOMER = {
  id: 1,
  name: "Acme GmbH",
  email: "info@acme.de",
  lexware_contact_id: null as string | null,
  default_hourly_rate: 90,
  tax_rate_percent: 19,
  note: null,
  project_count: 2,
};
const PROJECT = { id: 7, customer_id: 1, title: "Relaunch", hourly_rate: 100, status: "active" };
const ENTRY = { id: 42, started_at: "2026-07-20T09:00:00", ended_at: "2026-07-20T10:30:00", note: "Setup", duration_minutes: 90 };
const LEAD = {
  source_type: "contact_message" as const,
  source_id: 5,
  name: "Erika Muster",
  email: "erika@example.de",
  company: "Muster KG",
  lexware_contact_id: null as string | null,
};

/** Outcomes are toasts now — the hub had FOUR in-flow banners, one per
 *  panel; they are one stack now. Collected off the `tds:toast` bus. */
let toasts: Array<{ variant: string; message: string }> = [];
const collectToast = (e: Event) => {
  toasts.push((e as CustomEvent<{ variant: string; message: string }>).detail);
};

beforeEach(() => {
  toasts = [];
  window.addEventListener(TOAST_EVENT, collectToast);
  calls = [];
  gate = null;
  handlers = [
    () => ({ status: 200, body: {} }), // catch-all, last resort
  ];
  respond(/^\/lexware\/customers$/, { customers: [] });
  respond(/^\/lexware\/leads$/, { leads: [] });
  respond(/^\/lexware\/invoices$/, { invoices: [] });
  respond(/^\/lexware\/time\/unassigned/, { entries: [] });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      const g = gate;
      if (g && g.match.test(pathOf(url))) await g.promise;
      const reply = handlers.map((h) => h(url, init)).find((r) => r !== undefined)!;
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
const sent = (method: string, match: RegExp) => calls.filter((c) => c.method === method && match.test(pathOf(c.url)));

/** Render and settle the initial load of whichever tab is showing. */
async function open(tab?: string) {
  render(<LexwareHub />);
  const u = user();
  if (tab) {
    await u.click(screen.getByRole("tab", { name: tab }));
  }
  await waitFor(() => expect(calls.length).toBeGreaterThan(0));
  return u;
}

/** Drive the customer→project picker to a concrete project. */
async function pickProject(u: ReturnType<typeof user>) {
  const [customerSelect, projectSelect] = screen.getAllByRole("combobox");
  await u.selectOptions(customerSelect!, "1");
  await screen.findByRole("option", { name: "Relaunch" });
  await u.selectOptions(projectSelect!, "7");
}

describe("the tab bar", () => {
  it("offers all four areas of the hub", async () => {
    await open();
    for (const name of ["Kunden", "Zeit zuordnen", "Kontakte", "Rechnungen"]) {
      expect(screen.getByRole("tab", { name })).toBeTruthy();
    }
  });

  it("starts on the customer directory", async () => {
    await open();
    expect(screen.getByRole("tab", { name: "Kunden" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Rechnungen" }).getAttribute("aria-selected")).toBe("false");
  });

  it("shows exactly one panel at a time", async () => {
    const u = await open();
    expect(screen.getByRole("heading", { name: "Kunden", level: 4 })).toBeTruthy();
    await u.click(screen.getByRole("tab", { name: "Rechnungen" }));
    await screen.findByRole("button", { name: "Rechnung erstellen" });
    expect(screen.queryByRole("heading", { name: "Kunden", level: 4 })).toBeNull();
  });

  it("marks only the open tab as selected", async () => {
    const u = await open();
    await u.click(screen.getByRole("tab", { name: "Kontakte" }));
    const selected = screen.getAllByRole("tab").filter((t) => t.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]!.textContent).toBe("Kontakte");
  });
});

describe("the customer directory", () => {
  it("reads the customer list with credentials", async () => {
    await open();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(pathOf(fetchMock.mock.calls[0]![0] as string)).toBe("/lexware/customers");
    // Absolute, on the API host. Every other assertion here matches the PATH,
    // which a relative fetch satisfies too — so this is the one that fails if
    // the call ever goes back to the product's own origin (whose SPA fallback
    // answers 200 + HTML and turns into a silent empty state).
    expect(String(fetchMock.mock.calls[0]![0]).startsWith("https://api.tracht-digital.de/")).toBe(true);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: "include" });
  });

  it("lists each customer with its project count", async () => {
    respond(/^\/lexware\/customers$/, { customers: [CUSTOMER] });
    await open();
    const row = await screen.findByRole("button", { name: /Acme GmbH/ });
    expect(row.textContent).toContain("2 Projekte");
  });

  it("shows zero projects when the count is missing", async () => {
    respond(/^\/lexware\/customers$/, { customers: [{ ...CUSTOMER, project_count: null }] });
    await open();
    const row = await screen.findByRole("button", { name: /Acme GmbH/ });
    expect(row.textContent).toContain("0 Projekte");
  });

  it("flags customers that already exist in Lexware", async () => {
    respond(/^\/lexware\/customers$/, { customers: [{ ...CUSTOMER, lexware_contact_id: "lx-9" }] });
    await open();
    const row = await screen.findByRole("button", { name: /Acme GmbH/ });
    expect(within(row).getByText("Lexware")).toBeTruthy();
  });

  it("does not flag a customer that is only local", async () => {
    respond(/^\/lexware\/customers$/, { customers: [CUSTOMER] });
    await open();
    const row = await screen.findByRole("button", { name: /Acme GmbH/ });
    expect(within(row).queryByText("Lexware")).toBeNull();
  });

  it("says so when there are no customers yet", async () => {
    await open();
    expect(await screen.findByText("Noch keine Kunden.")).toBeTruthy();
  });

  it("does NOT list customers carried by a non-OK response", async () => {
    respond(/^\/lexware\/customers$/, { customers: [CUSTOMER] }, 403);
    await open();
    expect(await screen.findByText("Noch keine Kunden.")).toBeTruthy();
    expect(screen.queryByText(/Acme GmbH/)).toBeNull();
  });

  it("tolerates a response without a customers field", async () => {
    respond(/^\/lexware\/customers$/, {});
    await open();
    expect(await screen.findByText("Noch keine Kunden.")).toBeTruthy();
  });
});

describe("creating a customer", () => {
  async function fill(u: ReturnType<typeof user>, name: string) {
    await u.type(screen.getByPlaceholderText("Name"), name);
    await u.type(screen.getByPlaceholderText("E-Mail (optional)"), "neu@example.de");
    await u.type(screen.getByPlaceholderText("Stundensatz netto (optional)"), "120");
    await u.click(screen.getByRole("button", { name: "Anlegen" }));
  }

  it("posts the name, email and hourly rate", async () => {
    const u = await open();
    await fill(u, "Neu GmbH");
    await waitFor(() => expect(sent("POST", /^\/lexware\/customers$/)).toHaveLength(1));
    expect(sent("POST", /^\/lexware\/customers$/)[0]!.body).toEqual({
      name: "Neu GmbH",
      email: "neu@example.de",
      default_hourly_rate: "120",
    });
  });

  it("refuses to create a nameless customer", async () => {
    const u = await open();
    await u.type(screen.getByPlaceholderText("E-Mail (optional)"), "neu@example.de");
    await u.click(screen.getByRole("button", { name: "Anlegen" }));
    expect(sent("POST", /^\/lexware\/customers$/)).toHaveLength(0);
  });

  it("treats a whitespace-only name as empty", async () => {
    const u = await open();
    await u.type(screen.getByPlaceholderText("Name"), "   ");
    await u.click(screen.getByRole("button", { name: "Anlegen" }));
    expect(sent("POST", /^\/lexware\/customers$/)).toHaveLength(0);
  });

  it("clears the form and reloads the list on success", async () => {
    const u = await open();
    await fill(u, "Neu GmbH");
    await waitFor(() => expect(sent("GET", /^\/lexware\/customers$/)).toHaveLength(2));
    expect((screen.getByPlaceholderText("Name") as HTMLInputElement).value).toBe("");
    expect((screen.getByPlaceholderText("E-Mail (optional)") as HTMLInputElement).value).toBe("");
  });

  it("keeps the typed values and reports the failure", async () => {
    // Losing the input on a failed save would make the user retype everything.
    respond(/^\/lexware\/customers$/, { error: "nope" }, 500, "POST");
    const u = await open();
    await fill(u, "Neu GmbH");
await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && t.message.includes("500"))).toBe(true));
    expect((screen.getByPlaceholderText("Name") as HTMLInputElement).value).toBe("Neu GmbH");
  });

  it("does not reload the list after a failed save", async () => {
    respond(/^\/lexware\/customers$/, { error: "nope" }, 500, "POST");
    const u = await open();
    await fill(u, "Neu GmbH");
await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && t.message.includes("500"))).toBe(true));
    expect(sent("GET", /^\/lexware\/customers$/)).toHaveLength(1);
  });
});

describe("a selected customer", () => {
  async function openDetail(overrides: Partial<typeof CUSTOMER> & { projects?: unknown[] } = {}) {
    respond(/^\/lexware\/customers$/, { customers: [CUSTOMER] });
    respond(/^\/lexware\/customers\/1$/, { ...CUSTOMER, projects: [PROJECT], ...overrides });
    const u = await open();
    await u.click(await screen.findByRole("button", { name: /Acme GmbH/ }));
    await screen.findByRole("heading", { name: "Acme GmbH", level: 4 });
    return u;
  }

  it("loads the detail of the clicked customer", async () => {
    await openDetail();
    expect(sent("GET", /^\/lexware\/customers\/1$/)).toHaveLength(1);
  });

  it("prompts for a choice until one is made", async () => {
    await open();
    expect(screen.getByText("Kunde wählen …")).toBeTruthy();
  });

  it("lists the customer's projects with their rate", async () => {
    await openDetail();
    expect(screen.getByText(/Relaunch/)).toBeTruthy();
    expect(screen.getByText(/100 €\/h/)).toBeTruthy();
  });

  it("marks archived projects", async () => {
    await openDetail({ projects: [{ ...PROJECT, status: "archived" }] });
    expect(screen.getByText("archiviert")).toBeTruthy();
  });

  it("does not mark an active project as archived", async () => {
    await openDetail();
    expect(screen.queryByText("archiviert")).toBeNull();
  });

  it("says so when the customer has no projects", async () => {
    await openDetail({ projects: [] });
    expect(screen.getByText("Noch keine Projekte.")).toBeTruthy();
  });

  it("offers to create the Lexware contact when there is none", async () => {
    await openDetail();
    const push = screen.getByRole("button", { name: "Als Lexware-Kontakt anlegen" });
    expect((push as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/nicht in Lexware/)).toBeTruthy();
  });

  it("DISABLES the push button once the contact exists", async () => {
    // The only guard against creating the same contact at Lexware twice.
    await openDetail({ lexware_contact_id: "lx-9" });
    const push = screen.getByRole("button", { name: "In Lexware angelegt" });
    expect((push as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Lexware-Kontakt lx-9/)).toBeTruthy();
  });

  it("pushes the contact and reports success", async () => {
    respond(/push-contact$/, { ok: true }, 200, "POST");
    const u = await openDetail();
    await u.click(screen.getByRole("button", { name: "Als Lexware-Kontakt anlegen" }));
await waitFor(() => expect(toasts.some((t) => t.variant === "success" && t.message.includes("Kontakt in Lexware angelegt"))).toBe(true));
    expect(sent("POST", /^\/lexware\/customers\/1\/push-contact$/)).toHaveLength(1);
  });

  it("surfaces the API's own error message when the push fails", async () => {
    respond(/push-contact$/, { error: "Lexware 401" }, 502, "POST");
    const u = await openDetail();
    await u.click(screen.getByRole("button", { name: "Als Lexware-Kontakt anlegen" }));
await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && t.message.includes("Lexware 401"))).toBe(true));
  });

  it("falls back to the status code when the error carries no message", async () => {
    respond(/push-contact$/, {}, 502, "POST");
    const u = await openDetail();
    await u.click(screen.getByRole("button", { name: "Als Lexware-Kontakt anlegen" }));
await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && t.message.includes("502"))).toBe(true));
  });

  it("refreshes the detail after a push so the button locks", async () => {
    respond(/push-contact$/, { ok: true }, 200, "POST");
    const u = await openDetail();
    await u.click(screen.getByRole("button", { name: "Als Lexware-Kontakt anlegen" }));
    await waitFor(() => expect(sent("GET", /^\/lexware\/customers\/1$/)).toHaveLength(2));
  });

  it("posts a new project under the open customer", async () => {
    const u = await openDetail();
    await u.type(screen.getByPlaceholderText("Projekttitel"), "Wartung");
    await u.type(screen.getByPlaceholderText(/Stundensatz \(optional/), "80");
    await u.click(screen.getByRole("button", { name: "Projekt anlegen" }));
    await waitFor(() => expect(sent("POST", /projects$/)).toHaveLength(1));
    const call = sent("POST", /projects$/)[0]!;
    expect(pathOf(call.url)).toBe("/lexware/customers/1/projects");
    expect(call.body).toEqual({ title: "Wartung", hourly_rate: "80" });
  });

  it("refuses to create a project without a title", async () => {
    const u = await openDetail();
    await u.type(screen.getByPlaceholderText(/Stundensatz \(optional/), "80");
    await u.click(screen.getByRole("button", { name: "Projekt anlegen" }));
    expect(sent("POST", /projects$/)).toHaveLength(0);
  });

  it("clears the project form and reloads only on success", async () => {
    respond(/projects$/, { error: "no" }, 500, "POST");
    const u = await openDetail();
    await u.type(screen.getByPlaceholderText("Projekttitel"), "Wartung");
    await u.click(screen.getByRole("button", { name: "Projekt anlegen" }));
    await waitFor(() => expect(sent("POST", /projects$/)).toHaveLength(1));
    expect((screen.getByPlaceholderText("Projekttitel") as HTMLInputElement).value).toBe("Wartung");
    expect(sent("GET", /^\/lexware\/customers\/1$/)).toHaveLength(1);
  });
});

describe("the customer→project picker", () => {
  beforeEach(() => {
    respond(/^\/lexware\/customers$/, { customers: [CUSTOMER] });
    respond(/^\/lexware\/customers\/1$/, { ...CUSTOMER, projects: [PROJECT] });
  });

  it("keeps the project select disabled until a customer is chosen", async () => {
    await open("Zeit zuordnen");
    const [, projectSelect] = screen.getAllByRole("combobox");
    expect((projectSelect as HTMLSelectElement).disabled).toBe(true);
  });

  it("enables and fills the project select for the chosen customer", async () => {
    const u = await open("Zeit zuordnen");
    const [customerSelect, projectSelect] = screen.getAllByRole("combobox");
    await u.selectOptions(customerSelect!, "1");
    expect(await screen.findByRole("option", { name: "Relaunch" })).toBeTruthy();
    expect((projectSelect as HTMLSelectElement).disabled).toBe(false);
  });

  it("CLEARS the chosen project when the customer changes", async () => {
    // Otherwise a stale project id from customer A would be billed under B.
    const u = await open("Zeit zuordnen");
    respond(/^\/lexware\/time\/unassigned/, { entries: [ENTRY] });
    await pickProject(u);
    const [customerSelect] = screen.getAllByRole("combobox");
    await u.selectOptions(customerSelect!, "");
    await u.click(screen.getByRole("button", { name: "Filtern" }));
    await screen.findByText("Setup");
    await u.click(screen.getByRole("button", { name: "Zuordnen" }));
    expect(await screen.findByText("Bitte zuerst ein Projekt wählen.")).toBeTruthy();
  });
});

describe("assigning tracked time", () => {
  beforeEach(() => {
    respond(/^\/lexware\/customers$/, { customers: [CUSTOMER] });
    respond(/^\/lexware\/customers\/1$/, { ...CUSTOMER, projects: [PROJECT] });
    respond(/^\/lexware\/time\/unassigned/, { entries: [ENTRY] });
  });

  it("loads the unassigned entries", async () => {
    await open("Zeit zuordnen");
    expect(await screen.findByText("Setup")).toBeTruthy();
    expect(screen.getByText("2026-07-20")).toBeTruthy();
  });

  it("renders the duration in German-decimal hours", async () => {
    await open("Zeit zuordnen");
    expect(await screen.findByText("1,50 h")).toBeTruthy();
  });

  it("says so when nothing is open", async () => {
    respond(/^\/lexware\/time\/unassigned/, { entries: [] });
    await open("Zeit zuordnen");
    expect(await screen.findByText("Keine offenen Einträge.")).toBeTruthy();
  });

  it("omits empty date filters from the query", async () => {
    const u = await open("Zeit zuordnen");
    await u.click(screen.getByRole("button", { name: "Filtern" }));
    await waitFor(() => expect(sent("GET", /unassigned/)).toHaveLength(2));
    expect(pathOf(sent("GET", /unassigned/)[1]!.url)).toBe("/lexware/time/unassigned?");
  });

  it("passes both dates when they are set", async () => {
    const u = await open("Zeit zuordnen");
    const dates = screen.getAllByLabelText(/Von|Bis/);
    await u.type(dates[0]!, "2026-07-01");
    await u.type(dates[1]!, "2026-07-31");
    await u.click(screen.getByRole("button", { name: "Filtern" }));
    await waitFor(() => expect(sent("GET", /unassigned/).length).toBeGreaterThan(1));
    const last = sent("GET", /unassigned/).at(-1)!.url;
    expect(last).toContain("from=2026-07-01");
    expect(last).toContain("to=2026-07-31");
  });

  it("refuses to assign without a project and says why", async () => {
    const u = await open("Zeit zuordnen");
    await screen.findByText("Setup");
    await u.click(screen.getByRole("button", { name: "Zuordnen" }));
    expect(await screen.findByText("Bitte zuerst ein Projekt wählen.")).toBeTruthy();
    expect(sent("POST", /assign/)).toHaveLength(0);
  });

  it("posts the entry and the project together", async () => {
    const u = await open("Zeit zuordnen");
    await screen.findByText("Setup");
    await pickProject(u);
    await u.click(screen.getByRole("button", { name: "Zuordnen" }));
    await waitFor(() => expect(sent("POST", /assign/)).toHaveLength(1));
    expect(sent("POST", /assign/)[0]!.body).toEqual({ timeEntryId: 42, projectId: 7 });
  });

  it("drops the assigned row from the open list", async () => {
    const u = await open("Zeit zuordnen");
    await screen.findByText("Setup");
    await pickProject(u);
    await u.click(screen.getByRole("button", { name: "Zuordnen" }));
await waitFor(() => expect(toasts.some((t) => t.variant === "success" && t.message.includes("Zugeordnet"))).toBe(true));
    expect(screen.queryByText("Setup")).toBeNull();
  });

  it("KEEPS the row when the assignment fails", async () => {
    // Removing it would hide time that is still unbilled.
    respond(/assign$/, { error: "nope" }, 500, "POST");
    const u = await open("Zeit zuordnen");
    await screen.findByText("Setup");
    await pickProject(u);
    await u.click(screen.getByRole("button", { name: "Zuordnen" }));
await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && t.message.includes("500"))).toBe(true));
    expect(screen.getByText("Setup")).toBeTruthy();
  });

  it("does not list entries carried by a non-OK response", async () => {
    respond(/^\/lexware\/time\/unassigned/, { entries: [ENTRY] }, 403);
    await open("Zeit zuordnen");
    expect(await screen.findByText("Keine offenen Einträge.")).toBeTruthy();
  });

  it("shows a dash for an entry without a note", async () => {
    respond(/^\/lexware\/time\/unassigned/, { entries: [{ ...ENTRY, note: null }] });
    await open("Zeit zuordnen");
    expect(await screen.findByText("—")).toBeTruthy();
  });
});

describe("pushing leads to Lexware", () => {
  beforeEach(() => respond(/^\/lexware\/leads$/, { leads: [LEAD] }));

  it("lists the lead with its source", async () => {
    await open("Kontakte");
    expect(await screen.findByText("Erika Muster")).toBeTruthy();
    expect(screen.getByText("erika@example.de")).toBeTruthy();
    expect(screen.getByText("Muster KG")).toBeTruthy();
    expect(screen.getByText("Kontaktformular")).toBeTruthy();
  });

  it("labels a ticket-sourced lead as a ticket", async () => {
    respond(/^\/lexware\/leads$/, { leads: [{ ...LEAD, source_type: "ticket" }] });
    await open("Kontakte");
    expect(await screen.findByText("Ticket")).toBeTruthy();
    expect(screen.queryByText("Kontaktformular")).toBeNull();
  });

  it("says so when there is nothing to push", async () => {
    respond(/^\/lexware\/leads$/, { leads: [] });
    await open("Kontakte");
    expect(await screen.findByText("Keine Kontakt-Kandidaten gefunden.")).toBeTruthy();
  });

  it("posts the lead's identity together with its source", async () => {
    const u = await open("Kontakte");
    await u.click(await screen.findByRole("button", { name: "Anlegen" }));
    await waitFor(() => expect(sent("POST", /leads\/push$/)).toHaveLength(1));
    expect(sent("POST", /leads\/push$/)[0]!.body).toEqual({
      source_type: "contact_message",
      source_id: 5,
      name: "Erika Muster",
      email: "erika@example.de",
      company: "Muster KG",
    });
  });

  it("replaces the button with a chip once the lead is in Lexware", async () => {
    respond(/^\/lexware\/leads$/, { leads: [{ ...LEAD, lexware_contact_id: "lx-3" }] });
    await open("Kontakte");
expect(await screen.findByText("in Lexware")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Anlegen" })).toBeNull();
  });

  it("reloads the list after a push so the chip appears", async () => {
    const u = await open("Kontakte");
    await u.click(await screen.findByRole("button", { name: "Anlegen" }));
    await waitFor(() => expect(sent("GET", /^\/lexware\/leads$/)).toHaveLength(2));
  });

  it("surfaces the API's error message", async () => {
    respond(/leads\/push$/, { error: "Duplikat" }, 409, "POST");
    const u = await open("Kontakte");
    await u.click(await screen.findByRole("button", { name: "Anlegen" }));
await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && t.message.includes("Duplikat"))).toBe(true));
  });

  it("does not list leads carried by a non-OK response", async () => {
    respond(/^\/lexware\/leads$/, { leads: [LEAD] }, 403);
    await open("Kontakte");
    expect(await screen.findByText("Keine Kontakt-Kandidaten gefunden.")).toBeTruthy();
  });
});

describe("exporting an invoice", () => {
  beforeEach(() => {
    respond(/^\/lexware\/customers$/, { customers: [CUSTOMER] });
    respond(/^\/lexware\/customers\/1$/, { ...CUSTOMER, projects: [PROJECT] });
    respond(/from-project$/, { totalMinutes: 450 }, 200, "POST");
  });

  const exported = () => sent("POST", /from-project$/);

  it("refuses to export without a project", async () => {
    const u = await open("Rechnungen");
    await u.click(screen.getByRole("button", { name: "Rechnung erstellen" }));
    expect(await screen.findByText("Bitte ein Projekt wählen.")).toBeTruthy();
    expect(exported()).toHaveLength(0);
  });

  it("leaves the finalize switch OFF by default", async () => {
    await open("Rechnungen");
    expect((screen.getByRole("checkbox", { name: /Finalisieren/ }) as HTMLInputElement).checked).toBe(false);
  });

  it("exports a DRAFT when finalize is untouched", async () => {
    // finalize:true creates a real, non-retractable invoice at Lexware.
    const u = await open("Rechnungen");
    await pickProject(u);
    await u.click(screen.getByRole("button", { name: "Rechnung erstellen" }));
    await waitFor(() => expect(exported()).toHaveLength(1));
    expect((exported()[0]!.body as { finalize: boolean }).finalize).toBe(false);
await waitFor(() => expect(toasts.some((t) => t.variant === "success" && /Entwurf/.test(t.message))).toBe(true));
  });

  it("exports a FINAL invoice only when the switch is checked", async () => {
    const u = await open("Rechnungen");
    await pickProject(u);
    await u.click(screen.getByRole("checkbox", { name: /Finalisieren/ }));
    await u.click(screen.getByRole("button", { name: "Rechnung erstellen" }));
    await waitFor(() => expect(exported()).toHaveLength(1));
    expect((exported()[0]!.body as { finalize: boolean }).finalize).toBe(true);
await waitFor(() => expect(toasts.some((t) => t.variant === "success" && /final\)/.test(t.message))).toBe(true));
  });

  it("sends the project and the billing period", async () => {
    const u = await open("Rechnungen");
    await pickProject(u);
    const dates = screen.getAllByLabelText(/Von|Bis/);
    await u.type(dates[0]!, "2026-07-01");
    await u.type(dates[1]!, "2026-07-31");
    await u.click(screen.getByRole("button", { name: "Rechnung erstellen" }));
    await waitFor(() => expect(exported()).toHaveLength(1));
    expect(exported()[0]!.body).toEqual({
      projectId: 7,
      from: "2026-07-01",
      to: "2026-07-31",
      finalize: false,
    });
  });

  it("reports the billed hours the API confirmed", async () => {
    const u = await open("Rechnungen");
    await pickProject(u);
    await u.click(screen.getByRole("button", { name: "Rechnung erstellen" }));
await waitFor(() => expect(toasts.some((t) => t.variant === "success" && t.message.includes("Rechnung erstellt (7,50 h, Entwurf)."))).toBe(true));
  });

  it("reports zero hours rather than nothing when the API omits the total", async () => {
    respond(/from-project$/, {}, 200, "POST");
    const u = await open("Rechnungen");
    await pickProject(u);
    await u.click(screen.getByRole("button", { name: "Rechnung erstellen" }));
await waitFor(() => expect(toasts.some((t) => t.variant === "success" && t.message.includes("Rechnung erstellt (0,00 h, Entwurf)."))).toBe(true));
  });

  it("surfaces the API's error message", async () => {
    respond(/from-project$/, { error: "Keine Zeiten im Zeitraum." }, 422, "POST");
    const u = await open("Rechnungen");
    await pickProject(u);
    await u.click(screen.getByRole("button", { name: "Rechnung erstellen" }));
await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && t.message.includes("Keine Zeiten im Zeitraum"))).toBe(true));
  });

  it("falls back to the status code when the error carries no message", async () => {
    respond(/from-project$/, {}, 500, "POST");
    const u = await open("Rechnungen");
    await pickProject(u);
    await u.click(screen.getByRole("button", { name: "Rechnung erstellen" }));
await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && t.message.includes("HTTP 500"))).toBe(true));
  });

  it("does not refresh the export list after a failure", async () => {
    respond(/from-project$/, { error: "nope" }, 422, "POST");
    const u = await open("Rechnungen");
    await pickProject(u);
    await u.click(screen.getByRole("button", { name: "Rechnung erstellen" }));
await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && /./.test(t.message))).toBe(true));
    expect(sent("GET", /^\/lexware\/invoices$/)).toHaveLength(1);
  });

  it("BLOCKS a second click while the export is in flight", async () => {
    // A double click would create two invoices at Lexware.
    const release = holdRequests(/from-project$/);
    const u = await open("Rechnungen");
    await pickProject(u);
    const button = screen.getByRole("button", { name: "Rechnung erstellen" });
    await u.click(button);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    await u.click(button);
    expect(exported()).toHaveLength(1);
    release();
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });

  it("clears a previous error before re-exporting", async () => {
    const u = await open("Rechnungen");
    await u.click(screen.getByRole("button", { name: "Rechnung erstellen" }));
    await screen.findByText("Bitte ein Projekt wählen.");
    await pickProject(u);
    await u.click(screen.getByRole("button", { name: "Rechnung erstellen" }));
await waitFor(() => expect(toasts.some((t) => t.variant === "success" && /Rechnung erstellt/.test(t.message))).toBe(true));
    expect(screen.queryByText("Bitte ein Projekt wählen.")).toBeNull();
  });
});

describe("the past exports", () => {
  const INVOICE = {
    id: 3,
    lexware_invoice_id: "lx-inv-3",
    customer_name: "Acme GmbH",
    period_from: "2026-06-01",
    period_to: "2026-06-30",
    total_minutes: 615,
    line_item_count: 4,
    finalized: true,
    created_at: "2026-07-01T10:00:00",
  };

  it("lists an export with its period and hours", async () => {
    respond(/^\/lexware\/invoices$/, { invoices: [INVOICE] });
    await open("Rechnungen");
    expect(await screen.findByText("2026-07-01")).toBeTruthy();
    expect(screen.getByText("2026-06-01 – 2026-06-30")).toBeTruthy();
    expect(screen.getByText("10,25 h")).toBeTruthy();
  });

  it("distinguishes a finalized invoice from a draft", async () => {
    // Asserting only that both words appear passes even when they are swapped,
    // so each label is matched against its OWN row.
    respond(/^\/lexware\/invoices$/, {
      invoices: [INVOICE, { ...INVOICE, id: 4, customer_name: "Beta AG", finalized: false }],
    });
    await open("Rechnungen");
    await screen.findByText("Beta AG");
    const rows = screen.getAllByRole("row");
    const final = rows.find((r) => r.textContent!.includes("Acme GmbH"))!;
    const draft = rows.find((r) => r.textContent!.includes("Beta AG"))!;
    expect(within(final).getByText("Final")).toBeTruthy();
    expect(within(draft).getByText("Entwurf")).toBeTruthy();
  });

  it("shows a dash for an export without a period", async () => {
    respond(/^\/lexware\/invoices$/, { invoices: [{ ...INVOICE, period_from: null, period_to: null }] });
    await open("Rechnungen");
    const cells = await screen.findAllByText("—");
    expect(cells.length).toBeGreaterThan(0);
  });

  it("says so when nothing has been exported yet", async () => {
    await open("Rechnungen");
    expect(await screen.findByText("Noch keine Rechnungen exportiert.")).toBeTruthy();
  });

  it("does not list invoices carried by a non-OK response", async () => {
    respond(/^\/lexware\/invoices$/, { invoices: [INVOICE] }, 403);
    await open("Rechnungen");
    expect(await screen.findByText("Noch keine Rechnungen exportiert.")).toBeTruthy();
  });
});
