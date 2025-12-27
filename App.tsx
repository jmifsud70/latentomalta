import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { AppState, SheetRow, PlotPoint, ColumnMapping, StyleRule } from './types.ts';
import { fetchGoogleSheetData } from './services/sheetService.ts';
import { identifyColumns } from './services/geminiService.ts';
import MapDisplay from './components/MapDisplay.tsx';
import DataTable from './components/DataTable.tsx';

// Defining AIStudio interface to resolve type mismatch errors
declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  interface Window {
    // Add readonly modifier to match existing global definitions and fix "identical modifiers" error
    readonly aistudio: AIStudio;
  }
}

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

  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const [state, setState] = useState<AppState>({
    isLoading: false,
    error: null,
    sheetData: [],
    headers: [],
    mapping: null,
    points: [],
    styleConfig: { activeColumn: null, rule: null }
  });
  
  const [selectedPoint, setSelectedPoint] = useState<PlotPoint | null>(null);
  const [selectedFilters, setSelectedFilters] = useState<string[]>([]);
  const [filterColumn, setFilterColumn] = useState<string | null>(null);

  // 1. Authentication Check
  useEffect(() => {
    const checkKey = async () => {
      // If process.env.API_KEY is already present (injected), we are good
      if (process.env.API_KEY && process.env.API_KEY.length > 5) {
        setHasApiKey(true);
        return;
      }
      
      // Otherwise check the AI Studio selector
      if (window.aistudio) {
        const has = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(has);
      } else {
        setHasApiKey(false);
      }
    };
    checkKey();
  }, []);

  const handleConnectAI = async () => {
    if (window.aistudio) {
      setIsAuthenticating(true);
      await window.aistudio.openSelectKey();
      // Assume success as per instructions to avoid race conditions
      setHasApiKey(true);
      setIsAuthenticating(false);
    } else {
      alert("AI Authentication service not available. Check your internet connection.");
    }
  };

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
    if (!val || typeof val !== 'string') return null;
    let s = val.trim().toUpperCase();
    if (!s || s === 'NULL' || s === 'UNDEFINED') return null;
    
    // Handle cardinal directions often found in GPS data
    const isNegative = s.includes('S') || s.includes('W') || s.startsWith('-');
    
    // European decimal handling (48,85 -> 48.85)
    if (s.includes(',') && !s.includes('.')) {
      const commaCount = (s.match(/,/g) || []).length;
      if (commaCount === 1) s = s.replace(',', '.');
    }
    
    const cleaned = s.replace(/[^0-9.-]/g, '');
    const num = parseFloat(cleaned);
    
    if (isNaN(num) || !isFinite(num)) return null;
    return isNegative ? -Math.abs(num) : Math.abs(num);
  };

  const processPoints = useCallback((rows: SheetRow[], mapping: ColumnMapping | null): PlotPoint[] => {
    if (!mapping || !mapping.latColumn || !mapping.lngColumn) return [];
    
    const validPoints: PlotPoint[] = [];
    const isSameColumn = mapping.latColumn === mapping.lngColumn;

    rows.forEach(row => {
      let lat: number | null = null;
      let lng: number | null = null;
      
      const rawLat = String(row[mapping.latColumn] || '');
      const rawLng = String(row[mapping.lngColumn] || '');

      if (isSameColumn) {
        const combined = rawLat;
        const parts = combined.split(/[,;\s]+/).filter(p => p.trim());
        if (parts.length >= 2) {
          lat = cleanAndParse(parts[0]);
          lng = cleanAndParse(parts[1]);
        }
      } else {
        lat = cleanAndParse(rawLat);
        lng = cleanAndParse(rawLng);
      }
      
      // SKIP logic: only push if both are valid coordinates and not [0,0]
      if (
        lat !== null && 
        lng !== null && 
        lat >= -90 && lat <= 90 && 
        lng >= -180 && lng <= 180 && 
        (lat !== 0 || lng !== 0)
      ) {
        validPoints.push({ lat, lng, data: row });
      }
    });
    return validPoints;
  }, []);

  const handleFetch = useCallback(async () => {
    if (!hasApiKey) return;

    setState(prev => ({ ...prev, isLoading: true, error: null, points: [], sheetData: [], mapping: null }));
    setSelectedPoint(null);
    setSelectedFilters([]);
    
    try {
      const { headers, rows } = await fetchGoogleSheetData(DEFAULT_SHEET_URL);
      const mapping = await identifyColumns(headers, rows);
      const validPoints = processPoints(rows, mapping);
      
      const possibleFilterCol = headers.find(h => 
        ['type', 'installation type', 'category', 'status', 'installation', 'model'].some(keyword => h.toLowerCase().includes(keyword))
      ) || null;
      setFilterColumn(possibleFilterCol);

      setState(prev => ({ ...prev, isLoading: false, error: null, sheetData: rows, headers, mapping, points: validPoints }));
      
      if (possibleFilterCol) {
        const types = Array.from(new Set(rows.map(row => String(row[possibleFilterCol] || 'Unknown'))))
          .filter(t => t.trim() !== '')
          .sort();
        setSelectedFilters(types);
      }
    } catch (err: any) {
      setState(prev => ({ ...prev, isLoading: false, error: err.message }));
      if (err.message?.includes("entity was not found")) setHasApiKey(false);
    }
  }, [processPoints, hasApiKey]);

  useEffect(() => {
    if (hasApiKey) handleFetch();
  }, [handleFetch, hasApiKey]);

  const uniqueInstallationTypes = useMemo(() => {
    if (!filterColumn || !state.sheetData.length) return [];
    return Array.from(new Set(state.sheetData.map(row => String(row[filterColumn] || 'Unknown'))))
      .filter(t => t.trim() !== '')
      .sort();
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
    setSelectedFilters(isAllSelected ? [] : uniqueInstallationTypes);
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
    const latentoKey = Object.keys(point.data).find(k => k.toLowerCase() === 'latento');
    if (latentoKey) return String(point.data[latentoKey]);
    const firstKey = Object.keys(point.data)[0];
    return firstKey ? String(point.data[firstKey]) : 'Location Details';
  };

  if (hasApiKey === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-black p-6 font-sans">
        <div className="max-w-md w-full bg-white dark:bg-zinc-900 rounded-3xl p-10 shadow-2xl border border-gray-100 dark:border-zinc-800 text-center space-y-8 animate-in fade-in zoom-in duration-500">
          <div className="w-20 h-20 bg-[#CC0000] rounded-2xl flex items-center justify-center text-white font-black text-4xl shadow-xl mx-auto ring-8 ring-red-50 dark:ring-red-900/10">W</div>
          <div className="space-y-2">
            <h1 className="text-2xl font-black text-black dark:text-white uppercase tracking-tight">Security & Connection</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
              To visualize the Latento installation data, this app requires a secure connection to Google Gemini AI. Please authorize using your paid API key.
            </p>
          </div>
          <button 
            onClick={handleConnectAI}
            disabled={isAuthenticating}
            className="w-full py-4 px-6 bg-[#CC0000] hover:bg-black dark:hover:bg-white dark:hover:text-black text-white font-black rounded-2xl transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
          >
            {isAuthenticating ? (
              <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
                AUTHORIZE GEMINI AI
              </>
            )}
          </button>
          <p className="text-[10px] text-zinc-400 dark:text-zinc-600 font-bold uppercase tracking-widest">
            Requires a paid Google Cloud Project <br/>
            <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="underline hover:text-[#CC0000]">Learn about billing</a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-black font-sans transition-colors duration-300">
      <header className="bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md border-b dark:border-zinc-800 px-6 py-4 flex items-center justify-between sticky top-0 z-[1000] shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#CC0000] rounded-sm flex items-center justify-center text-white font-black text-2xl shadow-lg">W</div>
          <div className="hidden sm:block">
            <h1 className="text-xl font-black text-black dark:text-white tracking-tighter leading-none">WÜRTH MALTA</h1>
            <p className="text-[9px] font-black text-[#CC0000] uppercase tracking-[0.2em]">Asset Intelligence</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {state.isLoading && (
            <div className="flex items-center gap-3 text-[#CC0000]">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="text-xs font-black uppercase tracking-widest animate-pulse">Syncing...</span>
            </div>
          )}
          <button 
            onClick={toggleTheme}
            className="p-2.5 rounded-xl bg-slate-100 dark:bg-zinc-800 hover:bg-[#CC0000] hover:text-white transition-all text-slate-500 dark:text-zinc-400"
          >
            {theme === 'light' ? (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M16.243 16.243l.707.707M7.757 7.757l.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" /></svg>
            )}
          </button>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-8 flex flex-col gap-8 max-w-[1600px] mx-auto w-full">
        {state.error && (
          <div className="bg-red-50 dark:bg-red-950/20 border-l-4 border-red-600 text-red-700 dark:text-red-400 p-5 rounded-r-2xl text-sm flex items-center justify-between">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/></svg>
              <span className="font-bold">{state.error}</span>
            </div>
            <button onClick={handleConnectAI} className="text-xs font-black underline uppercase">Reset Connection</button>
          </div>
        )}
          
        <div className="bg-white dark:bg-zinc-900 p-8 rounded-3xl shadow-sm border border-gray-100 dark:border-zinc-800">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <h2 className="text-4xl font-black text-black dark:text-white uppercase tracking-tighter mb-2">
                Latento Installations <span className="text-[#CC0000]">Malta</span>
              </h2>
              <p className="text-xs font-bold text-zinc-500 dark:text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                LIVE SPATIAL DATA FEED
              </p>
            </div>
            
            {filterColumn && (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleToggleAll}
                  className={`px-5 py-2.5 rounded-xl text-[10px] font-black transition-all shadow-sm border ${
                    isAllSelected 
                    ? 'bg-black text-white border-black dark:bg-white dark:text-black' 
                    : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-[#CC0000]'
                  }`}
                >
                  TOGGLE ALL
                </button>
                {uniqueInstallationTypes.map(type => {
                  const isActive = selectedFilters.includes(type);
                  return (
                    <button
                      key={type}
                      onClick={() => handleToggleFilter(type)}
                      className={`px-5 py-2.5 rounded-xl text-[10px] font-black transition-all shadow-sm flex items-center gap-3 border ${
                        isActive 
                        ? 'bg-[#CC0000] text-white border-[#CC0000] ring-4 ring-red-50 dark:ring-red-900/10' 
                        : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-[#CC0000]'
                      }`}
                    >
                      <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-white' : 'bg-zinc-300 dark:bg-zinc-600'}`}></div>
                      {type.toUpperCase()}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="h-[750px] bg-white dark:bg-zinc-900 rounded-[2.5rem] shadow-2xl border border-gray-100 dark:border-zinc-800 overflow-hidden relative group">
          <MapDisplay 
            points={filteredPoints} 
            styleConfig={state.styleConfig} 
            selectedPoint={selectedPoint}
            onMarkerClick={setSelectedPoint}
            theme={theme}
          />

          {selectedPoint && (
            <div className="absolute top-8 right-8 z-[1001] w-80 sm:w-96 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl p-8 rounded-3xl shadow-2xl border border-[#CC0000]/20 animate-in slide-in-from-right-8 duration-500">
              <div className="flex justify-between items-start mb-6 pb-4 border-b dark:border-zinc-800">
                <div className="flex-1">
                  <p className="text-[10px] font-black text-[#CC0000] uppercase tracking-widest mb-1">Installation Identified</p>
                  <h3 className="font-black text-black dark:text-white text-xl leading-none uppercase tracking-tight">
                    {getPointTitle(selectedPoint)}
                  </h3>
                </div>
                <button 
                  onClick={() => setSelectedPoint(null)} 
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-500 hover:bg-[#CC0000] hover:text-white transition-all"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              <div className="space-y-5 max-h-[450px] overflow-y-auto pr-2 custom-scrollbar">
                {Object.entries(selectedPoint.data).map(([key, value]) => (
                  <div key={key} className="space-y-1">
                    <p className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">{key}</p>
                    <p className="text-sm text-zinc-800 dark:text-zinc-100 font-bold bg-slate-50 dark:bg-white/5 p-3 rounded-xl border border-transparent hover:border-[#CC0000]/20 transition-all">
                      {String(value) || <span className="text-zinc-300 italic">No entry</span>}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white dark:bg-zinc-900 p-8 rounded-3xl shadow-sm border border-gray-100 dark:border-zinc-800">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-xs font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-[0.2em]">Map Configuration</h2>
              <button onClick={swapMapping} className="px-4 py-2 bg-red-50 dark:bg-red-950/20 text-[#CC0000] rounded-xl text-[10px] font-black hover:bg-[#CC0000] hover:text-white transition-all">SWAP AXIS</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Lat Source</label>
                <select 
                  value={state.mapping?.latColumn || ''}
                  onChange={(e) => updateMapping('lat', e.target.value)}
                  className="w-full text-xs font-bold border-zinc-200 dark:border-zinc-700 border rounded-xl p-4 bg-zinc-50 dark:bg-black outline-none focus:ring-2 focus:ring-[#CC0000] transition-all"
                >
                  {state.headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Lng Source</label>
                <select 
                  value={state.mapping?.lngColumn || ''}
                  onChange={(e) => updateMapping('lng', e.target.value)}
                  className="w-full text-xs font-bold border-zinc-200 dark:border-zinc-700 border rounded-xl p-4 bg-zinc-50 dark:bg-black outline-none focus:ring-2 focus:ring-[#CC0000] transition-all"
                >
                  {state.headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 p-8 rounded-3xl shadow-sm border border-gray-100 dark:border-zinc-800">
            <h2 className="text-xs font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-[0.2em] mb-8">Dynamic Marker Style</h2>
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Thematic Layer</label>
                <select 
                  value={state.styleConfig.activeColumn || ''}
                  onChange={(e) => handleApplyStyle(e.target.value)}
                  className="w-full text-xs font-bold border-zinc-200 dark:border-zinc-700 border rounded-xl p-4 bg-zinc-50 dark:bg-black outline-none focus:ring-2 focus:ring-[#CC0000] transition-all"
                >
                  <option value="">Static (Wurth Corporate Red)</option>
                  {state.headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              {state.styleConfig.rule && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[120px] overflow-y-auto pr-2 custom-scrollbar">
                  {Object.entries(state.styleConfig.rule.colorMap).map(([val, color]) => (
                    <div key={val} className="flex items-center gap-3 p-2 rounded-lg bg-slate-50 dark:bg-black border border-transparent">
                      <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: color }} />
                      <span className="truncate text-[9px] text-zinc-600 dark:text-zinc-400 font-black uppercase tracking-wider">{val}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {state.sheetData.length > 0 && (
          <div className="bg-white dark:bg-zinc-900 rounded-[2.5rem] shadow-sm border border-gray-100 dark:border-zinc-800 p-8">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-xs font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-[0.2em]">Audit Ledger</h2>
              <div className="px-4 py-2 bg-zinc-100 dark:bg-black rounded-full text-[10px] font-black text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800">
                {filteredPoints.length} ASSETS DEPLOYED
              </div>
            </div>
            <DataTable headers={state.headers} rows={state.sheetData} latCol={state.mapping?.latColumn} lngCol={state.mapping?.lngColumn} />
          </div>
        )}
      </main>

      <footer className="py-10 px-8 flex flex-col items-center gap-4 text-center border-t dark:border-zinc-800 mt-auto bg-white dark:bg-zinc-950">
        <div className="flex items-center gap-2 opacity-30 grayscale contrast-200">
           <div className="w-6 h-6 bg-black dark:bg-white rounded-sm"></div>
           <span className="text-sm font-black text-black dark:text-white">WÜRTH GROUP</span>
        </div>
        <p className="text-[10px] text-zinc-400 dark:text-zinc-600 font-bold uppercase tracking-[0.3em]">
          PROPRIETARY GEOSPATIAL INTELLIGENCE SYSTEM
        </p>
      </footer>
    </div>
  );
};

export default App;