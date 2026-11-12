import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { dirname, join, posix, resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";

test("Function compiler config rewrites relative TypeScript imports to packaged JavaScript", async () => {
  const config = JSON.parse(readFileSync("tsconfig.json", "utf8"));
  assert.equal(config.compilerOptions.rewriteRelativeImportExtensions, true);
  const parsed = ts.convertCompilerOptionsFromJson(config.compilerOptions, process.cwd());
  assert.deepEqual(parsed.errors, []);
  const emitted = new Map<string, string>();
  const pending = ["api/cms.ts"];
  for (const file of pending) {
    const output = file.replace(/\.ts$/, ".js");
    if (emitted.has(output)) continue;
    const source = ts.transpileModule(readFileSync(file, "utf8"), {
      fileName: file,
      compilerOptions: { ...parsed.options, noEmit: false, sourceMap: false },
    }).outputText;
    emitted.set(output, source);
    for (const { fileName } of ts.preProcessFile(source).importedFiles) {
      if (fileName.startsWith(".")) pending.push(posix.normalize(posix.join(dirname(file), fileName.replace(/\.js$/, ".ts"))));
    }
  }
  assert.match(emitted.get("api/cms.js")!, /from ["']\.\.\/server\/cms\/currentAccountPreview\.js["']/);
  for (const [file, source] of emitted) {
    for (const imported of ts.preProcessFile(source).importedFiles) {
      assert.doesNotMatch(imported.fileName, /\.[cm]?tsx?$/);
      if (!imported.fileName.startsWith(".")) continue;
      assert.ok(emitted.has(posix.normalize(posix.join(dirname(file), imported.fileName))), "Emitted module dependency must resolve");
    }
  }
  assert.doesNotMatch(emitted.get("server/cms/handler.js")!, /contracts|\.ts["']/);

  const outputDirectory = mkdtempSync(join(tmpdir(), "cms-function-"));
  try {
    writeFileSync(join(outputDirectory, "package.json"), '{"type":"module"}');
    symlinkSync(resolve("node_modules"), join(outputDirectory, "node_modules"), "dir");
    for (const [file, source] of emitted) {
      const outputFile = join(outputDirectory, file);
      mkdirSync(dirname(outputFile), { recursive: true });
      writeFileSync(outputFile, source);
    }
    const { default: entrypoint } = await import(pathToFileURL(join(outputDirectory, "api/cms.js")).href);
    const response = await entrypoint.fetch(new Request("https://cms.invalid/api/cms", { method: "POST" }));
    assert.equal(response.status, 503);
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test("rewriting remains a runtime emit rule without changing the source handler boundary", () => {
  assert.match(readFileSync("api/cms.ts", "utf8"), /\.\.\/server\/cms\/currentAccountPreview\.ts/);
  const server = JSON.parse(readFileSync("tsconfig.server.json", "utf8"));
  assert.equal(server.extends, "./tsconfig.json");
  assert.equal(server.compilerOptions.noEmit, true);
});
