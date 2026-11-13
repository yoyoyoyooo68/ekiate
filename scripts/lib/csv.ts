// 小さな CSV 読み込み（ダブルクォート・改行入りの値に対応。先頭行は見出し）
export function parseCsv(text: string): Record<string, string>[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') (cur += '"'), i++;
        else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') (row.push(cur), (cur = ''));
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    rows.push(row);
  }
  const head = rows.shift() ?? [];
  return rows.map((r) => Object.fromEntries(head.map((k, i) => [k.trim(), (r[i] ?? '').trim()])));
}
