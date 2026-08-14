import { type HTTPResponse, type Page, TimeoutError } from "puppeteer-core";
import { classify } from "./classifier";
import {
	captureGraphqlTemplate,
	createReplayRequest,
	type GraphqlTemplate,
	isUserByScreenName,
	type ReplayRequest,
} from "./graphql";
import { extractRelationships } from "./relationship";
import type {
	CheckResult,
	PageState,
	Relationship,
	RelationshipMode,
} from "./types";
import { isUsername } from "./usernames";

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class XChecker {
	private readonly relationships = new Map<string, Relationship>();
	private readonly responseTasks = new Set<Promise<void>>();
	private graphqlTemplate?: GraphqlTemplate;

	constructor(
		private readonly page: Page,
		private readonly mode: RelationshipMode,
	) {
		if (mode !== "dom") {
			page.on("response", (response) => this.trackResponse(response));
			if (mode === "auto" || mode === "direct")
				page.on("request", (request) => {
					const template = captureGraphqlTemplate(request);
					if (template) this.graphqlTemplate = template;
				});
		}
	}

	private trackResponse(response: HTTPResponse): void {
		if (!isUserByScreenName(response.url())) return;
		const task = this.readResponse(response);
		this.responseTasks.add(task);
		void task.finally(() => this.responseTasks.delete(task));
	}

	private async readResponse(response: HTTPResponse): Promise<void> {
		try {
			for (const relationship of extractRelationships(await response.json()))
				this.relationships.set(
					relationship.username.toLowerCase(),
					relationship,
				);
		} catch {
			// GraphQLレスポンスを読めない場合はDOM判定を続ける
		}
	}

	private async directRelationship(
		username: string,
	): Promise<Relationship | undefined> {
		if (!this.graphqlTemplate) return;
		let request: ReplayRequest | null;
		try {
			request = createReplayRequest(this.graphqlTemplate, username);
		} catch {
			return;
		}
		if (!request) return;

		try {
			const response = await this.page.evaluate(async (input) => {
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

	private async pageState(): Promise<PageState> {
		return (await this.page.evaluate(`(() => {
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

	private result(username: string, status: CheckResult["status"]): CheckResult {
		return {
			username,
			status,
			checkedAt: new Date().toISOString(),
			url: `https://x.com/${encodeURIComponent(username)}`,
		};
	}

	private async checkPage(
		username: string,
		timeoutMs: number,
	): Promise<CheckResult> {
		const key = username.toLowerCase();
		const startedAt = Date.now();
		this.relationships.delete(key);
		try {
			await this.page.goto(`https://x.com/${encodeURIComponent(username)}`, {
				waitUntil: "domcontentloaded",
				timeout: timeoutMs,
			});
		} catch (error) {
			if (!(error instanceof TimeoutError)) throw error;
		}

		while (Date.now() - startedAt < timeoutMs) {
			await delay(500);
			await Promise.all([...this.responseTasks]);
			if (/\/(?:i\/flow\/login|login)(?:[/?#]|$)/.test(this.page.url()))
				throw new Error("Xの認証が切れています。authを再実行してください");
			const status = classify(
				await this.pageState(),
				this.mode === "dom" ? undefined : this.relationships.get(key),
				Date.now() - startedAt,
			);
			if (status) return this.result(username, status);
		}
		return this.result(username, "unknown");
	}

	async check(username: string, timeoutMs: number): Promise<CheckResult> {
		if (!isUsername(username)) throw new Error("不正なユーザー名です");
		if (
			(this.mode === "auto" || this.mode === "direct") &&
			this.graphqlTemplate
		) {
			const relationship = await this.directRelationship(username);
			const status = classify(
				{ text: "", profileLoaded: false },
				relationship,
				Number.POSITIVE_INFINITY,
			);
			if (status) return this.result(username, status);
			if (this.mode === "direct") return this.result(username, "unknown");
		}
		return this.checkPage(username, timeoutMs);
	}
}
