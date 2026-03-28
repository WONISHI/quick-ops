import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// 引入你的各个页面组件
import TextCompareApp from './pages/TextCompareApp';
import MockServerApp from './pages/MockServerApp';
import RecentProjectsApp from './pages/RecentProjectsApp';
import LivePreviewApp from './pages/LivePreviewApp';
import AnchorApp from "./pages/AnchorApp"
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
        <Route path="/" element={<div>Welcome to Quick Ops Dashboard!</div>} />
      </Routes>
    </MemoryRouter>
  </React.StrictMode>,
);
