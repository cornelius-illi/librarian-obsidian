import { App } from "obsidian";

const CLAUDE_MD_PATH = "CLAUDE.md";
const PROMPTS_DIR = ".claude/skills/librarian/prompts";

export type PromptName =
	| "ingest"
	| "query"
	| "lint"
	| "lint-fix"
	| "lint-suggest"
	| "forget"
	| "takeaway-discuss"
	| "takeaway-synthesize";

export async function loadSystemPrompt(app: App, name: PromptName): Promise<string> {
	const promptPath = `${PROMPTS_DIR}/${name}.md`;
	let schemaPart = "";
	try {
		schemaPart = await app.vault.adapter.read(CLAUDE_MD_PATH);
	} catch {
		throw new Error(
			"CLAUDE.md im Vault-Root nicht gefunden. Kopiere vault-template/CLAUDE.md in den Vault-Root.",
		);
	}

	let promptPart = "";
	try {
		promptPart = await app.vault.adapter.read(promptPath);
	} catch {
		throw new Error(
			`Prompt ${promptPath} nicht gefunden. Kopiere vault-template/.claude/skills/librarian/prompts/ in den Vault.`,
		);
	}

	return `${schemaPart}\n\n---\n\n${promptPart}`;
}
