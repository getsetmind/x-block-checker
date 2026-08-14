import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "../src/config/resolve";

describe("resolveConfig", () => {
	test("設定ファイルを基準にパスとユーザーを解決する", async () => {
		const dir = await mkdtemp(join(tmpdir(), "xbc-config-test-"));
		try {
			const browserPath = join(dir, "browser.exe");
			const configPath = join(dir, "config.json");
			await writeFile(browserPath, "");
			await writeFile(
				configPath,
				JSON.stringify({
					users: ["@Foo"],
					outputDir: "results",
					profileDir: "profile",
					browserExecutable: browserPath,
					timeoutSeconds: 30,
					headless: false,
				}),
			);

			await expect(
				resolveConfig({
					command: "check",
					configPath,
					usernames: ["bar"],
					json: false,
				}),
			).resolves.toEqual({
				users: ["Foo", "bar"],
				outputDir: join(dir, "results"),
				profileDir: join(dir, "profile"),
				browserExecutable: browserPath,
				timeoutMs: 30000,
				headless: false,
				relationshipMode: "auto",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
