
import { GoogleGenAI, Type } from "@google/genai";
import { SheetRow, ColumnMapping } from "../types";

/**
 * Identifies coordinate columns using Gemini AI based on sheet headers and sample data.
 * Prioritizes user-specified 'Latitude N' and 'Longitude E'.
 */
export const identifyColumns = async (headers: string[], sampleRows: SheetRow[]): Promise<ColumnMapping> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const prompt = `
    Analyze the following Google Sheet headers and sample data. 
    Identify which column(s) contain latitude and longitude coordinates.
    
    Headers: ${headers.join(', ')}
    Sample Data (first 3 rows): ${JSON.stringify(sampleRows.slice(0, 3))}
    
    CRITICAL INSTRUCTIONS:
    1. If a column named exactly "Latitude N" exists, it MUST be the latColumn.
    2. If a column named exactly "Longitude E" exists, it MUST be the lngColumn.
    3. If they don't exist, search for common synonyms like 'Lat', 'Long', 'GPS', etc.
    4. Return the exact header names as they appear in the headers list.
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
    
    // Verify headers exist in the list
    if (result.latColumn && result.lngColumn && headers.includes(result.latColumn) && headers.includes(result.lngColumn)) {
      return result as ColumnMapping;
    }
  } catch (error) {
    console.error("Gemini failed to identify columns, falling back to manual detection:", error);
  }

  // Final manual fallback if AI fails or returns invalid headers
  const latColumn = headers.find(h => h === 'Latitude N') || 
                    headers.find(h => h.toLowerCase().includes('latitude') || h.toLowerCase() === 'lat') || 
                    headers[0];
  
  const lngColumn = headers.find(h => h === 'Longitude E') || 
                    headers.find(h => h.toLowerCase().includes('longitude') || h.toLowerCase().includes('long') || h.toLowerCase().includes('lng')) || 
                    headers[1] || headers[0];

  return { latColumn, lngColumn };
};
