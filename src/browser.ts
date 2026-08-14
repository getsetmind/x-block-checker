import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { CdpClient } from "./cdp.js";
import { classify } from "./classifier.js";
import { extractRelationships } from "./relationship.js";
import type {
	CheckResult,
	PageState,
	Relationship,
	RuntimeConfig,
} from "./types.js";

const delay = (milliseconds: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

interface LaunchedBrowser {
	client: CdpClient;
	process: ChildProcess;
}

async function waitForDebuggerUrl(
	activePortPath: string,
	process: ChildProcess,
): Promise<string> {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		if (process.exitCode !== null)
			throw new Error(`ブラウザが起動直後に終了しました (${process.exitCode})`);
		try {
			const [port, path] = (await readFile(activePortPath, "utf8"))
				.trim()
				.split(/\r?\n/);
			if (port && path) return `ws://127.0.0.1:${port}${path}`;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		await delay(100);
	}
	throw new Error("ブラウザのCDP待受開始がタイムアウトしました");
}

async function launchBrowser(
	config: RuntimeConfig,
	headless: boolean,
	initialUrl: string,
): Promise<LaunchedBrowser> {
	await mkdir(config.profileDir, { recursive: true });
	const activePortPath = join(config.profileDir, "DevToolsActivePort");
	await rm(activePortPath, { force: true });
	const args = [
		`--user-data-dir=${config.profileDir}`,
		"--remote-debugging-port=0",
		"--no-first-run",
		"--no-default-browser-check",
	];
	if (headless) args.push("--headless=new");
	args.push(initialUrl);
	const process = spawn(config.browserExecutable, args, {
		stdio: "ignore",
		windowsHide: headless,
	});
	try {
		const client = await CdpClient.connect(
			await waitForDebuggerUrl(activePortPath, process),
		);
		return { client, process };
	} catch (error) {
		process.kill();
		throw error;
	}
}

async function closeBrowser(browser: LaunchedBrowser): Promise<void> {
	try {
		await browser.client.send("Browser.close").catch(() => {});
		await Promise.race([
			new Promise<void>((resolve) =>
				browser.process.once("exit", () => resolve()),
			),
			delay(5_000),
		]);
		if (browser.process.exitCode === null) browser.process.kill();
	} finally {
		browser.client.close();
	}
}

async function hasAuthCookie(client: CdpClient): Promise<boolean> {
	const { cookies } = await client.send<{
		cookies: { name: string; value: string }[];
	}>("Storage.getCookies");
	return cookies.some((cookie) => cookie.name === "auth_token" && cookie.value);
}

export async function authenticate(config: RuntimeConfig): Promise<void> {
	const browser = await launchBrowser(config, false, "https://x.com/home");
	try {
		if (await hasAuthCookie(browser.client)) return;
		process.stderr.write(
			"ブラウザでXへログインしてください。認証完了を最大10分待機します\n",
		);
		const deadline = Date.now() + 10 * 60_000;
		while (Date.now() < deadline) {
			await delay(1_000);
			if (await hasAuthCookie(browser.client)) return;
		}
		throw new Error("ログイン待機がタイムアウトしました");
	} finally {
		await closeBrowser(browser);
	}
}

class BlockChecker {
	private readonly relationships = new Map<string, Relationship>();
	private readonly responseRequests = new Set<string>();
	private readonly responseTasks = new Set<Promise<void>>();

	constructor(
		private readonly client: CdpClient,
		private readonly sessionId: string,
	) {
		client.on<{ requestId: string; response?: { url?: string } }>(
			"Network.responseReceived",
			(params, sessionId) => {
				if (sessionId !== this.sessionId) return;
				const url = params.response?.url ?? "";
				if (url.includes("/graphql/") && url.includes("UserByScreenName"))
					this.responseRequests.add(params.requestId);
			},
		);
		client.on<{ requestId: string }>(
			"Network.loadingFinished",
			(params, sessionId) => {
				if (
					sessionId !== this.sessionId ||
					!this.responseRequests.delete(params.requestId)
				)
					return;
				const task = this.readRelationshipResponse(params.requestId).finally(
					() => this.responseTasks.delete(task),
				);
				this.responseTasks.add(task);
			},
		);
	}

	private async readRelationshipResponse(requestId: string): Promise<void> {
		try {
			const response = await this.client.send<{
				body: string;
				base64Encoded?: boolean;
			}>("Network.getResponseBody", { requestId }, this.sessionId);
			const text = response.base64Encoded
				? Buffer.from(response.body, "base64").toString("utf8")
				: response.body;
			for (const relationship of extractRelationships(JSON.parse(text)))
				this.relationships.set(
					relationship.username.toLowerCase(),
					relationship,
				);
		} catch {
			// 個別レスポンスを取得できなくてもDOM判定を続ける
		}
	}

	private async readPageState(): Promise<PageState> {
		const result = await this.client.send<{
			result?: { value?: PageState };
		}>(
			"Runtime.evaluate",
			{
				expression: `(() => {
					const primary = document.querySelector('[data-testid="primaryColumn"]');
					const text = primary?.innerText || document.body?.innerText || '';
					const profileLoaded = Boolean(
						primary?.querySelector('[data-testid="UserName"]') ||
						primary?.querySelector('[data-testid="UserDescription"]') ||
						primary?.querySelector('[data-testid$="-follow"]')
					);
					return { text, profileLoaded };
				})()`,
				returnByValue: true,
			},
			this.sessionId,
		);
		return result.result?.value ?? { text: "", profileLoaded: false };
	}

	private async currentUrl(): Promise<string> {
		const result = await this.client.send<{ result?: { value?: string } }>(
			"Runtime.evaluate",
			{ expression: "location.href", returnByValue: true },
			this.sessionId,
		);
		return result.result?.value ?? "";
	}

	async check(username: string, timeoutMs: number): Promise<CheckResult> {
		const key = username.toLowerCase();
		this.relationships.delete(key);
		await this.client.send(
			"Page.navigate",
			{ url: `https://x.com/${encodeURIComponent(username)}` },
			this.sessionId,
		);
		const startedAt = Date.now();
		let status: CheckResult["status"] = "unknown";
		while (Date.now() - startedAt < timeoutMs) {
			await delay(500);
			await Promise.all([...this.responseTasks]);
			if (/\/(?:i\/flow\/login|login)(?:[/?#]|$)/.test(await this.currentUrl()))
				throw new Error("Xの認証が切れています。authを再実行してください");
			const classified = classify(
				await this.readPageState(),
				this.relationships.get(key),
				Date.now() - startedAt,
			);
			if (!classified) continue;
			status = classified;
			break;
		}
		return {
			username,
			status,
			checkedAt: new Date().toISOString(),
			url: `https://x.com/${username}`,
		};
	}
}

export async function checkUsers(
	config: RuntimeConfig,
	onProgress?: (index: number, total: number, result: CheckResult) => void,
): Promise<CheckResult[]> {
	const browser = await launchBrowser(config, config.headless, "about:blank");
	try {
		if (!(await hasAuthCookie(browser.client)))
			throw new Error(
				"Xへ未認証です。先に x-block-checker auth を実行してください",
			);
		const { targetId } = await browser.client.send<{ targetId: string }>(
			"Target.createTarget",
			{ url: "about:blank", background: true },
		);
		const { sessionId } = await browser.client.send<{ sessionId: string }>(
			"Target.attachToTarget",
			{ targetId, flatten: true },
		);
		await browser.client.send("Network.enable", {}, sessionId);
		await browser.client.send("Page.enable", {}, sessionId);
		await browser.client.send("Runtime.enable", {}, sessionId);
		const checker = new BlockChecker(browser.client, sessionId);
		const results: CheckResult[] = [];
		for (const [index, username] of config.users.entries()) {
			const result = await checker.check(username, config.timeoutMs);
			results.push(result);
			onProgress?.(index + 1, config.users.length, result);
		}
		return results;
	} finally {
		await closeBrowser(browser);
	}
}
