import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { createSchema, loadSchemas, saveSchemas } from '@/services/schema-store';
import type { EdgeType, GraphSchemaDefinition, ModelSelection, PropDataType, PropertyDef, SchemaVersion, TagType } from '@/types';

// ── 工具函数 ──────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function makeProperty(overrides?: Partial<PropertyDef>): PropertyDef {
  return {
    id: uid(),
    name: '',
    type: 'string',
    isPrimaryKey: false,
    nullable: true,
    defaultValue: '',
    comment: '',
    ...overrides,
  };
}

const PROP_TYPES: PropDataType[] = [
  'string', 'int', 'int64', 'float', 'double', 'bool', 'date', 'datetime', 'timestamp',
];

const NODE_COLORS = [
  '#68f286', '#4B9EFF', '#FF6B6B', '#FFD166',
  '#a78bfa', '#f97316', '#06b6d4', '#ec4899',
];

// ── 初始演示数据 ────────────────────────────────────────────

const INIT_TAGS: TagType[] = [
  {
    id: 'tag-1',
    name: 'Person',
    color: '#68f286',
    comment: '人物实体',
    properties: [
      makeProperty({ id: 'p1', name: 'name', type: 'string', isPrimaryKey: true, nullable: false }),
      makeProperty({ id: 'p2', name: 'age', type: 'int' }),
      makeProperty({ id: 'p3', name: 'email', type: 'string' }),
    ],
    x: 200,
    y: 200,
  },
  {
    id: 'tag-2',
    name: 'Company',
    color: '#4B9EFF',
    comment: '公司实体',
    properties: [
      makeProperty({ id: 'p4', name: 'name', type: 'string', isPrimaryKey: true, nullable: false }),
      makeProperty({ id: 'p5', name: 'industry', type: 'string' }),
    ],
    x: 480,
    y: 260,
  },
  {
    id: 'tag-3',
    name: 'Product',
    color: '#FFD166',
    comment: '产品实体',
    properties: [
      makeProperty({ id: 'p6', name: 'sku', type: 'string', isPrimaryKey: true, nullable: false }),
      makeProperty({ id: 'p7', name: 'price', type: 'double' }),
    ],
    x: 340,
    y: 380,
  },
];

const INIT_EDGES: EdgeType[] = [
  {
    id: 'edge-1',
    name: 'WORKS_AT',
    fromTagId: 'tag-1',
    toTagId: 'tag-2',
    color: '#94a3b8',
    comment: '任职关系',
    properties: [makeProperty({ id: 'ep1', name: 'since', type: 'date' })],
  },
  {
    id: 'edge-2',
    name: 'PRODUCES',
    fromTagId: 'tag-2',
    toTagId: 'tag-3',
    color: '#94a3b8',
    comment: '生产关系',
    properties: [],
  },
];

const INIT_VERSIONS: SchemaVersion[] = [
  {
    id: 'v1',
    version: 'v1.0.0',
    description: '初始版本',
    tags: INIT_TAGS,
    edges: INIT_EDGES,
    createdAt: '2025-03-10 09:00',
    isDraft: false,
  },
];

// ── 主组件 ────────────────────────────────────────────────────

type ActiveTab = 'visual' | 'tags' | 'edges' | 'versions' | 'importexport';

