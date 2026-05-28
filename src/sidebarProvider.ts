import * as vscode from "vscode";
import * as fs from "fs";
import { CliRunner } from "./cliRunner";
import { ContextBuilder, ContextFile } from "./contextBuilder";
import { APPLY_CHANGES_SYSTEM, APPLY_CHANGES_USER } from "./prompts";

export class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private files: ContextFile[] = [];
  private currentPrompt = "";
  private currentContextMarkdown = "";

  constructor(
    private readonly extensionUri: vscode.Uri,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      await this.handleMessage(message);
    });
  }

  private async handleMessage(message: any): Promise<void> {
    switch (message.type) {
      case "findFiles":
        await this.handleFindFiles(message.prompt);
        break;
      case "toggleFile":
        this.handleToggleFile(message.index);
        break;
      case "addFile":
        await this.handleAddFile();
        break;
      case "removeFile":
        this.handleRemoveFile(message.index);
        break;
      case "selectAll":
        this.handleSelectAll(message.value);
        break;
      case "copyContext":
        await this.handleCopyContext(message.prompt, message.files);
        break;
      case "applyChanges":
        await this.handleApplyChanges(message.webchatResponse, message.prompt, message.files);
        break;
      case "openFile":
        this.handleOpenFile(message.index);
        break;
      case "openSettings":
        vscode.commands.executeCommand("hybrid-coder.openSettings");
        break;
      case "restoreState":
        if (this.files.length === 0) {
          await this.restoreFiles(message.files);
          this.postMessage({ type: "files", files: this.serializeFiles() });
        }
        break;
    }
  }

  private async handleFindFiles(prompt: string): Promise<void> {
    if (!prompt.trim()) {
      vscode.window.showWarningMessage("Enter a prompt first");
      return;
    }

    if (!vscode.workspace.workspaceFolders?.length) {
      vscode.window.showErrorMessage("Open a workspace folder first");
      return;
    }

    this.currentPrompt = prompt;
    this.postMessage({ type: "status", text: "Asking agent to find relevant files..." });

    try {
      const paths = await CliRunner.runFileFinder(prompt);

      if (paths.length === 0) {
        this.postMessage({ type: "status", text: "No files found. Try refining your prompt." });
        return;
      }

      this.files = await ContextBuilder.buildFromPaths(paths);
      this.postMessage({ type: "files", files: this.serializeFiles() });
      this.postMessage({ type: "status", text: `Found ${this.files.length} files` });
    } catch (err: any) {
      const msg = err?.message || String(err);
      this.postMessage({ type: "status", text: `Error: ${msg}` });
      vscode.window.showErrorMessage(`CLI error: ${msg}`);
    }
  }

  private handleToggleFile(index: number): void {
    if (this.files[index]) {
      this.files[index].selected = !this.files[index].selected;
      this.postMessage({ type: "files", files: this.serializeFiles() });
    }
  }

  private async handleAddFile(): Promise<void> {
    const file = await ContextBuilder.addManualFile();
    if (file) {
      this.files.push(file);
      this.postMessage({ type: "files", files: this.serializeFiles() });
    }
  }

  private handleRemoveFile(index: number): void {
    this.files.splice(index, 1);
    this.postMessage({ type: "files", files: this.serializeFiles() });
  }

  private handleSelectAll(value: boolean): void {
    for (const file of this.files) {
      if (file.exists) file.selected = value;
    }
    this.postMessage({ type: "files", files: this.serializeFiles() });
  }

  private async handleCopyContext(prompt: string, incomingFiles?: any[]): Promise<void> {
    if (this.files.length === 0 && incomingFiles && incomingFiles.length > 0) {
      await this.restoreFiles(incomingFiles);
    }
    this.currentPrompt = prompt || this.currentPrompt;
    this.currentContextMarkdown = ContextBuilder.generateMarkdown(this.files, this.currentPrompt);
    await vscode.env.clipboard.writeText(this.currentContextMarkdown);
    vscode.window.showInformationMessage("Context copied to clipboard");
    this.postMessage({ type: "contextReady", markdown: this.currentContextMarkdown });
  }

  private async handleApplyChanges(webchatResponse: string, prompt: string, incomingFiles?: any[]): Promise<void> {
    if (!webchatResponse.trim()) {
      vscode.window.showWarningMessage("Paste the web chat response first");
      return;
    }

    if (this.files.length === 0 && incomingFiles && incomingFiles.length > 0) {
      await this.restoreFiles(incomingFiles);
    }
    this.currentPrompt = prompt || this.currentPrompt;

    const userMessage = APPLY_CHANGES_USER
      .replace("{webchatResponse}", webchatResponse)
      .replace("{problem}", this.currentPrompt);

    const combinedPrompt = `${APPLY_CHANGES_SYSTEM}\n\n${userMessage}`;
    await vscode.env.clipboard.writeText(combinedPrompt);
    vscode.window.showInformationMessage("Response copied to clipboard");
    this.postMessage({ type: "status", text: "Copied to clipboard — paste into your interactive agent." });
  }

  private handleOpenFile(index: number): void {
    const file = this.files[index];
    if (file?.exists) {
      vscode.window.showTextDocument(vscode.Uri.file(file.absolutePath), { preview: true });
    }
  }

  private serializeFiles() {
    return this.files.map((f) => ({
      relativePath: f.relativePath,
      selected: f.selected,
      exists: f.exists,
      tooLarge: f.tooLarge,
      size: f.size,
      language: f.language,
    }));
  }

  private async restoreFiles(serialized: any[]): Promise<ContextFile[]> {
    const built = await ContextBuilder.buildFromPaths(serialized.map((f: any) => f.relativePath));
    for (let i = 0; i < built.length; i++) {
      if (serialized[i] && typeof serialized[i].selected === "boolean") {
        built[i].selected = serialized[i].selected;
      }
    }
    this.files = built;
    return built;
  }

  private postMessage(message: any): void {
    this.view?.webview.postMessage(message);
  }

  // =========================================================================
  // TU ZMIENIŁ SIĘ SPOSÓB ŁADOWANIA HTML - POBIERAMY Z PLIKU I PODMIENIAMY
  // =========================================================================
  private getHtml(webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "sidebar.css"));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "sidebar.js"));
    const htmlPath = vscode.Uri.joinPath(this.extensionUri, "media", "sidebar.html").fsPath;
    const nonce = this.getNonce();

    // Wczytaj czysty plik HTML jako string
    let html = fs.readFileSync(htmlPath, "utf-8");

    // Podmień zmienne używając wyrażeń regularnych z flagą /g (zastępuje wszystkie wystąpienia)
    html = html
      .replace(/{{cspSource}}/g, webview.cspSource)
      .replace(/{{nonce}}/g, nonce)
      .replace(/{{cssUri}}/g, cssUri.toString())
      .replace(/{{jsUri}}/g, jsUri.toString());

    return html;
  }

  private getNonce(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";
    for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
  }
}