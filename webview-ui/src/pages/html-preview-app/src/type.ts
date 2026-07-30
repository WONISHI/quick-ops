import type { RefObject } from 'react';

export interface HtmlPreviewAppProps {
  fsPath?: string;
  iframeRef?: RefObject<HTMLIFrameElement | null>;
  onTitleChange?: (title: string) => void;
}

export interface HtmlPreviewMessage {
  type?: string;
  fsPath?: string;
  content?: string;
  message?: string;
}