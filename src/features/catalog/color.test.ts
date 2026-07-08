import { describe, expect, it } from "vitest";
import { colorForName } from "./color";

describe("colorForName", () => {
  it("is deterministic: the same name always yields the same color", () => {
    expect(colorForName("Figma")).toBe(colorForName("Figma"));
    expect(colorForName("Notion")).toBe(colorForName("Notion"));
  });

  it("yields different colors for different names", () => {
    const names = ["Figma", "Notion", "Slack", "HubSpot", "Loom", "Datadog", "Zapier"];
    const colors = new Set(names.map(colorForName));
    expect(colors.size).toBeGreaterThan(1);
  });

  it("returns a valid hsl() string with fixed saturation/lightness", () => {
    expect(colorForName("Zapier")).toMatch(/^hsl\(\d{1,3} 55% 40%\)$/);
  });
});
