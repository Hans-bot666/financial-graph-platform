import React, { useCallback, useState } from 'react';
import DataIngestion from '@/pages/DataIngestion';
import ExploreAnalysis from '@/pages/ExploreAnalysis';
import FeatureFactory from '@/pages/FeatureFactory';
import HomePage from '@/pages/HomePage';
import ModelBuilder from '@/pages/ModelBuilder';
import type { TabKey } from '@/types/index';
import TopNav from './TopNav';

/** 子图保存回调的参数类型 */
export interface SaveSubGraphParams {
  sceneBoardId: string;
  name: string;
  graphData: import('@/types/index').GraphData;
  queryText?: string;
}

const MainLayout: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  // 从首页看板跳转到探索分析时，携带的目标场景看板ID
  const [targetSceneBoardId, setTargetSceneBoardId] = useState<string | null>(null);
  const [initialExploreGraph, setInitialExploreGraph] = useState<import('@/types/index').GraphData | null>(null);

  const handleTabChange = useCallback((tab: TabKey) => {
    setActiveTab(tab);
    if (tab !== 'explore') {
      setTargetSceneBoardId(null);
      setInitialExploreGraph(null);
    }
  }, []);

  // 从首页看板点击"+"跳转到探索分析，并携带目标场景看板ID
  const handleNavigateToExplore = useCallback((sceneBoardId: string, graphData?: import('@/types/index').GraphData) => {
    setTargetSceneBoardId(sceneBoardId);
    setInitialExploreGraph(graphData ?? null);
    setActiveTab('explore');
  }, []);

  // 在探索分析中保存子图后返回首页
  const handleSubGraphSaved = useCallback(() => {
    setTargetSceneBoardId(null);
    setActiveTab('home');
  }, []);

  const renderPage = () => {
    switch (activeTab) {
      case 'home':
        return <HomePage onNavigateToExplore={handleNavigateToExplore} />;
      case 'model':
        return <ModelBuilder />;
      case 'data':
        return <DataIngestion />;
      case 'explore':
        return (
          <ExploreAnalysis
            targetSceneBoardId={targetSceneBoardId}
            initialGraphData={initialExploreGraph}
            onSubGraphSaved={handleSubGraphSaved}
          />
        );
      case 'feature':
        return <FeatureFactory />;
      default:
        return <HomePage onNavigateToExplore={handleNavigateToExplore} />;
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <TopNav activeTab={activeTab} onTabChange={handleTabChange} />
      <main className="flex-1 overflow-hidden">
        {renderPage()}
      </main>
    </div>
  );
};

export default MainLayout;
