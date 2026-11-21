import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
vi.mock("@/app/actions", () => ({
  approvePreselectedAction: vi.fn(),
  commitAction: vi.fn(),
  requestRemainderAction: vi.fn(),
  approveAction: vi.fn(),
  approveSplitAction: vi.fn(),
  rejectAction: vi.fn(),
  undoAction: vi.fn(),
}));
const navigation = vi.hoisted(() => ({ pathname: "/review" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
import { ReviewQueue, InvoicePanels } from "@/components/review-queue";
import { ReviewDetail, type ReviewCredit } from "@/components/review-detail";
import { Sheet } from "@/components/ui/sheet";
import { LedgerAccessProvider } from "@/components/ledger-access";
import { ActivityTable } from "@/components/activity-table";
import { DeliveryList } from "@/components/delivery-list";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TallyBreadcrumb } from "@/components/tally-breadcrumb";
import { Shell } from "@/components/shell";
import { reviewModel } from "@/server/views";
import { deliveryList } from "@/server/deliveries";
import { freshDb, fixture, NOW } from "../helpers";
import { importBytes } from "@/server/flow";
import { loadSnapshot, run } from "@/server/ledger";
import { operator as by } from "./helpers";
import type { AuditEvent, PolicyActor } from "@/domain/types";
import type { AllocationId, ReferenceNumber } from "@/domain/ids";
import { cents } from "@/domain/money";

function detail(card: ReviewCredit, editable = true) {
  return renderToStaticMarkup(
    <LedgerAccessProvider value={editable}>
      <Sheet open><ReviewDetail card={card} /></Sheet>
    </LedgerAccessProvider>,
  );
}

test("Shell keeps navigation, theme and access notice without a global policy-date label", () => {
  const html = renderToStaticMarkup(<Shell><p>Workspace content</p></Shell>);
  for (const text of ["Workspace content", "Toggle theme", "Toggle Sidebar", "Settings", "Supplier actions are locked"])
    expect(html).toContain(text);
  expect(html).not.toContain("Policy date");
  expect(html).not.toContain("Invoice due dates and delivery policies are evaluated as of this date.");
});

test("Review starts closed with individual actions and no batch controls or checkboxes", async () => {
  const db = freshDb();
  try {
    await importBytes(db, fixture("fixtures/dbs/demo.csv"), "demo.csv", undefined, NOW);
    const cards = reviewModel(loadSnapshot(db)).cards;
    expect(cards.some((card) => card.preselected)).toBe(true);
    const html = renderToStaticMarkup(
      <LedgerAccessProvider value={true}><ReviewQueue cards={cards} /></LedgerAccessProvider>,
    );
    for (const text of ['type="checkbox"', "Batch operation", "credits selected", "Approve selected allocations", "Reconcile approvals"])
      expect(html).not.toContain(text);
    expect(html).not.toMatch(/checked=""/);
    expect(html).not.toContain("Matching evidence");
    expect(html).toContain("Review<span");
    const panels = renderToStaticMarkup(createElement(InvoicePanels, {
      invoices: reviewModel(loadSnapshot(db)).invoices,
    }));
    expect(panels).toContain("Collect invoice balances");
    expect(panels).toContain("Request S$500.00");
    expect(panels).not.toMatch(/<details|<summary/);
  } finally { db.close(); }
});

test("Incoming credits show every status with search and individual Review actions only", async () => {
  const db = freshDb();
  try {
    await importBytes(db, fixture("fixtures/dbs/demo.csv"), "demo.csv", undefined, NOW);
    const cards = reviewModel(loadSnapshot(db)).cards;
    const partial = cards.find((card) => card.rule === "R3")!;
    const exact = cards.find((card) => card.rule === "R1")!;
    for (const card of [partial, exact])
      expect(run(db, { kind: "approve", suggestionId: card.suggestionId!, pick: null, by }, NOW).ok).toBe(true);
    const approved = reviewModel(loadSnapshot(db)).cards.find((card) => card.creditId === exact.creditId)!;
    expect(run(db, { kind: "commit_approved", allocationIds: approved.approvedAllocationIds, by }, NOW).ok).toBe(true);
    const before = loadSnapshot(db);
    const mixed = reviewModel(before).cards;
    expect(new Set(mixed.map((card) => card.state))).toEqual(new Set(["Suggested", "Unmatched", "Approved", "Reconciled"]));
    const html = renderToStaticMarkup(
      <LedgerAccessProvider value={true}><ReviewQueue cards={mixed} /></LedgerAccessProvider>,
    );
    expect(html).toContain('aria-label="Search credits"');
    expect(html).not.toContain("Filter credits by status");
    expect(html).not.toContain("review the evidence before applying");
    expect(html).not.toContain(`${mixed.length} credits`);
    expect(html).not.toContain("clear the status filter");
    expect(html).not.toContain("Approve exact matches");
    expect(html).not.toContain("Reconcile approvals");
    expect(html).not.toContain("credits selected");
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toMatch(/checked=""/);
    for (const card of mixed) {
      expect(html.split(`Review<span class="sr-only"> ${card.name}</span>`)).toHaveLength(3);
      expect(html).toContain(`>${card.state}<`);
    }
    expect(loadSnapshot(db)).toEqual(before);
  } finally { db.close(); }
});

test.each(["R1", "R4", "R3"])("Individual %s reconciliation submits only this credit's approvals without applying money twice", async (rule) => {
  const db = freshDb();
  try {
    await importBytes(db, fixture("fixtures/dbs/demo.csv"), "demo.csv", undefined, NOW);
    const cards = reviewModel(loadSnapshot(db)).cards;
    const target = cards.find((card) => card.rule === rule)!;
    const other = cards.find((card) => card.rule === (rule === "R4" ? "R3" : "R4"))!;
    expect(detail(target)).not.toMatch(/>Reconcile<\/button>/);
    for (const card of [target, other])
      expect(run(db, { kind: "approve", suggestionId: card.suggestionId!, pick: null, by }, NOW).ok).toBe(true);
    const before = loadSnapshot(db);
    const approved = reviewModel(before).cards.find((card) => card.creditId === target.creditId)!;
    const html = detail(approved);
    const forms = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(([form]) => form);
    const reconciliation = forms.filter((form) => />Reconcile<\/button>/.test(form));
    expect(reconciliation).toHaveLength(1);
    expect(reconciliation[0]).not.toMatch(/<fieldset[^>]*disabled/);
    const locked = [...detail(approved, false).matchAll(/<form\b[\s\S]*?<\/form>/g)]
      .find(([form]) => />Reconcile<\/button>/.test(form))?.[0];
    expect(locked).toMatch(/<fieldset[^>]*disabled/);
    const ids = [...reconciliation[0].matchAll(/name="allocationId" value="([^"]+)"/g)].map((match) => match[1] as AllocationId);
    expect(ids).toEqual(approved.approvedAllocationIds);
    expect(ids).toHaveLength(rule === "R4" ? 2 : 1);
    expect(html).toContain("Undo allocation approval");
    expect(loadSnapshot(db)).toEqual(before);
    expect(run(db, { kind: "commit_approved", allocationIds: ids, by }, NOW).ok).toBe(true);
    const after = loadSnapshot(db);
    expect(after.invoices).toEqual(before.invoices);
    expect(after.credits).toEqual(before.credits);
    expect(after.audit.slice(before.audit.length).map((event) => event.entityId)).toEqual(ids);
    for (const allocation of before.allocations.values()) {
      if (ids.includes(allocation.id)) expect(after.allocations.get(allocation.id)?.state).toBe("reconciled");
      else expect(after.allocations.get(allocation.id)).toEqual(allocation);
    }
    const reconciled = reviewModel(after).cards.find((card) => card.creditId === target.creditId)!;
    expect(reconciled.state).toBe("Reconciled");
    expect(detail(reconciled)).not.toMatch(/>Reconcile<\/button>|Undo allocation approval/);
    const stillApproved = reviewModel(after).cards.find((card) => card.creditId === other.creditId)!;
    expect(stillApproved.state).toBe("Approved");
    expect(detail(stillApproved)).toMatch(/>Reconcile<\/button>/);
    expect(detail(stillApproved)).toContain("Undo allocation approval");
    expect(run(db, { kind: "commit_approved", allocationIds: ids, by }, NOW).ok).toBe(false);
    expect(loadSnapshot(db)).toEqual(after);
  } finally { db.close(); }
});

test("Individual reconciliation remains available for the approved portion of a partially finalized split", async () => {
  const db = freshDb();
  try {
    await importBytes(db, fixture("fixtures/dbs/demo.csv"), "demo.csv", undefined, NOW);
    const target = reviewModel(loadSnapshot(db)).cards.find((card) => card.rule === "R4")!;
    expect(run(db, { kind: "approve", suggestionId: target.suggestionId!, pick: null, by }, NOW).ok).toBe(true);
    const approved = reviewModel(loadSnapshot(db)).cards.find((card) => card.creditId === target.creditId)!;
    expect(run(db, { kind: "commit_approved", allocationIds: [approved.approvedAllocationIds[0]], by }, NOW).ok).toBe(true);
    const before = loadSnapshot(db);
    const mixed = reviewModel(before).cards.find((card) => card.creditId === target.creditId)!;
    expect(mixed.committed).toBe(true);
    expect(mixed.approvedAllocationIds).toHaveLength(1);
    const html = detail(mixed);
    expect(html).toMatch(/>Reconcile<\/button>/);
    expect(html).toContain(`name="allocationId" value="${mixed.approvedAllocationIds[0]}"`);
    expect(html).not.toContain(`name="allocationId" value="${approved.approvedAllocationIds[0]}"`);
    expect(loadSnapshot(db)).toEqual(before);
  } finally { db.close(); }
});

test("Activity shows concise searchable metadata without technical payloads or category controls and leaves audit intact", () => {
  const db = freshDb();
  try {
    const before = loadSnapshot(db);
    const actor: PolicyActor = { ...by, access: "loopback_development" };
    const event: AuditEvent = {
      ...before.audit[0],
      actor,
      entityId: "DLV-201",
      entity: "delivery",
      action: "override_hold",
      evidence: { kind: "human_reason", reason: "Customer agreed credit until Friday" },
      before: { marker: "before-value" },
      after: { marker: "after-value" },
    };
    const copy = structuredClone(event);
    const html = renderToStaticMarkup(createElement(ActivityTable, { events: [event], filterable: true }));
    for (const text of ["Related entity", "Actor", "Date", "Time", "17 Nov 2026", "10:00", "Search activity", "Customer agreed credit until Friday", by.name, event.entityId, event.id, event.at])
      expect(html).toContain(text);
    for (const text of ["View record", "before-value", "after-value", "loopback_development", "Filter activity", "All activity", "Newest first", "Singapore time", "<details", "<pre"])
      expect(html).not.toContain(text);
    expect(html).not.toMatch(/\d+ events? shown/);
    expect(event).toEqual(copy);
    expect(loadSnapshot(db)).toEqual(before);
    const rejected = renderToStaticMarkup(createElement(ActivityTable, {
      events: [{ ...event, action: "reject", evidence: { kind: "human_reason", reason: "rejected" } }],
    }));
    expect(rejected).toContain("Allocation suggestion rejected");
    expect(rejected).not.toMatch(/>rejected<|Reason:/);
  } finally { db.close(); }
});

test("Activity retains useful readable policy changes without raw state objects", () => {
  const db = freshDb();
  try {
    const event: AuditEvent = {
      ...loadSnapshot(db).audit[0], action: "policy_updated",
      before: { overdueBalanceThreshold: 3000, overdueDaysThreshold: null, version: 1, basis: "due_date" },
      after: { overdueBalanceThreshold: 5000, overdueDaysThreshold: 2, version: 2, basis: "due_date" },
    };
    const html = renderToStaticMarkup(<ActivityTable events={[event]} />);
    for (const text of ["Overdue threshold", "S$30.00", "S$50.00", "Grace days after due date"])
      expect(html).toContain(text);
    expect(html).not.toContain("overdueBalanceThreshold");
    expect(html).not.toContain("<details");
  } finally { db.close(); }
});

test("Delivery presentation separates bank evidence, payment and decision columns, with aligned amounts and visible mobile debt", () => {
  const db = freshDb();
  try {
    const rows = deliveryList(loadSnapshot(db));
    const html = renderToStaticMarkup(<DeliveryList rows={rows} />);
    for (const text of ["On credit", "Not requested", "Bank evidence", "Delivery payment", "Delivery decision", "Invoice debt", "overdue"])
      expect(html).toContain(text);
    expect(html).not.toContain(">Paid<");
    expect(html).not.toContain("<details");
    expect(html).toMatch(/<th[^>]*text-right[^>]*>Amount<\/th>/);
    expect(html).toMatch(/<th[^>]*text-right[^>]*>Invoice debt<\/th>/);
    expect(html).not.toMatch(/<th[^>]*text-right[^>]*>(Action|Delivery decision|Bank evidence)/);
    const proposed = { ...rows[0], delivery: { ...rows[0].delivery, status: "proposed_pay_first" as const } };
    const proposalHtml = renderToStaticMarkup(<DeliveryList rows={[proposed]} />);
    expect(proposalHtml).toContain("Pay-first proposed");
    expect(proposalHtml).not.toContain("Pay-first approved");
    const actionLinks = [...html.matchAll(/<a[^>]*href="\/deliveries\/DLV-201"[^>]*>Evaluate<\/a>/g)];
    expect(actionLinks).toHaveLength(2);
    for (const [link] of actionLinks) {
      expect(link).toContain("border-border");
      expect(link).not.toContain("border-transparent");
      expect(link).not.toContain("underline");
    }
  } finally { db.close(); }
});

test("Delivery dates lead desktop rows without repeating in customer cells and remain in mobile cards", () => {
  const db = freshDb();
  try {
    const rows = deliveryList(loadSnapshot(db));
    expect(rows).toHaveLength(1);
    const html = renderToStaticMarkup(<DeliveryList rows={rows} />);
    const headers = [...html.matchAll(/<th\b[^>]*>(.*?)<\/th>/g)].map((match) => match[1]);
    expect(headers).toEqual([
      "Delivery date", "Delivery / customer", "Amount", "Invoice debt",
      "Bank evidence", "Delivery payment", "Delivery decision", "Action",
    ]);
    const cells = [...html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
    expect(cells).toHaveLength(headers.length);
    expect(cells[0]).toBe("18 Nov 2026");
    expect(cells[1]).toContain(rows[0].customer.name);
    expect(cells[1]).toContain(rows[0].delivery.id);
    expect(cells[1]).not.toContain("18 Nov 2026");
    const mobile = html.match(/<ul\b[\s\S]*?<\/ul>/)?.[0];
    expect(mobile).toContain("DLV-201 · 18 Nov 2026");
    const empty = renderToStaticMarkup(<DeliveryList rows={[]} />);
    expect(empty).toContain("Delivery date");
    expect(empty).not.toMatch(/<td\b|<li\b/);
  } finally { db.close(); }
});

test("Collection always shows positive balances, omits settled invoices and leaves paid history in the model", async () => {
  const db = freshDb();
  try {
    await importBytes(db, fixture("fixtures/dbs/demo.csv"), "demo.csv", undefined, NOW);
    let cards = reviewModel(loadSnapshot(db)).cards;
    const partial = cards.find((card) => card.rule === "R3")!;
    expect(run(db, { kind: "approve", suggestionId: partial.suggestionId!, pick: null, by }, NOW).ok).toBe(true);
    cards = reviewModel(loadSnapshot(db)).cards;
    const exact = cards.find((card) => card.rule === "R1")!;
    expect(run(db, { kind: "approve", suggestionId: exact.suggestionId!, pick: null, by }, NOW).ok).toBe(true);
    const model = reviewModel(loadSnapshot(db));
    expect(model.invoices.find((invoice) => invoice.id === exact.options[0].invoiceId)?.remaining).toBe(0);
    const html = renderToStaticMarkup(<InvoicePanels invoices={model.invoices} />);
    expect(html).toContain("Request S$38.40");
    expect(html).toContain("Partially paid");
    expect(html).not.toContain(`aria-label="Invoice ${exact.options[0].invoiceId}"`);
    expect(html).not.toContain("Request S$0.00");
    expect(html).toContain("All customer invoices");
    const zero = { ...model.invoices[0], remaining: cents(0), status: "Open" };
    const empty = renderToStaticMarkup(<InvoicePanels invoices={[zero]} />);
    expect(empty).toContain("No outstanding invoice balances");
    expect(empty).not.toContain("type=\"submit\"");
    const unresolved = renderToStaticMarkup(<InvoicePanels invoices={[{ ...model.invoices[0], remaining: cents(3840), unresolvedReference: "TALLY-INV-104-1" as ReferenceNumber }]} />);
    expect(unresolved).toContain("TALLY-INV-104-1");
    expect(unresolved).not.toContain("type=\"submit\"");
  } finally { db.close(); }
});

test("Matching uses one evidence section, preserves payer confirmation and uncertainty, and never changes stored matching facts", async () => {
  const db = freshDb();
  try {
    await importBytes(db, fixture("fixtures/dbs/demo.csv"), "demo.csv", undefined, NOW);
    const before = loadSnapshot(db);
    const cards = reviewModel(before).cards;
    const partial = cards.find((card) => card.rule === "R3")!;
    const html = detail(partial);
    for (const text of ["Confirmed payer", "ABC Catering", "INV-104", "Proposed allocation", "Remaining after approval", "S$461.60", "S$38.40", "shortfall is unknown"])
      expect(html).toContain(text);
    expect(html.match(/<h3[^>]*>Matching evidence<\/h3>/g)).toHaveLength(1);
    expect(html).not.toMatch(/Recorded matching details|<details|possible short payment/);
    expect(html).not.toContain(partial.reason);
    const ambiguous = cards.find((card) => card.kind === "choose_one")!;
    const ambiguousHtml = detail(ambiguous);
    expect(ambiguousHtml).toContain("match is not confirmed");
    expect(ambiguousHtml).not.toMatch(/checked=""/);
    expect(ambiguousHtml).toMatch(/<button[^>]*disabled[^>]*>Approve allocation/);
    const stale = detail({ ...partial, valid: false });
    expect(stale).toContain("no longer fits the available balances");
    expect(stale).toMatch(/<button[^>]*disabled[^>]*>Approve allocation/);
    const unmatched = cards.find((card) => card.state === "Unmatched")!;
    const conflict = "Older invoice reference is ambiguous or conflicts with the confirmed payer; review manually.";
    expect(detail({ ...unmatched, reason: conflict })).toContain(conflict);
    const withHint = detail({ ...partial, ai: "Duplicated generated narrative", referenceHint: { customer: "Another possible payer", invoices: ["INV-105"] } });
    expect(withHint).toContain("AI reference hint · unverified");
    expect(withHint).toContain("Another possible payer");
    expect(withHint).not.toContain("Duplicated generated narrative");
    expect(loadSnapshot(db)).toEqual(before);
  } finally { db.close(); }
});

test("Sidebar has six destinations and import stays within Bank credits", () => {
  for (const pathname of ["/review", "/import"]) {
    navigation.pathname = pathname;
    const html = renderToStaticMarkup(<SidebarProvider><AppSidebar /></SidebarProvider>);
    const links = [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>/g)];
    expect(links.map((match) => match[1]).filter((href) => href !== "/")).toEqual(["/deliveries", "/review", "/customer", "/audit", "/settings"]);
    expect(html).toContain("Bank credits");
    expect(html).toContain("Activity");
    expect(html).toContain("Workspace");
    expect(html).toContain("Management");
    expect(html).not.toContain('href="/import"');
    expect(links.find((match) => match[1] === "/review")?.[0]).toContain('data-active=""');
  }
  const breadcrumb = renderToStaticMarkup(<TallyBreadcrumb />);
  expect(breadcrumb).toContain('href="/review"');
  expect(breadcrumb).toContain("Bank credits");
  expect(breadcrumb).toContain("Import");
  navigation.pathname = "/review";
});

test("Review and Activity show meaningful empty states", () => {
  expect(renderToStaticMarkup(createElement(ReviewQueue, { cards: [] }))).toContain("No incoming credits yet");
  expect(renderToStaticMarkup(createElement(ActivityTable, { events: [] }))).toContain("No activity yet");
});
