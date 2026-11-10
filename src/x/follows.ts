import type {
	AccountListCollection,
	AccountListKind,
} from "../account-lists/types";
import { isUsername } from "../config/usernames";
import {
	type AccountListAdapter,
	type AccountListPage,
	readAccountList,
} from "./account-list";
import { readAccountListTimeline } from "./account-list-timeline";

interface FollowReadOptions {
	kind: Exclude<AccountListKind, "blocking">;
	ownerId: string;
	username: string;
	checkpoint?: AccountListCollection;
	onProgress?: (progress: AccountListCollection) => Promise<void>;
	pageLimit?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new Error("一覧のレスポンス形式が未対応です");
	}
	return value;
}

function followAdapter(options: FollowReadOptions): AccountListAdapter {
	if (!isUsername(options.username) || !/^[1-9]\d*$/.test(options.ownerId)) {
		throw new Error("一覧の取得対象を確認できません");
	}
	const operation = options.kind === "following" ? "Following" : "Followers";
	return {
		pageUrl: `https://x.com/${options.username}/${options.kind}`,
		matchesResponse(response) {
			const url = new URL(response.url());
			if (
				url.protocol !== "https:" ||
				!["x.com", "api.x.com", "twitter.com", "api.twitter.com"].includes(
					url.hostname,
				) ||
				response.request().method() !== "GET" ||
				!url.pathname.includes("/graphql/") ||
				!url.pathname.endsWith(`/${operation}`)
			) {
				return false;
			}
			try {
				const variables = record(
					JSON.parse(url.searchParams.get("variables") ?? "{}"),
				);
				return (
					variables.cursor === undefined && variables.userId === options.ownerId
				);
			} catch {
				return false;
			}
		},
		source: () => "graphql",
		readPage(payload) {
			const root = record(payload);
			if ("errors" in root) {
				throw new Error("一覧の取得に失敗しました");
			}
			const result = record(record(record(root.data).user).result);
			return readAccountListTimeline(
				record(record(result.timeline).timeline).instructions,
			);
		},
		advanceCursor(url, _source, cursor) {
			const variables = record(
				JSON.parse(url.searchParams.get("variables") ?? "{}"),
			);
			variables.cursor = cursor;
			url.searchParams.set("variables", JSON.stringify(variables));
		},
	};
}

/**
 * @param page - フォロー・フォロワー一覧の取得に使うページ
 * @param timeoutMs - ページ遷移と通信の待機上限（ミリ秒）
 * @param options - 一覧種別、本人の識別情報、再開・進捗通知・取得上限の設定
 * @returns 指定した一覧の取得結果と再開可能な進捗
 */
export async function readFollowList(
	page: AccountListPage,
	timeoutMs: number,
	options: FollowReadOptions,
): Promise<AccountListCollection> {
	if (
		options.checkpoint?.complete ||
		(options.checkpoint?.retryAt &&
			Date.parse(options.checkpoint.retryAt) > Date.now())
	) {
		return options.checkpoint;
	}
	return readAccountList(page, timeoutMs, {
		...options,
		adapter: followAdapter(options),
	});
}
