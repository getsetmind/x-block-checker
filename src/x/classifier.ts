import type { PageState, Relationship, Status, Visibility } from "../types";

/**
 * 未ブロックと確定するまでに待つ最短時間
 */
export const MIN_CLEAR_WAIT_MS = 5000;

function classifyRelationship(
	relationship: Relationship | undefined,
): Status | null {
	if (!relationship) return null;

	const { blockedBy, blocking } = relationship;
	if (blockedBy === true) return blocking === true ? "mutual" : "blocked";
	if (blockedBy === false && blocking === true) return "blocking";
	if (blockedBy === false && blocking === false) return "clear";
	return null;
}

/**
 * 画面状態と抽出済みの関係から判定状態を決める
 *
 * @param state - プロフィール画面の状態
 * @param relationship - 抽出済みの関係
 * @param elapsedMs - 画面表示からの経過時間
 */
export function classify(
	state: PageState,
	relationship: Relationship | undefined,
	elapsedMs: number,
): Status | null {
	if (
		/ブロックされています|あなたをブロックしました|ブロックされているため|you(?:'|’)re blocked|blocked you|has blocked you/i.test(
			state.text,
		)
	)
		return relationship?.blocking === true ? "mutual" : "blocked";
	if (/アカウントは凍結|account (?:is|has been) suspended/i.test(state.text))
		return "suspended";
	if (
		/アカウントは存在しません|this account doesn(?:'|’)t exist/i.test(
			state.text,
		)
	)
		return "notFound";

	const relationshipStatus = classifyRelationship(relationship);
	if (relationshipStatus) return relationshipStatus;
	if (elapsedMs < MIN_CLEAR_WAIT_MS) return null;
	if (state.profileLoaded && !/ブロックを解除|unblock/i.test(state.text))
		return "clear";
	return null;
}

/**
 * 画面状態と抽出済みの関係から公開範囲を決める
 *
 * @param state - プロフィール画面の状態
 * @param relationship - 抽出済みの関係
 * @param elapsedMs - 画面表示からの経過時間
 */
export function classifyVisibility(
	state: PageState,
	relationship: Relationship | undefined,
	elapsedMs: number,
): Visibility | null {
	if (relationship?.protected === true) return "protected";
	if (relationship?.protected === false) return "public";
	if (
		/このアカウント(?:のポスト)?は非公開|ポストは非公開です|these posts are protected|this account is private/i.test(
			state.text,
		)
	)
		return "protected";
	if (elapsedMs >= MIN_CLEAR_WAIT_MS && state.profileLoaded) return "unknown";
	return null;
}
