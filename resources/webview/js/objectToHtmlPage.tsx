import React from 'react';
import { createRoot } from 'react-dom/client';

const App: React.FC = () => (
  <div>
    <h1>Hello from React 18!</h1>
  </div>
);

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container); // React 18 新 API
  root.render(<App />);
}
