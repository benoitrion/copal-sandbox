package dev.copal.jetbrains

import com.google.gson.Gson
import com.google.gson.JsonParseException

/** Mirrors `Finding` / `Report` from packages/core/src/types.ts (JSON output of `copal check --json`). */
data class Suggestion(
    val original: String = "",
    val replacement: String = "",
)

/** Coaching content of a rule (.copalrules v4). */
data class Example(val bad: String? = null, val good: String? = null)

data class Coach(
    val question: String? = null,
    val reference: String? = null,
    val example: Example? = null,
    val kata: String? = null,
    val learningHour: String? = null,
)

data class Finding(
    val ruleId: String = "",
    val category: String? = null,
    val severity: String = "warning",
    val mode: String = "audit",
    val blocking: Boolean = false,
    val file: String = "",
    val line: Int = 1,
    val column: Int? = null,
    val endColumn: Int? = null,
    val message: String = "",
    val why: String? = null,
    val suggestion: Suggestion? = null,
    val fixText: String? = null,
    val sources: List<String>? = null,
    val coach: Coach? = null,
) {
    /** Level-4 content ("Show me"): the concrete replacement, or the fix described in words. */
    val fix: String? get() = suggestion?.replacement?.trim() ?: fixText
    val coached: Boolean get() = coach != null
}

data class Summary(
    val total: Int = 0,
    val blocking: Int = 0,
    val audit: Int = 0,
)

data class Report(
    val policyMode: String? = null,
    val findings: List<Finding> = emptyList(),
    val blocking: Boolean = false,
    val summary: Summary = Summary(),
    val environment: String = "local",
    val project: String? = null,
    val file: String? = null,
)

/** Navigator mode (`copal reflect TASK --json`). */
data class NavigatorQuestion(val id: String = "", val kind: String = "", val text: String = "")

data class ReflectResult(
    val sessionId: String = "",
    val engage: Boolean = false,
    val reason: String? = null,
    val questions: List<NavigatorQuestion> = emptyList(),
    val mode: String = "local",
)

data class NavigatorAnswer(val id: String, val text: String)

data class AnswersInput(
    val sessionId: String,
    val questions: List<NavigatorQuestion>,
    val answers: List<NavigatorAnswer>,
    val skipped: Boolean,
)

object CopalJson {
    private val gson = Gson()

    fun parseReflect(stdout: String): ReflectResult? {
        val json = stdout.trim().let { s -> s.substring(s.indexOf('{').coerceAtLeast(0)) }
        return try {
            gson.fromJson(json, ReflectResult::class.java)
        } catch (e: JsonParseException) {
            null
        }
    }

    fun answersJson(input: AnswersInput): String = gson.toJson(input)

    /** Parses the last JSON object line printed by the CLI (warnings may precede it). */
    fun parseReport(stdout: String): Report? {
        val json = stdout.lineSequence().map { it.trim() }.lastOrNull { it.startsWith("{") } ?: return null
        return try {
            gson.fromJson(json, Report::class.java)
        } catch (e: JsonParseException) {
            null
        }
    }
}

object CopalText {
    private val hashComment = setOf("py", "yaml", "yml", "sh", "bash", "toml", "rb", "r", "pl", "properties")
    private val noComment = setOf("json")

    /** Line-comment prefix used by the "mark as false positive" fix, or null when the format has none. */
    fun commentPrefix(fileName: String): String? {
        val ext = fileName.substringAfterLast('.', "").lowercase()
        return when {
            ext in noComment -> null
            ext in hashComment || fileName == ".copalrules" -> "#"
            else -> "//"
        }
    }

    fun ignoreLine(indent: String, prefix: String, ruleId: String) = "$indent$prefix copal-ignore $ruleId\n"

    fun leadingWhitespace(line: String): String = line.takeWhile { it == ' ' || it == '\t' }

    /** [start, end) offsets inside a line for a finding, from 1-based columns; whole trimmed line otherwise. */
    fun columnsInLine(lineText: String, column: Int?, endColumn: Int?): IntRange {
        val len = lineText.length
        val start = ((column ?: (leadingWhitespace(lineText).length + 1)) - 1).coerceIn(0, len)
        var end = ((endColumn ?: (len + 1)) - 1).coerceIn(start, len)
        if (end == start && len > start) end = start + 1
        return start until end
    }

    private val esc = { s: String -> s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;") }

    /** Annotation message: the question leads when the rule is coached. */
    fun message(f: Finding): String =
        f.coach?.question?.let { "Copal [${f.ruleId}] ${f.message} — $it" } ?: "Copal [${f.ruleId}] ${f.message}"

    /**
     * Hint card tooltip. Coached findings show level 0–1 (signal + question) and point to Alt+Enter for
     * Ask me · Explain · Show me; the fix is never displayed here. Uncoached findings keep the classic diff.
     */
    fun tooltipHtml(f: Finding): String {
        val stance = if (f.blocking) "blocking" else if (f.coached) "coach" else "audit"
        val sb = StringBuilder("<html><b>Copal</b> · <code>${esc(f.ruleId)}</code> · $stance<br/>${esc(f.message)}")
        val q = f.coach?.question
        if (q != null) {
            sb.append("<br/><br/><b>${esc(q)}</b>")
            sb.append("<br/><small>Alt+Enter → Ask me · Explain · Show me</small>")
        } else {
            f.why?.let { sb.append("<br/><i>${esc(it)}</i>") }
            f.suggestion?.let { sb.append("<br/><code>- ${esc(it.original.trim())}</code><br/><code>+ ${esc(it.replacement.trim())}</code>") }
        }
        f.coach?.kata?.let { sb.append("<br/><small>Practice: ${esc(it)}</small>") }
        f.sources?.takeIf { it.isNotEmpty() }?.let { sb.append("<br/><small>Sources: ${esc(it.joinToString(" · "))}</small>") }
        return sb.append("</html>").toString()
    }

    /** Level 2–3: why, reference, wrong vs right — plain text for a dialog. */
    fun explainText(f: Finding): String = buildString {
        appendLine(f.message)
        f.coach?.question?.let { appendLine(); appendLine("? $it") }
        f.why?.let { appendLine(); appendLine("Why: $it") }
        f.coach?.reference?.let { appendLine("Reference: $it") }
        f.coach?.example?.bad?.let { appendLine(); appendLine("Instead of: $it") }
        f.coach?.example?.good?.let { appendLine("Prefer:     $it") }
        f.coach?.kata?.let { appendLine(); appendLine("Practice: $it") }
    }.trimEnd()

    /** Highest ladder level reachable without "Show me" (0 signal · 1 question · 2 reference · 3 example). */
    fun explainLevel(f: Finding): Int = when {
        f.coach?.example != null -> 3
        f.coach?.reference != null || f.why != null -> 2
        else -> 1
    }
}
