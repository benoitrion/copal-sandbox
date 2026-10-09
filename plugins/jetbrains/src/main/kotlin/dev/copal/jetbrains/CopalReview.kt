package dev.copal.jetbrains

import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.psi.PsiManager
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.content.ContentFactory
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.FlowLayout
import java.io.File
import javax.swing.BorderFactory
import javax.swing.BoxLayout
import javax.swing.JButton
import javax.swing.JPanel

private fun html(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

/**
 * "Copal Review" tool window — Review my change: the engine and the scope check on the working tree vs the base
 * branch (`copal review --json`, local, no server), shown as hint cards with Ask me · Explain · Show me.
 */
class CopalReviewToolWindowFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = JPanel(BorderLayout())
        val run = JButton("Review my change")
        run.addActionListener { CopalReview.run(project) }
        panel.add(JPanel(FlowLayout(FlowLayout.LEFT)).apply { add(run) }, BorderLayout.NORTH)
        panel.add(JBLabel("<html>Run <b>Review my change</b> before you open a pull request.</html>").apply { border = JBUI.Borders.empty(8) }, BorderLayout.CENTER)
        toolWindow.contentManager.addContent(ContentFactory.getInstance().createContent(panel, "", false))
        CopalReview.panels[project] = panel
    }
}

object CopalReview {
    internal val panels = java.util.WeakHashMap<Project, JPanel>()

    fun run(project: Project) {
        val dir = project.basePath ?: return
        FileDocumentManager.getInstance().saveAllDocuments()
        object : Task.Backgroundable(project, "Copal: reviewing your change", true) {
            override fun run(indicator: ProgressIndicator) {
                val out = CopalRunner.run(CopalRunner.command(dir, "review", "--json", "--env", CopalSettings.get().state.environment), timeoutMs = 60_000)
                val review = CopalJson.parseReview(out.stdout)
                ApplicationManager.getApplication().invokeLater {
                    if (review == null) {
                        CopalNotifier.notify(project, "Copal: review failed — ${(out.stderr.ifBlank { out.stdout }).trim().take(300)}")
                    } else {
                        show(project, dir, review)
                        review.findings.orEmpty().forEach { recordEvent(dir, it, if (it.coach?.question != null) 1 else 0, "shown") }
                    }
                }
            }
        }.queue()
    }

    private fun show(project: Project, dir: String, review: ReviewOutput) {
        val tw = ToolWindowManager.getInstance(project).getToolWindow("Copal Review") ?: return
        tw.show {
            val root = panels[project] ?: return@show
            if (root.componentCount > 1) root.remove(1)
            val list = JPanel().apply { layout = BoxLayout(this, BoxLayout.Y_AXIS) }
            val findings = review.findings.orEmpty()
            list.add(JBLabel("<html><b>${findings.size} hint(s)</b> vs ${html(review.base ?: "base")}</html>").apply { border = JBUI.Borders.empty(6, 8) })
            if (findings.isEmpty() && review.scope.orEmpty().isEmpty()) list.add(JBLabel("Nothing to discuss in this change.").apply { border = JBUI.Borders.empty(8) })
            findings.forEach { list.add(card(project, dir, it)) }
            if (review.scope.orEmpty().isNotEmpty()) {
                list.add(JBLabel("<html><b>Beyond the brief</b></html>").apply { border = JBUI.Borders.empty(10, 8, 4, 8) })
                review.scope.orEmpty().forEach { list.add(JBLabel("<html>? ${html(it.question)}</html>").apply { border = JBUI.Borders.empty(2, 12) }) }
            }
            root.add(JBScrollPane(list), BorderLayout.CENTER)
            root.revalidate()
            root.repaint()
        }
    }

    private fun card(project: Project, dir: String, f: Finding): JPanel {
        val p = JPanel(BorderLayout())
        p.border = BorderFactory.createCompoundBorder(JBUI.Borders.empty(4, 8), BorderFactory.createCompoundBorder(JBUI.Borders.customLine(if (f.blocking) com.intellij.ui.JBColor.RED else com.intellij.ui.JBColor.border(), 1), JBUI.Borders.empty(6, 10)))
        val q = f.coach?.question?.let { "<br><b>${html(it)}</b>" } ?: ""
        p.add(JBLabel("<html><b>${html(f.ruleId)}</b> · ${html(f.category ?: "")}<br><small>${html(f.file)}:${f.line}</small><br>${html(f.message)}$q</html>"), BorderLayout.CENTER)
        val buttons = JPanel(FlowLayout(FlowLayout.LEFT, 4, 0))
        for (a in ReviewText.actions(f)) {
            buttons.add(JButton(a).apply { addActionListener { ladder(project, dir, f, a) } })
        }
        p.add(buttons, BorderLayout.SOUTH)
        return p
    }

    /** The same quick fixes as in the editor, on the file of the finding (opened if needed). */
    private fun ladder(project: Project, dir: String, f: Finding, action: String) {
        val vf = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(File(dir, f.file))
        val psi = vf?.let { PsiManager.getInstance(project).findFile(it) }
        val editor = vf?.let { com.intellij.openapi.fileEditor.FileEditorManager.getInstance(project).openTextEditor(com.intellij.openapi.fileEditor.OpenFileDescriptor(project, it, (f.line - 1).coerceAtLeast(0), 0), true) }
        when (action) {
            "Ask me" -> AskMeFix(f).invoke(project, editor, psi)
            "Explain" -> ExplainFix(f).invoke(project, editor, psi)
            "Show me" -> ShowMeFix(f).invoke(project, editor, psi)
        }
    }
}

/** Tools → Copal.dev → Review My Change */
class ReviewMyChangeAction : CopalAction(), DumbAware {
    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.project?.basePath != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        ToolWindowManager.getInstance(project).getToolWindow("Copal Review")?.show()
        CopalReview.run(project)
    }
}
