import { collectHistoryMessageIds } from "./_shared/history.ts";

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message + " — received: " + JSON.stringify(actual));
  }
}

Deno.test("Gmail history collects new messages and messages newly moved to Inbox", () => {
  const ids = collectHistoryMessageIds([
    {
      messagesAdded: [
        { message: { id: "new-1" } },
        { message: { id: "new-2" } }
      ],
      labelsAdded: [
        { message: { id: "inbox-1" }, labelIds: ["INBOX"] },
        { message: { id: "label-only" }, labelIds: ["STARRED"] }
      ]
    },
    {
      messagesAdded: [{ message: { id: "new-1" } }],
      labelsAdded: [{ message: { id: "inbox-2" }, labelIds: ["INBOX", "IMPORTANT"] }]
    }
  ]);

  assertEquals(ids, ["new-1", "new-2", "inbox-1", "inbox-2"], "Unique Gmail message IDs");
});

Deno.test("Gmail history ignores malformed changes and non-Inbox label updates", () => {
  const ids = collectHistoryMessageIds([
    null,
    {},
    {
      messagesAdded: [{ message: {} }, { message: { id: 42 } }],
      labelsAdded: [
        { message: { id: "starred-only" }, labelIds: ["STARRED"] },
        { message: { id: "important-only" }, labelIds: ["IMPORTANT"] },
        { message: { id: "inbox-valid" }, labelIds: ["INBOX"] }
      ]
    }
  ]);

  assertEquals(ids, ["inbox-valid"], "Only supported history events");
});