package dev.copal.jetbrains

import com.intellij.codeInsight.intention.IntentionAction
import com.intellij.codeInsight.intention.PriorityAction
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.vfs.LocalFileSystem
import java.io.File
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.TextRange
import com.intellij.psi.PsiDocumentManager
import com.intellij.psi.PsiFile

private fun documentOf(project: Project, editor: Editor?, file: PsiFile?): Document? =
    editor?.document ?: file?.let { PsiDocumentManager.getInstance(project).getDocument(it) }

private fun lineText(doc: Document, line: Int): String? {
    if (line < 0 || line >= doc.lineCount) return null
    return doc.getText(TextRange(doc.getLineStartOffset(line), doc.getLineEndOffset(line)))
}

/** Records a hint-ladder step for the growth metric (best effort, off the UI thread). */
internal fun recordEvent(workDir: String?, f: Finding, level: Int, action: String) {
    if (CopalSettings.get().state.serverUrl.isBlank()) return
    ApplicationManager.getApplication().executeOnPooledThread {
        try {
            val args = mutableListOf("event", f.ruleId, level.toString(), action, "--source", "ide", "--json")
            f.category?.let { args += listOf("--category", it) }
            CopalRunner.run(CopalRunner.command(workDir, *args.toTypedArray()), timeoutMs = 5_000)
        } catch (_: Exception) {
        }
    }
}

/** Fire-and-forget CLI call for dashboard data (kata done, heartbeat); never blocks the editor. */
internal fun runCli(workDir: String?, vararg args: String) {
    if (CopalSettings.get().state.serverUrl.isBlank()) return
    ApplicationManager.getApplication().executeOnPooledThread {
        try {
            CopalRunner.run(CopalRunner.command(workDir, *args), timeoutMs = 10_000)
        } catch (_: Exception) {
        }
    }
}

private fun workDirOf(file: PsiFile?): String? = file?.virtualFile?.let { CopalRunner.findPolicyDir(it)?.path }

/** Level 1 — "Ask me": the rule's question in a dialog; the developer thinks aloud, then can climb the ladder. */
class AskMeFix(private val finding: Finding) : IntentionAction, PriorityAction {
    override fun getText() = "Copal: Ask me (${finding.ruleId})"
    override fun getFamilyName() = "Copal coach"
    override fun getPriority() = PriorityAction.Priority.TOP
    override fun startInWriteAction() = false
    override fun isAvailable(project: Project, editor: Editor?, file: PsiFile?) = finding.coach?.question != null

    override fun invoke(project: Project, editor: Editor?, file: PsiFile?) {
        val q = finding.coach?.question ?: return
        val answer = Messages.showMultilineInputDialog(project, q, "Copal · ${finding.ruleId}", "", null, null) ?: return
        recordEvent(workDirOf(file), finding, 1, if (answer.isBlank()) "skipped" else "answered")
        val options = if (finding.fix != null) arrayOf("Explain", "Show me", "Done") else arrayOf("Explain", "Done")
        val prompt = if (answer.isBlank()) "No worries. Want a nudge?" else "Nice — compare with the team's reasoning?"
        when (options.getOrNull(Messages.showDialog(project, prompt, "Copal · ${finding.ruleId}", options, 0, null))) {
            "Explain" -> ExplainFix(finding).invoke(project, editor, file)
            "Show me" -> ShowMeFix(finding).invoke(project, editor, file)
        }
    }
}

/** Levels 2–3 — "Explain": why, the team's reference, wrong vs right. Opens a repo reference file when there is one. */
class ExplainFix(private val finding: Finding) : IntentionAction, PriorityAction {
    override fun getText() = "Copal: Explain (${finding.ruleId})"
    override fun getFamilyName() = "Copal coach"
    override fun getPriority() = PriorityAction.Priority.HIGH
    override fun startInWriteAction() = false
    override fun isAvailable(project: Project, editor: Editor?, file: PsiFile?) = finding.coached || finding.why != null

    override fun invoke(project: Project, editor: Editor?, file: PsiFile?) {
        val workDir = workDirOf(file)
        recordEvent(workDir, finding, CopalText.explainLevel(finding), "explain")
        val ref = finding.coach?.reference
        val buttons = mutableListOf("Close")
        if (ref != null) buttons.add(0, "Open reference")
        if (finding.coach?.kata != null) {
            buttons.add(0, "Mark kata done")
            buttons.add(0, "Open kata")
        }
        when (buttons.getOrNull(Messages.showDialog(project, CopalText.explainText(finding), "Copal · Explain ${finding.ruleId}", buttons.toTypedArray(), buttons.size - 1, null))) {
            "Open kata" -> BrowserUtil.browse(finding.coach!!.kata!!)
            "Mark kata done" -> runCli(workDir, "kata", "done", finding.coach!!.kata!!, "--rule", finding.ruleId, "--json")
            "Open reference" -> {
                if (ref!!.startsWith("http")) BrowserUtil.browse(ref)
                else workDir?.let { LocalFileSystem.getInstance().findFileByIoFile(File(it, ref)) }?.let { OpenFileDescriptor(project, it).navigate(true) }
            }
        }
    }
}

/** Level 4 — "Show me": applies the pattern correction when there is one, otherwise shows the fix. Recorded. */
class ShowMeFix(private val finding: Finding) : IntentionAction, PriorityAction {
    override fun getText() = "Copal: Show me (${finding.ruleId})"
    override fun getFamilyName() = "Copal coach"
    override fun getPriority() = PriorityAction.Priority.NORMAL
    override fun startInWriteAction() = false
    override fun isAvailable(project: Project, editor: Editor?, file: PsiFile?) = finding.fix != null

