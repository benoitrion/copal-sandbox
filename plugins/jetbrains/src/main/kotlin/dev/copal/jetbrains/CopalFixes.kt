package dev.copal.jetbrains

import com.intellij.codeInsight.intention.IntentionAction
import com.intellij.codeInsight.intention.PriorityAction
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

/** Replaces the offending line with the rule's concrete correction (same as `copal check --fix`). */
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

/** Inserts `// copal-ignore <rule>` above the line; the next check (and the PR check) suppresses the finding. */
class MarkFalsePositiveFix(private val finding: Finding) : IntentionAction {
    override fun getText() = "Copal: mark as false positive (${finding.ruleId})"
    override fun getFamilyName() = "Copal"
    override fun startInWriteAction() = true

    override fun isAvailable(project: Project, editor: Editor?, file: PsiFile?): Boolean =
        file != null && CopalText.commentPrefix(file.name) != null && documentOf(project, editor, file) != null

    override fun invoke(project: Project, editor: Editor?, file: PsiFile?) {
        val doc = documentOf(project, editor, file) ?: return
        val prefix = CopalText.commentPrefix(file?.name ?: return) ?: return
        val line = (finding.line - 1).coerceIn(0, maxOf(doc.lineCount - 1, 0))
        val indent = CopalText.leadingWhitespace(lineText(doc, line) ?: "")
        doc.insertString(doc.getLineStartOffset(line), CopalText.ignoreLine(indent, prefix, finding.ruleId))
    }
}
