import * as vscode from 'vscode';
import { SidebarProvider } from './sidebarProvider';
import { CliRunner } from './cliRunner';

export function activate(context: vscode.ExtensionContext) {
  CliRunner.initialize(context);

  const sidebarProvider = new SidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "hybrid-coder.sidebar",
      sidebarProvider
    )
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration("hybrid-coder.provider")) {
        const config = vscode.workspace.getConfiguration("hybrid-coder");
        if (config.get<string>("provider") === "custom") {
          await configureCustomProviderInteractive(context);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hybrid-coder.configureCustomProvider", async () => {
      await configureCustomProviderInteractive(context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hybrid-coder.openSettings", () => {
      vscode.commands.executeCommand("workbench.action.openSettings", "hybrid-coder");
    })
  );
}

async function configureCustomProviderInteractive(context: vscode.ExtensionContext) {
  const currentCmd = context.globalState.get<string>("customCliCommand") || "qwen";
  const cmd = await vscode.window.showInputBox({
    title: "Hybrid Coder Configuration: Custom Provider (Step 1/2)",
    prompt: "Enter the command name (e.g., qwen, opencode, python)",
    value: currentCmd,
    ignoreFocusOut: true
  });

  if (cmd === undefined) return; 

  const currentArgs = context.globalState.get<string>("customCliArgs") || '-p "{prompt}"';
  const args = await vscode.window.showInputBox({
    title: "Hybrid Coder Configuration: Custom Provider (Step 2/2)",
    prompt: "Enter the arguments template (use {prompt} as placeholder)",
    value: currentArgs,
    ignoreFocusOut: true
  });

  if (args === undefined) return;

  await context.globalState.update("customCliCommand", cmd);
  await context.globalState.update("customCliArgs", args);

  vscode.window.showInformationMessage(`Successfully updated 'custom' provider to command: ${cmd}`);
}