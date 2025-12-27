import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { AppState, SheetRow, PlotPoint, ColumnMapping, StyleRule } from './types.ts';
import { fetchGoogleSheetData } from './services/sheetService.ts';
import { identifyColumns, getSheetInsights } from './services/geminiService.ts';
import MapDisplay from './components/MapDisplay.tsx';
import DataTable from './components/DataTable.tsx';

const PALETTE = [
  '#CC0000', '#000000', '#444444', '#777777', '#999999', 
  '#BB0000', '#222222', '#660000', '#333333', '#AA0000'
];

const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1RBeGX954Pebq-Vj8Z-La41zFkdxykV4tijpHclkHLCk/edit?usp=sharing';

const App: React.FC = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('theme') as 'light' | 'dark') || 'light';
    }
    return 'light';
  });

  const [state, setState] = useState<AppState>({
    isLoading: false,
    error: null,
    sheetData: [],
    headers: [],
    mapping: null,
    points: [],
    styleConfig: { activeColumn: null, rule: null }
  });
  
  const [insights, setInsights] = useState<string | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<PlotPoint | null>(null);
  const [selectedFilters, setSelectedFilters] = useState<string[]>([]);
  const [filterColumn, setFilterColumn] = useState<string | null>(null);

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

  const cleanAndParse = (val: string): number | null => {
    let s = val.trim().toUpperCase();
    if (!s) return null;
    const isNegative = s.includes('S') || s.includes('W') || s.startsWith('-');
    if (s.includes(',') && !s.includes('.')) {
      const commaCount = (s.match(/,/g) || []).length;
      if (commaCount === 1) s = s.replace(',', '.');
    }
    const cleaned = s.replace(/[^0-9.-]/g, '');
    const num = parseFloat(cleaned);
    if (isNaN(num)) return null;
    return isNegative ? -Math.abs(num) : Math.abs(num);
  };

  const processPoints = useCallback((rows: SheetRow[], mapping: ColumnMapping | null): PlotPoint[] => {
    if (!mapping || !mapping.latColumn || !mapping.lngColumn) return [];
    const validPoints: PlotPoint[] = [];
    const isSameColumn = mapping.latColumn === mapping.lngColumn;

    rows.forEach(row => {
      let lat: number | null = null;
      let lng: number | null = null;
      if (isSameColumn) {
        const combined = String(row[mapping.latColumn]);
        const parts = combined.split(/[,;]/);
        if (parts.length >= 2) {
          lat = cleanAndParse(parts[0]);
          lng = cleanAndParse(parts[1]);
        }
      } else {
        lat = cleanAndParse(String(row[mapping.latColumn]));
        lng = cleanAndParse(String(row[mapping.lngColumn]));
      }
      if (lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && (lat !== 0 || lng !== 0)) {
        validPoints.push({ lat, lng, data: row });
      }
    });
    return validPoints;
  }, []);

  const handleFetch = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, error: null, points: [], sheetData: [], mapping: null }));
    setInsights(null);
    setSelectedPoint(null);
    setSelectedFilters([]);
    try {
      const { headers, rows } = await fetchGoogleSheetData(DEFAULT_SHEET_URL);
      const mapping = await identifyColumns(headers, rows);
      const validPoints = processPoints(rows, mapping);
      
      const possibleFilterCol = headers.find(h => 
        ['type', 'installation type', 'category', 'status', 'installation'].some(keyword => h.toLowerCase().includes(keyword))
      ) || null;
      setFilterColumn(possibleFilterCol);

      setState(prev => ({ ...prev, isLoading: false, error: null, sheetData: rows, headers, mapping, points: validPoints }));
      
      if (possibleFilterCol) {
        const types = Array.from(new Set(rows.map(row => String(row[possibleFilterCol] || 'Unknown'))))
          .filter(t => t.trim() !== '')
          .sort();
        setSelectedFilters(types);
      }

      getSheetInsights(rows).then(setInsights).catch(console.error);
    } catch (err: any) {
      setState(prev => ({ ...prev, isLoading: false, error: err.message }));
    }
  }, [processPoints]);

  useEffect(() => {
    handleFetch();
  }, [handleFetch]);

  const uniqueInstallationTypes = useMemo(() => {
    if (!filterColumn || !state.sheetData.length) return [];
    const types = Array.from(new Set(state.sheetData.map(row => String(row[filterColumn] || 'Unknown'))))
      .filter(t => t.trim() !== '')
      .sort();
    return types;
  }, [filterColumn, state.sheetData]);

  const filteredPoints = useMemo(() => {
    if (!filterColumn) return state.points;
    return state.points.filter(p => selectedFilters.includes(String(p.data[filterColumn])));
  }, [state.points, selectedFilters, filterColumn]);

  const handleToggleFilter = (type: string) => {
    setSelectedFilters(prev => 
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const isAllSelected = uniqueInstallationTypes.length > 0 && selectedFilters.length === uniqueInstallationTypes.length;

  const handleToggleAll = () => {
    if (isAllSelected) {
      setSelectedFilters([]);
    } else {
      setSelectedFilters(uniqueInstallationTypes);
    }
  };

  const handleApplyStyle = (columnName: string) => {
    if (!columnName) {
      setState(prev => ({ ...prev, styleConfig: { activeColumn: null, rule: null } }));
      return;
    }
    const uniqueValues: string[] = Array.from(new Set(state.sheetData.map(r => String(r[columnName]))));
    const colorMap: Record<string, string> = {};
    uniqueValues.forEach((val, idx) => {
      colorMap[val] = PALETTE[idx % PALETTE.length];
    });
    const rule: StyleRule = { column: columnName, type: 'categorical', colorMap };
    setState(prev => ({ ...prev, styleConfig: { activeColumn: columnName, rule } }));
  };

  const updateMapping = (type: 'lat' | 'lng', column: string) => {
    setState(prev => {
      const newMapping = prev.mapping ? { ...prev.mapping } : { latColumn: '', lngColumn: '' };
      if (type === 'lat') newMapping.latColumn = column;
      else newMapping.lngColumn = column;
      return { ...prev, mapping: newMapping, points: processPoints(prev.sheetData, newMapping) };
    });
  };

  const swapMapping = () => {
    setState(prev => {
      if (!prev.mapping) return prev;
      const newMapping = { latColumn: prev.mapping.lngColumn, lngColumn: prev.mapping.latColumn };
      return { ...prev, mapping: newMapping, points: processPoints(prev.sheetData, newMapping) };
    });
  };

  const getPointTitle = (point: PlotPoint) => {
    const projectKey = Object.keys(point.data).find(k => k.toLowerCase() === 'project');
    if (projectKey) return String(point.data[projectKey]);
    const firstKey = Object.keys(point.data)[0];
    return firstKey ? String(point.data[firstKey]) : 'Location Details';
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-black font-sans transition-colors duration-300">
      <header className="bg-white dark:bg-zinc-950 border-b dark:border-zinc-800 px-6 py-4 flex items-center justify-between sticky top-0 z-[1000] shadow-sm transition-colors duration-300">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-[#CC0000] rounded-sm flex items-center justify-center text-white font-bold text-2xl shadow-lg">W</div>
          <h1 className="text-xl font-black bg-clip-text text-transparent bg-gradient-to-r from-[#CC0000] to-black dark:from-[#CC0000] dark:to-white">WÜRTH MALTA</h1>
        </div>
        
        <div className="flex items-center gap-4">
          {state.isLoading && (
            <div className="flex items-center gap-3 text-[#CC0000] animate-pulse hidden sm:flex">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="text-sm font-black uppercase tracking-widest">Synchronizing</span>
            </div>
          )}
          <button 
            onClick={toggleTheme}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors text-gray-500 dark:text-zinc-400"
            title="Toggle Theme"
          >
            {theme === 'light' ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M16.243 16.243l.707.707M7.757 7.757l.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6 flex flex-col gap-6 max-w-[1400px] mx-auto w-full">
        {state.error && <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400 p-4 rounded-xl text-sm shadow-sm">{state.error}</div>}
          
        <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-800 transition-colors duration-300">
          <div className="w-full flex flex-col mb-4">
            <h2 className="text-3xl font-black text-black dark:text-white uppercase tracking-tight border-l-4 border-[#CC0000] pl-4">
              Latento Installations in Malta
            </h2>
            <span className="text-[10px] font-bold text-gray-500 dark:text-zinc-500 uppercase tracking-widest mt-1 pl-4">Asset Tracking & Geographic Visualization</span>
          </div>
          
          {filterColumn && (
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                onClick={handleToggleAll}
                className={`px-4 py-2 rounded-full text-xs font-bold transition-all shadow-sm flex items-center gap-2 border ${
                  isAllSelected 
                  ? 'bg-[#CC0000] text-white border-[#CC0000]' 
                  : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-[#CC0000]'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${isAllSelected ? 'bg-white' : 'bg-[#CC0000]'}`}></span>
                Toggle All
              </button>
              {uniqueInstallationTypes.map(type => {
                const isActive = selectedFilters.includes(type);
                return (
                  <button
                    key={type}
                    onClick={() => handleToggleFilter(type)}
                    className={`px-4 py-2 rounded-full text-xs font-bold transition-all shadow-sm flex items-center gap-2 border ${
                      isActive 
                      ? 'bg-[#CC0000] text-white border-[#CC0000]' 
                      : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-[#CC0000]'
                    }`}
                  >
                    <div className={`w-3.5 h-3.5 rounded-full border border-white/30 flex items-center justify-center ${isActive ? 'bg-red-400' : 'bg-zinc-200 dark:bg-zinc-700'}`}>
                      {isActive && <div className="w-2 h-2 bg-white rounded-full"></div>}
                    </div>
                    {type}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-[#CC0000]/5 dark:bg-[#CC0000]/10 p-5 rounded-2xl border border-[#CC0000]/20 transition-colors duration-300 flex items-start gap-4">
          <div className="p-2 bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-[#CC0000]/20 text-[#CC0000]">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <h2 className="text-[10px] font-bold text-[#CC0000] uppercase tracking-widest mb-1">Dataset Analytics</h2>
            {state.isLoading ? (
              <div className="animate-pulse space-y-2">
                <div className="h-3 bg-red-100 dark:bg-zinc-800 rounded w-64"></div>
              </div>
            ) : (
              <p className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed italic font-medium">
                {insights || "Calculating spatial density and distribution of installations..."}
              </p>
            )}
          </div>
        </div>

        <div className="h-[650px] bg-white dark:bg-zinc-900 rounded-3xl shadow-md border border-gray-100 dark:border-zinc-800 overflow-hidden relative transition-colors duration-300 group">
          <MapDisplay 
            points={filteredPoints} 
            styleConfig={state.styleConfig} 
            selectedPoint={selectedPoint}
            onMarkerClick={setSelectedPoint}
            theme={theme}
          />

          {selectedPoint && (
            <div className="absolute top-4 right-4 z-[1001] w-72 sm:w-80 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md p-5 rounded-2xl shadow-2xl border border-[#CC0000]/30 animate-in slide-in-from-right-4 duration-300 transition-all">
              <div className="flex justify-between items-start mb-4 border-b dark:border-zinc-800 pb-2">
                <h3 className="font-black text-black dark:text-white text-sm leading-tight pr-4 uppercase tracking-tight">
                  {getPointTitle(selectedPoint)}
                </h3>
                <button 
                  onClick={() => setSelectedPoint(null)} 
                  className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 hover:bg-[#CC0000] hover:text-white transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {Object.entries(selectedPoint.data).map(([key, value]) => (
                  <div key={key} className="border-b border-gray-50 dark:border-zinc-800/50 pb-2 last:border-0">
                    <p className="text-[9px] font-bold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-0.5">{key}</p>
                    <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed font-semibold">{String(value) || <span className="text-zinc-300 italic">No data</span>}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {state.sheetData.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-zinc-900 p-5 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-800 transition-colors duration-300">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-[10px] font-bold text-gray-400 dark:text-zinc-500 uppercase tracking-widest">Map Configuration</h2>
                <button onClick={swapMapping} className="text-[#CC0000] hover:bg-red-50 dark:hover:bg-red-950/20 px-2 py-1 rounded text-xs font-black transition-colors">SWAP AXIS</button>
              </div>
              <div className="space-y-4">
                <p className="text-[9px] text-gray-500 dark:text-zinc-400 leading-tight">Coordinate mapping from source spreadsheet.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] text-gray-400 dark:text-zinc-500 mb-1">LATITUDE SOURCE</label>
                    <select 
                      value={state.mapping?.latColumn || ''}
                      onChange={(e) => updateMapping('lat', e.target.value)}
                      className="w-full text-sm border-gray-200 dark:border-zinc-700 border rounded-lg p-2 bg-gray-50 dark:bg-zinc-800 dark:text-zinc-200 outline-none focus:border-[#CC0000]"
                    >
                      {state.headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 dark:text-zinc-500 mb-1">LONGITUDE SOURCE</label>
                    <select 
                      value={state.mapping?.lngColumn || ''}
                      onChange={(e) => updateMapping('lng', e.target.value)}
                      className="w-full text-sm border-gray-200 dark:border-zinc-700 border rounded-lg p-2 bg-gray-50 dark:bg-zinc-800 dark:text-zinc-200 outline-none focus:border-[#CC0000]"
                    >
                      {state.headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-zinc-900 p-5 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-800 transition-colors duration-300">
              <h2 className="text-[10px] font-bold text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-4">Thematic Marker Style</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] text-gray-400 dark:text-zinc-500 mb-1">CATEGORICAL COLORING</label>
                  <select 
                    value={state.styleConfig.activeColumn || ''}
                    onChange={(e) => handleApplyStyle(e.target.value)}
                    className="w-full text-sm border-gray-200 dark:border-zinc-700 border rounded-lg p-2 bg-gray-50 dark:bg-zinc-800 dark:text-zinc-200 outline-none focus:border-[#CC0000]"
                  >
                    <option value="">Solid Wurth Red (Default)</option>
                    {state.headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                {state.styleConfig.rule && (
                  <div className="mt-4 pt-4 border-t dark:border-zinc-800 space-y-2 max-h-[100px] overflow-y-auto custom-scrollbar grid grid-cols-2 gap-x-4">
                    {Object.entries(state.styleConfig.rule.colorMap).map(([val, color]) => (
                      <div key={val} className="flex items-center gap-2 text-[10px]">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                        <span className="truncate text-gray-600 dark:text-zinc-400 font-bold">{val}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {state.sheetData.length > 0 && (
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-800 p-4 transition-colors duration-300">
            <div className="flex justify-between items-center mb-4 px-2">
              <h2 className="text-[10px] font-bold text-gray-400 dark:text-zinc-500 uppercase tracking-widest">Audit Log: Plotted Assets</h2>
              <p className="text-[10px] text-gray-400 dark:text-zinc-500 font-bold">{filteredPoints.length} Active Pins Plotted</p>
            </div>
            <DataTable headers={state.headers} rows={state.sheetData} latCol={state.mapping?.latColumn} lngCol={state.mapping?.lngColumn} />
          </div>
        )}
      </main>

      <footer className="py-6 px-6 text-center text-[9px] text-gray-400 dark:text-zinc-600 uppercase tracking-widest border-t dark:border-zinc-800 mt-auto bg-white dark:bg-zinc-950 transition-colors duration-300">
        PROPRIETARY SYSTEM | WÜRTH GROUP DATA VISUALIZATION
      </footer>
    </div>
  );
};

export default App;