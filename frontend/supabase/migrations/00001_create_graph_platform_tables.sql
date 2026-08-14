
-- 场景看板表
CREATE TABLE scene_boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  theme text NOT NULL DEFAULT 'default',
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 子图看板表
CREATE TABLE sub_graphs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_board_id uuid NOT NULL REFERENCES scene_boards(id) ON DELETE CASCADE,
  name text NOT NULL,
  graph_data jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  thumbnail text,
  query_text text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 图谱统计缓存表
CREATE TABLE graph_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertex_count bigint NOT NULL DEFAULT 0,
  edge_count bigint NOT NULL DEFAULT 0,
  space_name text NOT NULL DEFAULT 'default',
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

-- 初始化统计数据（模拟Nebula Graph数据）
INSERT INTO graph_stats (vertex_count, edge_count, space_name) VALUES
  (12847, 38562, 'default');

-- 开启RLS
ALTER TABLE scene_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_graphs ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_stats ENABLE ROW LEVEL SECURITY;

-- 公开读写策略（无需认证）
CREATE POLICY "allow_all_scene_boards" ON scene_boards FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_sub_graphs" ON sub_graphs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_read_graph_stats" ON graph_stats FOR SELECT USING (true);
CREATE POLICY "allow_update_graph_stats" ON graph_stats FOR UPDATE USING (true) WITH CHECK (true);
