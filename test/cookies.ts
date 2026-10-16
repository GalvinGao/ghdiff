/** The value out of a `Set-Cookie` line. */
export function cookieValue(line: string): string {
  return line.slice(line.indexOf('=') + 1, line.indexOf(';'));
}
