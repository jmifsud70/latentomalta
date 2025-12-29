
import { GoogleGenAI, Type } from "@google/genai";
import { SheetRow, ColumnMapping } from "../types";

/**
 * Identifies coordinate columns using Gemini AI based on sheet headers and sample data.
 */
export const identifyColumns = async (headers: string[], sampleRows: SheetRow[]): Promise<ColumnMapping> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const prompt = `
    Analyze the following Google Sheet headers and sample data. 
    Identify which column(s) contain latitude and longitude coordinates.
    
    Headers: ${headers.join(', ')}
    Sample Data (first 3 rows): ${JSON.stringify(sampleRows.slice(0, 3))}
    
    CRITICAL INSTRUCTION:
    - If a column named "Latitude N" exists, it MUST be the latColumn.
    - If a column named "Longitude E" exists, it MUST be the lngColumn.
    
    Rules:
    1. Prefer "Latitude N" and "Longitude E" exactly.
    2. If they are not present, look for other headers that imply coordinates (e.g., 'lat', 'long', 'gps').
    3. Return the exact header names as they appear in the headers list.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            latColumn: {
              type: Type.STRING,
              description: 'The header name of the latitude column.'
            },
            lngColumn: {
              type: Type.STRING,
              description: 'The header name of the longitude column.'
            }
          },
          required: ["latColumn", "lngColumn"],
        },
      },
    });

    const result = JSON.parse(response.text || '{}');
    if (result.latColumn && result.lngColumn && headers.includes(result.latColumn) && headers.includes(result.lngColumn)) {
      return result as ColumnMapping;
    }
  } catch (error) {
    console.error("Gemini failed to identify columns, falling back to manual detection:", error);
  }

  // Fallback heuristic if Gemini fails or isn't available
  const latColumn = headers.find(h => h === 'Latitude N') || 
                    headers.find(h => h.toLowerCase().includes('latitude') || h.toLowerCase() === 'lat') || 
                    headers[0];
  
  const lngColumn = headers.find(h => h === 'Longitude E') || 
                    headers.find(h => h.toLowerCase().includes('longitude') || h.toLowerCase() === 'long' || h.toLowerCase() === 'lng') || 
                    headers[1] || headers[0];

  return {
    latColumn,
    lngColumn
  };
};
