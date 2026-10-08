package dev.copal.jetbrains

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pure tests (no IDE): JSON contract with the CLI and text helpers used by the annotator and quick fixes. */
class CopalModelsTest {
    // Exact output of: copal check --stdin-file src/invoice/total.ts --json (scenario 01), trimmed.
    private val cliJson = """
        copal: some warning on a previous line
        {"environment":"local","findings":[{"ruleId":"ledger-rounding","category":"architecture","severity":"error","mode":"enforce","blocking":true,"file":"src/invoice/total.ts","line":8,"message":"Inline rounding bypasses LedgerPort","why":"Rounding in one place keeps invoices and the ledger reconciled.","sources":["rule ledger-rounding","Jira FIN-402"],"column":17,"endColumn":42,"suggestion":{"original":"  const total = Math.round(sum * 100) / 100;","replacement":"  const total = LedgerPort.round(sum, Currency.EUR);"}},{"ruleId":"invoice-contract-test","category":"testing","severity":"warning","mode":"audit","blocking":false,"file":"src/invoice/total.ts","line":1,"message":"Change has no accompanying test"}],"blocking":true,"summary":{"total":2,"blocking":1,"audit":1,"byCategory":{"architecture":1,"testing":1}},"filesChecked":1,"rulesEvaluated":9,"project":"billing-api","file":"src/invoice/total.ts","mode":"local"}
    """.trimIndent()

    @Test
    fun parsesCliReport() {
        val r = CopalJson.parseReport(cliJson)
        assertNotNull(r)
        r!!
        assertTrue(r.blocking)
        assertEquals(1, r.summary.blocking)
        assertEquals("billing-api", r.project)
        val f = r.findings[0]
        assertEquals("ledger-rounding", f.ruleId)
        assertEquals(17, f.column)
        assertEquals("  const total = LedgerPort.round(sum, Currency.EUR);", f.suggestion!!.replacement)
        assertNull(r.findings[1].column)
        assertNull(r.findings[1].suggestion)
    }

    @Test
    fun rejectsGarbage() {
        assertNull(CopalJson.parseReport("copal: no .copalrules found"))
    }

    @Test
    fun columnsAndComments() {
        val line = "  const total = Math.round(sum * 100) / 100;"
        assertEquals(16 until 41, CopalText.columnsInLine(line, 17, 42))
        assertEquals(2 until line.length, CopalText.columnsInLine(line, null, null))
        assertEquals(0 until 0, CopalText.columnsInLine("", null, null))
        assertEquals("//", CopalText.commentPrefix("total.ts"))
        assertEquals("#", CopalText.commentPrefix("repo.py"))
        assertNull(CopalText.commentPrefix("package.json"))
        assertEquals("  // copal-ignore ledger-rounding\n", CopalText.ignoreLine("  ", "//", "ledger-rounding"))
    }
}
