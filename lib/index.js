import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { WebError } from "@deepseek-ai/dsh-web";
//#region lib/types/provider.js
/**
 * Tavily search through the direct Tavily Search API. Unlike the DeepSeek
 * provider — which shells out to an Anthropic-compatible Messages model call
 * with the native `web_search_20250305` server tool and therefore costs model
 * tokens per search — this provider calls Tavily's search endpoint directly.
 * No model is involved, so searches cost no LLM tokens (only Tavily API
 * credits, which include a free tier).
 *
 * @module dsh-tavily-search/provider
 */
/** Stable id this provider registers under. */
const TAVILY_PROVIDER_ID = "tavily-official";
/** Default Tavily Search API endpoint. */
const TAVILY_DEFAULT_BASE_URL = "https://api.tavily.com";
/** Default search depth: `basic` is cheaper and faster than `advanced`. */
const TAVILY_DEFAULT_SEARCH_DEPTH = "basic";
/** Default include_answer: whether Tavily should generate a natural-language answer. */
const TAVILY_DEFAULT_INCLUDE_ANSWER = true;
/** Attribution header sent on every request. */
const USER_AGENT = "deepseek-harness-tavily/0.1.0";

/**
 * Normalize a Tavily `/search` response into the web seam's result shape.
 * Tavily returns `results[]` with `title`, `url`, `content` (snippet), and an
 * optional `published_date`; the top-level `answer` becomes the optional
 * provider-generated answer. The seam owns the final `maxResults` truncation,
 * so `truncated` is always `false` here.
 *
 * @param data - the parsed Tavily response body.
 * @returns the normalized search result.
 */
function mapTavilyResponse(data) {
	const rawResults = Array.isArray(data?.results) ? data.results : [];
	const sources = [];
	const seen = /* @__PURE__ */ new Set();
	for (const item of rawResults) {
		if (typeof item?.url !== "string" || item.url.length === 0) continue;
		if (seen.has(item.url)) continue;
		seen.add(item.url);
		const source = { url: item.url };
		if (typeof item.title === "string" && item.title.length > 0) source.title = item.title;
		if (typeof item.content === "string" && item.content.length > 0) source.snippet = item.content;
		if (typeof item.published_date === "string" && item.published_date.length > 0) source.publishedAt = item.published_date;
		sources.push(source);
	}
	return {
		...typeof data?.answer === "string" && data.answer.length > 0 ? { content: data.answer } : {},
		sources,
		truncated: false
	};
}

