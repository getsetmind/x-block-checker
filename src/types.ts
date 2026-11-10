/**
 * 判定状態の一覧
 * 表示と保存の順序を固定するため配列で定義する
 */
export const statuses = [
	"blocked",
	"mutual",
	"blocking",
	"clear",
	"notFound",
	"suspended",
	"unknown",
] as const;

/**
 * 判定状態
 */
export type Status = (typeof statuses)[number];

/**
 * 公開範囲の一覧
 */
export const visibilities = ["public", "protected", "unknown"] as const;

/**
 * 公開範囲
 */
export type Visibility = (typeof visibilities)[number];

/**
 * 判定方式の一覧
 */
export const relationshipModes = ["auto", "dom", "passive", "direct"] as const;

/**
 * 判定方式
 */
export type RelationshipMode = (typeof relationshipModes)[number];

/**
 * 判定状態の日本語ラベル
 */
export const statusLabels = {
	blocked: "ブロック確認",
	mutual: "相互ブロック",
	blocking: "自分からのみブロック",
	clear: "未ブロック",
	notFound: "存在しない",
	suspended: "凍結",
	unknown: "判定不能",
} as const satisfies Record<Status, string>;

/**
 * 公開範囲の日本語ラベル
 */
export const visibilityLabels = {
	public: "公開",
	protected: "鍵アカウント",
	unknown: "不明",
} as const satisfies Record<Visibility, string>;

/**
 * プロフィールから抽出した関係
 * blockedByは相手からのブロック、blockingは自分からのブロックを表す
 */
export interface Relationship {
	username: string;
	blockedBy?: boolean;
	blocking?: boolean;
	protected?: boolean;
}

/**
 * 判定に使うプロフィール画面の状態
 */
export interface PageState {
	text: string;
	profileLoaded: boolean;
}

/**
 * 1ユーザー分の判定結果
 */
export interface CheckResult {
	username: string;
	status: Status;
	visibility: Visibility;
	checkedAt: string;
	url: string;
}

/**
 * ユーザー名単位で保持する判定履歴
 */
export interface History {
	version: 1;
	updatedAt: string;
	results: Record<string, CheckResult>;
}

/**
 * 設定ファイルが受け付ける任意項目
 */
export interface ConfigFile {
	users?: string[];
	input?: string;
	outputDir?: string;
	profileDir?: string;
	browserExecutable?: string;
	timeoutSeconds?: number;
	headless?: boolean;
	relationshipMode?: RelationshipMode;
}

/**
 * 検証と既定値の解決を終えた実行時設定
 */
export interface RuntimeConfig {
	users: string[];
	outputDir: string;
	profileDir: string;
	browserExecutable: string;
	timeoutMs: number;
	headless: boolean;
	relationshipMode: RelationshipMode;
}

/**
 * doctorコマンドの診断結果
 */
export interface DoctorResult {
	ready: boolean;
	authenticated: boolean;
	configuredUsers: number;
	browserExecutable: string;
	profileDir: string;
	message: string;
}
