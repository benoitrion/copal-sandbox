package dev.copal.jetbrains

import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.configurations.PathEnvironmentVariableUtil
import com.intellij.execution.process.CapturingProcessHandler
import com.intellij.execution.process.ProcessOutput
import com.intellij.openapi.vfs.VirtualFile
import java.io.File

/** Runs the copal CLI — the same engine as pre-commit, PR checks, MCP and VS Code. */
object CopalRunner {
    const val POLICY_FILE = ".copalrules"

    fun resolveCli(workDir: String?): String {
        val configured = CopalSettings.get().state.cliPath.trim()
        if (configured.isNotEmpty()) return configured
        var dir: File? = workDir?.let { File(it) }
        while (dir != null) {
            val local = File(dir, "node_modules/.bin/copal")
            if (local.canExecute()) return local.path
            dir = dir.parentFile
        }
        return PathEnvironmentVariableUtil.findInPath("copal")?.path ?: "copal"
    }

    fun command(workDir: String?, vararg args: String): GeneralCommandLine {
        val s = CopalSettings.get().state
        val cli = resolveCli(workDir)
        val cmd = if (cli.endsWith(".js") || cli.endsWith(".mjs") || cli.endsWith(".cjs")) {
            GeneralCommandLine(s.nodePath, cli)
        } else {
            GeneralCommandLine(cli)
        }
        cmd.addParameters(*args)
        cmd.withParentEnvironmentType(GeneralCommandLine.ParentEnvironmentType.CONSOLE)
        cmd.withCharset(Charsets.UTF_8)
        if (workDir != null) cmd.withWorkDirectory(workDir)
        val env = mutableMapOf("NO_COLOR" to "1", "COPAL_ENV" to s.environment, "COPAL_AGENT" to "jetbrains")
        env["COPAL_SERVER"] = s.serverUrl
        CopalSettings.apiKey?.takeIf { it.isNotBlank() }?.let { env["COPAL_API_KEY"] = it }
        cmd.withEnvironment(env)
        return cmd
    }

    /** Blocking — call from a background thread only. */
    fun run(cmd: GeneralCommandLine, stdin: String? = null, timeoutMs: Int = 20_000): ProcessOutput {
        val handler = CapturingProcessHandler(cmd)
        if (stdin != null) {
            handler.processInput.use { it.write(stdin.toByteArray(Charsets.UTF_8)) }
        }
        return handler.runProcess(timeoutMs)
    }

    /** Nearest directory (from the file upwards) that contains `.copalrules`. */
    fun findPolicyDir(file: VirtualFile): VirtualFile? {
        var dir = file.parent
        while (dir != null) {
            if (dir.findChild(POLICY_FILE) != null) return dir
            dir = dir.parent
        }
        return null
    }
}
