import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test.each(["following", "followers"] as const)(
	"%sはCLIから本人の一覧を取得し専用ファイルへ保存・再開する",
	async (kind) => {
		const dir = await mkdtemp(join(tmpdir(), "xbc-follow-cli-"));
		try {
			const browser = join(dir, "browser.exe");
			const config = join(dir, "config.json");
			const harness = join(dir, "harness.ts");
			await writeFile(browser, "");
			await writeFile(
				config,
				JSON.stringify({
					browserExecutable: browser,
					outputDir: dir,
					profileDir: join(dir, "profile"),
					users: ["Ignored"],
					input: "missing.txt",
				}),
			);
			await writeFile(join(dir, "blocking.json"), "untouched");
			await writeFile(
				harness,
				`const { default: puppeteer } = await import(${JSON.stringify(import.meta.resolve("puppeteer-core"))});
const kind = process.argv[2];
const operation = kind === "following" ? "Following" : "Followers";
const url = new URL("https://x.com/i/api/graphql/synthetic/" + operation);
url.searchParams.set("variables", JSON.stringify({ userId: "111", count: 20 }));
const user = (id, username) => ({ content: { entryType: "TimelineTimelineItem", itemContent: { itemType: "TimelineUser", user_results: { result: { __typename: "User", rest_id: id, core: { screen_name: username } } } } } });
const payload = (last) => ({ data: { user: { result: { timeline: { timeline: { instructions: [{ type: "TimelineAddEntries", entries: [user(last ? "2" : "1", last ? "Alpha" : "Zulu"), ...(!last ? [{ content: { entryType: "TimelineTimelineCursor", cursorType: "Bottom", value: "private-next" } }] : [])] }, ...(last ? [{ type: "TimelineTerminateTimeline", direction: "Bottom" }] : [])] } } } } } });
let current = "";
const page = {
 goto: async (target) => { current = target; return null; },
 url: () => current,
 waitForSelector: async () => ({}),
 $eval: async () => "/Self",
 waitForResponse: async (predicate) => {
  await Promise.resolve();
  const response = { url: () => url.toString(), status: () => 200, headers: () => ({}), json: async () => payload(false), request: () => ({ method: () => "GET", headers: () => ({ authorization: "synthetic-secret" }) }) };
  if (!predicate(response) || current !== "https://x.com/Self/" + kind) throw new Error("wrong list route");
  return response;
 },
 evaluate: async (fn, input) => fn(input),
};
globalThis.fetch = async (input) => {
 const parsed = new URL(input);
 const variables = JSON.parse(parsed.searchParams.get("variables"));
 if (variables.userId !== "111" || variables.cursor !== "private-next" || !parsed.pathname.endsWith("/" + operation)) throw new Error("wrong resume");
 return new Response(JSON.stringify(payload(true)));
};
puppeteer.launch = async () => ({ pages: async () => [page], defaultBrowserContext: () => ({ cookies: async () => [{ name: "auth_token", value: "synthetic-auth", domain: ".x.com" }, { name: "twid", value: "u%3D111", domain: ".x.com" }] }), close: async () => {} });
process.argv = [process.execPath, ${JSON.stringify(resolve("src/cli.ts"))}, kind, "--json", "--page-limit", "1", "--config", ${JSON.stringify(config)}];
await import(${JSON.stringify(resolve("src/cli.ts"))});
`,
			);
			const first = Bun.spawnSync([process.execPath, harness, kind], {
				stdout: "pipe",
				stderr: "pipe",
				timeout: 5000,
			});
			expect(first.exitCode, first.stderr.toString()).toBe(2);
			expect(JSON.parse(first.stdout.toString())).toMatchObject({
				complete: false,
				pages: 1,
				accounts: [{ id: "1", username: "Zulu", url: "https://x.com/Zulu" }],
			});
			expect(first.stdout.toString()).not.toContain("private-next");
			const second = Bun.spawnSync([process.execPath, harness, kind], {
				stdout: "pipe",
				stderr: "pipe",
				timeout: 5000,
			});
			expect(second.exitCode, second.stderr.toString()).toBe(0);
			const result = JSON.parse(second.stdout.toString());
			expect(
				result.accounts.map(
					(account: { username: string }) => account.username,
				),
			).toEqual(["Alpha", "Zulu"]);
			expect(second.stdout.toString()).not.toContain("ownerId");
			expect(second.stdout.toString()).not.toContain("synthetic-secret");
			expect(
				JSON.parse(await readFile(join(dir, `${kind}.json`), "utf8")),
			).toEqual(result);
			expect(await readFile(join(dir, `${kind}.md`), "utf8")).toContain(
				"@Alpha",
			);
			expect(await readFile(join(dir, "blocking.json"), "utf8")).toBe(
				"untouched",
			);
			expect(existsSync(join(dir, `${kind}-progress.json`))).toBeFalse();
			expect(existsSync(join(dir, "run.lock"))).toBeFalse();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
);
