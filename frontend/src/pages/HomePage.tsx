import React, { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
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
  onNavigateToExplore: (sceneBoardId: string, graphData?: import('@/types/index').GraphData) => void;
}

interface SceneBoardFormValues {
  name: string;
  theme: string;
  description: string;
}

const HomePage: React.FC<HomePageProps> = ({ onNavigateToExplore }) => {
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [sceneBoards, setSceneBoards] = useState<SceneBoard[]>([]);
  const [subGraphs, setSubGraphs] = useState<SubGraph[]>([]);
  const [boardsLoading, setBoardsLoading] = useState(true);

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

  return (
    <div className="flex h-[calc(100vh-48px)] overflow-hidden bg-background">
      {/* 左侧：统计面板 */}
      <div className="w-64 shrink-0 flex flex-col gap-3 p-4 border-r border-border bg-white overflow-y-auto">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">已保存分析统计</span>
        </div>

        {/* 实体统计 */}
        <div className="rounded-lg border border-border bg-white p-4 card-hover cursor-default">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">保存的节点</span>
            <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="4" stroke="hsl(220 85% 55%)" strokeWidth="1.5" fill="none" />
                <circle cx="7" cy="7" r="1.5" fill="hsl(220 85% 55%)" />
              </svg>
            </div>
          </div>
          {statsLoading ? (
            <Skeleton className="h-8 w-20 bg-muted" />
          ) : (
            <div className="text-2xl font-bold text-foreground">
              {stats?.vertex_count?.toLocaleString() ?? '0'}
            </div>
          )}
          <div className="text-xs text-muted-foreground mt-1">看板子图去重前合计</div>
        </div>

        {/* 关系统计 */}
        <div className="rounded-lg border border-border bg-white p-4 card-hover cursor-default">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">保存的边</span>
            <div className="w-7 h-7 rounded-md bg-cyan-50 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 7 L12 7" stroke="#0891B2" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M9 4.5 L12 7 L9 9.5" stroke="#0891B2" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
          {statsLoading ? (
            <Skeleton className="h-8 w-20 bg-muted" />
          ) : (
            <div className="text-2xl font-bold text-foreground">
              {stats?.edge_count?.toLocaleString() ?? '0'}
            </div>
          )}
          <div className="text-xs text-muted-foreground mt-1">看板子图去重前合计</div>
        </div>

        {/* 比值信息 */}
        {stats && (
          <div className="rounded-lg border border-border bg-secondary/50 p-3">
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">平均出度</span>
                <span className="font-medium text-foreground">
                  {stats.vertex_count > 0 ? (stats.edge_count / stats.vertex_count).toFixed(2) : '0.00'}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">分析空间</span>
                <span className="font-medium text-primary">{stats.space_name}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">刷新时间</span>
                <span className="text-muted-foreground">
                  {new Date(stats.refreshed_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="text-[11px] text-muted-foreground/60 mt-auto flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400 pulse-dot" />
          本浏览器保存结果，每30秒刷新
        </div>
      </div>

      {/* 右侧：场景看板纵向列表 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部操作栏 */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-white shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-base font-semibold text-foreground">场景看板</span>
            <Badge className="bg-primary/10 text-primary border-0 text-xs font-normal">
              {sceneBoards.length} 个
            </Badge>
          </div>
          <Button
            size="sm"
            onClick={() => { createForm.reset(); setCreateDialogOpen(true); }}
            className="h-8 px-4 text-xs font-medium"
          >
            + 新建场景
          </Button>
        </div>

        {/* 场景看板横向列表（可左右滑动） */}
        <div className="flex-1 overflow-hidden bg-background">
          <div className="h-full overflow-x-auto overflow-y-hidden">
            <div className="flex flex-row gap-4 p-5 h-full min-w-max items-start">
              {boardsLoading ? (
                <>
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="w-72 h-96 bg-muted rounded-xl shrink-0" />
                  ))}
                </>
              ) : sceneBoards.length === 0 ? (
                <div className="flex flex-col items-center justify-center w-72 h-64 border-2 border-dashed border-border rounded-xl bg-white shrink-0">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                    <span className="text-primary text-xl font-light">+</span>
                  </div>
                  <p className="text-sm font-medium text-foreground">暂无场景看板</p>
                  <p className="text-xs text-muted-foreground mt-1">点击「新建场景」开始创建</p>
                </div>
              ) : (
                <>
                  {sceneBoards.map((board) => (
                    <SceneBoardSection
                      key={board.id}
                      board={board}
                      subGraphs={getBoardSubGraphs(board.id)}
                      onEdit={() => openEditDialog(board)}
                      onDelete={() => { setDeletingBoardId(board.id); setDeleteDialogOpen(true); }}
                      onAddSubGraph={() => onNavigateToExplore(board.id)}
                      onOpenSubGraph={(graphData) => onNavigateToExplore(board.id, graphData)}
                      onDeleteSubGraph={(id) => { setDeleteSubGraphId(id); setDeleteSubGraphDialogOpen(true); }}
                    />
                  ))}
                </>
              )}
              {/* 新增列按钮 */}
              {!boardsLoading && (
                <button
                  type="button"
                  onClick={() => { createForm.reset(); setCreateDialogOpen(true); }}
                  className="flex flex-col items-center justify-center w-16 self-stretch min-h-32 border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 rounded-xl transition-all group shrink-0"
                >
                  <span className="text-2xl text-muted-foreground/40 group-hover:text-primary transition-colors font-light">+</span>
                  <span className="text-[10px] text-muted-foreground/40 group-hover:text-muted-foreground mt-1 transition-colors [writing-mode:vertical-lr] tracking-wider">新建场景</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 创建看板弹窗 */}
      <Dialog open={createDialogOpen} onOpenChange={(open) => { setCreateDialogOpen(open); if (!open) createForm.reset(); }}>
        <DialogContent className="bg-white max-w-sm">
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
                      <div className="flex gap-2 flex-wrap">
                        {Object.entries(THEME_COLORS).map(([key, t]) => (
                          <button key={key} type="button" onClick={() => field.onChange(key)}
                            className={cn('px-3 py-1 rounded-md text-xs border transition-all', field.value === key ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border text-muted-foreground hover:border-primary/40')}>
                            <span className={cn('inline-block w-2 h-2 rounded-full mr-1.5', t.dot)} />
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

      {/* 编辑看板弹窗 */}
      <Dialog open={editDialogOpen} onOpenChange={(open) => { setEditDialogOpen(open); if (!open) setEditingBoard(null); }}>
        <DialogContent className="bg-white max-w-sm">
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
                      <div className="flex gap-2 flex-wrap">
                        {Object.entries(THEME_COLORS).map(([key, t]) => (
                          <button key={key} type="button" onClick={() => field.onChange(key)}
                            className={cn('px-3 py-1 rounded-md text-xs border transition-all', field.value === key ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border text-muted-foreground hover:border-primary/40')}>
                            <span className={cn('inline-block w-2 h-2 rounded-full mr-1.5', t.dot)} />
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

      {/* 删除场景看板 */}
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

      {/* 删除子图 */}
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

// ── 单个场景看板列（横向排布，内部子图纵向堆叠）
interface SceneBoardSectionProps {
  board: SceneBoard;
  subGraphs: SubGraph[];
  onEdit: () => void;
  onDelete: () => void;
  onAddSubGraph: () => void;
  onDeleteSubGraph: (id: string) => void;
  onOpenSubGraph: (graphData: import('@/types/index').GraphData) => void;
}

const SceneBoardSection: React.FC<SceneBoardSectionProps> = ({
  board,
  subGraphs,
  onEdit,
  onDelete,
  onAddSubGraph,
  onDeleteSubGraph,
  onOpenSubGraph,
}) => {
  const theme = THEME_COLORS[board.theme] ?? THEME_COLORS.default;

  return (
    <div className="w-72 shrink-0 flex flex-col bg-secondary/50 border border-border rounded-xl overflow-hidden self-start">
      {/* 列标题栏 */}
      <div className={cn('flex items-center justify-between px-4 py-3 border-b border-border', theme.bg)}>
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', theme.dot)} />
          <span className="font-semibold text-foreground text-sm truncate">{board.name}</span>
          <Badge variant="outline" className="text-[11px] border-border/60 text-muted-foreground font-normal shrink-0">
            {subGraphs.length}
          </Badge>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={onAddSubGraph}
            className="h-6 w-6 p-0 text-primary hover:bg-primary/10 rounded"
            title="添加子图"
          >
            +
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onEdit}
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground rounded text-xs"
            title="编辑"
          >
            ✎
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive rounded text-xs"
            title="删除"
          >
            ⋯
          </Button>
        </div>
      </div>

      {/* 子图纵向列表 */}
      <div className="flex flex-col gap-2.5 p-3 overflow-y-auto max-h-[calc(100vh-160px)]">
        {subGraphs.length === 0 ? (
          <button
            type="button"
            onClick={onAddSubGraph}
            className="flex flex-col items-center justify-center h-24 border-2 border-dashed border-border hover:border-primary/40 hover:bg-white rounded-lg transition-all group"
          >
            <div className="w-7 h-7 rounded-full bg-secondary group-hover:bg-primary/10 flex items-center justify-center mb-1.5 transition-colors">
              <span className="text-muted-foreground group-hover:text-primary text-lg leading-none font-light transition-colors">+</span>
            </div>
            <span className="text-xs text-muted-foreground/70 group-hover:text-muted-foreground transition-colors">添加子图看板</span>
          </button>
        ) : (
          <>
            {subGraphs.map((sg) => (
              <SubGraphCard key={sg.id} subGraph={sg} onOpen={() => onOpenSubGraph(sg.graph_data)} onDelete={() => onDeleteSubGraph(sg.id)} />
            ))}
            <button
              type="button"
              onClick={onAddSubGraph}
              className="flex items-center justify-center gap-1.5 h-9 border border-dashed border-border hover:border-primary/40 hover:bg-white rounded-lg transition-all group"
            >
              <span className="text-muted-foreground/50 group-hover:text-primary text-sm font-light transition-colors">+</span>
              <span className="text-xs text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">添加子图</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};

// ── 子图卡片
interface SubGraphCardProps {
  subGraph: SubGraph;
  onDelete: () => void;
  onOpen: () => void;
}

const SubGraphCard: React.FC<SubGraphCardProps> = ({ subGraph, onDelete, onOpen }) => {
  const nodeCount = subGraph.graph_data?.nodes?.length ?? 0;
  const edgeCount = subGraph.graph_data?.edges?.length ?? 0;

  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === 'Enter') onOpen(); }} className="relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-lg border border-border bg-white px-3 py-2.5 group card-hover">
      {/* 左侧蓝条 */}
      <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-primary rounded-r" />

      {/* 迷你图预览 */}
      <div className="w-12 h-10 flex items-center justify-center bg-secondary/50 rounded-md shrink-0">
        {subGraph.thumbnail ? <img src={subGraph.thumbnail} alt={`${subGraph.name} 缩略图`} className="h-full w-full object-contain" /> : <MiniGraphPreview nodes={nodeCount} edges={edgeCount} />}
      </div>

      {/* 文字信息 */}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-foreground truncate leading-snug">{subGraph.name}</div>
        <div className="text-[11px] text-muted-foreground flex gap-1.5 mt-0.5">
          <span>{nodeCount} 节点</span>
          <span>·</span>
          <span>{edgeCount} 边</span>
        </div>
      </div>

      {/* 删除按钮 */}
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onDelete(); }}
        className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 transition-all opacity-0 group-hover:opacity-100 shrink-0 text-xs"
      >
        ✕
      </button>
    </div>
  );
};

// ── 迷你图预览
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
