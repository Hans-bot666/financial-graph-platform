import React, { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Pencil, Plus, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { createBoard, deleteBoard, deleteSubGraph, listBoards, listSubGraphs, localGraphStats, updateBoard } from '@/services/board-store';
import type { GraphStats, SceneBoard, SubGraph } from '@/types/index';

const REFRESH_INTERVAL = 30_000;

const THEME_COLORS: Record<string, { dot: string; border: string; label: string; bg: string }> = {
  default: { dot: 'bg-primary', border: 'border-primary/20', label: '系统蓝', bg: 'bg-primary/5' },
  green: { dot: 'bg-green-500', border: 'border-green-200', label: '森林绿', bg: 'bg-green-50' },
  purple: { dot: 'bg-purple-500', border: 'border-purple-200', label: '星云紫', bg: 'bg-purple-50' },
  orange: { dot: 'bg-orange-500', border: 'border-orange-200', label: '活力橙', bg: 'bg-orange-50' },
  cyan: { dot: 'bg-cyan-500', border: 'border-cyan-200', label: '科技青', bg: 'bg-cyan-50' },
};

interface HomePageProps {
  focusBoardRequest?: { id: string; requestId: number } | null;
  onNavigateToExplore: (sceneBoardId: string, graphData?: import('@/types/index').GraphData) => void;
}

interface SceneBoardFormValues {
  name: string;
  theme: string;
  description: string;
}

const HomePage: React.FC<HomePageProps> = ({ focusBoardRequest, onNavigateToExplore }) => {
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [sceneBoards, setSceneBoards] = useState<SceneBoard[]>([]);
  const [subGraphs, setSubGraphs] = useState<SubGraph[]>([]);
  const [boardsLoading, setBoardsLoading] = useState(true);
  const [highlightedBoardId, setHighlightedBoardId] = useState<string | null>(null);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingBoard, setEditingBoard] = useState<SceneBoard | null>(null);
  const [deletingBoardId, setDeletingBoardId] = useState<string | null>(null);
  const [deleteSubGraphId, setDeleteSubGraphId] = useState<string | null>(null);
  const [deleteSubGraphDialogOpen, setDeleteSubGraphDialogOpen] = useState(false);

  const createForm = useForm<SceneBoardFormValues>({
    defaultValues: { name: '', theme: 'default', description: '' },
  });
  const editForm = useForm<SceneBoardFormValues>({
    defaultValues: { name: '', theme: 'default', description: '' },
  });

  const loadStats = useCallback(async () => {
    setStats(localGraphStats());
    setStatsLoading(false);
  }, []);

  const loadSceneBoards = useCallback(async () => {
    setBoardsLoading(true);
    setSceneBoards(listBoards());
    setSubGraphs(listSubGraphs());
    setBoardsLoading(false);
  }, []);

  useEffect(() => {
    loadStats();
    loadSceneBoards();
    const interval = setInterval(loadStats, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [loadStats, loadSceneBoards]);

  useEffect(() => {
    if (!focusBoardRequest || boardsLoading) return;
    const element = document.getElementById(`scene-board-${focusBoardRequest.id}`);
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    setHighlightedBoardId(focusBoardRequest.id);
    const timer = window.setTimeout(() => setHighlightedBoardId(null), 2200);
    return () => window.clearTimeout(timer);
  }, [boardsLoading, focusBoardRequest]);

  const handleCreateBoard = async (values: SceneBoardFormValues) => {
    createBoard({
      name: values.name,
      theme: values.theme,
      description: values.description || null,
    });
    toast.success('场景看板已创建');
    setCreateDialogOpen(false);
    createForm.reset();
    loadSceneBoards();
  };

  const handleEditBoard = async (values: SceneBoardFormValues) => {
    if (!editingBoard) return;
    updateBoard(editingBoard.id, { name: values.name, theme: values.theme, description: values.description || null });
    toast.success('已更新');
    setEditDialogOpen(false);
    setEditingBoard(null);
    loadSceneBoards();
  };

  const handleDeleteBoard = async () => {
    if (!deletingBoardId) return;
    deleteBoard(deletingBoardId);
    toast.success('已删除');
    setDeleteDialogOpen(false);
    setDeletingBoardId(null);
    loadSceneBoards();
  };

  const handleDeleteSubGraph = async () => {
    if (!deleteSubGraphId) return;
    deleteSubGraph(deleteSubGraphId);
    toast.success('子图已删除');
    setDeleteSubGraphDialogOpen(false);
    setDeleteSubGraphId(null);
    loadSceneBoards();
  };

  const openEditDialog = (board: SceneBoard) => {
    setEditingBoard(board);
    editForm.reset({ name: board.name, theme: board.theme, description: board.description || '' });
    setEditDialogOpen(true);
  };

  const getBoardSubGraphs = (boardId: string) =>
    subGraphs.filter((s) => s.scene_board_id === boardId);

  const openCreate = () => {
    createForm.reset();
    setCreateDialogOpen(true);
  };

  return (
    <div className="flex h-[calc(100vh-48px)] flex-col overflow-hidden bg-[#f5f7fb]">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1400px] px-6 py-5 pb-28">
          {/* 页头 */}
          <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl font-semibold tracking-tight text-foreground">场景看板</h1>
                <Badge className="border-0 bg-primary/10 px-2 py-0.5 text-xs font-normal text-primary">
                  {sceneBoards.length} 个场景
                </Badge>
              </div>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
                管理分析场景与已保存子图，从看板快速进入探索视图继续研判。
              </p>
            </div>
            <Button size="sm" onClick={openCreate} className="h-9 shrink-0 px-4 text-sm font-medium shadow-sm">
              <Plus className="mr-1 h-4 w-4" />
              新建场景
            </Button>
          </div>

          {/* 统计横幅 */}
          <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-primary/10 bg-gradient-to-r from-primary/[0.07] to-sky-50/80 px-5 py-3.5">
            <div className="flex items-center gap-2 text-sm text-foreground/80">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/80 text-primary shadow-sm">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <circle cx="4" cy="4" r="2" fill="currentColor" opacity="0.9" />
                  <circle cx="12" cy="4" r="2" fill="currentColor" opacity="0.9" />
                  <circle cx="8" cy="12" r="2" fill="currentColor" opacity="0.9" />
                  <path d="M4 4 L12 4 M4 4 L8 12 M12 4 L8 12" stroke="currentColor" strokeWidth="1" opacity="0.45" />
                </svg>
              </span>
              <span>关系网络正在变得复杂</span>
            </div>
            <div className="hidden h-5 w-px bg-primary/15 sm:block" />
            {statsLoading ? (
              <Skeleton className="h-5 w-48 bg-white/60" />
            ) : (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                <span>
                  <span className="font-semibold text-foreground">
                    {(stats?.vertex_count ?? 0).toLocaleString()}
                  </span>
                  <span className="ml-1 text-muted-foreground">已保存实体</span>
                </span>
                <span className="hidden text-border sm:inline">|</span>
                <span>
                  <span className="font-semibold text-foreground">
                    {(stats?.edge_count ?? 0).toLocaleString()}
                  </span>
                  <span className="ml-1 text-muted-foreground">条关系</span>
                </span>
              </div>
            )}
            <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 pulse-dot" />
              图谱持续更新中
            </div>
          </div>

          {/* 我的分析场景 */}
          <div className="mb-3">
            <h2 className="text-base font-semibold text-foreground">我的分析场景</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">选择场景，快速进入已保存的分析视图</p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {boardsLoading ? (
              [1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-[26rem] w-full rounded-2xl bg-muted" />
              ))
            ) : (
              <>
                {sceneBoards.map((board) => (
                  <SceneBoardSection
                    key={board.id}
                    board={board}
                      highlighted={highlightedBoardId === board.id}
                    subGraphs={getBoardSubGraphs(board.id)}
                    onEdit={() => openEditDialog(board)}
                    onDelete={() => {
                      setDeletingBoardId(board.id);
                      setDeleteDialogOpen(true);
                    }}
                    onAddSubGraph={() => onNavigateToExplore(board.id)}
                    onOpenSubGraph={(graphData) => onNavigateToExplore(board.id, graphData)}
                    onDeleteSubGraph={(id) => {
                      setDeleteSubGraphId(id);
                      setDeleteSubGraphDialogOpen(true);
                    }}
                  />
                ))}
                <button
                  type="button"
                  onClick={openCreate}
                  className="flex min-h-[16rem] w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border/80 bg-white/60 px-4 py-10 text-muted-foreground transition-all hover:border-primary/40 hover:bg-primary/[0.03] hover:text-primary"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-2xl font-light text-muted-foreground/70">
                    +
                  </span>
                  <span className="text-sm font-medium">添加场景看板</span>
                  <span className="text-center text-xs text-muted-foreground/70">新建场景后可在其中保存探索结果</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 创建看板弹窗 */}
      <Dialog open={createDialogOpen} onOpenChange={(open) => { setCreateDialogOpen(open); if (!open) createForm.reset(); }}>
        <DialogContent className="max-w-sm bg-white">
          <DialogHeader>
            <DialogTitle>新建场景看板</DialogTitle>
          </DialogHeader>
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit(handleCreateBoard)} className="space-y-4">
              <FormField control={createForm.control} name="name" rules={{ required: '请输入看板名称' }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>看板名称</FormLabel>
                    <FormControl><Input placeholder="例如：供应链风险分析" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField control={createForm.control} name="theme"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>主题色</FormLabel>
                    <FormControl>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(THEME_COLORS).map(([key, t]) => (
                          <button key={key} type="button" onClick={() => field.onChange(key)}
                            className={cn('rounded-md border px-3 py-1 text-xs transition-all', field.value === key ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border text-muted-foreground hover:border-primary/40')}>
                            <span className={cn('mr-1.5 inline-block h-2 w-2 rounded-full', t.dot)} />
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField control={createForm.control} name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>描述（可选）</FormLabel>
                    <FormControl><Input placeholder="看板用途说明" {...field} /></FormControl>
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>取消</Button>
                <Button type="submit">创建</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={(open) => { setEditDialogOpen(open); if (!open) setEditingBoard(null); }}>
        <DialogContent className="max-w-sm bg-white">
          <DialogHeader>
            <DialogTitle>编辑场景看板</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(handleEditBoard)} className="space-y-4">
              <FormField control={editForm.control} name="name" rules={{ required: '请输入看板名称' }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>看板名称</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField control={editForm.control} name="theme"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>主题色</FormLabel>
                    <FormControl>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(THEME_COLORS).map(([key, t]) => (
                          <button key={key} type="button" onClick={() => field.onChange(key)}
                            className={cn('rounded-md border px-3 py-1 text-xs transition-all', field.value === key ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border text-muted-foreground hover:border-primary/40')}>
                            <span className={cn('mr-1.5 inline-block h-2 w-2 rounded-full', t.dot)} />
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField control={editForm.control} name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>描述（可选）</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>取消</Button>
                <Button type="submit">保存</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除场景看板</AlertDialogTitle>
            <AlertDialogDescription>删除将同时清除其下所有子图看板，此操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteBoard} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteSubGraphDialogOpen} onOpenChange={setDeleteSubGraphDialogOpen}>
        <AlertDialogContent className="bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除子图看板</AlertDialogTitle>
            <AlertDialogDescription>删除后无法恢复，确认继续？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSubGraph} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

interface SceneBoardSectionProps {
  board: SceneBoard;
  highlighted: boolean;
  subGraphs: SubGraph[];
  onEdit: () => void;
  onDelete: () => void;
  onAddSubGraph: () => void;
  onDeleteSubGraph: (id: string) => void;
  onOpenSubGraph: (graphData: import('@/types/index').GraphData) => void;
}

const SceneBoardSection: React.FC<SceneBoardSectionProps> = ({
  board,
  highlighted,
  subGraphs,
  onEdit,
  onDelete,
  onAddSubGraph,
  onDeleteSubGraph,
  onOpenSubGraph,
}) => {
  const theme = THEME_COLORS[board.theme] ?? THEME_COLORS.default;

  return (
    <div
      id={`scene-board-${board.id}`}
      className={cn(
        'flex min-w-0 w-full flex-col overflow-hidden rounded-2xl border border-border/80 bg-white shadow-sm',
        'transition-[box-shadow,border-color] duration-300',
        highlighted && 'border-primary/60 shadow-[0_0_0_4px_rgba(59,113,232,0.14)]',
      )}
    >
      <div className={cn('flex items-center justify-between border-b border-border/60 px-4 py-3', theme.bg)}>
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', theme.dot)} />
          <span className="truncate text-sm font-semibold text-foreground">{board.name}</span>
          <Badge variant="outline" className="shrink-0 border-border/60 text-[11px] font-normal text-muted-foreground">
            {subGraphs.length}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button size="sm" variant="ghost" onClick={onAddSubGraph} className="h-7 w-7 p-0 text-primary hover:bg-primary/10" title="添加子图">
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onEdit} className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" title="编辑">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete} className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" title="删除">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex max-h-[22rem] min-h-[14rem] flex-col gap-2.5 overflow-y-auto bg-[#f8fafc]/60 p-3">
        {subGraphs.length === 0 ? (
          <button
            type="button"
            onClick={onAddSubGraph}
            className="flex h-28 flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-white transition-all hover:border-primary/40 hover:bg-primary/[0.02] group"
          >
            <span className="mb-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-lg font-light text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
              +
            </span>
            <span className="text-xs text-muted-foreground">添加子图看板</span>
          </button>
        ) : (
          <>
            {subGraphs.map((sg) => (
              <SubGraphCard
                key={sg.id}
                subGraph={sg}
                onOpen={() => onOpenSubGraph(sg.graph_data)}
                onDelete={() => onDeleteSubGraph(sg.id)}
              />
            ))}
            <button
              type="button"
              onClick={onAddSubGraph}
              className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-dashed border-border bg-white/80 transition-all hover:border-primary/40 hover:bg-white group"
            >
              <Plus className="h-3.5 w-3.5 text-muted-foreground/50 transition-colors group-hover:text-primary" />
              <span className="text-xs text-muted-foreground/70 transition-colors group-hover:text-muted-foreground">添加子图</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};

interface SubGraphCardProps {
  subGraph: SubGraph;
  onDelete: () => void;
  onOpen: () => void;
}

const SubGraphCard: React.FC<SubGraphCardProps> = ({ subGraph, onDelete, onOpen }) => {
  const nodeCount = subGraph.graph_data?.nodes?.length ?? 0;
  const edgeCount = subGraph.graph_data?.edges?.length ?? 0;
  const subtitle = subGraph.query_text?.trim() || `${nodeCount} 节点 · ${edgeCount} 边`;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen();
      }}
      className="group relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-xl border border-border/80 bg-white px-3 py-2.5 shadow-sm transition-all hover:border-primary/25 hover:shadow-md"
    >
      <div className="flex h-12 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary/60">
        {subGraph.thumbnail ? (
          <img src={subGraph.thumbnail} alt={`${subGraph.name} 缩略图`} className="h-full w-full object-contain" />
        ) : (
          <MiniGraphPreview nodes={nodeCount} edges={edgeCount} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium leading-snug text-foreground">{subGraph.name}</div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{subtitle}</div>
      </div>

      <span className="text-muted-foreground/40 transition-colors group-hover:text-primary">›</span>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded text-xs text-muted-foreground/0 transition-all group-hover:bg-destructive/10 group-hover:text-destructive"
        aria-label="删除子图"
      >
        ✕
      </button>
    </div>
  );
};

const MiniGraphPreview: React.FC<{ nodes: number; edges: number }> = ({ nodes, edges }) => {
  const displayNodes = Math.min(nodes, 5);
  const positions = [
    { x: 30, y: 28 }, { x: 70, y: 18 }, { x: 55, y: 42 },
    { x: 18, y: 46 }, { x: 80, y: 40 },
  ].slice(0, displayNodes);

  if (nodes === 0) {
    return <span className="text-[11px] text-muted-foreground/40">空图</span>;
  }

  return (
    <svg width="100%" height="100%" viewBox="0 0 100 60" className="p-1">
      {edges > 0 && positions.length >= 2 && (
        <>
          <line x1={positions[0].x} y1={positions[0].y} x2={positions[1]?.x ?? 70} y2={positions[1]?.y ?? 18} stroke="hsl(220 85% 55% / 0.35)" strokeWidth="1" />
          {positions[2] && (
            <line x1={positions[1].x} y1={positions[1].y} x2={positions[2].x} y2={positions[2].y} stroke="hsl(220 85% 55% / 0.35)" strokeWidth="1" />
          )}
        </>
      )}
      {positions.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3.5" fill="hsl(220 85% 55%)" fillOpacity="0.7" />
      ))}
    </svg>
  );
};

export default HomePage;
