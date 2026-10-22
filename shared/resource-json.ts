// Keep each resource record on one line, including records inside region groups.
export function formatResourceJson(data: unknown): string {
  function format(value: unknown, depth: number): string {
    const indent = "  ".repeat(depth);
    const childIndent = `${indent}  `;
    if (Array.isArray(value)) {
      if (value.length === 0) return "[]";
      return `[\n${value.map((item) => `${childIndent}${JSON.stringify(item)}`).join(",\n")}\n${indent}]`;
    }
    if (value !== null && typeof value === "object") {
      const entries = Object.entries(value);
      if (entries.length === 0) return "{}";
      return `{\n${entries.map(([key, item]) => `${childIndent}${JSON.stringify(key)}: ${format(item, depth + 1)}`).join(",\n")}\n${indent}}`;
    }
    return JSON.stringify(value);
  }
  return `${format(data, 0)}\n`;
}
