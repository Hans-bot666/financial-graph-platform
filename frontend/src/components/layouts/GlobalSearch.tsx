import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Clock3, LayoutDashboard, Network, Search, Trash2, X } from 'lucide-react';
import { BOARD_STORE_EVENT, listBoards, listSubGraphs } from '@/services/board-store';
import type { GraphData, SceneBoard, SubGraph } from '@/types/index';
import { cn } from '@/lib/utils';

const HISTORY_KEY = 'financial-global-search-history-v1';
const HISTORY_LIMIT = 8;
const RESULT_LIMIT = 20;

interface GlobalSearchProps {
  onOpenScene: (sceneBoardId: string) => void;
  onOpenSubGraph: (sceneBoardId: string, graphData: GraphData) => void;
}

interface HistoryEntry {
  type: 'scene' | 'subgraph';
  id: string;
  accessedAt: string;
}

interface SearchResult {
  type: 'scene' | 'subgraph';
  id: string;
  title: string;
  subtitle: string;
  timestamp: string;
  sceneBoardId: string;
  graphData?: GraphData;
  thumbnail?: string | null;
  theme?: string;
}

const THEME_PREVIEW: Record<string, string> = {
  default: 'bg-blue-50 text-blue-600',
  green: 'bg-emerald-50 text-emerald-600',
  purple: 'bg-purple-50 text-purple-600',
  orange: 'bg-orange-50 text-orange-600',
  cyan: 'bg-cyan-50 text-cyan-600',
};

function readHistory(): HistoryEntry[] {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown;
    return Array.isArray(value) ? value.slice(0, HISTORY_LIMIT) as HistoryEntry[] : [];
  } catch {
    return [];
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return `更新于 ${date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })}`;
}

function buildResults(boards: SceneBoard[], subGraphs: SubGraph[]): SearchResult[] {
  const boardById = new Map(boards.map((board) => [board.id, board]));
  return [
    ...boards.map<SearchResult>((board) => ({
      type: 'scene',
      id: board.id,
      title: board.name,
      subtitle: board.description?.trim() || '场景看板',
      timestamp: board.updated_at || board.created_at,
      sceneBoardId: board.id,
      theme: board.theme,
    })),
    ...subGraphs.map<SearchResult>((subGraph) => {
      const board = boardById.get(subGraph.scene_board_id);
      return {
        type: 'subgraph',
        id: subGraph.id,
        title: subGraph.name,
        subtitle: `子图 · ${board?.name ?? '所属场景已删除'}`,
        timestamp: subGraph.updated_at || subGraph.created_at,
        sceneBoardId: subGraph.scene_board_id,
        graphData: subGraph.graph_data,
        thumbnail: subGraph.thumbnail,
      };
    }),
  ];
}

