import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import AdminUsers from '@/pages/AdminUsers';
import DataIngestion from '@/pages/DataIngestion';
import ExploreAnalysis from '@/pages/ExploreAnalysis';
import FeatureFactory from '@/pages/FeatureFactory';
import HomePage from '@/pages/HomePage';
import ModelBuilder from '@/pages/ModelBuilder';
import type { TabKey } from '@/types/index';
import SideNav from './SideNav';
import TopNav from './TopNav';

/** 子图保存回调的参数类型 */
export interface SaveSubGraphParams {
  sceneBoardId: string;
  name: string;
  graphData: import('@/types/index').GraphData;
  queryText?: string;
}

const MainLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>(() => (
    (location.state as { tab?: TabKey } | null)?.tab === 'admin' && hasPermission('user.read')
      ? 'admin'
      : 'home'
  ));
  const [navCollapsed, setNavCollapsed] = useState(true);
  const [focusBoardRequest, setFocusBoardRequest] = useState<{ id: string; requestId: number } | null>(null);
  // 从首页看板跳转到探索分析时，携带的目标场景看板ID
  const [targetSceneBoardId, setTargetSceneBoardId] = useState<string | null>(null);
  const [initialExploreGraph, setInitialExploreGraph] = useState<import('@/types/index').GraphData | null>(null);

  const handleTabChange = useCallback((tab: TabKey) => {
    if (tab === 'admin' && !hasPermission('user.read')) return;
    setActiveTab(tab);
    setFocusBoardRequest(null);
    if (tab !== 'explore') {
      setTargetSceneBoardId(null);
      setInitialExploreGraph(null);
    }
  }, [hasPermission]);

  useEffect(() => {
    const requested = (location.state as { tab?: TabKey } | null)?.tab;
    if (requested !== 'admin') return;
    if (hasPermission('user.read')) {
      setActiveTab('admin');
      setFocusBoardRequest(null);
      setTargetSceneBoardId(null);
      setInitialExploreGraph(null);
    }
    navigate('/', { replace: true, state: null });
  }, [hasPermission, location.state, navigate]);

  useEffect(() => {
    if (activeTab === 'admin' && !hasPermission('user.read')) {
      setActiveTab('home');
    }
  }, [activeTab, hasPermission]);

  // 从首页看板点击"+"跳转到探索分析，并携带目标场景看板ID
  const handleNavigateToExplore = useCallback((sceneBoardId: string, graphData?: import('@/types/index').GraphData) => {
    setFocusBoardRequest(null);
    setTargetSceneBoardId(sceneBoardId);
    setInitialExploreGraph(graphData ?? null);
    setActiveTab('explore');
  }, []);

  const handleOpenScene = useCallback((sceneBoardId: string) => {
    setActiveTab('home');
    setTargetSceneBoardId(null);
    setInitialExploreGraph(null);
    setFocusBoardRequest({ id: sceneBoardId, requestId: Date.now() });
  }, []);

  // 在探索分析中保存子图后返回首页
  const handleSubGraphSaved = useCallback(() => {
    setTargetSceneBoardId(null);
    setActiveTab('home');
  }, []);

  const renderPage = () => {
    switch (activeTab) {
      case 'home':
        return (
          <HomePage
            focusBoardRequest={focusBoardRequest}
            onNavigateToExplore={handleNavigateToExplore}
          />
        );
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
      case 'admin':
        return <AdminUsers />;
      default:
        return (
          <HomePage
            focusBoardRequest={focusBoardRequest}
            onNavigateToExplore={handleNavigateToExplore}
          />
        );
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <SideNav
        activeTab={activeTab}
        collapsed={navCollapsed}
        onCollapsedChange={setNavCollapsed}
        onTabChange={handleTabChange}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopNav
          activeTab={activeTab}
          onOpenScene={handleOpenScene}
          onOpenSubGraph={handleNavigateToExplore}
        />
        <main className="min-h-0 flex-1 overflow-hidden">{renderPage()}</main>
      </div>
    </div>
  );
};

export default MainLayout;
