/** Match regional browser tags without substituting a different writing system. */
export function matchLocale<T extends string>(
  requested: string,
  available: readonly T[]
): T | undefined {
  try {
    const wanted = new Intl.Locale(requested).maximize();
    const exact = available.find(
      (locale) =>
        new Intl.Locale(locale).baseName === new Intl.Locale(requested).baseName
    );
    return (
      exact ??
      available.find((locale) => {
        const candidate = new Intl.Locale(locale).maximize();
        return (
          candidate.language === wanted.language &&
          candidate.script === wanted.script
        );
      })
    );
  } catch {
    return undefined;
  }
}
