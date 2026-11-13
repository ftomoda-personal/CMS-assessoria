import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import entrypoint from "../api/cms.ts";
import { handleCmsRequest } from "../server/cms/handler.ts";

const root = process.cwd();
const request = (path = "/api/cms", method = "POST") => new Request(`https://cms.invalid${path}`, { method });

test("thin Web entrypoint returns stable unavailable JSON", async () => {
  assert.equal(entrypoint.fetch, handleCmsRequest);
  const response = entrypoint.fetch(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "backend_unavailable" });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

for (const path of ["/api", "/api/", "/api/unknown", "/api/cms/", "/api/cms/offers", "/api/cms-extra"]) {
  test(`unknown path ${path} is 404`, async () => {
    const response = handleCmsRequest(request(path));
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { error: "not_found" });
  });
}

for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
  test(`unsupported method ${method} is rejected without work`, async () => {
    const response = handleCmsRequest(request("/api/cms", method));
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "POST");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    if (method === "HEAD") assert.equal(await response.text(), "");
    else assert.deepEqual(await response.json(), { error: "method_not_allowed" });
  });
}

test("invalid URL produces a sanitized error", async () => {
  const response = handleCmsRequest({ method: "POST", url: "not a URL secret-body" } as Request);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_request" });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("credentials, query and body are neither read nor reflected", async () => {
  const input = new Request("https://cms.invalid/api/cms?token=query-secret", {
    method: "POST", headers: { Authorization: "Bearer header-secret" }, body: "body-secret",
  });
  for (const key of ["headers", "body"]) Object.defineProperty(input, key, {
    get() { throw new Error(`Unexpected ${key} access`); },
  });
  for (const key of ["text", "json", "arrayBuffer", "formData", "blob", "clone"]) {
    Object.defineProperty(input, key, { value() { throw new Error(`Unexpected ${key} call`); } });
  }
  const response = handleCmsRequest(input);
  assert.equal(await response.text(), '{"error":"backend_unavailable"}');
  assert.doesNotMatch(JSON.stringify([...response.headers]), /secret/);
});

test("concurrent requests share no request/response state", async () => {
  const responses = await Promise.all(Array.from({ length: 30 }, async (_, index) => {
    const input = new Request(`https://cms.invalid/api/cms?token=secret-${index}`, {
      method: "POST", headers: { Authorization: `Bearer secret-${index}` }, body: `body-${index}`,
    });
    const response = entrypoint.fetch(input);
    return { response, body: await response.text() };
  }));
  assert.equal(new Set(responses.map(item => item.response)).size, 30);
  for (const { response, body } of responses) {
    assert.equal(response.status, 503);
    assert.equal(body, '{"error":"backend_unavailable"}');
  }
});

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

test("HTTP factory cannot create Auth/database transports", () => {
  const allowed = new Map([
    ["server/cms/handler.ts", ["./currentAccountDiagnostics.ts", "./currentAccount.ts", "./contracts.ts"]],
    ["server/cms/contracts.ts", []],
  ]);
  for (const [file, imports] of allowed) {
    const source = readFileSync(file, "utf8");
    assert.deepEqual(ts.preProcessFile(source).importedFiles.map(value => value.fileName), imports);
    assert.doesNotMatch(source, /\b(?:fetch|eval|require|setInterval)\s*\(|\bimport\s*\(|\bprocess\s*\.|\bconsole\s*\.|\.auth\b|\.rpc\s*\(|\.storage\b/);
  }
});

test("frontend source has no server/API imports or server environment access", () => {
  for (const file of files(resolve(root, "src"))) {
    const source = readFileSync(file, "utf8");
    for (const imported of ts.preProcessFile(source).importedFiles) {
      assert.doesNotMatch(imported.fileName, /(?:^|\/)(?:server|api)(?:\/|$)/, file);
      if (imported.fileName.startsWith(".")) {
        const target = resolve(file, "..", imported.fileName);
        assert.ok(!["server", "api"].some(name => target.startsWith(resolve(root, name) + "/")), file);
      }
    }
    assert.doesNotMatch(source, /\bprocess\.env|import\.meta\.env\.VITE_(?:CMS_|SERVER_|.*(?:SECRET|SERVICE_ROLE|DATABASE))/, file);
  }
});

test("actual Vite boundary rejects server paths, queries and similarly named directories correctly", () => {
  const source = readFileSync("vite.config.ts", "utf8");
  const ast = ts.createSourceFile("vite.config.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "assertBrowserModule");
  assert.ok(declaration);
  const code = ts.transpileModule(declaration.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: { assertBrowserModule?: (id: string) => void } = {};
  runInNewContext(code, { exports, realpathSync, relative, isAbsolute,
    serverRoots: [resolve(root, "server"), resolve(root, "api")] });
  const check = exports.assertBrowserModule!;
  for (const path of ["server/cms/handler.ts", "api/cms.ts", "server/cms/handler.ts?raw", "api/cms.ts?url", "server/..hidden.ts", "server/als/bearer.ts", "server/als/liveness.ts?raw", "server/als/admissionContracts.ts?url", "server/als/revocation.ts?raw", "server/als/revocationContracts.ts", "server/als/logout.ts?url", "server/als/recovery.ts", "server/als/postgresRevocation.ts?raw", "server/als/revocationValidation.ts?url", "server/als/pgConnector.ts?raw", "server/als/pgConnector.ts?url"]) {
    assert.throws(() => check(resolve(root, path)), /Server-only modules/);
  }
  assert.doesNotThrow(() => check(resolve(root, "src/main.tsx")));
  assert.doesNotThrow(() => check(resolve(root, "server-example/file.ts")));
  assert.match(source, /enforce: "pre"/);
  assert.match(source, /assertBrowserModule\(resolved.id\)/);
  assert.match(source, /load\(id\).*assertBrowserModule\(id\)/);
});

test("routing contract excludes the API namespace from the SPA fallback", () => {
  // Checks configured patterns only; does not emulate Vercel's platform router.
  const config = JSON.parse(readFileSync("vercel.json", "utf8"));
  assert.equal(config.routes, undefined);
  assert.equal(config.functions["api/cms.ts"].maxDuration, 10);
  assert.equal(JSON.parse(readFileSync("package.json", "utf8")).engines.node, "24.x");
  assert.deepEqual(config.headers, [{ source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] }]);
  assert.equal(config.rewrites.length, 1);
  const rewrite = config.rewrites[0];
  assert.ok(rewrite.source.startsWith("/:path("));
  const pattern = new RegExp(`^(?:${rewrite.source.slice(7, -1)})$`);
  for (const path of ["/api", "/api/", "/api/unknown", "/api/cms"]) assert.equal(pattern.test(path.slice(1)), false, path);
  for (const path of ["/", "/login", "/password-recovery", "/password-recovery/callback", "/offers", "/offers/new", "/offers/id/edit", "/partners", "/partners/new", "/partners/id/edit", "/assets/app.js", "/api-example"]) {
    assert.ok(pattern.test(path.slice(1)), path);
  }
  assert.equal(rewrite.destination, "/index.html");
});
