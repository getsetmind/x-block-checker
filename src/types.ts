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

export const statusLabels: Record<Status, string> = {
	blocked: "ブロック確認",
	mutual: "相互ブロック",
	blocking: "自分からのみブロック",
	clear: "未ブロック",
	notFound: "存在しない",
	suspended: "凍結",
	unknown: "判定不能",
};

export interface Relationship {
	username: string;
	blockedBy?: boolean;
	blocking?: boolean;
}

export interface PageState {
	text: string;
	profileLoaded: boolean;
}

export interface CheckResult {
	username: string;
	status: Status;
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
}

export interface RuntimeConfig {
	users: string[];
	outputDir: string;
	profileDir: string;
	browserExecutable: string;
	timeoutMs: number;
	headless: boolean;
}
