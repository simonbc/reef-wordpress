export function markdownToHtml(markdown: string): string {
  const blocks = markdown.trim().split(/\n{2,}/);
  return blocks.map(renderBlock).join("\n");
}

function renderBlock(block: string): string {
  const trimmed = block.trim();
  const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
  if (heading) {
    const level = heading[1].length;
    return `<h${level}>${inline(heading[2])}</h${level}>`;
  }

  return `<p>${inline(trimmed).replace(/\n/g, "<br>")}</p>`;
}

function inline(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
