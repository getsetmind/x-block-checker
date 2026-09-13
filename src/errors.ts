/**
 * unknownからNode.jsのエラーコードを取り出して比較する
 *
 * @param error - 判定する値
 * @param code - 比較するエラーコード
 */
export function hasErrorCode(error: unknown, code: string): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === code
	);
}
