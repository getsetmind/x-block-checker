import { type HTTPResponse, type Page, TimeoutError } from "puppeteer-core";
import { isUsername } from "../config/usernames";
import type {
	CheckResult,
	PageState,
	Relationship,
	RelationshipMode,
} from "../types";
import { classify } from "./classifier";
import {
	captureGraphqlTemplate,
	createReplayRequest,
	type GraphqlTemplate,
	isUserByScreenName,
	type ReplayRequest,
} from "./graphql";
import { extractRelationships } from "./relationship";

interface CheckerState {
	page: Page;
	mode: RelationshipMode;
	relationships: Map<string, Relationship>;
	responseTasks: Set<Promise<void>>;
	graphqlTemplate?: GraphqlTemplate;
}

export type CheckUser = (
	username: string,
	timeoutMs: number,
) => Promise<CheckResult>;

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readResponse(
	state: CheckerState,
	response: HTTPResponse,
): Promise<void> {
	try {
		for (const relationship of extractRelationships(await response.json()))
			state.relationships.set(
				relationship.username.toLowerCase(),
				relationship,
			);
	} catch {
		// GraphQLレスポンスを読めない場合はDOM判定を続ける
	}
}

function trackResponse(state: CheckerState, response: HTTPResponse): void {
	if (!isUserByScreenName(response.url())) return;
	const task = readResponse(state, response);
	state.responseTasks.add(task);
	void task.finally(() => state.responseTasks.delete(task));
}

async function directRelationship(
	state: CheckerState,
	username: string,
): Promise<Relationship | undefined> {
	if (!state.graphqlTemplate) return;
	let request: ReplayRequest | null;
	try {
		request = createReplayRequest(state.graphqlTemplate, username);
	} catch {
		return;
	}
	if (!request) return;

	try {
		const response = await state.page.evaluate(async (input) => {
			const result = await fetch(input.url, {
				method: input.method,
				headers: input.headers,
				body: input.body,
				credentials: "include",
			});
			return { ok: result.ok, text: await result.text() };
		}, request);
		if (!response.ok) return;
		return extractRelationships(JSON.parse(response.text)).find(
			(relationship) =>
				relationship.username.toLowerCase() === username.toLowerCase(),
		);
	} catch {
		return;
	}
}

async function readPageState(page: Page): Promise<PageState> {
	return (await page.evaluate(`(() => {
		const primary = document.querySelector('[data-testid="primaryColumn"]');
		const text = primary?.innerText || document.body?.innerText || '';
		const profileLoaded = Boolean(
			primary?.querySelector('[data-testid="UserName"]') ||
			primary?.querySelector('[data-testid="UserDescription"]') ||
			primary?.querySelector('[data-testid$="-follow"]')
		);
		return { text, profileLoaded };
	})()`)) as PageState;
}

function createResult(
	username: string,
	status: CheckResult["status"],
): CheckResult {
	return {
		username,
		status,
		checkedAt: new Date().toISOString(),
		url: `https://x.com/${encodeURIComponent(username)}`,
	};
}

async function checkPage(
	state: CheckerState,
	username: string,
	timeoutMs: number,
): Promise<CheckResult> {
	const key = username.toLowerCase();
	const startedAt = Date.now();
	state.relationships.delete(key);
	try {
		await state.page.goto(`https://x.com/${encodeURIComponent(username)}`, {
			waitUntil: "domcontentloaded",
			timeout: timeoutMs,
		});
	} catch (error) {
		if (!(error instanceof TimeoutError)) throw error;
	}

	while (Date.now() - startedAt < timeoutMs) {
		await delay(500);
		await Promise.all([...state.responseTasks]);
		if (/\/(?:i\/flow\/login|login)(?:[/?#]|$)/.test(state.page.url()))
			throw new Error("Xの認証が切れています。authを再実行してください");
		const status = classify(
			await readPageState(state.page),
			state.mode === "dom" ? undefined : state.relationships.get(key),
			Date.now() - startedAt,
		);
		if (status) return createResult(username, status);
	}
	return createResult(username, "unknown");
}

async function checkUser(
	state: CheckerState,
	username: string,
	timeoutMs: number,
): Promise<CheckResult> {
	if (!isUsername(username)) throw new Error("不正なユーザー名です");
	if (
		(state.mode === "auto" || state.mode === "direct") &&
		state.graphqlTemplate
	) {
		const relationship = await directRelationship(state, username);
		const status = classify(
			{ text: "", profileLoaded: false },
			relationship,
			Number.POSITIVE_INFINITY,
		);
		if (status) return createResult(username, status);
		if (state.mode === "direct") return createResult(username, "unknown");
	}
	return checkPage(state, username, timeoutMs);
}

export function createXChecker(page: Page, mode: RelationshipMode): CheckUser {
	const state: CheckerState = {
		page,
		mode,
		relationships: new Map(),
		responseTasks: new Set(),
	};
	if (mode !== "dom") {
		page.on("response", (response) => trackResponse(state, response));
		if (mode === "auto" || mode === "direct")
			page.on("request", (request) => {
				const template = captureGraphqlTemplate(request);
				if (template) state.graphqlTemplate = template;
			});
	}
	return (username, timeoutMs) => checkUser(state, username, timeoutMs);
}
