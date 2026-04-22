import { Notice } from "obsidian";
import type LibrarianPlugin from "../../main";
import { askForJson } from "../core/claude";
import { loadSystemPrompt } from "../core/prompts";
import { requireRootPrefix } from "../core/pathSafety";
import {
	generateWikilinkMap,
	LibrarianVault,
	today,
} from "../core/vault";
import { ForgetSelectModal } from "../ui/ForgetModal";

interface ForgetResult {
	operations: Array<{
		action: "update" | "delete";
		path: string;
		content?: string;
		reason: string;
	}>;
	delete_source_page: string | null;
	summary: string;
}

export async function runForgetCommand(plugin: LibrarianPlugin): Promise<void> {
	const { app, settings } = plugin;
	const vault = new LibrarianVault(app, settings.rawDir, settings.wikiDir);

	const allRaw = await vault.listRawFiles();
	if (allRaw.length === 0) {
		new Notice(`Librarian: ${settings.rawDir}/ ist leer.`);
		return;
	}

	const filename = await ForgetSelectModal.choose(app, allRaw);
	if (!filename) return;

	const rawPath = `${settings.rawDir}/${filename}`;
	const rawExists = await vault.fileExists(rawPath);
	if (!rawExists) {
		new Notice(`Librarian: ${rawPath} nicht gefunden.`);
		return;
	}

	new Notice(`Librarian: Analysiere betroffene Seiten fuer ${filename} …`);

	const allPages = await vault.listWikiPages();
	const pages = await Promise.all(allPages.map((p) => vault.readWikiPage(p)));
	const affectedPages = pages
		.filter((page) => page.content.includes(filename))
		.map((page) => ({ path: page.relativePath, content: page.content }));

	if (affectedPages.length === 0) {
		new Notice("Librarian: Keine Wiki-Seiten referenzieren diese Quelle. Log wird aktualisiert.");
		await vault.forgetSource(filename);
		await vault.appendLog(`\n## [${today()}] forget | ${filename}\nKeine Wiki-Referenzen gefunden — Quelle nur aus Log entfernt.\n`);
		return;
	}

	const pagesContext = affectedPages
		.map((page) => `--- ${page.path} ---\n${page.content}`)
		.join("\n\n");

	const systemPrompt = await loadSystemPrompt(app, "forget");
	const client = { apiKey: settings.apiKey, defaultModel: settings.modelIngest };

	const prompt = `## Zu vergessende Quelle
Dateiname: ${filename}

## Betroffene Wiki-Seiten (${affectedPages.length})
${pagesContext}

Entferne alle Informationen die AUSSCHLIESSLICH aus "${filename}" stammen. Aktualisiere \`sources:\` und Lifecycle-Felder passend.`;

	new Notice(`Librarian: KI analysiert ${affectedPages.length} betroffene Seite(n)…`);

	const { result, attempts, lastDiag } = await askForJson<ForgetResult>(client, {
		system: systemPrompt,
		prompt,
		model: settings.modelIngest,
		maxTokens: 16384,
	});

	if (!result) {
		new Notice(
			`Librarian: JSON-Parsing fehlgeschlagen nach ${attempts} Versuch(en). ${lastDiag ? "Siehe Konsole." : ""}`,
			10000,
		);
		if (lastDiag) console.error(`[forget] ${filename}: ${lastDiag}`);
		return;
	}

	let updates = 0;
	let deletes = 0;

	for (const op of result.operations) {
		try {
			const safePath = requireRootPrefix(op.path, settings.wikiDir);
			if (op.action === "update" && typeof op.content === "string") {
				await vault.writeFile(safePath, op.content);
				updates++;
			} else if (op.action === "delete") {
				if (await vault.fileExists(safePath)) {
					await vault.deleteFile(safePath);
					deletes++;
				}
			}
		} catch (err) {
			console.error("[forget] Unsicherer Pfad in Operation:", err);
		}
	}

	if (result.delete_source_page) {
		try {
			const safeSourcePath = requireRootPrefix(result.delete_source_page, settings.wikiDir);
			if (await vault.fileExists(safeSourcePath)) {
				await vault.deleteFile(safeSourcePath);
				deletes++;
			}
		} catch (err) {
			console.error("[forget] Source-Seite konnte nicht geloescht werden:", err);
		}
	}

	// Entferne aus log so dass die Datei beim naechsten Ingest wieder auftauchen wuerde
	// (falls der Nutzer nur versehentlich forget gedrueckt hat).
	await vault.forgetSource(filename);

	await vault.appendLog(
		`\n## [${today()}] forget | ${filename}\n${result.summary}\nUpdates: ${updates}, Loeschungen: ${deletes}.\n`,
	);

	await generateWikilinkMap(app, settings.wikiDir);

	new Notice(
		`Librarian: ${filename} vergessen — ${updates} Seiten aktualisiert, ${deletes} geloescht.`,
		8000,
	);
}
