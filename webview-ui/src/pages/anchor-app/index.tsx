import '@xyflow/react/dist/style.css';

import { ReactFlowProvider } from '@xyflow/react';
import AnchorAppInner from '@pages/anchor-app/components/anchor-app-inner';

export default function AnchorApp() {
  return (
    <ReactFlowProvider>
      <AnchorAppInner />
    </ReactFlowProvider>
  );
}