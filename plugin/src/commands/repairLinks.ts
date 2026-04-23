import { Notice } from "obsidian";
import type LibrarianPlugin from "../../main";
import { askForJson } from "../core/claude";
import { estimateCost } from "../core/progress";
import { loadSystemPrompt } from "../core/prompts";
import { requireRootPrefix } from "../core/pathSafety";
import {
	generateWikilinkMap,
	isSystemPage,
	LibrarianVault,
	slugify,
	today,
	toPageId,
	updateFrontmatter,
	updateIndexes,
	type WikiPage,
} from "../core/vault";
import { extractWikilinks, linkTargetAliases, pageAliases } from "../core/wikilinks";

interface LintFixAiResult {
	pages: Array<{ path: string; content: string }>;
	skipped: Array<{ target: string; reason: string }>;
}

interface LoadedPage {
	pagePath: string;
	id: string;
	name: string;
	page: WikiPage;
}

const MAX_ITERATIONS = 3;
const BATCH_SIZE = 15;
const MAX_CONTEXT_PER_BATCH = 60_000;
const MAX_REF_PAGES_PER_TARGET = 5;
const MAX_CONTEXT_SNIPPETS = 6;

export async function runRepairLinksCommand(plugin: LibrarianPlugin): Promise<void> {
	const { app, settings } = plugin;
	const vault = new LibrarianVault(app, settings.rawDir, settings.wikiDir);
	const client = { apiKey: settings.apiKey, defaultModel: settings.modelLint };

	const allPageFiles = await vault.listWikiPages();
	const loadedPages: LoadedPage[] = await Promise.all(
		allPageFiles.map(async (pagePath) => ({
			pagePath,
			id: toPageId(pagePath),
			name: baseName(pagePath),
			page: await vault.readWikiPage(pagePath),
		})),
	);

	new Notice(`Librarian: Pruefe ${loadedPages.length} Seite(n)...`);

	// Mechanical frontmatter fixes first (cheap, deterministic).
	let frontmatterFixes = 0;
	for (const entry of loadedPages) {
		if (isSystemPage(entry.name)) continue;
		const updated = updateFrontmatter(entry.page.content, (fm) => {
			if (fm.superseded_by && fm.status !== "stale") {
				fm.status = "stale";
			}
			if (Array.isArray(fm.sources) && fm.sources.length >= 2 && fm.status === "seed") {
				fm.status = "confirmed";
				if (fm.confidence === "low") fm.confidence = "medium";
			}
			if (!fm.status) fm.status = "seed";
			if (!fm.confidence) fm.confidence = "low";
			if (fm.reviewed === undefined) fm.reviewed = false;
		});

		if (updated && updated !== entry.page.content) {
			const fullRelative = entry.pagePath.startsWith(`${settings.wikiDir}/`)
				? entry.pagePath
				: `${settings.wikiDir}/${entry.pagePath}`;
			await vault.writeFile(fullRelative, updated);
			frontmatterFixes++;
			entry.page = await vault.readWikiPage(entry.pagePath);
		}
	}

	if (frontmatterFixes > 0) {
		new Notice(`Librarian: ${frontmatterFixes} Frontmatter-Korrektur(en) angewendet.`);
	}

	const systemPrompt = await loadSystemPrompt(app, "lint-fix");

	let totalCreated = 0;
	let totalSkipped = 0;
	let totalStillBroken = 0;
	let totalErrors = 0;
	let totalCancelled = 0;

	const signal = plugin.progress.startRun("repair", "Repair Broken Links", []);
	await plugin.activateProgressView();

	for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
		if (plugin.progress.current?.cancelRequested) break;
		const aliasToId = new Map<string, string>();
		for (const entry of loadedPages) {
			if (isSystemPage(entry.name)) continue;
			for (const alias of pageAliases(entry.id, entry.name)) {
				aliasToId.set(alias, entry.id);
			}
		}

		const missingTargets = new Map<
			string,
			{ target: string; slug: string; referencedBy: string[]; contexts: string[] }
		>();
		for (const entry of loadedPages) {
			const links = extractWikilinks(entry.page.content);
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
				const existing = missingTargets.get(slug);
				if (existing) {
					if (!existing.referencedBy.includes(entry.id))
						existing.referencedBy.push(entry.id);
				} else {
					missingTargets.set(slug, {
						target: link.target,
						slug,
						referencedBy: [entry.id],
						contexts: [],
					});
				}
			}
		}

		if (missingTargets.size === 0) {
			if (iter === 1) new Notice("Librarian: Keine Broken Links gefunden.");
			break;
		}

		totalStillBroken = missingTargets.size;

		new Notice(
			`Librarian: Iteration ${iter}/${MAX_ITERATIONS} — ${missingTargets.size} fehlende Seite(n) generieren`,
		);

		for (const [, info] of missingTargets) {
			const targetLower = info.target.toLowerCase();
			const exactLink = `[[${info.target}]]`;
			for (const pageId of info.referencedBy.slice(0, MAX_REF_PAGES_PER_TARGET)) {
				const entry = loadedPages.find((p) => p.id === pageId);
				if (!entry) continue;
				const paragraphs = entry.page.content.split(/\n\n+/);
				for (const p of paragraphs) {
					if (p.toLowerCase().includes(targetLower) || p.includes(exactLink)) {
						info.contexts.push(`[${pageId}]: ${p.slice(0, 600)}`);
						if (info.contexts.length >= MAX_CONTEXT_SNIPPETS) break;
					}
				}
				if (info.contexts.length >= MAX_CONTEXT_SNIPPETS) break;
			}
		}

		const existingPageList = loadedPages
			.filter((e) => !isSystemPage(e.name))
			.map((e) => e.id)
			.join(", ");

		const allTargets = [...missingTargets.values()];
		const batches: Array<typeof allTargets> = [];
		let currentBatch: typeof allTargets = [];
		let currentSize = 0;
		for (const target of allTargets) {
			const targetSize = target.contexts.join("\n").length + target.target.length + 200;
			if (
				currentBatch.length >= BATCH_SIZE ||
				(currentSize + targetSize > MAX_CONTEXT_PER_BATCH && currentBatch.length > 0)
			) {
				batches.push(currentBatch);
				currentBatch = [];
				currentSize = 0;
			}
			currentBatch.push(target);
			currentSize += targetSize;
		}
		if (currentBatch.length > 0) batches.push(currentBatch);

		let iterCreated = 0;
		let batchIndex = 0;

		const batchLabels = batches.map(
			(b, i) => `Iter ${iter} · Batch ${i + 1}/${batches.length} (${b.length} Seiten)`,
		);
		const firstBatchIdx = plugin.progress.appendFiles(batchLabels);

		for (const batch of batches) {
			const progressIdx = firstBatchIdx + batchIndex;
			batchIndex++;

			if (plugin.progress.current?.cancelRequested) {
				plugin.progress.updateFile(progressIdx, { status: "cancelled" });
				totalCancelled++;
				continue;
			}

			plugin.progress.setCurrentIndex(progressIdx);
			plugin.progress.updateFile(progressIdx, {
				status: "running",
				message: "KI generiert fehlende Seiten …",
			});

			if (!plugin.isProgressViewOpen()) {
				new Notice(
					`Librarian: Iter ${iter}, Batch ${batchIndex}/${batches.length} (${batch.length} Seiten)…`,
				);
			}

			const targetSections = batch
				.map((t) => {
					const contextBlock =
						t.contexts.length > 0
							? t.contexts.join("\n")
							: `Keine direkten Kontext-Schnipsel verfuegbar. Referenziert von: ${t.referencedBy.join(", ")}`;
					return `### ${t.target}\nDateiname MUSS sein: \`${t.slug}.md\` (z.B. \`${settings.wikiDir}/concepts/${t.slug}.md\` oder \`${settings.wikiDir}/entities/${t.slug}.md\`)\nReferenziert von: ${t.referencedBy.join(", ")}\nKontext:\n${contextBlock}`;
				})
				.join("\n\n---\n\n");

			const prompt = `## Konfiguration

Heutiges Datum: ${today()}

## Existierende Wiki-Seiten (fuer Wikilinks)

${existingPageList}

## Fehlende Seiten — bitte erstellen

${targetSections}`;

			let batchCreated = 0;
			try {
				const { result, response, attempts } = await askForJson<LintFixAiResult>(client, {
					system: systemPrompt,
					prompt,
					model: settings.modelLint,
					maxTokens: 16384,
					signal,
					onRetry: (entry) => {
						const label = entry.status ? `HTTP ${entry.status}` : entry.reason;
						plugin.progress.updateFile(progressIdx, {
							attempts: entry.attempt + 1,
							message: `Retry ${entry.attempt} (${label}) in ${Math.round(entry.waitMs / 1000)}s …`,
						});
					},
				});

				if (!result) {
					const msg = `JSON-Parsing fehlgeschlagen nach ${attempts} Versuch(en)`;
					console.error(`[repairLinks] ${msg}`);
					plugin.progress.updateFile(progressIdx, {
						status: "error",
						attempts,
						error: msg,
						message: undefined,
					});
					totalErrors++;
					continue;
				}

				if (result.pages) {
					const expectedSlugs = new Map<string, string>();
					for (const t of batch) {
						expectedSlugs.set(slugify(t.target), t.slug);
					}

					for (const page of result.pages) {
						try {
							let safePath = requireRootPrefix(page.path, settings.wikiDir);

							const actualFilename = baseName(safePath);
							const actualSlug = slugify(actualFilename);
							const dirPart = safePath.replace(/[^/]+\.md$/, "");

							let matchedExpected: string | undefined;
							for (const [, expected] of expectedSlugs) {
								if (actualSlug === expected || actualFilename === expected) {
									matchedExpected = expected;
									break;
								}
							}
							if (!matchedExpected) {
								for (const t of batch) {
									const titleLower = t.target.toLowerCase();
									if (page.content.toLowerCase().includes(titleLower)) {
										matchedExpected = t.slug;
										break;
									}
								}
							}
							if (matchedExpected && actualSlug !== matchedExpected) {
								safePath = `${dirPart}${matchedExpected}.md`;
								safePath = requireRootPrefix(safePath, settings.wikiDir);
							}

							await vault.writeFile(safePath, page.content);
							iterCreated++;
							totalCreated++;
							batchCreated++;

							const pageId = toPageId(safePath);
							if (!loadedPages.find((p) => p.id === pageId)) {
								const newRelative = safePath.replace(new RegExp(`^${settings.wikiDir}/`), "");
								loadedPages.push({
									pagePath: newRelative,
									id: pageId,
									name: baseName(newRelative),
									page: await vault.readWikiPage(newRelative),
								});
							}
						} catch (err) {
							console.error("[repairLinks] Unsicherer Pfad in Operation:", err);
						}
					}
				}

				if (result.skipped) totalSkipped += result.skipped.length;

				plugin.progress.updateFile(progressIdx, {
					status: "ok",
					attempts,
					message: `${batchCreated} erstellt${result.skipped ? `, ${result.skipped.length} uebersprungen` : ""}`,
					tokensIn: response.usage.inputTokens,
					tokensOut: response.usage.outputTokens,
					costUsd: estimateCost(settings.modelLint, response.usage),
				});
			} catch (err) {
				const isAbort =
					err instanceof DOMException && err.name === "AbortError" ||
					(err instanceof Error && err.name === "APIUserAbortError");
				if (isAbort) {
					totalCancelled++;
					plugin.progress.updateFile(progressIdx, {
						status: "cancelled",
						message: "Abgebrochen",
					});
				} else {
					totalErrors++;
					const msg = err instanceof Error ? err.message : String(err);
					plugin.progress.updateFile(progressIdx, {
						status: "error",
						error: msg,
						message: undefined,
					});
					console.error(`[repairLinks] Iter ${iter} Batch ${batchIndex}:`, err);
				}
			}
		}

		if (iterCreated === 0) {
			new Notice(`Librarian: Iteration ${iter} — keine Seiten erstellt, Abbruch.`);
			break;
		}
	}

	await generateWikilinkMap(app, settings.wikiDir);
	const addedToIndex = await updateIndexes(app, settings.wikiDir);

	if (totalCreated > 0 || frontmatterFixes > 0) {
		await vault.appendLog(
			`\n## [${today()}] lint-fix\nErstellt: ${totalCreated} Seiten, Frontmatter-Fixes: ${frontmatterFixes}, Index-Ergaenzungen: ${addedToIndex}, Uebersprungen: ${totalSkipped}.\n`,
		);
	}

	plugin.progress.finishRun();

	const parts = [`${totalCreated} erstellt`, `${totalSkipped} uebersprungen`];
	if (totalErrors > 0) parts.push(`${totalErrors} Fehler`);
	if (totalCancelled > 0) parts.push(`${totalCancelled} abgebrochen`);
	parts.push(`${frontmatterFixes} Frontmatter`, `${addedToIndex} Index-Eintraege`);
	new Notice(`Librarian: Reparatur abgeschlossen — ${parts.join(", ")}.`, 8000);

	if (totalStillBroken > 0 && totalCreated === 0) {
		new Notice(
			`Librarian: ${totalStillBroken} Broken Links bleiben — Claude konnte keine Seiten erstellen (zu wenig Kontext?).`,
			10000,
		);
	}
}

function baseName(filePath: string): string {
	const last = filePath.split("/").pop() || filePath;
	return last.replace(/\.md$/i, "");
}
