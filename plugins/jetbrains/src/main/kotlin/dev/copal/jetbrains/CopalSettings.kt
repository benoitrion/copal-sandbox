package dev.copal.jetbrains

import com.intellij.credentialStore.CredentialAttributes
import com.intellij.credentialStore.generateServiceName
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.service

@Service(Service.Level.APP)
@State(name = "CopalSettings", storages = [Storage("copal.xml")])
class CopalSettings : PersistentStateComponent<CopalSettings.Options> {

    data class Options(
        /** Node.js executable used when the CLI path is a .js file. */
        var nodePath: String = "node",
        /** Path to the copal CLI (binary or dist/src/index.js). Empty = auto-detect. */
        var cliPath: String = "",
        /** Copal server (mock backend by default). Used by "Check staged changes" to record evidence. */
        var serverUrl: String = "http://localhost:4010",
        var environment: String = "local",
        var enabled: Boolean = true,
    )

    private var options = Options()

    override fun getState(): Options = options

    override fun loadState(state: Options) {
        options = state
    }

    companion object {
        private val apiKeyAttributes = CredentialAttributes(generateServiceName("Copal.dev", "apiKey"))

        fun get(): CopalSettings = service()

        /** Stored in the IDE password safe, never in copal.xml. Call off the EDT. */
        var apiKey: String?
            get() = PasswordSafe.instance.getPassword(apiKeyAttributes)
            set(value) = PasswordSafe.instance.setPassword(apiKeyAttributes, value)
    }
}
