import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { CTX_HEADER, CTX_FILE_HEADER, CTX_FILE_TOO_LARGE, CTX_FILE_ERROR, CTX_OUTPUT_FORMAT } from "./prompts";

export interface ContextFile {
  absolutePath: string;
  relativePath: string;
  selected: boolean;
  exists: boolean;
  size: number;
  tooLarge: boolean;
  language: string;
}

export class ContextBuilder {
  static async buildFromPaths(rawPaths: string[]): Promise<ContextFile[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return [];

    const config = vscode.workspace.getConfiguration("hybrid-coder");
    const maxSizeKB = config.get<number>("maxFileSizeKB", 200);
    const ignorePatterns = config.get<string[]>("ignorePatterns", []);
    const root = workspaceFolder.uri.fsPath;

    const results: ContextFile[] = [];

    for (const rawPath of rawPaths) {
      const absolutePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(root, rawPath);
      const relativePath = path.relative(root, absolutePath).replace(/\\/g, "/");

      if (this.isIgnored(relativePath, ignorePatterns)) continue;

      let exists = false;
      let size = 0;
      try {
        const stat = fs.statSync(absolutePath);
        exists = stat.isFile();
        size = stat.size;
      } catch {
        exists = false;
      }

      results.push({
        absolutePath,
        relativePath,
        selected: exists,
        exists,
        size,
        tooLarge: size > maxSizeKB * 1024,
        language: this.detectLanguage(absolutePath),
      });
    }

    return results;
  }

  static async addManualFile(): Promise<ContextFile | null> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return null;

    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: "Add to context",
      defaultUri: workspaceFolder.uri,
    });
    if (!uris || uris.length === 0) return null;

    const absolutePath = uris[0].fsPath;
    const relativePath = path.relative(workspaceFolder.uri.fsPath, absolutePath).replace(/\\/g, "/");
    const config = vscode.workspace.getConfiguration("hybrid-coder");
    const maxSizeKB = config.get<number>("maxFileSizeKB", 200);

    let size = 0;
    try {
      size = fs.statSync(absolutePath).size;
    } catch {}

    return {
      absolutePath,
      relativePath,
      selected: true,
      exists: true,
      size,
      tooLarge: size > maxSizeKB * 1024,
      language: this.detectLanguage(absolutePath),
    };
  }

  static generateMarkdown(files: ContextFile[], problem: string, includeOutputFormat = true): string {
    const selected = files.filter((f) => f.selected && f.exists);
    const config = vscode.workspace.getConfiguration("hybrid-coder");
    const maxSizeKB = config.get<number>("maxFileSizeKB", 200);

    const parts: string[] = [];
    parts.push(CTX_HEADER.replace("{problem}", problem));
    parts.push("");

    for (const file of selected) {
      parts.push(CTX_FILE_HEADER.replace("{relativePath}", file.relativePath));

      if (file.tooLarge) {
        parts.push(CTX_FILE_TOO_LARGE
          .replace("{maxSizeKB}", String(maxSizeKB))
          .replace("{actualKB}", String(Math.round(file.size / 1024))));
        parts.push("");
        continue;
      }

      try {
        const content = fs.readFileSync(file.absolutePath, "utf-8");
        parts.push(`\`\`\`${file.language}`);
        parts.push(content);
        parts.push("```");
        parts.push("");
      } catch {
        parts.push(CTX_FILE_ERROR);
        parts.push("");
      }
    }

    if (includeOutputFormat) {
      parts.push(CTX_OUTPUT_FORMAT);
    }

    return parts.join("\n");
  }

  private static isIgnored(relativePath: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      const cleanPattern = pattern.replace(/^\*\*\//, "").replace(/\/\*\*$/, "");
      if (relativePath.includes(cleanPattern.replace(/\*/g, ""))) {
        const forbidden = ["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv", "venv", "target"];
        for (const f of forbidden) {
          if (relativePath.split("/").includes(f)) return true;
        }
      }
    }
    return false;
  }

  private static detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase().slice(1);
    const map: Record<string, string> = {
      ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
      py: "python", go: "go", rs: "rust", java: "java",
      c: "c", cpp: "cpp", h: "c", cs: "csharp",
      rb: "ruby", php: "php", swift: "swift", kt: "kotlin",
      vue: "vue", svelte: "svelte", html: "html", css: "css",
      scss: "scss", json: "json", yaml: "yaml", yml: "yaml",
      toml: "toml", md: "markdown", sh: "bash", sql: "sql",
    };
    return map[ext] || ext;
  }
}