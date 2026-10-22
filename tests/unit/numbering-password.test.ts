import { describe, expect, it } from "vitest";
import { findTicketNumbers, formatTicketNumber } from "@/core/tickets/numbering";
import { checkPassword } from "@/core/auth/password";

describe("ticket numbers", () => {
  it("pads with zeros", () => {
    expect(formatTicketNumber("INC", 1042)).toBe("INC0001042");
    expect(formatTicketNumber("REQ", 310, 7)).toBe("REQ0000310");
    expect(formatTicketNumber("Q", 5, 3)).toBe("Q005");
  });
  it("rejects invalid counters", () => {
    expect(() => formatTicketNumber("INC", 0)).toThrow();
  });
  it("finds numbers with known prefixes in subjects", () => {
    expect(findTicketNumbers("Re: [INC0001042] Printer jam (see also REQ0000310, XYZ0000001)", ["INC", "REQ"])).toEqual(["INC0001042", "REQ0000310"]);
    expect(findTicketNumbers("WINC0001042", ["INC"])).toEqual([]);
  });
});

describe("password policy", () => {
  const policy = { minLength: 12, requireUppercase: true, requireLowercase: true, requireNumber: true, requireSymbol: true };
  it("lists every problem", () => {
    expect(checkPassword("short", policy)).toHaveLength(4);
  });
  it("accepts a strong password", () => {
    expect(checkPassword("Correct-Horse-9-Battery", policy)).toEqual([]);
  });
});
