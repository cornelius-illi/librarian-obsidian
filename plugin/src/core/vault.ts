import { App, normalizePath } from "obsidian";
import { bm25Rank } from "./search";
import { extractWikilinks, linkTargetAliases, pageAliases } from "./wikilinks";

export interface WikiPage {
	path: string;
	relativePath: string;
	content: string;
	contentLower: string;
	frontmatter: Record<string, unknown>;
}

export interface PendingStub {
	slug: string;
	title: string;
	category: string;
	path: string;
	referencedBy: string[];
}

export interface RelevantPageOptions {
	limit?: number;
}

const DEFAULT_RELEVANT_PAGE_LIMIT = 12;

export function isSystemPage(name: string): boolean {
	return name === "index" || name === "log";
}

export function toPageId(pagePath: string): string {
	return pagePath.replace(/^wiki\//, "").replace(/\.md$/i, "").replace(/\\/g, "/");
}

export class LibrarianVault {
	constructor(
		private readonly app: App,
		public readonly rawDir: string,
		public readonly wikiDir: string,
	) {}

	private get pendingStubsPath(): string {
		return `${this.wikiDir}/.pending-stubs.json`;
	}

	private get logPath(): string {
		return `${this.wikiDir}/log.md`;
	}

	async readFile(relativePath: string): Promise<string> {
		return this.app.vault.adapter.read(normalizePath(relativePath));
	}

	async writeFile(relativePath: string, content: string): Promise<void> {
		const normalized = normalizePath(relativePath);
		await this.ensureParentDir(normalized);
		await this.app.vault.adapter.write(normalized, content);
	}

	async writeBinary(relativePath: string, data: ArrayBuffer): Promise<void> {
		const normalized = normalizePath(relativePath);
		await this.ensureParentDir(normalized);
		await this.app.vault.adapter.writeBinary(normalized, data);
	}

	async readBinary(relativePath: string): Promise<ArrayBuffer> {
		return this.app.vault.adapter.readBinary(normalizePath(relativePath));
	}

	async deleteFile(relativePath: string): Promise<void> {
		await this.app.vault.adapter.remove(normalizePath(relativePath));
	}

	async fileExists(relativePath: string): Promise<boolean> {
		return this.app.vault.adapter.exists(normalizePath(relativePath));
	}

	private async ensureParentDir(relativePath: string): Promise<void> {
		const idx = relativePath.lastIndexOf("/");
		if (idx <= 0) return;
		const dir = relativePath.slice(0, idx);
		const exists = await this.app.vault.adapter.exists(dir);
		if (!exists) {
			await this.app.vault.adapter.mkdir(dir);
		}
	}

	async listRawFiles(): Promise<string[]> {
		const files: string[] = [];
		await this.walk(this.rawDir, this.rawDir, files, (rel) => !rel.startsWith("assets/"));
		return files.sort();
	}

	async listWikiPages(subdir?: string): Promise<string[]> {
		const prefix = subdir ? `${this.wikiDir}/${subdir}/` : `${this.wikiDir}/`;
		const allMd = this.app.vault.getMarkdownFiles();
		const wikiPrefix = `${this.wikiDir}/`;
		return allMd
			.filter((f) => f.path.startsWith(prefix))
			.map((f) => f.path.slice(wikiPrefix.length))
			.sort();
	}

	private async walk(
		base: string,
		dir: string,
		out: string[],
		accept: (relativeFromBase: string) => boolean,
	): Promise<void> {
		let listing;
		try {
			listing = await this.app.vault.adapter.list(dir);
		} catch {
			return;
		}
		for (const filePath of listing.files) {
			const rel = filePath.slice(base.length + 1);
			if (accept(rel)) out.push(rel);
		}
		for (const folderPath of listing.folders) {
			const rel = folderPath.slice(base.length + 1);
			if (accept(rel)) {
				await this.walk(base, folderPath, out, accept);
			}
		}
	}

	async readWikiPage(relativePath: string): Promise<WikiPage> {
		const fullRelative = relativePath.startsWith(`${this.wikiDir}/`)
			? relativePath
			: `${this.wikiDir}/${relativePath}`;
		const content = await this.readFile(fullRelative);
		return buildWikiPage(fullRelative, content);
	}

	async getIngestedSources(): Promise<Set<string>> {
		const ingested = new Set<string>();
		try {
			const logContent = await this.readFile(this.logPath);
			const matches = logContent.matchAll(/^Verarbeitet:\s*(.+)$/gm);
			for (const match of matches) {
				ingested.add(match[1].trim());
			}
		} catch {
			/* kein Log */
		}
		return ingested;
	}

	async forgetSource(filename: string): Promise<void> {
		try {
			const logContent = await this.readFile(this.logPath);
			const updated = logContent
				.split("\n")
				.filter((line) => {
					const match = line.match(/^Verarbeitet:\s*(.+)$/);
					return !match || match[1].trim() !== filename;
				})
				.join("\n");
			await this.writeFile(this.logPath, updated);
		} catch {
			/* kein Log */
		}
	}

	async appendLog(entry: string): Promise<void> {
		try {
			const existing = await this.readFile(this.logPath);
			await this.writeFile(this.logPath, existing + entry);
		} catch {
			await this.writeFile(this.logPath, `# Wiki-Protokoll\n${entry}`);
		}
	}

	async findRelevantPages(
		keywords: string[],
		options: RelevantPageOptions = {},
	): Promise<WikiPage[]> {
		const pages = await this.loadAllWikiPages();
		const limit =
			typeof options.limit === "number" && options.limit > 0
				? Math.floor(options.limit)
				: DEFAULT_RELEVANT_PAGE_LIMIT;
		return bm25Rank(pages, keywords, { limit });
	}

	async loadAllWikiPages(): Promise<WikiPage[]> {
		const paths = await this.listWikiPages();
		return Promise.all(paths.map((p) => this.readWikiPage(p)));
	}

	async getPendingStubs(): Promise<PendingStub[]> {
		try {
			const content = await this.readFile(this.pendingStubsPath);
			return JSON.parse(content);
		} catch {
			return [];
		}
	}

	async removePendingStubs(filledPaths: Set<string>): Promise<void> {
		if (filledPaths.size === 0) return;
		const stubs = await this.getPendingStubs();
		const remaining = stubs.filter((s) => !filledPaths.has(s.path));
		if (remaining.length === 0) {
			await this.deleteFile(this.pendingStubsPath).catch(() => {
				/* bereits weg */
			});
		} else {
			await this.writeFile(this.pendingStubsPath, JSON.stringify(remaining, null, 2));
		}
	}

	async addPendingStubs(newStubs: PendingStub[]): Promise<void> {
		if (newStubs.length === 0) return;
		const existing = await this.getPendingStubs();
		const byPath = new Map(existing.map((s) => [s.path, s]));
		for (const stub of newStubs) {
			const prev = byPath.get(stub.path);
			if (prev) {
				const refs = new Set([...prev.referencedBy, ...stub.referencedBy]);
				prev.referencedBy = [...refs].sort();
			} else {
				byPath.set(stub.path, {
					...stub,
					referencedBy: [...new Set(stub.referencedBy)].sort(),
				});
			}
		}
		const merged = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
		await this.writeFile(this.pendingStubsPath, JSON.stringify(merged, null, 2));
	}

	async getSourceDate(filename: string): Promise<string> {
		const sourcePath = `${this.rawDir}/${filename}`;

		try {
			const content = await this.readFile(sourcePath);
			const fm = parseFrontmatter(content);
			if (fm.date && typeof fm.date === "string") {
				return fm.date;
			}
		} catch {
			/* Datei nicht lesbar oder nicht textuell */
		}

		const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
		if (dateMatch) return dateMatch[1];

		try {
			const stats = await this.app.vault.adapter.stat(sourcePath);
			if (stats && stats.mtime) {
				return new Date(stats.mtime).toISOString().split("T")[0];
			}
		} catch {
			/* ignore */
		}
		return new Date().toISOString().split("T")[0];
	}
}

export interface FrontmatterBlock {
	data: Record<string, unknown>;
	body: string;
	hasFrontmatter: boolean;
}

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?/;

export function parseFrontmatterBlock(content: string): FrontmatterBlock {
	const match = content.match(FRONTMATTER_REGEX);
	if (!match) {
		return { data: {}, body: content, hasFrontmatter: false };
	}

	const data: Record<string, unknown> = {};
	const lines = match[1].split("\n");
	for (const line of lines) {
		const colonIndex = line.indexOf(":");
		if (colonIndex === -1) continue;
		const key = line.substring(0, colonIndex).trim();
		if (!key) continue;
		const raw = line.substring(colonIndex + 1).trim();
		data[key] = parseFrontmatterValue(raw);
	}

	const body = content.slice(match[0].length);
	return { data, body, hasFrontmatter: true };
}

function parseFrontmatterValue(raw: string): unknown {
	if (raw === "" || raw === "~" || raw === "null") return null;
	if (raw.startsWith("[[") && raw.endsWith("]]")) return raw;
	if (raw.startsWith("[") && raw.endsWith("]")) {
		const inner = raw.slice(1, -1).trim();
		if (inner === "") return [];
		return inner.split(",").map((s) => s.trim());
	}
	if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
		return raw.slice(1, -1);
	}
	if (raw === "true") return true;
	if (raw === "false") return false;
	return raw;
}

