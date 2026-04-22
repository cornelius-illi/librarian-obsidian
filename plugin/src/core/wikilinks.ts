import { slugify } from "./vault";

export interface Wikilink {
	raw: string;
	target: string;
	displayText: string;
}

const WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export function extractWikilinks(content: string): Wikilink[] {
	const links: Wikilink[] = [];
	for (const match of content.matchAll(WIKILINK_REGEX)) {
		links.push({
			raw: match[0],
			target: match[1].trim(),
			displayText: (match[2] || match[1]).trim(),
		});
	}
	return links;
}

export function pageAliases(id: string, name: string): string[] {
	const nameLower = name.toLowerCase();
	return uniqueAliases([
		id,
		nameLower,
		slugify(name),
		nameLower.replace(/-/g, " "),
		nameLower.replace(/[^a-z0-9]/g, ""),
	]);
}

export function linkTargetAliases(rawTarget: string): string[] {
	const normalized = rawTarget
		.trim()
		.replace(/\\/g, "/")
		.replace(/\.md$/i, "")
		.replace(/^\/+/, "");
	const targetName = normalized.split("/").pop() || normalized;
	const targetLower = normalized.toLowerCase();
	const targetNoParens = targetLower.replace(/\s*\([^)]*\)\s*/g, "").trim();
	const targetAlpha = targetLower.replace(/[^a-z0-9]/g, "");
	return uniqueAliases([
		normalized,
		targetName,
		slugify(targetName),
		slugify(normalized),
		targetLower,
		targetNoParens,
		slugify(targetNoParens),
		targetAlpha,
	]);
}

function uniqueAliases(values: string[]): string[] {
	return [...new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean))];
}