const ModelBuilder: React.FC = () => {
  const [schemas, setSchemas] = useState<GraphSchemaDefinition[]>(() => loadSchemas({ name: 'default_schema', tags: INIT_TAGS, edges: INIT_EDGES, versions: INIT_VERSIONS }));
  const [activeSchemaId, setActiveSchemaId] = useState(() => schemas[0]?.id ?? '');
  const activeSchema = schemas.find(schema => schema.id === activeSchemaId) ?? schemas[0];
  const [tags, setTags] = useState<TagType[]>(() => activeSchema?.tags ?? []);
  const [edges, setEdges] = useState<EdgeType[]>(() => activeSchema?.edges ?? []);
  const [versions, setVersions] = useState<SchemaVersion[]>(() => activeSchema?.versions ?? []);
  const [activeTab, setActiveTab] = useState<ActiveTab>('visual');
  const [selection, setSelection] = useState<ModelSelection>(null);
  const [schemaName, setSchemaName] = useState(activeSchema?.name ?? 'default_schema');

  // 弹窗状态
  const [addTagOpen, setAddTagOpen] = useState(false);
  const [addEdgeOpen, setAddEdgeOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'tag' | 'edge'; id: string } | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [versionDialogOpen, setVersionDialogOpen] = useState(false);

  const selectedTag = selection?.type === 'tag' ? tags.find(t => t.id === selection.id) : null;
  const selectedEdge = selection?.type === 'edge' ? edges.find(e => e.id === selection.id) : null;

  useEffect(() => {
    if (!activeSchemaId) return;
    setSchemas(previous => {
      const next = previous.map(schema => schema.id === activeSchemaId ? {
        ...schema, name: schemaName, tags, edges, versions,
        status: schema.publishedVersionId ? 'published' as const : 'draft' as const,
        updatedAt: new Date().toISOString(),
      } : schema);
      saveSchemas(next);
      return next;
    });
  }, [activeSchemaId, schemaName, tags, edges, versions]);

  const selectSchema = useCallback((id: string) => {
    const schema = schemas.find(item => item.id === id);
    if (!schema) return;
    setActiveSchemaId(id); setSchemaName(schema.name); setTags(schema.tags); setEdges(schema.edges);
    setVersions(schema.versions); setSelection(null); setActiveTab('visual');
  }, [schemas]);

  const addSchema = useCallback(() => {
    const schema = createSchema(`图模型 ${schemas.length + 1}`);
    const next = [...schemas, schema]; saveSchemas(next); setSchemas(next);
    setActiveSchemaId(schema.id); setSchemaName(schema.name); setTags([]); setEdges([]); setVersions([]); setSelection(null);
    toast.success('Schema 已创建，请从画布添加点类型');
  }, [schemas]);

  const deleteSchema = useCallback((id: string) => {
    if (schemas.length <= 1) { toast.error('至少保留一个 Schema'); return; }
    const next = schemas.filter(schema => schema.id !== id); saveSchemas(next); setSchemas(next);
    const fallback = next[0];
    if (id === activeSchemaId && fallback) {
      setActiveSchemaId(fallback.id); setSchemaName(fallback.name); setTags(fallback.tags); setEdges(fallback.edges); setVersions(fallback.versions); setSelection(null);
    }
    toast.success('Schema 已删除');
  }, [activeSchemaId, schemas]);

  // 更新 Tag
  const updateTag = useCallback((id: string, patch: Partial<TagType>) => {
    setTags(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }, []);

  // 更新 Edge
  const updateEdge = useCallback((id: string, patch: Partial<EdgeType>) => {
    setEdges(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
  }, []);

  // 删除
  const handleDelete = useCallback(() => {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === 'tag') {
      setTags(prev => prev.filter(t => t.id !== deleteConfirm.id));
      setEdges(prev => prev.filter(e => e.fromTagId !== deleteConfirm.id && e.toTagId !== deleteConfirm.id));
    } else {
      setEdges(prev => prev.filter(e => e.id !== deleteConfirm.id));
    }
    if (selection?.id === deleteConfirm.id) setSelection(null);
    setDeleteConfirm(null);
    toast.success('已删除');
  }, [deleteConfirm, selection]);

  // 保存草稿
  const saveDraft = useCallback(() => {
    const draft: SchemaVersion = {
      id: uid(),
      version: `草稿 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
      description: '手动草稿',
      tags: JSON.parse(JSON.stringify(tags)),
      edges: JSON.parse(JSON.stringify(edges)),
      createdAt: new Date().toLocaleString('zh-CN'),
      isDraft: true,
    };
    setVersions(prev => [draft, ...prev]);
    toast.success('草稿已保存');
  }, [tags, edges]);

  const publishVersion = useCallback(() => {
    const invalidTag = tags.find(tag => !tag.name.trim() || !tag.properties.some(prop => prop.isPrimaryKey && prop.name.trim()));
    const invalidEdge = edges.find(edge => !edge.name.trim() || !tags.some(tag => tag.id === edge.fromTagId) || !tags.some(tag => tag.id === edge.toTagId));
    if (tags.length === 0) { toast.error('至少定义一个点类型后才能发布'); return; }
    if (invalidTag) { toast.error(`点类型「${invalidTag.name || '未命名'}」必须有名称和主键属性`); return; }
    if (invalidEdge) { toast.error(`边类型「${invalidEdge.name || '未命名'}」定义不完整`); return; }
    const version: SchemaVersion = {
      id: uid(), version: `v1.${versions.filter(item => !item.isDraft).length}.0`, description: '发布版本',
      tags: JSON.parse(JSON.stringify(tags)), edges: JSON.parse(JSON.stringify(edges)),
      createdAt: new Date().toLocaleString('zh-CN'), isDraft: false,
    };
    const nextVersions = [version, ...versions]; setVersions(nextVersions);
    setSchemas(previous => {
      const next = previous.map(schema => schema.id === activeSchemaId ? {
        ...schema, name: schemaName, tags, edges, versions: nextVersions,
        status: 'published' as const, publishedVersionId: version.id, updatedAt: new Date().toISOString(),
      } : schema);
      saveSchemas(next); return next;
    });
    toast.success(`${version.version} 已发布，可在数据接入中选择`);
  }, [activeSchemaId, edges, schemaName, tags, versions]);

  // 回滚到某个版本
  const rollbackVersion = useCallback((v: SchemaVersion) => {
    setTags(JSON.parse(JSON.stringify(v.tags)));
    setEdges(JSON.parse(JSON.stringify(v.edges)));
    setSelection(null);
    toast.success(`已回滚到 ${v.version}`);
  }, []);

  // 导出
  const handleExport = useCallback(() => {
    const data = JSON.stringify({ schemaName, tags, edges }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${schemaName}_schema.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Schema 已导出');
  }, [schemaName, tags, edges]);

  // 导入解析
  const handleImport = useCallback((raw: string) => {
    try {
      const parsed = JSON.parse(raw) as { schemaName?: string; tags?: TagType[]; edges?: EdgeType[] };
      if (!Array.isArray(parsed.tags)) throw new Error('格式错误');
      if (parsed.schemaName) setSchemaName(parsed.schemaName);
      setTags(parsed.tags);
      setEdges(Array.isArray(parsed.edges) ? parsed.edges : []);
      setSelection(null);
      setImportDialogOpen(false);
      toast.success('Schema 已成功导入');
    } catch {
      toast.error('JSON 格式有误，导入失败');
    }
  }, []);

  const TABS: { key: ActiveTab; label: string }[] = [
    { key: 'visual', label: '可视化建模' },
    { key: 'tags', label: '点类型' },
    { key: 'edges', label: '边类型' },
    { key: 'versions', label: '版本历史' },
    { key: 'importexport', label: '导入/导出' },
  ];

  return (
    <div className="flex h-[calc(100vh-48px)] bg-background overflow-hidden">
      {/* 左侧 Schema 列表 */}
      <SchemaLeftPanel
        schemas={schemas}
        activeSchemaId={activeSchemaId}
        schemaName={schemaName}
        tags={tags}
        edges={edges}
        selection={selection}
        onSelectTag={id => setSelection({ type: 'tag', id })}
        onSelectEdge={id => setSelection({ type: 'edge', id })}
        onAddTag={() => setAddTagOpen(true)}
        onAddEdge={() => setAddEdgeOpen(true)}
        onSelectSchema={selectSchema}
        onAddSchema={addSchema}
        onDeleteSchema={deleteSchema}
      />

      {/* 主区域 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部工具栏 */}
        <div className="h-12 flex items-center justify-between px-4 border-b border-border bg-white shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">图类型名称</span>
            <Input
              value={schemaName}
              onChange={e => setSchemaName(e.target.value)}
              className="h-7 w-44 text-xs border-border"
            />
          </div>
          <div className="flex items-center gap-1 bg-secondary/50 rounded-md p-0.5">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'px-3.5 py-1 text-xs rounded transition-all font-medium',
                  activeTab === tab.key
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'visual' && (
            <VisualTab
              tags={tags}
              edges={edges}
              selection={selection}
              onSelect={setSelection}
              onTagPositionChange={(id, x, y) => updateTag(id, { x, y })}
              onAddTag={() => setAddTagOpen(true)}
              onCreateEdge={(fromTagId, toTagId) => {
                const edge: EdgeType = { id: uid(), name: 'NEW_RELATION', fromTagId, toTagId, color: '#94a3b8', comment: '', properties: [] };
                setEdges(previous => [...previous, edge]); setSelection({ type: 'edge', id: edge.id });
                toast.success('边类型已创建，请在右侧完善名称和属性');
              }}
              onUpdateTag={updateTag}
              onUpdateEdge={updateEdge}
              onDeleteRequest={setDeleteConfirm}
            />
          )}
          {activeTab === 'tags' && (
            <TagsListTab
              tags={tags}
              selection={selection}
              onSelect={id => setSelection({ type: 'tag', id })}
              onAdd={() => setAddTagOpen(true)}
              onDelete={id => setDeleteConfirm({ type: 'tag', id })}
              onUpdateTag={updateTag}
            />
          )}
          {activeTab === 'edges' && (
            <EdgesListTab
              edges={edges}
              tags={tags}
              selection={selection}
              onSelect={id => setSelection({ type: 'edge', id })}
              onAdd={() => setAddEdgeOpen(true)}
              onDelete={id => setDeleteConfirm({ type: 'edge', id })}
              onUpdateEdge={updateEdge}
            />
          )}
          {activeTab === 'versions' && (
            <VersionsTab versions={versions} onRollback={rollbackVersion} />
          )}
          {activeTab === 'importexport' && (
            <ImportExportTab
              onExport={handleExport}
              onImportClick={() => setImportDialogOpen(true)}
            />
          )}
        </div>

        {/* 底部工具栏 */}
        <div className="h-11 flex items-center justify-between px-6 border-t border-border bg-white shrink-0">
          <button
            type="button"
            onClick={saveDraft}
            className="text-xs text-primary hover:underline"
          >
            保存为草稿
          </button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs px-4" onClick={() => setVersionDialogOpen(true)}>
              版本历史
            </Button>
            <Button size="sm" className="h-7 text-xs px-5" onClick={publishVersion}>
              发布版本
            </Button>
          </div>
        </div>
      </div>

      {/* 弹窗：新增 Tag */}
      <AddTagDialog
        open={addTagOpen}
        tags={tags}
        onClose={() => setAddTagOpen(false)}
        onConfirm={tag => {
          setTags(prev => [...prev, tag]);
          setSelection({ type: 'tag', id: tag.id });
          setAddTagOpen(false);
          toast.success(`点类型「${tag.name}」已创建`);
        }}
      />

      {/* 弹窗：新增 Edge */}
      <AddEdgeDialog
        open={addEdgeOpen}
        tags={tags}
        edges={edges}
        onClose={() => setAddEdgeOpen(false)}
        onConfirm={edge => {
          setEdges(prev => [...prev, edge]);
          setSelection({ type: 'edge', id: edge.id });
          setAddEdgeOpen(false);
          toast.success(`边类型「${edge.name}」已创建`);
        }}
      />

      {/* 弹窗：确认删除 */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={o => { if (!o) setDeleteConfirm(null); }}>
        <AlertDialogContent className="bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirm?.type === 'tag'
                ? '删除点类型将同时删除关联的所有边类型，此操作不可撤销。'
                : '确认删除此边类型？此操作不可撤销。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirm(null)}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 弹窗：导入 */}
      <ImportDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        onImport={handleImport}
      />

      {/* 弹窗：版本列表（底部按钮触发） */}
      <Dialog open={versionDialogOpen} onOpenChange={setVersionDialogOpen}>
        <DialogContent className="bg-white max-w-lg">
          <DialogHeader><DialogTitle>版本历史</DialogTitle></DialogHeader>
          <VersionsTab versions={versions} onRollback={v => { rollbackVersion(v); setVersionDialogOpen(false); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ── 左侧面板 ─────────────────────────────────────────────────

interface SchemaLeftPanelProps {
  schemas: GraphSchemaDefinition[];
  activeSchemaId: string;
  schemaName: string;
  tags: TagType[];
  edges: EdgeType[];
  selection: ModelSelection;
  onSelectTag: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onAddTag: () => void;
  onAddEdge: () => void;
  onSelectSchema: (id: string) => void;
  onAddSchema: () => void;
  onDeleteSchema: (id: string) => void;
}

const SchemaLeftPanel: React.FC<SchemaLeftPanelProps> = ({
  schemas, activeSchemaId, schemaName, tags, edges, selection, onSelectTag, onSelectEdge, onAddTag, onAddEdge,
  onSelectSchema, onAddSchema, onDeleteSchema,
}) => {
  const [tagsOpen, setTagsOpen] = useState(true);
  const [edgesOpen, setEdgesOpen] = useState(true);

  return (
    <div className="w-60 shrink-0 flex flex-col border-r border-border bg-white overflow-hidden">
      <div className="border-b border-border p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-foreground">Schema 管理</span>
          <button type="button" onClick={onAddSchema} className="rounded border px-2 py-0.5 text-[11px] text-primary hover:bg-primary/5">+ 新建</button>
        </div>
        <div className="max-h-36 space-y-1 overflow-y-auto">
          {schemas.map(schema => (
            <div key={schema.id} className={cn('group flex items-center gap-1 rounded-md px-2 py-1.5', schema.id === activeSchemaId ? 'bg-primary/10 text-primary' : 'hover:bg-secondary')}>
              <button type="button" onClick={() => onSelectSchema(schema.id)} className="min-w-0 flex-1 text-left">
                <div className="truncate text-xs font-medium">{schema.name}</div>
                <div className="text-[9px] text-muted-foreground">{schema.tags.length} 点 · {schema.edges.length} 边 · {schema.status === 'published' ? '已发布' : '草稿'}</div>
              </button>
              <button type="button" aria-label={`删除 ${schema.name}`} onClick={() => onDeleteSchema(schema.id)} className="invisible text-xs text-muted-foreground hover:text-destructive group-hover:visible">×</button>
            </div>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="py-1">
          <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">当前：{schemaName}</div>
          {/* 点类型分组 */}
          <div>
            <div className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-secondary/50">
              <button type="button" onClick={() => setTagsOpen(o => !o)} className="flex flex-1 items-center gap-1.5 text-left hover:text-foreground">
                <span className="text-[10px]">{tagsOpen ? '▾' : '▸'}</span>
                <span className="text-foreground font-medium">点类型</span>
                <Badge variant="outline" className="text-[10px] h-4 px-1 border-border/60 text-muted-foreground font-normal">
                  {tags.length}
                </Badge>
              </button>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onAddTag(); }}
                className="w-4 h-4 flex items-center justify-center rounded hover:bg-primary/10 hover:text-primary text-muted-foreground transition-colors"
              >
                +
              </button>
            </div>
            {tagsOpen && (
              <div>
                {tags.map(tag => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => onSelectTag(tag.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-4 py-1.5 text-xs transition-colors text-left',
                      selection?.type === 'tag' && selection.id === tag.id
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground hover:bg-secondary/50'
                    )}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="truncate">{tag.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 边类型分组 */}
          <div className="mt-1">
            <div className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-secondary/50">
              <button type="button" onClick={() => setEdgesOpen(o => !o)} className="flex flex-1 items-center gap-1.5 text-left hover:text-foreground">
                <span className="text-[10px]">{edgesOpen ? '▾' : '▸'}</span>
                <span className="text-foreground font-medium">边类型</span>
                <Badge variant="outline" className="text-[10px] h-4 px-1 border-border/60 text-muted-foreground font-normal">
                  {edges.length}
                </Badge>
              </button>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onAddEdge(); }}
                className="w-4 h-4 flex items-center justify-center rounded hover:bg-primary/10 hover:text-primary text-muted-foreground transition-colors"
              >
                +
              </button>
            </div>
            {edgesOpen && (
              <div>
                {edges.map(edge => (
                  <button
                    key={edge.id}
                    type="button"
                    onClick={() => onSelectEdge(edge.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-4 py-1.5 text-xs transition-colors text-left',
                      selection?.type === 'edge' && selection.id === edge.id
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground hover:bg-secondary/50'
                    )}
                  >
                    <span className="text-border">—</span>
                    <span className="truncate">{edge.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};

// ── 可视化画布 Tab ────────────────────────────────────────────

interface VisualTabProps {
  tags: TagType[];
  edges: EdgeType[];
  selection: ModelSelection;
  onSelect: (s: ModelSelection) => void;
  onTagPositionChange: (id: string, x: number, y: number) => void;
  onAddTag: () => void;
  onCreateEdge: (fromTagId: string, toTagId: string) => void;
  onUpdateTag: (id: string, patch: Partial<TagType>) => void;
  onUpdateEdge: (id: string, patch: Partial<EdgeType>) => void;
  onDeleteRequest: (d: { type: 'tag' | 'edge'; id: string }) => void;
}

const VisualTab: React.FC<VisualTabProps> = ({
  tags, edges, selection, onSelect, onTagPositionChange, onAddTag, onCreateEdge, onUpdateTag, onUpdateEdge, onDeleteRequest,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ id: string; ox: number; oy: number; cx: number; cy: number } | null>(null);
  const connectRef = useRef<{ fromId: string; x: number; y: number } | null>(null);
  const [connectionPreview, setConnectionPreview] = useState<{ fromId: string; x: number; y: number } | null>(null);

  const handleNodeMouseDown = useCallback((e: React.MouseEvent, tag: TagType) => {
    e.stopPropagation();
    onSelect({ type: 'tag', id: tag.id });
    const rect = svgRef.current!.getBoundingClientRect();
    dragRef.current = {
      id: tag.id,
      ox: e.clientX - rect.left,
      oy: e.clientY - rect.top,
      cx: tag.x,
      cy: tag.y,
    };
  }, [onSelect]);

  const handleSvgMouseMove = useCallback((e: React.MouseEvent) => {
    if (connectRef.current) {
      const rect = svgRef.current!.getBoundingClientRect();
      const preview = { ...connectRef.current, x: e.clientX - rect.left, y: e.clientY - rect.top };
      connectRef.current = preview; setConnectionPreview(preview); return;
    }
    if (!dragRef.current) return;
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const dx = mx - dragRef.current.ox;
    const dy = my - dragRef.current.oy;
    onTagPositionChange(dragRef.current.id, dragRef.current.cx + dx, dragRef.current.cy + dy);
  }, [onTagPositionChange]);

  const handleSvgMouseUp = useCallback((e?: React.MouseEvent) => {
    if (connectRef.current && e && svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect(); const x=e.clientX-rect.left; const y=e.clientY-rect.top;
      const target=tags.find(tag=>tag.id!==connectRef.current?.fromId && Math.hypot(tag.x-x,tag.y-y)<=48);
      if (target) onCreateEdge(connectRef.current.fromId,target.id);
      else toast.info('请将连接线拖到另一个点上');
    }
    connectRef.current=null; setConnectionPreview(null);
    dragRef.current = null;
  }, [onCreateEdge, tags]);

  const beginConnection = useCallback((e: React.MouseEvent, tag: TagType, x: number, y: number) => {
    e.stopPropagation(); e.preventDefault(); dragRef.current=null;
    const preview={fromId:tag.id,x:tag.x+x,y:tag.y+y}; connectRef.current=preview; setConnectionPreview(preview);
  }, []);

  const selectedTag = selection?.type === 'tag' ? tags.find(t => t.id === selection.id) : null;
  const selectedEdge = selection?.type === 'edge' ? edges.find(e => e.id === selection.id) : null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* SVG 画布 */}
      <div className="flex-1 relative overflow-hidden bg-white">
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          className="cursor-default select-none"
          onClick={() => onSelect(null)}
          onMouseMove={handleSvgMouseMove}
          onMouseUp={handleSvgMouseUp}
          onMouseLeave={handleSvgMouseUp}
        >
          {/* 点阵背景 */}
          <defs>
            <pattern id="dot-grid" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="hsl(220 13% 88%)" />
            </pattern>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#94a3b8" />
            </marker>
            <marker id="arrow-selected" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="hsl(220 85% 55%)" />
            </marker>
          </defs>
          <rect width="100%" height="100%" fill="url(#dot-grid)" />

          {/* 渲染边 */}
          {edges.map(edge => {
            const from = tags.find(t => t.id === edge.fromTagId);
            const to = tags.find(t => t.id === edge.toTagId);
            if (!from || !to) return null;
            const isSelected = selection?.type === 'edge' && selection.id === edge.id;
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            const r = 40;
            const ex = to.x - (dx / len) * r;
            const ey = to.y - (dy / len) * r;
            const sx = from.x + (dx / len) * r;
            const sy = from.y + (dy / len) * r;
            const mx = (sx + ex) / 2;
            const my = (sy + ey) / 2 - 18;
            return (
              <g
                key={edge.id}
                onClick={e => { e.stopPropagation(); onSelect({ type: 'edge', id: edge.id }); }}
                className="cursor-pointer"
              >
                <path
                  d={`M${sx},${sy} Q${mx},${my} ${ex},${ey}`}
                  fill="none"
                  stroke={isSelected ? 'hsl(220 85% 55%)' : '#94a3b8'}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  markerEnd={isSelected ? 'url(#arrow-selected)' : 'url(#arrow)'}
                  strokeDasharray={isSelected ? undefined : undefined}
                />
                {/* 点击热区 */}
                <path
                  d={`M${sx},${sy} Q${mx},${my} ${ex},${ey}`}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={12}
                />
                {/* 边标签 */}
                <text
                  x={(sx + mx) / 2 + (mx - sx) / 4}
                  y={(sy + my) / 2 + (my - sy) / 4 - 4}
                  fontSize="10"
                  fill={isSelected ? 'hsl(220 85% 55%)' : '#64748b'}
                  textAnchor="middle"
                  className="pointer-events-none"
                >
                  {edge.name}
                </text>
              </g>
            );
          })}

          {/* 渲染节点 */}
          {connectionPreview && (()=>{const from=tags.find(tag=>tag.id===connectionPreview.fromId);return from?<line x1={from.x} y1={from.y} x2={connectionPreview.x} y2={connectionPreview.y} stroke="hsl(220 85% 55%)" strokeWidth="2" strokeDasharray="5 3" markerEnd="url(#arrow-selected)" pointerEvents="none"/>:null;})()}
          {tags.map(tag => {
            const isSelected = selection?.type === 'tag' && selection.id === tag.id;
            return (
              <g
                key={tag.id}
                transform={`translate(${tag.x},${tag.y})`}
                onMouseDown={e => handleNodeMouseDown(e, tag)}
                onClick={e => { e.stopPropagation(); onSelect({ type: 'tag', id: tag.id }); }}
                className="cursor-grab active:cursor-grabbing"
              >
                {/* 选中光晕 */}
                {isSelected && (
                  <circle r="46" fill={tag.color + '22'} stroke={tag.color} strokeWidth="1.5" strokeDasharray="4 2" />
                )}
                {/* 节点圆 */}
                <circle
                  r="38"
                  fill={tag.color + '33'}
                  stroke={tag.color}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                />
                {/* 连接点（选中态） */}
                {isSelected && (
                  <>
                    {[[-38, 0], [38, 0], [0, -38], [0, 38]].map(([cx, cy], i) => (
                      <circle key={i} cx={cx} cy={cy} r="6" fill={tag.color} stroke="white" strokeWidth="2" className="cursor-crosshair" onMouseDown={e=>beginConnection(e,tag,cx,cy)}>
                        <title>拖到另一个点创建边</title>
                      </circle>
                    ))}
                  </>
                )}
                {/* 标签文字 */}
                <text
                  textAnchor="middle"
                  dy="0.35em"
                  fontSize="12"
                  fontWeight="600"
                  fill={tag.color}
                  className="pointer-events-none select-none"
                >
                  {tag.name.length > 7 ? `[${tag.name.slice(0, 6)}…]` : `[${tag.name}]`}
                </text>
              </g>
            );
          })}

          {/* + 添加 按钮 */}
          <g
            className="cursor-pointer"
            onClick={e => { e.stopPropagation(); onAddTag(); }}
          >
            <circle
              cx="60" cy="60" r="32"
              fill="transparent"
              stroke="#94a3b8"
              strokeWidth="1.5"
              strokeDasharray="5 3"
            />
            <text x="60" y="55" textAnchor="middle" fontSize="18" fill="#94a3b8" fontWeight="300">+</text>
            <text x="60" y="71" textAnchor="middle" fontSize="10" fill="#94a3b8">添加</text>
          </g>
        </svg>
      </div>

      {/* 右侧属性面板 */}
      {(selectedTag || selectedEdge) && (
        <div className="w-80 shrink-0 border-l border-border bg-white flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-3 text-xs"
                onClick={() => {
                  const id = selectedTag?.id ?? selectedEdge?.id;
                  if (id) {
                    navigator.clipboard?.writeText(id).catch(() => {});
                    toast.success('ID 已复制');
                  }
                }}
              >
                复制
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-3 text-xs text-destructive border-destructive/40 hover:bg-destructive/10"
                onClick={() => {
                  if (selectedTag) onDeleteRequest({ type: 'tag', id: selectedTag.id });
                  if (selectedEdge) onDeleteRequest({ type: 'edge', id: selectedEdge.id });
                }}
              >
                删除
              </Button>
            </div>
            <button type="button" onClick={() => onSelect(null)} className="text-muted-foreground hover:text-foreground text-lg leading-none w-6 h-6 flex items-center justify-center">×</button>
          </div>

          <ScrollArea className="flex-1">
            {selectedTag && (
              <TagPropertyPanel tag={selectedTag} onUpdate={p => onUpdateTag(selectedTag.id, p)} />
            )}
            {selectedEdge && (
              <EdgePropertyPanel edge={selectedEdge} tags={tags} onUpdate={p => onUpdateEdge(selectedEdge.id, p)} />
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
};

// ── Tag 属性编辑面板 ──────────────────────────────────────────

interface TagPropertyPanelProps {
  tag: TagType;
  onUpdate: (patch: Partial<TagType>) => void;
}

const TagPropertyPanel: React.FC<TagPropertyPanelProps> = ({ tag, onUpdate }) => {
  const addProp = () => {
    onUpdate({ properties: [...tag.properties, makeProperty()] });
  };

  const updateProp = (index: number, patch: Partial<PropertyDef>) => {
    const props = tag.properties.map((p, i) => i === index ? { ...p, ...patch } : p);
    onUpdate({ properties: props });
  };

  const deleteProp = (index: number) => {
    onUpdate({ properties: tag.properties.filter((_, i) => i !== index) });
  };

  return (
    <div className="p-4 space-y-4">
      <div>
        <div className="text-sm font-semibold text-foreground mb-3">点类型</div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">点类型名称 *</label>
            <Input
              value={tag.name}
              onChange={e => onUpdate({ name: e.target.value })}
              className="h-8 text-xs"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">颜色</label>
            <div className="flex items-center gap-2">
              <div
                className="w-6 h-6 rounded border border-border shrink-0"
                style={{ backgroundColor: tag.color }}
              />
              <div className="flex gap-1.5 flex-wrap">
                {NODE_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onUpdate({ color: c })}
                    className={cn(
                      'w-5 h-5 rounded-full border-2 transition-all',
                      tag.color === c ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <Input
                value={tag.color}
                onChange={e => onUpdate({ color: e.target.value })}
                className="h-8 text-xs w-28 font-mono"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">标签/备注</label>
            <Input
              value={tag.comment}
              onChange={e => onUpdate({ comment: e.target.value })}
              className="h-8 text-xs"
              placeholder="可选备注"
            />
          </div>
        </div>
      </div>

      {/* 属性列表 */}
      <div>
        <div className="text-sm font-semibold text-foreground mb-2">属性</div>
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="grid grid-cols-[1fr_100px_48px_24px] gap-0 bg-secondary/50 border-b border-border">
            <div className="text-[11px] text-muted-foreground px-2 py-1.5">属性名</div>
            <div className="text-[11px] text-muted-foreground px-2 py-1.5">属性类型</div>
            <div className="text-[11px] text-muted-foreground px-2 py-1.5 text-center">主键</div>
            <div />
          </div>
          {tag.properties.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground/60">暂无属性</div>
          ) : (
            tag.properties.map((prop, i) => (
              <div key={prop.id} className="grid grid-cols-[1fr_100px_48px_24px] gap-0 border-b border-border/50 last:border-0 items-center">
                <input
                  value={prop.name}
                  onChange={e => updateProp(i, { name: e.target.value })}
                  placeholder="属性名"
                  className="px-2 py-1.5 text-xs border-0 outline-none bg-transparent text-foreground placeholder:text-muted-foreground/40 w-full"
                />
                <select
                  value={prop.type}
                  onChange={e => updateProp(i, { type: e.target.value as PropDataType })}
                  className="px-1 py-1.5 text-xs border-0 outline-none bg-transparent text-muted-foreground w-full cursor-pointer"
                >
                  {PROP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <div className="flex justify-center">
                  <input
                    type="checkbox"
                    checked={prop.isPrimaryKey}
                    onChange={e => updateProp(i, { isPrimaryKey: e.target.checked })}
                    className="w-3.5 h-3.5 accent-primary cursor-pointer"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => deleteProp(i)}
                  className="text-muted-foreground/40 hover:text-destructive text-xs w-6 h-full flex items-center justify-center transition-colors"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
        <button
          type="button"
          onClick={addProp}
          className="mt-2 text-xs text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
        >
          + 添加属性
        </button>
      </div>
    </div>
  );
};

// ── Edge 属性编辑面板 ─────────────────────────────────────────

interface EdgePropertyPanelProps {
  edge: EdgeType;
  tags: TagType[];
  onUpdate: (patch: Partial<EdgeType>) => void;
}

const EdgePropertyPanel: React.FC<EdgePropertyPanelProps> = ({ edge, tags, onUpdate }) => {
  const addProp = () => onUpdate({ properties: [...edge.properties, makeProperty()] });
  const updateProp = (index: number, patch: Partial<PropertyDef>) => {
    onUpdate({ properties: edge.properties.map((p, i) => i === index ? { ...p, ...patch } : p) });
  };
  const deleteProp = (index: number) => {
    onUpdate({ properties: edge.properties.filter((_, i) => i !== index) });
  };

  return (
    <div className="p-4 space-y-4">
      <div>
        <div className="text-sm font-semibold text-foreground mb-3">边类型</div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">边类型名称 *</label>
            <Input value={edge.name} onChange={e => onUpdate({ name: e.target.value })} className="h-8 text-xs" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">起始点类型</label>
            <select
              value={edge.fromTagId}
              onChange={e => onUpdate({ fromTagId: e.target.value })}
              className="w-full h-8 px-2 text-xs border border-border rounded-md bg-white text-foreground outline-none focus:ring-1 focus:ring-primary"
            >
              {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">目标点类型</label>
            <select
              value={edge.toTagId}
              onChange={e => onUpdate({ toTagId: e.target.value })}
              className="w-full h-8 px-2 text-xs border border-border rounded-md bg-white text-foreground outline-none focus:ring-1 focus:ring-primary"
            >
              {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">备注</label>
            <Input value={edge.comment} onChange={e => onUpdate({ comment: e.target.value })} className="h-8 text-xs" placeholder="可选备注" />
          </div>
        </div>
      </div>

      {/* 属性 */}
      <div>
        <div className="text-sm font-semibold text-foreground mb-2">属性</div>
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="grid grid-cols-[1fr_100px_24px] bg-secondary/50 border-b border-border">
            <div className="text-[11px] text-muted-foreground px-2 py-1.5">属性名</div>
            <div className="text-[11px] text-muted-foreground px-2 py-1.5">属性类型</div>
            <div />
          </div>
          {edge.properties.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground/60">暂无属性</div>
          ) : (
            edge.properties.map((prop, i) => (
              <div key={prop.id} className="grid grid-cols-[1fr_100px_24px] border-b border-border/50 last:border-0 items-center">
                <input
                  value={prop.name}
                  onChange={e => updateProp(i, { name: e.target.value })}
                  placeholder="属性名"
                  className="px-2 py-1.5 text-xs border-0 outline-none bg-transparent text-foreground placeholder:text-muted-foreground/40 w-full"
                />
                <select
                  value={prop.type}
                  onChange={e => updateProp(i, { type: e.target.value as PropDataType })}
                  className="px-1 py-1.5 text-xs border-0 outline-none bg-transparent text-muted-foreground w-full cursor-pointer"
                >
                  {PROP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <button type="button" onClick={() => deleteProp(i)}
                  className="text-muted-foreground/40 hover:text-destructive text-xs w-6 h-full flex items-center justify-center">×</button>
              </div>
            ))
          )}
        </div>
        <button type="button" onClick={addProp}
          className="mt-2 text-xs text-primary hover:text-primary/80 flex items-center gap-1">
          + 添加属性
        </button>
      </div>
    </div>
  );
};

// ── 点类型列表 Tab ────────────────────────────────────────────

interface TagsListTabProps {
  tags: TagType[];
  selection: ModelSelection;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onUpdateTag: (id: string, patch: Partial<TagType>) => void;
}

const TagsListTab: React.FC<TagsListTabProps> = ({ tags, selection, onSelect, onAdd, onDelete, onUpdateTag }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-white shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">点类型</span>
          <Badge className="bg-primary/10 text-primary border-0 text-xs font-normal">{tags.length}</Badge>
        </div>
        <Button size="sm" className="h-7 text-xs px-4" onClick={onAdd}>+ 新建点类型</Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-6 space-y-3">
          {tags.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground/60 text-sm">暂无点类型，点击「新建点类型」开始</div>
          ) : (
            tags.map(tag => {
              const isSelected = selection?.type === 'tag' && selection.id === tag.id;
              const isExpanded = expandedId === tag.id;
              return (
                <div
                  key={tag.id}
                  className={cn('bg-white border rounded-xl overflow-hidden transition-all', isSelected ? 'border-primary' : 'border-border')}
                >
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-secondary/30 transition-colors"
                    onClick={() => { onSelect(tag.id); setExpandedId(isExpanded ? null : tag.id); }}
                  >
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                    <span className="text-sm font-medium text-foreground flex-1">{tag.name}</span>
                    <span className="text-xs text-muted-foreground">{tag.properties.length} 个属性</span>
                    <span className="text-xs text-muted-foreground">{isExpanded ? '▾' : '▸'}</span>
                    <button type="button" onClick={e => { e.stopPropagation(); onDelete(tag.id); }}
                      className="text-xs text-muted-foreground/50 hover:text-destructive transition-colors ml-1">删除</button>
                  </div>
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-border">
                      <TagPropertyPanel tag={tag} onUpdate={p => onUpdateTag(tag.id, p)} />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

// ── 边类型列表 Tab ────────────────────────────────────────────

interface EdgesListTabProps {
  edges: EdgeType[];
  tags: TagType[];
  selection: ModelSelection;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onUpdateEdge: (id: string, patch: Partial<EdgeType>) => void;
}

const EdgesListTab: React.FC<EdgesListTabProps> = ({ edges, tags, selection, onSelect, onAdd, onDelete, onUpdateEdge }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const getTagName = (id: string) => tags.find(t => t.id === id)?.name ?? id;

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-white shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">边类型</span>
          <Badge className="bg-primary/10 text-primary border-0 text-xs font-normal">{edges.length}</Badge>
        </div>
        <Button size="sm" className="h-7 text-xs px-4" onClick={onAdd}>+ 新建边类型</Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-6 space-y-3">
          {edges.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground/60 text-sm">暂无边类型</div>
          ) : (
            edges.map(edge => {
              const isSelected = selection?.type === 'edge' && selection.id === edge.id;
              const isExpanded = expandedId === edge.id;
              return (
                <div
                  key={edge.id}
                  className={cn('bg-white border rounded-xl overflow-hidden transition-all', isSelected ? 'border-primary' : 'border-border')}
                >
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-secondary/30 transition-colors"
                    onClick={() => { onSelect(edge.id); setExpandedId(isExpanded ? null : edge.id); }}
                  >
                    <span className="text-muted-foreground text-sm">—</span>
                    <span className="text-sm font-medium text-foreground flex-1">{edge.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {getTagName(edge.fromTagId)} → {getTagName(edge.toTagId)}
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">{isExpanded ? '▾' : '▸'}</span>
                    <button type="button" onClick={e => { e.stopPropagation(); onDelete(edge.id); }}
                      className="text-xs text-muted-foreground/50 hover:text-destructive transition-colors ml-1">删除</button>
                  </div>
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-border">
                      <EdgePropertyPanel edge={edge} tags={tags} onUpdate={p => onUpdateEdge(edge.id, p)} />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

// ── 版本历史 Tab ──────────────────────────────────────────────

interface VersionsTabProps {
  versions: SchemaVersion[];
  onRollback: (v: SchemaVersion) => void;
}

const VersionsTab: React.FC<VersionsTabProps> = ({ versions, onRollback }) => (
  <div className="h-full flex flex-col bg-background overflow-hidden">
    <ScrollArea className="flex-1">
      <div className="p-6 space-y-3">
        {versions.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground/60 text-sm">暂无版本记录</div>
        ) : (
          versions.map((v, i) => (
            <div key={v.id} className="bg-white border border-border rounded-xl px-5 py-4 flex items-center gap-4">
              <div className="flex flex-col items-center gap-1 w-10 shrink-0">
                <div className={cn('w-3 h-3 rounded-full', i === 0 ? 'bg-primary' : 'bg-border')} />
                {i < versions.length - 1 && <div className="w-px flex-1 bg-border min-h-[16px]" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-foreground">{v.version}</span>
                  {v.isDraft && <Badge className="bg-yellow-50 text-yellow-600 border-yellow-200 text-[10px] font-normal">草稿</Badge>}
                  {i === 0 && !v.isDraft && <Badge className="bg-primary/10 text-primary border-0 text-[10px] font-normal">当前</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">{v.description}</div>
                <div className="text-[11px] text-muted-foreground/60 mt-0.5">{v.createdAt}</div>
              </div>
              <div className="text-xs text-muted-foreground shrink-0">
                {v.tags.length} 点类型 · {v.edges.length} 边类型
              </div>
              {i > 0 && (
                <Button variant="outline" size="sm" className="h-7 text-xs shrink-0" onClick={() => onRollback(v)}>
                  回滚
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </ScrollArea>
  </div>
);

// ── 导入/导出 Tab ─────────────────────────────────────────────

interface ImportExportTabProps {
  onExport: () => void;
  onImportClick: () => void;
}

const ImportExportTab: React.FC<ImportExportTabProps> = ({ onExport, onImportClick }) => (
  <div className="h-full flex items-center justify-center bg-background">
    <div className="max-w-md w-full px-6 space-y-4">
      <div className="text-center mb-6">
        <div className="text-base font-semibold text-foreground mb-1">模型导入/导出</div>
        <div className="text-sm text-muted-foreground">以 JSON 格式导入或导出当前 Schema 配置</div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div
          className="bg-white border border-border rounded-xl p-5 flex flex-col items-center gap-3 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all group"
          onClick={onExport}
        >
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
            <span className="text-primary text-lg">↓</span>
          </div>
          <div className="text-center">
            <div className="text-sm font-medium text-foreground">导出 Schema</div>
            <div className="text-xs text-muted-foreground mt-0.5">下载 JSON 文件</div>
          </div>
        </div>
        <div
          className="bg-white border border-border rounded-xl p-5 flex flex-col items-center gap-3 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all group"
          onClick={onImportClick}
        >
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
            <span className="text-primary text-lg">↑</span>
          </div>
          <div className="text-center">
            <div className="text-sm font-medium text-foreground">导入 Schema</div>
            <div className="text-xs text-muted-foreground mt-0.5">上传 JSON 文件</div>
          </div>
        </div>
      </div>
      <div className="bg-secondary/50 rounded-xl p-4 text-xs text-muted-foreground space-y-1">
        <div className="font-medium text-foreground mb-2">格式说明</div>
        <div>· 支持 JSON 格式，包含 tags 和 edges 字段</div>
        <div>· 导入将覆盖当前 Schema，建议先导出备份</div>
        <div>· 可在版本历史中查看和回滚之前的配置</div>
      </div>
    </div>
  </div>
);

// ── 新增 Tag 弹窗 ─────────────────────────────────────────────

interface AddTagDialogProps {
  open: boolean;
  tags: TagType[];
  onClose: () => void;
  onConfirm: (tag: TagType) => void;
}

const AddTagDialog: React.FC<AddTagDialogProps> = ({ open, tags, onClose, onConfirm }) => {
  const [name, setName] = useState('');
  const [color, setColor] = useState(NODE_COLORS[0]);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setName(''); setColor(NODE_COLORS[0]); setComment(''); setError(''); }
  }, [open]);

  const handleConfirm = () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('请输入点类型名称'); return; }
    if (tags.some(t => t.name === trimmed)) { setError('名称已存在'); return; }
    const cols = tags.length;
    onConfirm({
      id: uid(),
      name: trimmed,
      color,
      comment,
      properties: [],
      x: 100 + (cols % 4) * 160,
      y: 100 + Math.floor(cols / 4) * 160,
    });
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="bg-white max-w-sm">
        <DialogHeader><DialogTitle>新建点类型</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">名称 *</label>
            <Input
              value={name}
              onChange={e => { setName(e.target.value); setError(''); }}
              placeholder="例如：Person"
              className="h-8 text-sm"
              autoFocus
            />
            {error && <p className="text-destructive text-xs mt-1">{error}</p>}
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">颜色</label>
            <div className="flex gap-2 flex-wrap">
              {NODE_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn('w-6 h-6 rounded-full border-2 transition-all', color === c ? 'border-foreground scale-110' : 'border-transparent')}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">备注（可选）</label>
            <Input value={comment} onChange={e => setComment(e.target.value)} placeholder="用途描述" className="h-8 text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleConfirm}>创建</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ── 新增 Edge 弹窗 ────────────────────────────────────────────

interface AddEdgeDialogProps {
  open: boolean;
  tags: TagType[];
  edges: EdgeType[];
  onClose: () => void;
  onConfirm: (edge: EdgeType) => void;
}

const AddEdgeDialog: React.FC<AddEdgeDialogProps> = ({ open, tags, edges, onClose, onConfirm }) => {
  const [name, setName] = useState('');
  const [fromTagId, setFromTagId] = useState('');
  const [toTagId, setToTagId] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setName(''); setComment(''); setError('');
      setFromTagId(tags[0]?.id ?? '');
      setToTagId(tags[1]?.id ?? tags[0]?.id ?? '');
    }
  }, [open, tags]);

  const handleConfirm = () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('请输入边类型名称'); return; }
    if (edges.some(e => e.name === trimmed)) { setError('名称已存在'); return; }
    if (!fromTagId || !toTagId) { setError('请选择起始和目标点类型'); return; }
    onConfirm({
      id: uid(),
      name: trimmed,
      fromTagId,
      toTagId,
      color: '#94a3b8',
      comment,
      properties: [],
    });
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="bg-white max-w-sm">
        <DialogHeader><DialogTitle>新建边类型</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">名称 *</label>
            <Input
              value={name}
              onChange={e => { setName(e.target.value); setError(''); }}
              placeholder="例如：KNOWS"
              className="h-8 text-sm"
              autoFocus
            />
            {error && <p className="text-destructive text-xs mt-1">{error}</p>}
          </div>
          {tags.length < 2 ? (
            <p className="text-xs text-amber-600 bg-amber-50 rounded px-3 py-2">至少需要 2 个点类型才能创建边类型</p>
          ) : (
            <>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">起始点类型</label>
                <select value={fromTagId} onChange={e => setFromTagId(e.target.value)}
                  className="w-full h-8 px-2 text-sm border border-border rounded-md bg-white text-foreground outline-none focus:ring-1 focus:ring-primary">
                  {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">目标点类型</label>
                <select value={toTagId} onChange={e => setToTagId(e.target.value)}
                  className="w-full h-8 px-2 text-sm border border-border rounded-md bg-white text-foreground outline-none focus:ring-1 focus:ring-primary">
                  {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </>
          )}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">备注（可选）</label>
            <Input value={comment} onChange={e => setComment(e.target.value)} placeholder="用途描述" className="h-8 text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleConfirm} disabled={tags.length < 2}>创建</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ── 导入弹窗 ──────────────────────────────────────────────────

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (raw: string) => void;
}

const ImportDialog: React.FC<ImportDialogProps> = ({ open, onClose, onImport }) => {
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) setText(''); }, [open]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setText(ev.target?.result as string ?? '');
    reader.readAsText(file);
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="bg-white max-w-lg">
        <DialogHeader><DialogTitle>导入 Schema</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div
            className="border-2 border-dashed border-border rounded-xl p-6 flex flex-col items-center gap-2 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all"
            onClick={() => fileRef.current?.click()}
          >
            <span className="text-2xl text-muted-foreground/40">↑</span>
            <p className="text-sm text-muted-foreground">点击上传 JSON 文件</p>
            <p className="text-xs text-muted-foreground/60">或直接在下方粘贴 JSON 内容</p>
          </div>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFile} />
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={8}
            placeholder='{"schemaName": "my_schema", "tags": [...], "edges": [...]}'
            className="w-full px-3 py-2 text-xs font-mono border border-border rounded-lg resize-none outline-none focus:ring-1 focus:ring-primary bg-secondary/30 text-foreground placeholder:text-muted-foreground/40"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={() => onImport(text)} disabled={!text.trim()}>导入</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ModelBuilder;
