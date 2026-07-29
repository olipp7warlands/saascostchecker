import { describe, expect, it } from "vitest";
import { getTimelineSteps, type PurchaseRequestStatus, type TimelineStep } from "./timeline";

describe("getTimelineSteps (bloque 3.1)", () => {
  const cases: Array<[PurchaseRequestStatus, TimelineStep[]]> = [
    [
      "draft",
      [
        { key: "submitted", state: "upcoming" },
        { key: "review", state: "upcoming" },
        { key: "decision", state: "upcoming" },
        { key: "purchased", state: "upcoming" },
      ],
    ],
    [
      "pending",
      [
        { key: "submitted", state: "done" },
        { key: "review", state: "active" },
        { key: "decision", state: "upcoming" },
        { key: "purchased", state: "upcoming" },
      ],
    ],
    [
      "approved",
      [
        { key: "submitted", state: "done" },
        { key: "review", state: "done" },
        { key: "decision", state: "done" },
        { key: "purchased", state: "upcoming" },
      ],
    ],
    [
      "purchased",
      [
        { key: "submitted", state: "done" },
        { key: "review", state: "done" },
        { key: "decision", state: "done" },
        { key: "purchased", state: "done" },
      ],
    ],
    // "rejected" es el único caso con 3 pasos, no 4: una vez rechazada, el
    // paso "purchased" es genuinamente inalcanzable, no solo "todavía no".
    [
      "rejected",
      [
        { key: "submitted", state: "done" },
        { key: "review", state: "done" },
        { key: "decision", state: "rejected" },
      ],
    ],
  ];

  it.each(cases)("%s -> %j", (status, expected) => {
    expect(getTimelineSteps(status)).toEqual(expected);
  });
});
