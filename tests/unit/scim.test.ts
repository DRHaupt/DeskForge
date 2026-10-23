import { describe, expect, it } from "vitest";
import { changesFromPatch, changesFromResource, displayNameFrom, parseFilter, ScimError } from "@/core/scim/scim";

describe("parseFilter", () => {
  it("handles what Entra sends", () => {
    expect(parseFilter('userName eq "a.b@drhaupt.ca"')).toEqual({ attr: "userName", value: "a.b@drhaupt.ca" });
    expect(parseFilter('externalId eq "0c1d-22"')).toEqual({ attr: "externalId", value: "0c1d-22" });
    expect(parseFilter('emails[type eq "work"].value eq "x@y.z"')).toEqual({ attr: "email", value: "x@y.z" });
    expect(parseFilter("UserName EQ \"Q\\\"uote\"")).toEqual({ attr: "userName", value: 'Q"uote' });
    expect(parseFilter(null)).toBeNull();
  });
  it("rejects anything else", () => {
    expect(() => parseFilter('title co "x"')).toThrow(ScimError);
    expect(() => parseFilter('nickName eq "x"')).toThrow(/isn't supported/);
  });
});

describe("changesFromResource", () => {
  it("maps an Entra create request", () => {
    const c = changesFromResource({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      externalId: "8f3c",
      userName: "jamie.new@drhaupt.ca",
      active: "True",
      displayName: "Jamie New",
      title: "Technician",
      emails: [{ primary: true, type: "work", value: "Jamie.New@drhaupt.ca" }],
      phoneNumbers: [{ type: "mobile", value: "555-1000" }],
      name: { givenName: "Jamie", familyName: "New" },
    });
    expect(c).toMatchObject({ userName: "jamie.new@drhaupt.ca", externalId: "8f3c", active: true, displayName: "Jamie New", email: "Jamie.New@drhaupt.ca", phone: "555-1000", title: "Technician" });
  });
  it("requires userName and defaults active", () => {
    expect(() => changesFromResource({})).toThrow(/userName/);
    expect(changesFromResource({ userName: "x" }).active).toBe(true);
  });
});

describe("changesFromPatch", () => {
  it("handles path operations with string booleans", () => {
    const c = changesFromPatch({
      Operations: [
        { op: "Replace", path: "active", value: "False" },
        { op: "replace", path: 'emails[type eq "work"].value', value: "new@drhaupt.ca" },
        { op: "replace", path: "name.givenName", value: "Sam" },
        { op: "remove", path: "title" },
        { op: "add", path: "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department", value: "IT" },
      ],
    });
    expect(c).toEqual({ active: false, email: "new@drhaupt.ca", givenName: "Sam", title: null });
  });
  it("handles a value object without a path", () => {
    expect(changesFromPatch({ Operations: [{ op: "replace", value: { active: false, displayName: "New Name", "name.familyName": "Z" } }] })).toEqual({ active: false, displayName: "New Name", familyName: "Z" });
  });
  it("rejects bad input", () => {
    expect(() => changesFromPatch({})).toThrow(/Operations/);
    expect(() => changesFromPatch({ Operations: [{ op: "move", path: "x" }] })).toThrow(/Unsupported op/);
    expect(() => changesFromPatch({ Operations: [{ op: "replace", path: "active", value: "maybe" }] })).toThrow(/boolean/);
  });
});

it("displayNameFrom falls back sensibly", () => {
  expect(displayNameFrom({ givenName: "A", familyName: "B" }, "x")).toBe("A B");
  expect(displayNameFrom({}, "fallback@x.y")).toBe("fallback@x.y");
});
