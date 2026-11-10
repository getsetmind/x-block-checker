import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ignoredDefaultBrowserArgs } from "../src/x/browser";

describe("browser", () => {
	test.each(["pages", "newPage"])(
		"ページ取得の%sが失敗しても起動済みブラウザを閉じる",
		async (stage) => {
			const dir = await mkdtemp(join(tmpdir(), "xbc-browser-acquire-"));
			try {
				const harness = join(dir, "harness.ts");
				await writeFile(
					harness,
					`const { default: puppeteer } = await import(${JSON.stringify(import.meta.resolve("puppeteer-core"))});
let closes = 0;
puppeteer.launch = async () => ({
 pages: async () => { if (${JSON.stringify(stage)} === "pages") throw new Error("acquisition failed"); return []; },
 newPage: async () => { throw new Error("acquisition failed"); },
 close: async () => { closes++; },
});
const { withAuthenticatedPage } = await import(${JSON.stringify(resolve("src/x/browser.ts"))});
let message = "unexpected success";
try { await withAuthenticatedPage({ users: [], profileDir: ${JSON.stringify(join(dir, "profile"))}, outputDir: ${JSON.stringify(dir)}, browserExecutable: "unused", timeoutMs: 5000, headless: true, relationshipMode: "auto" }, async () => { throw new Error("action must not run"); }); }
catch (error) { message = error.message; }
console.log(JSON.stringify({ closes, message }));
`,
				);
				const result = Bun.spawnSync([process.execPath, harness], {
					stdout: "pipe",
					stderr: "pipe",
					timeout: 5000,
				});
				expect(result.exitCode, result.stderr.toString()).toBe(0);
				expect(JSON.parse(result.stdout.toString())).toEqual({
					closes: 1,
					message: "acquisition failed",
				});
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		},
	);
	test("macOSでは通常起動と同じKeychainを使う", () => {
		expect(ignoredDefaultBrowserArgs("darwin")).toEqual([
			"--use-mock-keychain",
		]);
	});

	test("macOS以外ではPuppeteerの既定引数を維持する", () => {
		expect(ignoredDefaultBrowserArgs("win32")).toBeUndefined();
		expect(ignoredDefaultBrowserArgs("linux")).toBeUndefined();
	});
});
