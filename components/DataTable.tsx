
import React from 'react';
import { SheetRow } from '../types';

interface DataTableProps {
  headers: string[];
  rows: SheetRow[];
  latCol?: string;
  lngCol?: string;
}

const DataTable: React.FC<DataTableProps> = ({ headers, rows, latCol, lngCol }) => {
  // Filter out the coordinate columns from the visible headers
  const visibleHeaders = headers.filter(h => h !== latCol && h !== lngCol);

  return (
    <div className="overflow-x-auto border dark:border-slate-800 rounded-xl shadow-sm bg-white dark:bg-slate-900 transition-colors">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-800 text-sm">
        <thead className="bg-gray-50 dark:bg-slate-800/50">
          <tr>
            {visibleHeaders.map((h) => (
              <th
                key={h}
                className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-slate-300 uppercase tracking-wider"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-200 dark:divide-slate-800">
          {rows.slice(0, 50).map((row, idx) => (
            <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
              {visibleHeaders.map((h) => (
                <td key={h} className="px-4 py-2 whitespace-nowrap text-gray-600 dark:text-slate-400">
                  {String(row[h])}
                </td>
              ))}
            </tr>
          ))}
          {rows.length > 50 && (
            <tr>
              <td colSpan={visibleHeaders.length} className="px-4 py-2 text-center text-gray-400 dark:text-slate-600 italic">
                ... and {rows.length - 50} more rows
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default DataTable;
