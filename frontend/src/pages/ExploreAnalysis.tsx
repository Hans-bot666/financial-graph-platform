import { Graph, type GraphOptions } from '@antv/g6';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createSubGraph, listBoards } from '@/services/board-store';
import {
  executeGraphQuery, executeScenario, expandVertex, findPaths, type GraphResult, getGraphSchema,
  listScenarios, lookupVertex, type ScenarioTemplate,
} from '@/services/graph-api';
import { builtinGraphInstances, type GraphInstance, INGESTION_EVENT } from '@/services/ingestion-store';
import type { GraphData, GraphEdge, GraphNode, SceneBoard } from '@/types/index';

const EMPTY_GRAPH: GraphData = { nodes: [], edges: [] };
const NODE_COLORS: Record<string, string> = {
  company: '#22C897', person: '#4B96FF', account: '#F59E0B', loan: '#A855F7', default: '#64748B',
};
const DEFAULT_EDGES = ['holds_account', 'applied_for', 'disbursed_to', 'transfer', 'guarantees', 'controls', 'shareholder', 'employs', 'related_to'];
const GQL_EXAMPLE = 'MATCH p=(c:company)-[:holds_account]->(a:account) RETURN p LIMIT 20;';

type Module = 'custom' | 'scenario' | 'gql';
type CustomTool = 'lookup' | 'expand' | 'path';
type Layout = 'circular' | 'force' | 'dagre';
type Classification = 'blacklist' | 'whitelist' | 'none';

interface ExploreAnalysisProps { targetSceneBoardId: string | null; initialGraphData: GraphData | null; onSubGraphSaved: () => void }

function mergeGraph(base: GraphData, addition: GraphData): GraphData {
  return {
    nodes: [...new Map([...base.nodes, ...addition.nodes].map((node) => [node.id, node])).values()],
    edges: [...new Map([...base.edges, ...addition.edges].map((edge) => [edge.id, edge])).values()],
  };
}

const toG6Data = (data: GraphData, highlighted: Set<string>) => ({
  nodes: data.nodes.map((node) => ({ id: node.id, data: { ...node, highlighted: highlighted.has(node.id) } })),
  edges: data.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, data: { ...edge, highlighted: highlighted.has(edge.id) } })),
});

const FieldLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">{children}</div>
);

