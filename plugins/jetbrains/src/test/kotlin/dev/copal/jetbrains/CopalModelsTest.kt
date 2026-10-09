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

    @Test
    fun coachedFindingsLeadWithTheQuestion() {
        val json = """{"policyMode":"coach","findings":[{"ruleId":"ledger-rounding","severity":"error","mode":"audit","blocking":false,"file":"src/invoice/total.ts","line":8,"message":"Inline rounding bypasses LedgerPort","why":"Rounding in one place keeps invoices and the ledger reconciled.","coach":{"question":"Who owns rounding in this codebase?","reference":"docs/rules/ledger-rounding.md","example":{"bad":"Math.round(x * 100) / 100","good":"LedgerPort.round(x, Currency.EUR)"},"kata":"https://sammancoaching.org/kata_descriptions/supermarket_receipt.html"},"suggestion":{"original":"a","replacement":"  const total = LedgerPort.round(sum, Currency.EUR);"}}],"blocking":false,"summary":{"total":1,"blocking":0,"audit":1}}"""
        val r = CopalJson.parseReport(json)!!
        assertEquals("coach", r.policyMode)
        val f = r.findings[0]
        assertTrue(f.coached)
        assertEquals("const total = LedgerPort.round(sum, Currency.EUR);", f.fix)
        assertEquals("Copal [ledger-rounding] Inline rounding bypasses LedgerPort — Who owns rounding in this codebase?", CopalText.message(f))
        val tip = CopalText.tooltipHtml(f)
        assertTrue(tip.contains("<b>Who owns rounding in this codebase?</b>"))
        assertTrue(tip.contains("Ask me · Explain · Show me"))
        assertTrue("fix stays hidden until Show me", !tip.contains("LedgerPort.round(sum"))
        assertEquals(3, CopalText.explainLevel(f))
        assertTrue(CopalText.explainText(f).contains("Prefer:     LedgerPort.round(x, Currency.EUR)"))
    }

    @Test
    fun parsesNavigatorSession() {
        val r = CopalJson.parseReflect("""{"sessionId":"local_x","engage":true,"reason":"feature-sized task","questions":[{"id":"q1","kind":"first-example","text":"What is the first example?"}],"mode":"local"}""")!!
        assertTrue(r.engage)
        assertEquals("first-example", r.questions[0].kind)
        val json = CopalJson.answersJson(AnswersInput(r.sessionId, r.questions, listOf(NavigatorAnswer("q1", "100 net gives 121")), skipped = false))
        assertTrue(json.contains("\"answers\":[{\"id\":\"q1\",\"text\":\"100 net gives 121\"}]"))
    }

    @Test
    fun `a hint is recorded as shown once per file, rule and line`() {
        ShownHints.reset()
        val f = Finding(ruleId = "no-float-money", category = "quality", line = 12)
        assertTrue(ShownHints.firstTime("/repo/Invoice.kt", f))
        assertEquals(false, ShownHints.firstTime("/repo/Invoice.kt", f))
        assertTrue(ShownHints.firstTime("/repo/Invoice.kt", f.copy(line = 13)))
        assertTrue(ShownHints.firstTime("/repo/Other.kt", f))
    }

    @Test
    fun `heartbeats are throttled to one every two minutes`() {
        Heartbeats.reset()
        assertTrue(Heartbeats.due(1_000_000L))
        assertEquals(false, Heartbeats.due(1_000_000L + 60_000L))
        assertTrue(Heartbeats.due(1_000_000L + Heartbeats.INTERVAL_MS))
    }

    // Output of: copal review --json on billing-api scenario 01 (fields trimmed), plus one scope item.
    private val reviewJson = """
        copal: a warning first
        {"base":"main","blocking":true,"findings":[{"ruleId":"ledger-rounding","category":"architecture","blocking":true,"file":"src/invoice/total.ts","line":8,"message":"Inline rounding bypasses LedgerPort","why":"Rounding in one place keeps invoices and the ledger reconciled.","suggestion":{"original":"  const total = Math.round(sum * 100) / 100;","replacement":"  const total = LedgerPort.round(sum, Currency.EUR);"},"coach":{"question":"Who owns rounding in this codebase?","reference":"docs/rules/ledger-rounding.md","kata":"https://sammancoaching.org/kata_descriptions/supermarket_receipt.html"}},{"ruleId":"hardcoded-credentials","category":"security","blocking":true,"file":"src/invoice/total.ts","line":12,"message":"Hard-coded credential detected (aws-access-key: AKIA…7Z2M)","why":"Credentials in source end up in git history, prompts and logs. Load them from the secret manager.","fixText":"Remove the literal, read it from configuration (e.g. config.require('PAYMENTS_KEY') backed by the secret manager), and rotate the exposed credential.","coach":{"question":"Where should this value live so it never reaches git, a prompt or a log?"}},{"ruleId":"invoice-contract-test","category":"testing","blocking":false,"file":"src/invoice/total.ts","line":6,"message":"Change has no accompanying test (expected src/invoice/total.test.ts)","why":"Invoice maths is contract-tested against the ledger fixtures.","fixText":"Add src/invoice/<name>.test.ts with one example from the ledger fixtures (input → expected total) and run it before changing the code.","coach":{"question":"Which example would prove this invoice change is right — and is it written down as a test yet?","reference":"docs/rules/invoice-contract-test.md","kata":"https://sammancoaching.org/kata_descriptions/string_calculator.html"}}],"scope":[{"file":"src/web/settings-page.ts","question":"Not in the brief: src/web/settings-page.ts — keep it?","details":["new export renderSettingsPage"]}]}
    """.trimIndent()

    @Test
    fun `review output parses into three hint cards with the full ladder and the scope list`() {
        val r = CopalJson.parseReview(reviewJson)
        assertNotNull(r)
        assertEquals(listOf("hardcoded-credentials", "invoice-contract-test", "ledger-rounding"), r!!.findings.orEmpty().map { it.ruleId }.sorted())
        r.findings.orEmpty().forEach { assertEquals(it.ruleId, listOf("Ask me", "Explain", "Show me"), ReviewText.actions(it)) }
        assertEquals("main", r.base)
        assertEquals("src/web/settings-page.ts", r.scope.orEmpty().single().file)
        assertNull(CopalJson.parseReview("not json"))
    }
}
