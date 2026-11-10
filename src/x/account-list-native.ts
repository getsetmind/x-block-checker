import type { HTTPRequest } from "puppeteer-core";
import type { AccountListPage, AccountListResponse } from "./account-list";

/**
 * ブラウザ自身が生成した一覧リクエストの捕捉契約
 */
export type NativeAccountListRequest = Pick<
	HTTPRequest,
	"url" | "method" | "headers" | "continue" | "isInterceptResolutionHandled"
>;

/**
 * 一覧通信の一時的な捕捉と解除に使うページ
 */
export type NativeAccountListPage = AccountListPage & {
	setRequestInterception(enabled: boolean): Promise<void>;
	on(
		event: "request",
		listener: (request: NativeAccountListRequest) => void,
	): unknown;
	off(
		event: "request",
		listener: (request: NativeAccountListRequest) => void,
	): unknown;
};

/**
 * @param page - 認証済みのブラウザページ
 * @param pageUrl - 一覧の表示URL
 * @param cursor - 再開するページのカーソル
 * @param timeoutMs - 遷移と応答の待機上限
 * @param matchesRequest - 対象の初回通信を選択する条件
 * @param advanceCursor - 通信URLのカーソル更新処理
 * @returns カーソルを差し替えた通信に対応するレスポンス
 */
export async function loadNativeAccountListPage(
	page: NativeAccountListPage,
	pageUrl: string,
	cursor: string,
	timeoutMs: number,
	matchesRequest: (request: NativeAccountListRequest) => boolean,
	advanceCursor: (url: URL, cursor: string) => void,
): Promise<AccountListResponse> {
	const controller = new AbortController();
	let intercepted: NativeAccountListRequest | undefined;
	const { promise: failure, reject: rejectRequest } =
		Promise.withResolvers<never>();
	const handleRequest = async (
		request: NativeAccountListRequest,
	): Promise<void> => {
		if (request.isInterceptResolutionHandled()) {
			return;
		}
		if (!intercepted && matchesRequest(request)) {
			const url = new URL(request.url());
			advanceCursor(url, cursor);
			intercepted = request;
			await request.continue({ url: url.toString() });
		} else {
			await request.continue();
		}
	};
	const onRequest = (request: NativeAccountListRequest): void => {
		void handleRequest(request).catch(rejectRequest);
	};
	try {
		await page.setRequestInterception(true);
		page.on("request", onRequest);
		const waiting = page.waitForResponse(
			(response) =>
				intercepted !== undefined && response.request() === intercepted,
			{ timeout: timeoutMs, signal: controller.signal },
		);
		const [response] = await Promise.race([
			Promise.all([
				waiting,
				page.goto(pageUrl, {
					waitUntil: "domcontentloaded",
					timeout: timeoutMs,
				}),
			]),
			failure,
		]);
		return response;
	} finally {
		page.off("request", onRequest);
		controller.abort();
		await page.setRequestInterception(false);
	}
}
