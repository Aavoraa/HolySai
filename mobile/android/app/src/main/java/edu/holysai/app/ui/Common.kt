package edu.holysai.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.ButtonDefaults
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.unit.sp
import edu.holysai.app.ui.theme.Gold
import edu.holysai.app.ui.theme.PrimaryGradient
import edu.holysai.app.ui.theme.TileHues
import edu.holysai.app.ui.theme.cardBorder
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import edu.holysai.app.data.friendly
import edu.holysai.app.ui.theme.Amber
import edu.holysai.app.ui.theme.Danger
import edu.holysai.app.ui.theme.Teal

/** Loads data once (and again on [LoadState.reload]) and exposes loading / error / value. */
class LoadState<T> {
    var value by mutableStateOf<T?>(null)
    var error by mutableStateOf<String?>(null)
    var loading by mutableStateOf(true)
    internal var version by mutableIntStateOf(0)
    fun reload() { version++ }
}

@Composable
fun <T> rememberLoad(vararg keys: Any?, load: suspend () -> T): LoadState<T> {
    val state = remember(*keys) { LoadState<T>() }
    LaunchedEffect(state, state.version) {
        state.loading = true
        state.error = null
        try {
            state.value = load()
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            state.error = e.friendly()
        }
        state.loading = false
    }
    return state
}

/** Renders the right thing for a [LoadState]: spinner, error with retry, or [content]. */
@Composable
fun <T> Loaded(state: LoadState<T>, content: @Composable (T) -> Unit) {
    val v = state.value
    when {
        v != null && state.error == null -> content(v)
        state.error != null -> Message(Icons.Outlined.CloudOff, state.error!!, "Try again") { state.reload() }
        else -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
    }
}

@Composable
fun Message(icon: ImageVector, text: String, action: String? = null, onAction: () -> Unit = {}) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(12.dp))
        Text(text, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (action != null) {
            Spacer(Modifier.height(16.dp))
            OutlinedButton(onClick = onAction) { Text(action) }
        }
    }
}

@Composable
fun Empty(text: String) = Message(Icons.Outlined.Inbox, text)

/** A scrolling screen body with standard padding. */
@Composable
fun ScreenList(content: LazyListScope.() -> Unit) {
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp, 12.dp, 16.dp, 96.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        content = content,
    )
}

@Composable
fun InfoCard(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    trailing: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)? = null,
    body: (@Composable () -> Unit)? = null,
) {
    Card(
        modifier = modifier.fillMaxWidth().let { if (onClick != null) it.clip(CardShape).clickable(onClick = onClick) else it },
        shape = CardShape,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, cardBorder),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (!subtitle.isNullOrBlank()) {
                        Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 2.dp))
                    }
                }
                if (trailing != null) { Spacer(Modifier.size(10.dp)); trailing() }
                else if (onClick != null) Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (body != null) { Spacer(Modifier.height(12.dp)); body() }
        }
    }
}

/** Colour-coded status pill; the colour is picked from common status words. */
@Composable
fun StatusChip(text: String?) {
    if (text.isNullOrBlank()) return
    val t = text.lowercase()
    val color = when {
        listOf("approved", "present", "completed", "open", "active", "inside", "boarded", "paid", "acknowledged", "on track", "marked").any { t.contains(it) } -> Teal
        listOf("rejected", "absent", "overdue", "at risk", "denied", "critical", "cancelled", "not marked", "offline").any { t.contains(it) } -> Danger
        listOf("pending", "submitted", "review", "late", "watch", "developing", "draft", "leave", "scheduled", "expected").any { t.contains(it) } -> Amber
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Surface(color = color.copy(alpha = 0.1f), shape = RoundedCornerShape(50)) {
        Row(Modifier.padding(horizontal = 10.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(6.dp).clip(CircleShape).background(color))
            Spacer(Modifier.size(6.dp))
            Text(text, color = color, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
    }
}

/** Small figure + label tile used in summaries, in the style of the web's metric cards. */
@Composable
fun Stat(label: String, value: String, modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.onSurface) {
    Surface(modifier, color = MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, cardBorder)) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
            // Both lines shrink to fit narrow tiles instead of breaking words or clipping figures.
            BasicText(
                label, maxLines = 1,
                style = MaterialTheme.typography.bodySmall.copy(color = MaterialTheme.colorScheme.onSurfaceVariant),
                autoSize = TextAutoSize.StepBased(minFontSize = 9.sp, maxFontSize = 12.sp),
            )
            Spacer(Modifier.height(2.dp))
            BasicText(
                value, maxLines = 1,
                style = MaterialTheme.typography.titleLarge.copy(letterSpacing = (-0.4).sp, fontWeight = FontWeight.Bold, color = color),
                autoSize = TextAutoSize.StepBased(minFontSize = 12.sp, maxFontSize = 22.sp),
            )
        }
    }
}

@Composable
fun StatRow(vararg stats: Pair<String, String>) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        stats.forEach { (label, value) -> Stat(label, value, Modifier.weight(1f)) }
    }
}

/** Section heading with the short champagne rule used under the web's card titles. */
@Composable
fun SectionTitle(text: String) {
    Column(Modifier.padding(top = 10.dp, bottom = 2.dp)) {
        Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
        Spacer(Modifier.height(5.dp))
        Box(Modifier.width(22.dp).height(2.dp).clip(RoundedCornerShape(2.dp)).background(Gold))
    }
}

/** The single action button: Holy Sai wine gradient, pill-rounded, as on the web. */
@Composable
fun PrimaryButton(text: String, busy: Boolean = false, enabled: Boolean = true, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val active = enabled && !busy
    Button(
        onClick = onClick, enabled = active,
        modifier = modifier.fillMaxWidth().height(52.dp),
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent, disabledContainerColor = Color.Transparent),
        contentPadding = PaddingValues(0.dp),
    ) {
        Box(
            Modifier.fillMaxSize().background(if (active || busy) PrimaryGradient else SolidColor(MaterialTheme.colorScheme.outline)),
            contentAlignment = Alignment.Center,
        ) {
            if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Color.White)
            else Text(text, color = Color.White, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
        }
    }
}

/** A tinted icon tile, rotating through the web dashboard's muted hues. */
@Composable
fun IconTile(icon: ImageVector, index: Int, size: Int = 44) {
    val (tone, tint) = TileHues[index % TileHues.size]
    Box(Modifier.size(size.dp).clip(RoundedCornerShape((size * 0.27f).dp)).background(tint), contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = tone, modifier = Modifier.size((size * 0.5f).dp))
    }
}

private val CardShape = RoundedCornerShape(16.dp)
