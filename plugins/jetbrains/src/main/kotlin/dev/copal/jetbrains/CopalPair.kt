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
import com.intellij.ui.components.JBTextArea
import com.intellij.ui.content.ContentFactory
import java.awt.BorderLayout
import java.awt.datatransfer.StringSelection
import java.util.WeakHashMap
import javax.swing.JButton
import javax.swing.JPanel

/**
 * "Copal Pair" tool window — navigator mode (strong-style pairing). Before asking an AI assistant to build something,
 * the developer answers up to three questions (first example → failing test, placement, risk); Copal turns the
 * answers into a brief for the assistant: test first, small steps, code where the developer said.
 */
class CopalPairToolWindowFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val area = JBTextArea("Tools → Copal.dev → Pair on a Task… (or the button below) starts a navigator session.\n\n" +
            "You explain the idea before the AI types it: Copal asks up to 3 questions, then writes the brief for your assistant.").apply {
            isEditable = false
            lineWrap = true
            wrapStyleWord = true
        }
        val panel = JPanel(BorderLayout())
        panel.add(JBScrollPane(area), BorderLayout.CENTER)
        val buttons = JPanel()
        buttons.add(JButton("Pair on a task…").apply { addActionListener { CopalPair.start(project) } })
        buttons.add(JButton("Copy brief").apply {
            addActionListener { CopyPasteManager.getInstance().setContents(StringSelection(area.text)) }
        })
        panel.add(buttons, BorderLayout.SOUTH)
        toolWindow.contentManager.addContent(ContentFactory.getInstance().createContent(panel, "Navigator", false))
        CopalPair.areas[project] = area
    }
}

object CopalPair {
    const val TOOL_WINDOW_ID = "Copal Pair"
    internal val areas = WeakHashMap<Project, JBTextArea>()

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
        if (reflect.engage) {
            for ((i, q) in reflect.questions.withIndex()) {
                val a = Messages.showMultilineInputDialog(project, q.text, "Copal navigator ${i + 1}/${reflect.questions.size} (empty = skip)", "", null, null) ?: break
                if (a.isNotBlank()) answers.add(NavigatorAnswer(q.id, a.trim()))
            }
        }
        val input = AnswersInput(reflect.sessionId, reflect.questions, answers, skipped = answers.isEmpty())
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
        tw?.activate({ areas[project]?.text = brief }, true) ?: Messages.showInfoMessage(project, brief, "Copal brief")
        CopalNotifier.notify(project, "Copal: brief copied — paste it into your AI assistant.")
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
