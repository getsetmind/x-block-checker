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

const DEBUGGER_START_TIMEOUT_MS = 15_000;
const BROWSER_CLOSE_TIMEOUT_MS = 5_000;
const AUTH_TIMEOUT_MS = 10 * 60_000;
const AUTH_POLL_INTERVAL_MS = 1_000;
const CHECK_POLL_INTERVAL_MS = 500;
const X_HOME_URL = "https://x.com/home";
const LOGIN_URL_PATTERN = /\/(?:i\/flow\/login|login)(?:[/?#]|$)/;
const USER_RELATIONSHIP_ENDPOINT = "UserByScreenName";

const PAGE_STATE_EXPRESSION = `(() => {
	const primary = document.querySelector('[data-testid="primaryColumn"]');
	const text = primary?.innerText || document.body?.innerText || '';
	const profileLoaded = Boolean(
		primary?.querySelector('[data-testid="UserName"]') ||
		primary?.querySelector('[data-testid="UserDescription"]') ||
		primary?.querySelector('[data-testid$="-follow"]')
	);
	return { text, profileLoaded };
})()`;

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function profileUrl(username: string): string {
	return `https://x.com/${encodeURIComponent(username)}`;
}

function hasErrorCode(error: unknown, code: string): boolean {
	return (error as NodeJS.ErrnoException).code === code;
}

interface LaunchedBrowser {
	client: CdpClient;
	childProcess: ChildProcess;
}

async function waitForDebuggerUrl(
	activePortPath: string,
	childProcess: ChildProcess,
): Promise<string> {
	const deadline = Date.now() + DEBUGGER_START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (childProcess.exitCode !== null)
			throw new Error(
				`ブラウザが起動直後に終了しました (${childProcess.exitCode})`,
			);
		try {
			const [port, path] = (await readFile(activePortPath, "utf8"))
				.trim()
				.split(/\r?\n/);
			if (port && path) return `ws://127.0.0.1:${port}${path}`;
		} catch (error) {
			if (!hasErrorCode(error, "ENOENT")) throw error;
		}
		await delay(100);
	}
	throw new Error("ブラウザのCDP待受開始がタイムアウトしました");
}

function browserArguments(
	config: RuntimeConfig,
	headless: boolean,
	initialUrl: string,
): string[] {
	return [
		`--user-data-dir=${config.profileDir}`,
		"--remote-debugging-port=0",
		"--no-first-run",
		"--no-default-browser-check",
		...(headless ? ["--headless=new"] : []),
		initialUrl,
	];
}

async function waitForProcessExit(
	childProcess: ChildProcess,
	timeoutMs: number,
): Promise<void> {
	if (childProcess.exitCode !== null) return;
	await Promise.race([
		new Promise<void>((resolve) => childProcess.once("exit", () => resolve())),
		delay(timeoutMs),
	]);
}

async function launchBrowser(
	config: RuntimeConfig,
	headless: boolean,
	initialUrl: string,
): Promise<LaunchedBrowser> {
	await mkdir(config.profileDir, { recursive: true });
	const activePortPath = join(config.profileDir, "DevToolsActivePort");
	await rm(activePortPath, { force: true });
	const childProcess = spawn(
		config.browserExecutable,
		browserArguments(config, headless, initialUrl),
		{
			stdio: "ignore",
			windowsHide: headless,
		},
	);
	try {
		const client = await CdpClient.connect(
			await waitForDebuggerUrl(activePortPath, childProcess),
		);
		return { client, childProcess };
	} catch (error) {
		childProcess.kill();
		throw error;
	}
}

async function closeBrowser(browser: LaunchedBrowser): Promise<void> {
	try {
		const exit = waitForProcessExit(
			browser.childProcess,
			BROWSER_CLOSE_TIMEOUT_MS,
		);
		await browser.client.send("Browser.close").catch(() => {});
		await exit;
		if (browser.childProcess.exitCode === null) browser.childProcess.kill();
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
	const browser = await launchBrowser(config, false, X_HOME_URL);
	try {
		if (await hasAuthCookie(browser.client)) return;
		process.stderr.write(
			"ブラウザでXへログインしてください。認証完了を最大10分待機します\n",
		);
		const deadline = Date.now() + AUTH_TIMEOUT_MS;
		while (Date.now() < deadline) {
			await delay(AUTH_POLL_INTERVAL_MS);
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
		this.listenForRelationshipResponses();
	}

	private listenForRelationshipResponses(): void {
		this.client.on<{ requestId: string; response?: { url?: string } }>(
			"Network.responseReceived",
			(params, sessionId) => {
				if (sessionId !== this.sessionId) return;
				const url = params.response?.url ?? "";
				if (
					url.includes("/graphql/") &&
					url.includes(USER_RELATIONSHIP_ENDPOINT)
				)
					this.responseRequests.add(params.requestId);
			},
		);
		this.client.on<{ requestId: string }>(
			"Network.loadingFinished",
			(params, sessionId) => {
				if (
					sessionId !== this.sessionId ||
					!this.responseRequests.delete(params.requestId)
				)
					return;
				this.trackResponseTask(params.requestId);
			},
		);
		this.client.on<{ requestId: string }>(
			"Network.loadingFailed",
			(params, sessionId) => {
				if (sessionId === this.sessionId)
					this.responseRequests.delete(params.requestId);
			},
		);
	}

	private trackResponseTask(requestId: string): void {
		const task = this.readRelationshipResponse(requestId);
		this.responseTasks.add(task);
		void task.finally(() => this.responseTasks.delete(task));
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
			{ expression: PAGE_STATE_EXPRESSION, returnByValue: true },
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
		const url = profileUrl(username);
		this.relationships.delete(key);
		await this.client.send("Page.navigate", { url }, this.sessionId);
		const startedAt = Date.now();
		let status: CheckResult["status"] = "unknown";
		while (Date.now() - startedAt < timeoutMs) {
			await delay(CHECK_POLL_INTERVAL_MS);
			await Promise.all([...this.responseTasks]);
			const [currentUrl, pageState] = await Promise.all([
				this.currentUrl(),
				this.readPageState(),
			]);
			if (LOGIN_URL_PATTERN.test(currentUrl))
				throw new Error("Xの認証が切れています。authを再実行してください");
			const classified = classify(
				pageState,
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
			url,
		};
	}
}

async function createCheckerSession(client: CdpClient): Promise<string> {
	const { targetId } = await client.send<{ targetId: string }>(
		"Target.createTarget",
		{ url: "about:blank", background: true },
	);
	const { sessionId } = await client.send<{ sessionId: string }>(
		"Target.attachToTarget",
		{ targetId, flatten: true },
	);
	await Promise.all([
		client.send("Network.enable", {}, sessionId),
		client.send("Page.enable", {}, sessionId),
		client.send("Runtime.enable", {}, sessionId),
	]);
	return sessionId;
}

type ProgressCallback = (
	index: number,
	total: number,
	result: CheckResult,
) => void;

export async function checkUsers(
	config: RuntimeConfig,
	onProgress?: ProgressCallback,
): Promise<CheckResult[]> {
	const browser = await launchBrowser(config, config.headless, "about:blank");
	try {
		if (!(await hasAuthCookie(browser.client)))
			throw new Error(
				"Xへ未認証です。先に x-block-checker auth を実行してください",
			);
		const sessionId = await createCheckerSession(browser.client);
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
