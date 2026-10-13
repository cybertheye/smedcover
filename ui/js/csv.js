// Minimal CSV reader for batch export. Handles quoted cells, doubled quotes and line breaks inside quotes.

/** Parses CSV text into rows of string cells. Blank lines are dropped. */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  const src = String(text).replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === "\t") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const HEADERS = {
  category: ["channel", "频道", "category", "类目", "分类"],
  title: ["title", "标题"],
  tag: ["tag", "角标", "标签"],
};

/**
 * Turns CSV text into cover jobs [{category, title, tag}]. A header row is optional; without one
 * the columns are category, title, tag. Rows without a title are skipped.
 */
export function csvToJobs(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const norm = (s) => s.trim().toLowerCase();
  const first = rows[0].map(norm);
  const col = {};
  for (const [key, names] of Object.entries(HEADERS)) col[key] = first.findIndex((c) => names.includes(c));
  const hasHeader = col.title >= 0;
  if (!hasHeader) Object.assign(col, { category: 0, title: 1, tag: 2 });
  return rows
    .slice(hasHeader ? 1 : 0)
    .map((r) => ({
      category: (r[col.category] ?? "").trim(),
      title: (r[col.title] ?? "").trim(),
      tag: col.tag >= 0 ? (r[col.tag] ?? "").trim() : "",
    }))
    .filter((j) => j.title);
}
