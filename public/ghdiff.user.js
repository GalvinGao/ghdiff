// ==UserScript==
// @name         ghdiff
// @namespace    https://ghdiff.com/
// @version      1.3.0
// @description  Adds a ghdiff button to the tab row of every GitHub pull request, and beside Browse files on every commit.
// @author       GalvinGao
// @homepageURL  https://github.com/GalvinGao/ghdiff
// @supportURL   https://github.com/GalvinGao/ghdiff/issues
// @downloadURL  https://ghdiff.com/ghdiff.user.js
// @updateURL    https://ghdiff.com/ghdiff.user.js
// @match        https://github.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

// Generated from src/userscript.js and messages/en.json.
(function() {
	//#region src/lib/matchLocale.ts
	/** Match regional browser tags without substituting a different writing system. */
	function matchLocale(requested, available) {
		try {
			const wanted = new Intl.Locale(requested).maximize();
			return available.find((locale) => new Intl.Locale(locale).baseName === new Intl.Locale(requested).baseName) ?? available.find((locale) => {
				const candidate = new Intl.Locale(locale).maximize();
				return candidate.language === wanted.language && candidate.script === wanted.script;
			});
		} catch {
			return;
		}
	}
	//#endregion
	//#region src/paraglide/runtime.js
	/** @type {any} */
	var URLPattern = {};
	/**
	* The project's locales that have been specified in the settings.
	*
	* @example
	*   if (locales.includes(userSelectedLocale) === false) {
	*     throw new Error('Locale is not available');
	*   }
	*/
	var locales = [
		"en",
		"zh-Hans",
		"es",
		"fr",
		"de",
		"ja",
		"ko",
		"pt-BR",
		"ru",
		"hi",
		"ar",
		"id",
		"vi",
		"tr",
		"pl",
		"it",
		"uk",
		"nl",
		"fa",
		"bn"
	];
	/** @type {string} */
	var cookieName = "PARAGLIDE_LOCALE";
	/** @type {number} */
	var cookieMaxAge = 3456e4;
	/**
	* @type {Array<"cookie" | "baseLocale" | "globalVariable" | "url" | "preferredLanguage" | "localStorage" | `custom-${string}`>}
	*/
	var strategy = ["cookie", "baseLocale"];
	/**
	* Route-level strategy overrides.
	*
	* `match` uses URLPattern syntax.
	*
	* @type {Array<{
	*   match: string;
	*   strategy?: Array<"cookie" | "baseLocale" | "globalVariable" | "url" | "preferredLanguage" | "localStorage" | `custom-${string}`>;
	*   exclude?: boolean;
	* }>}
	*/
	var routeStrategies = [];
	/**
	* @typedef {{
	* 		getStore(): {
	*   		locale?: Locale,
	* 			origin?: string,
	* 			messageCalls?: Set<string>
	*   	} | undefined,
	* 		run: (store: { locale?: Locale, origin?: string, messageCalls?: Set<string>},
	*    cb: any) => any
	* }} ParaglideAsyncLocalStorage
	*/
	/**
	* Server side async local storage that is set by `serverMiddleware()`.
	*
	* The variable is used to retrieve the locale and origin in a server-side
	* rendering context without effecting other requests.
	*
	* @type {ParaglideAsyncLocalStorage | undefined}
	*/
	var serverAsyncLocalStorage = void 0;
	var isServer = typeof window === "undefined";
	/** @type {any} */ globalThis.__paraglide = globalThis.__paraglide ?? {};
	/** @type {any} */ globalThis.__paraglide.ssr = globalThis.__paraglide.ssr ?? {};
	var localeInitiallySet = false;
	/**
	* Get the current locale.
	*
	* The locale is resolved using your configured strategies (URL, cookie, localStorage, etc.)
	* in the order they are defined. In SSR contexts, the locale is retrieved from AsyncLocalStorage
	* which is set by the `paraglideMiddleware()`.
	*
	* @see https://paraglidejs.com/strategy - Configure locale detection strategies
	*
	* @example
	*   if (getLocale() === 'de') {
	*     console.log('Germany 🇩🇪');
	*   } else if (getLocale() === 'nl') {
	*     console.log('Netherlands 🇳🇱');
	*   }
	*
	* @returns {Locale} The current locale.
	*/
	var getLocale = () => {
		if (serverAsyncLocalStorage) {
			const locale = serverAsyncLocalStorage?.getStore()?.locale;
			if (locale) return locale;
		}
		let strategyToUse = strategy;
		if (!isServer && typeof window !== "undefined" && window.location?.href) strategyToUse = getStrategyForUrl(window.location.href);
		const resolved = resolveLocaleWithStrategies(strategyToUse, typeof window !== "undefined" ? window.location?.href : void 0);
		if (resolved) {
			if (!localeInitiallySet) {
				localeInitiallySet = true;
				setLocale(resolved, { reload: false });
			}
			return resolved;
		}
		throw new Error("No locale found. Read the docs https://paraglidejs.com/errors#no-locale-found");
	};
	/**
	* @param {typeof strategy} strategyToUse
	* @param {string | undefined} urlForUrlStrategy
	* @returns {Locale | undefined}
	*/
	function resolveLocaleWithStrategies(strategyToUse, urlForUrlStrategy) {
		/** @type {string | undefined} */
		let locale;
		for (const strat of strategyToUse) {
			if (strat === "cookie") locale = extractLocaleFromCookie();
			else if (strat === "baseLocale") locale = "en";
			else if (isCustomStrategy(strat) && customClientStrategies.has(strat)) {
				const handler = customClientStrategies.get(strat);
				if (handler) {
					const result = handler.getLocale();
					if (result instanceof Promise) continue;
					if (result !== void 0) return assertIsLocale(result);
				}
			}
			const matchedLocale = toLocale(locale);
			if (matchedLocale) return matchedLocale;
		}
	}
	/**
	* Navigates to the localized URL, or reloads the current page
	*
	* @param {string} [newLocation] The new location
	*/
	var navigateOrReload = (newLocation) => {
		if (newLocation) window.location.href = newLocation;
		else window.location.reload();
	};
	/**
	* @typedef {(newLocale: Locale, options?: { reload?: boolean }) => void | Promise<void>} SetLocaleFn
	*/
	/**
	* Set the locale.
	*
	* Updates the locale using your configured strategies (cookie, localStorage, URL, etc.).
	* By default, this navigates the client to the localized URL or reloads the current
	* document to reflect the new locale. `reload: false` is a narrow browser-only escape
	* hatch for a fully client-rendered, non-URL-routed surface that owns its reactive
	* updates and document state. It does not re-render the UI or update the document.
	* Do not use it for normal locale pickers, URL-routed pages, or switching an SSR,
	* SSG, or hydrated document. It is incompatible with per-locale builds.
	*
	* If any custom strategy's `setLocale` function is async, then this function
	* will become async as well.
	*
	* @see https://paraglidejs.com/strategy
	*
	* @example
	*   setLocale('en');
	*
	* @example
	*   setLocale('en', { reload: false });
	*
	* @type {SetLocaleFn}
	*/
	var setLocale = (newLocale, options) => {
		const optionsWithDefaults = {
			reload: true,
			...options
		};
		/** @type {Locale | undefined} */
		let currentLocale;
		try {
			currentLocale = getLocale();
		} catch {}
		/** @type {Array<Promise<void>>} */
		const customSetLocalePromises = [];
		/** @type {string | undefined} */
		let newLocation = void 0;
		let strategyToUse = strategy;
		if (!isServer && typeof window !== "undefined" && window.location?.href) strategyToUse = getStrategyForUrl(window.location.href);
		for (const strat of strategyToUse) if (strat === "cookie") {
			if (isServer || typeof document === "undefined" || typeof window === "undefined") continue;
			const cookieString = `${cookieName}=${newLocale}; path=/; max-age=${cookieMaxAge}`;
			document.cookie = cookieString;
			clearLocaleCookieCache();
		} else if (strat === "baseLocale") continue;
		else if (isCustomStrategy(strat) && customClientStrategies.has(strat)) {
			const handler = customClientStrategies.get(strat);
			if (handler) {
				let result = handler.setLocale(newLocale);
				if (result instanceof Promise) {
					result = result.catch((error) => {
						throw new Error(`Custom strategy "${strat}" setLocale failed.`, { cause: error });
					});
					customSetLocalePromises.push(result);
				}
			}
		}
		const runReload = () => {
			if (!isServer && optionsWithDefaults.reload && window.location && newLocale !== currentLocale) navigateOrReload(newLocation);
		};
		if (customSetLocalePromises.length) return Promise.all(customSetLocalePromises).then(() => {
			runReload();
		});
		runReload();
	};
	/**
	* The origin of the current URL.
	*
	* Defaults to "http://example.com" in non-browser environments. If this
	* behavior is not desired, the implementation can be overwritten
	* by `overwriteGetUrlOrigin()`.
	*
	* @type {() => string}
	*/
	var getUrlOrigin = () => {
		if (serverAsyncLocalStorage) return serverAsyncLocalStorage.getStore()?.origin ?? "http://fallback.com";
		else if (typeof window !== "undefined") return window.location.origin;
		return "http://fallback.com";
	};
	/**
	* Coerces a locale-like string to the canonical locale value used by the runtime.
	*
	* @param {unknown} value
	* @returns {Locale | undefined}
	*/
	function toLocale(value) {
		if (typeof value !== "string") return;
		const lowerValue = value.toLowerCase();
		for (const locale of locales) if (locale.toLowerCase() === lowerValue) return locale;
	}
	/**
	* Asserts that the input can be normalized to a locale.
	*
	* @param {unknown} input - The input to check.
	* @returns {Locale} The input normalized to a Locale.
	* @throws {Error} If the input is not a locale.
	*/
	function assertIsLocale(input) {
		const locale = toLocale(input);
		if (locale) return locale;
		throw new Error(`Invalid locale: ${input}. Expected one of: ${locales.join(", ")}`);
	}
	/**
	* Applies the configured trailing slash policy to a URL.
	*
	* The root pathname always remains `/`. Query parameters and hashes are not
	* modified.
	*
	* @param {URL} url
	* @returns {URL}
	*/
	function normalizeTrailingSlash(url) {
		return url;
	}
	/**
	* Matches a canonical URL while allowing configured patterns to retain their
	* existing trailing slash style.
	*
	* @param {URLPattern} pattern
	* @param {URL} url
	* @returns {any}
	*/
	function execUrlPattern(pattern, url) {
		return pattern.exec(url.href);
	}
	var cookieNamePattern = cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	var localeCookiePattern = new RegExp(`(?:^|;\\s*)${cookieNamePattern}=([^;]*)`);
	var noCachedLocale = Symbol();
	/** @type {Locale | undefined | typeof noCachedLocale} */
	var cachedLocaleFromCookie = noCachedLocale;
	/**
	* Clears the cached locale from `document.cookie`.
	*/
	function clearLocaleCookieCache() {
		cachedLocaleFromCookie = noCachedLocale;
	}
	function scheduleLocaleCookieCacheClear() {
		if (typeof queueMicrotask === "function") queueMicrotask(clearLocaleCookieCache);
		else Promise.resolve().then(clearLocaleCookieCache);
	}
	/**
	* Extracts a cookie from the document.
	*
	* Will return undefined if the document is not available or if the cookie is not set.
	* The `document` object is not available in server-side rendering, so this function should not be called in that context.
	*
	* @returns {Locale | undefined}
	*/
	function extractLocaleFromCookie() {
		if (typeof document === "undefined") return;
		if (cachedLocaleFromCookie !== noCachedLocale) return cachedLocaleFromCookie;
		const locale = document.cookie.match(localeCookiePattern)?.[1];
		cachedLocaleFromCookie = toLocale(locale);
		scheduleLocaleCookieCacheClear();
		return cachedLocaleFromCookie;
	}
	/**
	* Low-level URL de-localization function, primarily used in server contexts.
	*
	* This function is designed for server-side usage where you need precise control
	* over URL de-localization, such as in middleware or request handlers. It works with
	* URL objects and always returns absolute URLs.
	*
	* For client-side UI components, use `deLocalizeHref()` instead, which provides
	* a more convenient API with relative paths.
	*
	* @see https://paraglidejs.com/i18n-routing
	*
	* @example
	* ```typescript
	* // Server middleware example
	* app.use((req, res, next) => {
	*   const url = new URL(req.url, `${req.protocol}://${req.headers.host}`);
	*   const baseUrl = deLocalizeUrl(url);
	*
	*   // Store the base URL for later use
	*   req.baseUrl = baseUrl;
	*   next();
	* });
	* ```
	*
	* @example
	* ```typescript
	* // Using with URL patterns
	* const url = new URL("https://example.com/de/about");
	* deLocalizeUrl(url); // => URL("https://example.com/about")
	*
	* // Using with domain-based localization
	* const url = new URL("https://de.example.com/store");
	* deLocalizeUrl(url); // => URL("https://example.com/store")
	* ```
	*
	* @param {string | URL} url - The URL to de-localize. If string, must be absolute.
	* @returns {URL} The de-localized URL, always absolute
	*/
	function deLocalizeUrl(url) {
		return deLocalizeUrlDefaultPattern(url);
	}
	/**
	* De-localizes a URL using the default pattern (/:locale/*)
	* @param {string|URL} url
	* @returns {URL}
	*/
	function deLocalizeUrlDefaultPattern(url) {
		const urlObj = normalizeTrailingSlash(typeof url === "string" ? new URL(url, getUrlOrigin()) : new URL(url));
		const pathSegments = urlObj.pathname.split("/").filter(Boolean);
		if (pathSegments.length > 0 && toLocale(pathSegments[0])) urlObj.pathname = "/" + pathSegments.slice(1).join("/");
		return normalizeTrailingSlash(urlObj);
	}
	/** @type {string | undefined} */
	var cachedRouteStrategyUrl;
	/** @type {{ match: string; strategy?: typeof strategy; exclude?: boolean } | undefined} */
	var cachedRouteStrategy;
	/**
	* Match route policy against both the public URL and its canonical URL.
	*
	* The function is deliberately separate from variables.js: configuration is
	* inert data, while canonicalization and route selection form a routing layer.
	*
	* @param {string | URL} url
	* @returns {{ match: string; strategy?: typeof strategy; exclude?: boolean } | undefined}
	*/
	function findMatchingRouteStrategy(url) {
		if (routeStrategies.length === 0) return;
		const urlString = typeof url === "string" ? url : url.href;
		if (cachedRouteStrategyUrl === urlString) return cachedRouteStrategy;
		const publicUrl = normalizeTrailingSlash(new URL(urlString, "http://example.com"));
		const canonicalUrl = deLocalizeUrl(publicUrl);
		const candidateUrls = canonicalUrl.href === publicUrl.href ? [publicUrl] : [publicUrl, canonicalUrl];
		let match;
		for (const candidateUrl of candidateUrls) {
			for (const routeStrategy of routeStrategies) if (execUrlPattern(new URLPattern(routeStrategy.match, candidateUrl.href), candidateUrl)) {
				match = routeStrategy;
				break;
			}
			if (match) break;
		}
		cachedRouteStrategyUrl = urlString;
		cachedRouteStrategy = match;
		return match;
	}
	/**
	* Returns the strategy to use for a specific URL.
	*
	* If no route strategy matches (or the matching rule is `exclude: true`),
	* the global strategy is returned.
	*
	* @param {string | URL} url
	* @returns {typeof strategy}
	*/
	function getStrategyForUrl(url) {
		const routeStrategy = findMatchingRouteStrategy(url);
		if (routeStrategy && routeStrategy.exclude !== true && Array.isArray(routeStrategy.strategy)) return routeStrategy.strategy;
		return strategy;
	}
	/** @type {Map<string, CustomClientStrategyHandler>} */
	var customClientStrategies = /* @__PURE__ */ new Map();
	/**
	* Checks if the given strategy is a custom strategy.
	*
	* @param {unknown} strategy The name of the custom strategy to validate.
	* Must be a string that starts with "custom-" followed by alphanumeric characters, hyphens, or underscores.
	* @returns {boolean} Returns true if it is a custom strategy, false otherwise.
	*/
	function isCustomStrategy(strategy) {
		return typeof strategy === "string" && /^custom-[A-Za-z0-9_-]+$/.test(strategy);
	}
	/**
	* A locale that is available in the project.
	*
	* @example
	*   setLocale(request.locale as Locale)
	*
	* @typedef {typeof locales[number]} Locale
	*/
	/**
	* A branded type representing a localized string.
	*
	* Message functions return this type instead of \`string\`, enabling TypeScript
	* to distinguish translated strings from regular strings at compile time.
	* This allows you to enforce that only properly localized content is used
	* in your UI components.
	*
	* Since \`LocalizedString\` is a branded subtype of \`string\`, it remains fully
	* backward compatible—you can pass it anywhere a \`string\` is expected.
	*
	* @example
	*   // Enforce localized strings in your components
	*   function PageTitle(props: { title: LocalizedString }) {
	*     return <h1>{props.title}</h1>
	*   }
	*
	*   // ✅ Correct: using a message function
	*   <PageTitle title={m.welcome_title()} />
	*
	*   // ❌ Type error: raw strings are not LocalizedString
	*   <PageTitle title="Welcome" />
	*
	* @example
	*   // LocalizedString is assignable to string (backward compatible)
	*   const localized: LocalizedString = m.greeting()
	*   const str: string = localized  // ✅ works fine
	*
	*   // But string is not assignable to LocalizedString
	*   const raw: LocalizedString = "Hello"  // ❌ Type error
	*
	* @example
	*   // Catches accidental string concatenation
	*   function showMessage(msg: LocalizedString) { ... }
	*
	*   showMessage(m.hello())                    // ✅
	*   showMessage("Hello " + userName)          // ❌ Type error
	*   showMessage(m.hello_user({ name: userName }))  // ✅ use params instead
	*
	* @typedef {string & { readonly __brand: 'LocalizedString' }} LocalizedString
	*/
	/**
	* A single markup option passed to a tag instance.
	*
	* @typedef {{
	*   name: string;
	*   value: unknown;
	* }} MessageMarkupOption
	*/
	/**
	* A single static markup attribute attached to a tag instance.
	*
	* @typedef {{
	*   name: string;
	*   value: string | true;
	* }} MessageMarkupAttribute
	*/
	/**
	* Record of markup options for a tag instance.
	*
	* @typedef {Record<string, unknown>} MessageMarkupOptions
	*/
	/**
	* Record of markup attributes for a tag instance.
	*
	* @typedef {Record<string, string | true>} MessageMarkupAttributes
	*/
	/**
	* Type-level schema for a single markup tag.
	*
	* @typedef {{
	*   options: MessageMarkupOptions;
	*   attributes: MessageMarkupAttributes;
	*   children: boolean;
	* }} MessageMarkupTag
	*/
	/**
	* Type-level schema for all markup tags in a message.
	*
	* @typedef {Record<string, MessageMarkupTag>} MessageMarkupSchema
	*/
	/**
	* Type-only metadata attached to compiled message functions.
	*
	* @template Inputs
	* @template Options
	* @template {MessageMarkupSchema} [Markup = MessageMarkupSchema]
	* @typedef {{
	*   readonly __paraglide?: {
	*     inputs: Inputs;
	*     options: Options;
	*     markup: Markup;
	*   };
	* }} MessageMetadata
	*/
	/**
	* A compiled, framework-neutral message part.
	*
	* @typedef {{
	*   type: "text";
	*   value: string;
	* } | {
	*   type: "markup-start";
	*   name: string;
	*   options: MessageMarkupOptions;
	*   attributes: MessageMarkupAttributes;
	* } | {
	*   type: "markup-end";
	*   name: string;
	*   options: MessageMarkupOptions;
	*   attributes: MessageMarkupAttributes;
	* } | {
	*   type: "markup-standalone";
	*   name: string;
	*   options: MessageMarkupOptions;
	*   attributes: MessageMarkupAttributes;
	* }} MessagePart
	*/
	/**
	* A message function is a message for a specific locale.
	*
	* @example
	*   m.hello({ name: 'world' })
	*
	* @typedef {(inputs?: Record<string, never>) => LocalizedString} MessageFunction
	*/
	/**
	* A message bundle function that selects the message to be returned.
	*
	* Uses `getLocale()` under the hood to determine the locale with an option.
	*
	* @template {string} T
	*
	* @example
	*   *   m.hello({ name: 'world' }, { locale: "en" })
	*
	* @typedef {(params: Record<string, never>, options: { locale: T }) => LocalizedString} MessageBundleFunction
	*/
	//#endregion
	//#region src/paraglide/messages/userscript_open_commit.js
	/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
	/** @typedef {{}} Userscript_Open_CommitInputs */
	var en_userscript_open_commit = () => {
		return `Open this commit in ghdiff`;
	};
	var zh_hans1_userscript_open_commit = () => {
		return `在 ghdiff 中打开此提交`;
	};
	var es_userscript_open_commit = () => {
		return `Abrir este commit en ghdiff`;
	};
	var fr_userscript_open_commit = () => {
		return `Ouvrir ce commit dans ghdiff`;
	};
	var de_userscript_open_commit = () => {
		return `Diesen Commit in ghdiff öffnen`;
	};
	var ja_userscript_open_commit = () => {
		return `このコミットを ghdiff で開く`;
	};
	var ko_userscript_open_commit = () => {
		return `ghdiff에서 이 커밋 열기`;
	};
	var pt_br2_userscript_open_commit = () => {
		return `Abrir este commit no ghdiff`;
	};
	var ru_userscript_open_commit = () => {
		return `Открыть этот коммит в ghdiff`;
	};
	var hi_userscript_open_commit = () => {
		return `इस कमिट को ghdiff में खोलें`;
	};
	var ar_userscript_open_commit = () => {
		return `فتح هذا الإيداع في ghdiff`;
	};
	var id_userscript_open_commit = () => {
		return `Buka commit ini di ghdiff`;
	};
	var vi_userscript_open_commit = () => {
		return `Mở commit này trong ghdiff`;
	};
	var tr_userscript_open_commit = () => {
		return `Bu commit'i ghdiff'te aç`;
	};
	var pl_userscript_open_commit = () => {
		return `Otwórz ten commit w ghdiff`;
	};
	var it_userscript_open_commit = () => {
		return `Apri questo commit in ghdiff`;
	};
	var uk_userscript_open_commit = () => {
		return `Відкрити цей коміт у ghdiff`;
	};
	var nl_userscript_open_commit = () => {
		return `Deze commit openen in ghdiff`;
	};
	var fa_userscript_open_commit = () => {
		return `باز کردن این کامیت در ghdiff`;
	};
	var bn_userscript_open_commit = () => {
		return `এই কমিট ghdiff-এ খুলুন`;
	};
	/**
	* | output |
	* | --- |
	* | "Open this commit in ghdiff" |
	*
	* @param {Userscript_Open_CommitInputs} inputs
	* @param {{ locale?: "en" | "zh-Hans" | "es" | "fr" | "de" | "ja" | "ko" | "pt-BR" | "ru" | "hi" | "ar" | "id" | "vi" | "tr" | "pl" | "it" | "uk" | "nl" | "fa" | "bn" }} options
	* @returns {LocalizedString}
	*/
	var userscript_open_commit = ((inputs = {}, options = {}) => {
		const locale = options.locale ?? getLocale();
		if (locale === "zh-Hans") return zh_hans1_userscript_open_commit(inputs);
		if (locale === "es") return es_userscript_open_commit(inputs);
		if (locale === "fr") return fr_userscript_open_commit(inputs);
		if (locale === "de") return de_userscript_open_commit(inputs);
		if (locale === "ja") return ja_userscript_open_commit(inputs);
		if (locale === "ko") return ko_userscript_open_commit(inputs);
		if (locale === "pt-BR") return pt_br2_userscript_open_commit(inputs);
		if (locale === "ru") return ru_userscript_open_commit(inputs);
		if (locale === "hi") return hi_userscript_open_commit(inputs);
		if (locale === "ar") return ar_userscript_open_commit(inputs);
		if (locale === "id") return id_userscript_open_commit(inputs);
		if (locale === "vi") return vi_userscript_open_commit(inputs);
		if (locale === "tr") return tr_userscript_open_commit(inputs);
		if (locale === "pl") return pl_userscript_open_commit(inputs);
		if (locale === "it") return it_userscript_open_commit(inputs);
		if (locale === "uk") return uk_userscript_open_commit(inputs);
		if (locale === "nl") return nl_userscript_open_commit(inputs);
		if (locale === "fa") return fa_userscript_open_commit(inputs);
		if (locale === "bn") return bn_userscript_open_commit(inputs);
		return en_userscript_open_commit(inputs);
	});
	//#endregion
	//#region src/paraglide/messages/userscript_open_pull.js
	/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
	/** @typedef {{}} Userscript_Open_PullInputs */
	var en_userscript_open_pull = () => {
		return `Open this pull request in ghdiff`;
	};
	var zh_hans1_userscript_open_pull = () => {
		return `在 ghdiff 中打开此拉取请求`;
	};
	var es_userscript_open_pull = () => {
		return `Abrir este pull request en ghdiff`;
	};
	var fr_userscript_open_pull = () => {
		return `Ouvrir ce pull request dans ghdiff`;
	};
	var de_userscript_open_pull = () => {
		return `Diesen Pull Request in ghdiff öffnen`;
	};
	var ja_userscript_open_pull = () => {
		return `このプルリクエストを ghdiff で開く`;
	};
	var ko_userscript_open_pull = () => {
		return `ghdiff에서 이 풀 리퀘스트 열기`;
	};
	var pt_br2_userscript_open_pull = () => {
		return `Abrir este pull request no ghdiff`;
	};
	var ru_userscript_open_pull = () => {
		return `Открыть этот пул-реквест в ghdiff`;
	};
	var hi_userscript_open_pull = () => {
		return `इस पुल रिक्वेस्ट को ghdiff में खोलें`;
	};
	var ar_userscript_open_pull = () => {
		return `فتح طلب السحب هذا في ghdiff`;
	};
	var id_userscript_open_pull = () => {
		return `Buka pull request ini di ghdiff`;
	};
	var vi_userscript_open_pull = () => {
		return `Mở pull request này trong ghdiff`;
	};
	var tr_userscript_open_pull = () => {
		return `Bu pull request'i ghdiff'te aç`;
	};
	var pl_userscript_open_pull = () => {
		return `Otwórz ten pull request w ghdiff`;
	};
	var it_userscript_open_pull = () => {
		return `Apri questa pull request in ghdiff`;
	};
	var uk_userscript_open_pull = () => {
		return `Відкрити цей пул-реквест у ghdiff`;
	};
	var nl_userscript_open_pull = () => {
		return `Dit pull request openen in ghdiff`;
	};
	var fa_userscript_open_pull = () => {
		return `باز کردن این درخواست ادغام در ghdiff`;
	};
	var bn_userscript_open_pull = () => {
		return `এই পুল রিকোয়েস্ট ghdiff-এ খুলুন`;
	};
	/**
	* | output |
	* | --- |
	* | "Open this pull request in ghdiff" |
	*
	* @param {Userscript_Open_PullInputs} inputs
	* @param {{ locale?: "en" | "zh-Hans" | "es" | "fr" | "de" | "ja" | "ko" | "pt-BR" | "ru" | "hi" | "ar" | "id" | "vi" | "tr" | "pl" | "it" | "uk" | "nl" | "fa" | "bn" }} options
	* @returns {LocalizedString}
	*/
	var userscript_open_pull = ((inputs = {}, options = {}) => {
		const locale = options.locale ?? getLocale();
		if (locale === "zh-Hans") return zh_hans1_userscript_open_pull(inputs);
		if (locale === "es") return es_userscript_open_pull(inputs);
		if (locale === "fr") return fr_userscript_open_pull(inputs);
		if (locale === "de") return de_userscript_open_pull(inputs);
		if (locale === "ja") return ja_userscript_open_pull(inputs);
		if (locale === "ko") return ko_userscript_open_pull(inputs);
		if (locale === "pt-BR") return pt_br2_userscript_open_pull(inputs);
		if (locale === "ru") return ru_userscript_open_pull(inputs);
		if (locale === "hi") return hi_userscript_open_pull(inputs);
		if (locale === "ar") return ar_userscript_open_pull(inputs);
		if (locale === "id") return id_userscript_open_pull(inputs);
		if (locale === "vi") return vi_userscript_open_pull(inputs);
		if (locale === "tr") return tr_userscript_open_pull(inputs);
		if (locale === "pl") return pl_userscript_open_pull(inputs);
		if (locale === "it") return it_userscript_open_pull(inputs);
		if (locale === "uk") return uk_userscript_open_pull(inputs);
		if (locale === "nl") return nl_userscript_open_pull(inputs);
		if (locale === "fa") return fa_userscript_open_pull(inputs);
		if (locale === "bn") return bn_userscript_open_pull(inputs);
		return en_userscript_open_pull(inputs);
	});
	//#endregion
	//#region src/userscript.js
	function userscriptLocale() {
		const language = document.documentElement.lang;
		return matchLocale(language, locales) ?? "en";
	}
	(() => {
		"use strict";
		const APP_ORIGIN = "https://ghdiff.com";
		const BUTTON_ID = "ghdiff-open-button";
		const STYLE_ID = "ghdiff-open-style";
		const PULL_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/;
		const COMMIT_PATH = /^\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]{7,40})(?:\/|$)/i;
		const GITHUB_DIFF_HASH = /^#diff-[0-9a-f]{64}(?:[LR]\d+(?:-[LR]\d+)?)?$/;
		const STYLE = `
#${BUTTON_ID} {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  gap: var(--base-size-8, 8px);
  font-size: var(--text-body-size-medium, 14px);
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  appearance: none;
}
#${BUTTON_ID} .ghdiff-icon {
  flex: 0 0 auto;
  color: var(--fgColor-muted, #59636e);
}
#${BUTTON_ID}[data-ghdiff-place="tabs"] {
  align-self: stretch;
  padding: var(--base-size-8, 8px) var(--base-size-12, 12px);
  border: none;
  border-radius: 0;
  background-color: transparent;
  box-shadow: none;
  color: var(--fgColor-default, #1f2328);
  font-weight: var(--base-text-weight-normal, 400);
  line-height: 1.64em;
}
#${BUTTON_ID}[data-ghdiff-place="tabs"]:focus-visible {
  outline: var(--focus-outline, 2px solid var(--focus-outlineColor, #0969da));
  outline-offset: -6px;
}
@media (max-width: 575.98px) {
  #${BUTTON_ID}[data-ghdiff-place="tabs"] .ghdiff-icon {
    display: none;
  }
}
#${BUTTON_ID}[data-ghdiff-place="actions"] {
  align-self: center;
  height: var(--control-medium-size, 32px);
  padding: 0 var(--control-medium-paddingInline-normal, 12px);
  border: 1px solid var(--button-default-borderColor-rest, #d1d9e0);
  border-radius: var(--borderRadius-medium, 6px);
  background-color: var(--button-default-bgColor-rest, #f6f8fa);
  box-shadow: var(--button-default-shadow-resting, 0 1px 0 0 #1f23280a);
  color: var(--button-default-fgColor-rest, #25292e);
  font-weight: var(--base-text-weight-medium, 500);
  line-height: var(--text-body-lineHeight-medium, 1.5);
  user-select: none;
  transition: color 80ms cubic-bezier(0.65, 0, 0.35, 1),
    fill 80ms cubic-bezier(0.65, 0, 0.35, 1),
    background-color 80ms cubic-bezier(0.65, 0, 0.35, 1),
    border-color 80ms cubic-bezier(0.65, 0, 0.35, 1);
}
#${BUTTON_ID}[data-ghdiff-place="actions"]:hover {
  background-color: var(--button-default-bgColor-hover, #eff2f5);
  border-color: var(--button-default-borderColor-hover, #d1d9e0);
}
#${BUTTON_ID}[data-ghdiff-place="actions"]:active {
  background-color: var(--button-default-bgColor-active, #e6eaef);
  border-color: var(--button-default-borderColor-active, #d1d9e0);
}
#${BUTTON_ID}[data-ghdiff-place="actions"]:focus-visible {
  box-shadow: none;
  outline: 2px solid var(--focus-outline-color, var(--focus-outlineColor, #0969da));
  outline-offset: -2px;
}
/* The old server-rendered tab bar draws its tabs wider and quieter than the
   React one — muted at rest, generous padding, a colour-only hover — so the
   same descendant selector github.com scopes its own rules with scopes ours. */
.tabnav-tabs #${BUTTON_ID} {
  padding-inline: var(--control-medium-paddingInline-spacious, 16px);
  color: var(--fgColor-muted, #59636e);
  transition: color 0.2s cubic-bezier(0.3, 0, 0.5, 1);
}
.tabnav-tabs #${BUTTON_ID}:hover {
  color: var(--fgColor-default, #1f2328);
}
`;
		const LINK_EXTERNAL_PATH = "M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z";
		/**
		* The diff on screen, or null on any other page. A pull request and a commit
		* are the two github.com pages that are one diff and that ghdiff has an
		* address for; a compare range is the third, and its header carries no
		* control of its own to sit beside.
		*/
		function currentTarget() {
			const pull = PULL_PATH.exec(location.pathname);
			if (pull != null) return {
				kind: "pull",
				owner: pull[1],
				repo: pull[2],
				number: pull[3]
			};
			const commit = COMMIT_PATH.exec(location.pathname);
			if (commit != null) return {
				kind: "commit",
				owner: commit[1],
				repo: commit[2],
				sha: commit[3]
			};
			return null;
		}
		/** github.com's own path for this target, which is ghdiff's path as well. */
		function targetPath(target) {
			return target.kind === "pull" ? `/${target.owner}/${target.repo}/pull/${target.number}` : `/${target.owner}/${target.repo}/commit/${target.sha}`;
		}
		function ghdiffHref(target) {
			const hash = GITHUB_DIFF_HASH.test(location.hash) ? location.hash : "";
			return `${APP_ORIGIN}${targetPath(target)}${hash}`;
		}
		function buttonTitle(target) {
			return target.kind === "pull" ? userscript_open_pull({}, { locale: userscriptLocale() }) : userscript_open_commit({}, { locale: userscriptLocale() });
		}
		const TAB_LISTS = ["nav[aria-label=\"Pull request navigation\"] > *", ".tabnav-tabs"];
		/**
		* Where the button goes for this target: the tab bar on a pull request, the
		* action row on a commit. Both are found by what they hold rather than by
		* what they are called — see the two functions below.
		*/
		function findHost(target) {
			if (target.kind === "commit") return findRowByLinkTo(treePath(target));
			for (const selector of TAB_LISTS) {
				const found = document.querySelector(selector);
				if (found != null) return found;
			}
			return findRowByLinkTo(`${targetPath(target)}/files`);
		}
		/** Browse files, which is this commit's own tree page. */
		function treePath(target) {
			return `/${target.owner}/${target.repo}/tree/${target.sha}`;
		}
		function findRowByLinkTo(path) {
			for (const link of document.querySelectorAll("a[href]")) {
				const href = link.getAttribute("href");
				if (href == null) continue;
				const url = new URL(href, location.href);
				if (url.pathname !== path) continue;
				if (url.hash !== "" || url.search !== "") continue;
				if (link.offsetParent == null) continue;
				const row = link.parentElement;
				if (row != null && row.children.length > 1) return row;
			}
			return null;
		}
		function placeFor(target) {
			return target.kind === "pull" ? "tabs" : "actions";
		}
		function buildButton() {
			const button = document.createElement("a");
			button.id = BUTTON_ID;
			const label = document.createElement("span");
			label.textContent = "ghdiff";
			const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			icon.setAttribute("class", "ghdiff-icon");
			icon.setAttribute("viewBox", "0 0 16 16");
			icon.setAttribute("width", "16");
			icon.setAttribute("height", "16");
			icon.setAttribute("fill", "currentColor");
			icon.setAttribute("aria-hidden", "true");
			icon.setAttribute("focusable", "false");
			const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
			path.setAttribute("d", LINK_EXTERNAL_PATH);
			icon.append(path);
			button.append(icon, label);
			return button;
		}
		function installStyle() {
			if (document.getElementById(STYLE_ID) != null) return;
			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = STYLE;
			(document.head ?? document.documentElement).append(style);
		}
		function sync() {
			const target = currentTarget();
			const existing = document.getElementById(BUTTON_ID);
			if (target == null) {
				existing?.remove();
				return;
			}
			const host = findHost(target);
			if (host == null) {
				existing?.remove();
				return;
			}
			installStyle();
			const button = existing ?? buildButton();
			const href = ghdiffHref(target);
			if (button.getAttribute("href") !== href) button.setAttribute("href", href);
			const place = placeFor(target);
			if (button.dataset.ghdiffPlace !== place) button.dataset.ghdiffPlace = place;
			const title = buttonTitle(target);
			if (button.title !== title) button.title = title;
			if (button.parentElement !== host || button.nextElementSibling != null) host.append(button);
		}
		let pending = false;
		function schedule() {
			if (pending) return;
			pending = true;
			setTimeout(() => {
				pending = false;
				sync();
			}, 50);
		}
		sync();
		new MutationObserver(schedule).observe(document.documentElement, {
			childList: true,
			subtree: true
		});
		window.addEventListener("hashchange", schedule);
		window.addEventListener("popstate", schedule);
	})();
	//#endregion
})();
