package dev.copal.jetbrains

import com.intellij.openapi.options.BoundConfigurable
import com.intellij.openapi.ui.DialogPanel
import com.intellij.ui.dsl.builder.COLUMNS_LARGE
import com.intellij.ui.dsl.builder.bindSelected
import com.intellij.ui.dsl.builder.bindText
import com.intellij.ui.dsl.builder.columns
import com.intellij.ui.dsl.builder.panel

/** Settings → Tools → Copal.dev */
class CopalConfigurable : BoundConfigurable("Copal.dev") {
    private val options = CopalSettings.get().state

    override fun createPanel(): DialogPanel = panel {
        group("Engine") {
            row("Node.js executable:") {
                textField().bindText(options::nodePath).columns(COLUMNS_LARGE)
            }
            row("copal CLI:") {
                textField().bindText(options::cliPath).columns(COLUMNS_LARGE)
                    .comment("Empty = node_modules/.bin/copal, then copal on PATH. A path ending in .js runs with Node.js (e.g. copal-sandbox/packages/cli/dist/src/index.js).")
            }
            row("Policy environment:") {
                textField().bindText(options::environment)
                    .comment("Matches environments: in .copalrules (local, ci, …)")
            }
            row {
                checkBox("Highlight findings while editing").bindSelected(options::enabled)
            }
        }
        group("Copal server") {
            row("Server URL:") {
                textField().bindText(options::serverUrl).columns(COLUMNS_LARGE)
                    .comment("Mock backend: http://localhost:4010. Used by “Check Staged Changes” to record evidence; leave empty for local only.")
            }
            row {
                comment("API key: Tools → Copal.dev → Set API Key… (stored in the IDE password safe)")
            }
        }
    }
}
