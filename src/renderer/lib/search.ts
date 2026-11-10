/** Separators inside a cmdk item value: "label␁group␀id". Only label and group are searchable. */
export const LABEL_SEP = '\u0001'
export const ID_SEP = '\u0000'

export const optionValue = (label: string, group: string, id: string) =>
  `${label}${LABEL_SEP}${group}${ID_SEP}${id}`

/**
 * Rank matches on the visible label first, then the group name; never on the hidden id.
 * cmdk's default fuzzy scorer matches scattered letters, which picks surprising items.
 */
export function scoreOption(value: string, search: string): number {
  const q = search.trim().toLowerCase()
  if (!q) return 1
  const [visible = ''] = value.split(ID_SEP)
  const [label = '', group = ''] = visible.toLowerCase().split(LABEL_SEP)
  if (label.startsWith(q)) return 1
  if (label.split(/[\s›&/-]+/).some((w) => w.startsWith(q))) return 0.9
  if (label.includes(q)) return 0.7
  if (group.split(/\s+/).some((w) => w.startsWith(q))) return 0.5
  if (group.includes(q)) return 0.3
  return 0
}
