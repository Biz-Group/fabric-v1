import { describe, expect, test } from "vitest";
import type { GenericValidator } from "convex/values";
import schema from "./schema";
import { ERASURE, EXPORT_POLICY, TENANT_DATA } from "./lib/tenantData";
import { SCAN_HANDLERS } from "./personErasure";

/**
 * Keeps lib/tenantData.ts honest against the schema. A workspace purge, export
 * or person erasure only touches what the registry lists, so anything missing
 * here would silently survive an offboarding.
 */

type AnyValidator = GenericValidator & {
  kind: string;
  fields?: Record<string, AnyValidator>;
  element?: AnyValidator;
  members?: AnyValidator[];
  value?: AnyValidator;
  tableName?: string;
};

type TableDef = {
  validator: AnyValidator;
  " indexes"(): { indexDescriptor: string; fields: string[] }[];
};

const tables = schema.tables as unknown as Record<string, TableDef>;

/** Dotted paths (`[]` for array elements) of every field matching `match`. */
function fieldPaths(
  validator: AnyValidator,
  match: (name: string, validator: AnyValidator) => boolean,
): string[] {
  const found = new Set<string>();
  const walk = (node: AnyValidator, path: string, name: string) => {
    if (path && match(name, node)) found.add(path);
    switch (node.kind) {
      case "object":
        for (const [key, child] of Object.entries(node.fields ?? {})) {
          walk(child, path ? `${path}.${key}` : key, key);
        }
        break;
      case "array":
        if (node.element) walk(node.element, `${path}[]`, name);
        break;
      case "union":
        // A discriminated union's members share the parent path.
        for (const member of node.members ?? []) walk(member, path, name);
        break;
      case "record":
        if (node.value) walk(node.value, `${path}{}`, name);
        break;
    }
  };
  walk(validator, "", "");
  return [...found].sort();
}

const isIdOf = (table: string) => (_: string, node: AnyValidator) =>
  node.kind === "id" && node.tableName === table;

const VENDOR_ID = /^(clerk|elevenlabs)\w*Id$/i;
const isVendorIdField = (name: string, node: AnyValidator) =>
  node.kind === "string" && VENDOR_ID.test(name) && name !== "clerkOrgId";

const schemaTables = Object.keys(tables).sort();

describe("tenant data registry", () => {
  test("classifies exactly the tables in the schema", () => {
    expect(Object.keys(TENANT_DATA).sort()).toEqual(schemaTables);
  });

  test.each(schemaTables)("%s: org scope matches a clerkOrgId field", (table) => {
    const entry = TENANT_DATA[table as keyof typeof TENANT_DATA];
    const hasOrgField = fieldPaths(tables[table].validator, (name) => name === "clerkOrgId")
      .includes("clerkOrgId");
    if (entry.scope === "global") {
      expect(hasOrgField, `${table} has clerkOrgId but is registered global`).toBe(false);
    } else {
      expect(hasOrgField, `${table} is org-scoped but has no clerkOrgId`).toBe(true);
    }
  });

  test.each(schemaTables)("%s: org index exists and leads with clerkOrgId", (table) => {
    const entry = TENANT_DATA[table as keyof typeof TENANT_DATA];
    if (entry.scope === "org") {
      const index = tables[table][" indexes"]().find(
        (candidate) => candidate.indexDescriptor === entry.orgIndex,
      );
      expect(index, `${table}.${entry.orgIndex} is not defined`).toBeDefined();
      expect(index!.fields[0]).toBe("clerkOrgId");
    } else if (entry.scope === "orgChild") {
      expect(TENANT_DATA[entry.parent].scope).toBe("org");
      const parentField = fieldPaths(tables[table].validator, isIdOf(entry.parent));
      expect(parentField.length, `${table} has no ${entry.parent} id`).toBeGreaterThan(0);
    }
  });

  test.each(schemaTables)("%s: every stored file is listed", (table) => {
    const entry = TENANT_DATA[table as keyof typeof TENANT_DATA];
    expect([...(entry.storageFields ?? [])].sort()).toEqual(
      fieldPaths(tables[table].validator, isIdOf("_storage")),
    );
  });

  test.each(schemaTables)("%s: every user id is listed", (table) => {
    const entry = TENANT_DATA[table as keyof typeof TENANT_DATA];
    expect([...(entry.userIdFields ?? [])].sort()).toEqual(
      fieldPaths(tables[table].validator, isIdOf("users")),
    );
  });

  test.each(schemaTables)("%s: every vendor record id is listed", (table) => {
    const entry = TENANT_DATA[table as keyof typeof TENANT_DATA];
    expect((entry.externalIdFields ?? []).map((f) => f.field).sort()).toEqual(
      fieldPaths(tables[table].validator, isVendorIdField),
    );
  });

  test("exports only org tables it can page through", () => {
    for (const [table, policy] of Object.entries(EXPORT_POLICY)) {
      if (policy !== true) continue;
      expect(TENANT_DATA[table as keyof typeof TENANT_DATA].scope, table).toBe("org");
    }
    // AskFabric chats are private to each member (Saish 2026-11-11, D12).
    expect(
      Object.entries(EXPORT_POLICY).filter(([table, policy]) => table.startsWith("ask") && policy === true),
    ).toEqual([]);
  });

  test("says how erasing a person treats every table that points at one", () => {
    for (const table of schemaTables) {
      const entry = TENANT_DATA[table as keyof typeof TENANT_DATA];
      if ((entry.userIdFields ?? []).length > 0) {
        expect(ERASURE[table as keyof typeof ERASURE], table).not.toBeNull();
      }
    }
    const scanned = Object.entries(ERASURE)
      .filter(([, how]) => how === "scan")
      .map(([table]) => table)
      .sort();
    expect(Object.keys(SCAN_HANDLERS).sort()).toEqual(scanned);
    for (const table of scanned) {
      expect(TENANT_DATA[table as keyof typeof TENANT_DATA].scope, table).toBe("org");
    }
  });

  test("only billing and the tenant row outlive a purge", () => {
    const survivors = Object.entries(TENANT_DATA)
      .filter(([, entry]) => entry.scope !== "global" && entry.purge !== "delete")
      .map(([table, entry]) => `${table}:${entry.purge}`)
      .sort();
    // tenantPurgeItems is removed by the purge itself when it completes.
    expect(survivors).toEqual([
      "aiUsageEvents:keep",
      "aiUsageRollups:keep",
      "tenantPurgeItems:keep",
      "tenantPurges:keep",
      "tenants:tombstone",
    ]);
  });
});
