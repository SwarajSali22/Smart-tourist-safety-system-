import { api, tokens, API_BASE_URL } from '../../api/client.js';

// Cells starting with = + - @ are executed as formulas by spreadsheet apps; neutralise them.
function cell(v) {
  let t = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

function save(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Builds a CSV from rows + [{ header, value(row) }] and downloads it (BOM so Excel reads UTF-8). */
export function downloadCsv(filename, columns, rows) {
  const lines = [columns.map((c) => cell(c.header)).join(',')];
  rows.forEach((r) => lines.push(columns.map((c) => cell(c.value(r))).join(',')));
  save(new Blob([`\uFEFF${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' }), filename);
}

/** Downloads a CSV the server builds (e.g. every row matching the current filters, not just one page). */
export async function downloadServerCsv(path, filename) {
  const fetchIt = () => fetch(`${API_BASE_URL}${path}`, { headers: { Authorization: `Bearer ${tokens.getAccess()}` } });
  let res = await fetchIt();
  if (res.status === 401) { await api.get('/auth/me').catch(() => {}); res = await fetchIt(); } // refreshes the token, then retries once
  if (!res.ok) {
    let message = `Export failed (${res.status})`;
    try { message = (await res.json()).message || message; } catch { /* ignore */ }
    throw new Error(message);
  }
  save(await res.blob(), filename);
}

/** Same authenticated download for any file the server builds (PDF, CSV…). */
export const downloadServerFile = downloadServerCsv;
