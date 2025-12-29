
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
    
    Specific Instruction:
    - Use "Latitude N" for latitude if it exists.
    - Use "Longitude E" for longitude if it exists.
    
    Rules:
    1. Prefer "Latitude N" and "Longitude E" exactly if they are in the headers list.
    2. If there's a single column with combined coordinates (e.g. "35.8, 14.4"), use that for both.
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
    console.error("Gemini failed to identify columns, falling back to heuristics:", error);
  }

  // Fallback heuristic: User specified "Latitude N" and "Longitude E"
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
