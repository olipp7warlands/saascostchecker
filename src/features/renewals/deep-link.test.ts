import { describe, expect, it } from "vitest";
import { buildContractPath } from "./deep-link";

describe("buildContractPath", () => {
  it("devuelve el path relativo con el ancla #contract-{id}, sin origen", () => {
    expect(buildContractPath("es", "vendor-1", "contract-1")).toBe(
      "/es/vendors/vendor-1#contract-contract-1",
    );
  });

  it("respeta el locale en la ruta", () => {
    expect(buildContractPath("en", "vendor-1", "contract-1")).toBe(
      "/en/vendors/vendor-1#contract-contract-1",
    );
  });
});
