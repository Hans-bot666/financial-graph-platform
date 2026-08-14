import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {type DataSourceDefinition, type DataSourceType, 
  deleteDataSource, INGESTION_EVENT, listDataSources,
  saveDataSource,
} from '@/services/ingestion-store';

const SOURCE_TYPES:DataSourceType[]=['csv','mysql','hive','oracle','kafka','maxcompute'];
const emptySource=():DataSourceDefinition=>({id:crypto.randomUUID(),name:'',type:'csv',host:'',port:'',database:'',username:'',secretRef:'',path:'',status:'untested',tables:[],updatedAt:new Date().toISOString()});

const DataIngestion:React.FC=()=>{
  const [sources,setSources]=useState(listDataSources());
  const [sourceDialog,setSourceDialog]=useState(false);
  const [editingSource,setEditingSource]=useState<DataSourceDefinition>(emptySource());
  const refresh=()=>setSources(listDataSources());
  useEffect(()=>{window.addEventListener(INGESTION_EVENT,refresh);return()=>window.removeEventListener(INGESTION_EVENT,refresh);},[]);
  const persistSource=()=>{if(!editingSource.name.trim()){toast.error('请输入数据源名称');return;}saveDataSource({...editingSource,status:'untested',tables:[],updatedAt:new Date().toISOString()});setSourceDialog(false);toast.success('数据源配置草稿已保存');};

  return <div className="flex h-[calc(100dvh-48px)] min-h-0 flex-col overflow-hidden bg-background">
    <div className="flex h-12 shrink-0 items-center justify-between border-b bg-white px-5"><div><div className="text-sm font-semibold">数据接入</div><div className="text-[10px] text-muted-foreground">数据源连接器接入前，仅管理配置草稿</div></div></div>
    <div className="min-h-0 flex-1 overflow-auto p-5">
      <SourcesPanel sources={sources} onAdd={()=>{setEditingSource(emptySource());setSourceDialog(true);}} onEdit={source=>{setEditingSource(source);setSourceDialog(true);}} onDelete={id=>{deleteDataSource(id);toast.success('数据源配置已删除');}}/>
    </div>
    <SourceDialog open={sourceDialog} source={editingSource} onChange={setEditingSource} onClose={()=>setSourceDialog(false)} onSave={persistSource}/>
  </div>;
};

const SmallLabel=({children}:{children:React.ReactNode})=><div className="mb-1.5 text-[11px] font-medium text-muted-foreground">{children}</div>;
const SourcesPanel=({sources,onAdd,onEdit,onDelete}:{sources:DataSourceDefinition[];onAdd:()=>void;onEdit:(s:DataSourceDefinition)=>void;onDelete:(id:string)=>void})=><div><div className="mb-4 flex items-center justify-between"><div><h2 className="text-base font-semibold">数据源配置草稿</h2><p className="text-xs text-muted-foreground">只保存非敏感连接元数据和凭据引用，不代表已连通。</p></div><Button onClick={onAdd}>+ 添加配置</Button></div><div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">{sources.map(source=><div key={source.id} className="rounded-xl border bg-white p-4"><div className="flex justify-between"><div><div className="font-medium">{source.name}</div><div className="mt-1 text-xs text-muted-foreground">{source.type.toUpperCase()} · {source.host||source.path||'未配置'}</div></div><Badge variant="outline">配置草稿</Badge></div><div className="mt-3 text-xs text-muted-foreground">凭据引用：{source.secretRef||'未配置'}</div><div className="mt-4 flex gap-2"><Button size="sm" variant="outline" onClick={()=>onEdit(source)}>编辑</Button><Button size="sm" variant="ghost" onClick={()=>onDelete(source.id)}>删除</Button></div></div>)}{sources.length===0&&<div className="col-span-full rounded-xl border-2 border-dashed bg-white p-16 text-center text-sm text-muted-foreground">尚未添加数据源配置</div>}</div></div>;

const SourceDialog=({open,source,onChange,onClose,onSave}:{open:boolean;source:DataSourceDefinition;onChange:(s:DataSourceDefinition)=>void;onClose:()=>void;onSave:()=>void})=><Dialog open={open} onOpenChange={v=>!v&&onClose()}><DialogContent className="max-w-lg bg-white"><DialogHeader><DialogTitle>数据源配置草稿</DialogTitle></DialogHeader><div className="grid grid-cols-2 gap-3"><div><SmallLabel>名称</SmallLabel><Input value={source.name} onChange={e=>onChange({...source,name:e.target.value})}/></div><div><SmallLabel>类型</SmallLabel><select value={source.type} onChange={e=>onChange({...source,type:e.target.value as DataSourceType})} className="h-9 w-full rounded-md border px-2 text-sm">{SOURCE_TYPES.map(t=><option key={t}>{t.toUpperCase()}</option>)}</select></div>{source.type==='csv'?<div className="col-span-2"><SmallLabel>文件路径 / 对象存储 URI</SmallLabel><Input value={source.path} onChange={e=>onChange({...source,path:e.target.value})} placeholder="/data/customers.csv"/></div>:<><div><SmallLabel>Host / Endpoint</SmallLabel><Input value={source.host} onChange={e=>onChange({...source,host:e.target.value})}/></div><div><SmallLabel>Port</SmallLabel><Input value={source.port} onChange={e=>onChange({...source,port:e.target.value})}/></div><div><SmallLabel>Database / Project</SmallLabel><Input value={source.database} onChange={e=>onChange({...source,database:e.target.value})}/></div><div><SmallLabel>用户名 / Access ID</SmallLabel><Input value={source.username} onChange={e=>onChange({...source,username:e.target.value})}/></div><div className="col-span-2"><SmallLabel>凭据引用</SmallLabel><Input value={source.secretRef} onChange={e=>onChange({...source,secretRef:e.target.value})} placeholder="vault://finance/source-secret"/></div></>}</div><DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button onClick={onSave}>保存配置草稿</Button></DialogFooter></DialogContent></Dialog>;

export default DataIngestion;
