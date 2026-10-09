package dev.copal.jetbrains

import com.intellij.lang.annotation.AnnotationHolder
import com.intellij.lang.annotation.ExternalAnnotator
import com.intellij.lang.annotation.HighlightSeverity
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.util.TextRange
import com.intellij.psi.PsiDocumentManager
import com.intellij.psi.PsiFile

/**
 * Highlights Copal findings in any file that sits under a `.copalrules`.
 * Unsaved editor content is piped to `copal check --stdin-file <path> --json` (local engine, not recorded).
 */
class CopalExternalAnnotator : ExternalAnnotator<CopalExternalAnnotator.Info, CopalExternalAnnotator.Result>() {

    data class Info(val path: String, val workDir: String, val text: String)
    data class Result(val findings: List<Finding>, val error: String?)

    override fun collectInformation(file: PsiFile, editor: Editor, hasErrors: Boolean): Info? = collect(file)

    override fun collectInformation(file: PsiFile): Info? = collect(file)

    private fun collect(file: PsiFile): Info? {
        if (!CopalSettings.get().state.enabled) return null
        val vf = file.virtualFile ?: return null
        if (!vf.isInLocalFileSystem || vf.name == CopalRunner.POLICY_FILE) return null
        val policyDir = CopalRunner.findPolicyDir(vf) ?: return null
        val text = PsiDocumentManager.getInstance(file.project).getDocument(file)?.text ?: file.text
        return Info(vf.path, policyDir.path, text)
    }

    override fun doAnnotate(info: Info?): Result? {
        if (info == null) return null
        return try {
            val env = CopalSettings.get().state.environment
            val out = CopalRunner.run(CopalRunner.command(info.workDir, "check", "--stdin-file", info.path, "--json", "--env", env), info.text)
            when {
                out.isTimeout -> Result(emptyList(), "the copal CLI timed out")
                else -> {
                    val report = CopalJson.parseReport(out.stdout)
                    if (report != null) Result(report.findings, null)
                    else Result(emptyList(), (out.stderr.ifBlank { out.stdout }).trim().take(300).ifBlank { "copal CLI produced no output (exit ${out.exitCode})" })
                }
            }
        } catch (e: Exception) {
            LOG.warn("Copal check failed", e)
            Result(emptyList(), "cannot run the copal CLI (${e.message}). Configure it in Settings → Tools → Copal.dev.")
        }
    }

    override fun apply(file: PsiFile, annotationResult: Result?, holder: AnnotationHolder) {
        val result = annotationResult ?: return
        if (result.error != null) {
            CopalNotifier.warnOnce(file.project, "Copal: ${result.error}")
            return
        }
        file.virtualFile?.let { vf ->
            if (Heartbeats.due(System.currentTimeMillis())) runCli(CopalRunner.findPolicyDir(vf)?.path, "heartbeat", vf.name, "--editor", "jetbrains", "--json")
        }
        val document = PsiDocumentManager.getInstance(file.project).getDocument(file) ?: return
        for (f in result.findings) {
            val range = rangeFor(document, f) ?: continue
            val severity = when {
                f.blocking -> HighlightSeverity.ERROR
                f.severity == "info" -> HighlightSeverity.WEAK_WARNING
                else -> HighlightSeverity.WARNING
            }
            var builder = holder.newAnnotation(severity, CopalText.message(f))
                .range(range)
                .tooltip(CopalText.tooltipHtml(f))
            if (f.coached) {
                // Hint ladder: question first, explanation next, the fix only on request.
                if (f.coach?.question != null) builder = builder.withFix(AskMeFix(f))
                builder = builder.withFix(ExplainFix(f))
                if (f.fix != null) builder = builder.withFix(ShowMeFix(f))
            } else if (f.suggestion != null) builder = builder.withFix(ApplySuggestionFix(f))
            if (CopalText.commentPrefix(file.name) != null) builder = builder.withFix(MarkFalsePositiveFix(f))
            builder.create()
            // growth metric: a hint counts as "shown" once per file, rule and line per IDE session
            if (f.coached && ShownHints.firstTime(file.virtualFile?.path ?: file.name, f)) {
                recordEvent(file.virtualFile?.let { CopalRunner.findPolicyDir(it)?.path }, f, if (f.coach?.question != null) 1 else 0, "shown")
            }
        }
    }

    private fun rangeFor(doc: Document, f: Finding): TextRange? {
        if (doc.lineCount == 0) return null
        val line = (f.line - 1).coerceIn(0, doc.lineCount - 1)
        val start = doc.getLineStartOffset(line)
        val end = doc.getLineEndOffset(line)
        val cols = CopalText.columnsInLine(doc.getText(TextRange(start, end)), f.column, f.endColumn)
        if (cols.isEmpty()) return TextRange(start, end)
        return TextRange(start + cols.first, start + cols.last + 1)
    }

    companion object {
        private val LOG = logger<CopalExternalAnnotator>()
    }
}
