export type FeatureOperatorKind='input'|'filter'|'path'|'pattern'|'aggregate'|'logic'|'algorithm'|'output';
export type FeaturePortType='ENTITY'|'GRAPH'|'PATH_SET'|'ROW_SET'|'SCALAR'|'VECTOR'|'BOOLEAN'|'FEATURE_VALUE';
export type FeatureLifecycle={apiEnabled:boolean;scheduleEnabled:boolean;schedule:string;online:boolean;publishedAt:string|null};
export type FeatureOperator={id:string;kind:FeatureOperatorKind;title:string;description:string;x:number;y:number;config:Record<string,string|number|boolean>};
export type FeatureFlowEdge={id:string;source:string;target:string};
export type FeatureDefinition={
  id:string;name:string;graphInstanceId:string;entityType:string;version:number;status:'draft'|'validated'|'published';
  nodes:FeatureOperator[];edges:FeatureFlowEdge[];updatedAt:string;lifecycle?:FeatureLifecycle;
};
export type FeatureIR={
  irVersion:'1.0';featureId:string;name:string;graphInstanceId:string;entity:string;version:number;
  nodes:Array<{id:string;op:string;config:FeatureOperator['config']}>;edges:Array<[string,string]>;
  runtime:'bounded-online'|'offline-job';limits:{maxHop:number;maxRows:number;timeoutMs:number};
};

const STORAGE_KEY='financial-graph-feature-definitions-v1';
export const FEATURE_EVENT='financial-graph-features-changed';
const read=():FeatureDefinition[]=>{try{const value=JSON.parse(localStorage.getItem(STORAGE_KEY)??'[]');return Array.isArray(value)?value:[];}catch{return[];}};
export const listFeatureDefinitions=()=>read().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
export const saveFeatureDefinition=(definition:FeatureDefinition)=>{localStorage.setItem(STORAGE_KEY,JSON.stringify([...read().filter(item=>item.id!==definition.id),definition]));window.dispatchEvent(new CustomEvent(FEATURE_EVENT));return definition;};
export const deleteFeatureDefinition=(id:string)=>{localStorage.setItem(STORAGE_KEY,JSON.stringify(read().filter(item=>item.id!==id)));window.dispatchEvent(new CustomEvent(FEATURE_EVENT));};
export const defaultLifecycle=():FeatureLifecycle=>({apiEnabled:false,scheduleEnabled:false,schedule:'0 2 * * *',online:false,publishedAt:null});
export const operatorPorts=(kind:FeatureOperatorKind,config:FeatureOperator['config']):{inputs:FeaturePortType[];outputs:FeaturePortType[]}=>({
  input:{inputs:[],outputs:['ENTITY']},filter:{inputs:['ENTITY','ROW_SET','PATH_SET'],outputs:['ROW_SET']},path:{inputs:['ENTITY'],outputs:['PATH_SET']},
  pattern:{inputs:['ENTITY','GRAPH'],outputs:['PATH_SET']},aggregate:{inputs:['ROW_SET','PATH_SET'],outputs:['SCALAR']},logic:{inputs:['SCALAR','BOOLEAN'],outputs:['BOOLEAN']},
  algorithm:{inputs:['GRAPH','ENTITY'],outputs:[String(config.algorithm).includes('Node2Vec')||String(config.algorithm).includes('GraphSAGE')?'VECTOR':'SCALAR']},output:{inputs:['SCALAR','VECTOR','BOOLEAN'],outputs:['FEATURE_VALUE']},
}[kind] as {inputs:FeaturePortType[];outputs:FeaturePortType[]});
export const portsCompatible=(source:FeaturePortType,target:FeaturePortType)=>source===target||(source==='ENTITY'&&target==='GRAPH')||(source==='PATH_SET'&&target==='ROW_SET')||(source==='SCALAR'&&target==='BOOLEAN');

