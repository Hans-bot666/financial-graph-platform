export type DataSourceType = 'csv' | 'mysql' | 'hive' | 'oracle' | 'kafka' | 'maxcompute';
export type DataSourceStatus = 'untested' | 'connected' | 'failed';
export type LoadTaskStatus = 'draft' | 'offline' | 'online' | 'running' | 'success' | 'failed';

export interface SourceField { name: string; type: string; sample: string }
export interface SourceTable { id: string; name: string; namespace: string; kind: 'table'|'topic'|'file'; fields: SourceField[] }
export interface DataSourceDefinition {
  id:string; name:string; type:DataSourceType; host:string; port:string; database:string; username:string;
  secretRef:string; path:string; status:DataSourceStatus; tables:SourceTable[]; updatedAt:string;
}
export interface MappingDefinition {
  id:string; name:string; dataSourceId:string; tableId:string; schemaId:string; versionId:string;
  targetKind:'vertex'|'edge'; targetId:string; fields:Record<string,string>; status:'draft'|'published'; updatedAt:string;
}
export interface LoadTask {
  id:string; name:string; mappingId:string; graphInstanceId:string; schedule:string; status:LoadTaskStatus;
  lastRunAt:string|null; loadedRows:number; updatedAt:string;
}
export interface GraphInstance {
  id:string; name:string; spaceName:string; schemaId:string; versionId:string; status:'loading'|'ready'|'offline';
  sourceTaskIds:string[]; vertexCount:number; edgeCount:number; updatedAt:string;
}

const SOURCES='financial-data-sources-v1',MAPPINGS='financial-mappings-v1',TASKS='financial-load-tasks-v1',GRAPHS='financial-graph-instances-v1';
export const INGESTION_EVENT='financial-ingestion-changed';
const read=<T,>(key:string):T[]=>{try{const value=JSON.parse(localStorage.getItem(key)??'[]');return Array.isArray(value)?value as T[]:[];}catch{return [];}};
const write=<T,>(key:string,value:T[])=>{localStorage.setItem(key,JSON.stringify(value));window.dispatchEvent(new CustomEvent(INGESTION_EVENT));};
export const listDataSources=()=>read<DataSourceDefinition>(SOURCES);
export const saveDataSource=(source:DataSourceDefinition)=>write(SOURCES,[...listDataSources().filter(item=>item.id!==source.id),source]);
export const deleteDataSource=(id:string)=>write(SOURCES,listDataSources().filter(item=>item.id!==id));
export const listMappings=()=>read<MappingDefinition>(MAPPINGS);
export const saveMapping=(mapping:MappingDefinition)=>write(MAPPINGS,[...listMappings().filter(item=>item.id!==mapping.id),mapping]);
export const listLoadTasks=()=>read<LoadTask>(TASKS);
export const saveLoadTask=(task:LoadTask)=>write(TASKS,[...listLoadTasks().filter(item=>item.id!==task.id),task]);
export const listGraphInstances=()=>read<GraphInstance>(GRAPHS);
export const saveGraphInstance=(graph:GraphInstance)=>write(GRAPHS,[...listGraphInstances().filter(item=>item.id!==graph.id),graph]);

export function builtinGraphInstances():GraphInstance[]{
  const items=listGraphInstances();
  const builtin={id:'anti-fraud-default',name:'对公贷款反欺诈图',spaceName:'anti_fraud_kg',schemaId:'builtin',versionId:'v1',status:'ready' as const,sourceTaskIds:[],vertexCount:0,edgeCount:0,updatedAt:new Date().toISOString()};
  return [builtin,...items.filter(item=>item.id!==builtin.id)];
}
