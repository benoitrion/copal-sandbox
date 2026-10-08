package dev.copal.jetbrains

import com.intellij.codeInsight.daemon.DaemonCodeAnalyzer
import com.intellij.ide.BrowserUtil
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.psi.PsiManager

private fun stripAnsi(s: String) = s.replace(Regex("\u001B\\[[0-9;]*m"), "")

abstract class CopalAction : AnAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT
}

/** Tools → Copal.dev → Set API Key… */
class SetApiKeyAction : CopalAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val key = Messages.showPasswordDialog(e.project, "Copal device key (copal_…):", "Copal.dev", null) ?: return
        ApplicationManager.getApplication().executeOnPooledThread {
            CopalSettings.apiKey = key.trim().ifEmpty { null }
            CopalNotifier.notify(e.project, if (key.isBlank()) "Copal API key removed." else "Copal API key saved in the password safe.")
        }
    }
}

/** Same validation as the pre-commit hook, recorded in the console when a server is configured. */
class CheckStagedAction : CopalAction() {
    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.project?.basePath != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val dir = project.basePath ?: return
        FileDocumentManager.getInstance().saveAllDocuments()
        object : Task.Backgroundable(project, "Copal: checking staged changes", true) {
            override fun run(indicator: ProgressIndicator) {
                val out = CopalRunner.run(CopalRunner.command(dir, "check", "--staged"), timeoutMs = 60_000)
                val text = stripAnsi(out.stdout + out.stderr).trim()
                val headline = text.lineSequence().firstOrNull { it.isNotBlank() } ?: "No output"
                val type = when (out.exitCode) {
                    0 -> NotificationType.INFORMATION
                    1 -> NotificationType.ERROR
                    else -> NotificationType.WARNING
                }
                CopalNotifier.notify(project, headline, type, details = text)
            }
        }.queue()
    }
}

/** Shows the rules that apply to the current file — what Copal MCP gives coding agents. */
class ShowRulesAction : CopalAction() {
    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.getData(CommonDataKeys.VIRTUAL_FILE)?.let { CopalRunner.findPolicyDir(it) } != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val vf = e.getData(CommonDataKeys.VIRTUAL_FILE) ?: return
        val policyDir = CopalRunner.findPolicyDir(vf) ?: return
        object : Task.Backgroundable(project, "Copal: loading rules", false) {
            override fun run(indicator: ProgressIndicator) {
                val rel = vf.path.removePrefix(policyDir.path).trimStart('/')
                val out = CopalRunner.run(CopalRunner.command(policyDir.path, "rules", rel))
                val text = stripAnsi(out.stdout.ifBlank { out.stderr }).trim()
                ApplicationManager.getApplication().invokeLater {
                    Messages.showInfoMessage(project, text, "Copal Rules — $rel")
                }
            }
        }.queue()
    }
}

/** Re-runs highlighting on the current file (e.g. after editing .copalrules). */
class RecheckFileAction : CopalAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project: Project = e.project ?: return
        val vf = e.getData(CommonDataKeys.VIRTUAL_FILE) ?: return
        val psi = PsiManager.getInstance(project).findFile(vf) ?: return
        DaemonCodeAnalyzer.getInstance(project).restart(psi)
    }
}

class OpenConsoleAction : CopalAction() {
    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = CopalSettings.get().state.serverUrl.isNotBlank()
    }

    override fun actionPerformed(e: AnActionEvent) {
        BrowserUtil.browse(CopalSettings.get().state.serverUrl)
    }
}

/** Tools → Copal.dev → Sync Agent Instruction Files: CLAUDE.md, AGENTS.md, Cursor and Copilot get the team's rules. */
class SyncAgentFilesAction : CopalAction() {
    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.project?.basePath != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val dir = e.getData(CommonDataKeys.VIRTUAL_FILE)?.let { CopalRunner.findPolicyDir(it)?.path } ?: project.basePath ?: return
        object : Task.Backgroundable(project, "Copal: syncing agent instruction files", false) {
            override fun run(indicator: ProgressIndicator) {
                val out = CopalRunner.run(CopalRunner.command(dir, "sync-context"))
                val text = stripAnsi(out.stdout + out.stderr).trim()
                CopalNotifier.notify(project, if (out.exitCode == 0) "Copal: agent instruction files synced — commit them." else "Copal: sync failed", if (out.exitCode == 0) NotificationType.INFORMATION else NotificationType.WARNING, details = text)
                com.intellij.openapi.vfs.VfsUtil.markDirtyAndRefresh(true, true, true, java.io.File(dir))
            }
        }.queue()
    }
}
