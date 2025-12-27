
import React, { useEffect, useRef } from 'react';
import { PlotPoint, StyleConfig } from '../types';

interface MapDisplayProps {
  points: PlotPoint[];
  styleConfig: StyleConfig;
  selectedPoint?: PlotPoint | null;
  onMarkerClick: (point: PlotPoint) => void;
  theme: 'light' | 'dark';
}

declare const L: any;

const DEFAULT_COLOR = '#CC0000';
const SELECTED_COLOR = '#000000';

const hexToRgb = (hex: string): string => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? 
    `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : 
    '204, 0, 0';
};

const MapDisplay: React.FC<MapDisplayProps> = ({ points, styleConfig, selectedPoint, onMarkerClick, theme }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<any>(null);
  const clusterGroup = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const hasInitialFit = useRef<boolean>(false);

  const LIGHT_TILES = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  const DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

  useEffect(() => {
    if (!mapRef.current) return;

    if (!leafletMap.current) {
      leafletMap.current = L.map(mapRef.current, {
        zoomControl: false,
        maxZoom: 18
      }).setView([20, 0], 2);
      
      L.control.zoom({ position: 'bottomright' }).addTo(leafletMap.current);
      
      L.control.scale({ 
        metric: true, 
        imperial: false, 
        position: 'bottomleft' 
      }).addTo(leafletMap.current);

      tileLayerRef.current = L.tileLayer(theme === 'light' ? LIGHT_TILES : DARK_TILES, {
        attribution: '&copy; CartoDB'
      }).addTo(leafletMap.current);
      
      clusterGroup.current = L.markerClusterGroup({
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        spiderfyOnMaxZoom: true,
        iconCreateFunction: (cluster: any) => {
          const markers = cluster.getAllChildMarkers();
          let totalLatento = 0;
          let hasNumericValue = false;

          markers.forEach((m: any) => {
            const val = m.options.latentoValue;
            if (val !== undefined && val !== null && val !== '') {
              const numericPart = String(val).replace(/[^0-9.-]/g, '');
              const num = parseFloat(numericPart);
              if (!isNaN(num)) {
                totalLatento += num;
                hasNumericValue = true;
              }
            }
          });

          const displayValue = hasNumericValue ? 
            (totalLatento % 1 === 0 ? totalLatento : totalLatento.toFixed(1)) : 
            cluster.getChildCount();

          return L.divIcon({ 
            html: `<div><span>${displayValue}</span></div>`, 
            className: 'latent-cluster', 
            iconSize: L.point(40, 40) 
          });
        }
      });
      
      leafletMap.current.addLayer(clusterGroup.current);
    }
  }, []);

  useEffect(() => {
    if (leafletMap.current && tileLayerRef.current) {
      tileLayerRef.current.setUrl(theme === 'light' ? LIGHT_TILES : DARK_TILES);
    }
  }, [theme]);

  const getMarkerColor = (point: PlotPoint): string => {
    if (!styleConfig.activeColumn || !styleConfig.rule) return DEFAULT_COLOR;
    const value = String(point.data[styleConfig.activeColumn]);
    return styleConfig.rule.colorMap[value] || DEFAULT_COLOR;
  };

  useEffect(() => {
    if (leafletMap.current && selectedPoint) {
      leafletMap.current.panTo([selectedPoint.lat, selectedPoint.lng], {
        animate: true,
        duration: 0.8
      });
    }
  }, [selectedPoint]);

  useEffect(() => {
    if (!leafletMap.current || !clusterGroup.current) return;

    clusterGroup.current.clearLayers();

    if (points.length === 0) {
      hasInitialFit.current = false;
      return;
    }

    points.forEach((point) => {
      const isSelected = selectedPoint && 
        selectedPoint.lat === point.lat && 
        selectedPoint.lng === point.lng &&
        JSON.stringify(selectedPoint.data) === JSON.stringify(point.data);

      const color = isSelected ? SELECTED_COLOR : getMarkerColor(point);
      const rgb = hexToRgb(color);
      
      const latentoKey = Object.keys(point.data).find(k => k.toLowerCase() === 'latento');
      const latentoValue = latentoKey ? String(point.data[latentoKey]) : '';

      const icon = L.divIcon({
        className: 'latent-marker-wrapper',
        html: `
          <div class="latent-marker-container ${isSelected ? 'is-selected' : ''}" style="--marker-color: ${color}; --marker-rgb: ${rgb};">
            <div class="latent-marker-core">
              ${latentoValue}
            </div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      const marker = L.marker([point.lat, point.lng], { 
        icon,
        latentoValue: latentoValue 
      });
      
      marker.on('click', () => onMarkerClick(point));
      
      const firstKey = Object.keys(point.data)[0];
      const label = point.data[firstKey] || 'Location';
      
      marker.bindTooltip(`
        <div class="font-sans">
          <div class="font-bold text-slate-800 dark:text-slate-100 text-sm mb-0.5">${label}</div>
          <div class="text-[10px] text-slate-400 dark:text-slate-500 font-mono uppercase tracking-wider">
            ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}
          </div>
          ${latentoKey ? `<div class="mt-1 text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded inline-block text-slate-600 dark:text-slate-300 font-bold">${latentoKey}: ${latentoValue}</div>` : ''}
        </div>
      `, { 
        direction: 'top', 
        offset: [0, -15],
        opacity: 0.95
      });
      
      clusterGroup.current.addLayer(marker);
    });

    if (points.length > 0 && !hasInitialFit.current) {
      const bounds = clusterGroup.current.getBounds();
      if (bounds.isValid()) {
        leafletMap.current.fitBounds(bounds, { padding: [50, 50] });
        hasInitialFit.current = true;
      }
    }
  }, [points, styleConfig, selectedPoint, onMarkerClick]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapRef} className="absolute inset-0 z-0" />
      {points.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-sm z-10 transition-all duration-500">
          <div className="text-center p-8">
            <div className="w-16 h-16 bg-slate-200 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
              <svg className="w-8 h-8 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <p className="text-slate-500 dark:text-slate-400 font-medium">No valid spatial data detected yet.</p>
            <p className="text-slate-400 dark:text-slate-600 text-xs mt-1 italic">Ensure your sheet has a "Latento" column for labels.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default MapDisplay;