/**
 * ModelSelector — dropdown component for selecting the active Ollama model.
 *
 * Fetches available models on mount via {@link useSessionStore.fetchModels},
 * displays them in a `<select>` dropdown, and persists the selection through
 * {@link useSessionStore.setModel} which sends a `PATCH /api/config/model`
 * request and updates the session store so the choice survives page reload.
 *
 * All state is managed through {@link useSessionStore}. No direct backend
 * calls are made from this component.
 *
 * @module components/ModelSelector/ModelSelector
 */

import React, { useCallback, useEffect } from 'react';
import { useSessionStore } from '../../store/session.store.js';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  backgroundColor: '#1e1e2e',
  borderBottom: '1px solid #2d2d3d',
};

const labelStyle: React.CSSProperties = {
  color: '#9ca3af',
  fontSize: 13,
  fontWeight: 500,
  whiteSpace: 'nowrap',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

const selectStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid #3d3d50',
  backgroundColor: '#121220',
  color: '#e0e0e0',
  fontSize: 13,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  outline: 'none',
  cursor: 'pointer',
  appearance: 'auto',
};

const errorStyle: React.CSSProperties = {
  color: '#f87171',
  fontSize: 12,
  marginLeft: 4,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ModelSelector: React.FC = () => {
  const availableModels = useSessionStore((s) => s.availableModels);
  const activeModel = useSessionStore((s) => s.activeModel);
  const error = useSessionStore((s) => s.error);
  const fetchModels = useSessionStore((s) => s.fetchModels);
  const setModel = useSessionStore((s) => s.setModel);

  // Fetch available models on mount
  useEffect(() => {
    void fetchModels();
  }, [fetchModels]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const selected = e.target.value;
      if (selected) {
        void setModel(selected);
      }
    },
    [setModel],
  );

  return (
    <div style={containerStyle}>
      <label htmlFor="model-selector" style={labelStyle}>
        Model:
      </label>
      <select
        id="model-selector"
        style={selectStyle}
        value={activeModel}
        onChange={handleChange}
        aria-label="Select Ollama model"
      >
        {availableModels.length === 0 && (
          <option value="" disabled>
            No models available
          </option>
        )}
        {availableModels.map((model) => (
          <option key={model.name} value={model.name}>
            {model.name}
          </option>
        ))}
      </select>
      {error && <span style={errorStyle}>{error}</span>}
    </div>
  );
};
