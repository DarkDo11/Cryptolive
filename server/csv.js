export function toCsv(rows, columns) {
  const escape = (value) => {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };

  const lines = [columns.map(column => escape(column.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map(column => {
      const value = typeof column.key === 'function' ? column.key(row) : row[column.key];
      return escape(value);
    }).join(','));
  }
  return lines.join('\r\n');
}
