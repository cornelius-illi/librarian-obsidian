import { Notice, TFile, normalizePath } from "obsidian";
import type LibrarianPlugin from "../../main";
import { askForJson, type ImageBlock } from "../core/claude";
import { estimateCost } from "../core/progress";
import { extractKeywords } from "../core/keywords";
import { loadSystemPrompt } from "../core/prompts";
import { requireRootPrefix, toScopedRelativePath } from "../core/pathSafety";
import {
	generateWikilinkMap,
	isSystemPage,
	LibrarianVault,
	rankPagesByKeywords,
	slugify,
	today,
	toPageId,
	updateIndexes,
	type PendingStub,
	type WikiPage,
} from "../core/vault";
import { extractWikilinks, linkTargetAliases, pageAliases } from "../core/wikilinks";
import { buildWikiContext } from "../core/wiki-context";
import { IngestConfirmModal } from "../ui/IngestModal";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".csv", ".json", ".log", ".html"]);

class StageNotice {
	private notice: Notice | null = null;
	constructor(private readonly plugin: LibrarianPlugin, initial: string) {
		this.update(initial);
	}
	update(message: string): void {
		if (this.plugin.isProgressViewOpen()) {
			if (this.notice) {
				this.notice.hide();
				this.notice = null;
			}
			return;
		}
		if (this.notice) this.notice.setMessage(message);
		else this.notice = new Notice(message, 0);
	}
	hideSoon(delayMs: number): void {
		if (!this.notice) return;
		const n = this.notice;
		this.notice = null;
		setTimeout(() => n.hide(), delayMs);
	}
}

interface IngestResult {
	sourceFile?: string;
	takeaways: string[];
	operations: Array<{
		action: "create" | "update";
		path: string;
		content: string;
	}>;
	summary: {
		created: string[];
		updated: string[];
		contradictions: string[];
		superseded: Array<{ old: string; new: string }>;
	};
}

function extOf(filename: string): string {
	const idx = filename.lastIndexOf(".");
	return idx >= 0 ? filename.slice(idx).toLowerCase() : "";
}

function imageMediaType(filename: string): ImageBlock["mediaType"] {
	const ext = extOf(filename);
	switch (ext) {
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".png":
			return "image/png";
		case ".gif":
			return "image/gif";
		case ".webp":
			return "image/webp";
		default:
			return "image/png";
	}
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}
	return btoa(binary);
}