export function serializeFrontmatter(data: Record<string, unknown>): string {
	const lines: string[] = ["---"];
	for (const [key, value] of Object.entries(data)) {
		if (value === undefined) continue;
		if (value === null) {
			lines.push(`${key}:`);
		} else if (Array.isArray(value)) {
			lines.push(`${key}: [${value.join(", ")}]`);
		} else if (typeof value === "boolean") {
			lines.push(`${key}: ${value}`);
		} else {
			lines.push(`${key}: ${value}`);
		}
	}
	lines.push("---");
	return lines.join("\n") + "\n";
}

export function updateFrontmatter(
	content: string,
	updater: (data: Record<string, unknown>) => void,
): string | null {
	const { data, body, hasFrontmatter } = parseFrontmatterBlock(content);
	if (!hasFrontmatter) return null;
	updater(data);
	return serializeFrontmatter(data) + body;
}

function parseFrontmatter(content: string): Record<string, unknown> {
	return parseFrontmatterBlock(content).data;
}

function buildWikiPage(relativePath: string, content: string): WikiPage {
	return {
		path: relativePath,
		relativePath,
		content,
		contentLower: content.toLowerCase(),
		frontmatter: parseFrontmatter(content),
	};
}

export const WIKI_CATEGORIES = [
	"sources",
	"entities",
	"concepts",
	"syntheses",
	"sops",
	"decisions",
] as const;
export type WikiCategory = (typeof WIKI_CATEGORIES)[number];