/** The Tavily-backed search provider. */
class TavilySearchProvider {
	resolveOptions;
	id = TAVILY_PROVIDER_ID;
	/**
	 * @param resolveOptions - the options for the NEXT operation, snapshotted
	 * once at each operation's entry so one search never mixes two settings
	 * revisions.
	 */
	constructor(resolveOptions) {
		this.resolveOptions = resolveOptions;
	}
	available() {
		const options = this.resolveOptions();
		return (options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== void 0;
	}
	async search(request, signal) {
		const options = this.resolveOptions();
		const apiKey = await this.apiKey(options, signal);
		throwIfSearchAborted(signal);
		const endpoint = `${options.baseURL.replace(/\/+$/u, "")}/search`;
		const body = {
			query: request.query,
			max_results: request.maxResults ?? 5,
			search_depth: options.searchDepth,
			include_answer: options.includeAnswer
		};
		let response;
		try {
			response = await fetch(endpoint, {
				method: "POST",
				redirect: "error",
				headers: {
					"authorization": `Bearer ${apiKey}`,
					"content-type": "application/json",
					"accept": "application/json",
					"user-agent": USER_AGENT
				},
				body: JSON.stringify(body),
				...signal !== void 0 ? { signal } : {}
			});
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			throw new WebError(`Tavily search request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (!response.ok) {
			let message = `Tavily API error (HTTP ${response.status})`;
			try {
				const parsed = await response.json();
				const detail = typeof parsed?.error === "string" ? parsed.error : parsed?.message;
				if (typeof detail === "string" && detail.length > 0) message = detail;
			} catch (error) {
				if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			}
			throw new WebError(message, "WEB_PROVIDER_ERROR");
		}
		try {
			return mapTavilyResponse(await response.json());
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			if (error instanceof WebError) throw error;
			throw new WebError(`Tavily returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
	}
	/**
	 * Resolve one operation's credential without retaining it on the provider.
	 * @param options - the caller's snapshot.
	 * @param signal - abort signal for the surrounding search.
	 * @returns the resolved key.
	 */
	async apiKey(options, signal) {
		throwIfSearchAborted(signal);
		if (options.apiKey !== void 0 && options.apiKey.length > 0) return options.apiKey;
		let resolved;
		try {
			resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(void 0), signal);
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			throw new WebError(`Tavily credential resolution failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (resolved !== void 0 && resolved.length > 0) return resolved;
		throw new WebError(`Tavily search has no API key for "${options.apiKeyEnv ?? "TAVILY_API_KEY"}"; store it through the credentials service, export it in the launching environment, or set a literal "apiKey" in the web-search-tavily config`, "WEB_PROVIDER_CREDENTIAL_MISSING");
	}
}
/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal) {
	if (signal?.aborted === true) throw searchAborted(signal);
}
/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(signal, fallback) {
	return new WebError("Tavily search aborted", "WEB_ABORTED", { cause: signal?.aborted === true ? signal.reason : fallback });
}
/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error) {
	return error instanceof DOMException && error.name === "AbortError";
}
/**
 * Race a same-process asynchronous preflight against caller cancellation. The
 * attached settlement handlers keep observing an uncooperative operation after
 * abort so a later rejection cannot become unhandled.
 */
function abortable(operation, signal) {
	if (signal === void 0) return operation;
	if (signal.aborted) return Promise.reject(searchAborted(signal));
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			reject(searchAborted(signal));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		operation.then((value) => {
			signal.removeEventListener("abort", onAbort);
			resolve(value);
		}, (error) => {
			signal.removeEventListener("abort", onAbort);
			reject(new Error(String(error).replace(/^Error: /u, ""), { cause: error }));
		});
	});
}
//#endregion
//#region lib/types/index.js
/**
 * Register a Tavily-backed provider in `ctx.web`. It calls the Tavily Search
 * API directly — no LLM tokens are consumed. The provider reuses the
 * `TAVILY_API_KEY` credential reference by default, configurable via
 * `apiKeyEnv` or a literal `apiKey`.
 * @module dsh-tavily-search
 */
/** Cordis plugin name used by loader diagnostics. */
const name = "web-search-tavily";
/** The web seam this provider registers into. */
const inject = ["web"];
const DEFAULT_API_KEY_ENV = "TAVILY_API_KEY";
const Config = z.object({
	apiKey: z.string().role("secret"),
	apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
	baseURL: z.string(),
	searchDepth: z.string().default(TAVILY_DEFAULT_SEARCH_DEPTH),
	includeAnswer: z.boolean().default(TAVILY_DEFAULT_INCLUDE_ANSWER)
});
/** Environment variable naming this provider's endpoint. */
const SEARCH_BASE_URL_ENV = "TAVILY_SEARCH_BASE_URL";
/** Settings namespace carrying this provider's endpoint and key reference. */
const WEB_SEARCH_TAVILY_SETTINGS_NAMESPACE = settingsNamespace("web-search-tavily");
/**
 * Project one resolved section into the options the provider serves its next
 * search with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns options for one search.
 */
function resolveOptions(ctx, config) {
	const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
	const literalApiKey = config.apiKey !== void 0 && config.apiKey.length > 0 ? config.apiKey : void 0;
	return {
		...literalApiKey === void 0 ? {} : { apiKey: literalApiKey },
		resolveApiKey: async () => {
			const credentials = ctx.get("credentials");
			if (credentials !== void 0) return (await credentials.resolve(apiKeyEnv))?.value;
			const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv);
			return ambient !== void 0 && ambient.value.length > 0 ? ambient.value : void 0;
		},
		apiKeyEnv,
		baseURL: config.baseURL ?? launchEnvironmentOf(ctx).get(SEARCH_BASE_URL_ENV)?.value ?? TAVILY_DEFAULT_BASE_URL,
		searchDepth: config.searchDepth ?? TAVILY_DEFAULT_SEARCH_DEPTH,
		includeAnswer: config.includeAnswer ?? TAVILY_DEFAULT_INCLUDE_ANSWER
	};
}
/** Register the Tavily search provider with `ctx.web`. */
function apply(ctx, config) {
	let current = () => config;
	installSettingsSection(ctx, WEB_SEARCH_TAVILY_SETTINGS_NAMESPACE, Config, config, {
		setSource: (source) => {
			current = source;
		},
		onChange: () => {}
	});
	ctx.web.registerSearchProvider(new TavilySearchProvider(() => resolveOptions(ctx, current())));
}
//#endregion
export { Config, TAVILY_DEFAULT_BASE_URL, TAVILY_DEFAULT_INCLUDE_ANSWER, TAVILY_DEFAULT_SEARCH_DEPTH, TAVILY_PROVIDER_ID, TavilySearchProvider, WEB_SEARCH_TAVILY_SETTINGS_NAMESPACE, apply, inject, mapTavilyResponse, name, resolveOptions };
