package dev.copal.jetbrains

import com.intellij.notification.NotificationAction
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import java.util.concurrent.ConcurrentHashMap

object CopalNotifier {
    private const val GROUP = "Copal.dev"
    private val shown = ConcurrentHashMap.newKeySet<String>()

    fun notify(project: Project?, content: String, type: NotificationType = NotificationType.INFORMATION, details: String? = null) {
        val n = NotificationGroupManager.getInstance().getNotificationGroup(GROUP).createNotification(content, type)
        if (!details.isNullOrBlank()) {
            n.addAction(NotificationAction.createSimple("Show output") {
                Messages.showInfoMessage(project, details, "Copal.dev")
            })
        }
        n.notify(project)
    }

    /** Avoids spamming the same configuration error on every re-highlight. */
    fun warnOnce(project: Project?, content: String) {
        if (shown.add(content)) notify(project, content, NotificationType.WARNING)
    }
}
