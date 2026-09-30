import assert from "node:assert/strict";
import test from "node:test";
import { serverPort } from "../src/server-port.js";

test("PORT defaults to 3000 and accepts only a valid TCP port", () => {
  assert.equal(serverPort(undefined), 3000);
  assert.equal(serverPort(""), 3000);
  assert.equal(serverPort("80"), 80);
  assert.equal(serverPort("65535"), 65535);
  for (const invalid of ["0", "65536", "-1", "3000.5", "1e3", "http", " 80"]) {
    assert.throws(() => serverPort(invalid), /PORT/);
  }
});
