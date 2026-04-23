#!/usr/bin/env node
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultVault = resolve(__dirname, "../../../librarian-vault-test");

const vaultPath = process.argv[2] ? resolve(process.argv[2]) : defaultVault;
const sourcesDir = join(vaultPath, "wiki", "sources");
const logPath = join(vaultPath, "wiki", "log.md");

async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

function extractFrontmatter(content) {
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	return match ? match[1] : null;
}

function parseSourcesField(fm) {
	const flow = fm.match(/^sources:\s*\[([^\]]*)\]\s*$/m);
	if (flow) {
		return flow[1]
			.split(",")
			.map((s) => s.trim().replace(/^["']|["']$/g, ""))
			.filter(Boolean);
	}
	const block = fm.match(/^sources:\s*\n((?:\s+-\s+.+\n?)+)/m);
	if (block) {
		return block[1]
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.startsWith("-"))
			.map((l) => l.slice(1).trim().replace(/^["']|["']$/g, ""));
	}
	return [];
}

function today() {
	return new Date().toISOString().slice(0, 10);
}

function nowIso() {
	return new Date().toISOString();
}

async function main() {
	if (!(await exists(sourcesDir))) {
		console.error(`Fehler: ${sourcesDir} existiert nicht.`);
		process.exit(1);
	}

	const entries = await readdir(sourcesDir);
	const mdFiles = entries.filter((f) => f.endsWith(".md") && f !== "index.md");

	const fromFrontmatter = new Set();
	const skipped = [];

	for (const file of mdFiles) {
		const content = await readFile(join(sourcesDir, file), "utf8");
		const fm = extractFrontmatter(content);
		if (!fm) {
			skipped.push({ file, reason: "kein Frontmatter" });
			continue;
		}
		const sources = parseSourcesField(fm);
		if (sources.length === 0) {
			skipped.push({ file, reason: "kein sources:-Feld" });
			continue;
		}
		for (const src of sources) fromFrontmatter.add(src);
	}

	let logContent = "";
	if (await exists(logPath)) {
		logContent = await readFile(logPath, "utf8");
	} else {
		logContent = "# Wiki-Protokoll\n";
	}

	const alreadyLogged = new Set();
	for (const m of logContent.matchAll(/^Verarbeitet:\s*(.+)$/gm)) {
		alreadyLogged.add(m[1].trim());
	}

	const missing = [...fromFrontmatter].filter((s) => !alreadyLogged.has(s)).sort();

	if (missing.length === 0) {
		console.log(
			`Nichts zu tun: alle ${fromFrontmatter.size} Frontmatter-Quellen bereits geloggt.`,
		);
		if (skipped.length > 0) {
			console.log(`${skipped.length} Source-Seiten ohne nutzbares Frontmatter uebersprungen.`);
		}
		return;
	}

	const date = today();
	const ts = nowIso();
	const appended = missing
		.map(
			(src) =>
				`\n## [${date}] ingest-heal | ${src}\nVerarbeitet: ${src}\n(automatisch nachgetragen durch heal-log.mjs am ${ts})\n`,
		)
		.join("");

	await writeFile(logPath, logContent + appended, "utf8");

	console.log(
		`${missing.length} fehlende Log-Eintraege ergaenzt. ${alreadyLogged.size} bereits vorhanden.`,
	);
	if (skipped.length > 0) {
		console.log(`Uebersprungen (${skipped.length}):`);
		for (const s of skipped) console.log(`  - ${s.file}: ${s.reason}`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