export const WIKI_SUB_INDEXES: Record<WikiCategory, string> = {
	sources: "# Quellen\n\nZusammenfassungen der Rohdaten.\n",
	entities: "# Entitaeten\n\nPersonen, Organisationen, Produkte und Tools.\n",
	concepts: "# Konzepte\n\nIdeen, Frameworks, Theorien und Patterns.\n",
	syntheses: "# Synthesen\n\nVergleiche, Analysen und Querverbindungen.\n",
	sops: "# SOPs\n\nStandard Operating Procedures — wiederholbare Ablaeufe und Anleitungen.\n",
	decisions:
		"# Entscheidungen\n\nErgebnisse, Beschluesse, Bewertungen — was wurde festgelegt und warum.\n",
};

export async function generateWikilinkMap(
	app: App,
	wikiDir: string,
): Promise<void> {
	const wikiPrefix = `${wikiDir}/`;
	const files = app.vault
		.getMarkdownFiles()
		.filter((f) => f.path.startsWith(wikiPrefix))
		.map((f) => f.path.slice(wikiPrefix.length));

	const map: Record<string, string> = {};

	for (const [dir, content] of Object.entries(WIKI_SUB_INDEXES)) {
		const hasPages = files.some(
			(f) => f.startsWith(`${dir}/`) && f !== `${dir}/index.md`,
		);
		if (!hasPages) continue;
		const indexRel = `${wikiDir}/${dir}/index.md`;
		if (!(await app.vault.adapter.exists(indexRel))) {
			await app.vault.adapter.mkdir(`${wikiDir}/${dir}`);
			await app.vault.adapter.write(indexRel, content);
		}
	}

	for (const file of files) {
		const name = baseName(file);
		if (isSystemPage(name)) continue;
		const slug = slugify(name);
		const route = "/" + file.replace(/\.md$/, "");
		map[slug] = route;
	}

	await app.vault.adapter.write(
		`${wikiDir}/.wikilinks.json`,
		JSON.stringify(map, null, 2),
	);
}

