import { spawn } from "child_process";
import * as vscode from "vscode";
import { FILE_FINDER_SYSTEM, FILE_FINDER_USER } from "./prompts";
import { getProviderPreset } from "./providerPresets";

export interface CliRunnerOptions {
  command: string;
  argsTemplate: string;
  cwd: string;
}

export class CliRunner {
  // Przechowujemy kontekst rozszerzenia, by mieć dostęp do globalState
  private static context: vscode.ExtensionContext;

  public static initialize(context: vscode.ExtensionContext) {
    this.context = context;
  }

  static async runFileFinder(prompt: string): Promise<string[]> {
    const config = vscode.workspace.getConfiguration("hybrid-coder");
    const provider = config.get<string>("provider", "qwen");
    const extensions = config.get<string[]>("fileExtensions", []);

    let command: string;
    let argsTemplate: string;

    if (provider === "custom") {
      // Pobieramy konfigurację z globalState zamiast z ustawień w GUI
      command = this.context?.globalState.get<string>("customCliCommand") || "qwen";
      argsTemplate = this.context?.globalState.get<string>("customCliArgs") || "-p \"{prompt}\"";
    } else {
      const preset = getProviderPreset(provider);
      command = preset.command;
      argsTemplate = preset.argsTemplate;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error("No workspace folder open");
    }
    const cwd = workspaceFolder.uri.fsPath;

    const userPrompt = FILE_FINDER_USER
      .replace("{workspace}", cwd)
      .replace("{extensions}", extensions.join(", "))
      .replace("{prompt}", prompt);

    const fullPrompt = `${FILE_FINDER_SYSTEM}\n\n${userPrompt}`;
    const args = this.buildArgs(argsTemplate, fullPrompt);

    const output = await this.spawn(command, args, cwd);
    return this.parseFilePaths(output);
  }

  private static buildArgs(template: string, prompt: string): string[] {
    const args: string[] = [];
    // dzielimy template, ale zachowujemy {prompt} jako osobny token
    const parts = template.split(/(\{prompt\})/g);

    for (let part of parts) {
      if (part === "{prompt}") {
        args.push(prompt);
        continue;
      }

      part = part.trim();
      if (!part) continue;

      // tokenizacja template respektująca cudzysłowy, np. -p "{prompt}" --flag="value"
      const tokens = part.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
      for (let token of tokens) {
        // usuń otaczające cudzysłowy z template
        if (token.startsWith('"') && token.endsWith('"')) {
          token = token.slice(1, -1);
        }
        if (token) args.push(token);
      }
    }

    // jeśli template nie zawierał {prompt}, dodaj na końcu
    if (!template.includes("{prompt}")) {
      args.push(prompt);
    }

    return args;
  }

  private static spawn(command: string, args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";

      const child = spawn(command, args, {
        cwd,
        shell: false, // kluczowe, nie interpretujemy przez shell
        env: { ...process.env },
        windowsHide: true,
      });

      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`${command} timed out after 300s`));
      }, 300000);

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });
      
      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to start ${command}: ${err.message}. Check hybrid-coder.cliCommand setting.`));
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0 && !stdout) {
          reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
          return;
        }
        resolve(stdout);
      });
    });
  }

  private static parseFilePaths(output: string): string[] {
    const lines = output
      .replace(/```[\s\S]*?```/g, (match) => match.replace(/```\w*\n?/g, "").replace(/```/g, ""))
      .split(/\r?\n/)
      .map((line) => line.replace(/^[\s\-\*\d\.\)]+/, "").trim())
      .filter((line) => line.length > 0);

    const paths: string[] = [];
    const seen = new Set<string>();

    for (const line of lines) {
      const cleaned = line.replace(/^["'`]+|["'`]+$/g, "").trim();
      if (!cleaned) continue;
      if (seen.has(cleaned)) continue;
      if (!/^[/\\a-zA-Z0-9._\-~]/.test(cleaned)) continue;
      if (!/\.[a-zA-Z0-9]+$/.test(cleaned)) continue;
      seen.add(cleaned);
      paths.push(cleaned);
    }

    return paths;
  }
}