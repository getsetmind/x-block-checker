import { readAccountListTimeline } from "./account-list-timeline";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new Error("ブロック一覧のタイムライン形式が未対応です");
	}
	return value;
}

/**
 * @param payload - ブロック一覧のGraphQLレスポンス
 * @returns 抽出したアカウントと次のカーソル（終端確認済みならnull）
 */
export function readBlockingTimeline(payload: unknown) {
	const root = record(payload);
	if ("errors" in root) {
		throw new Error("ブロック一覧の取得に失敗しました");
	}
	const viewer = record(record(root.data).viewer);
	return readAccountListTimeline(
		record(record(viewer.timeline).timeline).instructions,
	);
}
