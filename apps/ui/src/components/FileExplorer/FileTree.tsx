/**
 * FileTree — renders an expandable / collapsible directory tree fetched
 * from the backend `GET /api/filesystem/tree` endpoint.
 *
 * The component fetches the tree on mount (and whenever `root` or
 * `depth` props change), then renders each node recursively.
 * Directories can be expanded or collapsed by clicking the row.
 * Clicking a file invokes the optional `onSelectFile` callback so that
 * a parent component can display a preview or fetch file content.
 *
 * All backend communication goes through {@link httpClient}.
 *
 * @module components/FileExplorer/FileTree
 */

import React, { useCallback, useEffect, useState } from 'react';
import * as httpClient from '../../api/http.client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of a single node returned by `GET /api/filesystem/tree`. */
export interface FileNode {
  name: string;
  type: 'file' | 'directory';
  size: number;
  mtime: string;
  children?: FileNode[];
}

/** Props accepted by {@link FileTree}. */
export interface FileTreeProps {
  /** Relative root path to list (default `"."`). */
  root?: string;
  /** Maximum directory depth to fetch (default `3`). */
  depth?: number;
  /** Callback fired when the user clicks a file node. */
  onSelectFile?: (node: FileNode, path: string) => void;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  backgroundColor: '#121220',
  color: '#e0e0e0',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  fontSize: 13,
  overflowY: 'auto',
  padding: '8px 0',
};

const headerStyle: React.CSSProperties = {
  padding: '4px 12px 8px',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#6b6b80',
  borderBottom: '1px solid #2d2d3d',
  marginBottom: 4,
};

const loadingStyle: React.CSSProperties = {
  padding: '16px 12px',
  color: '#6b6b80',
  fontSize: 13,
  textAlign: 'center',
};

const errorStyle: React.CSSProperties = {
  padding: '8px 12px',
  color: '#f87171',
  fontSize: 13,
};

const nodeRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 8px',
  cursor: 'pointer',
  borderRadius: 4,
  userSelect: 'none',
};

const nodeRowHoverBg = '#1e1e2e';

const iconStyle: React.CSSProperties = {
  flexShrink: 0,
  width: 16,
  textAlign: 'center',
  fontSize: 12,
};

const nameStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const childrenContainerStyle: React.CSSProperties = {
  paddingLeft: 12,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple icon representation for file / directory nodes. */
function nodeIcon(node: FileNode, expanded: boolean): string {
  if (node.type === 'directory') {
    return expanded ? '📂' : '📁';
  }
  return '📄';
}

// ---------------------------------------------------------------------------
// TreeNode (recursive)
// ---------------------------------------------------------------------------

interface TreeNodeProps {
  node: FileNode;
  parentPath: string;
  onSelectFile?: (node: FileNode, path: string) => void;
}

const TreeNode: React.FC<TreeNodeProps> = ({ node, parentPath, onSelectFile }) => {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);

  const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;

  const handleClick = useCallback(() => {
    if (node.type === 'directory') {
      setExpanded((prev) => !prev);
    } else {
      onSelectFile?.(node, fullPath);
    }
  }, [node, fullPath, onSelectFile]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick],
  );

  const rowBg = hovered ? nodeRowHoverBg : 'transparent';

  return (
    <div>
      <div
        role="treeitem"
        tabIndex={0}
        aria-expanded={node.type === 'directory' ? expanded : undefined}
        aria-label={`${node.type === 'directory' ? 'Directory' : 'File'}: ${node.name}`}
        style={{ ...nodeRowStyle, backgroundColor: rowBg }}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <span style={iconStyle}>{nodeIcon(node, expanded)}</span>
        <span style={nameStyle}>{node.name}</span>
      </div>

      {node.type === 'directory' && expanded && node.children && (
        <div style={childrenContainerStyle} role="group">
          {node.children.map((child) => (
            <TreeNode
              key={child.name}
              node={child}
              parentPath={fullPath}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// FileTree (main export)
// ---------------------------------------------------------------------------

export const FileTree: React.FC<FileTreeProps> = ({
  root = '.',
  depth = 3,
  onSelectFile,
}) => {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchTree(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const nodes = await httpClient.get<FileNode[]>(
          `/filesystem/tree?root=${encodeURIComponent(root)}&depth=${depth}`,
        );

        if (!cancelled) {
          setTree(nodes);
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : 'Failed to load file tree';
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchTree();

    return () => {
      cancelled = true;
    };
  }, [root, depth]);

  return (
    <div style={containerStyle} role="tree" aria-label="File explorer">
      <div style={headerStyle}>Explorer</div>

      {loading && <div style={loadingStyle}>Loading…</div>}

      {error && <div style={errorStyle}>{error}</div>}

      {!loading && !error && tree.length === 0 && (
        <div style={loadingStyle}>No files found.</div>
      )}

      {!loading &&
        !error &&
        tree.map((node) => (
          <TreeNode
            key={node.name}
            node={node}
            parentPath=""
            onSelectFile={onSelectFile}
          />
        ))}
    </div>
  );
};
