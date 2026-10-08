package dev.copal.jetbrains

import com.google.gson.Gson
import com.google.gson.JsonParseException

/** Mirrors `Finding` / `Report` from packages/core/src/types.ts (JSON output of `copal check --json`). */
data class Suggestion(
    val original: String = "",
    val replacement: String = "",
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
    val sources: List<String>? = null,
)

data class Summary(
    val total: Int = 0,
    val blocking: Int = 0,
    val audit: Int = 0,
)

data class Report(
    val findings: List<Finding> = emptyList(),
    val blocking: Boolean = false,
    val summary: Summary = Summary(),
    val environment: String = "local",
    val project: String? = null,
    val file: String? = null,
)

object CopalJson {
    private val gson = Gson()

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

    fun tooltipHtml(f: Finding): String {
        val esc = { s: String -> s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;") }
        val sb = StringBuilder("<html><b>Copal</b> · <code>${esc(f.ruleId)}</code> · ${if (f.blocking) "enforce" else "audit"}<br/>${esc(f.message)}")
        f.why?.let { sb.append("<br/><i>${esc(it)}</i>") }
        f.suggestion?.let { sb.append("<br/><code>- ${esc(it.original.trim())}</code><br/><code>+ ${esc(it.replacement.trim())}</code>") }
        f.sources?.takeIf { it.isNotEmpty() }?.let { sb.append("<br/><small>Sources: ${esc(it.joinToString(" · "))}</small>") }
        return sb.append("</html>").toString()
    }
}
