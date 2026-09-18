/**
 * Formatting utilities
 */
import { dateLocale, t } from './i18n.js';

export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function currencySymbol(code) {
  const upper = (code || 'usd').toUpperCase();
  if (upper === 'BTC') return '₿';
  if (upper === 'ETH') return 'Ξ';
  try {
    const parts = new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).formatToParts(0);
    const sym = parts.find(p => p.type === 'currency');
    return sym ? sym.value : upper;
  } catch (e) {
    return upper;
  }
}

export function fmtCurrency(value, code = 'usd', { compact = false } = {}) {
  if (value == null || isNaN(value)) return '—';
  const num = Number(value);
  const upperCode = code.toUpperCase();
  
  const isCryptoCode = upperCode === 'BTC' || upperCode === 'ETH';
  const sym = currencySymbol(code);
  
  let options = {
    style: isCryptoCode ? 'decimal' : 'currency',
    currency: isCryptoCode ? undefined : code,
  };

  if (compact) {
    options.notation = 'compact';
    options.maximumFractionDigits = 2;
  } else if (isCryptoCode) {
    options.maximumFractionDigits = 8;
  } else {
    const abs = Math.abs(num);
    const zeroDecimal = upperCode === 'JPY' || upperCode === 'KRW';
    if (abs >= 1000) {
      options.minimumFractionDigits = 0;
      options.maximumFractionDigits = zeroDecimal ? 0 : 2;
    } else if (abs >= 1) {
      options.minimumFractionDigits = 2;
      options.maximumFractionDigits = 2;
    } else if (abs < 0.0001) {
      options.minimumFractionDigits = 0;
      options.maximumFractionDigits = 10;
    } else {
      options.minimumFractionDigits = 0;
      options.maximumSignificantDigits = 6;
    }
  }

  let formatted = new Intl.NumberFormat('en-US', options).format(num);
  if (isCryptoCode) {
    formatted = sym + formatted;
  }
  return formatted;
}

export function fmtCompact(value, code = 'usd') {
  return fmtCurrency(value, code, { compact: true });
}

export function fmtNumber(value, { max = 2 } = {}) {
  if (value == null || isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: max }).format(Number(value));
}

export function fmtPercent(value) {
  if (value == null || isNaN(value)) return '—';
  const num = Number(value);
  const prefix = num > 0 ? '+' : '';
  return `${prefix}${num.toFixed(2)}%`;
}

export function fmtSupply(n, symbol) {
  if (n == null || isNaN(n)) return '—';
  return `${fmtNumber(n, { max: 0 })} ${escapeHtml(symbol.toUpperCase())}`;
}

export function fmtDate(ts) {
  if (!ts) return '—';
  return new Intl.DateTimeFormat(dateLocale(), { dateStyle: 'medium' }).format(new Date(ts));
}

export function fmtDateTime(ts) {
  if (!ts) return '—';
  return new Intl.DateTimeFormat(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts));
}

export function fmtTime(ts) {
  if (!ts) return '—';
  return new Intl.DateTimeFormat(dateLocale(), { timeStyle: 'medium' }).format(new Date(ts));
}

export function timeAgo(ts) {
  if (!ts) return '';
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return t('time.justNow');
  if (diff < 3600) return t('time.minutesAgo', { n: Math.floor(diff / 60) });
  if (diff < 86400) return t('time.hoursAgo', { n: Math.floor(diff / 3600) });
  return t('time.daysAgo', { n: Math.floor(diff / 86400) });
}

/** Build a CSV string (RFC 4180 quoting, CRLF, UTF-8 BOM added by downloadCsv) from a header row and rows. */
export function toCsv(headers, rows) {
  const escapeCell = (cell) => {
    const str = String(cell ?? '');
    if (/[",\n\r]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };
  return [headers, ...rows].map(row => row.map(escapeCell).join(',')).join('\r\n');
}

/** Parse CSV text into rows, including RFC 4180 quoted fields. */
export function parseCsv(text) {
  const input = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  const pushRow = () => {
    row.push(field);
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
    field = '';
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      pushRow();
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

/** Parse CSV text and map each data row to the trimmed header names. */
export function csvToObjects(text) {
  const [headers, ...rows] = parseCsv(text);
  if (!headers) return [];
  const names = headers.map(header => header.trim());
  return rows.map(row => Object.fromEntries(names.map((header, index) => [header, row[index] ?? ''])));
}

/** Trigger a browser download of `csv` as `filename`. */
export function downloadCsv(filename, csv) {
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
