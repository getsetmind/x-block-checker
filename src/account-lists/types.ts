/**
 * アカウント一覧の種類
 */
export type AccountListKind = "blocking" | "following" | "followers";

/**
 * 一覧に含まれるアカウント
 */
export interface Account {
	id: string;
	username: string;
	url: string;
}

/**
 * アカウント一覧のスナップショット
 */
export interface AccountListSnapshot {
	version: 1;
	checkedAt: string;
	accounts: Account[];
}

/**
 * アカウント一覧の取得進捗
 */
export interface AccountListCollection extends AccountListSnapshot {
	source: "graphql" | "rest";
	nextCursor: string | null;
	pages: number;
	startedAt: string;
	complete: boolean;
	retryAt?: string;
	stopReason?: "rateLimit" | "pageLimit";
}

/**
 * アカウントに結び付けた一覧の再開情報
 */
export interface AccountListCheckpoint extends AccountListCollection {
	ownerId: string;
}
