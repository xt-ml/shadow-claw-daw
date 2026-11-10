import test from "node:test";
import assert from "node:assert/strict";
import { checkNamespaceIsolation } from "../bin/check-namespace.mjs";

test("Namespace isolation: verifies scoped naming conventions and zero conflicts", () => {
  const result = checkNamespaceIsolation();

  if (!result.ok) {
    console.error("Namespace isolation failures:", result.issues);
  }

  assert.equal(
    result.ok,
    true,
    "Namespace isolation check must pass with 0 violations",
  );
  assert.equal(
    result.report.tools.length,
    30,
    "Must define 30 tools in enabledTools",
  );
  assert.equal(
    result.report.elements.length,
    11,
    "Must define 11 custom elements",
  );
  assert.equal(
    result.report.channels.length,
    3,
    "Must define 3 broadcast channels",
  );
  assert.equal(
    result.report.namingViolations.length,
    0,
    "No naming violations",
  );
  assert.equal(
    result.report.pinnedPageConflict,
    false,
    "Must pin /pages/main/scdaw.html",
  );
});
