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
import VditorApp from './pages/VditorApp';
import GitApp from './pages/GitApp';
import ExcelPreviewApp from './pages/ExcelPreviewApp';
import './index.css';
import '@vscode/codicons/dist/codicon.css';

const initialRoute = (window as any).__ROUTE__ || '/';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
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
        <Route path='/vditor' element={<VditorApp></VditorApp>}/>
        <Route path="/" element={<div>Welcome to Quick Ops Dashboard!</div>} />
        <Route path='/xls' element={<ExcelPreviewApp></ExcelPreviewApp>} />
      </Routes>
    </MemoryRouter>
  </React.StrictMode>,
);
