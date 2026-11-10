import type { Browser, Page } from "puppeteer-core";
import type {
	AccountListCheckpoint,
	AccountListKind,
} from "../account-lists/types";
import type { RuntimeConfig } from "../types";
import { readBlockingList } from "./blocking";
import { withAuthenticatedPage } from "./browser";
import { readFollowList } from "./follows";

interface AccountListOptions {
	kind: AccountListKind;
	checkpoint?: AccountListCheckpoint;
	onProgress?: (progress: AccountListCheckpoint) => Promise<void>;
	pageLimit?: number;
}

async function ownUsername(page: Page, timeoutMs: number): Promise<string> {
	try {
		await page.goto("https://x.com/home", {
			waitUntil: "domcontentloaded",
			timeout: timeoutMs,
		});
		const selector = 'a[data-testid="AppTabBar_Profile_Link"]';
		await page.waitForSelector(selector, { timeout: timeoutMs });
		const href = await page.$eval(selector, (element) =>
			element.getAttribute("href"),
		);
		const url = new URL(href ?? "", "https://x.com");
		const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})$/);
		if (url.origin === "https://x.com" && match?.[1]) {
			return match[1];
		}
	} catch {
		// biome-ignore lint/style/useErrorCause: 内部URLや認証情報を含む例外をcauseに保持しない
		throw new Error(
			"Xのプロフィールを確認できません。認証と画面変更を確認してください",
		);
	}
	throw new Error("Xのプロフィールを確認できません");
}

async function accountOwnerId(browser: Browser): Promise<string> {
	const cookies = await browser.defaultBrowserContext().cookies();
	const ids = new Set(
		cookies
			.filter(
				(cookie) =>
					cookie.name === "twid" &&
					cookie.domain.replace(/^\./, "").toLowerCase() === "x.com",
			)
			.map(
				(cookie) =>
					cookie.value.replace(/%3d/gi, "=").match(/^"?u=([1-9]\d*)"?$/)?.[1],
			),
	);
	const [id] = ids;
	if (ids.size === 1 && id) {
		return id;
	}
	throw new Error(
		"Xのログインアカウントを確認できません。authを再実行してください",
	);
}

/**
 * @param config - 解決済みの実行時設定
 * @param options - 一覧の種類とアカウントに紐付く再開情報
 * @returns ログインアカウントIDを含む一覧の取得結果と再開可能な進捗
 */
export async function collectAccountList(
	config: RuntimeConfig,
	options: AccountListOptions,
): Promise<AccountListCheckpoint> {
	return withAuthenticatedPage(config, async (browser, page) => {
		const ownerId = await accountOwnerId(browser);
		if (options.checkpoint && options.checkpoint.ownerId !== ownerId) {
			throw new Error(
				"保存済みの進捗とログインアカウントが異なります。別の出力先を使うか --restart を指定してください",
			);
		}
		const onProgress = async (
			progress: Omit<AccountListCheckpoint, "ownerId">,
		): Promise<void> => {
			await options.onProgress?.({ ...progress, ownerId });
		};
		const readOptions = {
			...(options.checkpoint ? { checkpoint: options.checkpoint } : {}),
			...(options.pageLimit !== undefined
				? { pageLimit: options.pageLimit }
				: {}),
			onProgress,
		};
		if (options.kind === "blocking") {
			return {
				...(await readBlockingList(page, config.timeoutMs, readOptions)),
				ownerId,
			};
		}
		const cached =
			options.checkpoint?.complete ||
			(options.checkpoint?.retryAt &&
				Date.parse(options.checkpoint.retryAt) > Date.now());
		const username = cached ? "" : await ownUsername(page, config.timeoutMs);
		const result = await readFollowList(page, config.timeoutMs, {
			...readOptions,
			kind: options.kind,
			ownerId,
			username,
		});
		return { ...result, ownerId };
	});
}