function baseName(file: string): string {
	const last = file.split("/").pop() || file;
	return last.replace(/\.md$/i, "");
}

function collectIndexAliases(indexContent: string): Set<string> {
	const aliases = new Set<string>();
	for (const link of extractWikilinks(indexContent)) {
		for (const alias of linkTargetAliases(link.target)) aliases.add(alias);
	}
	return aliases;
}

function indexHasPage(
	indexAliases: Set<string>,
	pageId: string,
	pageName: string,
): boolean {
	return pageAliases(pageId, pageName).some((a) => indexAliases.has(a));
}

export async function updateIndexes(app: App, wikiDir: string): Promise<number> {
	const wikiPrefix = `${wikiDir}/`;
	const files = app.vault
		.getMarkdownFiles()
		.filter((f) => f.path.startsWith(wikiPrefix))
		.map((f) => f.path.slice(wikiPrefix.length));

	let addedCount = 0;

	const pagesByDir = new Map<string, Array<{ id: string; name: string }>>();
	const allPages: Array<{ id: string; name: string }> = [];

	for (const file of files) {
		const name = baseName(file);
		if (isSystemPage(name)) continue;
		const idx = file.lastIndexOf("/");
		if (idx < 0) continue;
		const dir = file.slice(0, idx);
		const id = file.replace(/\.md$/, "");
		const list = pagesByDir.get(dir) || [];
		list.push({ id, name });
		pagesByDir.set(dir, list);
		allPages.push({ id, name });
	}

	for (const [dir, pages] of pagesByDir) {
		const indexPath = `${wikiDir}/${dir}/index.md`;
		let indexContent: string;
		try {
			indexContent = await app.vault.adapter.read(indexPath);
		} catch {
			continue;
		}

		const indexAliases = collectIndexAliases(indexContent);
		const missing = pages.filter((p) => !indexHasPage(indexAliases, p.id, p.name));

		if (missing.length > 0) {
			const entries = missing
				.sort((a, b) => a.name.localeCompare(b.name))
				.map((p) => `- [[${p.name.replace(/-/g, " ")}]]`)
				.join("\n");
			indexContent = indexContent.trimEnd() + "\n" + entries + "\n";
			await app.vault.adapter.write(indexPath, indexContent);
			addedCount += missing.length;
		}
	}

	const mainIndexPath = `${wikiDir}/index.md`;
	try {
		let mainIndex = await app.vault.adapter.read(mainIndexPath);
		const mainIndexAliases = collectIndexAliases(mainIndex);
		const missingFromMain = allPages.filter(
			(e) => !indexHasPage(mainIndexAliases, e.id, e.name),
		);

		if (missingFromMain.length > 0) {
			const grouped = new Map<string, string[]>();
			for (const entry of missingFromMain) {
				const dir = entry.id.includes("/") ? entry.id.split("/")[0] : "other";
				const list = grouped.get(dir) || [];
				list.push(entry.name);
				grouped.set(dir, list);
			}

			let section = "";
			for (const [dir, names] of grouped) {
				section += `\n## ${dir}\n`;
				for (const n of names.sort()) {
					section += `- [[${n.replace(/-/g, " ")}]]\n`;
				}
			}
			mainIndex = mainIndex.trimEnd() + "\n" + section;
			await app.vault.adapter.write(mainIndexPath, mainIndex);
			addedCount += missingFromMain.length;
		}
	} catch {
		/* kein Hauptindex */
	}

	return addedCount;
}

export function rankPagesByKeywords(
	pages: WikiPage[],
	keywords: string[],
	limit?: number,
): WikiPage[] {
	return bm25Rank(pages, keywords, {
		limit: typeof limit === "number" && limit > 0 ? Math.floor(limit) : DEFAULT_RELEVANT_PAGE_LIMIT,
	});
}

export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[äöüß]/g, (c) => (c === "ä" ? "ae" : c === "ö" ? "oe" : c === "ü" ? "ue" : "ss"))
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

export function today(): string {
	return new Date().toISOString().split("T")[0];
}

export function nowISO(): string {
	return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