export type ValidationResult={valid:boolean;errors:string[];warnings:string[];order:string[]};
export type FeatureCompileResult={validation:ValidationResult;ir:FeatureIR;target:'ngql-template'|'offline-job';queryTemplate:string|null;parameters:string[]};
const API_BASE_URL=(import.meta.env.VITE_GRAPH_API_BASE_URL??'').replace(/\/$/,'');
const csrfToken=()=>{const item=document.cookie.split('; ').find(entry=>entry.startsWith('fgp_csrf='));return item?decodeURIComponent(item.split('=').slice(1).join('=')):'';};
async function api<T>(path:string,init:RequestInit):Promise<T>{const response=await fetch(`${API_BASE_URL}${path}`,{...init,credentials:'include',headers:{'X-CSRF-Token':csrfToken(),...init.headers}});const body=await response.json().catch(()=>({}));const detail=typeof body?.detail==='string'?body.detail:body?.detail?.message;if(!response.ok)throw new Error(detail??body?.message??`特征服务请求失败（HTTP ${response.status}）`);return body as T;}
export const saveFeatureDefinitionRemote=(definition:FeatureDefinition)=>api<FeatureDefinition>(`/api/v1/features/definitions/${encodeURIComponent(definition.id)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(definition)});
export const validateFeatureDefinitionRemote=(definition:FeatureDefinition)=>api<ValidationResult>('/api/v1/features/definitions/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(definition)});
export const compileFeatureDefinitionRemote=(definition:FeatureDefinition)=>api<FeatureCompileResult>('/api/v1/features/definitions/compile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(definition)});
export function validateFeatureDefinition(definition:FeatureDefinition):ValidationResult{
  const errors:string[]=[];const warnings:string[]=[];const ids=new Set(definition.nodes.map(node=>node.id));
  const inputs=definition.nodes.filter(node=>node.kind==='input');const outputs=definition.nodes.filter(node=>node.kind==='output');
  if(inputs.length!==1)errors.push(`必须且只能有一个实体输入，当前 ${inputs.length} 个`);
  if(outputs.length<1)errors.push('至少需要一个特征输出');
  const nodeMap=new Map(definition.nodes.map(node=>[node.id,node]));for(const edge of definition.edges){if(!ids.has(edge.source)||!ids.has(edge.target))errors.push(`连线 ${edge.id} 引用了不存在的算子`);if(edge.source===edge.target)errors.push('算子不能连接到自身');const source=nodeMap.get(edge.source),target=nodeMap.get(edge.target);if(source&&target){const out=operatorPorts(source.kind,source.config).outputs[0],inputs=operatorPorts(target.kind,target.config).inputs;if(out&&!inputs.some(input=>portsCompatible(out,input)))errors.push(`端口类型不兼容：${source.title}(${out}) → ${target.title}(${inputs.join('|')||'无输入'})`);}}
  const incoming=new Map(definition.nodes.map(node=>[node.id,0]));const outgoing=new Map(definition.nodes.map(node=>[node.id,[] as string[]]));
  for(const edge of definition.edges){incoming.set(edge.target,(incoming.get(edge.target)??0)+1);outgoing.get(edge.source)?.push(edge.target);}
  const queue=definition.nodes.filter(node=>(incoming.get(node.id)??0)===0).map(node=>node.id);const order:string[]=[];
  while(queue.length){const id=queue.shift()!;order.push(id);for(const next of outgoing.get(id)??[]){const count=(incoming.get(next)??0)-1;incoming.set(next,count);if(count===0)queue.push(next);}}
  if(order.length!==definition.nodes.length)errors.push('流程存在环路，请删除形成循环的连线');
  const connected=new Set(definition.edges.flatMap(edge=>[edge.source,edge.target]));for(const node of definition.nodes){if(!connected.has(node.id))warnings.push(`「${node.title}」尚未连接`);if(node.kind==='path'&&Number(node.config.maxHop)>6)errors.push(`「${node.title}」最大跳数不能超过 6`);if(Object.values(node.config).some(value=>value==='待配置'||value==='请选择字段'))warnings.push(`「${node.title}」存在未完成配置`);}
  for(const output of definition.nodes.filter(node=>node.kind==='output')){const destinations=String(output.config.destinations??'').split(',').filter(Boolean);if(destinations.length===0)errors.push(`「${output.title}」至少选择一个输出目的地`);if(destinations.includes('graph')&&!String(output.config.graphProperty??'').trim())errors.push(`「${output.title}」写回原图时必须配置属性名`);if(destinations.includes('external')&&!String(output.config.storageRef??'').trim())errors.push(`「${output.title}」外部存储必须配置目标引用`);}
  return {valid:errors.length===0,errors,warnings,order};
}

const opNames:Record<FeatureOperatorKind,string>={input:'ENTITY_INPUT',filter:'PROPERTY_FILTER',path:'PATH_MATCH',pattern:'PATTERN_MATCH',aggregate:'AGGREGATE',logic:'LOGIC',algorithm:'GRAPH_ALGORITHM',output:'FEATURE_OUTPUT'};
export function compileFeatureIR(definition:FeatureDefinition):FeatureIR{
  const validation=validateFeatureDefinition(definition);if(!validation.valid)throw new Error(validation.errors.join('；'));
  const byId=new Map(definition.nodes.map(node=>[node.id,node]));const sorted=validation.order.map(id=>byId.get(id)!).filter(Boolean);
  const offline=sorted.some(node=>node.kind==='algorithm');
  return {irVersion:'1.0',featureId:definition.id,name:definition.name,graphInstanceId:definition.graphInstanceId,entity:definition.entityType,version:definition.version,nodes:sorted.map(node=>({id:node.id,op:opNames[node.kind],config:node.config})),edges:definition.edges.map(edge=>[edge.source,edge.target]),runtime:offline?'offline-job':'bounded-online',limits:{maxHop:6,maxRows:500,timeoutMs:2000}};
}
