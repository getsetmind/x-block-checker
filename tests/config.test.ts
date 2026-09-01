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

	test("設定ファイルのJSON構造を検証する", async () => {
		const dir = await mkdtemp(join(tmpdir(), "xbc-config-test-"));
		try {
			const invalidConfigs: unknown[] = [
				null,
				[],
				{ users: "foo" },
				{ users: [123] },
				{ input: 123 },
				{ outputDir: false },
				{ profileDir: null },
				{ browserExecutable: [] },
				{ timeoutSeconds: "20" },
				{ headless: "true" },
				{ relationshipMode: "unknown" },
			];

			for (const [index, config] of invalidConfigs.entries()) {
				const configPath = join(dir, `config-${index}.json`);
				await writeFile(configPath, JSON.stringify(config));
				await expect(
					resolveConfig({
						command: "check",
						configPath,
						usernames: [],
						json: false,
					}),
				).rejects.toThrow("設定ファイルを読み込めません");
			}
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