const ExploreAnalysis: React.FC<ExploreAnalysisProps> = ({ targetSceneBoardId, initialGraphData, onSubGraphSaved }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const graphDataRef = useRef<GraphData>(EMPTY_GRAPH);
  const highlightRef = useRef(new Set<string>());
  const [graphData, setGraphData] = useState<GraphData>(EMPTY_GRAPH);
  const [module, setModule] = useState<Module>('custom');
  const [customTool, setCustomTool] = useState<CustomTool>('lookup');
  const [layout, setLayout] = useState<Layout>('force');
  const [busy, setBusy] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [lastResult, setLastResult] = useState<GraphResult | null>(null);
  const [entityTypes, setEntityTypes] = useState(['company', 'person', 'account', 'loan']);
  const [edgeTypes, setEdgeTypes] = useState(DEFAULT_EDGES);
  const [selectedEdges, setSelectedEdges] = useState<string[]>(DEFAULT_EDGES);
  const [lookupField, setLookupField] = useState<'id' | 'name'>('id');
  const [lookupType, setLookupType] = useState('company');
  const [lookupValue, setLookupValue] = useState('c1');
  const [expandId, setExpandId] = useState('');
  const [minHops, setMinHops] = useState(1);
  const [maxHops, setMaxHops] = useState(2);
  const [direction, setDirection] = useState<'both' | 'out' | 'in'>('both');
  const [startId, setStartId] = useState('');
  const [endId, setEndId] = useState('');
  const [pathMode, setPathMode] = useState<'shortest' | 'all' | 'any-shortest'>('shortest');
  const [pathHops, setPathHops] = useState(6);
  const [gql, setGql] = useState(GQL_EXAMPLE);
  const [scenarios, setScenarios] = useState<ScenarioTemplate[]>([]);
  const [scenarioId, setScenarioId] = useState('');
  const [scenarioParams, setScenarioParams] = useState<Record<string, string>>({});
  const [classifications, setClassifications] = useState<Record<string, Classification>>(() => {
    try { return JSON.parse(localStorage.getItem('graph-node-classifications') ?? '{}') as Record<string, Classification>; }
    catch { return {}; }
  });
  const [saveOpen, setSaveOpen] = useState(false);
  const [sceneBoards, setSceneBoards] = useState<SceneBoard[]>([]);
  const [saveBoardId, setSaveBoardId] = useState(targetSceneBoardId ?? '');
  const [saveName, setSaveName] = useState('探索分析结果');
  const [graphInstances, setGraphInstances] = useState<GraphInstance[]>(builtinGraphInstances());
  const [activeGraphId, setActiveGraphId] = useState(()=>builtinGraphInstances().find(graph=>graph.status==='ready')?.id??'');
  const activeGraph=graphInstances.find(graph=>graph.id===activeGraphId);

  useEffect(() => {
    Promise.all([getGraphSchema(), listScenarios()]).then(([schema, templates]) => {
      setEntityTypes(schema.entityTypes); setEdgeTypes(schema.edgeTypes); setSelectedEdges(schema.edgeTypes);
      setScenarios(templates);
      if (templates[0]) {
        setScenarioId(templates[0].id);
        setScenarioParams(Object.fromEntries(templates[0].parameters.map((p) => [p.name, p.default == null ? (p.name === 'companyName' ? '凯达建材有限公司' : '') : String(p.default)])));
      }
    }).catch((error) => toast.error(error instanceof Error ? error.message : '分析目录加载失败'));
  }, []);

  useEffect(() => { if (targetSceneBoardId) setSaveBoardId(targetSceneBoardId); }, [targetSceneBoardId]);
  useEffect(()=>{const refresh=()=>setGraphInstances(builtinGraphInstances());window.addEventListener(INGESTION_EVENT,refresh);return()=>window.removeEventListener(INGESTION_EVENT,refresh);},[]);

  const openSave = async () => {
    const boards = listBoards();
    setSceneBoards(boards); setSaveBoardId(targetSceneBoardId ?? boards[0]?.id ?? ''); setSaveOpen(true);
  };

  const saveToBoard = async () => {
    if (!saveBoardId || !saveName.trim() || graphData.nodes.length === 0) { toast.error('请选择看板、填写名称并确保画布有结果'); return; }
    const thumbnail = makeGraphThumbnail(graphData);
    createSubGraph({
      scene_board_id: saveBoardId, name: saveName.trim(), graph_data: graphData, thumbnail,
      query_text: module === 'gql' ? gql : lastResult?.title ?? '探索分析',
    });
    toast.success('分析结果已保存为场景看板'); setSaveOpen(false); onSubGraphSaved();
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const options: GraphOptions = {
      container: containerRef.current, autoFit: 'view', background: '#F8FAFC',
      node: { style: {
        size: (d) => ((d.data as { highlighted?: boolean })?.highlighted ? 44 : 36),
        labelText: (d) => ((d.data ?? {}) as unknown as GraphNode).label ?? '', labelPlacement: 'bottom', labelFontSize: 11,
        stroke: (d) => (d.data as { highlighted?: boolean })?.highlighted ? '#EF4444' : NODE_COLORS[((d.data ?? {}) as unknown as GraphNode).type ?? 'default'] ?? NODE_COLORS.default,
        lineWidth: (d) => (d.data as { highlighted?: boolean })?.highlighted ? 4 : 1.5,
        fill: (d) => `${NODE_COLORS[((d.data ?? {}) as unknown as GraphNode).type ?? 'default'] ?? NODE_COLORS.default}22`,
      } },
      edge: { style: {
        labelText: (d) => ((d.data ?? {}) as unknown as GraphEdge).label ?? '', labelFontSize: 10, endArrow: true,
        stroke: (d) => (d.data as { highlighted?: boolean })?.highlighted ? '#EF4444' : '#CBD5E1',
        lineWidth: (d) => (d.data as { highlighted?: boolean })?.highlighted ? 3 : 1.2,
      } },
      layout: { type: 'force' }, behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element', 'click-select'],
    };
    const graph = new Graph(options); graphRef.current = graph;
    graph.on('node:click', (event) => {
      const id = (event as unknown as { target?: { id?: string } }).target?.id;
      const node = graphDataRef.current.nodes.find((item) => item.id === id);
      if (node) { setSelectedNode(node); setExpandId(node.id); }
    });
    graph.on('canvas:click', () => setSelectedNode(null));
    graph.setData(toG6Data(graphDataRef.current, highlightRef.current)); void graph.render();
    return () => { graph.destroy(); graphRef.current = null; };
  }, []);

  const renderGraph = useCallback(async (data: GraphData, highlighted = new Set<string>()) => {
    graphDataRef.current = data; highlightRef.current = highlighted; setGraphData(data);
    const graph = graphRef.current;
    if (graph) { graph.setData(toG6Data(data, highlighted)); await graph.render(); graph.fitView({ when: 'always' }); }
  }, []);

  useEffect(() => { if (initialGraphData) void renderGraph(initialGraphData); }, [initialGraphData, renderGraph]);

  const consume = async (request: Promise<GraphResult>, merge = false, highlight = false) => {
    setBusy(true);
    try {
      const result = await request;
      const next = merge ? mergeGraph(graphDataRef.current, result) : { nodes: result.nodes, edges: result.edges };
      const ids = highlight ? new Set([...result.nodes.map((n) => n.id), ...result.edges.map((e) => e.id)]) : new Set<string>();
      await renderGraph(next, ids); setLastResult(result);
      result.warnings.forEach((warning) => toast.warning(warning));
      toast.success(`${result.title}：${result.nodes.length} 个节点，${result.edges.length} 条边`);
    } catch (error) { toast.error(error instanceof Error ? error.message : '分析执行失败'); }
    finally { setBusy(false); }
  };

  const changeLayout = async (value: Layout) => {
    setLayout(value); graphRef.current?.setLayout({ type: value }); await graphRef.current?.layout(); graphRef.current?.fitView();
  };

  const toggleEdge = (edge: string) => setSelectedEdges((values) => values.includes(edge) ? values.filter((item) => item !== edge) : [...values, edge]);
  const selectedScenario = scenarios.find((item) => item.id === scenarioId);

  const setClassification = (value: Classification) => {
    if (!selectedNode) return;
    const next = { ...classifications, [selectedNode.id]: value };
    if (value === 'none') delete next[selectedNode.id];
    setClassifications(next); localStorage.setItem('graph-node-classifications', JSON.stringify(next));
    toast.success(value === 'none' ? '已移除名单标注' : `已加入${value === 'blacklist' ? '黑名单' : '白名单'}`);
  };

  return (
    <div className="flex h-[calc(100dvh-48px)] min-h-0 min-w-0 overflow-hidden bg-background">
      <aside className="flex w-[340px] min-w-[300px] shrink-0 flex-col overflow-hidden border-r bg-white">
        <div className="shrink-0 border-b px-4 py-3"><div className="text-sm font-semibold">探索分析</div><div className="mt-0.5 text-[11px] text-muted-foreground">实体检索、关系展开、路径研判与场景分析</div></div>
        <div className="shrink-0 border-b bg-secondary/30 px-3 py-2"><FieldLabel>当前分析图</FieldLabel><select aria-label="当前分析图" value={activeGraphId} onChange={e=>{setActiveGraphId(e.target.value);void renderGraph(EMPTY_GRAPH);setLastResult(null);}} className="h-8 w-full rounded-md border bg-white px-2 text-xs">{graphInstances.map(graph=><option key={graph.id} value={graph.id} disabled={graph.status!=='ready'}>{graph.name} · {graph.spaceName}{graph.status==='ready'?'':' · 未就绪'}</option>)}</select><div className="mt-1 text-[10px] text-muted-foreground">{activeGraph?`${activeGraph.vertexCount} 节点 · ${activeGraph.edgeCount} 边 · ${activeGraph.status}`:'请选择已导入完成的图'}</div></div>
        <Tabs value={module} onValueChange={(v) => setModule(v as Module)} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-3 mt-3 grid h-9 shrink-0 grid-cols-3">
            <TabsTrigger value="custom" className="text-xs">自定义分析</TabsTrigger>
            <TabsTrigger value="scenario" className="text-xs">场景模版</TabsTrigger>
            <TabsTrigger value="gql" className="text-xs">GQL 控制台</TabsTrigger>
          </TabsList>
          <TabsContent value="custom" className="mt-0 min-h-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full"><div className="space-y-4 p-3">
              <div className="grid grid-cols-3 gap-1 rounded-md bg-secondary p-1">
                {([['lookup','点查询'],['expand','多跳展开'],['path','路径查找']] as const).map(([id,label]) => <button key={id} type="button" onClick={() => setCustomTool(id)} className={`rounded px-1 py-1.5 text-[11px] ${customTool === id ? 'bg-white font-medium shadow-sm' : 'text-muted-foreground'}`}>{label}</button>)}
              </div>
              {customTool === 'lookup' && <section className="space-y-3">
                <div><FieldLabel>查询方式</FieldLabel><select value={lookupField} onChange={(e) => setLookupField(e.target.value as 'id'|'name')} className="h-8 w-full rounded-md border bg-white px-2 text-xs"><option value="id">实体 ID</option><option value="name">标签名称</option></select></div>
                {lookupField === 'name' && <div><FieldLabel>实体类型</FieldLabel><select value={lookupType} onChange={(e) => setLookupType(e.target.value)} className="h-8 w-full rounded-md border bg-white px-2 text-xs">{entityTypes.map((t) => <option key={t}>{t}</option>)}</select></div>}
                <div><FieldLabel>{lookupField === 'id' ? '实体 ID' : '标签名称'}</FieldLabel><Input value={lookupValue} onChange={(e) => setLookupValue(e.target.value)} className="h-8 text-xs" /></div>
                <Button disabled={busy || !lookupValue.trim()} className="h-8 w-full text-xs" onClick={() => consume(lookupVertex({ value: lookupValue.trim(), field: lookupField, entityType: lookupField === 'name' ? lookupType : undefined }))}>查询并显示</Button>
              </section>}
              {customTool === 'expand' && <section className="space-y-3">
                <div><FieldLabel>中心点 ID（点击画布节点自动带入）</FieldLabel><Input value={expandId} onChange={(e) => setExpandId(e.target.value)} className="h-8 text-xs" /></div>
                <div className="grid grid-cols-2 gap-2"><div><FieldLabel>最小跳数</FieldLabel><Input type="number" min={1} max={6} value={minHops} onChange={(e) => setMinHops(Number(e.target.value))} className="h-8 text-xs" /></div><div><FieldLabel>最大跳数</FieldLabel><Input type="number" min={1} max={6} value={maxHops} onChange={(e) => setMaxHops(Number(e.target.value))} className="h-8 text-xs" /></div></div>
                <div><FieldLabel>方向</FieldLabel><select value={direction} onChange={(e) => setDirection(e.target.value as 'both'|'out'|'in')} className="h-8 w-full rounded-md border bg-white px-2 text-xs"><option value="both">双向</option><option value="out">流出</option><option value="in">流入</option></select></div>
                <EdgeSelector edges={edgeTypes} selected={selectedEdges} onToggle={toggleEdge} onAll={() => setSelectedEdges(selectedEdges.length === edgeTypes.length ? [] : edgeTypes)} />
                <Button disabled={busy || !expandId.trim() || minHops > maxHops || selectedEdges.length === 0} className="h-8 w-full text-xs" onClick={() => consume(expandVertex({ vertexId: expandId.trim(), minHops, maxHops, edgeTypes: selectedEdges, direction }), true)}>展开并合并画布</Button>
              </section>}
              {customTool === 'path' && <section className="space-y-3">
                <div><FieldLabel>起点 ID</FieldLabel><div className="flex gap-1"><Input value={startId} onChange={(e) => setStartId(e.target.value)} className="h-8 text-xs" /><Button variant="outline" className="h-8 px-2 text-[11px]" onClick={() => selectedNode && setStartId(selectedNode.id)}>取选中点</Button></div></div>
                <div><FieldLabel>终点 ID</FieldLabel><div className="flex gap-1"><Input value={endId} onChange={(e) => setEndId(e.target.value)} className="h-8 text-xs" /><Button variant="outline" className="h-8 px-2 text-[11px]" onClick={() => selectedNode && setEndId(selectedNode.id)}>取选中点</Button></div></div>
                <div><FieldLabel>路径模式</FieldLabel><select value={pathMode} onChange={(e) => setPathMode(e.target.value as typeof pathMode)} className="h-8 w-full rounded-md border bg-white px-2 text-xs"><option value="shortest">最短路径（全部并列最短）</option><option value="any-shortest">任意最短路径</option><option value="all">最全路径</option></select></div>
                <div><FieldLabel>最大跳数</FieldLabel><Input type="number" min={1} max={10} value={pathHops} onChange={(e) => setPathHops(Number(e.target.value))} className="h-8 text-xs" /></div>
                <EdgeSelector edges={edgeTypes} selected={selectedEdges} onToggle={toggleEdge} onAll={() => setSelectedEdges(selectedEdges.length === edgeTypes.length ? [] : edgeTypes)} />
                <Button disabled={busy || !startId.trim() || !endId.trim() || selectedEdges.length === 0} className="h-8 w-full text-xs" onClick={() => consume(findPaths({ startId: startId.trim(), endId: endId.trim(), mode: pathMode, maxHops: pathHops, edgeTypes: selectedEdges }), true, true)}>查找并高亮路径</Button>
              </section>}
            </div></ScrollArea>
          </TabsContent>
          <TabsContent value="scenario" className="mt-0 min-h-0 flex-1 overflow-hidden"><ScrollArea className="h-full"><div className="space-y-3 p-3">
            <div><FieldLabel>分析模版</FieldLabel><select value={scenarioId} onChange={(e) => { const id=e.target.value; const s=scenarios.find((x)=>x.id===id); setScenarioId(id); setScenarioParams(Object.fromEntries((s?.parameters ?? []).map((p)=>[p.name,p.default == null?'':String(p.default)]))); }} className="h-8 w-full rounded-md border bg-white px-2 text-xs">{scenarios.map((s)=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            {selectedScenario && <><div className="rounded-md border bg-secondary/40 p-3"><div className="text-xs font-medium">{selectedScenario.name}</div><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{selectedScenario.description}</p><Badge variant="outline" className="mt-2 text-[10px]">{selectedScenario.category} · v{selectedScenario.version}</Badge></div>{selectedScenario.parameters.map((p)=><div key={p.name}><FieldLabel>{p.label}{p.required?' *':''}</FieldLabel><Input value={scenarioParams[p.name] ?? ''} onChange={(e)=>setScenarioParams((v)=>({...v,[p.name]:e.target.value}))} className="h-8 text-xs" /></div>)}<Button disabled={busy} className="h-8 w-full text-xs" onClick={() => consume(executeScenario(selectedScenario.id, Object.fromEntries(selectedScenario.parameters.map((p)=>[p.name,p.type==='integer'?Number(scenarioParams[p.name]):scenarioParams[p.name]]))))}>执行场景分析</Button></>}
            <div className="rounded-md border border-dashed p-3 text-[11px] leading-5 text-muted-foreground">模版将继续扩展：洗钱路径、虚增流水、垒大户行为。每个模版由后台版本化管理实体类型、阈值和分析参数。</div>
          </div></ScrollArea></TabsContent>
          <TabsContent value="gql" className="mt-0 min-h-0 flex-1 p-3"><div className="flex h-full flex-col gap-3"><div className="text-[11px] leading-5 text-muted-foreground">仅允许只读 GQL，自动限制返回规模。结果中的点、边、路径会直接映射到画布。</div><textarea value={gql} onChange={(e)=>setGql(e.target.value)} className="min-h-0 flex-1 resize-none rounded-md border bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100" /><Button disabled={busy || !gql.trim()} className="h-8 text-xs" onClick={()=>consume(executeGraphQuery(gql))}>执行 GQL</Button></div></TabsContent>
        </Tabs>
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="z-10 flex h-12 shrink-0 items-center justify-between gap-2 border-b bg-white px-3">
          <div className="min-w-0"><div className="truncate text-xs font-medium">分析画布 · {activeGraph?.name??'未选择图'}</div><div className="text-[10px] text-muted-foreground">{graphData.nodes.length} 节点 · {graphData.edges.length} 边{lastResult ? ` · ${lastResult.executionTimeMs}ms` : ''}</div></div>
          <div className="flex shrink-0 items-center gap-1"><span className="hidden text-[11px] text-muted-foreground lg:inline">布局</span><select aria-label="画布布局" value={layout} onChange={(e)=>void changeLayout(e.target.value as Layout)} className="h-8 rounded-md border bg-white px-2 text-xs"><option value="force">力导向</option><option value="circular">环形</option><option value="dagre">树状 / 层次</option></select><Button variant="outline" className="h-8 px-2 text-xs" onClick={()=>graphRef.current?.fitView()}>适应画布</Button><Button variant="outline" className="h-8 px-2 text-xs" disabled={graphData.nodes.length === 0} onClick={()=>void openSave()}>保存到看板</Button><Button variant="outline" className="h-8 px-2 text-xs" onClick={()=>void renderGraph(EMPTY_GRAPH)}>清空</Button></div>
        </div>
        {lastResult && <div className="shrink-0 border-b bg-primary/5 px-3 py-1.5 text-[11px] text-muted-foreground"><span className="font-medium text-foreground">{lastResult.title}</span><span className="ml-3">Trace {lastResult.traceId.slice(0,8)}</span>{lastResult.truncated && <span className="ml-3 text-amber-600">结果已截断</span>}</div>}
        <div ref={containerRef} className="min-h-0 min-w-0 flex-1 overflow-hidden bg-secondary/20" />
        <div className="pointer-events-none absolute bottom-3 left-3 rounded border bg-white/90 px-2 py-1 text-[10px] text-muted-foreground">拖拽移动 · 滚轮缩放 · 点击节点后可展开、设路径端点或添加名单</div>
        <div className="pointer-events-none absolute bottom-3 right-3 flex flex-wrap gap-2 rounded border bg-white/90 px-2 py-1.5 text-[10px] shadow-sm">{Object.entries(NODE_COLORS).filter(([t])=>t!=='default').map(([t,c])=><span key={t} className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full border" style={{background:`${c}33`,borderColor:c}} />{t}</span>)}</div>
      </main>

      <aside className="hidden w-72 shrink-0 flex-col overflow-hidden border-l bg-white xl:flex">
        <div className="shrink-0 border-b px-4 py-3 text-xs font-semibold">节点研判</div>
        {selectedNode ? <NodeInsightPanel node={selectedNode} classification={classifications[selectedNode.id]??'none'} onExpand={()=>{setExpandId(selectedNode.id);setModule('custom');setCustomTool('expand')}} onStart={()=>{setStartId(selectedNode.id);setModule('custom');setCustomTool('path')}} onEnd={()=>{setEndId(selectedNode.id);setModule('custom');setCustomTool('path')}} onClassify={setClassification}/> : <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">点击画布节点查看实体属性与名单命中信息</div>}
      </aside>
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}><DialogContent className="max-w-sm bg-white"><DialogHeader><DialogTitle>保存为场景看板</DialogTitle></DialogHeader><div className="space-y-3"><div><FieldLabel>结果名称</FieldLabel><Input value={saveName} onChange={(e)=>setSaveName(e.target.value)} /></div><div><FieldLabel>目标看板</FieldLabel><select value={saveBoardId} onChange={(e)=>setSaveBoardId(e.target.value)} className="h-9 w-full rounded-md border bg-white px-2 text-sm">{sceneBoards.map((board)=><option key={board.id} value={board.id}>{board.name}</option>)}</select></div><div className="rounded-md bg-secondary p-3 text-xs text-muted-foreground">将保存 {graphData.nodes.length} 个节点、{graphData.edges.length} 条边及 SVG 缩略图。</div></div><DialogFooter><Button variant="outline" onClick={()=>setSaveOpen(false)}>取消</Button><Button onClick={()=>void saveToBoard()}>保存</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
};

const EdgeSelector = ({ edges, selected, onToggle, onAll }: { edges:string[]; selected:string[]; onToggle:(edge:string)=>void; onAll:()=>void }) => <div><div className="mb-1.5 flex items-center justify-between"><FieldLabel>边类型</FieldLabel><button type="button" onClick={onAll} className="text-[10px] text-primary">{selected.length===edges.length?'取消全选':'全选'}</button></div><div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto rounded-md border p-2">{edges.map((edge)=><button type="button" key={edge} onClick={()=>onToggle(edge)} className={`rounded border px-1.5 py-1 text-[10px] ${selected.includes(edge)?'border-primary bg-primary/10 text-primary':'text-muted-foreground'}`}>{edge}</button>)}</div></div>;

const NodeInsightPanel=({node,classification,onExpand,onStart,onEnd,onClassify}:{node:GraphNode;classification:Classification;onExpand:()=>void;onStart:()=>void;onEnd:()=>void;onClassify:(value:Classification)=>void})=>{const properties=Object.entries(node.properties??{});const riskValue=node.properties?.risk_score??node.properties?.risk??node.properties?.score;const status=classification==='blacklist'?{label:'命中黑名单',style:'border-red-200 bg-red-50 text-red-700'}:classification==='whitelist'?{label:'命中白名单',style:'border-emerald-200 bg-emerald-50 text-emerald-700'}:{label:'未命中本地名单',style:'border-slate-200 bg-slate-50 text-slate-600'};return <ScrollArea className="min-h-0 flex-1"><div className="space-y-3 p-3"><div className="rounded-md border bg-secondary/30 p-3"><div className="flex items-start justify-between gap-2"><div><div className="text-sm font-medium">{node.label}</div><div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{node.id}</div></div><Badge variant="outline">{node.type??'unknown'}</Badge></div>{riskValue!=null&&<div className="mt-3 flex items-center justify-between border-t pt-2 text-xs"><span className="text-muted-foreground">风险值</span><b className="text-red-600">{String(riskValue)}</b></div>}</div><div className={`rounded-md border p-3 ${status.style}`}><div className="text-[10px] font-medium">名单命中状态</div><div className="mt-1 text-sm font-semibold">{status.label}</div>{classification!=='none'&&<div className="mt-1 text-[10px]">来源：探索分析本地名单 · 实体ID精确匹配</div>}</div><div className="grid grid-cols-2 gap-2"><Button variant="outline" className="h-8 text-xs" onClick={onExpand}>以此点展开</Button><Button variant="outline" className="h-8 text-xs" onClick={onStart}>设为起点</Button><Button variant="outline" className="h-8 text-xs" onClick={onEnd}>设为终点</Button><Button variant="outline" className="h-8 text-xs" disabled={classification==='none'} onClick={()=>onClassify('none')}>移除名单</Button></div><div><FieldLabel>名单管理</FieldLabel><div className="grid grid-cols-2 gap-2"><Button variant={classification==='blacklist'?'default':'outline'} className="h-8 text-xs" onClick={()=>onClassify('blacklist')}>{classification==='blacklist'?'已在黑名单':'加入黑名单'}</Button><Button variant={classification==='whitelist'?'default':'outline'} className="h-8 text-xs" onClick={()=>onClassify('whitelist')}>{classification==='whitelist'?'已在白名单':'加入白名单'}</Button></div></div><div className="rounded-md border p-3"><div className="mb-2 flex items-center justify-between"><FieldLabel>实体属性</FieldLabel><span className="text-[10px] text-muted-foreground">{properties.length} 项</span></div>{properties.length?<div className="space-y-2">{properties.map(([key,value])=><div key={key} className="grid grid-cols-[88px_1fr] gap-2 border-b pb-2 text-[11px] last:border-0"><div className="break-all text-muted-foreground">{key}</div><div className="break-all text-right">{value==null?'—':typeof value==='object'?JSON.stringify(value):String(value)}</div></div>)}</div>:<div className="py-4 text-center text-[11px] text-muted-foreground">当前查询未返回实体属性</div>}</div></div></ScrollArea>};

function makeGraphThumbnail(data: GraphData): string {
  const nodes = data.nodes.slice(0, 12); const index = new Map(nodes.map((node, i) => [node.id, i]));
  const points = nodes.map((_, i) => ({ x: 80 + Math.cos((i / Math.max(nodes.length, 1)) * Math.PI * 2) * 55, y: 55 + Math.sin((i / Math.max(nodes.length, 1)) * Math.PI * 2) * 35 }));
  const lines = data.edges.filter((edge)=>index.has(edge.source)&&index.has(edge.target)).slice(0,20).map((edge)=>{const a=points[index.get(edge.source)!];const b=points[index.get(edge.target)!];return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#94a3b8" stroke-width="1"/>`;}).join('');
  const circles = points.map((point,i)=>`<circle cx="${point.x}" cy="${point.y}" r="5" fill="${NODE_COLORS[nodes[i].type ?? 'default'] ?? NODE_COLORS.default}"/>`).join('');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="110" viewBox="0 0 160 110"><rect width="160" height="110" fill="#f8fafc"/>${lines}${circles}</svg>`)}`;
}

export default ExploreAnalysis;
