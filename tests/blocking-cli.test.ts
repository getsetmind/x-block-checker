import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { saveBlockingCheckpoint } from "../src/storage";
import type { BlockingCheckpoint } from "../src/types";

test("--waitは期限を守り同じ再開位置を保って制限解除後に完了する", async () => {
	const dir = await mkdtemp(join(tmpdir(), "xbc-wait-test-"));
	try {
		const start = Date.parse("2026-08-15T00:00:00.000Z");
		const initial: BlockingCheckpoint = {
			version: 1,
			checkedAt: new Date(start).toISOString(),
			startedAt: new Date(start).toISOString(),
			ownerId: "1",
			source: "graphql",
			pages: 1,
			complete: false,
			nextCursor: "first-private-cursor",
			stopReason: "rateLimit",
			retryAt: new Date(start + 120000).toISOString(),
			accounts: [{ id: "10", username: "Foo", url: "https://x.com/Foo" }],
		};
		await saveBlockingCheckpoint(dir, initial);
		const configPath = join(dir, "config.json");
		const browserPath = join(dir, "browser.exe");
		await writeFile(browserPath, "");
		await writeFile(
			configPath,
			JSON.stringify({ outputDir: dir, browserExecutable: browserPath }),
		);
		const harness = join(dir, "wait-harness.ts");
		const report = join(dir, "report.json");
		const cliPath = resolve("src/cli.ts");
		const browserModule = resolve("src/x/browser.ts");
		await writeFile(
			harness,
			`import { mock } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
let now = ${start};
const calls = [];
const delays = [];
Date.now = () => now;
const realTimer = globalThis.setTimeout;
globalThis.setTimeout = Object.assign((callback, delay = 0) => {
 delays.push(delay);
 now += delay;
 queueMicrotask(callback);
 return realTimer(() => {}, 0);
}, realTimer);
mock.module(${JSON.stringify(browserModule)}, () => ({
 authenticate: async () => { throw new Error("unused"); },
 checkUsers: async () => { throw new Error("unused"); },
 diagnose: async () => { throw new Error("unused"); },
 listBlocking: async (config, options) => {
  const checkpoint = options.checkpoint;
  const saved = JSON.parse(await readFile(join(config.outputDir, "blocking-progress.json"), "utf8"));
  if (!checkpoint || saved.nextCursor !== checkpoint.nextCursor || saved.pages !== checkpoint.pages) throw new Error("saved cursor was not resumed");
  calls.push({ at: now, pages: checkpoint.pages, cursor: checkpoint.nextCursor, locked: existsSync(join(config.outputDir, "run.lock")) });
  const { retryAt, stopReason, ...base } = checkpoint;
  let next;
  if (calls.length === 1) next = { ...base, checkedAt: new Date(now).toISOString(), pages: 2, nextCursor: "second-private-cursor", stopReason: "pageLimit", accounts: [...base.accounts, { id: "20", username: "Bar", url: "https://x.com/Bar" }] };
  else if (calls.length === 2) next = { ...base, stopReason: "rateLimit", retryAt: new Date(now + 300000).toISOString() };
  else if (calls.length === 3) next = { ...base, checkedAt: new Date(now).toISOString(), pages: 3, nextCursor: null, complete: true, accounts: [...base.accounts, { id: "30", username: "Baz", url: "https://x.com/Baz" }] };
  else throw new Error("unexpected retry");
  await options.onProgress(next);
  return next;
 },
}));
process.argv = [process.execPath, ${JSON.stringify(cliPath)}, "blocking", "--wait", "--json", "--config", ${JSON.stringify(configPath)}];
await import(${JSON.stringify(cliPath)});
await writeFile(${JSON.stringify(report)}, JSON.stringify({ calls, delays }));
`,
		);
		const command = Bun.spawnSync([process.execPath, harness], {
			stdout: "pipe",
			stderr: "pipe",
			timeout: 5000,
		});
		expect(command.exitCode, command.stderr.toString()).toBe(0);
		const summary = JSON.parse(await readFile(report, "utf8"));
		expect(summary.delays).toEqual([120000, 60000, 300000]);
		expect(summary.calls).toEqual([
			{
				at: start + 120000,
				pages: 1,
				cursor: "first-private-cursor",
				locked: true,
			},
			{
				at: start + 180000,
				pages: 2,
				cursor: "second-private-cursor",
				locked: true,
			},
			{
				at: start + 480000,
				pages: 2,
				cursor: "second-private-cursor",
				locked: true,
			},
		]);
		const output = command.stdout.toString();
		expect(
			JSON.parse(output).accounts.map((account: { id: string }) => account.id),
		).toEqual(["10", "20", "30"]);
		expect(output).not.toContain("ownerId");
		expect(output).not.toContain("private-cursor");
		expect(existsSync(join(dir, "blocking-progress.json"))).toBeFalse();
		expect(existsSync(join(dir, "run.lock"))).toBeFalse();
		expect(
			JSON.parse(await readFile(join(dir, "blocking.json"), "utf8")).accounts,
		).toHaveLength(3);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
