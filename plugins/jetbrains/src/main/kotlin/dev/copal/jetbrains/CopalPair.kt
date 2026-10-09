package dev.copal.jetbrains

import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBLabel
import com.intellij.ui.content.ContentFactory
import java.awt.BorderLayout
import java.awt.datatransfer.StringSelection
import java.util.WeakHashMap
import javax.swing.JButton
import javax.swing.JPanel

/**
 * "Copal Task" tool window — the agreed task the AI assistant works from (`.copal/brief.md`): task, scope in / out,
 * the examples with their status, the next step and the last scope check. Works with any AI assistant through the
 * brief file; Copal has no AI connection of its own here. Buttons: New task (the navigator), Review my change.
 */
class CopalPairToolWindowFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val view = JBLabel().apply {
            verticalAlignment = javax.swing.SwingConstants.TOP
            border = com.intellij.util.ui.JBUI.Borders.empty(8)
        }
        val panel = JPanel(BorderLayout())
        panel.add(JBScrollPane(view), BorderLayout.CENTER)
        val buttons = JPanel()
        buttons.add(JButton("New task…").apply { addActionListener { CopalPair.start(project) } })
        buttons.add(JButton("Review my change").apply { addActionListener { CopalReview.run(project) } })
        buttons.add(JButton("Refresh").apply { addActionListener { CopalPair.refresh(project) } })
        panel.add(buttons, BorderLayout.SOUTH)
        toolWindow.contentManager.addContent(ContentFactory.getInstance().createContent(panel, "Task", false))
        CopalPair.views[project] = view
        CopalPair.refresh(project)
    }
}

object CopalPair {
    const val TOOL_WINDOW_ID = "Copal Task"
    internal val views = WeakHashMap<Project, JBLabel>()

    private fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    /** HTML for the panel: brief + last scope check. Pure, so it is easy to reason about. */
    internal fun render(brief: Brief?, scope: ScopeCheckOutput?): String {
        if (brief == null) return "<html><b>No task yet.</b><br><br>Click <b>New task…</b>: Copal asks for the first example, " +
            "where the code belongs, what could go wrong and what not to touch, then writes <code>.copal/brief.md</code> " +
            "for your AI assistant.</html>"
        val sb = StringBuilder("<html><h3>${esc(brief.task.ifBlank { "Task" })}</h3>")
        sb.append("<b>In scope:</b> ${esc(brief.scopeIn ?: "not stated")}<br><b>Not to touch:</b> ${esc(brief.scopeOut ?: "not stated")}<br><br>")
        sb.append("<b>Examples</b> — ${esc(brief.progress)}<br>")
        brief.examples.forEach { sb.append(if (it.passing) "✓ " else "○ ").append(esc(it.text)).append("<br>") }
        brief.next?.let { sb.append("<br><b>Next:</b> ${esc(it)}<br>") }
        val items = scope?.items.orEmpty()
        sb.append("<br><b>Last scope check</b>${scope?.base?.let { " (vs ${esc(it)})" } ?: ""}<br>")
        if (scope == null) sb.append("not run yet<br>")
        else if (items.isEmpty()) sb.append("Everything in this change is covered by the brief.<br>")
        else items.forEach { sb.append("? ${esc(it.question)}<br>") }
        return sb.append("</html>").toString()
    }

    /** Re-reads .copal/brief.md and runs `copal scope-check --json` (local, off the UI thread). */
    fun refresh(project: Project) {
        val dir = project.basePath ?: return
        ApplicationManager.getApplication().executeOnPooledThread {
            val file = java.io.File(dir, ".copal/brief.md")
            val brief = if (file.isFile) BriefParser.parse(file.readText()) else null
            val scope = if (brief != null) try {
                CopalJson.parseScopeCheck(CopalRunner.run(CopalRunner.command(dir, "scope-check", "--json"), timeoutMs = 30_000).stdout)
            } catch (_: Exception) {
                null
            } else null
            ApplicationManager.getApplication().invokeLater { views[project]?.text = render(brief, scope) }
        }
    }

    private fun workDir(project: Project, e: AnActionEvent? = null): String? =
        e?.getData(CommonDataKeys.VIRTUAL_FILE)?.let { CopalRunner.findPolicyDir(it)?.path } ?: project.basePath

    fun start(project: Project, e: AnActionEvent? = null) {
        val task = Messages.showMultilineInputDialog(project, "What are you about to ask the AI to build?", "Copal · Pair on a Task", "", null, null)
            ?.trim()?.takeIf { it.isNotEmpty() } ?: return
        val dir = workDir(project, e)
        object : Task.Backgroundable(project, "Copal: preparing navigator questions", false) {
            override fun run(indicator: ProgressIndicator) {
                val out = CopalRunner.run(CopalRunner.command(dir, "reflect", task, "--json"))
                val reflect = CopalJson.parseReflect(out.stdout)
                ApplicationManager.getApplication().invokeLater { ask(project, dir, task, reflect, out.stderr) }
            }
        }.queue()
    }

    private fun ask(project: Project, dir: String?, task: String, reflect: ReflectResult?, error: String) {
        if (reflect == null) {
            Messages.showWarningDialog(project, "The copal CLI did not answer: ${error.take(300)}", "Copal")
            return
        }
        val answers = mutableListOf<NavigatorAnswer>()
        var outOfScope: String? = null
        if (reflect.engage) {
            for ((i, q) in reflect.questions.withIndex()) {
                val a = Messages.showMultilineInputDialog(project, q.text, "Copal navigator ${i + 1}/${reflect.questions.size} (empty = skip)", "", null, null) ?: break
                if (a.isNotBlank()) answers.add(NavigatorAnswer(q.id, a.trim()))
            }
            if (answers.isNotEmpty()) {
                outOfScope = Messages.showMultilineInputDialog(project, "What should this change not touch?", "Copal navigator — scope (empty = skip)", "", null, null)?.trim()?.ifBlank { null }
            }
        }
        val input = AnswersInput(reflect.sessionId, reflect.questions, answers, skipped = answers.isEmpty(), outOfScope = outOfScope)
        object : Task.Backgroundable(project, "Copal: writing the brief", false) {
            override fun run(indicator: ProgressIndicator) {
                val out = CopalRunner.run(CopalRunner.command(dir, "reflect", task, "--answers", "-"), CopalJson.answersJson(input))
                val brief = out.stdout.trim().ifBlank { out.stderr.trim() }
                ApplicationManager.getApplication().invokeLater { show(project, brief) }
            }
        }.queue()
    }

    private fun show(project: Project, brief: String) {
        CopyPasteManager.getInstance().setContents(StringSelection(brief))
        val tw = ToolWindowManager.getInstance(project).getToolWindow(TOOL_WINDOW_ID)
        tw?.activate({ refresh(project) }, true) ?: Messages.showInfoMessage(project, brief, "Copal brief")
        CopalNotifier.notify(project, "Copal: brief saved to .copal/brief.md and copied — your AI assistant can read either.")
    }
}

/** Tools → Copal.dev → Pair on a Task… */
class PairOnTaskAction : CopalAction() {
    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.project != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        CopalPair.start(e.project ?: return, e)
    }
}
