import { describe, expect, it } from "vitest";
import { routing } from "./routing";

describe("routing", () => {
  it("supports es and en with es as default", () => {
    expect(routing.locales).toEqual(["es", "en"]);
    expect(routing.defaultLocale).toBe("es");
  });
});
