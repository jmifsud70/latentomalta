import { SheetRow, ColumnMapping } from "../types";

/**
 * Identifies coordinate columns based on specific naming conventions provided:
 * 'Latitude E' and 'Longitude N'.
 */
export const identifyColumns = async (headers: string[], sampleRows: SheetRow[]): Promise<ColumnMapping> => {
  const lowercaseHeaders = headers.map(h => h.toLowerCase());
  
  // Specific targets provided by the user
  const latTarget = 'latitude e';
  const lngTarget = 'longitude n';

  const latIndex = lowercaseHeaders.indexOf(latTarget);
  const lngIndex = lowercaseHeaders.indexOf(lngTarget);

  return {
    latColumn: latIndex !== -1 ? headers[latIndex] : (headers.find(h => h.toLowerCase().includes('lat')) || headers[0]),
    lngColumn: lngIndex !== -1 ? headers[lngIndex] : (headers.find(h => h.toLowerCase().includes('long') || h.toLowerCase().includes('lng')) || headers[1] || headers[0])
  };
};