import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import TextCompareApp from '@pages/text-compare-app';
import MockServerApp from '@pages/mock-app/MockSidebarApp';
import RecentProjectsApp from '@pages/recent-projects-app';
import LivePreviewApp from '@pages/live-preview-app';
import AnchorApp from '@pages/anchor-app';
import MockSidebarApp from '@pages/mock-app/MockSidebarApp';
import MockProxyPanelApp from '@pages/mock-app/MockProxyPanelApp';
import MockRulePanelApp from '@pages/mock-app/MockRulePanelApp';
import VditorApp from '@pages/vditor-app';
import GitApp from '@pages/git-app';
import ExcelPreviewApp from '@pages/excel-preview-app';
import PdfPreviewApp from '@pages/pdf-preview-app';
import GitDetailApp from '@pages/git-detail-app';
import HtmlPreviewApp from '@pages/html-preview-app';
import DocPreviewApp from '@pages/doc-preview-app';
import ApiDevToolsApp from '@pages/api-dev-tools-app';
import DevToolsApp from '@pages/dev-tools-app';
import '@/index.css';
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
        <Route path="/git" element={<GitApp />} />
        <Route path="/html-preview" element={<HtmlPreviewApp />} />
        <Route path="/devtools" element={<DevToolsApp />} />
        <Route path="/api-fox" element={<ApiDevToolsApp />} />
        <Route path="/git-detail" element={<GitDetailApp />} />
        <Route path="/mock" element={<MockSidebarApp />} />
        <Route path="/mock/proxy" element={<MockProxyPanelApp />} />
        <Route path="/mock/rule" element={<MockRulePanelApp />} />
        <Route path="/vditor" element={<VditorApp pageMode />} />
        <Route path="/pdf" element={<PdfPreviewApp />} />
        <Route path="/xls" element={<ExcelPreviewApp />} />
        <Route path="/doc" element={<DocPreviewApp />} />
        <Route path="/" element={<div>Welcome to Quick Ops Dashboard!</div>} />
      </Routes>
    </MemoryRouter>
  </React.StrictMode>,
);
