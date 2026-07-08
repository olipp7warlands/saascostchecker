import { describe, expect, it } from "vitest";
import { decodeCsvBuffer, parseCsvAmount, parseCsvDate } from "./parsing";

describe("parseCsvDate", () => {
  it("parsea DD/MM/YYYY (formato español por defecto)", () => {
    expect(parseCsvDate("05/03/2026", "DD/MM/YYYY")).toBe("2026-03-05");
  });

  it("parsea con separadores - y .", () => {
    expect(parseCsvDate("05-03-2026", "DD/MM/YYYY")).toBe("2026-03-05");
    expect(parseCsvDate("05.03.2026", "DD/MM/YYYY")).toBe("2026-03-05");
  });

  it("parsea YYYY-MM-DD", () => {
    expect(parseCsvDate("2026-03-05", "YYYY-MM-DD")).toBe("2026-03-05");
  });

  it("parsea MM/DD/YYYY", () => {
    expect(parseCsvDate("03/05/2026", "MM/DD/YYYY")).toBe("2026-03-05");
  });

  it("expande años de 2 dígitos", () => {
    expect(parseCsvDate("05/03/26", "DD/MM/YYYY")).toBe("2026-03-05");
  });

  it("rechaza fechas inexistentes", () => {
    expect(parseCsvDate("31/02/2026", "DD/MM/YYYY")).toBeNull();
    expect(parseCsvDate("00/01/2026", "DD/MM/YYYY")).toBeNull();
    expect(parseCsvDate("13/13/2026", "DD/MM/YYYY")).toBeNull();
  });

  it("rechaza texto no parseable", () => {
    expect(parseCsvDate("", "DD/MM/YYYY")).toBeNull();
    expect(parseCsvDate("no es una fecha", "DD/MM/YYYY")).toBeNull();
    expect(parseCsvDate("05/03", "DD/MM/YYYY")).toBeNull();
  });
});

describe("parseCsvAmount", () => {
  it("parsea coma decimal española", () => {
    expect(parseCsvAmount("45,00", "es")).toBe(45);
    expect(parseCsvAmount("45,50", "es")).toBe(45.5);
  });

  it("parsea miles con punto + coma decimal", () => {
    expect(parseCsvAmount("1.234,56", "es")).toBe(1234.56);
    expect(parseCsvAmount("12.345.678,90", "es")).toBe(12345678.9);
  });

  it("parsea negativos con signo y con paréntesis", () => {
    expect(parseCsvAmount("-45,00", "es")).toBe(-45);
    expect(parseCsvAmount("(45,00)", "es")).toBe(-45);
  });

  it("ignora símbolo de moneda y espacios", () => {
    expect(parseCsvAmount("45,00 €", "es")).toBe(45);
    expect(parseCsvAmount("1 234,56", "es")).toBe(1234.56);
  });

  it("parsea formato en (punto decimal, coma miles)", () => {
    expect(parseCsvAmount("1,234.56", "en")).toBe(1234.56);
    expect(parseCsvAmount("45.50", "en")).toBe(45.5);
  });

  it("rechaza texto no numérico", () => {
    expect(parseCsvAmount("", "es")).toBeNull();
    expect(parseCsvAmount("N/A", "es")).toBeNull();
  });
});

describe("decodeCsvBuffer", () => {
  it("decodifica UTF-8 válido", () => {
    const buffer = new TextEncoder().encode("fecha,importe,descripción\n").buffer;
    const result = decodeCsvBuffer(buffer);
    expect(result.encoding).toBe("utf-8");
    expect(result.text).toContain("descripción");
  });

  it("cae a latin1 cuando el buffer no es UTF-8 válido", () => {
    // "descripción" en latin1 (ISO-8859-1): "n" con tilde ocupa 1 byte (0xF3),
    // una secuencia inválida como UTF-8 en solitario.
    const latin1Bytes = Buffer.from("descripci\xf3n", "latin1");
    const result = decodeCsvBuffer(latin1Bytes.buffer.slice(latin1Bytes.byteOffset, latin1Bytes.byteOffset + latin1Bytes.byteLength));
    expect(result.encoding).toBe("latin1");
    expect(result.text).toBe("descripción");
  });
});
