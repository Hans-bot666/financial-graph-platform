import type { GraphStats, SceneBoard, SubGraph } from '@/types';

const BOARDS_KEY = 'financial-scene-boards-v1';
const SUB_GRAPHS_KEY = 'financial-sub-graphs-v1';
export const BOARD_STORE_EVENT = 'financial-scene-boards-changed';

function read<T>(key: string): T[] {
  try { const value = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(value) ? value as T[] : []; }
  catch { return []; }
}

function emit(): void { window.dispatchEvent(new CustomEvent(BOARD_STORE_EVENT)); }

export function listBoards(): SceneBoard[] { return read<SceneBoard>(BOARDS_KEY).sort((a,b)=>a.sort_order-b.sort_order); }
export function listSubGraphs(): SubGraph[] { return read<SubGraph>(SUB_GRAPHS_KEY).sort((a,b)=>a.sort_order-b.sort_order); }

export function createBoard(input: Pick<SceneBoard, 'name'|'theme'|'description'>): SceneBoard {
  const boards = listBoards(); const now = new Date().toISOString();
  const board: SceneBoard = { id: crypto.randomUUID(), ...input, sort_order: boards.length, created_at: now, updated_at: now };
  localStorage.setItem(BOARDS_KEY, JSON.stringify([...boards, board])); emit(); return board;
}

export function updateBoard(id: string, patch: Pick<SceneBoard, 'name'|'theme'|'description'>): void {
  localStorage.setItem(BOARDS_KEY, JSON.stringify(listBoards().map(board=>board.id===id?{...board,...patch,updated_at:new Date().toISOString()}:board))); emit();
}

export function deleteBoard(id: string): void {
  localStorage.setItem(BOARDS_KEY, JSON.stringify(listBoards().filter(board=>board.id!==id)));
  localStorage.setItem(SUB_GRAPHS_KEY, JSON.stringify(listSubGraphs().filter(graph=>graph.scene_board_id!==id))); emit();
}

export function createSubGraph(input: Pick<SubGraph,'scene_board_id'|'name'|'graph_data'|'thumbnail'|'query_text'>): SubGraph {
  const items=listSubGraphs(); const now=new Date().toISOString();
  const item:SubGraph={id:crypto.randomUUID(),...input,sort_order:items.filter(x=>x.scene_board_id===input.scene_board_id).length,created_at:now,updated_at:now};
  localStorage.setItem(SUB_GRAPHS_KEY,JSON.stringify([...items,item]));emit();return item;
}

export function deleteSubGraph(id:string):void { localStorage.setItem(SUB_GRAPHS_KEY,JSON.stringify(listSubGraphs().filter(item=>item.id!==id)));emit(); }

export function localGraphStats(): GraphStats {
  const graphs=listSubGraphs().map(item=>item.graph_data);
  return {id:'local',vertex_count:graphs.reduce((n,g)=>n+g.nodes.length,0),edge_count:graphs.reduce((n,g)=>n+g.edges.length,0),space_name:'anti_fraud_kg',refreshed_at:new Date().toISOString()};
}
