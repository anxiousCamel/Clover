/**
 * FilePreview — displays metadata for a selected file entry: name,
 * type, size, and modification time.
 *
 * When a file is selected in the {@link FileTree}, this component
 * renders a compact detail card. It also fetches and displays the file
 * content via `GET /api/files?path=`.
 *
 * All backend communication goes through {@link httpClient}.
 *
 * @module components/FileExplorer/FilePreview
 */

import React, { useEffect, useState } from 'react';
import * as httpClient from '../../api/http.client.js';
import type { FileNode } from './FileTree.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Props accepted by {@link FilePreview}. */
export interface FilePreviewProps {
  /** The selected file node from the tree. */
  node: FileNode;
  /** Full relative path to the file within the workspace. */
  path: string;
}

/** Shape returned by `GET /api/files?path=`. */
interface FileContentResponse {
  content: string;
  mtime: string;
  size: number;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: '#121220',
  color: '#e0e0e0',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderLeft: '1px solid #2d2d3d',
  height: '100%',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderBottom: '1px solid #2d2d3d',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const fileNameStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: '#e0e0e0',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const metaGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  gap: '2px 12px',
  fontSize: 12,
  color: '#a0a0b0',
};

const metaLabelStyle: React.CSSProperties = {
  fontWeight: 600,
  color: '#6b6b80',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  fontSize: 10,
};

const metaValueStyle: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const contentAreaStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '12px 14px',
};

const codeBlockStyle: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontFamily: '"Fira Code", "Cascadia Code", "Consolas", monospace',
  fontSize: 12,
  lineHeight: 1.6,
  margin: 0,
  color: '#c0c0d0',
  backgroundColor: '#1a1a28',
  padding: 12,
  borderRadius: 6,
};

const loadingStyle: React.CSSProperties = {
  padding: '16px 14px',
  color: '#6b6b80',
  fontSize: 13,
  textAlign: 'center',
};

const errorStyle: React.CSSProperties = {
  padding: '8px 14px',
  color: '#f87171',
  fontSize: 13,
};

const emptyStyle: React.CSSProperties = {
  padding: '16px 14px',
  color: '#6b6b80',
  fontSize: 13,
  textAlign: 'center',
  fontStyle: 'italic',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a byte count into a human-readable string.
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Format an ISO 8601 timestamp into a locale-friendly string.
 */
function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

/**
 * Derive a human-readable file type label from the file name.
 */
function getFileTypeLabel(name: string, type: 'file' | 'directory'): string {
  if (type === 'directory') return 'Directory';

  const dotIndex = name.lastIndexOf('.');
  if (dotIndex === -1 || dotIndex === 0) return 'File';

  const ext = name.slice(dotIndex + 1).toLowerCase();

  const typeMap: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript (React)',
    js: 'JavaScript',
    jsx: 'JavaScript (React)',
    json: 'JSON',
    md: 'Markdown',
    html: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    yaml: 'YAML',
    yml: 'YAML',
    toml: 'TOML',
    py: 'Python',
    rs: 'Rust',
    go: 'Go',
    sh: 'Shell Script',
    sql: 'SQL',
    proto: 'Protobuf',
    txt: 'Text',
    svg: 'SVG',
    png: 'PNG Image',
    jpg: 'JPEG Image',
    gif: 'GIF Image',
  };

  return typeMap[ext] ?? `${ext.toUpperCase()} File`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FilePreview: React.FC<FilePreviewProps> = ({ node, path: filePath }) => {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch file content when a file (not directory) is selected
  useEffect(() => {
    if (node.type === 'directory') {
      setContent(null);
      setError(null);
      return;
    }

    let cancelled = false;

    async function fetchContent(): Promise<void> {
      setLoading(true);
      setError(null);
      setContent(null);

      try {
        const response = await httpClient.get<FileContentResponse>(
          `/files?path=${encodeURIComponent(filePath)}`,
        );

        if (!cancelled) {
          setContent(response.content);
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : 'Failed to load file content';
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchContent();

    return () => {
      cancelled = true;
    };
  }, [node, filePath]);

  const typeLabel = getFileTypeLabel(node.name, node.type);

  return (
    <div style={containerStyle}>
      {/* Metadata header */}
      <div style={headerStyle}>
        <div style={fileNameStyle} title={filePath}>
          {node.name}
        </div>
        <div style={metaGridStyle}>
          <span style={metaLabelStyle}>Type</span>
          <span style={metaValueStyle}>{typeLabel}</span>

          <span style={metaLabelStyle}>Size</span>
          <span style={metaValueStyle}>{formatSize(node.size)}</span>

          <span style={metaLabelStyle}>Modified</span>
          <span style={metaValueStyle}>{formatDate(node.mtime)}</span>

          <span style={metaLabelStyle}>Path</span>
          <span style={metaValueStyle} title={filePath}>
            {filePath}
          </span>
        </div>
      </div>

      {/* File content area */}
      <div style={contentAreaStyle}>
        {node.type === 'directory' && (
          <div style={emptyStyle}>Select a file to view its content.</div>
        )}

        {node.type === 'file' && loading && (
          <div style={loadingStyle}>Loading file content…</div>
        )}

        {node.type === 'file' && error && <div style={errorStyle}>{error}</div>}

        {node.type === 'file' && !loading && !error && content !== null && (
          <pre style={codeBlockStyle}>{content}</pre>
        )}
      </div>
    </div>
  );
};
