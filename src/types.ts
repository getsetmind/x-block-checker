export const statuses = [
	"blocked",
	"mutual",
	"blocking",
	"clear",
	"notFound",
	"suspended",
	"unknown",
] as const;

export type Status = (typeof statuses)[number];

export const visibilities = ["public", "protected", "unknown"] as const;

export type Visibility = (typeof visibilities)[number];

export const relationshipModes = ["auto", "dom", "passive", "direct"] as const;

export type RelationshipMode = (typeof relationshipModes)[number];

export const statusLabels = {
	blocked: "ブロック確認",
	mutual: "相互ブロック",
	blocking: "自分からのみブロック",
	clear: "未ブロック",
	notFound: "存在しない",
	suspended: "凍結",
	unknown: "判定不能",
} as const satisfies Record<Status, string>;

export const visibilityLabels = {
	public: "公開",
	protected: "鍵アカウント",
	unknown: "不明",
} as const satisfies Record<Visibility, string>;

export interface Relationship {
	username: string;
	blockedBy?: boolean;
	blocking?: boolean;
	protected?: boolean;
}

export interface PageState {
	text: string;
	profileLoaded: boolean;
}

export interface CheckResult {
	username: string;
	status: Status;
	visibility: Visibility;
	checkedAt: string;
	url: string;
}

export interface History {
	version: 1;
	updatedAt: string;
	results: Record<string, CheckResult>;
}

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

export interface RuntimeConfig {
	users: string[];
	outputDir: string;
	profileDir: string;
	browserExecutable: string;
	timeoutMs: number;
	headless: boolean;
	relationshipMode: RelationshipMode;
}

export interface DoctorResult {
	ready: boolean;
	authenticated: boolean;
	configuredUsers: number;
	browserExecutable: string;
	profileDir: string;
	message: string;
}
