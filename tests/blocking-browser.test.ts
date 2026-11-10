import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test.each([
	{ domain: ".twitter.com", message: "異なります" },
	{ domain: "api.x.com", message: "異なります" },
	{ domain: "x.com", message: "確認できません" },
])(
	"取得先に適用されない・曖昧なtwidで再開しない: $domain",
	async ({ domain, message }) => {
		const dir = await mkdtemp(join(tmpdir(), "xbc-owner-test-"));
		try {
			const browserPath = resolve("src/x/account-list-browser.ts");
			const puppeteerModule = import.meta.resolve("puppeteer-core");
			const harness = join(dir, "owner-harness.ts");
			await writeFile(
				harness,
				`const { default: puppeteer } = await import(${JSON.stringify(puppeteerModule)});
let networkCalls = 0;
let closes = 0;
const cookies = [
 { name: "auth_token", value: "synthetic-auth", domain: ".x.com" },
 { name: "twid", value: "u%3D111", domain: ${JSON.stringify(domain)} },
 { name: "twid", value: "u%3D222", domain: ".x.com" },
];
const page = {
 waitForResponse: async () => { networkCalls++; throw new Error("network forbidden"); },
 goto: async () => { networkCalls++; throw new Error("network forbidden"); },
 url: () => "https://x.com/settings/blocked/all",
};
puppeteer.launch = async () => ({
  pages: async () => [page],
  defaultBrowserContext: () => ({ cookies: async () => cookies }),
  close: async () => { closes++; },
 });
const { collectAccountList } = await import(${JSON.stringify(browserPath)});
const config = { users: [], outputDir: ${JSON.stringify(dir)}, profileDir: ${JSON.stringify(join(dir, "profile"))}, browserExecutable: "unused", timeoutMs: 5000, headless: true, relationshipMode: "auto" };
const checkpoint = { version: 1, checkedAt: "2026-08-15T00:00:00.000Z", startedAt: "2026-08-15T00:00:00.000Z", ownerId: "111", source: "graphql", pages: 1, complete: false, nextCursor: "private-cursor", accounts: [] };
let message = "unexpected success";
try { await collectAccountList(config, { checkpoint, kind: "blocking" }); }
catch (error) { message = error instanceof Error ? error.message : "unknown"; }
console.log(JSON.stringify({ message, networkCalls, closes }));
`,
			);
			const command = Bun.spawnSync([process.execPath, harness], {
				stdout: "pipe",
				stderr: "pipe",
				timeout: 5000,
			});
			expect(command.exitCode, command.stderr.toString()).toBe(0);
			const result = JSON.parse(command.stdout.toString());
			expect(result.message).toContain(message);
			expect(result.networkCalls).toBe(0);
			expect(result.closes).toBe(1);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
);