    override fun invoke(project: Project, editor: Editor?, file: PsiFile?) {
        recordEvent(workDirOf(file), finding, 4, "show_me")
        val s = finding.suggestion
        val doc = documentOf(project, editor, file)
        if (s != null && doc != null && lineText(doc, finding.line - 1) == s.original) {
            com.intellij.openapi.command.WriteCommandAction.runWriteCommandAction(project, "Copal: Show me", null, {
                val line = finding.line - 1
                doc.replaceString(doc.getLineStartOffset(line), doc.getLineEndOffset(line), s.replacement)
            })
        } else {
            Messages.showInfoMessage(project, finding.fix ?: "No fix is defined for this rule.", "Copal · Show me ${finding.ruleId}")
        }
    }
}

/** Replaces the offending line with the rule's concrete correction (uncoached rules; same as `copal check --fix`). */
class ApplySuggestionFix(private val finding: Finding) : IntentionAction, PriorityAction {
    override fun getText() = "Copal: apply correction (${finding.ruleId})"
    override fun getFamilyName() = "Copal"
    override fun getPriority() = PriorityAction.Priority.TOP
    override fun startInWriteAction() = true

    override fun isAvailable(project: Project, editor: Editor?, file: PsiFile?): Boolean {
        val doc = documentOf(project, editor, file) ?: return false
        return finding.suggestion != null && lineText(doc, finding.line - 1) == finding.suggestion.original
    }

    override fun invoke(project: Project, editor: Editor?, file: PsiFile?) {
        val doc = documentOf(project, editor, file) ?: return
        val suggestion = finding.suggestion ?: return
        val line = finding.line - 1
        if (lineText(doc, line) != suggestion.original) return
        doc.replaceString(doc.getLineStartOffset(line), doc.getLineEndOffset(line), suggestion.replacement)
    }
}

/** "Not relevant": hides the hint for this line in this project and records it for the team's rules to tune. No comment in the code. */
class MarkFalsePositiveFix(private val finding: Finding) : IntentionAction {
    override fun getText() = "Copal: Not relevant here (${finding.ruleId})"
    override fun getFamilyName() = "Copal"
    override fun startInWriteAction() = false

    override fun isAvailable(project: Project, editor: Editor?, file: PsiFile?): Boolean = documentOf(project, editor, file) != null

    override fun invoke(project: Project, editor: Editor?, file: PsiFile?) {
        val doc = documentOf(project, editor, file) ?: return
        val line = (finding.line - 1).coerceIn(0, maxOf(doc.lineCount - 1, 0))
        Dismissals.add(project, Dismissals.key(finding, lineText(doc, line) ?: ""))
        recordEvent(workDirOf(file), finding, 0, "false_positive")
        file?.let { com.intellij.codeInsight.daemon.DaemonCodeAnalyzer.getInstance(project).restart(it) }
    }
}

/** Dismissed hints per project, keyed by rule, file and the line's text (so they survive edits above the line). */
object Dismissals {
    private const val KEY = "copal.dismissed"
    fun key(f: Finding, lineText: String) = "${f.ruleId}|${f.file}|${lineText.trim()}"
    fun of(project: Project): Set<String> = com.intellij.ide.util.PropertiesComponent.getInstance(project).getList(KEY)?.toSet() ?: emptySet()
    fun add(project: Project, k: String) {
        val pc = com.intellij.ide.util.PropertiesComponent.getInstance(project)
        pc.setList(KEY, ((pc.getList(KEY) ?: emptyList()) + k).distinct())
    }
}

/** "Create the test": opens the test the rule expects, creating it with a first example to fill in when missing. */
class CreateTestFix(private val finding: Finding) : IntentionAction, PriorityAction {
    override fun getText() = "Copal: Create the test"
    override fun getFamilyName() = "Copal coach"
    override fun getPriority() = PriorityAction.Priority.TOP
    override fun startInWriteAction() = false
    override fun isAvailable(project: Project, editor: Editor?, file: PsiFile?) = CopalText.testPathIn(finding.message) != null && workDirOf(file) != null

    override fun invoke(project: Project, editor: Editor?, file: PsiFile?) {
        val rel = CopalText.testPathIn(finding.message) ?: return
        val root = workDirOf(file) ?: return
        val target = File(root, rel)
        if (!target.exists()) {
            target.parentFile?.mkdirs()
            target.writeText(CopalText.testSkeleton(rel, finding.file))
        }
        val vf = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(target) ?: return
        OpenFileDescriptor(project, vf).navigate(true)
        recordEvent(root, finding, 4, "create_test")
    }
}

/** "Fix with my assistant": puts a ready request in the clipboard for the developer's AI chat (AI Assistant, Copilot, Junie). */
class FixWithAssistantFix(private val finding: Finding) : IntentionAction {
    override fun getText() = "Copal: Fix with my assistant"
    override fun getFamilyName() = "Copal coach"
    override fun startInWriteAction() = false
    override fun isAvailable(project: Project, editor: Editor?, file: PsiFile?) = true

    override fun invoke(project: Project, editor: Editor?, file: PsiFile?) {
        com.intellij.openapi.ide.CopyPasteManager.getInstance().setContents(java.awt.datatransfer.StringSelection(CopalText.assistantPrompt(finding)))
        CopalNotifier.notify(project, "Copal: the request is in your clipboard. Paste it into your AI assistant's chat.")
        recordEvent(workDirOf(file), finding, 4, "fix_with_assistant")
    }
}
