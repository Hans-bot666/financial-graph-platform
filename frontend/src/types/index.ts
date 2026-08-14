export interface Option {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
  withCount?: boolean;
}

// 图谱平台类型定义

/** 场景看板 */
export interface SceneBoard {
  id: string;
  name: string;
  theme: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** 子图看板 */
export interface SubGraph {
  id: string;
  scene_board_id: string;
  name: string;
  graph_data: GraphData;
  thumbnail: string | null;
  query_text: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** 图数据结构 */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** 图节点 */
export interface GraphNode {
  id: string;
  label: string;
  type?: string;
  properties?: Record<string, unknown>;
  x?: number;
  y?: number;
  style?: Record<string, unknown>;
}

/** 图边 */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: string;
  properties?: Record<string, unknown>;
  style?: Record<string, unknown>;
}

/** 图谱统计 */
export interface GraphStats {
  id: string;
  vertex_count: number;
  edge_count: number;
  space_name: string;
  refreshed_at: string;
}

/** 顶部导航页签 */
export type TabKey = 'home' | 'model' | 'data' | 'explore' | 'feature';

export interface TabItem {
  key: TabKey;
  label: string;
  icon: string;
}

/** GQL查询结果 */
export interface GQLResult {
  success: boolean;
  data?: GraphData;
  error?: string;
  executionTime?: number;
}

/** 可视化查询条件 */
export interface VisualQueryCondition {
  id: string;
  entityType: string;
  property: string;
  operator: string;
  value: string;
}

export interface VisualQueryRelation {
  id: string;
  fromEntity: string;
  edgeType: string;
  toEntity: string;
  direction: 'out' | 'in' | 'both';
}

// ── 模型构建类型定义 ──────────────────────────────────────────

/** 属性类型枚举 */
export type PropDataType = 'string' | 'int' | 'int64' | 'float' | 'double' | 'bool' | 'date' | 'datetime' | 'timestamp';

/** 属性定义 */
export interface PropertyDef {
  id: string;
  name: string;
  type: PropDataType;
  isPrimaryKey: boolean;
  nullable: boolean;
  defaultValue: string;
  comment: string;
}

/** 实体类型（Tag/点类型） */
export interface TagType {
  id: string;
  name: string;
  color: string;
  comment: string;
  properties: PropertyDef[];
  /** 在可视化画布上的坐标 */
  x: number;
  y: number;
}

/** 边类型（Edge Type） */
export interface EdgeType {
  id: string;
  name: string;
  fromTagId: string;
  toTagId: string;
  color: string;
  comment: string;
  properties: PropertyDef[];
}

/** Schema 版本快照 */
export interface SchemaVersion {
  id: string;
  version: string;
  description: string;
  tags: TagType[];
  edges: EdgeType[];
  createdAt: string;
  isDraft: boolean;
}

/** 可被模型构建和数据接入共同读取的 Schema 文档 */
export interface GraphSchemaDefinition {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'published';
  tags: TagType[];
  edges: EdgeType[];
  versions: SchemaVersion[];
  publishedVersionId: string | null;
  updatedAt: string;
}

/** 模型构建选中状态 */
export type ModelSelection =
  | { type: 'tag'; id: string }
  | { type: 'edge'; id: string }
  | null;
