/**
 * token-rate: shows how fast the model generates text, in Pi's footer.
 *
 * After each response the footer shows something like:
 *   ⚡ 38.2 tok/s · 412 tok · first token 1.4s · avg 36.9 tok/s
 * While a response is streaming it shows a live estimate, marked with "~".
 *
 * Commands:
 *   /tokrate         show the stats for this session
 *   /tokrate reset   reset the session stats
 *
 * Stats reset automatically when you switch model or start a new session.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "token-rate";
const LIVE_UPDATE_MS = 250; // how often the live estimate refreshes
const CHARS_PER_TOKEN = 4; // rough estimate, used only when the provider reports no token count

export default function tokenRate(pi: ExtensionAPI) {
	// Timing for the response currently being generated
	let requestSentAt = 0;
	let firstTokenAt = 0;
	let streamedChars = 0;
	let lastLiveUpdate = 0;

	// Totals for the session (generation time only, excluding waiting for the first token)
	let sessionTokens = 0;
	let sessionSeconds = 0;
	let responseCount = 0;
	let lastSummary = "";

	function setStatus(ctx: ExtensionContext, text: string | undefined) {
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, text);
	}

	function sessionAverage(): number | undefined {
		return sessionSeconds > 0 ? sessionTokens / sessionSeconds : undefined;
	}

	function resetSession(ctx: ExtensionContext) {
		sessionTokens = 0;
		sessionSeconds = 0;
		responseCount = 0;
		lastSummary = "";
		setStatus(ctx, undefined);
	}

	// Fires right before each request goes to the model: start the clock.
	pi.on("before_provider_request", (_event, _ctx) => {
		requestSentAt = Date.now();
		firstTokenAt = 0;
		streamedChars = 0;
		lastLiveUpdate = 0;
	});

	// Fires for every streamed piece of the response: note the first token, show a live estimate.
	pi.on("message_update", (event, ctx) => {
		const streamEvent = event.assistantMessageEvent as { delta?: unknown };
		if (typeof streamEvent.delta !== "string" || streamEvent.delta.length === 0) return;

		const now = Date.now();
		if (!firstTokenAt) firstTokenAt = now;
		streamedChars += streamEvent.delta.length;

		if (now - lastLiveUpdate < LIVE_UPDATE_MS) return;
		lastLiveUpdate = now;

		const seconds = (now - firstTokenAt) / 1000;
		if (seconds < 0.5) return; // too early for a meaningful number
		const rate = streamedChars / CHARS_PER_TOKEN / seconds;
		setStatus(ctx, `⚡ ~${rate.toFixed(1)} tok/s`);
	});

	// Fires when a message is complete: compute the final numbers from the real token count.
	pi.on("message_end", (event, ctx) => {
		const message = event.message;
		if (message.role !== "assistant") return;

		const end = Date.now();
		const reported = message.usage?.output ?? 0;
		const estimated = reported <= 0;
		const tokens = estimated ? Math.round(streamedChars / CHARS_PER_TOKEN) : reported;
		const genStart = firstTokenAt || requestSentAt;
		if (!genStart || tokens <= 0) return;

		const seconds = (end - genStart) / 1000;
		if (seconds < 0.05) return;

		const rate = tokens / seconds;
		sessionTokens += tokens;
		sessionSeconds += seconds;
		responseCount += 1;

		const parts = [`⚡ ${estimated ? "~" : ""}${rate.toFixed(1)} tok/s`, `${tokens} tok`];
		if (firstTokenAt && requestSentAt) {
			parts.push(`first token ${((firstTokenAt - requestSentAt) / 1000).toFixed(1)}s`);
		}
		const avg = sessionAverage();
		if (avg !== undefined && responseCount > 1) parts.push(`avg ${avg.toFixed(1)} tok/s`);

		lastSummary = parts.join(" · ");
		setStatus(ctx, lastSummary);
	});

	// New model or new session: start fresh so numbers aren't mixed between models.
	pi.on("model_select", (_event, ctx) => resetSession(ctx));
	pi.on("session_start", (_event, ctx) => resetSession(ctx));
	pi.on("session_shutdown", (_event, ctx) => setStatus(ctx, undefined));

	pi.registerCommand("tokrate", {
		description: "Show token rate stats (use '/tokrate reset' to reset)",
		handler: async (args, ctx) => {
			if (args.trim() === "reset") {
				resetSession(ctx);
				ctx.ui.notify("Token rate stats reset", "info");
				return;
			}
			const avg = sessionAverage();
			if (avg === undefined) {
				ctx.ui.notify("No responses measured yet in this session", "info");
				return;
			}
			const model = ctx.model ? `${ctx.model.id}: ` : "";
			ctx.ui.notify(
				`${model}${avg.toFixed(1)} tok/s average over ${responseCount} responses ` +
					`(${sessionTokens} tokens in ${sessionSeconds.toFixed(1)}s of generation)`,
				"info",
			);
		},
	});
}