/** "1 line", "2 lines", "1 entry"/"3 entries" (pass the plural form when it is irregular). */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString('en-IN')} ${count === 1 ? singular : pluralForm}`
}
