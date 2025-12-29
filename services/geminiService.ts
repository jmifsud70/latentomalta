
import { SheetRow, ColumnMapping } from "../types";

/**
 * Identifies coordinate columns based on sheet headers and sample data using heuristics.
 * Prioritizes user-specified 'Latitude N' and 'Longitude E'.
 * No longer requires an API Key.
 */
export const identifyColumns = async (headers: string[], _sampleRows: SheetRow[]): Promise<ColumnMapping> => {
  // 1. Prioritize exact matches as requested by the user
  let latColumn = headers.find(h => h === 'Latitude N');
  let lngColumn = headers.find(h => h === 'Longitude E');

  // 2. Fallback to common synonyms if exact matches are not found
  if (!latColumn) {
    latColumn = headers.find(h => {
      const lower = h.toLowerCase();
      return lower === 'lat' || lower.includes('latitude') || lower.includes('gps_lat') || lower.includes('y');
    });
  }

  if (!lngColumn) {
    lngColumn = headers.find(h => {
      const lower = h.toLowerCase();
      return lower === 'lng' || lower === 'long' || lower.includes('longitude') || lower.includes('gps_lng') || lower.includes('x');
    });
  }

  // 3. Final default: use first two columns if still not found
  return {
    latColumn: latColumn || headers[0] || '',
    lngColumn: lngColumn || headers[1] || headers[0] || ''
  };
};
