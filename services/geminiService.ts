
import { GoogleGenAI, Type } from "@google/genai";
import { SheetRow, ColumnMapping } from "../types";

/**
 * Identifies coordinate columns using Gemini AI based on sheet headers and sample data.
 */
export const identifyColumns = async (headers: string[], sampleRows: SheetRow[]): Promise<ColumnMapping> => {
  // Initialize Gemini API
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const prompt = `
    Analyze the following Google Sheet headers and sample data. 
    Identify which column(s) contain latitude and longitude coordinates.
    
    Headers: ${headers.join(', ')}
    Sample Data (first 3 rows): ${JSON.stringify(sampleRows.slice(0, 3))}
    
    Rules:
    1. If there's a specific 'Latitude' and 'Longitude' column (e.g., 'Latitude E', 'Longitude N'), return those.
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

  // Fallback heuristic if Gemini fails or returns invalid data
  const lowercaseHeaders = headers.map(h => h.toLowerCase());
  
  // Specific targets
  const latIndex = lowercaseHeaders.findIndex(h => h === 'latitude e' || h.includes('latitude') || h === 'lat');
  const lngIndex = lowercaseHeaders.findIndex(h => h === 'longitude n' || h.includes('longitude') || h === 'long' || h === 'lng');

  return {
    latColumn: latIndex !== -1 ? headers[latIndex] : (headers.find(h => h.toLowerCase().includes('lat')) || headers[0]),
    lngColumn: lngIndex !== -1 ? headers[lngIndex] : (headers.find(h => h.toLowerCase().includes('long') || h.toLowerCase().includes('lng')) || headers[1] || headers[0])
  };
};