const GlobalSearch: React.FC<GlobalSearchProps> = ({ onOpenScene, onOpenSubGraph }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [boards, setBoards] = useState<SceneBoard[]>(() => listBoards());
  const [subGraphs, setSubGraphs] = useState<SubGraph[]>(() => listSubGraphs());
  const [history, setHistory] = useState<HistoryEntry[]>(readHistory);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const refresh = () => {
      setBoards(listBoards());
      setSubGraphs(listSubGraphs());
    };
    window.addEventListener(BOARD_STORE_EVENT, refresh);
    return () => window.removeEventListener(BOARD_STORE_EVENT, refresh);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const allResults = useMemo(() => buildResults(boards, subGraphs), [boards, subGraphs]);

  const visibleResults = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN');
    if (!normalized) {
      const byKey = new Map(allResults.map((item) => [`${item.type}:${item.id}`, item]));
      return history
        .map((entry) => byKey.get(`${entry.type}:${entry.id}`))
        .filter((item): item is SearchResult => Boolean(item))
        .slice(0, HISTORY_LIMIT);
    }
    return allResults
      .filter((item) =>
        `${item.title} ${item.subtitle}`.toLocaleLowerCase('zh-CN').includes(normalized),
      )
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, RESULT_LIMIT);
  }, [allResults, history, query]);

  useEffect(() => setActiveIndex(-1), [query, open]);

  const remember = (result: SearchResult) => {
    const next = [
      { type: result.type, id: result.id, accessedAt: new Date().toISOString() },
      ...history.filter((item) => !(item.type === result.type && item.id === result.id)),
    ].slice(0, HISTORY_LIMIT);
    setHistory(next);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  };

  const openResult = (result: SearchResult) => {
    remember(result);
    setOpen(false);
    if (result.type === 'scene') {
      onOpenScene(result.sceneBoardId);
    } else if (result.graphData) {
      onOpenSubGraph(result.sceneBoardId, result.graphData);
    }
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem(HISTORY_KEY);
    setActiveIndex(-1);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, visibleResults.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      const result = visibleResults[activeIndex];
      if (result) openResult(result);
    }
  };

  const expanded = open || query.length > 0;

  return (
    <div
      ref={rootRef}
      className={cn(
        'relative h-9 transition-[width] duration-300 ease-out motion-reduce:transition-none',
        expanded ? 'w-full max-w-xl' : 'w-50',
      )}
    >
      <Search
        className={cn(
          'pointer-events-none absolute top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground',
          'transition-[left,transform,color] duration-300 ease-out motion-reduce:transition-none',
          'left-3',
        )}
      />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={expanded ? '搜索场景或子图' : '搜索'}
        aria-label="搜索场景或子图"
        aria-expanded={open}
        className={cn(
          'h-9 w-full rounded-full border border-border bg-secondary/30 text-sm outline-none',
          'transition-[padding,background-color,border-color,box-shadow] duration-300 ease-out',
          'placeholder:text-muted-foreground/70 focus:border-primary/40 focus:bg-white focus:ring-2 focus:ring-primary/10',
          'motion-reduce:transition-none',
          expanded ? 'cursor-text pl-9 pr-9' : 'cursor-pointer pl-9 pr-3 caret-transparent',
        )}
      />
      {query && (
        <button
          type="button"
          onClick={() => {
            setQuery('');
            setOpen(true);
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="清空搜索"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {open && (
        <div className="absolute left-1/2 top-[calc(100%+0.55rem)] z-[70] w-[min(46rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-white shadow-[0_18px_50px_-18px_rgba(15,23,42,0.35)]">
          <div className="flex items-center justify-between border-b border-border/70 px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs font-medium text-foreground">
              {!query.trim() && <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />}
              {query.trim() ? `搜索结果（${visibleResults.length}）` : '最近搜索'}
            </div>
            <div className="flex items-center gap-1">
              {!query.trim() && history.length > 0 && (
                <button
                  type="button"
                  onClick={clearHistory}
                  className="flex h-7 items-center gap-1 rounded px-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  清除历史
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-label="关闭搜索"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="max-h-[min(30rem,70vh)] overflow-y-auto p-2">
            {visibleResults.length === 0 ? (
              <div className="flex min-h-28 flex-col items-center justify-center px-4 text-center">
                <Search className="mb-2 h-6 w-6 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {query.trim() ? '未找到相关场景或子图' : '暂无搜索历史'}
                </p>
              </div>
            ) : (
              visibleResults.map((result, index) => (
                <button
                  key={`${result.type}:${result.id}`}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => openResult(result)}
                  className={cn(
                    'grid w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                    activeIndex === index ? 'bg-primary/5' : 'hover:bg-secondary/60',
                  )}
                >
                  {result.type === 'subgraph' && result.thumbnail ? (
                    <img
                      src={result.thumbnail}
                      alt=""
                      className="h-9 w-10 rounded-md border border-border bg-secondary object-contain"
                    />
                  ) : (
                    <span
                      className={cn(
                        'flex h-9 w-10 items-center justify-center rounded-md',
                        result.type === 'scene'
                          ? THEME_PREVIEW[result.theme ?? 'default'] ?? THEME_PREVIEW.default
                          : 'bg-cyan-50 text-cyan-600',
                      )}
                    >
                      {result.type === 'scene'
                        ? <LayoutDashboard className="h-4 w-4" />
                        : <Network className="h-4 w-4" />}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{result.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{result.subtitle}</span>
                  </span>
                  <span className="whitespace-nowrap pl-4 text-xs text-muted-foreground">
                    {formatDate(result.timestamp)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default GlobalSearch;
