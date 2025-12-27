
import { SheetRow } from '../types';

export const fetchGoogleSheetData = async (url: string): Promise<{ headers: string[], rows: SheetRow[] }> => {
  let csvUrl = url;
  if (url.includes('/edit')) {
    csvUrl = url.split('/edit')[0] + '/export?format=csv';
  } else if (!url.endsWith('/export?format=csv')) {
    const match = url.match(/[-\w]{25,}/);
    if (match) {
      csvUrl = `https://docs.google.com/spreadsheets/d/${match[0]}/export?format=csv`;
    }
  }

  const response = await fetch(csvUrl);
  if (!response.ok) {
    throw new Error('Failed to fetch Google Sheet. Ensure it is shared as "Anyone with the link can view".');
  }

  const text = await response.text();
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length < 1) throw new Error('Sheet appears to be empty.');

  const headers = parseCSVLine(lines[0]);
  const rows: SheetRow[] = lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const row: SheetRow = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    return row;
  });

  return { headers, rows };
};

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result.map(s => s.replace(/^"|"$/g, ''));
}