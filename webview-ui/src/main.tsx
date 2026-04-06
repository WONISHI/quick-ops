import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// 引入你的各个页面组件
import TextCompareApp from './pages/TextCompareApp';
import MockServerApp from './pages/MockSidebarApp';
import RecentProjectsApp from './pages/RecentProjectsApp';
import LivePreviewApp from './pages/LivePreviewApp';
import AnchorApp from "./pages/AnchorApp"
import MockSidebarApp from './pages/MockSidebarApp'
import MockProxyPanelApp from "./pages/MockProxyPanelApp"
import MockRulePanelApp from './pages/MockRulePanelApp'
import GitApp from './pages/GitApp';
import './index.css';

// 🌟 从 VS Code 注入的全局变量中获取初始路由，如果没有则默认走 '/'
const initialRoute = (window as any).__ROUTE__ || '/';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {/* 🌟 使用 MemoryRouter，并且传入初始路由 */}
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/compare" element={<TextCompareApp />} />
        <Route path="/mock" element={<MockServerApp />} />
        <Route path="/projects" element={<RecentProjectsApp />} />
        <Route path="/preview" element={<LivePreviewApp />} />
        <Route path="/anchor" element={<AnchorApp />} />
        <Route path='/git' element={<GitApp />} />
        <Route path="/mock" element={<MockSidebarApp />} />
        <Route path="/mock/proxy" element={<MockProxyPanelApp />} />
        <Route path="/mock/rule" element={<MockRulePanelApp />} />
        <Route path="/" element={<div>Welcome to Quick Ops Dashboard!</div>} />
      </Routes>
    </MemoryRouter>
  </React.StrictMode>,
);
