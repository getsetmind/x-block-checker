import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readAccountListCheckpoint } from "../src/account-lists/storage";

test("ページ保存後の強制終了でも次プロセスが古いロックを回収して続きを完了する", async () => {
	const dir = await mkdtemp(join(tmpdir(), "xbc-interrupt-test-"));
	try {
		const browserModule = resolve("src/x/account-list-browser.ts");
		const cliPath = resolve("src/cli.ts");
		const configPath = join(dir, "config.json");
		const browserPath = join(dir, "browser.exe");
		await writeFile(browserPath, "");
		await writeFile(
			configPath,
			JSON.stringify({ outputDir: dir, browserExecutable: browserPath }),
		);
		const harness = join(dir, "interrupt-harness.ts");
		await writeFile(
			harness,
			String.raw`import { mock } from "bun:test";
const interrupted = process.argv[2] === "interrupt";
mock.module(${JSON.stringify(browserModule)}, () => ({
 collectAccountList: async (config, options) => {
  const first = { version: 1, ownerId: "1", checkedAt: "2026-08-15T00:00:00.000Z", startedAt: "2026-08-15T00:00:00.000Z", source: "graphql", pages: 1, nextCursor: "saved-private-cursor", complete: false, accounts: [{ id: "10", username: "Foo", url: "https://x.com/Foo" }] };
  if (interrupted) {
   await options.onProgress(first);
   process.stdout.write("checkpoint-saved\n");
   setInterval(() => {}, 1000);
   await new Promise(() => {});
  }
  if (options.checkpoint?.nextCursor !== "saved-private-cursor" || options.checkpoint?.accounts.length !== 1) throw new Error("checkpoint was not resumed");
  const finished = { ...options.checkpoint, pages: 2, complete: true, nextCursor: null, accounts: [...options.checkpoint.accounts, { id: "20", username: "Bar", url: "https://x.com/Bar" }] };
  await options.onProgress(finished);
  return finished;
 },
}));
process.argv = [process.execPath, ${JSON.stringify(cliPath)}, "blocking", "--wait", "--json", "--config", ${JSON.stringify(configPath)}];
await import(${JSON.stringify(cliPath)});
`,
		);
		const child = Bun.spawn([process.execPath, harness, "interrupt"], {
			stdout: "pipe",
			stderr: "pipe",
			timeout: 5000,
		});
		try {
			const reader = child.stdout.getReader();
			const decoder = new TextDecoder();
			let notification = "";
			while (!notification.includes("\n")) {
				const chunk = await reader.read();
				if (chunk.done) {
					break;
				}
				notification += decoder.decode(chunk.value, { stream: true });
			}
			reader.releaseLock();
			expect(notification).toContain("checkpoint-saved");
			expect(
				(await readAccountListCheckpoint(dir, "blocking"))?.nextCursor,
			).toBe("saved-private-cursor");
			expect(existsSync(join(dir, "run.lock"))).toBeTrue();
			child.kill("SIGKILL");
			await child.exited;
		} finally {
			if (child.exitCode === null) {
				child.kill("SIGKILL");
				await child.exited;
			}
		}
		expect(existsSync(join(dir, "run.lock"))).toBeTrue();
		const resumed = Bun.spawnSync([process.execPath, harness, "resume"], {
			stdout: "pipe",
			stderr: "pipe",
			timeout: 5000,
		});
		expect(resumed.exitCode, resumed.stderr.toString()).toBe(0);
		expect(JSON.parse(resumed.stdout.toString()).accounts).toEqual([
			{ id: "10", username: "Foo", url: "https://x.com/Foo" },
			{ id: "20", username: "Bar", url: "https://x.com/Bar" },
		]);
		expect(
			JSON.parse(await readFile(join(dir, "blocking.json"), "utf8")).accounts,
		).toHaveLength(2);
		expect(existsSync(join(dir, "blocking-progress.json"))).toBeFalse();
		expect(existsSync(join(dir, "run.lock"))).toBeFalse();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