export async function runIngestCommand(plugin: LibrarianPlugin): Promise<void> {
	const { app, settings } = plugin;
	const vault = new LibrarianVault(app, settings.rawDir, settings.wikiDir);

	const allRaw = await vault.listRawFiles();
	if (allRaw.length === 0) {
		new Notice(`Librarian: ${settings.rawDir}/ ist leer.`);
		return;
	}

	const ingested = await vault.getIngestedSources();
	let toProcess = allRaw.filter((f) => !ingested.has(f));

	if (toProcess.length === 0) {
		new Notice("Librarian: Alle Quellen bereits verarbeitet.");
		return;
	}

	toProcess = toProcess.filter((f) => {
		const ext = extOf(f);
		return TEXT_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext);
	});

	if (toProcess.length === 0) {
		new Notice(
			"Librarian: Keine ingestierbaren Dateien gefunden. PDF/DOCX bitte vorher zu Markdown konvertieren.",
		);
		return;
	}

	const confirmed = await IngestConfirmModal.choose(app, toProcess);
	if (confirmed.length === 0) return;

	const systemPrompt = await loadSystemPrompt(app, "ingest");
	const client = { apiKey: settings.apiKey, defaultModel: settings.modelIngest };

	const pendingStubs = await vault.getPendingStubs();

	const pageCacheByRelative = new Map<string, WikiPage>();
	for (const p of await vault.loadAllWikiPages()) {
		pageCacheByRelative.set(p.relativePath, p);
	}

	const knownPageIds = new Set<string>(
		[...pageCacheByRelative.keys()]
			.map(toPageId)
			.filter((id) => !isSystemPage(id.split("/").pop() || "")),
	);

	let processed = 0;
	let errors = 0;
	let cancelled = 0;
	const allFilledStubPaths = new Set<string>();

	const signal = plugin.progress.startRun("ingest", "Ingest", confirmed);
	await plugin.activateProgressView();

	for (let fileIndex = 0; fileIndex < confirmed.length; fileIndex++) {
		const file = confirmed[fileIndex];

		if (plugin.progress.current?.cancelRequested) {
			plugin.progress.updateFile(fileIndex, {
				status: "cancelled",
				message: "Vor Start abgebrochen",
			});
			cancelled++;
			continue;
		}

		plugin.progress.setCurrentIndex(fileIndex);
		plugin.progress.updateFile(fileIndex, { status: "running", message: "Analysiere …" });

		const stage = new StageNotice(plugin, `Librarian: Analysiere ${file} …`);
		try {
			const ext = extOf(file);
			let rawContent: string;
			let imageBlocks: ImageBlock[] | undefined;

			const rawRelative = `${settings.rawDir}/${file}`;

			if (IMAGE_EXTENSIONS.has(ext)) {
				const buffer = await vault.readBinary(rawRelative);
				imageBlocks = [
					{
						data: arrayBufferToBase64(buffer),
						mediaType: imageMediaType(file),
					},
				];
				rawContent = `[Bild: ${file}]`;
			} else {
				rawContent = await vault.readFile(rawRelative);
			}

			const sourceDate = await vault.getSourceDate(file);
			const keywords = extractKeywords(rawContent, 30);
			const relevantPages = rankPagesByKeywords(
				[...pageCacheByRelative.values()],
				keywords,
				settings.relevantPageLimit,
			);

			const existingContext = buildWikiContext(
				relevantPages,
				settings.maxContextChars,
				"Keine bestehenden Wiki-Seiten gefunden.",
			);

			let stubSection = "";
			if (pendingStubs.length > 0) {
				const stubLines = pendingStubs.map(
					(s) =>
						`- **${s.title}** (${s.category}/${s.slug}) — referenziert von: ${s.referencedBy.join(", ")}`,
				);
				stubSection = `\n\n## Fehlende Wiki-Seiten (Stubs)\n\nDiese Seiten werden im Wiki referenziert, haben aber noch keinen Inhalt. Wenn die Quelle relevante Informationen zu diesen Themen enthaelt, erstelle oder aktualisiere die entsprechenden Seiten.\n\n${stubLines.join("\n")}`;
			}

			const allowList = [...knownPageIds].sort();
			const truncated = allowList.length > settings.maxPageAllowList;
			const allowListText = truncated
				? allowList.slice(0, settings.maxPageAllowList).join(", ") +
				  `, ... (${allowList.length - settings.maxPageAllowList} weitere)`
				: allowList.join(", ") || "(noch keine Seiten vorhanden)";

			const prompt = `## Kontext

Heutiges Datum: ${today()}

## Verfuegbare Wiki-Seiten (Allow-List fuer Wikilinks)

Setze [[Wikilinks]] AUSSCHLIESSLICH auf Seiten aus dieser Liste oder auf Seiten die du selbst in \`operations\` erstellst. Alles andere bleibt Fettdruck.

${allowListText}

## Bestehende Wiki-Seiten (Inhaltsauszug)

${existingContext}${stubSection}

## Neue Quelle

Dateiname: ${file}
Quelldatum: ${sourceDate}

${rawContent}`;

			stage.update(`Librarian: KI analysiert ${file} …`);
			plugin.progress.updateFile(fileIndex, { message: "KI analysiert …" });

			const { result, response, attempts, lastDiag } = await askForJson<IngestResult>(client, {
				system: systemPrompt,
				prompt,
				images: imageBlocks,
				model: settings.modelIngest,
				maxTokens: 32768,
				signal,
				onRetry: (entry) => {
					const label = entry.status ? `HTTP ${entry.status}` : entry.reason;
					plugin.progress.updateFile(fileIndex, {
						attempts: entry.attempt + 1,
						message: `Retry ${entry.attempt} (${label}) in ${Math.round(entry.waitMs / 1000)}s …`,
					});
				},
			});

			if (!result) {
				errors++;
				const msg = `JSON-Parsing fehlgeschlagen nach ${attempts} Versuch(en)`;
				stage.update(`Librarian: ${file} — ${msg}`);
				plugin.progress.updateFile(fileIndex, {
					status: "error",
					attempts,
					error: msg,
					message: undefined,
				});
				await vault.appendLog(
					`\n## [${today()}] ingest-error | ${file}\n${msg}${lastDiag ? `\n${lastDiag}` : ""}\n`,
				);
				if (lastDiag) console.error(`[ingest] ${file}: ${lastDiag}`);
				stage.hideSoon(5000);
				continue;
			}

			stage.update(
				`Librarian: Schreibe Wiki-Seiten fuer ${file} (${response.usage.inputTokens.toLocaleString("de")} in / ${response.usage.outputTokens.toLocaleString("de")} out)`,
			);

			if (result.operations) {
				for (const op of result.operations) {
					try {
						const safePath = requireRootPrefix(op.path, settings.wikiDir);
						const basename = safePath.split("/").pop() || "";
						if (basename === "log.md" || basename === "index.md") {
							console.warn(`[ingest] ${file}: ignoriere Operation auf ${basename} (Plugin-gepflegt)`);
							continue;
						}
						await vault.writeFile(safePath, op.content);

						const wikiRelative = toPageId(safePath);
						knownPageIds.add(wikiRelative);
						if (pendingStubs.some((s) => s.path === wikiRelative)) {
							allFilledStubPaths.add(wikiRelative);
						}

						const relativeInWiki = safePath.replace(new RegExp(`^${settings.wikiDir}/`), "");
						pageCacheByRelative.set(safePath, await vault.readWikiPage(relativeInWiki));
					} catch (err) {
						console.error(`[ingest] Unsicherer Pfad in Operation:`, err);
					}
				}
			}

			const created = result.summary?.created?.length || 0;
			const updated = result.summary?.updated?.length || 0;
			const superseded = result.summary?.superseded?.length || 0;

			await vault.appendLog(
				`\n## [${today()}] ingest | ${file}\nVerarbeitet: ${file}\nErstellt: ${created} neue Seiten, aktualisiert: ${updated} bestehende Seiten, ${superseded} ersetzt.\n`,
			);

			processed++;
			stage.update(`Librarian: ${file} verarbeitet — ${created} erstellt, ${updated} aktualisiert`);
			plugin.progress.updateFile(fileIndex, {
				status: "ok",
				attempts,
				message: `${created} erstellt, ${updated} aktualisiert`,
				tokensIn: response.usage.inputTokens,
				tokensOut: response.usage.outputTokens,
				costUsd: estimateCost(settings.modelIngest, response.usage),
			});
			stage.hideSoon(4000);
		} catch (err) {
			const isAbort =
				err instanceof DOMException && err.name === "AbortError" ||
				(err instanceof Error && err.name === "APIUserAbortError");
			if (isAbort) {
				cancelled++;
				plugin.progress.updateFile(fileIndex, {
					status: "cancelled",
					message: "Abgebrochen",
				});
				stage.update(`Librarian: ${file} abgebrochen`);
				stage.hideSoon(3000);
			} else {
				errors++;
				const msg = err instanceof Error ? err.message : String(err);
				plugin.progress.updateFile(fileIndex, {
					status: "error",
					error: msg,
					message: undefined,
				});
				await vault.appendLog(`\n## [${today()}] ingest-error | ${file}\n${msg}\n`);
				stage.update(`Librarian: Fehler bei ${file}: ${msg}`);
				stage.hideSoon(6000);
				console.error(`[ingest] ${file}`, err);
			}
		}
	}

	plugin.progress.finishRun();

	if (pendingStubs.length > 0) {
		const allStubPaths = new Set(pendingStubs.map((s) => s.path));
		await vault.removePendingStubs(allStubPaths);
	}

	// Broken-link-analysis: track newly-unresolved targets as pending stubs.
	const loadedWikiPages = [...pageCacheByRelative.values()].map((p) => {
		const id = toPageId(p.relativePath);
		const name = id.split("/").pop() || id;
		return { id, name, content: p.content };
	});

	const aliasToId = new Map<string, string>();
	for (const entry of loadedWikiPages) {
		if (isSystemPage(entry.name)) continue;
		for (const alias of pageAliases(entry.id, entry.name)) {
			aliasToId.set(alias, entry.id);
		}
	}

	const newStubs = new Map<string, PendingStub>();
	for (const entry of loadedWikiPages) {
		const links = extractWikilinks(entry.content);
		for (const link of links) {
			const aliases = linkTargetAliases(link.target);
			let found = false;
			for (const alias of aliases) {
				if (aliasToId.has(alias)) {
					found = true;
					break;
				}
			}
			if (found) continue;

			const slug = slugify(link.target);
			if (!slug) continue;
			const stubPath = `concepts/${slug}`;
			const prev = newStubs.get(stubPath);
			if (prev) {
				if (!prev.referencedBy.includes(entry.id)) prev.referencedBy.push(entry.id);
			} else {
				newStubs.set(stubPath, {
					slug,
					title: link.target,
					category: "concepts",
					path: stubPath,
					referencedBy: [entry.id],
				});
			}
		}
	}

	if (newStubs.size > 0) {
		await vault.addPendingStubs([...newStubs.values()]);
	}

	await generateWikilinkMap(app, settings.wikiDir);
	await updateIndexes(app, settings.wikiDir);

	const parts = [`${processed} erfolgreich`];
	if (errors > 0) parts.push(`${errors} Fehler`);
	if (cancelled > 0) parts.push(`${cancelled} abgebrochen`);
	new Notice(
		`Librarian: Ingest abgeschlossen — ${parts.join(", ")}. ${newStubs.size} neue Stubs.`,
		8000,
	);
}
