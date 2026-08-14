import { describe, expect, test } from "bun:test";
import { extractRelationships } from "../src/x/relationship";

describe("extractRelationships", () => {
	test("legacy形式を抽出する", () => {
		expect(
			extractRelationships({
				legacy: {
					screen_name: "Foo",
					blocked_by: true,
					blocking: false,
					protected: true,
				},
			}),
		).toEqual([
			{
				username: "Foo",
				blockedBy: true,
				blocking: false,
				protected: true,
			},
		]);
	});

	test("ブロック関係がなくても鍵アカウントを抽出する", () => {
		expect(
			extractRelationships({
				legacy: { screen_name: "Private", protected: true },
			}),
		).toEqual([{ username: "Private", protected: true }]);
	});

	test("privacy形式から公開範囲を抽出する", () => {
		expect(
			extractRelationships({
				core: { screen_name: "Current" },
				privacy: { protected: true },
			}),
		).toEqual([{ username: "Current", protected: true }]);
	});

	test("relationship_perspectives形式を抽出する", () => {
		expect(
			extractRelationships({
				username: "Bar",
				relationship_perspectives: { blocked_by: false, blocking: true },
			}),
		).toEqual([{ username: "Bar", blockedBy: false, blocking: true }]);
	});

	test("配列内にネストされた関係を抽出する", () => {
		expect(
			extractRelationships({
				users: [
					{
						core: { screen_name: "Baz" },
						relationshipPerspective: { blockedBy: true },
					},
				],
			}),
		).toEqual([{ username: "Baz", blockedBy: true }]);
	});

	test("別ノードの関係と公開範囲を統合する", () => {
		expect(
			extractRelationships({
				users: [
					{
						core: { screen_name: "Combined" },
						privacy: { protected: true },
					},
					{
						username: "combined",
						relationship_perspectives: {
							blocked_by: false,
							blocking: false,
						},
					},
				],
			}),
		).toEqual([
			{
				username: "combined",
				protected: true,
				blockedBy: false,
				blocking: false,
			},
		]);
	});
});
