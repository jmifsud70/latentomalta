
import { GoogleGenAI, Type } from "@google/genai";
import { SheetRow, ColumnMapping } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const identifyColumns = async (headers: string[], sampleRows: SheetRow[]): Promise<ColumnMapping> => {
  const sampleDataStr = JSON.stringify(sampleRows.slice(0, 5));
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analyze the following CSV headers and sample data. 
    Identify the column(s) representing geographic coordinates.
    Headers: ${headers.join(", ")}
    Sample Data: ${sampleDataStr}
    
    Rules:
    1. If a single column contains BOTH values (e.g. "40.7, -74.0"), return that column name for BOTH latColumn and lngColumn.
    2. Coordinates might use a comma as a decimal separator (European style: 48,85) or a column separator.
    3. Look for headers like 'lat', 'long', 'coords', 'location', 'gps', 'y', 'x'.
    4. Return valid JSON only.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          latColumn: { type: Type.STRING, description: "Header for latitude" },
          lngColumn: { type: Type.STRING, description: "Header for longitude" }
        },
        required: ["latColumn", "lngColumn"]
      }
    }
  });

  try {
    const text = response.text;
    const mapping = JSON.parse(text);
    return mapping as ColumnMapping;
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    const lat = headers.find(h => h.toLowerCase().includes('lat') || h.toLowerCase().includes('y') || h.toLowerCase() === 'coordinates');
    const lng = headers.find(h => h.toLowerCase().includes('lng') || h.toLowerCase().includes('long') || h.toLowerCase().includes('x') || h.toLowerCase() === 'coordinates');
    return { 
      latColumn: lat || headers[0], 
      lngColumn: lng || headers[1] 
    };
  }
};

export const getSheetInsights = async (rows: SheetRow[]): Promise<string> => {
  const dataSummary = JSON.stringify(rows.slice(0, 10));
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `The user uploaded geographic data. 
    Summarize what these locations represent in 1-2 short sentences: ${dataSummary}.`,
  });

  return response.text;
};